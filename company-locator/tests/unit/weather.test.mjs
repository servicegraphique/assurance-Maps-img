import test from 'node:test';
import assert from 'node:assert/strict';
import { weatherUrl, fetchWeather, photosForPeriod, weatherDescription } from '../../js/weather-data.js';

test('Météo : URL fixe, 14 jours, unités et coordonnées bornées', () => {
  const url = new URL(weatherUrl(48.84274, 6.06908));
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('past_days'), '14');
  assert.equal(url.searchParams.get('latitude'), '48.84274');
  assert.equal(url.searchParams.get('longitude'), '6.06908');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.throws(() => weatherUrl(91, 2));
  assert.equal(weatherDescription(63), 'Pluie');
});

test('Filtrage des photos : date réelle, fuseau local et refus des dates futures', () => {
  const photos = [
    { id: 1, capturedAt: '2025-01-01T23:30:00Z', thumbUrl: 'https://a.fr/x' },
    { id: 2, capturedAt: '', thumbUrl: 'https://a.fr/x' },
    { id: 3, capturedAt: '2030-01-02T10:00:00Z', thumbUrl: 'https://a.fr/x' },
    { id: 4, capturedAt: '2025-01-02T10:00:00Z' },
  ];
  assert.deepEqual(photosForPeriod(photos, '2025-01-02', '2025-01-02', 'Europe/Paris', Date.parse('2026-01-01')), [photos[0]]);
  assert.deepEqual(photosForPeriod(photos, null, null, 'Europe/Paris'), []);
});

test('Le client utilise le relais et signale les réponses erronées', async () => {
  const original = globalThis.fetch;
  try {
    let requested = '';
    globalThis.fetch = async url => { requested = url; return Response.json({ current: { time: '2025-01-15T12:00' }, daily: { time: [] }, timezone: 'Europe/Paris' }); };
    const value = await fetchWeather(48, 2);
    assert.match(requested, /^\/api\/weather\?/);
    assert.equal(value.timezone, 'Europe/Paris');
    globalThis.fetch = async () => new Response('error', { status: 503 });
    await assert.rejects(fetchWeather(48, 2), /503/);
  } finally { globalThis.fetch = original; }
});
