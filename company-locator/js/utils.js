/**
 * utils.js — Boîte à outils transverses, sans dépendance applicative.
 *
 * Responsabilité : appels HTTP robustes (timeout, retries, backoff, quota),
 * limitation de débit, cache TTL, validations SIREN/SIRET/code postal,
 * calculs géographiques, formatage et helpers DOM.
 *
 * Ce module est importable dans Node (tests unitaires) : aucun accès au DOM
 * n'est effectué au chargement, uniquement à l'appel des fonctions concernées.
 */

export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

/* ==================================================================== */
/* 1. Erreurs typées                                                     */
/* ==================================================================== */

export const ERR = {
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  HTTP_CLIENT: 'HTTP_CLIENT',
  HTTP_SERVER: 'HTTP_SERVER',
  PARSE: 'PARSE',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  NO_COORDS: 'NO_COORDS',
  NO_TOKEN: 'NO_TOKEN',
  ABORTED: 'ABORTED',
  STORAGE: 'STORAGE',
};

/** Erreur applicative : `message` technique + `userMessage` affichable. */
export class AppError extends Error {
  constructor(message, { code = ERR.NETWORK, status = 0, userMessage = '', retryable = false, details = null, cause = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.userMessage = userMessage || message;
    this.retryable = retryable;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

/** Transforme n'importe quelle exception en message français affichable. */
export function toUserMessage(error) {
  if (!error) return 'Erreur inconnue.';
  if (error instanceof AppError) return error.userMessage;
  if (error.name === 'AbortError') return 'Requête annulée.';
  return error.message || 'Erreur inattendue.';
}

/* ==================================================================== */
/* 2. Helpers génériques                                                 */
/* ==================================================================== */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function debounce(fn, wait = 250) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/** Minuscules, sans accents, ponctuation réduite : comparaisons de noms. */
export function normalizeText(value) {
  if (value == null) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

export function uniqBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function truncate(text, max = 120) {
  const str = String(text ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/** Distance de Levenshtein (bornée) pour la recherche approximative. */
export function levenshtein(a, b) {
  const s = normalizeText(a);
  const t = normalizeText(b);
  if (s === t) return 0;
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= t.length; j += 1) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[t.length];
}

/** Similarité 0→1 entre deux libellés (1 = identique après normalisation). */
export function similarity(a, b) {
  const s = normalizeText(a);
  const t = normalizeText(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  const distance = levenshtein(s, t);
  return Math.max(0, 1 - distance / Math.max(s.length, t.length));
}

/* ==================================================================== */
/* 3. Identifiants administratifs français                               */
/* ==================================================================== */

/** Algorithme de Luhn (utilisé par l'INSEE pour SIREN et SIRET). */
export function luhnValid(digits) {
  const str = String(digits);
  if (!/^\d+$/.test(str)) return false;
  let sum = 0;
  for (let i = 0; i < str.length; i += 1) {
    // On double un chiffre sur deux en partant de la droite.
    let value = Number(str[str.length - 1 - i]);
    if (i % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return sum % 10 === 0;
}

/** SIREN : 9 chiffres + clé de Luhn (exception La Poste). */
export function isValidSiren(value) {
  const s = digitsOnly(value);
  if (s.length !== 9) return false;
  if (s === '356000000') return true; // La Poste : dérogation officielle
  return luhnValid(s);
}

/** SIRET : 14 chiffres + Luhn (La Poste : somme des chiffres multiple de 5). */
export function isValidSiret(value) {
  const s = digitsOnly(value);
  if (s.length !== 14) return false;
  if (s.startsWith('356000000')) {
    const sum = s.split('').reduce((acc, d) => acc + Number(d), 0);
    return sum % 5 === 0;
  }
  return luhnValid(s);
}

/**
 * Code postal français accepté par l'API Recherche d'entreprises.
 * Repris du validateur officiel : 01→98, plus préfixes Corse 2A/2B.
 */
export function isValidCodePostal(value) {
  return /^((0[1-9])|([1-8][0-9])|(9[0-8])|(2A)|(2B))[0-9]{3}$/.test(String(value ?? '').trim().toUpperCase());
}

export function formatSiren(value) {
  const s = digitsOnly(value);
  return s.length === 9 ? `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}` : s;
}

export function formatSiret(value) {
  const s = digitsOnly(value);
  return s.length === 14 ? `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9)}` : s;
}

/** Département français à partir d'un code postal ou d'un code commune INSEE. */
export function departmentFromCode(codePostal, codeCommune) {
  const cp = String(codePostal ?? '').trim().toUpperCase();
  if (cp.length === 5) {
    if (cp.startsWith('20')) {
      // Corse : 200xx/201xx → 2A, 202xx+ → 2B (règle usuelle, vérifiée via INSEE).
      const insee = String(codeCommune ?? '');
      if (insee.startsWith('2A')) return '2A';
      if (insee.startsWith('2B')) return '2B';
      return Number(cp.slice(0, 5)) < 20200 ? '2A' : '2B';
    }
    if (cp.startsWith('97') || cp.startsWith('98')) return cp.slice(0, 3);
    return cp.slice(0, 2);
  }
  const insee = String(codeCommune ?? '');
  if (/^2[AB]\d{3}$/.test(insee)) return insee.slice(0, 2);
  if (/^97\d{3}$/.test(insee)) return insee.slice(0, 3);
  if (/^\d{5}$/.test(insee)) return insee.slice(0, 2);
  return '';
}

/* ==================================================================== */
/* 4. Géographie                                                         */
/* ==================================================================== */

/** Distance en mètres entre deux points WGS84 (formule de haversine). */
export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371008.8; // rayon moyen terrestre (m)
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Coordonnées valides et situées dans l'emprise France (métropole + DROM). */
export function isPlausibleFranceCoords(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  // Emprise large : métropole, Corse, DROM, Saint-Pierre-et-Miquelon, Mayotte…
  const boxes = [
    [41.3, 51.15, -5.2, 9.6], // métropole + Corse (Bray-Dunes ≈ 51,09 N)
    [12.5, 18.6, -64.5, -57.0], // Antilles / Guyane élargi
    [2.0, 6.5, -55.0, -50.5], // Guyane
    [-21.8, -20.5, 55.0, 56.0], // La Réunion
    [-13.2, -12.4, 44.8, 45.5], // Mayotte
    [46.6, 47.3, -56.6, -56.0], // Saint-Pierre-et-Miquelon
  ];
  return boxes.some(([latMin, latMax, lonMin, lonMax]) => lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax);
}

export function formatCoords(lat, lon, digits = 6) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${lat.toFixed(digits)}, ${lon.toFixed(digits)}`;
}

/** Bounding box autour d'un point (approximation locale, suffisante < 5 km). */
export function bboxAround(lat, lon, radiusM) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]; // [ouest, sud, est, nord]
}

export function parseCoord(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/* ==================================================================== */
/* 5. Formatage                                                          */
/* ==================================================================== */

export function formatDateFr(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTimeFr(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatNumberFr(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('fr-FR') : '';
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Nettoie une URL destinée à un attribut href/src (bloque javascript:, data:…). */
export function safeUrl(value, { allowData = false } = {}) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  try {
    const url = new URL(str, isBrowser ? window.location.href : 'https://local.invalid/');
    const allowed = allowData ? ['http:', 'https:', 'data:'] : ['http:', 'https:'];
    return allowed.includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

/* ==================================================================== */
/* 6. Limitation de débit                                                */
/* ==================================================================== */

/**
 * File d'attente garantissant un intervalle minimal entre deux appels.
 * Indispensable pour respecter les quotas publics (7 req/s, 50 req/s…).
 */
export class RateLimiter {
  constructor(minIntervalMs = 200) {
    this.minIntervalMs = minIntervalMs;
    this.lastCall = 0;
    this.queue = Promise.resolve();
  }

  schedule(task) {
    const run = async () => {
      const wait = this.lastCall + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCall = Date.now();
      return task();
    };
    const result = this.queue.then(run, run);
    // La file ne doit jamais rester rejetée.
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

/* ==================================================================== */
/* 7. HTTP robuste                                                       */
/* ==================================================================== */

function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(headerValue);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

/**
 * GET JSON avec timeout, tentatives de reprise et respect de Retry-After.
 * @returns {Promise<any>} corps JSON
 * @throws {AppError} erreur typée avec message utilisateur en français
 */
export async function fetchJson(url, options = {}) {
  const {
    timeoutMs = 15000,
    retries = 2,
    retryBaseDelayMs = 600,
    limiter = null,
    signal = null,
    headers = {},
    label = 'service',
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'AbortError')), timeoutMs);
    const onAbort = () => controller.abort(new DOMException('Annulé', 'AbortError'));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const request = () => fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow',
      });
      const response = limiter ? await limiter.schedule(request) : await request();

      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After')) ?? retryBaseDelayMs * (attempt + 1) * 2;
        lastError = new AppError(`${label} : quota atteint (429)`, {
          code: ERR.RATE_LIMIT,
          status: 429,
          retryable: true,
          userMessage: `Le ${label} limite temporairement les requêtes. Nouvelle tentative automatique…`,
          details: { retryAfter },
        });
        if (attempt < retries) {
          await sleep(Math.min(retryAfter, 8000));
          continue;
        }
        throw lastError;
      }

      if (response.status === 404) {
        throw new AppError(`${label} : ressource introuvable (404)`, {
          code: ERR.NOT_FOUND, status: 404, userMessage: `Aucune donnée trouvée auprès du ${label}.`,
        });
      }

      if (response.status >= 500) {
        lastError = new AppError(`${label} : erreur serveur (${response.status})`, {
          code: ERR.HTTP_SERVER, status: response.status, retryable: true,
          userMessage: `Le ${label} est momentanément indisponible (erreur ${response.status}).`,
        });
        if (attempt < retries) {
          await sleep(retryBaseDelayMs * 2 ** attempt + Math.random() * 250);
          continue;
        }
        throw lastError;
      }

      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.json();
          detail = body?.detail || body?.message || body?.error || '';
          if (typeof detail === 'object') detail = JSON.stringify(detail);
        } catch { /* corps non JSON : ignoré */ }
        throw new AppError(`${label} : requête refusée (${response.status}) ${detail}`, {
          code: ERR.HTTP_CLIENT, status: response.status,
          userMessage: detail
            ? `Le ${label} a refusé la requête : ${truncate(detail, 220)}`
            : `Le ${label} a refusé la requête (erreur ${response.status}).`,
          details: { url },
        });
      }

      try {
        return await response.json();
      } catch (error) {
        throw new AppError(`${label} : réponse illisible`, {
          code: ERR.PARSE, userMessage: `Réponse inattendue du ${label}.`, cause: error,
        });
      }
    } catch (error) {
      if (error instanceof AppError) {
        if (!error.retryable || attempt >= retries) throw error;
        lastError = error;
      } else if (error?.name === 'AbortError') {
        if (signal?.aborted) {
          throw new AppError('Requête annulée', { code: ERR.ABORTED, userMessage: 'Recherche annulée.' });
        }
        lastError = new AppError(`${label} : délai dépassé`, {
          code: ERR.TIMEOUT, retryable: true,
          userMessage: `Le ${label} met trop de temps à répondre. Vérifiez votre connexion.`,
        });
        if (attempt >= retries) throw lastError;
      } else {
        lastError = new AppError(`${label} : échec réseau (${error?.message || 'fetch'})`, {
          code: ERR.NETWORK, retryable: true, cause: error,
          userMessage: `Impossible de joindre le ${label}. Vérifiez votre connexion Internet.`,
        });
        if (attempt >= retries) throw lastError;
      }
      await sleep(retryBaseDelayMs * 2 ** attempt + Math.random() * 200);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  throw lastError || new AppError(`${label} : échec inconnu`, { code: ERR.NETWORK });
}

/* ==================================================================== */
/* 8. Cache TTL (mémoire + magasin persistant optionnel)                 */
/* ==================================================================== */

/**
 * Cache à deux niveaux : mémoire (rapide) et magasin persistant optionnel
 * (LocalStorage via storage.js). `store` doit exposer read/write/remove/keys.
 */
export class TtlCache {
  constructor({ store = null, prefix = 'cache:', ttlMs = 3600000, maxEntries = 200 } = {}) {
    this.store = store;
    this.prefix = prefix;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.memory = new Map();
    this.pending = new Map();
  }

  _key(key) { return `${this.prefix}${key}`; }

  get(key) {
    const now = Date.now();
    const mem = this.memory.get(key);
    if (mem) {
      if (mem.expires > now) return mem.value;
      this.memory.delete(key);
    }
    if (!this.store) return undefined;
    const stored = this.store.read(this._key(key));
    if (stored && stored.expires > now) {
      this.memory.set(key, stored);
      return stored.value;
    }
    if (stored) this.store.remove(this._key(key));
    return undefined;
  }

  set(key, value, ttlMs = this.ttlMs) {
    const entry = { value, expires: Date.now() + ttlMs, storedAt: Date.now() };
    this.memory.set(key, entry);
    if (this.memory.size > this.maxEntries) {
      const oldest = this.memory.keys().next().value;
      this.memory.delete(oldest);
    }
    if (this.store) {
      this.store.write(this._key(key), entry);
      this._prune();
    }
    return value;
  }

  _prune() {
    if (!this.store) return;
    const keys = this.store.keys().filter((k) => k.startsWith(this.prefix));
    if (keys.length <= this.maxEntries) return;
    const entries = keys
      .map((k) => ({ key: k, storedAt: this.store.read(k)?.storedAt ?? 0 }))
      .sort((a, b) => a.storedAt - b.storedAt);
    for (const entry of entries.slice(0, keys.length - this.maxEntries)) this.store.remove(entry.key);
  }

  /** Renvoie la valeur en cache ou exécute `producer` (dédoublonné). */
  async wrap(key, producer, ttlMs = this.ttlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = (async () => {
      try {
        const value = await producer();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, promise);
    return promise;
  }

  clearMemory() { this.memory.clear(); }
}

/* ==================================================================== */
/* 9. Helpers navigateur (DOM, presse-papiers, téléchargement)           */
/* ==================================================================== */

/** Création d'élément DOM sans innerHTML (sûr par construction). */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = value; // réservé aux fragments internes maîtrisés
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function icon(name, extraClass = '') {
  return el('span', { class: `icon icon--${name}${extraClass ? ` ${extraClass}` : ''}`, 'aria-hidden': 'true' });
}

export function clear(node) {
  while (node?.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Copie presse-papiers avec repli pour les contextes non sécurisés (http local). */
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* on tente le repli */ }
  try {
    const area = el('textarea', { value, style: 'position:fixed;top:-1000px;opacity:0' });
    area.value = value;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Déclenche le téléchargement d'un fichier texte côté navigateur. */
export function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Nom de fichier sûr (pas de caractère interdit sous Windows). */
export function slugifyFilename(value, fallback = 'export') {
  const slug = normalizeText(value).replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 60);
  return slug || fallback;
}

export function timestampForFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}
