/**
 * storage.js — Persistance locale (LocalStorage) et rien d'autre.
 *
 * Responsabilité : lecture/écriture atomique et sûre dans LocalStorage,
 * paramètres utilisateur, historique (opt-in), fiches enregistrées,
 * photographies complémentaires ajoutées manuellement, adaptateur de cache.
 *
 * Principes de confidentialité appliqués :
 *  - aucun envoi réseau, jamais ;
 *  - l'historique est DÉSACTIVÉ par défaut (aucune collecte implicite) ;
 *  - les fiches enregistrées résultent toujours d'une action explicite ;
 *  - tout est purgeable depuis l'interface.
 *
 * Si LocalStorage est indisponible (navigation privée, quota), un magasin
 * mémoire prend le relais : l'application reste utilisable, sans persistance.
 */

import config from './config.js';
import { isBrowser } from './utils.js';

const NS = `${config.storage.namespace}:`;

/* ==================================================================== */
/* 1. Magasin bas niveau                                                 */
/* ==================================================================== */

const memoryFallback = new Map();
let persistent = false;

function detectStorage() {
  if (!isBrowser) return false;
  try {
    const probe = `${NS}__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
persistent = detectStorage();

export const storageAvailable = () => persistent;

export const store = {
  read(key) {
    try {
      const raw = persistent ? window.localStorage.getItem(NS + key) : memoryFallback.get(NS + key);
      if (raw == null) return undefined;
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  },

  write(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (persistent) window.localStorage.setItem(NS + key, raw);
      else memoryFallback.set(NS + key, raw);
      return true;
    } catch (error) {
      // Quota dépassé : on purge le cache (le plus volumineux) puis on réessaie.
      if (persistent && /quota/i.test(error?.name || '')) {
        purgeCache();
        try {
          window.localStorage.setItem(NS + key, raw);
          return true;
        } catch { /* échec définitif */ }
      }
      memoryFallback.set(NS + key, raw);
      return false;
    }
  },

  remove(key) {
    try {
      if (persistent) window.localStorage.removeItem(NS + key);
    } catch { /* ignoré */ }
    memoryFallback.delete(NS + key);
  },

  keys() {
    const out = [];
    if (persistent) {
      try {
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (key?.startsWith(NS)) out.push(key.slice(NS.length));
        }
      } catch { /* ignoré */ }
    }
    for (const key of memoryFallback.keys()) {
      const short = key.slice(NS.length);
      if (!out.includes(short)) out.push(short);
    }
    return out;
  },
};

/* ==================================================================== */
/* 2. Paramètres utilisateur                                             */
/* ==================================================================== */

const SETTINGS_KEY = 'settings';

const DEFAULT_SETTINGS = {
  historyEnabled: config.storage.historyEnabled,
  perPage: config.search.perPage,
  sort: 'pertinence',
  etat: 'A',
  fuzzyFallback: config.search.fuzzyFallback,
  streetProviders: config.imagery.streetProviders,
  streetRadiusM: config.imagery.streetRadiusM,
  defaultBaseLayer: config.map.defaultBaseLayer,
  autoOpenAerial: false,
};

const listeners = new Set();
let settingsCache = null;

export const settings = {
  get() {
    if (!settingsCache) settingsCache = { ...DEFAULT_SETTINGS, ...(store.read(SETTINGS_KEY) || {}) };
    return { ...settingsCache };
  },

  set(patch) {
    settingsCache = { ...settings.get(), ...patch };
    store.write(SETTINGS_KEY, settingsCache);
    for (const fn of listeners) fn(settings.get());
    return settings.get();
  },

  reset() {
    settingsCache = { ...DEFAULT_SETTINGS };
    store.write(SETTINGS_KEY, settingsCache);
    for (const fn of listeners) fn(settings.get());
    return settings.get();
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/* ==================================================================== */
/* 3. Historique (opt-in)                                                */
/* ==================================================================== */

const SEARCHES_KEY = 'history.searches';
const VIEWS_KEY = 'history.views';

function pushCapped(key, entry, max) {
  const list = store.read(key) || [];
  const filtered = list.filter((item) => item.signature !== entry.signature);
  filtered.unshift(entry);
  const capped = filtered.slice(0, max);
  store.write(key, capped);
  return capped;
}

export const history = {
  isEnabled: () => settings.get().historyEnabled === true,

  /** Mémorise une recherche (uniquement si l'utilisateur l'a autorisé). */
  addSearch({ criteria, totalResults = 0 }) {
    if (!history.isEnabled()) return null;
    const signature = JSON.stringify(criteria);
    return pushCapped(SEARCHES_KEY, {
      signature,
      criteria,
      totalResults,
      at: new Date().toISOString(),
    }, config.storage.historyMax);
  },

  /** Mémorise la consultation d'une fiche (métadonnées minimales). */
  addView({ siret, siren, nom, commune, codePostal }) {
    if (!history.isEnabled() || !siret) return null;
    return pushCapped(VIEWS_KEY, {
      signature: siret, siret, siren, nom, commune, codePostal, at: new Date().toISOString(),
    }, config.storage.historyMax);
  },

  listSearches: () => store.read(SEARCHES_KEY) || [],
  listViews: () => store.read(VIEWS_KEY) || [],

  removeSearch(signature) {
    store.write(SEARCHES_KEY, history.listSearches().filter((item) => item.signature !== signature));
  },

  removeView(siret) {
    store.write(VIEWS_KEY, history.listViews().filter((item) => item.siret !== siret));
  },

  clearSearches() { store.remove(SEARCHES_KEY); },
  clearViews() { store.remove(VIEWS_KEY); },
  clearAll() { history.clearSearches(); history.clearViews(); },
};

/* ==================================================================== */
/* 4. Fiches enregistrées (action explicite)                             */
/* ==================================================================== */

const FAVORITES_KEY = 'favorites';

export const favorites = {
  list: () => store.read(FAVORITES_KEY) || [],

  has(siret) {
    return favorites.list().some((item) => item.etablissement?.siret === siret);
  },

  /** `fiche` = { etablissement, entreprise, position, savedAt } */
  save(fiche) {
    const siret = fiche?.etablissement?.siret;
    if (!siret) return null;
    const list = favorites.list().filter((item) => item.etablissement?.siret !== siret);
    list.unshift({ ...fiche, savedAt: new Date().toISOString() });
    store.write(FAVORITES_KEY, list.slice(0, config.storage.favoritesMax));
    return list;
  },

  remove(siret) {
    store.write(FAVORITES_KEY, favorites.list().filter((item) => item.etablissement?.siret !== siret));
  },

  get(siret) {
    return favorites.list().find((item) => item.etablissement?.siret === siret) || null;
  },

  clear() { store.remove(FAVORITES_KEY); },
};

/* ==================================================================== */
/* 5. Photographies complémentaires vérifiées par l'utilisateur          */
/* ==================================================================== */

const PHOTOS_KEY = 'photos';

export const userPhotos = {
  list(siret) {
    const all = store.read(PHOTOS_KEY) || {};
    return all[siret] || [];
  },

  /** Une photo n'est acceptée que si une URL et une source sont fournies. */
  add(siret, { url, source, licence = '', date = '', note = '' }) {
    if (!siret || !url || !source) return null;
    const all = store.read(PHOTOS_KEY) || {};
    const list = all[siret] || [];
    const entry = {
      id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      url, source, licence, date, note, addedAt: new Date().toISOString(),
    };
    all[siret] = [entry, ...list].slice(0, 10);
    const total = Object.values(all).reduce((acc, arr) => acc + arr.length, 0);
    if (total > config.storage.photosMax) {
      // Purge des SIRET les plus anciens.
      for (const key of Object.keys(all).slice(0, Object.keys(all).length - config.storage.photosMax)) delete all[key];
    }
    store.write(PHOTOS_KEY, all);
    return entry;
  },

  remove(siret, id) {
    const all = store.read(PHOTOS_KEY) || {};
    all[siret] = (all[siret] || []).filter((photo) => photo.id !== id);
    if (!all[siret].length) delete all[siret];
    store.write(PHOTOS_KEY, all);
  },

  clear() { store.remove(PHOTOS_KEY); },
};

/* ==================================================================== */
/* 6. Cache & maintenance                                                */
/* ==================================================================== */

/** Adaptateur attendu par TtlCache (utils.js). */
export const cacheStore = store;

export function purgeCache() {
  for (const key of store.keys()) {
    if (key.startsWith('cache:')) store.remove(key);
  }
}

export function storageInfo() {
  const keys = store.keys();
  let bytes = 0;
  let cacheEntries = 0;
  for (const key of keys) {
    if (key.startsWith('cache:')) cacheEntries += 1;
    const value = store.read(key);
    if (value !== undefined) bytes += JSON.stringify(value).length + key.length + NS.length;
  }
  return {
    persistent,
    entries: keys.length,
    cacheEntries,
    bytes,
    kilobytes: Math.round(bytes / 102.4) / 10,
    searches: history.listSearches().length,
    views: history.listViews().length,
    favorites: favorites.list().length,
  };
}

/** Efface TOUTES les données locales de l'application (hors paramètres). */
export function purgeUserData() {
  history.clearAll();
  favorites.clear();
  userPhotos.clear();
  purgeCache();
}

/** Effacement total, paramètres inclus. */
export function purgeEverything() {
  for (const key of store.keys()) store.remove(key);
  settingsCache = null;
}
