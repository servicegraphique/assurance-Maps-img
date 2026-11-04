/**
 * entreprise-api.js — Client de l'API publique « Recherche d'entreprises ».
 *
 * Source : DINUM / Annuaire des Entreprises — https://recherche-entreprises.api.gouv.fr
 * Aucune clé, aucun compte. Limite officielle : 7 appels/seconde.
 *
 * Responsabilité : construire les requêtes, interroger l'API, normaliser la
 * réponse en objets métier stables (entreprise / établissement) et dédupliquer.
 * Aucune logique d'affichage, aucun géocodage ici (voir geocoding.js).
 *
 * Champs normalisés d'après le schéma officiel publié dans
 * annuaire-entreprises-data-gouv-fr/search-api (app/models/unite_legale.py).
 * Attention : `matching_etablissements` masque volontairement certains champs
 * (numero_voie, type_voie, libelle_voie, geo_adresse, departement…) ; le code
 * doit donc toujours prévoir leur absence.
 */

import config from './config.js';
import {
  AppError, ERR, RateLimiter, TtlCache, digitsOnly, isValidSiren, isValidSiret,
  isValidCodePostal, parseCoord, departmentFromCode, uniqBy, normalizeText,
} from './utils.js';
import { cacheStore } from './storage.js';
import { fetchServiceJson } from './transport.js';

const CFG = config.api.entreprises;
const limiter = new RateLimiter(CFG.minIntervalMs);
const cache = new TtlCache({
  store: cacheStore, prefix: 'cache:ent:', ttlMs: CFG.cacheTtlMs, maxEntries: config.storage.cacheMaxEntries,
});

export const SOURCE_ENTREPRISES = 'API Recherche d\'entreprises (DINUM)';
export const SOURCE_ENTREPRISES_URL = 'https://recherche-entreprises.api.gouv.fr/docs/';

/* ==================================================================== */
/* 1. Construction de requête                                            */
/* ==================================================================== */

/**
 * Traduit les critères de l'interface en paramètres d'API valides.
 * @param {object} criteria { nom, codePostal, codeCommune, identifiant, etat, page, perPage, matchingLimit }
 */
export function buildSearchParams(criteria = {}) {
  const params = new URLSearchParams();
  const nom = String(criteria.nom ?? '').trim();
  const identifiant = digitsOnly(criteria.identifiant ?? '');
  const codePostal = String(criteria.codePostal ?? '').trim().toUpperCase();

  if (identifiant) {
    if (isValidSiret(identifiant)) {
      // Recherche plein texte du SIRET : l'API indexe les 14 chiffres.
      params.set('q', identifiant);
    } else if (isValidSiren(identifiant)) {
      // Syntaxe officielle de recherche par unité légale.
      params.set('q', `siren:${identifiant}`);
    } else {
      throw new AppError('Identifiant invalide', {
        code: ERR.INVALID_INPUT,
        userMessage: identifiant.length === 9
          ? 'Ce SIREN est invalide (clé de contrôle incorrecte). Vérifiez les 9 chiffres.'
          : 'Ce SIRET est invalide (clé de contrôle incorrecte). Vérifiez les 14 chiffres.',
      });
    }
  } else if (nom) {
    params.set('q', nom);
  }

  if (codePostal) {
    if (!isValidCodePostal(codePostal)) {
      throw new AppError('Code postal invalide', {
        code: ERR.INVALID_INPUT,
        userMessage: `« ${codePostal} » n'est pas un code postal français valide (5 caractères, ex. 75015, 20000, 97100).`,
      });
    }
    params.set('code_postal', codePostal);
  }

  if (criteria.codeCommune) params.set('code_commune', String(criteria.codeCommune));
  if (criteria.departement) params.set('departement', String(criteria.departement));

  const page = Math.max(1, Number(criteria.page) || 1);
  const perPage = Math.min(config.search.maxPerPage, Math.max(1, Number(criteria.perPage) || config.search.perPage));
  if (page * perPage > 10000) {
    throw new AppError('Pagination au-delà de la limite API', {
      code: ERR.INVALID_INPUT,
      userMessage: 'L\'API limite l\'exploration à 10 000 résultats. Affinez la recherche (nom, code postal, ville).',
    });
  }
  params.set('page', String(page));
  params.set('per_page', String(perPage));
  params.set('limite_matching_etablissements', String(Math.min(100, Math.max(1, Number(criteria.matchingLimit) || config.search.matchingLimit))));
  if (criteria.pageEtablissements) params.set('page_etablissements', String(criteria.pageEtablissements));

  // Filtre côté unité légale (l'état des établissements est filtré côté client).
  if (criteria.etatUniteLegale === 'A' || criteria.etatUniteLegale === 'C') {
    params.set('etat_administratif', criteria.etatUniteLegale);
  }

  if (![...params.keys()].some((k) => k !== 'page' && k !== 'per_page' && k !== 'limite_matching_etablissements')) {
    throw new AppError('Aucun critère', {
      code: ERR.INVALID_INPUT,
      userMessage: 'Renseignez au moins un critère : nom, code postal, ville ou SIREN/SIRET.',
    });
  }

  return params;
}

/* ==================================================================== */
/* 2. Appel HTTP                                                         */
/* ==================================================================== */

async function callApi(params, { signal = null, useCache = true } = {}) {
  const url = `${CFG.baseUrl}${CFG.searchPath}?${params.toString()}`;
  const key = params.toString();
  const producer = () => fetchServiceJson('entreprises', url, {
    timeoutMs: CFG.timeoutMs,
    retries: CFG.retries,
    retryBaseDelayMs: CFG.retryBaseDelayMs,
    limiter,
    signal,
    label: 'service Recherche d\'entreprises',
  });
  return useCache ? cache.wrap(key, producer) : producer();
}

/** Test de disponibilité réel (requête minimale). */
export async function ping({ signal = null } = {}) {
  const started = Date.now();
  const params = new URLSearchParams({ q: 'dinum', per_page: '1' });
  const raw = await callApi(params, { signal });
  return { ok: Array.isArray(raw?.results), latencyMs: Date.now() - started };
}

/* ==================================================================== */
/* 3. Normalisation                                                      */
/* ==================================================================== */

const PLACEHOLDER = '[NON-DIFFUSIBLE]';

const clean = (value) => {
  if (value == null) return '';
  const str = String(value).trim();
  return str === PLACEHOLDER ? '' : str;
};

/** `commune` = code INSEE, `libelle_commune` = nom. On reste défensif. */
function pickCommune(raw) {
  const libelle = clean(raw.libelle_commune);
  const commune = clean(raw.commune);
  const looksLikeInsee = /^(2[AB]\d{3}|\d{5})$/.test(commune);
  return {
    codeCommune: looksLikeInsee ? commune : '',
    commune: libelle || (looksLikeInsee ? '' : commune),
  };
}

/** Voie lisible : champs structurés si disponibles, sinon adresse brute. */
function buildVoie(raw, adresse) {
  const parts = [clean(raw.numero_voie), clean(raw.indice_repetition), clean(raw.type_voie), clean(raw.libelle_voie)]
    .filter(Boolean);
  if (parts.length) return parts.join(' ');
  const cp = clean(raw.code_postal);
  const { commune } = pickCommune(raw);
  let voie = adresse;
  if (cp && voie.includes(cp)) voie = voie.slice(0, voie.indexOf(cp)).trim();
  else if (commune && normalizeText(voie).endsWith(normalizeText(commune))) {
    voie = voie.slice(0, voie.length - commune.length).trim();
  }
  return voie.replace(/[,;]\s*$/, '').trim();
}

export function normalizeEtablissement(raw = {}, entreprise = null) {
  const siret = clean(raw.siret);
  const adresse = clean(raw.adresse);
  const { codeCommune, commune } = pickCommune(raw);
  const codePostal = clean(raw.code_postal);
  const lat = parseCoord(raw.latitude);
  const lon = parseCoord(raw.longitude);
  const etat = clean(raw.etat_administratif) || null;
  const enseignes = Array.isArray(raw.liste_enseignes) ? raw.liste_enseignes.map(clean).filter(Boolean) : [];
  const nomCommercial = clean(raw.nom_commercial);
  const departement = clean(raw.departement) || departmentFromCode(codePostal, codeCommune);

  return {
    siret,
    siren: siret.slice(0, 9) || clean(entreprise?.siren),
    estSiege: Boolean(raw.est_siege),
    etatAdministratif: etat,
    estActif: etat === 'A',
    adresse,
    voie: buildVoie(raw, adresse),
    complementAdresse: clean(raw.complement_adresse),
    distributionSpeciale: clean(raw.distribution_speciale),
    codePostal,
    commune,
    codeCommune,
    departement,
    region: clean(raw.region),
    pays: clean(raw.libelle_pays_etranger) || 'France',
    naf: clean(raw.activite_principale) || clean(entreprise?.activite_principale),
    nomCommercial,
    enseignes,
    dateCreation: clean(raw.date_creation),
    dateFermeture: clean(raw.date_fermeture),
    trancheEffectif: clean(raw.tranche_effectif_salarie),
    anneeEffectif: clean(raw.annee_tranche_effectif_salarie),
    caractereEmployeur: clean(raw.caractere_employeur),
    geoAdresse: clean(raw.geo_adresse),
    geoId: clean(raw.geo_id),
    latitude: lat,
    longitude: lon,
    statutDiffusion: clean(raw.statut_diffusion_etablissement),
    nonDiffusible: String(raw.adresse ?? '').includes(PLACEHOLDER) || clean(raw.statut_diffusion_etablissement) === 'N',
    /** Nom affiché : enseigne > nom commercial > dénomination de la société. */
    nomAffiche: enseignes[0] || nomCommercial || clean(entreprise?.nom_complet) || 'Établissement sans nom',
    source: SOURCE_ENTREPRISES,
    sourceUrl: siret ? `https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}` : '',
  };
}

export function normalizeEntreprise(raw = {}) {
  const entreprise = {
    siren: clean(raw.siren),
    nomComplet: clean(raw.nom_complet),
    raisonSociale: clean(raw.nom_raison_sociale) || clean(raw.nom_complet),
    sigle: clean(raw.sigle),
    etatAdministratif: clean(raw.etat_administratif) || null,
    estActif: clean(raw.etat_administratif) === 'A',
    naf: clean(raw.activite_principale),
    categorie: clean(raw.categorie_entreprise),
    natureJuridique: clean(raw.nature_juridique),
    dateCreation: clean(raw.date_creation),
    dateFermeture: clean(raw.date_fermeture),
    trancheEffectif: clean(raw.tranche_effectif_salarie),
    anneeEffectif: clean(raw.annee_tranche_effectif_salarie),
    nombreEtablissements: Number(raw.nombre_etablissements) || 0,
    nombreEtablissementsOuverts: Number(raw.nombre_etablissements_ouverts) || 0,
    statutDiffusion: clean(raw.statut_diffusion),
    score: Number.isFinite(Number(raw.score)) ? Number(raw.score) : null,
    estAssociation: Boolean(raw.complements?.est_association),
    estEntrepreneurIndividuel: Boolean(raw.complements?.est_entrepreneur_individuel),
    estEss: Boolean(raw.complements?.est_ess),
    source: SOURCE_ENTREPRISES,
    sourceUrl: clean(raw.siren) ? `https://annuaire-entreprises.data.gouv.fr/entreprise/${clean(raw.siren)}` : '',
  };

  const brut = [];
  if (raw.siege && Object.keys(raw.siege).length) brut.push(raw.siege);
  if (Array.isArray(raw.matching_etablissements)) brut.push(...raw.matching_etablissements);
  if (Array.isArray(raw.etablissements)) brut.push(...raw.etablissements);

  const etablissements = uniqBy(
    brut.map((item) => normalizeEtablissement(item, raw)).filter((item) => item.siret),
    (item) => item.siret,
  );
  // Le siège d'abord, puis les établissements actifs.
  etablissements.sort((a, b) => Number(b.estSiege) - Number(a.estSiege) || Number(b.estActif) - Number(a.estActif));

  return { ...entreprise, etablissements };
}

export function normalizeResponse(raw = {}) {
  const entreprises = (Array.isArray(raw.results) ? raw.results : [])
    .map(normalizeEntreprise)
    .filter((entreprise) => entreprise.siren);
  return {
    entreprises,
    totalResults: Number(raw.total_results) || 0,
    page: Number(raw.page) || 1,
    perPage: Number(raw.per_page) || config.search.perPage,
    totalPages: Number(raw.total_pages) || 0,
    executionTime: Number(raw.execution_time) || null,
  };
}

/**
 * Aplatit en liste d'établissements, chacun portant sa société.
 * Dédoublonnage strict par SIRET (un même site peut remonter deux fois).
 */
export function flattenEtablissements(entreprises = []) {
  const rows = [];
  for (const entreprise of entreprises) {
    for (const etablissement of entreprise.etablissements) {
      rows.push({ etablissement, entreprise });
    }
  }
  return uniqBy(rows, (row) => row.etablissement.siret);
}

/* ==================================================================== */
/* 4. Requêtes métier                                                    */
/* ==================================================================== */

/** Recherche principale (nom, code postal, commune, identifiant…). */
export async function searchEntreprises(criteria, { signal = null, useCache = true } = {}) {
  const params = buildSearchParams(criteria);
  const raw = await callApi(params, { signal, useCache });
  const result = normalizeResponse(raw);
  return { ...result, rows: flattenEtablissements(result.entreprises), url: `${CFG.baseUrl}${CFG.searchPath}?${params}` };
}

/** Recherche directe par SIRET (utilisée au chargement d'un lien profond). */
export async function fetchBySiret(siret, { signal = null } = {}) {
  const id = digitsOnly(siret);
  if (!isValidSiret(id)) {
    throw new AppError('SIRET invalide', { code: ERR.INVALID_INPUT, userMessage: 'SIRET invalide : 14 chiffres attendus.' });
  }
  const result = await searchEntreprises({ identifiant: id, perPage: 5, matchingLimit: 100 }, { signal });
  let row = result.rows.find((item) => item.etablissement.siret === id);
  if (!row) {
    // Repli : on interroge l'unité légale puis on cherche l'établissement.
    const parent = await searchEntreprises(
      { identifiant: id.slice(0, 9), perPage: 1, matchingLimit: 100 },
      { signal },
    );
    row = parent.rows.find((item) => item.etablissement.siret === id) || null;
    if (!row && parent.entreprises[0]) {
      // L'établissement existe peut-être mais n'est pas renvoyé par la recherche.
      const entreprise = parent.entreprises[0];
      return { row: null, entreprise, searchedSiret: id };
    }
  }
  return { row: row || null, entreprise: row?.entreprise || null, searchedSiret: id };
}

/**
 * Établissements d'une société, éventuellement restreints à un code postal.
 * L'API ne fournit pas la liste exhaustive des sites d'un SIREN : on récupère
 * le siège + les établissements « connexes » (jusqu'à 100 par page).
 */
export async function fetchEtablissementsOfSiren(siren, { codePostal = '', pageEtablissements = 1, signal = null } = {}) {
  const id = digitsOnly(siren);
  if (!isValidSiren(id)) {
    throw new AppError('SIREN invalide', { code: ERR.INVALID_INPUT, userMessage: 'SIREN invalide : 9 chiffres attendus.' });
  }
  const result = await searchEntreprises({
    identifiant: id,
    codePostal,
    perPage: 1,
    matchingLimit: 100,
    pageEtablissements,
  }, { signal });
  const entreprise = result.entreprises.find((item) => item.siren === id) || result.entreprises[0] || null;
  return { entreprise, etablissements: entreprise?.etablissements || [], url: result.url };
}

/** Vide le cache de recherche (bouton « vider le cache »). */
export function clearEntrepriseCache() {
  cache.clearMemory();
}

export const entrepriseApiInternals = { buildSearchParams, normalizeEntreprise, normalizeEtablissement, normalizeResponse, flattenEtablissements };
