/**
 * Tests unitaires — entreprise-api.js : construction de requête et
 * normalisation du schéma officiel (siège, établissements connexes, doublons).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildSearchParams, normalizeEntreprise, normalizeEtablissement, normalizeResponse,
  flattenEtablissements, searchEntreprises, fetchBySiret,
} from '../../js/entreprise-api.js';
import { AppError, ERR } from '../../js/utils.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/recherche-entreprises.json', import.meta.url), 'utf8'));

test('buildSearchParams : nom + code postal', () => {
  const params = buildSearchParams({ nom: 'Allianz', codePostal: '75015', page: 2, perPage: 25 });
  assert.equal(params.get('q'), 'Allianz');
  assert.equal(params.get('code_postal'), '75015');
  assert.equal(params.get('page'), '2');
  assert.equal(params.get('per_page'), '25');
  assert.ok(Number(params.get('limite_matching_etablissements')) >= 1);
});

test('buildSearchParams : per_page plafonné à 25', () => {
  assert.equal(buildSearchParams({ nom: 'test', perPage: 100 }).get('per_page'), '25');
});

test('buildSearchParams : SIREN → syntaxe siren: et SIRET → plein texte', () => {
  assert.equal(buildSearchParams({ identifiant: '732 829 320' }).get('q'), 'siren:732829320');
  assert.equal(buildSearchParams({ identifiant: '13002526500013' }).get('q'), '13002526500013');
});

test('buildSearchParams : identifiant invalide rejeté avant tout appel', () => {
  assert.throws(() => buildSearchParams({ identifiant: '732829321' }), (error) => error.code === ERR.INVALID_INPUT);
  assert.throws(() => buildSearchParams({ identifiant: '1234' }), (error) => error.code === ERR.INVALID_INPUT);
});

test('buildSearchParams : code postal invalide rejeté', () => {
  assert.throws(() => buildSearchParams({ nom: 'test', codePostal: '7501' }), (error) => error.code === ERR.INVALID_INPUT);
  assert.throws(() => buildSearchParams({ nom: 'test', codePostal: '99000' }), (error) => error.code === ERR.INVALID_INPUT);
});

test('buildSearchParams : au moins un critère obligatoire', () => {
  assert.throws(() => buildSearchParams({}), (error) => error.code === ERR.INVALID_INPUT);
  assert.throws(() => buildSearchParams({ page: 3, perPage: 10 }), (error) => error instanceof AppError);
});

test('buildSearchParams : pagination au-delà de 10 000 résultats refusée', () => {
  assert.throws(() => buildSearchParams({ nom: 'test', page: 500, perPage: 25 }), (error) => error.code === ERR.INVALID_INPUT);
});

test('buildSearchParams : code commune et état unité légale', () => {
  const params = buildSearchParams({ nom: 'test', codeCommune: '75115', etatUniteLegale: 'A' });
  assert.equal(params.get('code_commune'), '75115');
  assert.equal(params.get('etat_administratif'), 'A');
});

test('normalizeEntreprise : siège + connexes, déduplication par SIRET', () => {
  const entreprise = normalizeEntreprise(fixture.results[0]);
  assert.equal(entreprise.siren, '732829320');
  assert.equal(entreprise.raisonSociale, 'SOCIETE DE TEST A');
  assert.equal(entreprise.sigle, 'STEA');
  assert.equal(entreprise.nombreEtablissements, 3);
  // 1 siège + 3 connexes dont 1 doublon du siège → 3 établissements uniques.
  assert.equal(entreprise.etablissements.length, 3);
  assert.equal(entreprise.etablissements[0].estSiege, true, 'le siège est placé en tête');
  const sirets = entreprise.etablissements.map((e) => e.siret);
  assert.equal(new Set(sirets).size, sirets.length);
});

test('normalizeEtablissement : champs géographiques et administratifs', () => {
  const entreprise = normalizeEntreprise(fixture.results[0]);
  const siege = entreprise.etablissements.find((e) => e.estSiege);
  assert.equal(siege.codePostal, '75015');
  assert.equal(siege.commune, 'Paris');
  assert.equal(siege.codeCommune, '75115');
  assert.equal(siege.departement, '75');
  assert.equal(siege.region, '11');
  assert.equal(siege.pays, 'France');
  assert.equal(siege.latitude, 48.841234);
  assert.equal(siege.longitude, 2.300123);
  assert.equal(siege.voie, '15 RUE DE VAUGIRARD');
  assert.equal(siege.nomCommercial, 'EXEMPLE VAUGIRARD');
  assert.deepEqual(siege.enseignes, ['EXEMPLE CITY']);
  assert.equal(siege.nomAffiche, 'EXEMPLE CITY');
  assert.equal(siege.estActif, true);
  assert.equal(siege.naf, '47.11D');
  assert.ok(siege.sourceUrl.includes('annuaire-entreprises.data.gouv.fr/etablissement/'));
});

test('normalizeEtablissement : département déduit quand l\'API le masque', () => {
  const entreprise = normalizeEntreprise(fixture.results[0]);
  const secondaire = entreprise.etablissements.find((e) => !e.estSiege && e.etatAdministratif === 'A');
  assert.equal(secondaire.departement, '75', 'déduit du code postal');
  assert.equal(secondaire.voie, '220 RUE DE LA CROIX NIVERT', 'reconstruit depuis l\'adresse brute');
  assert.equal(secondaire.geoAdresse, '', 'champ masqué par l\'API pour les connexes');
});

test('normalizeEtablissement : établissement fermé et non diffusible', () => {
  const entreprise = normalizeEntreprise(fixture.results[0]);
  const ferme = entreprise.etablissements.find((e) => e.etatAdministratif === 'C');
  assert.ok(ferme, 'un établissement fermé est présent');
  assert.equal(ferme.estActif, false);
  assert.equal(ferme.dateFermeture, '2019-06-30');
  assert.equal(ferme.nonDiffusible, true);
  assert.equal(ferme.adresse, '', 'le placeholder [NON-DIFFUSIBLE] est nettoyé');
  assert.equal(ferme.latitude, null);
});

test('normalizeResponse : pagination et métadonnées', () => {
  const result = normalizeResponse(fixture);
  assert.equal(result.totalResults, 2);
  assert.equal(result.totalPages, 1);
  assert.equal(result.page, 1);
  assert.equal(result.entreprises.length, 2);
});

test('flattenEtablissements : liste à plat sans doublon', () => {
  const { entreprises } = normalizeResponse(fixture);
  const rows = flattenEtablissements(entreprises);
  assert.equal(rows.length, 4);
  assert.equal(new Set(rows.map((r) => r.etablissement.siret)).size, 4);
  assert.ok(rows.every((row) => row.entreprise?.siren));
});

test('réponse vide : aucune donnée inventée', () => {
  const result = normalizeResponse({ results: [], total_results: 0, page: 1, per_page: 10, total_pages: 0 });
  assert.equal(result.entreprises.length, 0);
  assert.equal(flattenEtablissements(result.entreprises).length, 0);
});

test('searchEntreprises : appel réel de l\'URL construite (fetch simulé)', async () => {
  const original = global.fetch;
  let calledUrl = '';
  global.fetch = async (url) => {
    calledUrl = String(url);
    return new Response(JSON.stringify(fixture), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const result = await searchEntreprises({ nom: 'SOCIETE DE TEST', codePostal: '75015' }, { useCache: false });
    assert.ok(calledUrl.startsWith('https://recherche-entreprises.api.gouv.fr/search?'));
    assert.ok(calledUrl.includes('code_postal=75015'));
    assert.equal(result.rows.length, 4);
    assert.equal(result.totalResults, 2);
  } finally {
    global.fetch = original;
  }
});

test('fetchBySiret : SIRET invalide rejeté sans appel réseau', async () => {
  await assert.rejects(() => fetchBySiret('1234'), (error) => error.code === ERR.INVALID_INPUT);
});
