/**
 * config.js — Configuration centralisée de Company Locator France.
 *
 * Responsabilité unique : décrire les points d'accès aux services, les limites
 * de débit, les durées de cache et les valeurs par défaut de l'interface.
 *
 * Aucune valeur secrète ne doit être placée ici : ce fichier est public.
 * Pour Mapillary, voir `config.local.js` (jeton client) ou, mieux, le proxy
 * local `server.js` qui garde le jeton côté serveur.
 *
 * Toute valeur peut être surchargée dans `config.local.js` (fusion profonde).
 */

import localOverrides from '../config.local.js';

/** Valeurs par défaut — toutes les API listées sont gratuites et sans compte. */
const DEFAULTS = {
  app: {
    name: 'Company Locator France',
    version: '1.0.0',
    /** Zone de recherche : France uniquement. */
    country: 'France',
    debug: false,
  },

  api: {
    /** A. Identification des entreprises — DINUM / Annuaire des Entreprises. */
    entreprises: {
      baseUrl: 'https://recherche-entreprises.api.gouv.fr',
      searchPath: '/search',
      /** Limite officielle : 7 appels/seconde. On reste volontairement en dessous. */
      minIntervalMs: 220,
      timeoutMs: 15000,
      retries: 2,
      retryBaseDelayMs: 700,
      cacheTtlMs: 6 * 60 * 60 * 1000, // 6 h
    },

    /** B. Géocodage — Base Adresse Nationale servie par la Géoplateforme IGN.
     *  NB : api-adresse.data.gouv.fr est décommissionné depuis le 31/01/2026. */
    geocoding: {
      baseUrl: 'https://data.geopf.fr/geocodage',
      searchPath: '/search',
      reversePath: '/reverse',
      /** Limite officielle : 50 requêtes/seconde par IP. */
      minIntervalMs: 120,
      timeoutMs: 12000,
      retries: 2,
      retryBaseDelayMs: 600,
      cacheTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 jours
      /** Score minimal BAN pour considérer un résultat exploitable. */
      minScore: 0.5,
      /** Score minimal pour considérer le géocodage « précis » (niveau adresse). */
      preciseScore: 0.7,
      /** Écart maximal toléré entre position SIRENE et position BAN (mètres). */
      maxDivergenceM: 300,
    },

    /** C. Fond cartographique OpenStreetMap. */
    osm: {
      tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
      linkUrl: 'https://www.openstreetmap.org/',
    },

    /** C bis. Fond cartographique IGN (plan vectoriel rasterisé). */
    planIgn: {
      wmtsUrl: 'https://data.geopf.fr/wmts',
      layer: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2',
      style: 'normal',
      format: 'image/png',
      tileMatrixSet: 'PM',
      maxNativeZoom: 19,
      maxZoom: 20,
      attribution:
        '<a href="https://www.ign.fr/" target="_blank" rel="noopener noreferrer">IGN</a> — Géoplateforme, Plan IGN',
    },

    /** D. Photographies aériennes — BD ORTHO® IGN, accès libre sans clé. */
    orthoIgn: {
      wmtsUrl: 'https://data.geopf.fr/wmts',
      /** HR = 20 cm de résolution, disponible du niveau 6 au niveau 19. */
      layer: 'HR.ORTHOIMAGERY.ORTHOPHOTOS',
      /** Repli si la couche HR ne couvre pas la zone (DOM notamment). */
      fallbackLayer: 'ORTHOIMAGERY.ORTHOPHOTOS',
      style: 'normal',
      format: 'image/jpeg',
      tileMatrixSet: 'PM',
      minNativeZoom: 6,
      maxNativeZoom: 19,
      maxZoom: 21,
      attribution:
        '<a href="https://www.ign.fr/" target="_blank" rel="noopener noreferrer">IGN</a> — BD ORTHO® (Géoplateforme)',
    },

    /** E. Photographies de rue — Panoramax (fédération IGN / OSM France).
     *  Métacatalogue public : aucun jeton, CORS ouvert. */
    panoramax: {
      enabled: true,
      baseUrl: 'https://api.panoramax.xyz/api',
      searchPath: '/search',
      viewerUrl: 'https://api.panoramax.xyz/',
      minIntervalMs: 250,
      timeoutMs: 15000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      attribution:
        '<a href="https://panoramax.fr/" target="_blank" rel="noopener noreferrer">Panoramax</a> — contributeurs',
    },

    /** E bis. Photographies de rue — Mapillary (jeton gratuit requis). */
    mapillary: {
      enabled: true,
      graphUrl: 'https://graph.mapillary.com',
      /** Route du proxy local : le jeton reste côté serveur (recommandé). */
      proxyPath: '/api/mapillary',
      /** Jeton client PUBLIC uniquement si vous acceptez de l'exposer. Vide par défaut. */
      clientToken: '',
      minIntervalMs: 300,
      timeoutMs: 15000,
      retries: 1,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      viewerUrl: 'https://www.mapillary.com/app/',
      attribution:
        '<a href="https://www.mapillary.com/" target="_blank" rel="noopener noreferrer">Mapillary</a> — contributeurs (CC BY-SA)',
    },
  },

  search: {
    perPage: 10,
    perPageOptions: [10, 25],
    /** Plafond imposé par l'API. */
    maxPerPage: 25,
    /** Établissements connexes demandés à l'API (1 à 100). */
    matchingLimit: 25,
    /** Recherche approximative : seconde passe élargie si la 1re ne donne rien. */
    fuzzyFallback: true,
    /** Nombre maximal de résultats affichés dans la liste (toutes pages confondues). */
    maxListed: 250,
  },

  imagery: {
    /** Rayon de recherche des photos de rue, en mètres. */
    streetRadiusM: 100,
    streetRadiusOptions: [50, 100, 200, 500],
    maxStreetPhotos: 12,
    /** 'both' | 'panoramax' | 'mapillary' */
    streetProviders: 'both',
    aerialZoom: 19,
  },

  map: {
    defaultBaseLayer: 'osm',
    franceCenter: [46.603354, 2.385372],
    franceZoom: 6,
    establishmentZoom: 18,
    fitMaxZoom: 18,
    fitPadding: [40, 40],
  },

  storage: {
    namespace: 'clf',
    /** L'historique est désactivé par défaut : aucune collecte implicite. */
    historyEnabled: false,
    historyMax: 40,
    favoritesMax: 200,
    cacheMaxEntries: 250,
    photosMax: 100,
  },
};

/** Fusion profonde (les tableaux sont remplacés, pas concaténés). */
function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(base?.[key] ?? {}, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export const config = deepMerge(DEFAULTS, localOverrides || {});

/** Construit une URL WMTS GetTile compatible Leaflet ({z}/{x}/{y}). */
export function buildWmtsUrl({ wmtsUrl, layer, style, format, tileMatrixSet }) {
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: layer,
    STYLE: style,
    FORMAT: format,
    TILEMATRIXSET: tileMatrixSet,
  });
  return `${wmtsUrl}?${params.toString()}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

export default config;
