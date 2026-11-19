/**
 * images.js — Photographies de rue (Panoramax sans clé, Mapillary optionnel)
 * avec cadrage automatique orienté vers la façade de l'établissement.
 */

import config from './config.js';
import { mapillaryTokenShape } from './mapillary-config.js';
import {
  AppError, ERR, RateLimiter, TtlCache, fetchJson, haversineM, bboxAround,
  safeUrl, formatDateFr,
} from './utils.js';
import { cacheStore } from './storage.js';
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
const pCache = new TtlCache({ store: cacheStore, prefix: 'cache:pnx:', ttlMs: PCFG.cacheTtlMs, maxEntries: 60 });

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
    capturedAt: props.datetime || '',
    direction: Number.isFinite(Number(props['view:azimuth'])) ? Number(props['view:azimuth']) : null,
    isPano: Number(fov) === 360,
    lat,
    lon,
    distanceM: Number.isFinite(lat) && Number.isFinite(lon)
      ? Math.round(haversineM(origin.lat, origin.lon, lat, lon))
      : null,
    author: producer || 'Contributeur Panoramax',
    licence: props.license || 'Licence Ouverte / CC BY-SA',
    pageUrl: `${PCFG.viewerUrl}#focus=pic&pic=${encodeURIComponent(feature.id)}`,
  };
}

export async function fetchPanoramax({ lat, lon, radiusM = 120, limit = 10, signal = null }) {
  if (!PCFG.enabled) return { photos: [], skipped: 'Fournisseur désactivé.' };

  const fetchCount = String(Math.min(100, Math.max(1, limit * 3)));
  const primary = new URLSearchParams({
    place_position: `${lon},${lat}`,
    place_distance: `0-${Math.round(radiusM)}`,
    limit: fetchCount,
  });
  const bbox = bboxAround(lat, lon, radiusM).map((n) => n.toFixed(6)).join(',');
  const bboxParams = new URLSearchParams({ bbox, limit: fetchCount });

  const request = async (params) => {
    const url = `${PCFG.baseUrl}${PCFG.searchPath}?${params}`;
    return pCache.wrap(params.toString(), () => fetchServiceJson('panoramax', url, {
      timeoutMs: PCFG.timeoutMs, retries: PCFG.retries, limiter: pLimiter, signal, label: 'service Panoramax',
    }));
  };

  let raw;
  try {
    raw = await request(primary);
    if (Array.isArray(raw?.features) && !raw.features.length) raw = await request(bboxParams);
  } catch (error) {
    if (error instanceof AppError && error.code === ERR.HTTP_CLIENT) {
      raw = await request(bboxParams);
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

/* ==================================================================== */
/* 2. Mapillary — jeton gratuit côté serveur (optionnel)                 */
/* ==================================================================== */

const MCFG = config.api.mapillary;
const mLimiter = new RateLimiter(MCFG.minIntervalMs);
const mCache = new TtlCache({ store: cacheStore, prefix: 'cache:mly:', ttlMs: MCFG.cacheTtlMs, maxEntries: 60 });

let accessMode = null;
let accessDetail = '';
let accessState = '';

export async function detectMapillaryAccess({ force = false } = {}) {
  if (accessMode && !force) return { mode: accessMode, detail: accessDetail, state: accessState };
  if (!MCFG.enabled) {
    accessMode = 'none';
    accessDetail = 'Mapillary désactivé.';
    return { mode: accessMode, detail: accessDetail };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
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
        accessState = body.state || 'ready';
        accessDetail = body.message || 'Jeton Mapillary chargé côté serveur.';
        return { mode: accessMode, detail: accessDetail, state: accessState };
      }
      accessState = body?.state || '';
      accessDetail = body?.message || 'Aucun jeton Mapillary configuré.';
    }
  } catch { /* serveur statique */ }

  if (MCFG.clientToken && MCFG.clientToken.trim()) {
    const shape = mapillaryTokenShape(MCFG.clientToken);
    if (shape === 'client-token') {
      accessMode = 'direct';
      accessState = 'ready';
      accessDetail = 'Jeton client Mapillary actif.';
      return { mode: accessMode, detail: accessDetail, state: accessState };
    }
    accessState = 'invalid';
    accessDetail = 'Jeton Mapillary invalide (doit commencer par MLY|).';
  }

  accessMode = 'none';
  accessDetail = accessDetail || 'Aucun jeton Mapillary. Panoramax reste actif.';
  return { mode: accessMode, detail: accessDetail, state: accessState };
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
  };
}

export async function fetchMapillary({ lat, lon, radiusM = 120, limit = 10, signal = null }) {
  const access = await detectMapillaryAccess();
  if (access.mode === 'none') return { photos: [], skipped: access.detail, mode: 'none' };

  const bbox = bboxAround(lat, lon, radiusM).map((n) => n.toFixed(6)).join(',');
  const fields = 'id,thumb_1024_url,thumb_2048_url,captured_at,compass_angle,is_pano,geometry';
  const fetchLimit = String(Math.min(100, Math.max(1, limit * 3)));
  const url = access.mode === 'proxy'
    ? `${MCFG.proxyPath}/images?bbox=${bbox}&limit=${fetchLimit}`
    : `${MCFG.graphUrl}/images?${new URLSearchParams({ access_token: MCFG.clientToken.trim(), fields, bbox, limit: fetchLimit })}`;

  const raw = await mCache.wrap(`${access.mode}:${bbox}:${fetchLimit}`, () => fetchJson(url, {
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

/* ==================================================================== */
/* 3. Agrégation avec élargissement automatique du rayon                 */
/* ==================================================================== */

export async function fetchStreetPhotos({ lat, lon, radiusM, providers = 'both', limit, signal = null, expandIfEmpty = false }) {
  const radius = Number(radiusM) || config.imagery.streetRadiusM;
  const max = Number(limit) || config.imagery.maxStreetPhotos;
  const wanted = providers === 'both' ? ['panoramax', 'mapillary'] : [providers];
  const sources = [];
  let photos = [];

  await Promise.all(wanted.map(async (key) => {
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
        message: result.photos.length ? `${result.photos.length} photo(s)` : `Aucune photo à ${radius} m`,
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
  }));

  photos = photos
    .filter((photo, idx, list) => list.findIndex((item) => item.id === photo.id) === idx)
    .sort((a, b) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9)
      || new Date(b.capturedAt || 0) - new Date(a.capturedAt || 0))
    .slice(0, max);

  const fallbackRadius = config.imagery.streetFallbackRadiusM;
  if (expandIfEmpty && !photos.length && radius < fallbackRadius && !signal?.aborted) {
    return fetchStreetPhotos({ lat, lon, radiusM: fallbackRadius, providers, limit: max, signal, expandIfEmpty: false });
  }

  return { photos, sources, radiusM: radius };
}

/* ==================================================================== */
/* 4. Cadrage orienté vers la façade                                     */
/* ==================================================================== */

export const PANO_ZOOM = 2.8;

export function bearingDeg(latA, lonA, latB, lonB) {
  const rad = (deg) => (Number(deg) * Math.PI) / 180;
  const phi1 = rad(latA);
  const phi2 = rad(latB);
  const dLon = rad(lonB - lonA);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function panoFrame(photo, target) {
  if (!photo?.isPano) return null;
  const azimuth = Number.isFinite(photo.direction) ? ((photo.direction % 360) + 360) % 360 : null;
  let x = 0.5;
  if (Number.isFinite(photo.lat) && Number.isFinite(photo.lon)
    && Number.isFinite(target?.lat) && Number.isFinite(target?.lon)) {
    const bearing = bearingDeg(photo.lat, photo.lon, target.lat, target.lon);
    const delta = azimuth == null ? 0 : ((bearing - azimuth + 540) % 360) - 180;
    x = 0.5 + delta / 360;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
  }
  const half = 0.5 / PANO_ZOOM;
  const clamped = Math.min(1 - half, Math.max(half, x));
  return {
    widthPct: PANO_ZOOM * 100,
    leftPct: (0.5 - clamped * PANO_ZOOM) * 100,
  };
}

export function pickStreetPhotoIndex(photos, target) {
  if (!Array.isArray(photos) || !photos.length) return 0;
  const hasTarget = Number.isFinite(target?.lat) && Number.isFinite(target?.lon);
  let best = 0;
  let bestScore = Infinity;
  photos.forEach((photo, position) => {
    let score = Number.isFinite(photo?.distanceM) ? photo.distanceM : 400;
    if (hasTarget && !photo?.isPano && Number.isFinite(photo?.direction)
      && Number.isFinite(photo?.lat) && Number.isFinite(photo?.lon)) {
      const bearing = bearingDeg(photo.lat, photo.lon, target.lat, target.lon);
      const delta = Math.abs(((bearing - photo.direction + 540) % 360) - 180);
      if (delta > 60) score += (delta - 60) * 2;
    }
    if (score < bestScore) { bestScore = score; best = position; }
  });
  return best;
}

export function streetPhotoView(photo, { index = 0, total = 1, target = null } = {}) {
  if (!photo || typeof photo !== 'object') return null;
  const url = safeUrl(photo.fullUrl || photo.thumbUrl);
  if (!url) return null;

  const credit = [photo.providerName || 'Panoramax'];
  if (photo.author) credit.push(photo.author);
  const captured = photo.capturedAt ? formatDateFr(photo.capturedAt) : '';
  if (captured) credit.push(captured);
  if (Number.isFinite(photo.distanceM)) credit.push(`${photo.distanceM} m`);

  const count = Math.max(1, Number(total) || 1);
  const position = Math.min(Math.max(Number(index) || 0, 0), count - 1);

  return {
    url,
    thumbUrl: safeUrl(photo.thumbUrl) || url,
    isPano: Boolean(photo.isPano),
    credit: credit.join(' · '),
    pageUrl: safeUrl(photo.pageUrl) || '',
    counter: `${position + 1} / ${count}`,
    alt: `Vue de la rue — ${photo.providerName || 'Panoramax'}${captured ? ` (${captured})` : ''}`,
    pano: panoFrame(photo, target),
    index: position,
    total: count,
  };
}
