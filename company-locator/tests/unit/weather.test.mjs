import test from 'node:test';
import assert from 'node:assert/strict';
import {
  weatherUrl, fetchWeather, weatherDescription, weatherIconKind,
  windCardinalFr, formatWeatherTimestamp,
} from '../../js/weather-data.js';

test('Météo actuelle : URL bornée, libellés OMM, direction du vent et horodatage', () => {
  const url = new URL(weatherUrl(43.4538, 5.1921));
  assert.equal(url.origin, 'https://api.open-meteo.com');
  assert.equal(url.searchParams.get('latitude'), '43.4538');
  assert.equal(url.searchParams.get('longitude'), '5.1921');
  assert.equal(url.searchParams.get('forecast_days'), '1');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.match(url.searchParams.get('current'), /wind_direction_10m/);
  assert.throws(() => weatherUrl(91, 2));

  assert.equal(weatherDescription(0), 'Ciel dégagé');
  assert.equal(weatherDescription(2), 'Partiellement nuageux');
  assert.equal(weatherDescription(63), 'Pluie');
  assert.equal(weatherIconKind(2, 1), 'partly-cloudy');
  assert.equal(weatherIconKind(0, 1), 'sunny');
  assert.equal(weatherIconKind(95, 1), 'storm');

  assert.equal(windCardinalFr(0), 'N');
  assert.equal(windCardinalFr(90), 'E');
  assert.equal(windCardinalFr(180), 'S');
  assert.equal(windCardinalFr(270), 'O');
  assert.equal(windCardinalFr(315), 'NO');

  assert.equal(formatWeatherTimestamp('2026-07-29T11:45'), '29/07/2026 11:45');
  assert.equal(formatWeatherTimestamp(''), '—');
});

test('fetchWeather : utilise le relais puis bascule vers Open-Meteo si le relais échoue', async () => {
  const original = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).startsWith('/api/weather')) return new Response('relay down', { status: 502 });
      return Response.json({
        elevation: 45,
        timezone: 'Europe/Paris',
        current: { time: '2026-07-29T11:45', temperature_2m: 26.2, relative_humidity_2m: 52, precipitation: 0, weather_code: 2, wind_speed_10m: 18.1, wind_direction_10m: 268 },
      });
    };
    const data = await fetchWeather(43.4538, 5.1921);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /^\/api\/weather\?/);
    assert.match(calls[1], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
    assert.equal(data.elevation, 45);
    assert.equal(Math.round(data.current.temperature_2m), 26);

    globalThis.fetch = async () => new Response('error', { status: 503 });
    await assert.rejects(fetchWeather(48, 2), /503/);
  } finally {
    globalThis.fetch = original;
  }
});
