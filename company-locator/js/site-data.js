/**
 * site-data.js — Emprises de bâtiments BD TOPO® IGN et altimétrie RGE ALTI.
 *
 * Requêtes vectorielles bornées (aucune URL libre), avec bascule automatique
 * du relais local vers la Géoplateforme IGN (CORS ouvert).
 */

export const SITE_SOURCES = ['batiments'];

export function siteUrl(source, lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!SITE_SOURCES.includes(source) || !Number.isFinite(la) || !Number.isFinite(lo)
    || Math.abs(la) > 85 || Math.abs(lo) > 180) {
    throw new Error('Point ou source invalide');
  }
  const r = 80; // rayon de 80 m autour de l'adresse
  const dy = r / 111320;
  const dx = dy / Math.cos((la * Math.PI) / 180);
  const bbox = [lo - dx, la - dy, lo + dx, la + dy].join(',');
  const params = new URLSearchParams({
    service: 'WFS',
    version: '1.0.0',
    request: 'GetFeature',
    typeName: 'BDTOPO_V3:batiment',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    bbox: `${bbox},EPSG:4326`,
    maxFeatures: '120',
  });
  return `https://data.geopf.fr/wfs/ows?${params}`;
}

export function altitudeUrl(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    throw new Error('Coordonnées invalides');
  }
  const params = new URLSearchParams({
    lon: lo.toFixed(6),
    lat: la.toFixed(6),
    resource: 'ign_rge_alti_wld',
    delimiter: '|',
    zonly: 'true',
  });
  return `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?${params}`;
}

const buildingCache = new Map();
const altitudeCache = new Map();

async function fetchJsonTimed(url, signal, timeoutMs = 14000) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Service indisponible (HTTP ${response.status})`);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('Délai du service dépassé');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function fetchSiteSource(source, lat, lon, { signal = null, proxy = true, fallbackDirect = true } = {}) {
  const direct = siteUrl(source, lat, lon);
  const key = `${source}:${Number(lat).toFixed(5)}:${Number(lon).toFixed(5)}`;
  const cached = buildingCache.get(key);
  if (cached && Date.now() - cached.time < 300000) return cached.value;

  const relay = `/api/site?${new URLSearchParams({ source, lat: String(lat), lon: String(lon) })}`;
  let value;
  if (!proxy) {
    value = await fetchJsonTimed(direct, signal);
  } else {
    try {
      value = await fetchJsonTimed(relay, signal);
    } catch (error) {
      if (!fallbackDirect || signal?.aborted) throw error;
      value = await fetchJsonTimed(direct, signal);
    }
  }
  if (!value || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error('Réponse géographique invalide');
  }
  buildingCache.set(key, { time: Date.now(), value });
  if (buildingCache.size > 60) buildingCache.delete(buildingCache.keys().next().value);
  return value;
}

/** Retourne l'altitude en mètres (entier arrondi) depuis l'IGN RGE ALTI, ou null. */
export async function fetchAltitude(lat, lon, { signal = null, proxy = false } = {}) {
  const direct = altitudeUrl(lat, lon);
  const key = `${Number(lat).toFixed(4)}:${Number(lon).toFixed(4)}`;
  if (altitudeCache.has(key)) return altitudeCache.get(key);

  const primary = proxy ? `/api/altitude?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}` : direct;
  const secondary = proxy ? direct : `/api/altitude?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`;
  let data = null;
  try {
    data = await fetchJsonTimed(primary, signal, 9000);
  } catch {
    if (signal?.aborted) return null;
    try { data = await fetchJsonTimed(secondary, signal, 9000); } catch { return null; }
  }
  const raw = Array.isArray(data?.elevations) ? Number(data.elevations[0]) : NaN;
  if (!Number.isFinite(raw) || raw < -500 || raw > 9000) return null;
  const alt = Math.round(raw);
  altitudeCache.set(key, alt);
  return alt;
}
