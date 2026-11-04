/**
 * search.js — Moteur de recherche applicatif (orchestration, pas d'affichage).
 *
 * Responsabilité : valider les critères, les traduire en requêtes API,
 * gérer les replis (recherche approximative, élargissement géographique),
 * filtrer par état d'établissement, trier par pertinence et dédupliquer.
 *
 * Règle absolue : aucun résultat n'est fabriqué. Chaque assouplissement de
 * critère est signalé à l'utilisateur par un « notice » explicite.
 */

import config from './config.js';
import {
  AppError, ERR, digitsOnly, isValidCodePostal, isValidSiren, isValidSiret,
  normalizeText, similarity, uniqBy,
} from './utils.js';
import { searchEntreprises } from './entreprise-api.js';
import { resolveCommune, geocodeAddress } from './geocoding.js';

/** Formes juridiques et mots parasites retirés lors du repli approximatif. */
const NOISE_WORDS = new Set([
  'sas', 'sasu', 'sarl', 'eurl', 'sa', 'sci', 'snc', 'scop', 'selarl', 'scp', 'scm',
  'ste', 'societe', 'ets', 'etablissements', 'etablissement', 'cie', 'compagnie',
  'groupe', 'group', 'france', 'fr', 'sarlau', 'selas', 'selafa', 'sc', 'sas',
]);

/* ==================================================================== */
/* 1. Validation                                                         */
/* ==================================================================== */

export function readCriteria(input = {}) {
  return {
    nom: String(input.nom ?? '').trim(),
    codePostal: String(input.codePostal ?? '').trim().toUpperCase(),
    ville: String(input.ville ?? '').trim(),
    adresse: String(input.adresse ?? '').trim(),
    identifiant: digitsOnly(input.identifiant ?? ''),
  };
}

export function hasAnyCriterion(criteria) {
  return Boolean(criteria.nom || criteria.codePostal || criteria.ville || criteria.adresse || criteria.identifiant);
}

/**
 * Validation bloquante avant tout appel réseau.
 * @returns {{valid: boolean, errors: object, message: string}}
 */
export function validateCriteria(criteria) {
  const errors = {};

  if (!hasAnyCriterion(criteria)) {
    return {
      valid: false,
      errors: { global: true },
      message: 'Renseignez au moins un critère : nom, code postal, ville, adresse ou SIREN/SIRET.',
    };
  }

  if (criteria.codePostal && !isValidCodePostal(criteria.codePostal)) {
    errors.codePostal = true;
  }

  if (criteria.identifiant) {
    const length = criteria.identifiant.length;
    if (length === 9 && !isValidSiren(criteria.identifiant)) errors.identifiant = true;
    else if (length === 14 && !isValidSiret(criteria.identifiant)) errors.identifiant = true;
    else if (length !== 9 && length !== 14) errors.identifiant = true;
  }

  // L'API impose 3 caractères minimum, sauf si un autre filtre est présent.
  const hasFilter = Boolean(criteria.codePostal || criteria.ville || criteria.adresse || criteria.identifiant);
  if (criteria.nom && criteria.nom.length < 3 && !hasFilter) {
    errors.nom = true;
  }

  const messages = [];
  if (errors.codePostal) messages.push(`« ${criteria.codePostal} » n'est pas un code postal français valide (5 caractères, ex. 75015, 20000, 97100).`);
  if (errors.identifiant) messages.push('SIREN (9 chiffres) ou SIRET (14 chiffres) invalide : la clé de contrôle ne correspond pas.');
  if (errors.nom) messages.push('Saisissez au moins 3 caractères, ou ajoutez un code postal / une ville.');

  return { valid: messages.length === 0, errors, message: messages.join(' ') };
}

/* ==================================================================== */
/* 2. Pertinence et tri                                                  */
/* ==================================================================== */

function significantTokens(value) {
  return normalizeText(value).split(' ').filter((token) => token.length > 1 && !NOISE_WORDS.has(token));
}

/** Score de pertinence d'un établissement pour les critères saisis. */
export function relevanceScore(row, criteria) {
  const { etablissement, entreprise } = row;
  let score = 0;

  const names = [entreprise.raisonSociale, entreprise.nomComplet, entreprise.sigle, etablissement.nomCommercial, ...etablissement.enseignes]
    .filter(Boolean);

  if (criteria.nom) {
    const target = normalizeText(criteria.nom);
    let best = 0;
    for (const name of names) {
      const normalized = normalizeText(name);
      if (normalized === target) best = Math.max(best, 1);
      else if (normalized.startsWith(target)) best = Math.max(best, 0.9);
      else if (normalized.includes(target)) best = Math.max(best, 0.8);
      else best = Math.max(best, similarity(name, criteria.nom) * 0.7);
    }
    score += best * 100;
  } else {
    score += 40;
  }

  if (criteria.codePostal && etablissement.codePostal === criteria.codePostal) score += 25;
  if (criteria.ville && normalizeText(etablissement.commune) === normalizeText(criteria.ville)) score += 20;

  if (criteria.adresse) {
    const tokens = significantTokens(criteria.adresse);
    const address = normalizeText(etablissement.adresse);
    const hits = tokens.filter((token) => address.includes(token)).length;
    if (tokens.length) score += (hits / tokens.length) * 30;
  }

  if (etablissement.estActif) score += 12;
  if (etablissement.estSiege) score += 8;
  if (Number.isFinite(etablissement.latitude) && Number.isFinite(etablissement.longitude)) score += 4;
  if (Number.isFinite(entreprise.score)) score += Math.min(10, entreprise.score / 10);

  return score;
}

export function filterRows(rows, etat) {
  if (etat !== 'A' && etat !== 'C') return rows;
  return rows.filter((row) => row.etablissement.etatAdministratif === etat);
}

export function sortRows(rows, sort, criteria) {
  const list = [...rows];
  const byName = (a, b) => normalizeText(a.entreprise.raisonSociale || a.etablissement.nomAffiche)
    .localeCompare(normalizeText(b.entreprise.raisonSociale || b.etablissement.nomAffiche), 'fr');

  switch (sort) {
    case 'nom':
      return list.sort(byName);
    case 'actifs':
      return list.sort((a, b) => Number(b.etablissement.estActif) - Number(a.etablissement.estActif) || byName(a, b));
    case 'commune':
      return list.sort((a, b) => normalizeText(a.etablissement.commune).localeCompare(normalizeText(b.etablissement.commune), 'fr')
        || Number(a.etablissement.codePostal || 0) - Number(b.etablissement.codePostal || 0) || byName(a, b));
    case 'pertinence':
    default:
      return list.sort((a, b) => relevanceScore(b, criteria) - relevanceScore(a, criteria) || byName(a, b));
  }
}

/** Variante « allégée » d'un nom pour la seconde passe de recherche. */
export function simplifyName(nom) {
  const tokens = significantTokens(nom);
  if (!tokens.length) return '';
  return tokens.join(' ');
}

/* ==================================================================== */
/* 3. Recherche orchestrée                                               */
/* ==================================================================== */

/**
 * Exécute une recherche complète.
 * @param {object} input critères bruts du formulaire
 * @param {object} options { page, perPage, etat, sort, fuzzy, signal }
 * @returns {Promise<object>} résultats + notices explicatifs
 */
export async function runSearch(input, options = {}) {
  const criteria = readCriteria(input);
  const validation = validateCriteria(criteria);
  if (!validation.valid) {
    throw new AppError('Critères invalides', {
      code: ERR.INVALID_INPUT, userMessage: validation.message, details: validation.errors,
    });
  }

  const {
    page = 1,
    perPage = config.search.perPage,
    etat = 'A',
    sort = 'pertinence',
    fuzzy = config.search.fuzzyFallback,
    signal = null,
  } = options;

  const notices = [];
  const base = {
    nom: criteria.nom,
    codePostal: criteria.codePostal,
    identifiant: criteria.identifiant,
    perPage,
    page,
    matchingLimit: config.search.matchingLimit,
  };

  /* --- Ville → code commune INSEE (filtre fiable) --------------------- */
  let resolvedCommune = null;
  if (criteria.ville && !criteria.identifiant) {
    try {
      resolvedCommune = await resolveCommune(criteria.ville, { codePostal: criteria.codePostal, signal });
    } catch { /* dégradation : on retombera sur le texte libre */ }

    if (resolvedCommune?.codeCommune) {
      base.codeCommune = resolvedCommune.codeCommune;
      if (!criteria.codePostal && resolvedCommune.codePostal) {
        notices.push({
          type: 'info',
          text: `Commune identifiée : ${resolvedCommune.commune} (${resolvedCommune.codeCommune}). Filtrage par code commune INSEE.`,
        });
      }
    } else {
      base.nom = [criteria.nom, criteria.ville].filter(Boolean).join(' ');
      notices.push({
        type: 'warning',
        text: `La ville « ${criteria.ville} » n'a pas été identifiée comme commune. Elle est utilisée comme texte de recherche.`,
      });
    }
  }

  /* --- Adresse seule → code postal déduit ---------------------------- */
  if (!criteria.nom && !criteria.codePostal && !criteria.identifiant && criteria.adresse && !base.codeCommune) {
    try {
      const [candidate] = await geocodeAddress(criteria.adresse, { limit: 1, signal });
      if (candidate?.postcode) {
        base.codePostal = candidate.postcode;
        if (candidate.citycode) base.codeCommune = candidate.citycode;
        notices.push({
          type: 'info',
          text: `Adresse géolocalisée : ${candidate.label}. Recherche des entreprises dans ce secteur (${candidate.postcode}).`,
        });
      }
    } catch { /* ignoré : la recherche texte prendra le relais */ }
    if (!base.codePostal && !base.codeCommune) base.nom = criteria.adresse;
  } else if (criteria.adresse && criteria.nom) {
    notices.push({
      type: 'info',
      text: 'L\'adresse saisie sert à classer les résultats et à vérifier la position GPS de la fiche ouverte.',
    });
  }

  /* --- 1re passe ----------------------------------------------------- */
  let result = await searchEntreprises(base, { signal });
  let effectiveCriteria = { ...criteria };
  let relaxed = false;

  /* --- Replis explicites si aucun résultat --------------------------- */
  if (result.totalResults === 0 && fuzzy && !criteria.identifiant) {
    // (a) nom simplifié (formes juridiques et accents retirés)
    const simplified = simplifyName(criteria.nom);
    if (simplified && simplified !== normalizeText(criteria.nom)) {
      const attempt = await searchEntreprises({ ...base, nom: simplified }, { signal });
      if (attempt.totalResults > 0) {
        result = attempt;
        relaxed = true;
        effectiveCriteria = { ...criteria, nom: simplified };
        notices.push({
          type: 'info',
          text: `Aucun résultat pour « ${criteria.nom} ». Recherche élargie effectuée avec « ${simplified} » (formes juridiques et accents ignorés).`,
        });
      }
    }

    // (b) premier mot significatif + code postal
    if (result.totalResults === 0 && criteria.nom && (criteria.codePostal || base.codeCommune)) {
      const first = significantTokens(criteria.nom)[0];
      if (first && first !== simplifyName(criteria.nom)) {
        const attempt = await searchEntreprises({ ...base, nom: first }, { signal });
        if (attempt.totalResults > 0) {
          result = attempt;
          relaxed = true;
          effectiveCriteria = { ...criteria, nom: first };
          notices.push({
            type: 'info',
            text: `Recherche approximative : « ${first} » dans le même secteur (le nom complet n'a rien donné).`,
          });
        }
      }
    }

    // (c) élargissement national (le secteur est abandonné, signalé clairement)
    if (result.totalResults === 0 && criteria.nom && (criteria.codePostal || base.codeCommune)) {
      const attempt = await searchEntreprises({
        ...base, nom: simplifyName(criteria.nom) || criteria.nom, codePostal: '', codeCommune: '',
      }, { signal });
      if (attempt.totalResults > 0) {
        result = attempt;
        relaxed = true;
        effectiveCriteria = { ...criteria, codePostal: '', ville: '' };
        notices.push({
          type: 'warning',
          text: `Aucune entreprise « ${criteria.nom} » dans le secteur demandé. ${attempt.totalResults} résultat(s) ailleurs en France sont affichés (filtre géographique retiré).`,
        });
      }
    }
  }

  /* --- Filtrage par état d'établissement ----------------------------- */
  const allRows = uniqBy(result.rows, (row) => row.etablissement.siret);
  const filtered = filterRows(allRows, etat);
  if (allRows.length > 0 && filtered.length === 0) {
    notices.push({
      type: 'warning',
      text: etat === 'A'
        ? 'Les établissements trouvés sont tous fermés. Basculez le filtre sur « Tous » ou « Fermés uniquement » pour les afficher.'
        : 'Les établissements trouvés sont tous actifs. Basculez le filtre sur « Tous » ou « Actifs uniquement ».',
    });
  }

  /* --- Cohérence ville saisie / résultats ---------------------------- */
  if (criteria.ville && resolvedCommune && filtered.length) {
    const mismatch = filtered.filter((row) => row.etablissement.codeCommune && row.etablissement.codeCommune !== resolvedCommune.codeCommune);
    if (mismatch.length === filtered.length) {
      notices.push({
        type: 'warning',
        text: `Aucun établissement ne se situe exactement dans la commune de ${resolvedCommune.commune} ; les résultats correspondent au secteur élargi.`,
      });
    }
  }

  /* --- Adresse saisie non retrouvée ---------------------------------- */
  if (criteria.adresse && filtered.length) {
    const tokens = significantTokens(criteria.adresse);
    const anyMatch = filtered.some((row) => {
      const address = normalizeText(row.etablissement.adresse);
      return tokens.length > 0 && tokens.every((token) => address.includes(token));
    });
    if (tokens.length && !anyMatch) {
      notices.push({
        type: 'warning',
        text: `Aucun établissement ne correspond exactement à l'adresse « ${criteria.adresse} ». Les résultats sont classés par proximité textuelle.`,
      });
    }
  }

  /* --- Volume important --------------------------------------------- */
  if (result.totalResults > 200) {
    notices.push({
      type: 'info',
      text: `${result.totalResults.toLocaleString('fr-FR')} unités légales correspondent. Ajoutez un nom ou une ville pour cibler, ou parcourez les pages.`,
    });
  }

  const sorted = sortRows(filtered, sort, effectiveCriteria);

  return {
    criteria,
    effectiveCriteria,
    relaxed,
    rows: sorted,
    allRows,
    entreprises: result.entreprises,
    totalResults: result.totalResults,
    page: result.page,
    perPage: result.perPage,
    totalPages: result.totalPages,
    notices,
    resolvedCommune,
    apiUrl: result.url,
    fetchedAt: new Date().toISOString(),
  };
}

/** Résumé affichable : « 12 établissements · 5 sociétés · 38 unités légales ». */
export function summarize(result) {
  const companies = new Set(result.rows.map((row) => row.entreprise.siren)).size;
  const parts = [
    `${result.rows.length} établissement${result.rows.length > 1 ? 's' : ''} affiché${result.rows.length > 1 ? 's' : ''}`,
    `${companies} société${companies > 1 ? 's' : ''}`,
  ];
  if (result.totalResults) {
    parts.push(`${result.totalResults.toLocaleString('fr-FR')} unité${result.totalResults > 1 ? 's' : ''} légale${result.totalResults > 1 ? 's' : ''} au total`);
  }
  if (result.totalPages > 1) parts.push(`page ${result.page}/${result.totalPages}`);
  return parts.join(' · ');
}
