/**
 * streetview.js — Vues immersives « Street View » 360°.
 *
 * RESPONSABILITÉ UNIQUE : déterminer quelles sources immersives sont
 * disponibles pour un point, et construire l'URL du cadre à afficher.
 * Ce module ne crée AUCUN iframe et ne lance AUCUNE requête tierce :
 * c'est l'interface qui décide quand charger, sur clic de l'utilisateur.
 *
 * Trois sources, par ordre de préférence :
 *
 *  1. PANORAMAX — fédération IGN / OpenStreetMap France. Viewer officiel
 *     intégrable, 360° navigable, SANS CLÉ ni compte. Source par défaut.
 *  2. MAPILLARY — l'embed public (`/embed?image_key=…`) ne demande PAS de
 *     jeton, contrairement à l'API Graph qui sert à *trouver* les photos.
 *     Disponible seulement si des photos Mapillary ont déjà été trouvées.
 *  3. GOOGLE STREET VIEW — API Maps Embed, gratuite et illimitée, mais Google
 *     exige un projet Cloud avec facturation activée. Optionnel, désactivé
 *     par défaut. La clé reste côté serveur : le navigateur appelle une route
 *     de même origine qui redirige vers Google en ajoutant la clé.
 *
 * Aucune image n'est générée, aucune vue n'est présentée comme immersive
 * si la photographie est plate : `describeImmersion()` le dit explicitement.
 */

import { config } from './config.js';
import { fetchJson, isBrowser, safeUrl } from './utils.js';

const SVC = config.streetView;
const PCFG = config.api.panoramax;
const MCFG = config.api.mapillary;

/** Métadonnées des sources, utilisées par l'interface et l'onglet Sources. */
export const STREETVIEW_PROVIDERS = {
  panoramax: {
    key: 'panoramax',
    name: 'Panoramax 360°',
    shortName: 'Panoramax',
    needsKey: false,
    needsPhoto: true,
    navigable: true,
    licence: 'Licence Ouverte 2.0 ou CC BY-SA 4.0 selon la séquence',
    homeUrl: 'https://panoramax.fr/',
    note: 'Vue immersive officielle, sans clé ni compte. Flèches pour se déplacer le long de la rue.',
  },
  mapillary: {
    key: 'mapillary',
    name: 'Mapillary 360°',
    shortName: 'Mapillary',
    needsKey: false,
    needsPhoto: true,
    navigable: true,
    licence: 'CC BY-SA 4.0',
    homeUrl: 'https://www.mapillary.com/',
    note: 'Embed public sans jeton. Nécessite qu\'une photo Mapillary ait été trouvée à proximité.',
  },
  google: {
    key: 'google',
    name: 'Google Street View',
    shortName: 'Google',
    needsKey: true,
    needsPhoto: false,
    navigable: true,
    licence: 'Google Maps Platform — conditions Google',
    homeUrl: 'https://www.google.com/streetview/',
    note: 'API Maps Embed gratuite et illimitée, mais une clé Google Cloud avec facturation activée est requise.',
  },
};

/* ------------------------------------------------------------------ */
/* 1. Configuration Google (même origine, jamais de clé dans le JS)    */
/* ------------------------------------------------------------------ */

let googleState = { configured: false, checked: false, message: '' };
let googlePromise = null;

/**
 * Interroge le serveur local pour savoir si une clé Google est configurée.
 * La réponse ne contient qu'un booléen : la clé n'est jamais transmise.
 */
export function detectGoogleStreetView({ force = false } = {}) {
  if (!isBrowser) return Promise.resolve({ ...googleState, checked: true });
  if (googlePromise && !force) return googlePromise;

  googlePromise = (async () => {
    try {
      const body = await fetchJson(SVC.googleStatusPath, {
        timeout: 4000,
        retries: 0,
        label: 'configuration Google Street View',
      });
      googleState = {
        configured: Boolean(body?.configured),
        checked: true,
        message: body?.message || '',
      };
    } catch {
      googleState = {
        configured: false,
        checked: true,
        message: 'Serveur local absent : Google Street View n\'est pas disponible. Panoramax reste utilisable sans clé.',
      };
    }
    return googleState;
  })();

  return googlePromise;
}

export const googleStreetViewState = () => ({ ...googleState });

/* ------------------------------------------------------------------ */
/* 2. Qualification des photographies                                  */
/* ------------------------------------------------------------------ */

/**
 * Une photographie plate n'offre pas de navigation immersive : on le dit
 * au lieu de laisser croire à une vue 360°.
 */
export function describeImmersion(photo) {
  if (!photo) return { immersive: false, label: 'Aucune photographie', detail: '' };
  if (photo.isPano) {
    return { immersive: true, label: '360° immersif', detail: 'Photographie sphérique : vous pouvez regarder autour et vous déplacer.' };
  }
  return {
    immersive: false,
    label: 'Photographie plane',
    detail: 'Cette photographie n\'est pas sphérique : le viewer permettra de zoomer et de déplacer le cadre, sans vision à 360°.',
  };
}

/** Identifiant natif de la photo chez son fournisseur (sans notre préfixe). */
export function nativePhotoId(photo) {
  if (!photo?.id) return '';
  const separator = String(photo.id).indexOf(':');
  return separator >= 0 ? String(photo.id).slice(separator + 1) : String(photo.id);
}

/* ------------------------------------------------------------------ */
/* 3. Construction des URL d'intégration                               */
/* ------------------------------------------------------------------ */

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

/** Cap ramené dans [0, 360). */
export function normalizeHeading(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return SVC.heading;
  return ((number % 360) + 360) % 360;
}

/**
 * Panoramax : `#focus=pic&pic=<uuid>&xyz=<cap>/<inclinaison>/<zoom>`.
 * `nav=none` retiré volontairement : le déplacement dans la séquence est
 * précisément l'intérêt de la vue immersive.
 */
export function buildPanoramaxEmbed(photo, { heading, pitch, zoom = 30 } = {}) {
  const id = nativePhotoId(photo);
  if (!id || photo?.provider !== 'panoramax') return null;
  const yaw = normalizeHeading(heading ?? photo.direction ?? SVC.heading).toFixed(2);
  const tilt = clamp(pitch ?? SVC.pitch, -90, 90, 0).toFixed(2);
  const level = clamp(zoom, 0, 100, 30).toFixed(0);
  const base = PCFG.embedUrl || PCFG.viewerUrl;
  return safeUrl(`${base}#focus=pic&pic=${encodeURIComponent(id)}&xyz=${yaw}/${tilt}/${level}`);
}

/** Mapillary : embed public, aucun jeton dans l'URL. */
export function buildMapillaryEmbed(photo, { style = 'photo' } = {}) {
  const id = nativePhotoId(photo);
  if (!id || photo?.provider !== 'mapillary') return null;
  const layout = ['photo', 'split', 'classic'].includes(style) ? style : 'photo';
  const url = new URL(MCFG.embedUrl);
  url.searchParams.set('image_key', id);
  url.searchParams.set('style', layout);
  return safeUrl(url.toString());
}

/**
 * Google : on renvoie une URL DE MÊME ORIGINE. Le serveur ajoute la clé et
 * redirige. Aucune clé n'apparaît dans le JavaScript public ni dans un export.
 */
export function buildGoogleEmbed({ lat, lon, heading, pitch, fov, radiusM } = {}) {
  // Number(null) vaut 0 : une coordonnée absente ne doit pas devenir 0.
  const present = (value) => value !== null && value !== undefined && String(value).trim() !== '';
  const latitude = present(lat) ? Number(lat) : NaN;
  const longitude = present(lon) ? Number(lon) : NaN;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    heading: normalizeHeading(heading ?? SVC.heading).toFixed(1),
    pitch: clamp(pitch ?? SVC.pitch, -90, 90, 0).toFixed(1),
    fov: clamp(fov ?? SVC.fov, 10, 100, 90).toFixed(0),
    radius: String(clamp(radiusM ?? SVC.googleRadiusM, 1, 1000, 50)),
  });
  return `${SVC.googleEmbedPath}?${params}`;
}

/* ------------------------------------------------------------------ */
/* 4. Disponibilité par source                                         */
/* ------------------------------------------------------------------ */

/**
 * Évalue chaque source pour un établissement donné.
 * @returns {Array<{key,name,status,reason,photo,url,immersive}>}
 *   status : 'ready' | 'unavailable'
 */
export function availableProviders({ photos = [], position = null, googleConfigured = false } = {}) {
  const panoramaxPhotos = photos.filter((photo) => photo.provider === 'panoramax');
  const mapillaryPhotos = photos.filter((photo) => photo.provider === 'mapillary');
  // Les sphériques d'abord, puis les plus proches.
  const rank = (list) => [...list].sort((a, b) => {
    if (Boolean(b.isPano) !== Boolean(a.isPano)) return b.isPano ? 1 : -1;
    return (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9);
  });

  const result = [];

  for (const key of ['panoramax', 'mapillary']) {
    const meta = STREETVIEW_PROVIDERS[key];
    const candidates = rank(key === 'panoramax' ? panoramaxPhotos : mapillaryPhotos);
    const photo = candidates[0] || null;
    const url = photo
      ? (key === 'panoramax' ? buildPanoramaxEmbed(photo) : buildMapillaryEmbed(photo))
      : null;
    result.push({
      ...meta,
      status: url ? 'ready' : 'unavailable',
      reason: url ? '' : `Aucune photographie ${meta.shortName} trouvée à proximité. Augmentez le rayon de recherche ou utilisez une autre source.`,
      photo,
      photos: candidates,
      url,
      immersion: describeImmersion(photo),
    });
  }

  const googleUrl = position ? buildGoogleEmbed({ lat: position.lat, lon: position.lon }) : null;
  const googleReady = Boolean(googleConfigured && googleUrl);
  result.push({
    ...STREETVIEW_PROVIDERS.google,
    status: googleReady ? 'ready' : 'unavailable',
    reason: googleReady ? '' : (googleConfigured
      ? 'Coordonnées indisponibles : aucune vue Street View ne peut être centrée.'
      : 'Non configuré. L\'API Google Maps Embed est gratuite et illimitée, mais exige une clé Google Cloud avec facturation activée. Renseignez googleMapsEmbedKey dans server.config.json pour l\'activer.'),
    photo: null,
    photos: [],
    url: googleReady ? googleUrl : null,
    immersion: { immersive: true, label: '360° immersif', detail: 'Panoramas Google, déplacement le long de la rue.' },
  });

  return result;
}

/** Source à sélectionner par défaut : la préférée si prête, sinon la première prête. */
export function pickProvider(providers, preferred = SVC.preferredProvider) {
  const ready = providers.filter((provider) => provider.status === 'ready');
  if (!ready.length) return null;
  return ready.find((provider) => provider.key === preferred) || ready[0];
}

/** Reconstruit l'URL d'une source après changement d'orientation ou de photo. */
export function embedUrlFor(providerKey, { photo, position, heading, pitch, fov, zoom } = {}) {
  if (providerKey === 'panoramax') return buildPanoramaxEmbed(photo, { heading, pitch, zoom });
  if (providerKey === 'mapillary') return buildMapillaryEmbed(photo);
  if (providerKey === 'google') return buildGoogleEmbed({ lat: position?.lat, lon: position?.lon, heading, pitch, fov });
  return null;
}

/** Attributions et cadre durci, communs à toutes les sources. */
export function frameAttributes(title) {
  return {
    title,
    sandbox: SVC.sandbox,
    allow: SVC.permissions,
    referrerpolicy: 'no-referrer',
    loading: 'lazy',
    allowfullscreen: 'true',
  };
}

export const streetViewInternals = {
  SVC,
  resetGoogleState() {
    googleState = { configured: false, checked: false, message: '' };
    googlePromise = null;
  },
};
