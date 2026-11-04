/**
 * Tests unitaires — search.js : validation, pertinence, filtres, tri,
 * replis explicites. Les appels réseau sont simulés par des fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  validateCriteria, readCriteria, hasAnyCriterion, relevanceScore,
  filterRows, sortRows, simplifyName, runSearch, summarize,
} from '../../js/search.js';
import { normalizeResponse, flattenEtablissements } from '../../js/entreprise-api.js';
import { ERR } from '../../js/utils.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/recherche-entreprises.json', import.meta.url), 'utf8'));
const rows = flattenEtablissements(normalizeResponse(fixture).entreprises);

/* ------------------------- Validation ------------------------------ */

test('validateCriteria : au moins un critère', () => {
  const result = validateCriteria(readCriteria({}));
  assert.equal(result.valid, false);
  assert.match(result.message, /au moins un critère/i);
});

test('validateCriteria : code postal seul suffisant', () => {
  assert.equal(validateCriteria(readCriteria({ codePostal: '33000' })).valid, true);
});

test('validateCriteria : nom trop court sans filtre', () => {
  const result = validateCriteria(readCriteria({ nom: 'ab' }));
  assert.equal(result.valid, false);
  assert.equal(result.errors.nom, true);
});

test('validateCriteria : nom court accepté avec un code postal', () => {
  assert.equal(validateCriteria(readCriteria({ nom: 'ab', codePostal: '75015' })).valid, true);
});

test('validateCriteria : identifiants invalides', () => {
  assert.equal(validateCriteria(readCriteria({ identifiant: '732829321' })).errors.identifiant, true);
  assert.equal(validateCriteria(readCriteria({ identifiant: '732829320' })).valid, true);
  assert.equal(validateCriteria(readCriteria({ identifiant: '13002526500013' })).valid, true);
});

test('readCriteria normalise la saisie', () => {
  const criteria = readCriteria({ nom: '  Allianz  ', codePostal: '75015 ', identifiant: '130 025 265 00013' });
  assert.equal(criteria.nom, 'Allianz');
  assert.equal(criteria.codePostal, '75015');
  assert.equal(criteria.identifiant, '13002526500013');
  assert.equal(hasAnyCriterion(criteria), true);
});

/* ------------------------- Pertinence ------------------------------ */

test('relevanceScore : nom exact > nom approché', () => {
  const exact = relevanceScore(rows[0], { nom: 'SOCIETE DE TEST A' });
  const fuzzy = relevanceScore(rows[0], { nom: 'societe de test zzz' });
  assert.ok(exact > fuzzy, `${exact} > ${fuzzy}`);
});

test('relevanceScore : code postal correspondant valorisé', () => {
  const withCp = relevanceScore(rows[0], { codePostal: '75015' });
  const withoutCp = relevanceScore(rows[0], { codePostal: '69002' });
  assert.ok(withCp > withoutCp);
});

test('relevanceScore : l\'adresse saisie départage les établissements', () => {
  const target = rows.find((row) => row.etablissement.adresse.includes('CROIX NIVERT'));
  const other = rows.find((row) => row.etablissement.adresse.includes('VAUGIRARD'));
  const criteria = { nom: 'SOCIETE DE TEST', adresse: '220 rue de la croix nivert' };
  assert.ok(relevanceScore(target, criteria) > relevanceScore(other, criteria));
});

/* --------------------------- Filtres ------------------------------- */

test('filterRows : actifs, fermés, tous', () => {
  assert.equal(filterRows(rows, 'A').every((row) => row.etablissement.estActif), true);
  assert.equal(filterRows(rows, 'C').every((row) => row.etablissement.etatAdministratif === 'C'), true);
  assert.equal(filterRows(rows, 'tous').length, rows.length);
  assert.equal(filterRows(rows, 'A').length, 3);
  assert.equal(filterRows(rows, 'C').length, 1);
});

test('sortRows : tri alphabétique et actifs d\'abord', () => {
  const byName = sortRows(rows, 'nom', {});
  assert.ok(byName[0].entreprise.raisonSociale <= byName[byName.length - 1].entreprise.raisonSociale);
  const byActifs = sortRows(rows, 'actifs', {});
  assert.equal(byActifs[0].etablissement.estActif, true);
  assert.equal(byActifs[byActifs.length - 1].etablissement.estActif, false);
});

test('sortRows : le tableau source n\'est pas muté', () => {
  const copy = [...rows];
  sortRows(rows, 'nom', {});
  assert.deepEqual(rows.map((r) => r.etablissement.siret), copy.map((r) => r.etablissement.siret));
});

test('simplifyName retire les formes juridiques', () => {
  assert.equal(simplifyName('ALLIANZ FRANCE SAS'), 'allianz');
  assert.equal(simplifyName('SARL Dupont & Fils'), 'dupont fils');
  assert.equal(simplifyName('SAS'), '');
});

/* ----------------------- Orchestration ----------------------------- */

function mockFetch(handler) {
  const original = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = original; };
}

const jsonResponse = (payload) => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('runSearch : critères invalides → erreur typée sans réseau', async () => {
  let called = false;
  const restore = mockFetch(async () => { called = true; return jsonResponse(fixture); });
  try {
    await assert.rejects(() => runSearch({}), (error) => error.code === ERR.INVALID_INPUT);
    assert.equal(called, false);
  } finally { restore(); }
});

test('runSearch : nominal, déduplication et résumé', async () => {
  const restore = mockFetch(async () => jsonResponse(fixture));
  try {
    const result = await runSearch({ nom: 'SOCIETE DE TEST', codePostal: '75015' }, { etat: 'A', sort: 'pertinence' });
    assert.equal(result.rows.length, 3);
    assert.equal(result.totalResults, 2);
    assert.equal(new Set(result.rows.map((r) => r.etablissement.siret)).size, 3);
    assert.match(summarize(result), /3 établissements/);
    assert.match(summarize(result), /2 sociétés/);
  } finally { restore(); }
});

test('runSearch : filtre « fermés » ne garde que les établissements cessés', async () => {
  const restore = mockFetch(async () => jsonResponse(fixture));
  try {
    const result = await runSearch({ nom: 'SOCIETE DE TEST', codePostal: '75015' }, { etat: 'C' });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].etablissement.estActif, false);
  } finally { restore(); }
});

test('runSearch : aucun résultat actif → notice explicite', async () => {
  const onlyClosed = JSON.parse(JSON.stringify(fixture));
  onlyClosed.results.forEach((entreprise) => {
    if (entreprise.siege) entreprise.siege.etat_administratif = 'C';
    (entreprise.matching_etablissements || []).forEach((e) => { e.etat_administratif = 'C'; });
  });
  const restore = mockFetch(async () => jsonResponse(onlyClosed));
  try {
    const result = await runSearch({ nom: 'SOCIETE FERMEE', codePostal: '75015' }, { etat: 'A', fuzzy: false });
    assert.equal(result.rows.length, 0);
    assert.ok(result.notices.some((notice) => /tous fermés/i.test(notice.text)));
  } finally { restore(); }
});

test('runSearch : repli approximatif signalé, jamais silencieux', async () => {
  let call = 0;
  const empty = { results: [], total_results: 0, page: 1, per_page: 10, total_pages: 0 };
  const restore = mockFetch(async (url) => {
    call += 1;
    const query = new URL(String(url)).searchParams.get('q') || '';
    if (query === 'Allianzzz France') return jsonResponse(empty);
    if (query === 'allianzzz') return jsonResponse(fixture);
    return jsonResponse(empty);
  });
  try {
    const result = await runSearch({ nom: 'Allianzzz France', codePostal: '75015' }, { etat: 'tous', fuzzy: true });
    assert.ok(call >= 2, 'une seconde passe a été tentée');
    assert.equal(result.relaxed, true);
    assert.ok(result.notices.some((notice) => /élargie|approximative/i.test(notice.text)));
  } finally { restore(); }
});

test('runSearch : sans repli si désactivé', async () => {
  const empty = { results: [], total_results: 0, page: 1, per_page: 10, total_pages: 0 };
  let call = 0;
  const restore = mockFetch(async () => { call += 1; return jsonResponse(empty); });
  try {
    const result = await runSearch({ nom: 'Introuvable SAS', codePostal: '75015' }, { fuzzy: false });
    assert.equal(call, 1);
    assert.equal(result.rows.length, 0);
    assert.equal(result.relaxed, false);
  } finally { restore(); }
});

test('runSearch : ville résolue en code commune INSEE', async () => {
  const commune = JSON.parse(readFileSync(new URL('../fixtures/ban-commune.json', import.meta.url), 'utf8'));
  const urls = [];
  const restore = mockFetch(async (url) => {
    const value = String(url);
    urls.push(value);
    if (value.includes('data.geopf.fr')) return jsonResponse(commune);
    return jsonResponse(fixture);
  });
  try {
    const result = await runSearch({ ville: 'Paris' }, { etat: 'tous' });
    assert.ok(urls.some((url) => url.includes('type=municipality')), 'la commune est résolue via la BAN');
    assert.ok(urls.some((url) => url.includes('code_commune=75056')), 'le filtre INSEE est transmis à l\'API');
    assert.equal(result.resolvedCommune.codeCommune, '75056');
  } finally { restore(); }
});
