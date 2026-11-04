/**
 * transport.js — Choix du chemin réseau entre le navigateur et les API.
 *
 * Pourquoi ce module existe :
 * les API publiques ne publient pas toutes des en-têtes CORS. L'API Recherche
 * d'entreprises, notamment, est conçue pour des appels serveur à serveur :
 * un `fetch` direct depuis le navigateur peut être bloqué par la politique
 * d'origine du navigateur, alors que la même requête fonctionne depuis Node.
 *
 * Stratégie :
 *  1. si l'application est servie par `node server.js`, les requêtes passent
 *     par le PROXY LOCAL de même origine (`/api/proxy/...`) : aucun problème
 *     de CORS, quota maîtrisé côté serveur, aucun secret exposé ;
 *  2. sinon (serveur statique simple : python -m http.server…), appel direct
 *     au service public, qui fonctionne pour les API ouvertes en CORS
 *     (Géoplateforme IGN, Panoramax) ;
 *  3. en cas d'échec réseau du chemin préféré, l'autre chemin est tenté.
 *
 * Aucun proxy tiers, aucun service payant : uniquement le serveur local livré
 * avec l'application, ou l'API publique elle-même.
 */

import { fetchJson, AppError, ERR, isBrowser } from './utils.js';

const SERVICES = {
  entreprises: {
    proxyBase: '/api/proxy/entreprises',
    origin: 'https://recherche-entreprises.api.gouv.fr',
    stripPrefix: '',
    label: 'API Recherche d\'entreprises',
    // Pas d'en-tête CORS côté API : le relais local est le chemin fiable.
    preferProxy: true,
  },
  geocoding: {
    proxyBase: '/api/proxy/geocodage',
    origin: 'https://data.geopf.fr',
    stripPrefix: '/geocodage',
    label: 'géocodage IGN',
    // CORS ouvert : appel direct possible, le relais sert de secours.
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
let detectionResult = { available: false, checked: false, mapillaryConfigured: false };
// Mémorise un relais local défaillant pour ne pas le re-tenter à chaque requête
// (utile si l'app est servie derrière un serveur qui répond à /api/health mais
// dont la machine n'a pas accès aux API publiques).
let proxyDisabled = false;

/** Détecte une seule fois la présence du serveur local applicatif. */
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
        checked: true,
      };
    } catch {
      detectionResult = { available: false, mapillaryConfigured: false, checked: true };
    }
    return detectionResult;
  })();

  return detectionPromise;
}

export const proxyState = () => ({ ...detectionResult, relayFailed: proxyDisabled });

/** URL de même origine équivalente à une URL publique donnée. */
export function toProxyUrl(service, directUrl) {
  const definition = SERVICES[service];
  if (!definition) return null;
  try {
    const url = new URL(directUrl);
    if (`${url.protocol}//${url.host}` !== definition.origin) return null;
    const path = definition.stripPrefix && url.pathname.startsWith(definition.stripPrefix)
      ? url.pathname.slice(definition.stripPrefix.length)
      : url.pathname;
    return `${definition.proxyBase}${path}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Interroge un service public en choisissant le meilleur chemin.
 * @param {string} service 'entreprises' | 'geocoding' | 'panoramax'
 * @param {string} directUrl URL publique complète
 * @param {object} options options de fetchJson (timeout, retries, limiter…)
 */
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
      // Le relais local échoue vite et rarement : inutile de le marteler.
      retries: useProxyFirst ? Math.min(options.retries ?? 2, 1) : options.retries,
      label: useProxyFirst ? `${definition.label} (via le serveur local)` : (options.label || definition.label),
    });
  } catch (error) {
    const recoverable = error instanceof AppError
      && [ERR.NETWORK, ERR.TIMEOUT, ERR.HTTP_SERVER, ERR.NOT_FOUND].includes(error.code);
    if (!secondaryUrl || !recoverable) throw error;
    // Le chemin de secours n'est tenté qu'une fois, sans retry supplémentaire.
    try {
      const data = await fetchJson(secondaryUrl, {
        ...options,
        retries: 0,
        label: secondaryUrl === directUrl ? `${definition.label} (appel direct)` : `${definition.label} (via le serveur local)`,
      });
      // Le relais a échoué mais l'appel direct fonctionne : on s'en souvient.
      if (useProxyFirst) proxyDisabled = true;
      return data;
    } catch (secondError) {
      const bothUnreachable = secondError instanceof AppError
        && [ERR.NETWORK, ERR.TIMEOUT].includes(secondError.code);
      if (!bothUnreachable) throw secondError;
      throw new AppError(`${definition.label} : les deux chemins réseau ont échoué`, {
        code: ERR.NETWORK,
        retryable: true,
        cause: secondError,
        userMessage: `Impossible de joindre le service « ${definition.label} », ni par le serveur local ni en appel direct. `
          + 'Vérifiez la connexion Internet de la machine qui exécute l\'application '
          + '(un pare-feu, un proxy d\'entreprise ou un environnement sandboxé peut bloquer ce domaine).',
        details: { primary: primaryUrl, secondary: secondaryUrl, firstError: error.message },
      });
    }
  }
}

/** Libellé du chemin réellement utilisé, pour le panneau d'état. */
export function transportLabel() {
  if (!detectionResult.checked) return 'détection du serveur local…';
  if (detectionResult.available && proxyDisabled) {
    return 'Le serveur local ne parvient pas à joindre les API publiques : appels directs depuis le navigateur. '
      + 'Vérifiez l\'accès Internet de la machine qui exécute server.js.';
  }
  return detectionResult.available
    ? 'Serveur local détecté : l\'API entreprises est relayée en même origine (aucun blocage CORS possible) ; '
      + 'les services ouverts en CORS sont appelés directement.'
    : 'Serveur statique simple : appels directs aux API publiques. L\'API entreprises peut être bloquée par CORS — '
      + 'utilisez « node server.js » pour un fonctionnement garanti.';
}

export const transportInternals = {
  SERVICES,
  toProxyUrl,
  resetTransportState() { proxyDisabled = false; detectionPromise = null; detectionResult = { available: false, checked: false, mapillaryConfigured: false }; },
};
