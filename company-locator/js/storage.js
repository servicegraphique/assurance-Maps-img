/**
 * storage.js — Persistance locale (LocalStorage avec repli mémoire).
 *
 * Conserve sur l'appareil :
 *  - le cache TTL des requêtes publiques (`cache:*`) ;
 *  - les coordonnées de contact par SIRET (`contacts`, utilisées aussi en mode `?embed=1`) ;
 *  - les données CRM saisies par SIRET (`sheets` : acheteur, site web, commentaires,
 *    qualifications, demande de devis, RAC, Prelead, Génération de lead, mise en relation) ;
 *  - les préférences d'interface minimales (`ui` : barre de recherche masquée, dernier SIRET).
 */

import config from './config.js';
import { isBrowser } from './utils.js';

const NS = `${config.storage.namespace}:`;
const memoryFallback = new Map();

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

const persistent = detectStorage();
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
      if (persistent && /quota/i.test(error?.name || '')) {
        purgeCache();
        try {
          window.localStorage.setItem(NS + key, raw);
          return true;
        } catch { /* quota plein */ }
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

export const cacheStore = store;

/* ==================================================================== */
/* 1. Coordonnées de contact par SIRET (compatibilité formulaire TNS)    */
/* ==================================================================== */

const CONTACTS_KEY = 'contacts';

export const userContacts = {
  get(siret) {
    if (!siret) return null;
    const all = store.read(CONTACTS_KEY) || {};
    return all[siret] || null;
  },

  save(siret, record) {
    if (!siret || !record) return null;
    const all = store.read(CONTACTS_KEY) || {};
    all[siret] = record;
    store.write(CONTACTS_KEY, all);
    return record;
  },

  remove(siret) {
    const all = store.read(CONTACTS_KEY) || {};
    if (!all[siret]) return;
    delete all[siret];
    store.write(CONTACTS_KEY, all);
  },

  list() {
    const all = store.read(CONTACTS_KEY) || {};
    return Object.entries(all).map(([siret, contact]) => ({ siret, ...contact }));
  },

  clear() { store.remove(CONTACTS_KEY); },
};

/* ==================================================================== */
/* 2. Fiche CRM locale par SIRET                                         */
/* ==================================================================== */

const SHEETS_KEY = 'sheets';

/** Génère un identifiant numérique déterministe à 7 chiffres depuis le SIRET. */
export function defaultQuoteId(siret) {
  const digits = String(siret ?? '').replace(/\D/g, '');
  if (!digits) return '3800001';
  let hash = 2166136261;
  for (let i = 0; i < digits.length; i += 1) {
    hash ^= digits.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const num = 3000000 + (Math.abs(hash) % 6999999);
  return String(num);
}

export const crmSheets = {
  get(siret) {
    if (!siret) return null;
    const all = store.read(SHEETS_KEY) || {};
    return all[siret] ? structuredCloneSafe(all[siret]) : null;
  },

  patch(siret, partial) {
    if (!siret || !partial || typeof partial !== 'object') return null;
    const all = store.read(SHEETS_KEY) || {};
    const current = all[siret] || {};
    const next = {
      ...current,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    all[siret] = next;
    store.write(SHEETS_KEY, all);
    return structuredCloneSafe(next);
  },

  addComment(siret, { text, author = 'hellodevis_28', at = null }) {
    const body = String(text ?? '').trim();
    if (!siret || !body) return null;
    const current = crmSheets.get(siret) || {};
    const comments = Array.isArray(current.comments) ? current.comments : [];
    const entry = {
      id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      author: String(author || 'hellodevis_28').trim().slice(0, 40),
      text: body.slice(0, 500),
      at: at || new Date().toISOString(),
    };
    return crmSheets.patch(siret, { comments: [entry, ...comments].slice(0, 30) });
  },

  addEvent(siret, listKey, { label, detail = '', author = 'hellodevis_28' }) {
    if (!siret || !label) return null;
    const current = crmSheets.get(siret) || {};
    const list = Array.isArray(current[listKey]) ? current[listKey] : [];
    const entry = {
      id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      label: String(label).trim().slice(0, 140),
      detail: String(detail).trim().slice(0, 300),
      author: String(author || 'hellodevis_28').trim().slice(0, 40),
      at: new Date().toISOString(),
    };
    return crmSheets.patch(siret, { [listKey]: [entry, ...list].slice(0, 40) });
  },

  remove(siret) {
    const all = store.read(SHEETS_KEY) || {};
    if (!all[siret]) return;
    delete all[siret];
    store.write(SHEETS_KEY, all);
  },

  clear() { store.remove(SHEETS_KEY); },
};

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ==================================================================== */
/* 3. Préférences d'interface minimales                                  */
/* ==================================================================== */

const UI_KEY = 'ui';

export const uiPrefs = {
  get() {
    return { searchCollapsed: false, lastSiret: '', ...(store.read(UI_KEY) || {}) };
  },
  set(patch) {
    const next = { ...uiPrefs.get(), ...patch };
    store.write(UI_KEY, next);
    return next;
  },
};

/* ==================================================================== */
/* 4. Maintenance                                                        */
/* ==================================================================== */

export function purgeCache() {
  for (const key of store.keys()) {
    if (key.startsWith('cache:')) store.remove(key);
  }
}

export function purgeEverything() {
  for (const key of store.keys()) store.remove(key);
}
