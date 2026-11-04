/**
 * geocoding.js — Géocodage Base Adresse Nationale via la Géoplateforme IGN.
 *
 * Endpoint : https://data.geopf.fr/geocodage/search  (sans clé, CORS ouvert)
 * L'ancien api-adresse.data.gouv.fr est décommissionné depuis le 31/01/2026 :
 * il n'est donc plus utilisé.
 *
 * Responsabilité : transformer une adresse en coordonnées, retrouver un code
 * commune INSEE depuis un nom de ville, faire du géocodage inverse, et surtout
 * ÉVALUER LA FIABILITÉ de la position affichée (niveau adresse / voie / commune,
 * écart entre la position SIRENE et la position BAN).
 *
 * Aucune position n'est inventée : sans donnée exploitable, on renvoie une
 * erreur explicite.
 */

import config from './config.js';
import {
  AppError, ERR, RateLimiter, TtlCache, haversineM,
  isPlausibleFranceCoords, normalizeText, parseCoord, clamp,
} from './utils.js';
import { cacheStore } from './storage.js';
import { fetchServiceJson } from './transport.js';

const CFG = config.api.geocoding;
const limiter = new RateLimiter(CFG.minIntervalMs);
const cache = new TtlCache({
  store: cacheStore, prefix: 'cache:geo:', ttlMs: CFG.cacheTtlMs, maxEntries: config.storage.cacheMaxEntries,
});

export const SOURCE_BAN = 'Base Adresse Nationale / Géoplateforme IGN';
export const SOURCE_BAN_URL = 'https://data.geopf.fr/geocodage/search';
export const SOURCE_SIRENE = 'Géolocalisation SIRENE (via API Recherche d\'entreprises)';

export const PRECISION = {
  ADRESSE: 'adresse',
  VOIE: 'voie',
  COMMUNE: 'commune',
  SIRENE: 'sirene',
  INCONNUE: 'inconnue',
};

const PRECISION_LABELS = {
  adresse: 'Niveau adresse (numéro + voie)',
  voie: 'Niveau voie (numéro inconnu)',
  commune: 'Niveau commune (approximatif)',
  sirene: 'Position SIRENE (précision non garantie)',
  inconnue: 'Précision inconnue',
};

export const precisionLabel = (level) => PRECISION_LABELS[level] || PRECISION_LABELS.inconnue;

/* ==================================================================== */
/* 1. Nettoyage de requête                                               */
/* ==================================================================== */

/** Retire les mentions postales qui perturbent le géocodeur. */
export function cleanAddressQuery(value) {
  return String(value ?? '')
    .replace(/\b(CS|BP|TS|CEDEX)\b\s*\d*/gi, ' ')
    .replace(/\bLIEU[\s-]?DIT\b/gi, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeFeature(feature) {
  if (!feature?.geometry?.coordinates) return null;
  const [lon, lat] = feature.geometry.coordinates.map(parseCoord);
  const props = feature.properties || {};
  if (!isPlausibleFranceCoords(lat, lon)) return null;
  return {
    lat,
    lon,
    label: props.label || props.name || '',
    score: Number(props.score) || 0,
    type: props.type || props._type || '',
    id: props.id || props.banid || '',
    housenumber: props.housenumber || '',
    street: props.street || props.name || '',
    postcode: props.postcode || '',
    city: props.city || '',
    citycode: props.citycode || '',
    context: props.context || '',
    positionType: props.type_position || '',
    positionSource: props.source_position || '',
    certified: props.certification_commune === true || props.certification_commune === 'true',
    source: SOURCE_BAN,
  };
}

/* ==================================================================== */
/* 2. Géocodage direct                                                   */
/* ==================================================================== */

/**
 * @param {string} query adresse libre
 * @param {object} options { postcode, citycode, limit, signal, autocomplete }
 * @returns {Promise<Array>} candidats BAN triés par score décroissant
 */
export async function geocodeAddress(query, options = {}) {
  const cleaned = cleanAddressQuery(query);
  if (!cleaned || cleaned.length < 3) return [];

  const params = new URLSearchParams({
    q: cleaned,
    limit: String(clamp(Number(options.limit) || 3, 1, 10)),
    autocomplete: options.autocomplete === false ? '0' : '0',
  });
  if (options.postcode) params.set('postcode', String(options.postcode));
  if (options.citycode) params.set('citycode', String(options.citycode));

  const url = `${CFG.baseUrl}${CFG.searchPath}?${params}`;
  const raw = await cache.wrap(params.toString(), () => fetchServiceJson('geocoding', url, {
    timeoutMs: CFG.timeoutMs,
    retries: CFG.retries,
    retryBaseDelayMs: CFG.retryBaseDelayMs,
    limiter,
    signal: options.signal || null,
    label: 'service de géocodage IGN',
  }));

  const features = Array.isArray(raw?.features) ? raw.features : [];
  return features.map(normalizeFeature).filter(Boolean).sort((a, b) => b.score - a.score);
}

/** Géocodage inverse : quelle adresse se trouve à ces coordonnées ? */
export async function reverseGeocode(lat, lon, { signal = null } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), limit: '1' });
  const url = `${CFG.baseUrl}${CFG.reversePath}?${params}`;
  const raw = await cache.wrap(`rev:${lat.toFixed(6)},${lon.toFixed(6)}`, () => fetchServiceJson('geocoding', url, {
    timeoutMs: CFG.timeoutMs, retries: 1, limiter, signal, label: 'service de géocodage inverse IGN',
  }));
  return normalizeFeature(raw?.features?.[0]) || null;
}

/**
 * Retrouve le code commune INSEE d'une ville (filtre `code_commune` de l'API
 * entreprises, bien plus fiable qu'un nom de ville en texte libre).
 */
export async function resolveCommune(ville, { codePostal = '', signal = null } = {}) {
  const name = String(ville ?? '').trim();
  if (name.length < 2) return null;
  const params = new URLSearchParams({ q: name, limit: '5', type: 'municipality', autocomplete: '0' });
  if (codePostal) params.set('postcode', codePostal);
  const url = `${CFG.baseUrl}${CFG.searchPath}?${params}`;
  const raw = await cache.wrap(`commune:${params}`, () => fetchServiceJson('geocoding', url, {
    timeoutMs: CFG.timeoutMs, retries: 1, limiter, signal, label: 'service de géocodage IGN',
  }));
  const candidates = (raw?.features || []).map(normalizeFeature).filter(Boolean);
  if (!candidates.length) return null;
  // Priorité : code postal exact, puis meilleur score, puis nom identique.
  const target = normalizeText(name);
  candidates.sort((a, b) => {
    const cpA = codePostal && a.postcode === codePostal ? 1 : 0;
    const cpB = codePostal && b.postcode === codePostal ? 1 : 0;
    if (cpA !== cpB) return cpB - cpA;
    const nameA = normalizeText(a.city) === target ? 1 : 0;
    const nameB = normalizeText(b.city) === target ? 1 : 0;
    if (nameA !== nameB) return nameB - nameA;
    return b.score - a.score;
  });
  const best = candidates[0];
  return {
    codeCommune: best.citycode,
    commune: best.city,
    codePostal: best.postcode,
    lat: best.lat,
    lon: best.lon,
    label: best.label,
    context: best.context,
  };
}

/* ==================================================================== */
/* 3. Résolution de la position d'un établissement                       */
/* ==================================================================== */

/**
 * Détermine la meilleure position disponible et sa fiabilité.
 *
 * Stratégie (aucune invention de coordonnées) :
 *  1. position SIRENE fournie par l'API entreprises (souvent géocodée BAN) ;
 *  2. géocodage BAN de l'adresse déclarée ;
 *  3. si BAN atteint le niveau numéro de voie avec un bon score → BAN gagne ;
 *  4. sinon, si SIRENE disponible → SIRENE, avec avertissement ;
 *  5. sinon BAN niveau voie/commune, avec avertissement explicite ;
 *  6. sinon → erreur NO_COORDS.
 *
 * @returns {Promise<object>} position qualifiée
 */
export async function resolvePosition(etablissement, options = {}) {
  const sireneLat = parseCoord(etablissement?.latitude);
  const sireneLon = parseCoord(etablissement?.longitude);
  const hasSirene = isPlausibleFranceCoords(sireneLat, sireneLon);

  const query = options.adresseOverride
    || etablissement?.geoAdresse
    || etablissement?.adresse
    || '';

  let candidates = [];
  let banError = null;
  if (query && !etablissement?.nonDiffusible) {
    try {
      candidates = await geocodeAddress(query, {
        postcode: etablissement?.codePostal || '',
        citycode: etablissement?.codeCommune || '',
        limit: 3,
        signal: options.signal || null,
      });
    } catch (error) {
      banError = error;
    }
  }

  // Un candidat BAN dont le code postal ne correspond pas est écarté.
  const cp = etablissement?.codePostal;
  const filtered = cp ? candidates.filter((c) => !c.postcode || c.postcode === cp) : candidates;
  const usable = (filtered.length ? filtered : candidates).filter((c) => c.score >= CFG.minScore);
  const best = usable[0] || null;

  const base = {
    sirene: hasSirene ? { lat: sireneLat, lon: sireneLon } : null,
    ban: best,
    banCandidates: usable,
    banError: banError ? banError.userMessage || banError.message : null,
    divergenceM: null,
    warnings: [],
  };

  if (hasSirene && best) {
    base.divergenceM = Math.round(haversineM(sireneLat, sireneLon, best.lat, best.lon));
  }

  // Cas 1 : géocodage BAN au numéro de voie, score suffisant.
  if (best && best.type === 'housenumber' && best.score >= CFG.preciseScore) {
    const confirmedBySirene = Boolean(etablissement?.geoId) && etablissement.geoId === best.id;
    if (base.divergenceM != null && base.divergenceM > CFG.maxDivergenceM) {
      base.warnings.push(
        `La position SIRENE et l'adresse géocodée BAN sont distantes de ${base.divergenceM} m. `
        + 'La position BAN (niveau numéro de voie) est affichée ; vérifiez l\'adresse déclarée.',
      );
    }
    return {
      ...base,
      lat: best.lat,
      lon: best.lon,
      precision: PRECISION.ADRESSE,
      confidence: confirmedBySirene ? 'haute' : (best.score >= 0.8 ? 'haute' : 'moyenne'),
      source: confirmedBySirene ? `${SOURCE_BAN} (confirmée par le géocodage SIRENE)` : SOURCE_BAN,
      sourceUrl: SOURCE_BAN_URL,
      label: best.label,
      score: best.score,
      note: confirmedBySirene
        ? 'Adresse géocodée au numéro de voie et identifiée par l\'INSEE dans SIRENE.'
        : 'Adresse géocodée au numéro de voie par la Base Adresse Nationale.',
    };
  }

  // Cas 2 : position SIRENE disponible, BAN moins précis ou absent.
  if (hasSirene) {
    const precision = etablissement?.geoAdresse ? PRECISION.ADRESSE : PRECISION.SIRENE;
    if (base.divergenceM != null && base.divergenceM > CFG.maxDivergenceM) {
      base.warnings.push(
        `Écart de ${base.divergenceM} m entre la position SIRENE et le meilleur résultat BAN `
        + `(${best.label}, score ${best.score.toFixed(2)}). Position SIRENE conservée.`,
      );
    }
    if (!best && !banError) {
      base.warnings.push('L\'adresse déclarée n\'a pas pu être géocodée par la BAN : position SIRENE utilisée telle quelle.');
    }
    return {
      ...base,
      lat: sireneLat,
      lon: sireneLon,
      precision,
      confidence: precision === PRECISION.ADRESSE ? 'moyenne' : 'faible',
      source: SOURCE_SIRENE,
      sourceUrl: 'https://recherche-entreprises.api.gouv.fr/docs/',
      label: etablissement?.geoAdresse || etablissement?.adresse || '',
      score: null,
      note: precision === PRECISION.ADRESSE
        ? 'Position SIRENE associée à une adresse géocodée (champ geo_adresse de l\'API).'
        : 'Position issue de la base SIRENE : elle peut correspondre au centre de la commune ou de la voie.',
    };
  }

  // Cas 3 : uniquement un résultat BAN imprécis.
  if (best) {
    const precision = best.type === 'street' ? PRECISION.VOIE : PRECISION.COMMUNE;
    base.warnings.push(
      precision === PRECISION.VOIE
        ? 'Le numéro de voie n\'a pas été retrouvé : le marqueur est placé sur la rue, pas sur le bâtiment.'
        : 'Seule la commune a été retrouvée : le marqueur est placé au centre de la commune, pas sur le bâtiment.',
    );
    return {
      ...base,
      lat: best.lat,
      lon: best.lon,
      precision,
      confidence: 'faible',
      source: SOURCE_BAN,
      sourceUrl: SOURCE_BAN_URL,
      label: best.label,
      score: best.score,
      note: 'Géocodage BAN partiel : la position ne désigne pas le bâtiment exact.',
    };
  }

  // Cas 4 : rien d'exploitable.
  throw new AppError('Aucune coordonnée exploitable', {
    code: ERR.NO_COORDS,
    userMessage: etablissement?.nonDiffusible
      ? 'Cet établissement est non diffusible : l\'INSEE ne publie pas son adresse, aucune localisation n\'est possible.'
      : (banError
        ? `Coordonnées indisponibles : la base SIRENE ne fournit pas de position et le géocodage a échoué (${banError}).`
        : 'Coordonnées indisponibles : ni la base SIRENE ni la Base Adresse Nationale ne permettent de localiser cette adresse.'),
    details: { siret: etablissement?.siret, query },
  });
}

/** Test de disponibilité réel du géocodeur. */
export async function ping({ signal = null } = {}) {
  const started = Date.now();
  const results = await geocodeAddress('20 avenue de Segur 75007 Paris', { limit: 1, signal });
  return { ok: results.length > 0, latencyMs: Date.now() - started };
}

export function clearGeocodingCache() {
  cache.clearMemory();
}

export const geocodingInternals = { cleanAddressQuery, normalizeFeature };
