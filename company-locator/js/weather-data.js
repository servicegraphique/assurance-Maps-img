/** URL Open-Meteo fixée et bornée, partageable entre client et relais. */
export function weatherUrl(lat, lon) {
  lat = Number(lat); lon = Number(lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Coordonnées invalides');
  const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max', past_days: '14', forecast_days: '1', timezone: 'auto' });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

export async function fetchWeather(lat, lon, { signal, proxy = true } = {}) {
  const direct = weatherUrl(lat, lon);
  const url = proxy ? `/api/weather?${new URLSearchParams({ lat: String(lat), lon: String(lon) })}` : direct;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Service météo indisponible (HTTP ${response.status})`);
    const data = await response.json();
    if (!Array.isArray(data.daily?.time) || !data.current?.time || !data.timezone) throw new Error('Réponse météo incomplète');
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function weatherDescription(code) {
  if (code === 0) return 'Ciel dégagé';
  if ([1, 2, 3].includes(code)) return 'Nuages variables';
  if ([45, 48].includes(code)) return 'Brouillard';
  if ([51,53,55,56,57].includes(code)) return 'Bruine';
  if ([61,63,65,66,67,80,81,82].includes(code)) return 'Pluie';
  if ([71,73,75,77,85,86].includes(code)) return 'Neige';
  if ([95,96,99].includes(code)) return 'Orage';
  return 'Conditions non renseignées';
}

/** Strictement des prises de vue horodatées et non futures. */
export function photosForPeriod(photos, start, end, timezone, now = Date.now()) {
  if (!start || !end || !timezone) return [];
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return photos.filter(p => {
    if (!p.capturedAt || !p.thumbUrl) return false;
    const time = Date.parse(p.capturedAt);
    if (!Number.isFinite(time) || time > now) return false;
    const parts = Object.fromEntries(formatter.formatToParts(new Date(time)).map(part => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    return date >= start && date <= end;
  }).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}
