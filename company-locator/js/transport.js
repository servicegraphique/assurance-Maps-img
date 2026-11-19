/**
 * transport.js — Choix du chemin réseau entre relais local et appel direct.
 *
 * Bascule automatiquement du relais local vers l'URL publique directe (et
 * inversement) en cas d'indisponibilité réseau ou HTTP 5xx.
 */

import { fetchJson, AppError, ERR, isBrowser } from './utils.js';

const SERVICES = {
  entreprises: {
    proxyBase: '/api/proxy/entreprises',
    origin: 'https://recherche-entreprises.api.gouv.fr',
    stripPrefix: '',
    label: 'API Recherche d\'entreprises',
    preferProxy: true,
  },
  geocoding: {
    proxyBase: '/api/proxy/geocodage',
    origin: 'https://data.geopf.fr',
    stripPrefix: '/geocodage',
    label: 'géocodage IGN',
    preferProxy: false,
  },
  panoramax: {
    proxyBase: '/api/proxy/panoramax',
    origin: 'https://api.panoramax.xyz',
    stripPrefix: '/api',
    label: 'Panoramax',
    preferProxy: false,
  },
};

let detectionPromise = null;
let detectionResult = {
  available: false,
  checked: false,
  mapillaryConfigured: false,
  googleStreetViewConfigured: false,
};
let proxyDisabled = false;

export function detectProxy({ force = false } = {}) {
  if (!isBrowser) return Promise.resolve({ ...detectionResult, checked: true });
  if (detectionPromise && !force) return detectionPromise;

  detectionPromise = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const response = await fetch('/api/health', {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !type.includes('application/json')) throw new Error('pas de serveur applicatif');
      const body = await response.json();
      detectionResult = {
        available: body?.app === 'Company Locator France',
        mapillaryConfigured: Boolean(body?.mapillaryConfigured),
        googleStreetViewConfigured: Boolean(body?.googleStreetViewConfigured),
        checked: true,
      };
    } catch {
      detectionResult = {
        available: false,
        mapillaryConfigured: false,
        googleStreetViewConfigured: false,
        checked: true,
      };
    }
    return detectionResult;
  })();

  return detectionPromise;
}

export const proxyState = () => ({ ...detectionResult, relayFailed: proxyDisabled });

export function toProxyUrl(service, directUrl) {
  const definition = SERVICES[service];
  if (!definition) return null;
  try {
    const url = new URL(directUrl);
    if (`${url.protocol}//${url.host}` !== definition.origin) return null;
    const subPath = definition.stripPrefix && url.pathname.startsWith(definition.stripPrefix)
      ? url.pathname.slice(definition.stripPrefix.length)
      : url.pathname;
    return `${definition.proxyBase}${subPath}${url.search}`;
  } catch {
    return null;
  }
}

export async function fetchServiceJson(service, directUrl, options = {}) {
  const definition = SERVICES[service];
  const { available } = await detectProxy();
  const proxyUrl = available && !proxyDisabled ? toProxyUrl(service, directUrl) : null;

  const useProxyFirst = Boolean(proxyUrl) && definition.preferProxy;
  const primaryUrl = useProxyFirst ? proxyUrl : directUrl;
  const secondaryUrl = useProxyFirst ? directUrl : proxyUrl;

  try {
    return await fetchJson(primaryUrl, {
      ...options,
      retries: useProxyFirst ? Math.min(options.retries ?? 2, 1) : options.retries,
      label: useProxyFirst ? `${definition.label} (via le serveur local)` : (options.label || definition.label),
    });
  } catch (error) {
    const recoverable = error instanceof AppError
      && [ERR.NETWORK, ERR.TIMEOUT, ERR.HTTP_SERVER, ERR.NOT_FOUND].includes(error.code);
    if (!secondaryUrl || !recoverable) throw error;
    try {
      const data = await fetchJson(secondaryUrl, {
        ...options,
        retries: 0,
        label: secondaryUrl === directUrl ? `${definition.label} (appel direct)` : `${definition.label} (via le serveur local)`,
      });
      if (useProxyFirst) proxyDisabled = true;
      return data;
    } catch (secondError) {
      const bothUnreachable = secondError instanceof AppError
        && [ERR.NETWORK, ERR.TIMEOUT].includes(secondError.code);
      if (!bothUnreachable) throw secondError;
      throw new AppError(`${definition.label} : service injoignable`, {
        code: ERR.NETWORK,
        retryable: true,
        cause: secondError,
        userMessage: `Impossible de joindre « ${definition.label} ». Vérifiez votre connexion Internet.`,
        details: { primary: primaryUrl, secondary: secondaryUrl, firstError: error.message },
      });
    }
  }
}

export const transportInternals = {
  SERVICES,
  toProxyUrl,
  resetTransportState() {
    proxyDisabled = false;
    detectionPromise = null;
    detectionResult = {
      available: false,
      checked: false,
      mapillaryConfigured: false,
      googleStreetViewConfigured: false,
    };
  },
};
