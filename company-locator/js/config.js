/**
 * config.js — Configuration centralisée de l'outil Fiche Entreprise.
 *
 * Toutes les API listées sont publiques, gratuites et sans compte requis
 * (Mapillary reste optionnel via jeton côté serveur).
 */

import localOverrides from '../config.local.js';

const DEFAULTS = {
  app: {
    name: 'Company Locator France',
    version: '2.0.0',
    country: 'France',
    /** SIRET chargé automatiquement à l'ouverture si aucun paramètre d'URL n'est fourni. */
    defaultSiret: '88329230200014',
  },

  api: {
    /** Identification des entreprises — DINUM / Annuaire des Entreprises. */
    entreprises: {
      baseUrl: 'https://recherche-entreprises.api.gouv.fr',
      searchPath: '/search',
      minIntervalMs: 220,
      timeoutMs: 15000,
      retries: 2,
      retryBaseDelayMs: 700,
      cacheTtlMs: 6 * 60 * 60 * 1000,
    },

    /** Géocodage BAN via la Géoplateforme IGN. */
    geocoding: {
      baseUrl: 'https://data.geopf.fr/geocodage',
      searchPath: '/search',
      reversePath: '/reverse',
      minIntervalMs: 120,
      timeoutMs: 12000,
      retries: 2,
      retryBaseDelayMs: 600,
      cacheTtlMs: 30 * 24 * 60 * 60 * 1000,
      minScore: 0.5,
      preciseScore: 0.7,
      maxDivergenceM: 300,
    },

    /** Altimétrie IGN RGE ALTI (secours si Open-Meteo ne fournit pas l'altitude). */
    altimetry: {
      url: 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json',
      timeoutMs: 10000,
    },

    /** Fond cartographique Plan (Localisation). */
    osm: {
      tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OSM</a>',
    },

    /** Fond cartographique Plan IGN (repli). */
    planIgn: {
      wmtsUrl: 'https://data.geopf.fr/wmts',
      layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
      style: 'normal',
      format: 'image/png',
      tileMatrixSet: 'PM',
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener noreferrer">IGN</a>',
    },

    /** Photographies aériennes haute résolution — BD ORTHO® IGN (Vue satellite). */
    orthoIgn: {
      wmtsUrl: 'https://data.geopf.fr/wmts',
      layer: 'HR.ORTHOIMAGERY.ORTHOPHOTOS',
      fallbackLayer: 'ORTHOIMAGERY.ORTHOPHOTOS',
      style: 'normal',
      format: 'image/jpeg',
      tileMatrixSet: 'PM',
      minNativeZoom: 6,
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener noreferrer">IGN BD ORTHO</a>',
    },

    /** Photographies de rue — Panoramax (sans jeton, CORS ouvert). */
    panoramax: {
      enabled: true,
      baseUrl: 'https://api.panoramax.xyz/api',
      searchPath: '/search',
      viewerUrl: 'https://api.panoramax.xyz/',
      minIntervalMs: 250,
      timeoutMs: 14000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
    },

    /** Photographies de rue — Mapillary (jeton gratuit optionnel via server.js). */
    mapillary: {
      enabled: true,
      graphUrl: 'https://graph.mapillary.com',
      proxyPath: '/api/mapillary',
      clientToken: '',
      minIntervalMs: 300,
      timeoutMs: 14000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      viewerUrl: 'https://www.mapillary.com/app/',
    },
  },

  search: {
    perPage: 10,
    maxPerPage: 25,
    matchingLimit: 25,
    fuzzyFallback: true,
    maxListed: 100,
  },

  imagery: {
    streetRadiusM: 120,
    streetFallbackRadiusM: 300,
    maxStreetPhotos: 10,
    streetProviders: 'both',
    aerialZoom: 18,
  },

  map: {
    franceCenter: [46.603354, 2.385372],
    franceZoom: 5,
    planZoom: 12,
    /** Premier aperçu hors métropole (DROM) : vue régionale centrée sur le site. */
    overseasFirstZoom: 9,
    aerialZoom: 18,
  },

  storage: {
    namespace: 'clf',
    cacheMaxEntries: 120,
  },
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  if (!isPlainObject(source)) return target;
  const out = { ...target };
  for (const [key, value] of Object.entries(source)) {
    out[key] = isPlainObject(value) && isPlainObject(target[key])
      ? deepMerge(target[key], value)
      : value;
  }
  return out;
}

function deepFreeze(obj) {
  if (!isPlainObject(obj) && !Array.isArray(obj)) return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj)) deepFreeze(value);
  return obj;
}

export const config = deepFreeze(deepMerge(DEFAULTS, localOverrides || {}));
export default config;
