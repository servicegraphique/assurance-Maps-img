import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { measure } from '../../js/site-measure.js';
import { siteUrl, fetchSiteSource } from '../../js/site-data.js';
const context = {}; runInNewContext(readFileSync(new URL('../../vendor/turf/turf.min.js', import.meta.url), 'utf8'), context);
const turf = context.turf;

const polygon = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[2,48],[2.0002,48],[2.0002,48.0001],[2,48.0001],[2,48]]] } };
test('Surface, périmètre et rectangle orienté sont cohérents et la pente reste une estimation', () => {
  const m = measure(polygon, turf, 30);
  assert.ok(m.surface > 160 && m.surface < 180);
  assert.ok(m.perimetre > 50 && m.perimetre < 60);
  assert.ok(m.longueur > m.largeur && m.largeur > 10);
  assert.ok(Math.abs(m.surfaceToit / m.surface - 1 / Math.cos(Math.PI / 6)) < 1e-10);
  assert.throws(() => measure(polygon, turf, 90));
});
test('Le périmètre inclut les trous et les multipolygones', () => {
  const hole = [[2.00004,48.00002],[2.00008,48.00002],[2.00008,48.00004],[2.00004,48.00004],[2.00004,48.00002]];
  const withHole = { ...polygon, geometry: { type: 'Polygon', coordinates: [polygon.geometry.coordinates[0], hole] } };
  assert.ok(measure(withHole, turf).surface < measure(polygon, turf).surface);
  assert.ok(measure(withHole, turf).perimetre > measure(polygon, turf).perimetre);
  const multi = { ...polygon, geometry: { type: 'MultiPolygon', coordinates: [polygon.geometry.coordinates, polygon.geometry.coordinates] } };
  assert.ok(Math.abs(measure(multi, turf).surface - 2 * measure(polygon, turf).surface) < 0.001);
});
test('Les requêtes sont bornées et respectent longitude puis latitude', () => {
  const url = new URL(siteUrl('batiments', 48.84274, 6.06908));
  assert.equal(url.searchParams.get('version'), '1.0.0');
  const bbox = url.searchParams.get('bbox').split(',').map(Number);
  assert.ok(bbox[0] < 6.06908 && bbox[2] > 6.06908 && bbox[1] < 48.84274 && bbox[3] > 48.84274);
  const geom = JSON.parse(new URL(siteUrl('parcelle', 48.84274, 6.06908)).searchParams.get('geom'));
  assert.deepEqual(geom.coordinates, [6.06908,48.84274]);
  assert.match(new URL(siteUrl('parkings',48.84274,6.06908)).searchParams.get('data'), /around:150,48.84274,6.06908/);
  assert.throws(() => siteUrl('autre', 48, 2));
});
test('Cache et erreurs du service sont explicites', async () => {
  const original = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] })); };
    await fetchSiteSource('parcelle', 48.12345, 2.12345);
    await fetchSiteSource('parcelle', 48.12345, 2.12345);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response('error', { status: 503 });
    await assert.rejects(fetchSiteSource('batiments', 48.12345, 2.12345), /503/);
  } finally { globalThis.fetch = original; }
});
