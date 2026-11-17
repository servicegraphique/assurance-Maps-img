import { fetchServiceJson } from './transport.js';
import { safeUrl } from './utils.js';

const SOURCE = 'https://earth-search.aws.element84.com/v1/search';
export function satelliteUrl(lat, lon, start, end) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error('Période ou coordonnées invalides');
  return `${SOURCE}?${new URLSearchParams({ collections: 'sentinel-2-l2a', intersects: JSON.stringify({ type: 'Point', coordinates: [lon, lat] }), datetime: `${start}T00:00:00Z/${end}T23:59:59Z`, limit: '15', sortby: '-properties.datetime' })}`;
}

export async function fetchSatellite(lat, lon, start, end, { signal } = {}) {
  const data = await fetchServiceJson('earthsearch', satelliteUrl(lat, lon, start, end), { timeoutMs: 16000, retries: 0, signal });
  if (!Array.isArray(data?.features)) throw new Error('Réponse du catalogue satellite invalide');
  const startMs = Date.parse(`${start}T00:00:00Z`), endMs = Math.min(Date.now(), Date.parse(`${end}T23:59:59Z`));
  return data.features.map(feature => {
    const date = feature?.properties?.datetime;
    const time = Date.parse(date);
    const thumbnail = safeUrl(feature?.assets?.thumbnail?.href);
    // Les miniatures proviennent de ce dépôt public, jamais d'une URL fournie par l'utilisateur.
    if (!thumbnail || new URL(thumbnail).hostname !== 'sentinel-cogs.s3.us-west-2.amazonaws.com' || !Number.isFinite(time) || time < startMs || time > endMs) return null;
    const cloud = feature.properties['eo:cloud_cover'];
    const url = feature.links?.find(link => link.rel === 'self')?.href;
    const source = safeUrl(url);
    return { date, thumbnail, source: source && new URL(source).hostname === 'earth-search.aws.element84.com' ? source : '', cloud: typeof cloud === 'number' && Number.isFinite(cloud) ? cloud : null };
  }).filter(Boolean).sort((a,b) => Date.parse(b.date) - Date.parse(a.date));
}

export function satellitePeriods(now = new Date()) {
  const day = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const at = n => new Date(day - n * 86400000).toISOString().slice(0, 10);
  return { historic: { start: at(14), end: at(7) }, recent: { start: at(6), end: at(0) } };
}
