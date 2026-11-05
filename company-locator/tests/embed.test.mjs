/**
 * Tests unitaires — js/embed.js : mode intégré (iframe du formulaire).
 *
 * Aucun DOM réel n'est nécessaire : le pont `postMessage` est construit avec
 * une fausse fenêtre, et les fonctions de normalisation sont pures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMBED_TYPES, EMBED_SOURCE, PARENT_SOURCE,
  readEmbedParams, selectionPayload, resultsSummary, createEmbedBridge,
} from '../js/embed.js';

/** Fenêtre simulée : mémorise les messages envoyés au parent. */
function fakeWindow(search = '') {
  const sent = [];
  const listeners = [];
  const classes = new Set();
  return {
    location: { search },
    parent: { postMessage: (message, origin) => sent.push({ message, origin }) },
    document: {
      body: { classList: { add: (name) => classes.add(name) } },
      documentElement: { classList: { add: (name) => classes.add(name) } },
    },
    addEventListener: (type, handler) => listeners.push({ type, handler }),
    removeEventListener: (type, handler) => {
      const index = listeners.findIndex((item) => item.type === type && item.handler === handler);
      if (index >= 0) listeners.splice(index, 1);
    },
    // outils de test
    __sent: sent,
    __classes: classes,
    __listeners: listeners,
    __emit: (data) => listeners.filter((item) => item.type === 'message').forEach((item) => item.handler({ data })),
  };
}

const FICHE = {
  row: {
    etablissement: {
      siret: '73282932000074',
      adresse: '15 RUE DE VAUGIRARD',
      codePostal: '75015',
      commune: 'PARIS',
      naf: '62.01Z',
      nomAffiche: 'EXEMPLE CITY',
      enseignes: ['Exemple City'],
      estSiege: true,
      etatAdministratif: 'A',
    },
    entreprise: { siren: '732829320', nomComplet: 'EXEMPLE CITY SAS' },
  },
  position: { lat: 48.841234, lon: 2.300123, precision: 'adresse', source: 'BAN' },
};

test('Paramètres d\'intégration : lecture, validation et valeur par défaut', () => {
  assert.deepEqual(readEmbedParams(''), { active: false, nom: '', codePostal: '' });
  assert.deepEqual(readEmbedParams('?embed=0&nom=AXA'), { active: false, nom: 'AXA', codePostal: '' });
  const params = readEmbedParams('?embed=1&nom=%20Allianz%20&cp=75015');
  assert.equal(params.active, true);
  assert.equal(params.nom, 'Allianz');
  assert.equal(params.codePostal, '75015');
  // Code postal aberrant : ignoré plutôt qu'envoyé à l'API.
  assert.equal(readEmbedParams('?embed=1&cp=ABC').codePostal, '');
});

test('Charge utile transmise au formulaire : identité, adresse et GPS', () => {
  const payload = selectionPayload(FICHE);
  assert.equal(payload.siret, '73282932000074');
  assert.equal(payload.siren, '732829320');
  assert.equal(payload.nom, 'EXEMPLE CITY');
  assert.equal(payload.enseigne, 'Exemple City');
  assert.equal(payload.adresse, '15 RUE DE VAUGIRARD');
  assert.equal(payload.adresseComplete, '15 RUE DE VAUGIRARD, 75015 PARIS');
  assert.equal(payload.codePostal, '75015');
  assert.equal(payload.latitude, 48.841234);
  assert.equal(payload.longitude, 2.300123);
  assert.equal(payload.estSiege, true);
  assert.match(payload.pageUrl, /annuaire-entreprises\.data\.gouv\.fr\/etablissement\/73282932000074$/);

  // Sans position calculée, on ne fabrique aucune coordonnée.
  const noPosition = selectionPayload({ row: FICHE.row, position: null });
  assert.equal(noPosition.latitude, null);
  assert.equal(noPosition.longitude, null);
  assert.equal(selectionPayload(null).siret, '');
});

test('Résumé des résultats : champs utiles seulement', () => {
  const summary = resultsSummary([
    { etablissement: { siret: '1', nomAffiche: 'A', adresse: 'X', codePostal: '75001', commune: 'PARIS' }, autre: 'ignoré' },
    null,
  ]);
  assert.equal(summary.length, 2);
  assert.deepEqual(Object.keys(summary[0]).sort(), ['adresse', 'codePostal', 'commune', 'nom', 'siret']);
  assert.equal(summary[1].siret, '');
});

test('Pont postMessage : prêt, résultats, erreur et sélection', () => {
  const win = fakeWindow('?embed=1&nom=Allianz&cp=75015');
  const bridge = createEmbedBridge(win);
  assert.equal(bridge.active, true);
  assert.equal(bridge.init(), true);
  assert.ok(win.__classes.has('is-embed'), 'classe is-embed posée sur body et html');
  assert.deepEqual(win.__sent[0].message, { source: EMBED_SOURCE, type: EMBED_TYPES.ready, payload: null });
  assert.equal(win.__sent[0].origin, '*');

  bridge.notifyResults([FICHE.row, FICHE.row]);
  const results = win.__sent.at(-1).message;
  assert.equal(results.type, EMBED_TYPES.results);
  assert.equal(results.payload.count, 2);
  assert.equal(results.payload.rows[0].siret, '73282932000074');

  bridge.notifyError('Recherche impossible');
  assert.equal(win.__sent.at(-1).message.payload.message, 'Recherche impossible');

  assert.equal(bridge.notifySelection(FICHE), true);
  const selection = win.__sent.at(-1).message;
  assert.equal(selection.type, EMBED_TYPES.selected);
  assert.equal(selection.payload.siret, '73282932000074');

  // Fiche vide : rien n'est envoyé, le parent ne reçoit pas de sélection fantôme.
  assert.equal(bridge.notifySelection({ row: {} }), false);
});

test('Pont postMessage : une recherche du formulaire relance le localisateur', () => {
  const win = fakeWindow('?embed=1');
  const bridge = createEmbedBridge(win);
  const received = [];
  bridge.init();
  bridge.onSearch((query) => received.push(query));

  win.__emit({ source: PARENT_SOURCE, type: EMBED_TYPES.search, payload: { nom: ' Renault ', codePostal: '59000' } });
  assert.deepEqual(received, [{ nom: 'Renault', codePostal: '59000' }]);

  // Un message d'une autre origine ou d'un autre type est ignoré.
  win.__emit({ source: 'autre', type: EMBED_TYPES.search, payload: { nom: 'Pirate' } });
  win.__emit({ source: PARENT_SOURCE, type: 'autre', payload: { nom: 'Pirate' } });
  win.__emit(null);
  assert.equal(received.length, 1);

  bridge.dispose();
  win.__emit({ source: PARENT_SOURCE, type: EMBED_TYPES.search, payload: { nom: 'Après dispose' } });
  assert.equal(received.length, 1, 'plus aucun écouteur après dispose');
});

test('Hors mode intégré : le pont ne fait rien', () => {
  const win = fakeWindow('');
  const bridge = createEmbedBridge(win);
  assert.equal(bridge.active, false);
  assert.equal(bridge.init(), false);
  assert.equal(win.__sent.length, 0);
  assert.equal(win.__classes.size, 0);
  assert.equal(win.__listeners.length, 0);
});
