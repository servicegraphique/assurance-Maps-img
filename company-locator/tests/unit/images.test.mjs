/**
 * Tests unitaires — images.js : recherche de photographies réelles,
 * normalisation, tri par distance, gestion des indisponibilités et
 * absence totale d'image de substitution.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  fetchPanoramax, fetchMapillary, fetchStreetPhotos, detectMapillaryAccess,
  getComplementaryPhotos, addComplementaryPhoto, removeComplementaryPhoto,
} from '../../js/images.js';
import { purgeUserData } from '../../js/storage.js';
import { ERR } from '../../js/utils.js';

const pnx = JSON.parse(readFileSync(new URL('../fixtures/panoramax-search.json', import.meta.url), 'utf8'));
const mly = JSON.parse(readFileSync(new URL('../fixtures/mapillary-images.json', import.meta.url), 'utf8'));

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
const ORIGIN = { lat: 48.841234, lon: 2.300123 };

function mockFetch(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

test('Panoramax : normalisation STAC, distance, date, licence et lien source', async () => {
  const urls = [];
  const restore = mockFetch(async (url) => { urls.push(String(url)); return jsonResponse(pnx); });
  try {
    const { photos } = await fetchPanoramax({ ...ORIGIN, radiusM: 200, limit: 10 });
    assert.ok(urls[0].includes('api.panoramax.xyz'));
    const params = new URL(urls[0]).searchParams;
    assert.equal(params.get('place_position'), '2.300123,48.841234', 'longitude puis latitude');
    assert.equal(params.get('place_distance'), '0-200');
    assert.equal(photos.length, 2);
    const [first, second] = photos;
    assert.ok(first.distanceM <= second.distanceM, 'tri par distance croissante');
    assert.equal(first.provider, 'panoramax');
    assert.equal(first.isPano, true);
    assert.equal(second.isPano, false);
    assert.equal(first.licence, 'CC-BY-SA-4.0');
    assert.ok(first.capturedAt.startsWith('2024-05-14'));
    assert.ok(first.pageUrl.includes('focus=pic'));
    assert.ok(first.thumbUrl.startsWith('https://'));
  } finally { restore(); }
});

test('Panoramax : rayon respecté (les photos lointaines sont écartées)', async () => {
  const restore = mockFetch(async () => jsonResponse(pnx));
  try {
    const { photos } = await fetchPanoramax({ ...ORIGIN, radiusM: 20, limit: 10 });
    assert.ok(photos.every((photo) => photo.distanceM <= 30));
    assert.equal(photos.length, 1);
  } finally { restore(); }
});

test('Panoramax : repli automatique sur bbox si place_position est refusé', async () => {
  const urls = [];
  const restore = mockFetch(async (url) => {
    const value = String(url);
    urls.push(value);
    if (value.includes('place_position')) return jsonResponse({ message: 'paramètre inconnu' }, 400);
    return jsonResponse(pnx);
  });
  try {
    const { photos } = await fetchPanoramax({ ...ORIGIN, radiusM: 150, limit: 5 });
    assert.ok(urls.some((url) => url.includes('bbox=')));
    assert.equal(photos.length, 2);
  } finally { restore(); }
});

test('Panoramax : réponse vide → aucune photo, aucune invention', async () => {
  const restore = mockFetch(async () => jsonResponse({ type: 'FeatureCollection', features: [] }));
  try {
    const { photos } = await fetchPanoramax({ lat: 43.6045, lon: 1.444, radiusM: 100 });
    assert.deepEqual(photos, []);
  } finally { restore(); }
});

test('Mapillary : sans jeton ni proxy → statut explicite, pas de requête', async () => {
  let graphCalled = false;
  const restore = mockFetch(async (url) => {
    if (String(url).includes('graph.mapillary.com')) graphCalled = true;
    return new Response('not found', { status: 404 });
  });
  try {
    const access = await detectMapillaryAccess({ force: true });
    assert.equal(access.mode, 'none');
    const result = await fetchMapillary({ ...ORIGIN, radiusM: 100 });
    assert.deepEqual(result.photos, []);
    assert.ok(result.skipped);
    assert.equal(graphCalled, false);
  } finally { restore(); }
});

test('Mapillary : proxy configuré → normalisation et distance', async () => {
  const restore = mockFetch(async (url) => {
    const value = String(url);
    if (value.includes('/api/mapillary/status')) return jsonResponse({ configured: true });
    if (value.includes('/api/mapillary/images')) {
      assert.ok(!value.includes('access_token'), 'le jeton ne transite jamais par le navigateur');
      return jsonResponse(mly);
    }
    return new Response('', { status: 404 });
  });
  try {
    const access = await detectMapillaryAccess({ force: true });
    assert.equal(access.mode, 'proxy');
    const { photos } = await fetchMapillary({ ...ORIGIN, radiusM: 300, limit: 10 });
    assert.equal(photos.length, 2);
    assert.equal(photos[0].provider, 'mapillary');
    assert.equal(photos[0].licence, 'CC BY-SA 4.0');
    assert.ok(photos[0].capturedAt.startsWith('2024'));
    assert.ok(photos[0].pageUrl.includes('mapillary.com/app'));
  } finally { restore(); }
});

test('fetchStreetPhotos : agrégation des deux sources et état par fournisseur', async () => {
  const restore = mockFetch(async (url) => {
    const value = String(url);
    if (value.includes('/api/mapillary/status')) return jsonResponse({ configured: true });
    if (value.includes('/api/mapillary/images')) return jsonResponse(mly);
    if (value.includes('panoramax')) return jsonResponse(pnx);
    return new Response('', { status: 404 });
  });
  try {
    await detectMapillaryAccess({ force: true });
    const result = await fetchStreetPhotos({ ...ORIGIN, radiusM: 300, providers: 'both', limit: 10 });
    assert.equal(result.photos.length, 4);
    assert.equal(result.sources.length, 2);
    assert.ok(result.sources.every((source) => source.status === 'ok'));
    assert.ok(result.photos[0].distanceM <= result.photos[result.photos.length - 1].distanceM);
  } finally { restore(); }
});

test('fetchStreetPhotos : une source en panne n\'empêche pas l\'autre', async () => {
  const restore = mockFetch(async (url) => {
    const value = String(url);
    if (value.includes('panoramax')) return new Response('panne', { status: 503 });
    if (value.includes('/api/mapillary/status')) return jsonResponse({ configured: false });
    return new Response('', { status: 404 });
  });
  try {
    await detectMapillaryAccess({ force: true });
    const result = await fetchStreetPhotos({ lat: 44.8378, lon: -0.5792, radiusM: 100, providers: 'both' });
    const panoramax = result.sources.find((source) => source.key === 'panoramax');
    const mapillary = result.sources.find((source) => source.key === 'mapillary');
    assert.equal(panoramax.status, 'error');
    assert.equal(mapillary.status, 'unavailable');
    assert.deepEqual(result.photos, []);
  } finally { restore(); }
});

test('Photos complémentaires : URL et source obligatoires, stockage local', () => {
  purgeUserData();
  const siret = '73282932000017';
  assert.throws(() => addComplementaryPhoto(siret, { url: 'javascript:alert(1)', source: 'X' }), (e) => e.code === ERR.INVALID_INPUT);
  assert.throws(() => addComplementaryPhoto(siret, { url: 'https://exemple.fr/a.jpg', source: '  ' }), (e) => e.code === ERR.INVALID_INPUT);
  addComplementaryPhoto(siret, { url: 'https://exemple.fr/a.jpg', source: 'Site officiel', licence: 'CC BY 4.0' });
  const photos = getComplementaryPhotos(siret);
  assert.equal(photos.length, 1);
  assert.equal(photos[0].author, 'Site officiel');
  assert.equal(photos[0].providerName, 'Photo ajoutée manuellement');
  removeComplementaryPhoto(siret, photos[0].id);
  assert.equal(getComplementaryPhotos(siret).length, 0);
});
