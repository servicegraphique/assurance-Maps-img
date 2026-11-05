'use strict';

/* Tests de l'étape « Localisez votre entreprise » (localisateur.js).
 *
 * Le localisateur d'entreprises (`company-locator/`) est intégré en iframe :
 * ces tests vérifient la structure de l'étape, la suppression des champs rue
 * et ville, le pont postMessage et le garde-fou avant l'étape suivante.
 * Aucun accès réseau : l'iframe est simulée.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'localisateur.js'), 'utf8');
const LEAD = fs.readFileSync(path.join(ROOT, 'lead-handler.js'), 'utf8');

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const SELECTION = {
  siret: '73282932000074',
  siren: '732829320',
  nom: 'EXEMPLE CITY',
  enseigne: 'Exemple City',
  adresse: '15 RUE DE VAUGIRARD',
  codePostal: '75015',
  commune: 'PARIS',
  adresseComplete: '15 RUE DE VAUGIRARD, 75015 PARIS',
  naf: '62.01Z',
  latitude: 48.841234,
  longitude: 2.300123,
  precision: 'adresse',
  source: 'BAN',
  pageUrl: 'https://annuaire-entreprises.data.gouv.fr/etablissement/73282932000074',
  // Coordonnées saisies dans le localisateur : l'API officielle ne les publie pas.
  telephone: '0123456789',
  mobile: '0612345678',
  email: 'contact@exemple.fr',
  contact: 'Marie Dupont',
};

/**
 * Monte le formulaire réel, rend l'étape localisateur visible et remplace
 * l'iframe par une fenêtre simulée qui capture les messages du parent.
 */
async function mount({ readyTimeoutMs = 5000 } = {}) {
  const dom = new JSDOM(HTML, { url: 'https://assurance-tns-pro-v2-adw.lp.comparateurpro.fr/', runScripts: 'outside-only' });
  const { window } = dom;
  const { document } = window;
  window.console.debug = () => {};

  // jsdom finit d'analyser le document juste après le constructeur : le script
  // s'initialise sur DOMContentLoaded, comme dans le navigateur.
  for (let i = 0; i < 50 && document.readyState !== 'complete'; i += 1) await wait(5);

  // jsdom ne calcule pas la mise en page : on rend l'étape « visible ».
  window.Element.prototype.getClientRects = function getClientRects() { return [{ width: 800, height: 600 }]; };
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.closest && this.closest('[data-form="step"]') ? this.ownerDocument.body : null; },
  });

  const step = document.querySelector('.etape-localisateur');
  const frame = document.getElementById('loc-app');
  const posted = [];
  const childWindow = { postMessage: (message) => posted.push(message) };
  Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => childWindow });

  // Le nom de société et le code postal ont été saisis à l'étape précédente.
  document.querySelector('[name="societe"]').value = 'Exemple City';
  document.querySelector('[name="code_postal"]').value = '75015';

  window.LOCALISATEUR_CONFIG = { readyTimeoutMs };
  window.eval(SCRIPT);
  for (let i = 0; i < 50 && !window.LocalisateurEntreprise; i += 1) await wait(5);

  const emit = (data, source) => {
    const event = new window.MessageEvent('message', { data });
    Object.defineProperty(event, 'source', { configurable: true, value: source || childWindow });
    window.dispatchEvent(event);
  };

  return { dom, window, document, step, frame, posted, childWindow, emit };
}

test('Étape société : les champs rue et ville ne sont plus saisis', () => {
  const dom = new JSDOM(HTML);
  const { document } = dom.window;
  const societe = document.querySelector('[name="societe"]');
  const codePostal = document.querySelector('[name="code_postal"]');
  assert.ok(societe, 'nom de société conservé');
  assert.ok(codePostal, 'code postal conservé');

  const visibleAdresse = [...document.querySelectorAll('[name="adresse"]')].filter((el) => el.type !== 'hidden');
  const visibleVille = [...document.querySelectorAll('[name="ville"]')].filter((el) => el.type !== 'hidden');
  assert.equal(visibleAdresse.length, 0, 'aucun champ « rue » visible');
  assert.equal(visibleVille.length, 0, 'aucun champ « ville » visible');

  // Les valeurs restent disponibles pour les intégrations existantes.
  const hiddenAdresse = [...document.querySelectorAll('[name="adresse"]')].filter((el) => el.type === 'hidden');
  const hiddenVille = [...document.querySelectorAll('[name="ville"]')].filter((el) => el.type === 'hidden');
  assert.equal(hiddenAdresse.length, 1);
  assert.equal(hiddenVille.length, 1);
});

test('Le module de localisation est remplacé par le localisateur intégré', () => {
  assert.doesNotMatch(HTML, /localisation-core\.js/, 'ancien module retiré');
  assert.doesNotMatch(HTML, /localisation\.js/, 'ancien script retiré');
  assert.doesNotMatch(HTML, /localisation\.css/, 'ancienne feuille de style retirée');
  assert.doesNotMatch(HTML, /vendor\/leaflet/, 'Leaflet dupliqué retiré (le localisateur a le sien)');
  assert.match(HTML, /<script src="localisateur\.js" defer><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="localisateur\.css">/);

  // Le localisateur est chargé sans clé, en mode intégré.
  const dom = new JSDOM(HTML);
  const frame = dom.window.document.getElementById('loc-app');
  assert.ok(frame, 'iframe du localisateur présente');
  assert.match(frame.getAttribute('data-src'), /\.\.\/company-locator\/index\.html\?embed=1$/);
  assert.equal(frame.getAttribute('title'), 'Localisateur d’entreprises : recherche et position de votre société');
  assert.equal(frame.getAttribute('src'), null, 'chargement différé : rien avant l’affichage de l’étape');
});

test('La chaîne des étapes reste celle du formulaire', () => {
  const dom = new JSDOM(HTML);
  const { document } = dom.window;
  const societe = document.querySelector('.etape-content[data-answer="code-postal"]');
  assert.equal(societe.getAttribute('data-go-to'), 'localisation');

  const loc = document.getElementById('loc-section');
  assert.equal(loc.getAttribute('data-answer'), 'localisation');
  assert.equal(loc.getAttribute('data-go-to'), 'societe');

  const suivante = document.querySelector('.etape-content[data-answer="societe"]');
  assert.equal(suivante.getAttribute('data-go-to'), 'nom-prenom');
});

test('Le localisateur est chargé avec le nom et le code postal saisis', async () => {
  const { frame } = await mount();
  // L'initialisation pose l'URL de l'iframe (chargement différé).
  assert.match(frame.getAttribute('src'), /^\.\.\/company-locator\/index\.html\?embed=1&nom=Exemple%20City&cp=75015$/);
});

test('Le localisateur reçoit la recherche et renvoie l’entreprise choisie', async () => {
  const { window, document, posted, emit } = await mount();
  const api = window.LocalisateurEntreprise;
  assert.ok(api, 'API publique exposée');
  assert.equal(api.isReady(), false);

  emit({ source: 'company-locator', type: 'locator:ready' });
  assert.equal(api.isReady(), true);
  const search = posted.filter((message) => message.type === 'locator:search').pop();
  // Les objets viennent du contexte jsdom : on les normalise avant comparaison.
  assert.deepEqual(JSON.parse(JSON.stringify(search)), {
    source: 'tns-form',
    type: 'locator:search',
    payload: { nom: 'Exemple City', codePostal: '75015' },
  });

  emit({ source: 'company-locator', type: 'locator:results', payload: { count: 3, rows: [] } });
  assert.match(document.querySelector('[data-loc-status]').textContent, /3 établissements trouvés/);

  emit({ source: 'company-locator', type: 'locator:selected', payload: SELECTION });
  assert.equal(api.isValidated(), true);
  assert.equal(api.getSelection().siret, SELECTION.siret);

  // Champs cachés remplis pour l'envoi du lead.
  const value = (name) => document.querySelector(`[name="${name}"]`).value;
  assert.equal(value('loc_siret'), '73282932000074');
  assert.equal(value('loc_entreprise'), 'EXEMPLE CITY');
  assert.equal(value('loc_adresse'), '15 RUE DE VAUGIRARD, 75015 PARIS');
  assert.equal(value('loc_latitude'), '48.841234');
  assert.equal(value('loc_longitude'), '2.300123');
  assert.equal(value('adresse'), '15 RUE DE VAUGIRARD', 'colonne historique alimentée');
  assert.equal(value('ville'), 'PARIS', 'colonne historique alimentée');

  // Récapitulatif visible et statut positif.
  const recap = document.querySelector('[data-loc-recap]');
  assert.equal(recap.hidden, false);
  assert.match(recap.textContent, /EXEMPLE CITY/);
  assert.match(recap.textContent, /SIRET 73282932000074/);
  assert.match(document.querySelector('[data-loc-status]').textContent, /Entreprise sélectionnée/);

  const fields = api.getLeadFields();
  assert.equal(fields.loc_code_postal, '75015');
  assert.equal(fields.loc_naf, '62.01Z');
  assert.equal(fields.loc_telephone, '0123456789');
  assert.equal(fields.loc_mobile, '0612345678');
  assert.equal(fields.loc_email, 'contact@exemple.fr');
  assert.equal(fields.loc_contact, 'Marie Dupont');
  assert.match(api.getRecap(), /GPS : 48\.841234, 2\.300123/);
  assert.match(api.getRecap(), /Contact : tél\. 01 23 45 67 89 · mobile 06 12 34 56 78 · contact@exemple\.fr · Marie Dupont/);

  // Messages d'une autre fenêtre ignorés.
  const before = api.getSelection().nom;
  emit({ source: 'company-locator', type: 'locator:selected', payload: { ...SELECTION, nom: 'PIRATE' } }, { postMessage() {} });
  assert.equal(api.getSelection().nom, before);
});

test('Sans sélection, l’étape suivante est expliquée avant d’être autorisée', async () => {
  const { window, document, emit } = await mount();
  emit({ source: 'company-locator', type: 'locator:ready' });

  const next = document.querySelector('#loc-section [data-form="next-btn"]');
  const clickEvent = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  next.dispatchEvent(clickEvent);
  assert.equal(clickEvent.defaultPrevented, true, 'navigation bloquée sans sélection');
  assert.equal(document.querySelector('[data-loc-gate]').hidden, false);

  // « Je renseignerai ces informations plus tard » laisse passer.
  document.querySelector('[data-loc-skip]').click();
  assert.equal(document.querySelector('[data-loc-gate]').hidden, true);
  assert.equal(window.LocalisateurEntreprise.isValidated(), false);

  // Une sélection valide débloque la navigation sans garde-fou.
  emit({ source: 'company-locator', type: 'locator:selected', payload: SELECTION });
  const secondClick = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  next.dispatchEvent(secondClick);
  assert.equal(secondClick.defaultPrevented, false, 'navigation libre après sélection');
});

test('Localisateur injoignable : message clair et lien direct', async () => {
  const { document, frame, window } = await mount({ readyTimeoutMs: 20 });
  await wait(80);
  const api = window.LocalisateurEntreprise;
  assert.equal(api.isReady(), false);
  assert.equal(api.isFailed(), true);
  const fallback = document.querySelector('[data-loc-fallback]');
  assert.equal(fallback.hidden, false);
  assert.match(document.querySelector('[data-loc-fallback-text]').textContent, /met trop de temps|impossible/i);
  const link = document.querySelector('[data-loc-fallback-link]');
  assert.match(link.getAttribute('href'), /company-locator\/index\.html/);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(frame.getAttribute('src'), /company-locator/);

  // Le formulaire reste utilisable : on peut continuer sans localisation.
  const next = document.querySelector('#loc-section [data-form="next-btn"]');
  const clickEvent = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  next.dispatchEvent(clickEvent);
  assert.equal(clickEvent.defaultPrevented, true);
  document.querySelector('[data-loc-skip]').click();
  assert.equal(document.querySelector('[data-loc-gate]').hidden, true);
});

test('Le lead reprend l’entreprise choisie (lead-handler)', () => {
  assert.match(LEAD, /window\.LocalisateurEntreprise/);
  assert.doesNotMatch(LEAD, /window\.LocalisationEntreprise/);
  ['loc_entreprise', 'loc_siret', 'loc_siren', 'loc_code_postal', 'loc_commune', 'loc_naf', 'loc_page',
    'loc_telephone', 'loc_mobile', 'loc_email', 'loc_contact']
    .forEach((field) => assert.match(LEAD, new RegExp(`${field}:`), `colonne ${field} transmise`));
});
