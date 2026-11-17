import test from 'node:test';
import assert from 'node:assert/strict';
import { satelliteUrl, satellitePeriods, fetchSatellite } from '../../js/satellite.js';

test('Périodes UTC cohérentes et requête STAC limitée au point', () => {
  const periods = satellitePeriods(new Date('2026-11-17T14:45:00Z'));
  assert.deepEqual(periods, { historic: { start: '2026-11-03', end: '2026-11-10' }, recent: { start: '2026-11-11', end: '2026-11-17' } });
  const url = new URL(satelliteUrl(48.84274, 6.06908, periods.historic.start, periods.historic.end));
  assert.deepEqual(JSON.parse(url.searchParams.get('intersects')).coordinates, [6.06908, 48.84274]);
  assert.equal(url.searchParams.get('collections'), 'sentinel-2-l2a');
  assert.throws(() => satelliteUrl(100, 2, periods.historic.start, periods.historic.end));
});

test('Rejette les scènes hors période, futures, mal datées ou URL non fiables', async () => {
  const original = globalThis.fetch;
  try {
    const feature = (date, host) => ({ properties: { datetime: date, 'eo:cloud_cover': 23 }, assets: { thumbnail: { href: `https://${host}/image.jpg` } }, links: [] });
    globalThis.fetch = async () => Response.json({ features: [
      feature('2020-01-03T11:00:00Z', 'sentinel-cogs.s3.us-west-2.amazonaws.com'),
      feature('2020-01-02T11:00:00Z', 'example.com'),
      feature('2019-01-01T11:00:00Z', 'sentinel-cogs.s3.us-west-2.amazonaws.com'),
      feature('bad-date', 'sentinel-cogs.s3.us-west-2.amazonaws.com'),
    ] });
    const result = await fetchSatellite(48, 2, '2020-01-01', '2020-01-07');
    assert.equal(result.length, 1);
    assert.equal(result[0].date, '2020-01-03T11:00:00Z');
    assert.equal(result[0].cloud, 23);
  } finally { globalThis.fetch = original; }
});
