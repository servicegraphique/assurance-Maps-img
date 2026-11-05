/**
 * embed.js — Mode « intégré » du localisateur (iframe dans un formulaire).
 *
 * Le localisateur d'entreprises est utilisé par le formulaire d'assurance
 * (`assurance-tns-pro-v2-adw`) à l'étape qui suit le nom de société et le
 * code postal. Dans ce cas :
 *   - l'application s'ouvre avec `?embed=1` (plus `nom` et `cp`) ;
 *   - l'habillage public (en-tête, recherche, paramètres…) est masqué ;
 *   - la recherche part automatiquement des informations du formulaire ;
 *   - l'entreprise choisie est renvoyée au parent par `postMessage`.
 *
 * Le pont est volontairement sans dépendance (aucun import) et injectable :
 * `createEmbedBridge(window)` permet de le tester sans navigateur.
 *
 * Messages envoyés au parent (`parent.postMessage`) :
 *   { source: 'company-locator', type: 'locator:ready' }
 *   { source: 'company-locator', type: 'locator:results', payload: { count, rows } }
 *   { source: 'company-locator', type: 'locator:error', payload: { message } }
 *   { source: 'company-locator', type: 'locator:selected', payload: selection }
 *
 * Message attendu du parent :
 *   { source: 'tns-form', type: 'locator:search', payload: { nom, codePostal } }
 */

export const EMBED_SOURCE = 'company-locator';
export const PARENT_SOURCE = 'tns-form';

export const EMBED_TYPES = {
  ready: 'locator:ready',
  results: 'locator:results',
  error: 'locator:error',
  selected: 'locator:selected',
  search: 'locator:search',
};

/** Lit `?embed=1&nom=…&cp=…` (utilisable hors navigateur). */
export function readEmbedParams(search) {
  const params = new URLSearchParams(String(search || ''));
  const nom = (params.get('nom') || '').trim();
  const codePostal = (params.get('cp') || params.get('codePostal') || '').trim();
  return {
    active: params.get('embed') === '1',
    nom,
    codePostal: /^\d{4,5}$/.test(codePostal) ? codePostal : '',
  };
}

/**
 * Charge utile transmise au formulaire : tout ce dont l'étape suivante a
 * besoin pour l'offre (identité légale, adresse, GPS) — jamais de données
 * inventées : les champs absents restent vides.
 */
export function selectionPayload(fiche) {
  const row = (fiche && fiche.row) || {};
  const etablissement = row.etablissement || {};
  const entreprise = row.entreprise || {};
  const position = (fiche && fiche.position) || null;
  const siret = String(etablissement.siret || '').trim();
  const siren = String(entreprise.siren || etablissement.siren || (siret ? siret.slice(0, 9) : '')).trim();
  const nom = etablissement.nomAffiche
    || entreprise.nomComplet
    || entreprise.raisonSociale
    || '';
  const adresse = etablissement.adresse || etablissement.voie || '';
  const codePostal = etablissement.codePostal || '';
  const commune = etablissement.commune || '';

  return {
    siret,
    siren,
    nom,
    enseigne: (Array.isArray(etablissement.enseignes) && etablissement.enseignes[0]) || etablissement.nomCommercial || '',
    adresse,
    codePostal,
    commune,
    adresseComplete: [adresse, [codePostal, commune].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    naf: etablissement.naf || '',
    estSiege: Boolean(etablissement.estSiege),
    etatAdministratif: etablissement.etatAdministratif || '',
    latitude: position && Number.isFinite(Number(position.lat)) ? Number(position.lat) : null,
    longitude: position && Number.isFinite(Number(position.lon)) ? Number(position.lon) : null,
    precision: (position && position.precision) || '',
    source: (position && position.source) || '',
    pageUrl: siret ? `https://annuaire-entreprises.data.gouv.fr/etablissement/${siret}` : '',
  };
}

/** Résumé compact d'une ligne de résultat (pour la liste du formulaire). */
export function resultsSummary(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 20).map((row) => {
    const etablissement = (row && row.etablissement) || {};
    return {
      siret: etablissement.siret || '',
      nom: etablissement.nomAffiche || '',
      adresse: etablissement.adresse || '',
      codePostal: etablissement.codePostal || '',
      commune: etablissement.commune || '',
    };
  });
}

/**
 * Pont `postMessage` entre le localisateur (iframe) et le formulaire.
 *
 * @param {Window} win fenêtre du localisateur (`window` en production)
 * @param {{document?: Document}} [options]
 */
export function createEmbedBridge(win, options = {}) {
  const doc = options.document || win.document;
  const params = readEmbedParams(win.location && win.location.search);
  let searchHandler = null;
  let listening = false;

  function post(type, payload) {
    const parent = win.parent;
    if (!parent || parent === win || typeof parent.postMessage !== 'function') return false;
    try {
      parent.postMessage({ source: EMBED_SOURCE, type, payload: payload || null }, '*');
      return true;
    } catch {
      return false;
    }
  }

  function onMessage(event) {
    const data = event && event.data;
    if (!data || typeof data !== 'object' || data.source !== PARENT_SOURCE) return;
    if (data.type !== EMBED_TYPES.search) return;
    const payload = data.payload || {};
    const nom = typeof payload.nom === 'string' ? payload.nom.trim() : '';
    const codePostal = typeof payload.codePostal === 'string' ? payload.codePostal.trim() : '';
    if (typeof searchHandler === 'function') searchHandler({ nom, codePostal });
  }

  return {
    params,

    get active() { return params.active; },

    /** Prépare la page : classe `is-embed`, écoute des messages du parent. */
    init() {
      if (!params.active) return false;
      if (doc && doc.body) doc.body.classList.add('is-embed');
      if (doc) doc.documentElement.classList.add('is-embed');
      if (!listening && typeof win.addEventListener === 'function') {
        win.addEventListener('message', onMessage);
        listening = true;
      }
      post(EMBED_TYPES.ready);
      return true;
    },

    /** Enregistre l'action à lancer quand le formulaire demande une recherche. */
    onSearch(handler) { searchHandler = typeof handler === 'function' ? handler : null; },

    /** Demande au parent de relancer une recherche (nom + code postal modifiés). */
    requestSearch() { return post(EMBED_TYPES.search, { nom: params.nom, codePostal: params.codePostal }); },

    notifyReady() { return post(EMBED_TYPES.ready); },

    notifyResults(rows) {
      return post(EMBED_TYPES.results, { count: Array.isArray(rows) ? rows.length : 0, rows: resultsSummary(rows) });
    },

    notifyError(message) {
      return post(EMBED_TYPES.error, { message: String(message || '') });
    },

    notifySelection(fiche) {
      const payload = selectionPayload(fiche);
      if (!payload.siret) return false;
      return post(EMBED_TYPES.selected, payload);
    },

    /** Exposé pour les tests : détache l'écouteur. */
    dispose() {
      if (listening && typeof win.removeEventListener === 'function') {
        win.removeEventListener('message', onMessage);
        listening = false;
      }
      searchHandler = null;
    },
  };
}
