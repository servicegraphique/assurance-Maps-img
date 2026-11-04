/**
 * Tests unitaires — export.js (CSV/GeoJSON) et storage.js (persistance,
 * historique opt-in, fiches enregistrées, photos sourcées).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { toCsv, csvCell, toGeoJson, ficheFields, RESULT_COLUMNS, addressText, gpsText } from '../../js/export.js';
import { normalizeResponse, flattenEtablissements } from '../../js/entreprise-api.js';
import { settings, history, favorites, userPhotos, storageInfo, purgeUserData, store } from '../../js/storage.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/recherche-entreprises.json', import.meta.url), 'utf8'));
const rows = flattenEtablissements(normalizeResponse(fixture).entreprises);

/* ------------------------------ CSV -------------------------------- */

test('csvCell : échappement des guillemets et séparateurs', () => {
  assert.equal(csvCell('simple'), 'simple');
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell('dit "bonjour"'), '"dit ""bonjour"""');
  assert.equal(csvCell('ligne1\nligne2'), '"ligne1\nligne2"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(42), '42');
});

test('csvCell : neutralise l\'injection de formule Excel', () => {
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('+33612345678'), "'+33612345678");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
});

test('toCsv : BOM UTF-8, séparateur ; et CRLF (Excel FR)', () => {
  const csv = toCsv([{ a: '1', b: '2' }], [{ key: 'a', label: 'Col A' }, { key: 'b', label: 'Col B' }]);
  assert.ok(csv.startsWith('\uFEFF'), 'BOM présent pour Excel');
  assert.ok(csv.includes('Col A;Col B'));
  assert.ok(csv.includes('1;2'));
  assert.ok(csv.endsWith('\r\n'));
});

test('toCsv : colonnes avec fonction de transformation', () => {
  const csv = toCsv(rows, RESULT_COLUMNS);
  const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
  assert.equal(lines.length, rows.length + 1);
  assert.ok(lines[0].includes('SIREN'));
  assert.ok(lines[0].includes('SIRET'));
  assert.ok(lines[0].includes('Latitude'));
  // Les SIRET sont exportés en chiffres bruts (pas d'espaces insécables).
  assert.ok(lines[1].includes(rows[0].etablissement.siret));
});

test('addressText et gpsText', () => {
  const siege = rows[0].etablissement;
  assert.ok(addressText(siege).includes('75015'));
  assert.equal(gpsText({ lat: 48.841234, lon: 2.300123 }), '48.841234, 2.300123');
  assert.equal(gpsText(null), '');
});

/* ---------------------------- GeoJSON ------------------------------ */

test('toGeoJson : uniquement les établissements géolocalisés, ordre lon/lat', () => {
  const geojson = toGeoJson(rows);
  assert.equal(geojson.type, 'FeatureCollection');
  assert.equal(geojson.features.length, 3, 'l\'établissement sans coordonnées est exclu');
  const [lon, lat] = geojson.features[0].geometry.coordinates;
  assert.ok(lon > 2 && lon < 3);
  assert.ok(lat > 48 && lat < 49);
  assert.equal(geojson.features[0].properties.siret, rows[0].etablissement.siret);
  assert.equal(geojson.metadata.crs, 'EPSG:4326');
});

test('toGeoJson : positions recalculées prioritaires sur SIRENE', () => {
  const positions = new Map([[rows[0].etablissement.siret, { lat: 48.9, lon: 2.4, precision: 'adresse', source: 'BAN' }]]);
  const geojson = toGeoJson(rows, positions);
  const feature = geojson.features.find((f) => f.properties.siret === rows[0].etablissement.siret);
  assert.deepEqual(feature.geometry.coordinates, [2.4, 48.9]);
  assert.equal(feature.properties.precision, 'adresse');
});

/* ------------------------- Fiche détaillée ------------------------- */

test('ficheFields : champs renseignés + source systématique', () => {
  const fields = ficheFields({
    etablissement: rows[0].etablissement,
    entreprise: rows[0].entreprise,
    position: { lat: 48.84123, lon: 2.30012, precision: 'adresse', source: 'Base Adresse Nationale', label: '15 Rue de Vaugirard', score: 0.93, divergenceM: 4 },
  });
  assert.ok(fields.length > 20);
  assert.ok(fields.every(([champ, valeur, source]) => champ && valeur !== '' && source !== undefined));
  const map = Object.fromEntries(fields.map(([champ, valeur]) => [champ, valeur]));
  assert.equal(map.SIREN, '732 829 320');
  assert.equal(map['Code postal'], '75015');
  assert.equal(map.Latitude, 48.84123);
  assert.ok(map['Lien OpenStreetMap'].startsWith('https://www.openstreetmap.org/'));
});

/* ---------------------------- Stockage ----------------------------- */

test('settings : valeurs par défaut puis persistance', () => {
  settings.reset();
  assert.equal(settings.get().historyEnabled, false, 'historique désactivé par défaut');
  settings.set({ perPage: 25 });
  assert.equal(settings.get().perPage, 25);
  settings.reset();
  assert.equal(settings.get().perPage, 10);
});

test('history : rien n\'est écrit tant que l\'utilisateur n\'a pas accepté', () => {
  purgeUserData();
  settings.set({ historyEnabled: false });
  history.addSearch({ criteria: { nom: 'Test' }, totalResults: 3 });
  history.addView({ siret: '73282932000017', nom: 'Test' });
  assert.equal(history.listSearches().length, 0);
  assert.equal(history.listViews().length, 0);
});

test('history : activé, les recherches sont mémorisées et dédupliquées', () => {
  purgeUserData();
  settings.set({ historyEnabled: true });
  history.addSearch({ criteria: { nom: 'Allianz', codePostal: '75015' }, totalResults: 5 });
  history.addSearch({ criteria: { nom: 'Allianz', codePostal: '75015' }, totalResults: 5 });
  history.addSearch({ criteria: { nom: 'AXA', codePostal: '69002' }, totalResults: 2 });
  assert.equal(history.listSearches().length, 2);
  assert.equal(history.listSearches()[0].criteria.nom, 'AXA', 'la plus récente en tête');
  history.addView({ siret: '73282932000017', nom: 'Test', commune: 'Paris', codePostal: '75015' });
  assert.equal(history.listViews().length, 1);
  history.removeView('73282932000017');
  assert.equal(history.listViews().length, 0);
  history.clearAll();
  assert.equal(history.listSearches().length, 0);
  settings.set({ historyEnabled: false });
});

test('favorites : enregistrement explicite, lecture et suppression', () => {
  purgeUserData();
  const fiche = { etablissement: rows[0].etablissement, entreprise: rows[0].entreprise, position: null };
  favorites.save(fiche);
  assert.equal(favorites.has(rows[0].etablissement.siret), true);
  assert.equal(favorites.list().length, 1);
  assert.ok(favorites.get(rows[0].etablissement.siret).savedAt);
  favorites.save(fiche);
  assert.equal(favorites.list().length, 1, 'pas de doublon');
  favorites.remove(rows[0].etablissement.siret);
  assert.equal(favorites.has(rows[0].etablissement.siret), false);
});

test('userPhotos : source obligatoire, aucune photo anonyme acceptée', () => {
  purgeUserData();
  const siret = rows[0].etablissement.siret;
  assert.equal(userPhotos.add(siret, { url: 'https://exemple.fr/p.jpg', source: '' }), null);
  const photo = userPhotos.add(siret, { url: 'https://exemple.fr/p.jpg', source: 'Site officiel', licence: 'CC BY' });
  assert.ok(photo.id);
  assert.equal(userPhotos.list(siret).length, 1);
  userPhotos.remove(siret, photo.id);
  assert.equal(userPhotos.list(siret).length, 0);
});

test('storageInfo et purge totale', () => {
  settings.set({ historyEnabled: true });
  history.addSearch({ criteria: { nom: 'X' }, totalResults: 1 });
  store.write('cache:test', { value: 1, expires: Date.now() + 10000, storedAt: Date.now() });
  const info = storageInfo();
  assert.ok(info.entries > 0);
  assert.ok(info.cacheEntries >= 1);
  purgeUserData();
  assert.equal(storageInfo().cacheEntries, 0);
  assert.equal(history.listSearches().length, 0);
  settings.set({ historyEnabled: false });
});
