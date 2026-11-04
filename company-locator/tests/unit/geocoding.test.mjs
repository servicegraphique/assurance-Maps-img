/**
 * Tests unitaires — geocoding.js : qualité et honnêteté de la position.
 * Vérifie notamment qu'aucune coordonnée n'est inventée et que la précision
 * annoncée correspond réellement à la donnée disponible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  cleanAddressQuery, resolvePosition, geocodeAddress, resolveCommune, reverseGeocode,
  PRECISION, precisionLabel,
} from '../../js/geocoding.js';
import { ERR } from '../../js/utils.js';

const ban = JSON.parse(readFileSync(new URL('../fixtures/ban-search.json', import.meta.url), 'utf8'));
const banCommune = JSON.parse(readFileSync(new URL('../fixtures/ban-commune.json', import.meta.url), 'utf8'));

const jsonResponse = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

function mockFetch(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

function feature(type, score, coords, extra = {}) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: coords },
    properties: {
      label: extra.label || 'Adresse test', score, type, id: extra.id || 'x',
      postcode: extra.postcode || '75015', city: 'Paris', citycode: '75115', ...extra,
    },
  };
}

test('cleanAddressQuery retire CEDEX, CS et BP', () => {
  assert.equal(cleanAddressQuery('15 RUE DE VAUGIRARD CS 72809 75015 PARIS CEDEX 15'), '15 RUE DE VAUGIRARD 75015 PARIS');
  assert.equal(cleanAddressQuery('  10  rue   de la Paix (bât A) '), '10 rue de la Paix bât A');
});

test('geocodeAddress : tri par score et filtrage des coordonnées hors France', async () => {
  const restore = mockFetch(async () => jsonResponse({
    features: [
      feature('street', 0.6, [2.30, 48.84]),
      feature('housenumber', 0.95, [2.3001, 48.8412]),
      feature('housenumber', 0.99, [139.69, 35.68]), // Tokyo : rejeté
    ],
  }));
  try {
    const results = await geocodeAddress('adresse de tri 75015 Paris');
    assert.equal(results.length, 2);
    assert.equal(results[0].score, 0.95);
    assert.equal(results[0].type, 'housenumber');
  } finally { restore(); }
});

test('geocodeAddress : requête trop courte → aucun appel', async () => {
  let called = false;
  const restore = mockFetch(async () => { called = true; return jsonResponse(ban); });
  try {
    assert.deepEqual(await geocodeAddress('ab'), []);
    assert.equal(called, false);
  } finally { restore(); }
});

test('resolvePosition : BAN niveau adresse → position précise', async () => {
  const restore = mockFetch(async () => jsonResponse(ban));
  try {
    const position = await resolvePosition({
      siret: '1', adresse: '15 RUE DE VAUGIRARD 75015 PARIS', codePostal: '75015',
      latitude: 48.841234, longitude: 2.300123,
    });
    assert.equal(position.precision, PRECISION.ADRESSE);
    assert.equal(position.confidence, 'haute');
    assert.ok(position.source.includes('Base Adresse Nationale'));
    assert.ok(Math.abs(position.lat - 48.84123) < 1e-6);
    assert.equal(position.warnings.length, 0);
  } finally { restore(); }
});

test('resolvePosition : confirmation par geo_id de SIRENE', async () => {
  const restore = mockFetch(async () => jsonResponse(ban));
  try {
    const position = await resolvePosition({
      siret: '2', adresse: '15 rue de vaugirard 75015 paris', codePostal: '75015',
      geoId: '75115_9575_00015', latitude: 48.841234, longitude: 2.300123,
    });
    assert.equal(position.confidence, 'haute');
    assert.match(position.source, /confirmée par le géocodage SIRENE/);
  } finally { restore(); }
});

test('resolvePosition : BAN imprécis → on conserve SIRENE en le signalant', async () => {
  const restore = mockFetch(async () => jsonResponse({ features: [feature('street', 0.62, [2.31, 48.85])] }));
  try {
    const position = await resolvePosition({
      siret: '3', adresse: 'voie inconnue 75015 paris', codePostal: '75015',
      latitude: 48.841234, longitude: 2.300123,
    });
    assert.equal(position.precision, PRECISION.SIRENE);
    assert.equal(position.confidence, 'faible');
    assert.equal(position.lat, 48.841234);
    assert.ok(position.warnings.length >= 1);
  } finally { restore(); }
});

test('resolvePosition : divergence SIRENE / BAN > 300 m → avertissement', async () => {
  const restore = mockFetch(async () => jsonResponse({
    features: [feature('housenumber', 0.91, [2.3500, 48.8600], { label: 'Adresse lointaine' })],
  }));
  try {
    const position = await resolvePosition({
      siret: '4', adresse: 'adresse divergente 75015 paris', codePostal: '75015',
      latitude: 48.841234, longitude: 2.300123,
    });
    assert.equal(position.precision, PRECISION.ADRESSE);
    assert.ok(position.divergenceM > 300);
    assert.ok(position.warnings.some((w) => /distantes de/.test(w)));
  } finally { restore(); }
});

test('resolvePosition : sans SIRENE, BAN commune → précision annoncée faible', async () => {
  const restore = mockFetch(async () => jsonResponse({
    features: [feature('municipality', 0.88, [2.3522, 48.8566], { label: 'Paris' })],
  }));
  try {
    const position = await resolvePosition({ siret: '5', adresse: 'commune seule 75015 paris', codePostal: '75015' });
    assert.equal(position.precision, PRECISION.COMMUNE);
    assert.equal(position.confidence, 'faible');
    assert.ok(position.warnings.some((w) => /centre de la commune/.test(w)));
  } finally { restore(); }
});

test('resolvePosition : aucune donnée → erreur explicite, aucune coordonnée inventée', async () => {
  const restore = mockFetch(async () => jsonResponse({ features: [] }));
  try {
    await assert.rejects(
      () => resolvePosition({ siret: '6', adresse: 'introuvable 75015 paris', codePostal: '75015' }),
      (error) => error.code === ERR.NO_COORDS && /indisponibles/i.test(error.userMessage),
    );
  } finally { restore(); }
});

test('resolvePosition : établissement non diffusible → message dédié, pas d\'appel BAN', async () => {
  let called = false;
  const restore = mockFetch(async () => { called = true; return jsonResponse(ban); });
  try {
    await assert.rejects(
      () => resolvePosition({ siret: '7', adresse: '', nonDiffusible: true }),
      (error) => error.code === ERR.NO_COORDS && /non diffusible/i.test(error.userMessage),
    );
    assert.equal(called, false);
  } finally { restore(); }
});

test('resolvePosition : échec du géocodeur mais SIRENE disponible → repli documenté', async () => {
  const restore = mockFetch(async () => new Response('boom', { status: 500 }));
  try {
    const position = await resolvePosition({
      siret: '8', adresse: 'panne geocodeur 75015 paris', codePostal: '75015',
      latitude: 48.841234, longitude: 2.300123,
    });
    assert.equal(position.lat, 48.841234);
    assert.ok(position.banError, 'l\'échec BAN est conservé et affichable');
  } finally { restore(); }
});

test('resolveCommune : renvoie le code INSEE exploitable par l\'API entreprises', async () => {
  const restore = mockFetch(async () => jsonResponse(banCommune));
  try {
    const commune = await resolveCommune('Paris');
    assert.equal(commune.codeCommune, '75056');
    assert.equal(commune.commune, 'Paris');
  } finally { restore(); }
});

test('reverseGeocode : normalisation du résultat', async () => {
  const restore = mockFetch(async () => jsonResponse(ban));
  try {
    const result = await reverseGeocode(48.84123, 2.30012);
    assert.equal(result.type, 'housenumber');
    assert.ok(result.label.length > 0);
  } finally { restore(); }
});

test('precisionLabel : libellés explicites pour l\'utilisateur', () => {
  assert.match(precisionLabel(PRECISION.ADRESSE), /numéro/);
  assert.match(precisionLabel(PRECISION.COMMUNE), /approximatif/);
  assert.match(precisionLabel('autre'), /inconnue/i);
});
