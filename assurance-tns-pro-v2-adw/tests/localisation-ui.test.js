'use strict';

/* Tests d'intégration DOM (jsdom) du module de localisation.
 * Les appels réseau sont simulés : aucun accès Internet n'est nécessaire. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CORE = fs.readFileSync(path.join(ROOT, 'localisation-core.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'localisation.js'), 'utf8');

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function geopfPayload() {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [2.33115, 48.868989] },
      properties: {
        label: '12 Rue de la Paix 75002 Paris',
        type: 'housenumber',
        housenumber: '12',
        street: 'Rue de la Paix',
        postcode: '75002',
        city: 'Paris',
        score: 0.96
      }
    }]
  };
}

function panoramaxPayload() {
  return {
    features: [{
      id: 'photo-1',
      geometry: { type: 'Point', coordinates: [2.3312, 48.86899] },
      assets: {
        thumb: { href: 'https://exemple.test/panoramax-thumb.jpg' },
        sd: { href: 'https://exemple.test/panoramax.jpg' }
      },
      providers: [{ name: 'Photographe Test' }],
      properties: { 'geovisio:status': 'ready', license: 'CC-BY-SA-4.0', datetime: '2025-03-30T11:57:23Z' },
      links: [{ rel: 'license', href: 'https://creativecommons.org/licenses/by-sa/4.0/' }]
    }]
  };
}

function commonsPayload() {
  return {
    query: {
      pages: {
        '42': {
          title: 'File:Facade immeuble.jpg',
          coordinates: [{ lat: 48.8690, lon: 2.3312 }],
          imageinfo: [{
            url: 'https://exemple.test/commons.jpg',
            thumburl: 'https://exemple.test/commons-800.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Facade_immeuble.jpg',
            extmetadata: { LicenseShortName: { value: 'CC BY 4.0' }, Artist: { value: 'Auteur Test' } }
          }]
        }
      }
    }
  };
}

function makeFetch(routes) {
  return function fakeFetch(url) {
    const target = String(url);
    const key = Object.keys(routes).find((needle) => target.includes(needle));
    if (!key) {
      return Promise.reject(new Error('Requête inattendue : ' + target));
    }
    const body = typeof routes[key] === 'function' ? routes[key]() : routes[key];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body)
    });
  };
}

async function createPage(routes, config) {
  const dom = new JSDOM(HTML, {
    url: 'https://lp.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.fetch = makeFetch(routes || {});
  if (config) window.LOCALISATION_CONFIG = config;
  window.eval(CORE);
  window.eval(UI);
  if (!window.LocalisationEntreprise) {
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  }
  await wait(10);
  return { dom, window, document: window.document };
}

function openSearch(window, block) {
  window.LocalisationEntreprise.open(block);
  return window.document.getElementById('loc-modal-' + block);
}

function fillForm(modal, values) {
  Object.keys(values).forEach((name) => {
    const field = modal.querySelector('[name="' + name + '"]');
    assert.ok(field, 'champ absent : ' + name);
    field.value = values[name];
  });
}

function submitForm(window, modal) {
  const form = modal.querySelector('form');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

function hiddenValue(document, name) {
  const input = document.querySelector('#wf-form-Assurance-TNS-Pro-Form input[name="' + name + '"]');
  return input ? input.value : null;
}

test('le module s’initialise et crée les champs cachés du lead', async () => {
  const { window, document } = await createPage();
  assert.ok(window.LocalisationEntreprise);
  assert.equal(typeof window.LocalisationEntreprise.getLeadFields, 'function');
  assert.ok(document.querySelector('#loc-section'));
  assert.equal(hiddenValue(document, 'loc_adresse'), '');
  assert.equal(hiddenValue(document, 'loc_batiment_validee'), 'non');
  assert.equal(document.querySelectorAll('.loc-modal').length, 2);
  assert.equal(document.querySelector('[data-loc-badge]').textContent, 'À compléter');
});

test('la modale s’ouvre avec le pays par défaut et l’entreprise pré-remplie', async () => {
  const { window, document } = await createPage();
  document.querySelector('#wf-form-Assurance-TNS-Pro-Form input[name="societe"]').value = 'Dupont & Fils';
  const modal = openSearch(window, 'localisation');
  assert.equal(modal.hidden, false);
  assert.equal(modal.querySelector('[name="countryCode"]').value, 'FR');
  assert.equal(modal.querySelector('[name="company"]').value, 'Dupont & Fils');
  assert.equal(modal.querySelector('[data-loc-submit]').textContent, 'Lancer la recherche');
});

test('la recherche bloque une saisie invalide sans appel réseau', async () => {
  let calls = 0;
  const { window, document } = await createPage({
    'data.geopf.fr': () => { calls += 1; return geopfPayload(); }
  });
  const modal = openSearch(window, 'localisation');
  fillForm(modal, { street: '12 rue de la Paix', postcode: '7500', city: '' });
  submitForm(window, modal);
  await wait(20);
  assert.equal(calls, 0);
  assert.equal(modal.querySelector('[data-field="city"]').getAttribute('data-invalid'), '1');
  assert.equal(modal.querySelector('[data-field="postcode"]').getAttribute('data-invalid'), '1');
  assert.equal(modal.querySelector('[data-loc-error]').hidden, false);
});

test('une recherche valide affiche les résultats et enregistre l’adresse', async () => {
  const { window, document } = await createPage({
    'data.geopf.fr': geopfPayload(),
    'photon.komoot.io': { features: [] }
  });
  const modal = openSearch(window, 'localisation');
  fillForm(modal, { street: '12 rue de la Paix', postcode: '75002', city: 'Paris' });
  submitForm(window, modal);
  await wait(40);

  assert.equal(modal.querySelector('[data-loc-results]').hidden, false);
  const results = modal.querySelectorAll('.loc-result');
  assert.equal(results.length, 1);
  assert.match(results[0].textContent, /12 Rue de la Paix/);
  assert.match(results[0].textContent, /Base Adresse Nationale/);

  modal.querySelector('[data-loc-use]').click();
  await wait(20);

  assert.equal(modal.hidden, true);
  const address = document.querySelector('[data-loc-bloc="localisation"] [data-loc-address]');
  assert.equal(address.textContent, '12 Rue de la Paix 75002 Paris');
  const coords = document.querySelector('[data-loc-bloc="localisation"] [data-loc-coords]');
  assert.match(coords.textContent, /Lat\. 48\.868989 · Lon\. 2\.331150/);
  const status = document.querySelector('[data-loc-bloc="localisation"] [data-loc-status]');
  assert.match(status.textContent, /Adresse trouvée/);
  assert.equal(hiddenValue(document, 'loc_latitude'), '48.868989');
  assert.equal(hiddenValue(document, 'loc_validee'), 'non');
});

test('le bouton Valider enregistre la localisation', async () => {
  const { window, document } = await createPage({
    'data.geopf.fr': geopfPayload(),
    'photon.komoot.io': { features: [] }
  });
  const modal = openSearch(window, 'localisation');
  fillForm(modal, { street: '12 rue de la Paix', postcode: '75002', city: 'Paris' });
  submitForm(window, modal);
  await wait(40);
  modal.querySelector('[data-loc-use]').click();
  await wait(20);

  const validate = document.querySelector('[data-loc-bloc="localisation"] [data-loc-validate]');
  validate.click();
  await wait(10);

  assert.equal(validate.getAttribute('aria-pressed'), 'true');
  assert.ok(validate.classList.contains('loc-btn--validated'));
  assert.equal(document.querySelector('[data-loc-bloc="localisation"] [data-loc-badge]').textContent, 'Validée');
  assert.equal(hiddenValue(document, 'loc_validee'), 'oui');
  assert.equal(hiddenValue(document, 'loc_adresse'), '12 Rue de la Paix 75002 Paris');
  assert.match(document.querySelector('[data-loc-bloc="localisation"] [data-loc-status]').textContent, /Localisation validée/);
});

test('le bouton Suivant est bloqué tant que les deux blocs ne sont pas validés', async () => {
  const { window, document } = await createPage();
  const section = document.querySelector('#loc-section');
  const nextBtn = section.querySelector('[data-form="next-btn"]');
  let wizardNext = 0;
  nextBtn.addEventListener('click', (event) => {
    wizardNext += 1;
    event.preventDefault();
  });

  nextBtn.click();
  await wait(10);
  assert.equal(wizardNext, 0, 'la navigation ne doit pas être déclenchée');
  const gate = section.querySelector('[data-loc-gate]');
  assert.equal(gate.hidden, false);
  assert.match(gate.textContent, /Localisation/);
  assert.match(gate.textContent, /Bâtiment/);
  assert.equal(document.querySelector('[data-loc-bloc="localisation"]').getAttribute('data-attention'), '1');

  section.querySelector('[data-loc-skip]').click();
  await wait(10);
  assert.equal(gate.hidden, true);
  assert.equal(wizardNext, 1, 'le lien de poursuite doit laisser passer une fois');
});

test('le bloc bâtiment charge une photo Panoramax, permet la vue aérienne et se valide', async () => {
  const { window, document } = await createPage({
    'data.geopf.fr': geopfPayload(),
    'photon.komoot.io': { features: [] },
    'api.panoramax.xyz': panoramaxPayload(),
    'commons.wikimedia.org': { query: { pages: {} } }
  });
  const modal = openSearch(window, 'batiment');
  fillForm(modal, { street: '12 rue de la Paix', postcode: '75002', city: 'Paris' });
  submitForm(window, modal);
  await wait(60);
  modal.querySelector('[data-loc-use]').click();
  await wait(80);

  const img = document.querySelector('[data-loc-bloc="batiment"] [data-loc-photo]');
  assert.equal(img.hidden, false);
  assert.equal(img.getAttribute('src'), 'https://exemple.test/panoramax-thumb.jpg');
  const credit = document.querySelector('[data-loc-bloc="batiment"] [data-loc-credit]');
  assert.match(credit.textContent, /Photographe Test/);
  assert.match(credit.textContent, /CC-BY-SA-4.0/);
  assert.match(credit.textContent, /ouvrir la source/);
  assert.equal(hiddenValue(document, 'loc_batiment_photo'), 'https://exemple.test/panoramax.jpg');
  assert.equal(hiddenValue(document, 'loc_batiment_vue'), 'facade');

  // Bascule en vue aérienne
  document.querySelector('[data-loc-bloc="batiment"] [data-loc-view="aerienne"]').click();
  await wait(20);
  assert.equal(hiddenValue(document, 'loc_batiment_vue'), 'vue aerienne');
  const aerial = document.querySelector('[data-loc-bloc="batiment"] [data-loc-map="batiment"]');
  assert.equal(aerial.hidden, false);
  assert.ok(aerial.querySelector('.loc-map__fallback'), 'repli cartographique attendu sans Leaflet');

  // Validation du bâtiment
  document.querySelector('[data-loc-bloc="batiment"] [data-loc-validate]').click();
  await wait(10);
  assert.equal(hiddenValue(document, 'loc_batiment_validee'), 'oui');
  assert.equal(document.querySelector('[data-loc-bloc="batiment"] [data-loc-badge]').textContent, 'Validée');
  assert.match(document.querySelector('[data-loc-bloc="batiment"] [data-loc-status]').textContent, /Bâtiment validé/);
});

test('sans photo disponible, la vue aérienne est proposée automatiquement', async () => {
  const { window, document } = await createPage({
    'data.geopf.fr': geopfPayload(),
    'photon.komoot.io': { features: [] },
    'api.panoramax.xyz': { features: [] },
    'commons.wikimedia.org': { query: { pages: {} } }
  });
  const modal = openSearch(window, 'batiment');
  fillForm(modal, { street: '12 rue de la Paix', postcode: '75002', city: 'Paris' });
  submitForm(window, modal);
  await wait(60);
  modal.querySelector('[data-loc-use]').click();
  await wait(80);

  const panel = document.querySelector('[data-loc-bloc="batiment"]');
  assert.equal(hiddenValue(document, 'loc_batiment_vue'), 'vue aerienne');
  assert.equal(panel.querySelector('[data-loc-map="batiment"]').hidden, false);
  assert.match(panel.querySelector('[data-loc-status]').textContent, /vue aérienne/i);

  panel.querySelector('[data-loc-validate]').click();
  await wait(10);
  assert.equal(hiddenValue(document, 'loc_batiment_validee'), 'oui');
  assert.equal(hiddenValue(document, 'loc_batiment_vue'), 'vue aerienne');
});

test('les données validées sont conservées dans le stockage local', async () => {
  const routes = {
    'data.geopf.fr': geopfPayload(),
    'photon.komoot.io': { features: [] }
  };
  const first = await createPage(routes);
  const modal = openSearch(first.window, 'localisation');
  fillForm(modal, { street: '12 rue de la Paix', postcode: '75002', city: 'Paris' });
  submitForm(first.window, modal);
  await wait(40);
  modal.querySelector('[data-loc-use]').click();
  await wait(20);
  first.document.querySelector('[data-loc-bloc="localisation"] [data-loc-validate]').click();
  await wait(20);

  const stored = first.window.localStorage.getItem('cpro_loc_entreprise_v1');
  assert.ok(stored, 'état attendu dans localStorage');
  const parsed = JSON.parse(stored);
  assert.equal(parsed.localisation.address.label, '12 Rue de la Paix 75002 Paris');
  assert.equal(parsed.localisation.validated, true);

  // Une nouvelle page reprend l'état enregistré
  const second = await createPage(routes);
  second.window.localStorage.setItem('cpro_loc_entreprise_v1', stored);
  second.window.LocalisationEntreprise.reset();
  const restored = second.window.LocCore.parseState(stored);
  assert.equal(restored.localisation.validated, true);
  assert.equal(restored.localisation.address.postcode, '75002');
});

test('les fournisseurs indisponibles produisent un message d’erreur explicite', async () => {
  const { window, document } = await createPage({});
  window.fetch = () => Promise.reject(new Error('réseau coupé'));
  const modal = openSearch(window, 'localisation');
  fillForm(modal, { street: '1 rue Inconnue', postcode: '75002', city: 'Paris' });
  submitForm(window, modal);
  await wait(60);
  assert.equal(modal.querySelector('[data-loc-error]').hidden, false);
  assert.match(modal.querySelector('[data-loc-error]').textContent, /momentanément indisponible/);
  assert.equal(modal.querySelector('[data-loc-submit]').disabled, false);
});

test('le fond de carte par défaut évite le serveur de tuiles OSM bloquant', async () => {
  const { window } = await createPage();
  const config = window.LocalisationEntreprise.getConfig();
  assert.match(config.tiles.street, /World_Street_Map/);
  assert.doesNotMatch(config.tiles.street, /tile\.openstreetmap\.org/);
  assert.match(config.tiles.streetFallback, /tile\.openstreetmap\.fr/);

  const providers = window.LocalisationEntreprise.getTileProviders();
  assert.equal(providers.length, 2);
  assert.equal(providers[0].url, config.tiles.street);
  assert.match(providers[0].attribution, /Esri/);
  assert.match(providers[1].attribution, /OpenStreetMap/);
});

test('un fournisseur de tuiles sous contrat peut remplacer le fond par défaut', async () => {
  const { window } = await createPage({}, {
    tiles: {
      street: 'https://tuiles.exemple.test/{z}/{x}/{y}.png',
      streetAttribution: 'Tuiles Exemple',
      streetFallback: ''
    }
  });
  const config = window.LocalisationEntreprise.getConfig();
  assert.equal(config.tiles.street, 'https://tuiles.exemple.test/{z}/{x}/{y}.png');
  const providers = window.LocalisationEntreprise.getTileProviders();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].url, 'https://tuiles.exemple.test/{z}/{x}/{y}.png');
  assert.equal(providers[0].attribution, 'Tuiles Exemple');
});
