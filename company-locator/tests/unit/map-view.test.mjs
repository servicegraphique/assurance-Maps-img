/**
 * Tests unitaires — premier aperçu de la carte « Localisation » (map.js).
 *
 * Garantit l'affichage demandé : en métropole, la fiche s'ouvre sur la carte
 * de France entière (comme une carte nationale) avec l'épingle du site ;
 * hors métropole, une vue régionale centrée sur le site.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { firstLocationView } from '../../js/map.js';
import config from '../../js/config.js';

const FRANCE_CENTER = config.map.franceCenter;

test('Premier aperçu métropolitain : toute la France (centre Hexagone, zoom 5)', () => {
  for (const [lat, lon] of [
    [48.8566, 2.3522],   // Paris
    [43.4538, 5.1921],   // Rognac (Bouches-du-Rhône)
    [48.39, -4.49],      // Brest
    [41.93, 8.74],       // Ajaccio (Corse)
    [51.03, 2.38],       // Dunkerque
  ]) {
    const view = firstLocationView(lat, lon);
    assert.deepEqual(view.center, FRANCE_CENTER);
    assert.equal(view.zoom, config.map.franceZoom);
  }
});

test('Premier aperçu hors métropole (DROM) : vue régionale centrée sur le site', () => {
  const guadeloupe = firstLocationView(16.26, -61.55);
  assert.deepEqual(guadeloupe.center, [16.26, -61.55]);
  assert.equal(guadeloupe.zoom, config.map.overseasFirstZoom);

  const reunion = firstLocationView(-20.88, 55.45);
  assert.deepEqual(reunion.center, [-20.88, 55.45]);
});

test('Coordonnées invalides : repli sur la vue France par défaut', () => {
  const view = firstLocationView('pas-un-nombre', null);
  assert.deepEqual(view.center, FRANCE_CENTER);
  assert.equal(view.zoom, config.map.franceZoom);
});
