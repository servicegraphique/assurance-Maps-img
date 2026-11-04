/**
 * Tests unitaires — transport.js : correspondance URL publique ↔ relais local,
 * refus des origines non déclarées, et comportement hors navigateur.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { toProxyUrl, detectProxy, fetchServiceJson, transportLabel, transportInternals } from '../../js/transport.js';
import { ERR } from '../../js/utils.js';

test('toProxyUrl : API entreprises', () => {
  assert.equal(
    toProxyUrl('entreprises', 'https://recherche-entreprises.api.gouv.fr/search?q=axa&code_postal=69002'),
    '/api/proxy/entreprises/search?q=axa&code_postal=69002',
  );
});

test('toProxyUrl : géocodage (préfixe /geocodage retiré)', () => {
  assert.equal(
    toProxyUrl('geocoding', 'https://data.geopf.fr/geocodage/search?q=paris'),
    '/api/proxy/geocodage/search?q=paris',
  );
  assert.equal(
    toProxyUrl('geocoding', 'https://data.geopf.fr/geocodage/reverse?lat=48&lon=2'),
    '/api/proxy/geocodage/reverse?lat=48&lon=2',
  );
});

test('toProxyUrl : Panoramax (préfixe /api retiré)', () => {
  assert.equal(
    toProxyUrl('panoramax', 'https://api.panoramax.xyz/api/search?limit=5'),
    '/api/proxy/panoramax/search?limit=5',
  );
});

test('toProxyUrl : origine étrangère refusée (pas de proxy ouvert)', () => {
  assert.equal(toProxyUrl('entreprises', 'https://evil.example.com/search'), null);
  assert.equal(toProxyUrl('geocoding', 'https://api-adresse.data.gouv.fr/search/?q=x'), null);
  assert.equal(toProxyUrl('inconnu', 'https://data.geopf.fr/geocodage/search'), null);
  assert.equal(toProxyUrl('entreprises', 'pas une url'), null);
});

test('detectProxy : hors navigateur, aucun relais disponible', async () => {
  const state = await detectProxy({ force: true });
  assert.equal(state.available, false);
  assert.match(transportLabel(), /serveur statique|détection/i);
});

test('fetchServiceJson : hors navigateur, appel direct à l\'URL publique', async () => {
  const original = global.fetch;
  const called = [];
  global.fetch = async (url) => {
    called.push(String(url));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const data = await fetchServiceJson('entreprises', 'https://recherche-entreprises.api.gouv.fr/search?q=test', { retries: 0 });
    assert.deepEqual(data, { ok: true });
    assert.deepEqual(called, ['https://recherche-entreprises.api.gouv.fr/search?q=test']);
  } finally {
    global.fetch = original;
  }
});

test('fetchServiceJson : erreur HTTP métier remontée sans mascarade', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ detail: '3 caractères minimum' }), { status: 400 });
  try {
    await assert.rejects(
      () => fetchServiceJson('entreprises', 'https://recherche-entreprises.api.gouv.fr/search?q=a', { retries: 0 }),
      (error) => error.code === ERR.HTTP_CLIENT && /3 caractères/.test(error.userMessage),
    );
  } finally {
    global.fetch = original;
  }
});

test('transportInternals.resetTransportState remet la détection à zéro', () => {
  transportInternals.resetTransportState();
  assert.equal(transportLabel(), 'détection du serveur local…');
});
