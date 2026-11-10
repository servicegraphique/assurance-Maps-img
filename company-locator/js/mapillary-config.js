/**
 * mapillary-config.js — Résolution et diagnostic du jeton Mapillary.
 *
 * Module pur (aucune dépendance, aucun accès réseau) partagé par le serveur
 * local (`server.js`) et testable en isolation.
 *
 * Pourquoi ce module : le tableau de bord Mapillary affiche deux chose très
 * différentes qui se ressemblent —
 *   • le « Client ID » de l'application : un simple nombre, par exemple
 *     28966464223012415 — il ne sert PAS à appeler l'API ;
 *   • le « Client Token » : `MLY|<client_id>|<client_secret>`, seul utilisable
 *     comme jeton d'accès (en-tête `Authorization: OAuth MLY|…`).
 * Confondre les deux produit un 401 opaque. On préfère donc diagnostiquer la
 * valeur fournie et expliquer quoi faire, plutôt que de laisser l'utilisateur
 * devant « Mapillary a refusé la requête ».
 */

/** Tableau de bord où récupérer le jeton (gratuit). */
export const MAPILLARY_DASHBOARD_URL = 'https://www.mapillary.com/dashboard/developers';

/** Forme d'un jeton d'accès Mapillary : trois segments séparés par des barres. */
export const CLIENT_TOKEN_PATTERN = /^MLY\|[^|\s]+\|[^|\s]+$/;

/** Forme d'un identifiant d'application (Client ID) : uniquement des chiffres. */
export const CLIENT_ID_PATTERN = /^\d{6,25}$/;

/**
 * Nettoie une valeur copiée depuis un fichier de configuration ou un message :
 * espaces, guillemets, préfixes `Bearer`/`OAuth` collés par erreur.
 */
export function cleanMapillaryValue(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^(?:bearer|oauth)\s+/i, '')
    .trim();
}

/**
 * Classe la valeur fournie.
 * @returns {'empty'|'client-token'|'client-id'|'client-secret'|'unknown'}
 */
export function mapillaryTokenShape(raw) {
  const value = cleanMapillaryValue(raw);
  if (!value) return 'empty';
  if (CLIENT_TOKEN_PATTERN.test(value)) return 'client-token';
  if (CLIENT_ID_PATTERN.test(value)) return 'client-id';
  // Un secret seul est une longue chaîne alphanumérique sans barre verticale.
  if (/^[A-Za-z0-9_-]{16,}$/.test(value)) return 'client-secret';
  return 'unknown';
}

/**
 * Compose le jeton à partir du Client ID et du Client Secret du tableau de
 * bord. C'est exactement ce que Mapillary appelle le « Client Token ».
 */
export function composeClientToken(clientId, clientSecret) {
  const id = cleanMapillaryValue(clientId);
  const secret = cleanMapillaryValue(clientSecret);
  if (!id || !secret) return '';
  return `MLY|${id}|${secret}`;
}

/**
 * Détermine l'état réel de la configuration Mapillary.
 *
 * @param {{ token?: string, clientId?: string, clientSecret?: string, source?: string }} input
 * @returns {{ configured: boolean, token: string, state: 'ready'|'missing'|'incomplete'|'invalid',
 *             shape: string, source: string, message: string }}
 */
export function resolveMapillaryToken({ token, clientId, clientSecret, source = 'token' } = {}) {
  const direct = cleanMapillaryValue(token);
  const id = cleanMapillaryValue(clientId);
  const secret = cleanMapillaryValue(clientSecret);
  const shape = mapillaryTokenShape(direct);

  if (shape === 'client-token') {
    return {
      configured: true,
      token: direct,
      state: 'ready',
      shape,
      source,
      message: 'Jeton Mapillary « MLY|… » chargé côté serveur : il n’est jamais transmis au navigateur.',
    };
  }

  // Client ID + Client Secret fournis : on compose le jeton nous-mêmes.
  const composed = composeClientToken(id, secret);
  if (composed) {
    return {
      configured: true,
      token: composed,
      state: 'ready',
      shape: 'composed',
      source: 'client-id+secret',
      message: 'Client ID et Client Secret Mapillary combinés en jeton « MLY|… » côté serveur : aucun secret dans le navigateur.',
    };
  }

  // Un identifiant d'application seul : c'est l'erreur la plus fréquente.
  if (shape === 'client-id' || (id && !secret)) {
    const value = id || direct;
    return {
      configured: false,
      token: '',
      state: 'incomplete',
      shape: 'client-id',
      source,
      message: `« ${value} » est le Client ID de votre application Mapillary, pas un jeton : l’API répondra 401. `
        + 'Ajoutez le Client Secret (tableau de bord → votre application → « View ») dans server.config.json '
        + '(mapillaryClientSecret), ou collez le « Client Token » complet qui commence par MLY|.',
    };
  }

  // Secret fourni sans identifiant (ou secret collé dans « token ») : il manque
  // la moitié du jeton, on le dit au lieu de tout ignorer.
  if (shape === 'client-secret' || (secret && !id)) {
    return {
      configured: false,
      token: '',
      state: 'incomplete',
      shape: 'client-secret',
      source,
      message: 'Seul le Client Secret a été fourni : ajoutez aussi le Client ID (mapillaryClientId) '
        + 'pour composer le jeton « MLY|<client_id>|<client_secret> », ou collez directement le Client Token.',
    };
  }

  if (shape === 'unknown') {
    return {
      configured: false,
      token: '',
      state: 'invalid',
      shape,
      source,
      message: 'Jeton Mapillary de forme inattendue : un jeton d’accès commence par « MLY| », '
        + 'par exemple MLY|28966464223012415|votre_client_secret.',
    };
  }

  return {
    configured: false,
    token: '',
    state: 'missing',
    shape: 'empty',
    source,
    message: 'Aucun jeton Mapillary : renseignez mapillaryToken (ou mapillaryClientId + mapillaryClientSecret) '
      + 'dans server.config.json, puis relancez node server.js. Les photos Panoramax restent disponibles sans jeton.',
  };
}

/**
 * Charge utile renvoyée par `/api/mapillary/status` : jamais le jeton,
 * seulement son état.
 */
export function mapillaryStatusPayload(resolution) {
  return {
    configured: Boolean(resolution?.configured),
    mode: resolution?.configured ? 'proxy' : 'none',
    state: resolution?.state || 'missing',
    message: resolution?.message || '',
    tokenLength: resolution?.token ? resolution.token.length : 0,
  };
}
