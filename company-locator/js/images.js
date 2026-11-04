/**
 * images.js — Photographies réelles de l'environnement de l'établissement.
 *
 * Responsabilité : interroger les fournisseurs d'imagerie de rue, normaliser
 * les photographies (URL, date, auteur, licence, lien source) et signaler
 * explicitement toute indisponibilité. La photographie aérienne est traitée
 * par map.js (tuiles WMTS IGN) ; ce module-ci gère le niveau rue.
 *
 * Fournisseurs :
 *  - Panoramax (fédération IGN / OpenStreetMap France) : métacatalogue public,
 *    AUCUN jeton, CORS ouvert → fonctionne immédiatement.
 *  - Mapillary : jeton gratuit obligatoire. Deux modes :
 *      proxy local (recommandé, jeton côté serveur) ou jeton client explicite.
 *
 * Aucune image générique n'est jamais substituée à une photographie absente.
 */

import config from './config.js';
import {
  AppError, ERR, RateLimiter, TtlCache, fetchJson, haversineM, bboxAround,
  safeUrl, truncate,
} from './utils.js';
import { cacheStore, userPhotos } from './storage.js';
import { fetchServiceJson } from './transport.js';

export const PROVIDERS = {
  panoramax: { key: 'panoramax', name: 'Panoramax', needsToken: false, home: 'https://panoramax.fr/' },
  mapillary: { key: 'mapillary', name: 'Mapillary', needsToken: true, home: 'https://www.mapillary.com/dashboard/developers' },
};

/* ==================================================================== */
/* 1. Panoramax — sans jeton                                             */
/* ==================================================================== */

const PCFG = config.api.panoramax;
const pLimiter = new RateLimiter(PCFG.minIntervalMs);
const pCache = new TtlCache({ store: cacheStore, prefix: 'cache:pnx:', ttlMs: PCFG.cacheTtlMs, maxEntries: 80 });

function normalizePanoramaxFeature(feature, origin) {
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords)) return null;
  const [lon, lat] = coords.map(Number);
  const props = feature.properties || {};
  const assets = feature.assets || {};
  const thumb = assets.thumb?.href || assets.sd?.href || assets.hd?.href || '';
  const full = assets.hd?.href || assets.sd?.href || thumb;
  if (!thumb) return null;

  const producer = Array.isArray(props.providers)
    ? (props.providers.find((p) => p.roles?.includes('producer'))?.name || props.providers[0]?.name || '')
    : '';
  const fov = props['pers:interior_orientation']?.field_of_view;

  return {
    id: `panoramax:${feature.id}`,
    provider: 'panoramax',
    providerName: 'Panoramax',
    thumbUrl: safeUrl(thumb),
    fullUrl: safeUrl(full),
    capturedAt: props.datetime || props.created || '',
    direction: Number.isFinite(Number(props['view:azimuth'])) ? Number(props['view:azimuth']) : null,
    isPano: Number(fov) === 360,
    lat,
    lon,
    distanceM: Number.isFinite(lat) && Number.isFinite(lon) ? Math.round(haversineM(origin.lat, origin.lon, lat, lon)) : null,
    author: producer || 'Contributeur Panoramax',
    licence: props.license || 'Voir la fiche de la photographie',
    pageUrl: `${PCFG.viewerUrl}#focus=pic&pic=${encodeURIComponent(feature.id)}`,
    instance: feature.links?.find((link) => link.rel === 'self')?.href || '',
  };
}

/**
 * Recherche des photographies autour d'un point.
 * `place_position` attend LONGITUDE puis LATITUDE (ordre STAC).
 */
export async function fetchPanoramax({ lat, lon, radiusM = 100, limit = 12, signal = null }) {
  if (!PCFG.enabled) return { photos: [], skipped: 'Fournisseur désactivé dans la configuration.' };

  const primary = new URLSearchParams({
    place_position: `${lon},${lat}`,
    place_distance: `0-${Math.round(radiusM)}`,
    limit: String(Math.min(100, Math.max(1, limit * 3))),
  });

  const request = async (params) => {
    const url = `${PCFG.baseUrl}${PCFG.searchPath}?${params}`;
    return pCache.wrap(params.toString(), () => fetchServiceJson('panoramax', url, {
      timeoutMs: PCFG.timeoutMs, retries: PCFG.retries, limiter: pLimiter, signal, label: 'service Panoramax',
    }));
  };

  let raw;
  try {
    raw = await request(primary);
  } catch (error) {
    // Certaines instances n'acceptent pas place_position : repli sur bbox.
    if (error instanceof AppError && error.code === ERR.HTTP_CLIENT) {
      const bbox = bboxAround(lat, lon, radiusM).map((n) => n.toFixed(6)).join(',');
      raw = await request(new URLSearchParams({ bbox, limit: String(Math.min(100, limit * 3)) }));
    } else {
      throw error;
    }
  }

  const features = Array.isArray(raw?.features) ? raw.features : [];
  const photos = features
    .map((feature) => normalizePanoramaxFeature(feature, { lat, lon }))
    .filter((photo) => photo && photo.thumbUrl)
    .filter((photo) => photo.distanceM == null || photo.distanceM <= radiusM * 1.5)
    .sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)
      || new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));

  return { photos: photos.slice(0, limit), total: features.length };
}

export async function pingPanoramax({ signal = null } = {}) {
  const started = Date.now();
  const result = await fetchPanoramax({ lat: 48.8566, lon: 2.3522, radiusM: 150, limit: 1, signal });
  return { ok: true, latencyMs: Date.now() - started, detail: `${result.photos.length} photo(s) test à Paris` };
}

/* ==================================================================== */
/* 2. Mapillary — jeton gratuit, proxy recommandé                        */
/* ==================================================================== */

const MCFG = config.api.mapillary;
const mLimiter = new RateLimiter(MCFG.minIntervalMs);
const mCache = new TtlCache({ store: cacheStore, prefix: 'cache:mly:', ttlMs: MCFG.cacheTtlMs, maxEntries: 80 });

let accessMode = null; // 'proxy' | 'direct' | 'none'
let accessDetail = '';

/**
 * Détermine comment Mapillary peut être interrogé, sans jamais exposer de
 * secret : on teste d'abord le proxy local, puis un jeton client explicite.
 */
export async function detectMapillaryAccess({ force = false } = {}) {
  if (accessMode && !force) return { mode: accessMode, detail: accessDetail };

  if (!MCFG.enabled) {
    accessMode = 'none';
    accessDetail = 'Mapillary est désactivé dans la configuration.';
    return { mode: accessMode, detail: accessDetail };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${MCFG.proxyPath}/status`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const type = response.headers.get('content-type') || '';
    if (response.ok && type.includes('application/json')) {
      const body = await response.json();
      if (body?.configured) {
        accessMode = 'proxy';
        accessDetail = 'Jeton chargé côté serveur (proxy local) : aucun secret dans le navigateur.';
        return { mode: accessMode, detail: accessDetail };
      }
      accessDetail = 'Proxy local détecté mais aucun jeton configuré (server.config.json ou MAPILLARY_TOKEN).';
    }
  } catch { /* pas de proxy : serveur statique simple */ }

  if (MCFG.clientToken && MCFG.clientToken.trim()) {
    accessMode = 'direct';
    accessDetail = 'Jeton client utilisé directement depuis le navigateur : visible publiquement, à réserver à un usage local.';
    return { mode: accessMode, detail: accessDetail };
  }

  accessMode = 'none';
  accessDetail = accessDetail
    || 'Aucun jeton Mapillary. Les photos de rue Panoramax restent disponibles sans jeton.';
  return { mode: accessMode, detail: accessDetail };
}

function normalizeMapillaryItem(item, origin) {
  const coords = item?.geometry?.coordinates;
  if (!Array.isArray(coords)) return null;
  const [lon, lat] = coords.map(Number);
  const thumb = safeUrl(item.thumb_1024_url || item.thumb_2048_url || item.thumb_256_url || '');
  if (!thumb) return null;
  return {
    id: `mapillary:${item.id}`,
    provider: 'mapillary',
    providerName: 'Mapillary',
    thumbUrl: thumb,
    fullUrl: safeUrl(item.thumb_2048_url || item.thumb_1024_url || thumb),
    capturedAt: item.captured_at ? new Date(Number(item.captured_at)).toISOString() : '',
    direction: Number.isFinite(Number(item.compass_angle)) ? Number(item.compass_angle) : null,
    isPano: Boolean(item.is_pano),
    lat,
    lon,
    distanceM: Math.round(haversineM(origin.lat, origin.lon, lat, lon)),
    author: item.creator?.username ? `@${item.creator.username}` : 'Contributeur Mapillary',
    licence: 'CC BY-SA 4.0',
    pageUrl: `${MCFG.viewerUrl}?pKey=${encodeURIComponent(item.id)}&focus=photo`,
    instance: '',
  };
}

export async function fetchMapillary({ lat, lon, radiusM = 100, limit = 12, signal = null }) {
  const access = await detectMapillaryAccess();
  if (access.mode === 'none') {
    return { photos: [], skipped: access.detail, mode: 'none' };
  }

  const bbox = bboxAround(lat, lon, radiusM).map((n) => n.toFixed(6)).join(',');
  const fields = 'id,thumb_1024_url,thumb_2048_url,captured_at,compass_angle,is_pano,geometry';
  const fetchLimit = String(Math.min(100, Math.max(1, limit * 3)));

  const url = access.mode === 'proxy'
    ? `${MCFG.proxyPath}/images?bbox=${bbox}&limit=${fetchLimit}`
    : `${MCFG.graphUrl}/images?${new URLSearchParams({
      access_token: MCFG.clientToken.trim(), fields, bbox, limit: fetchLimit,
    })}`;

  const cacheKey = `${access.mode}:${bbox}:${fetchLimit}`;
  const raw = await mCache.wrap(cacheKey, () => fetchJson(url, {
    timeoutMs: MCFG.timeoutMs, retries: MCFG.retries, limiter: mLimiter, signal, label: 'service Mapillary',
  }));

  const items = Array.isArray(raw?.data) ? raw.data : [];
  const photos = items
    .map((item) => normalizeMapillaryItem(item, { lat, lon }))
    .filter(Boolean)
    .filter((photo) => photo.distanceM <= radiusM * 1.5)
    .sort((a, b) => a.distanceM - b.distanceM || new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0));

  return { photos: photos.slice(0, limit), total: items.length, mode: access.mode };
}

export async function pingMapillary({ signal = null } = {}) {
  const access = await detectMapillaryAccess();
  if (access.mode === 'none') return { ok: false, skipped: true, detail: access.detail };
  const started = Date.now();
  const result = await fetchMapillary({ lat: 48.8566, lon: 2.3522, radiusM: 150, limit: 1, signal });
  return { ok: true, latencyMs: Date.now() - started, detail: `${result.photos.length} photo(s) test à Paris (${access.mode})` };
}

/* ==================================================================== */
/* 3. Agrégation                                                         */
/* ==================================================================== */

/**
 * Interroge les fournisseurs activés et renvoie un état détaillé par source.
 * @returns {Promise<{photos: Array, sources: Array}>}
 */
export async function fetchStreetPhotos({ lat, lon, radiusM, providers = 'both', limit, signal = null }) {
  const radius = Number(radiusM) || config.imagery.streetRadiusM;
  const max = Number(limit) || config.imagery.maxStreetPhotos;
  const wanted = providers === 'both' ? ['panoramax', 'mapillary'] : [providers];
  const sources = [];
  let photos = [];

  const tasks = wanted.map(async (key) => {
    const definition = PROVIDERS[key];
    if (!definition) return;
    try {
      const result = key === 'panoramax'
        ? await fetchPanoramax({ lat, lon, radiusM: radius, limit: max, signal })
        : await fetchMapillary({ lat, lon, radiusM: radius, limit: max, signal });

      if (result.skipped) {
        sources.push({ key, name: definition.name, status: 'unavailable', message: result.skipped, count: 0 });
        return;
      }
      photos.push(...result.photos);
      sources.push({
        key,
        name: definition.name,
        status: result.photos.length ? 'ok' : 'empty',
        count: result.photos.length,
        message: result.photos.length
          ? `${result.photos.length} photographie(s) dans un rayon de ${radius} m.`
          : `Aucune photographie géolocalisée dans un rayon de ${radius} m.`,
      });
    } catch (error) {
      sources.push({
        key,
        name: definition.name,
        status: 'error',
        count: 0,
        message: error?.userMessage || error?.message || 'Service indisponible.',
      });
    }
  });

  await Promise.all(tasks);

  // Fusion : on garde les deux sources, triées par distance puis par date.
  photos = photos
    .filter((photo, index, list) => list.findIndex((item) => item.id === photo.id) === index)
    .sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)
      || new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0))
    .slice(0, max);

  return { photos, sources, radiusM: radius };
}

/* ==================================================================== */
/* 4. Photographies complémentaires (source vérifiée par l'utilisateur)  */
/* ==================================================================== */

/**
 * Aucune API gratuite ne permet d'identifier de façon fiable une photographie
 * « officielle » d'un établissement donné. Plutôt que d'inventer ou d'afficher
 * une image générique, l'application permet d'associer manuellement une photo
 * dont l'utilisateur garantit la provenance (URL + source obligatoires).
 */
export function getComplementaryPhotos(siret) {
  return userPhotos.list(siret).map((photo) => ({
    id: photo.id,
    provider: 'user',
    providerName: 'Photo ajoutée manuellement',
    thumbUrl: safeUrl(photo.url),
    fullUrl: safeUrl(photo.url),
    capturedAt: photo.date || '',
    author: photo.source,
    licence: photo.licence || 'Licence non renseignée',
    note: photo.note || '',
    pageUrl: safeUrl(photo.url),
    distanceM: null,
    direction: null,
    isPano: false,
    addedAt: photo.addedAt,
  })).filter((photo) => photo.thumbUrl);
}

export function addComplementaryPhoto(siret, { url, source, licence, date, note }) {
  const cleanUrl = safeUrl(url);
  if (!cleanUrl) {
    throw new AppError('URL invalide', {
      code: ERR.INVALID_INPUT,
      userMessage: 'L\'URL de la photographie doit commencer par http:// ou https://.',
    });
  }
  if (!String(source ?? '').trim()) {
    throw new AppError('Source manquante', {
      code: ERR.INVALID_INPUT,
      userMessage: 'Indiquez la source de la photographie (site officiel, auteur, service).',
    });
  }
  return userPhotos.add(siret, {
    url: cleanUrl, source: truncate(String(source).trim(), 120), licence: truncate(String(licence ?? '').trim(), 80), date, note: truncate(String(note ?? '').trim(), 200),
  });
}

export function removeComplementaryPhoto(siret, id) {
  userPhotos.remove(siret, id);
}
