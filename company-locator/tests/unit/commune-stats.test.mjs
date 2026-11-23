/**
 * Tests unitaires — Population / Département / Région (commune-stats.js).
 *
 * Vérifie les tables INSEE locales de repli, la résolution depuis les seules
 * données SIRENE, la construction des URLs Géo API et le formatage français
 * de la population.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_DIVISIONS, GEO_API_COMMUNES, communeStatsUrls, divisionFromLocal,
  formatPopulation,
} from '../../js/commune-stats.js';

test('Tables locales : les 101 départements et 18 régions sont embarqués', () => {
  assert.equal(ADMIN_DIVISIONS.departments >= 101, true);
  assert.equal(ADMIN_DIVISIONS.regions >= 18, true);
});

test('divisionFromLocal : code postal → département + région', () => {
  const rognac = divisionFromLocal({ codePostal: '13340', codeCommune: '13081', departement: '13' });
  assert.equal(rognac.deptCode, '13');
  assert.equal(rognac.deptName, 'Bouches-du-Rhône');
  assert.equal(rognac.regionCode, '93');
  assert.equal(rognac.regionName, 'Provence-Alpes-Côte d\'Azur');

  const lille = divisionFromLocal({ codePostal: '59000', codeCommune: '59350' });
  assert.equal(lille.deptCode, '59');
  assert.equal(lille.deptName, 'Nord');
  assert.equal(lille.regionCode, '32');
  assert.equal(lille.regionName, 'Hauts-de-France');
});

test('divisionFromLocal : Corse (2A/2B), DOM et champ region déjà fourni', () => {
  const ajaccio = divisionFromLocal({ codePostal: '20000', codeCommune: '2A004' });
  assert.equal(ajaccio.deptCode, '2A');
  assert.equal(ajaccio.deptName, 'Corse-du-Sud');
  assert.equal(ajaccio.regionCode, '94');
  assert.equal(ajaccio.regionName, 'Corse');

  const mayotte = divisionFromLocal({ codePostal: '97600' });
  assert.equal(mayotte.deptCode, '976');
  assert.equal(mayotte.deptName, 'Mayotte');
  assert.equal(mayotte.regionName, 'Mayotte');

  // SIRENE fournit parfois les codes directement (fixture « region: 11 »)
  const paris = divisionFromLocal({ codePostal: '75015', codeCommune: '75115', departement: '75', region: '11' });
  assert.equal(paris.deptName, 'Paris');
  assert.equal(paris.regionName, 'Île-de-France');

  // Un libellé libre (non code) est conservé tel quel
  const named = divisionFromLocal({ departement: 'Bouches-du-Rhône', region: 'Provence-Alpes-Côte d\'Azur' });
  assert.equal(named.deptName, 'Bouches-du-Rhône');
  assert.equal(named.regionName, 'Provence-Alpes-Côte d\'Azur');
});

test('divisionFromLocal : sans donnée, champs vides (rendu « — »)', () => {
  const empty = divisionFromLocal({});
  assert.equal(empty.deptCode, '');
  assert.equal(empty.deptName, '');
  assert.equal(empty.regionCode, '');
  assert.equal(empty.regionName, '');
});

test('communeStatsUrls : code INSEE en priorité, code postal en repli', () => {
  const both = communeStatsUrls({ codeCommune: '13081', codePostal: '13340' });
  assert.equal(both.length, 2);
  assert.ok(both[0].startsWith(`${GEO_API_COMMUNES}?code=13081&`));
  assert.ok(both[0].includes('fields=nom%2Cpopulation%2Cdepartement%2Cregion'));
  assert.ok(both[1].includes('codePostal=13340'));

  const postalOnly = communeStatsUrls({ codePostal: '75015' });
  assert.equal(postalOnly.length, 1);
  assert.ok(postalOnly[0].includes('codePostal=75015'));

  assert.deepEqual(communeStatsUrls({}), []);
  assert.deepEqual(communeStatsUrls({ codeCommune: 'AB', codePostal: '12' }), []);
});

test('formatPopulation : français (espaces de milliers) et repli « — »', () => {
  assert.equal(formatPopulation(4587), '4 587');
  assert.equal(formatPopulation(2102650), '2 102 650');
  assert.equal(formatPopulation(0), '0');
  assert.equal(formatPopulation(null), '—');
  assert.equal(formatPopulation(undefined), '—');
  assert.equal(formatPopulation('pas-un-nombre'), '—');
  assert.equal(formatPopulation(-5), '—');
});
