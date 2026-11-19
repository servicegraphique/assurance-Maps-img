/**
 * weather-data.js — Météo actuelle, altitude et rayonnement solaire (Open-Meteo).
 *
 * URL bornée partageable entre client et serveur local (`/api/weather`), avec
 * bascule automatique vers l'API directe (CORS ouvert) si le relais échoue.
 */

export function weatherUrl(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
    throw new Error('Coordonnées invalides');
  }
  const params = new URLSearchParams({
    latitude: String(la),
    longitude: String(lo),
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day',
    daily: 'shortwave_radiation_sum',
    forecast_days: '1',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

async function fetchOnce(url, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Service météo indisponible (HTTP ${response.status})`);
    const data = await response.json();
    if (!data?.current || typeof data.current.time !== 'string') {
      throw new Error('Réponse météo incomplète');
    }
    return data;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function fetchWeather(lat, lon, { signal = null, proxy = true, fallbackDirect = true } = {}) {
  const direct = weatherUrl(lat, lon);
  const relay = `/api/weather?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}`;
  if (!proxy) return fetchOnce(direct, signal);
  try {
    return await fetchOnce(relay, signal);
  } catch (error) {
    if (!fallbackDirect || signal?.aborted) throw error;
    return fetchOnce(direct, signal);
  }
}

/** Libellé français précis du code météo OMM (WMO). */
export function weatherDescription(code) {
  if (code === 0) return 'Ciel dégagé';
  if (code === 1) return 'Peu nuageux';
  if (code === 2) return 'Partiellement nuageux';
  if (code === 3) return 'Couvert';
  if ([45, 48].includes(code)) return 'Brouillard';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Bruine';
  if ([61, 80].includes(code)) return 'Pluie faible';
  if ([63, 66, 81].includes(code)) return 'Pluie';
  if ([65, 67, 82].includes(code)) return 'Forte pluie';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Neige';
  if ([95, 96, 99].includes(code)) return 'Orage';
  return 'Conditions variables';
}

/** Catégorie d'icône météo pour le rendu SVG. */
export function weatherIconKind(code, isDay = 1) {
  if (code === 0) return isDay === 0 ? 'clear-night' : 'sunny';
  if (code === 1 || code === 2) return 'partly-cloudy';
  if (code === 3) return 'cloudy';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'storm';
  return 'partly-cloudy';
}

/** Direction cardinale française sur 8 secteurs (N, NE, E, SE, S, SO, O, NO). */
export function windCardinalFr(degrees) {
  const num = Number(degrees);
  if (!Number.isFinite(num)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const normalized = ((num % 360) + 360) % 360;
  return dirs[Math.round(normalized / 45) % 8];
}

/** « 2026-07-29T11:45 » → « 29/07/2026 11:45 ». */
export function formatWeatherTimestamp(isoLocal) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(isoLocal ?? ''));
  if (!match) return '—';
  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
}
