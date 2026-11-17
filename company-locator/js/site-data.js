/** Requêtes vectorielles bornées, coordonnées GeoJSON en longitude, latitude. */
export const SITE_SOURCES = ['batiments', 'parkings', 'parking-ign', 'parcelle'];
export function siteUrl(source, lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!SITE_SOURCES.includes(source) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) throw new Error('Point ou source invalide');
  if (source === 'parcelle') {
    const p = new URLSearchParams({ geom: JSON.stringify({ type: 'Point', coordinates: [lon, lat] }) });
    return `https://apicarto.ign.fr/api/cadastre/parcelle?${p}`;
  }
  if (source === 'parkings') {
    const query = `[out:json][timeout:15];(way["amenity"="parking"](around:150,${lat},${lon});relation["amenity"="parking"](around:150,${lat},${lon}););out geom;`;
    return `https://overpass-api.de/api/interpreter?${new URLSearchParams({ data: query })}`;
  }
  const r = source === 'batiments' ? 60 : 150;
  const dy = r / 111320, dx = dy / Math.cos(lat * Math.PI / 180);
  // WFS 1.0.0 EPSG:4326 utilise l'ordre longitude, latitude.
  const bbox = [lon - dx, lat - dy, lon + dx, lat + dy].join(',');
  const params = new URLSearchParams({ service: 'WFS', version: '1.0.0', request: 'GetFeature', typeName: source === 'batiments' ? 'BDTOPO_V3:batiment' : 'BDTOPO_V3:equipement_de_transport', outputFormat: 'application/json', srsName: 'EPSG:4326', bbox: `${bbox},EPSG:4326`, maxFeatures: '500' });
  return `https://data.geopf.fr/wfs/ows?${params}`;
}

const cache = new Map();
export async function fetchSiteSource(source, lat, lon, { signal, proxy = true } = {}) {
  const direct = siteUrl(source, lat, lon);
  const key = `${source}:${lat.toFixed(5)}:${lon.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < 300000) return cached.value;
  const url = proxy ? `/api/site?${new URLSearchParams({ source, lat: String(lat), lon: String(lon) })}` : direct;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 22000);
  let value;
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Service indisponible (HTTP ${response.status})`);
    value = await response.json();
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('Délai du service dépassé');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
  if (value.error || value.remark) throw new Error('Réponse incomplète ou erreur du service');
  if (source === 'parkings' ? !Array.isArray(value.elements) : value.type !== 'FeatureCollection' || !Array.isArray(value.features)) throw new Error('Réponse géographique invalide');
  cache.set(key, { time: Date.now(), value });
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return value;
}
