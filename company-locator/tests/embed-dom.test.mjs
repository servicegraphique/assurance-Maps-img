/**
 * Test d'intégration DOM — mode « intégré » (`?embed=1`).
 *
 * Charge réellement index.html avec les paramètres envoyés par le formulaire
 * d'assurance, puis vérifie que le localisateur :
 *   - passe en mode intégré (habillage public masqué) ;
 *   - lance la recherche tout seul à partir du nom de société et du code postal ;
 *   - propose la barre de confirmation de l'entreprise choisie.
 *
 * Exécution : npm run test:embed   (jsdom uniquement, aucun réseau réel)
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (name) => JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures', name), 'utf8'));
const FIXTURES = {
  entreprises: readJson('recherche-entreprises.json'),
  ban: readJson('ban-search.json'),
  commune: readJson('ban-commune.json'),
};

const errors = [];
const posts = [];

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost:8080/?embed=1&nom=Allianz&cp=75015',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;

Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 880; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 420; } });
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { width: 880, height: 420, top: 0, left: 0, right: 880, bottom: 420, x: 0, y: 0, toJSON() { return this; } };
};
window.Element.prototype.scrollIntoView = function scrollIntoView() {};

class FakeImage {
  constructor() { this.onload = null; this.onerror = null; this._src = ''; }
  set src(value) { this._src = value; if (value) setTimeout(() => this.onerror?.({ type: 'error' }), 0); }
  get src() { return this._src; }
}

const define = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('localStorage', window.localStorage);
define('HTMLElement', window.HTMLElement);
define('Element', window.Element);
define('Node', window.Node);
define('Event', window.Event);
define('Image', FakeImage);
define('getComputedStyle', window.getComputedStyle.bind(window));
define('requestAnimationFrame', (callback) => setTimeout(() => callback(Date.now()), 0));
define('cancelAnimationFrame', (id) => clearTimeout(id));
window.Image = FakeImage;
window.URL.createObjectURL = () => 'blob:test';
window.URL.revokeObjectURL = () => {};
window.confirm = () => true;
window.console.error = (...args) => errors.push(args.map(String).join(' '));
window.console.warn = () => {};

// Le parent (formulaire) est simulé : on capture les messages reçus.
Object.defineProperty(window, 'parent', {
  configurable: true,
  value: { postMessage: (message) => posts.push(message) },
});

process.on('uncaughtException', (error) => errors.push(`uncaughtException: ${error.stack || error.message}`));
process.on('unhandledRejection', (error) => errors.push(`unhandledRejection: ${error?.stack || error}`));

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function fakeFetch(input) {
  const url = String(typeof input === 'string' ? input : (input?.href ?? input?.url ?? input));
  if (url.startsWith('/api/health')) {
    return jsonResponse({ ok: true, app: 'Company Locator France', version: '1.0.0', mapillaryConfigured: false });
  }
  if (url.startsWith('/api/proxy/entreprises/search') || url.includes('recherche-entreprises.api.gouv.fr/search')) {
    return jsonResponse(FIXTURES.entreprises);
  }
  if (url.includes('/geocodage/search') || url.includes('/api/proxy/geocodage/search')) {
    return jsonResponse(url.includes('type=municipality') ? FIXTURES.commune : FIXTURES.ban);
  }
  if (url.includes('/geocodage/reverse')) return jsonResponse(FIXTURES.ban);
  if (url.includes('api.panoramax.xyz') || url.startsWith('/api/proxy/panoramax')) {
    return jsonResponse({ features: [] });
  }
  if (url.includes('/api/streetview/status')) return jsonResponse({ configured: false, message: 'Non configuré (test).' });
  if (url.includes('/api/mapillary/status')) return jsonResponse({ configured: false });
  return new Response('not found', { status: 404 });
}

define('fetch', fakeFetch);
window.fetch = fakeFetch;

window.eval(readFileSync(path.join(ROOT, 'vendor/leaflet/leaflet.js'), 'utf8'));

const $ = (selector) => window.document.querySelector(selector);
const $$ = (selector) => [...window.document.querySelectorAll(selector)];
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

const waitFor = async (predicate, label, timeout = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    let value;
    try { value = predicate(); } catch { value = false; }
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Condition non atteinte : ${label}`);
};

const results = [];
const check = (label, fn) => {
  try {
    fn();
    results.push({ ok: true });
    console.log(`  ✔ ${label}`);
  } catch (error) {
    results.push({ ok: false });
    console.error(`  ✘ ${label}\n    ${error.message}`);
  }
};

console.log('\nTest d\'intégration — localisateur en mode iframe (?embed=1)\n');

await import('../js/app.js');
await waitFor(() => $('#results-list .result-item'), 'résultats de la recherche automatique');

check('Le mode intégré est actif et l\'habillage public est masqué', () => {
  assert.ok(window.document.body.classList.contains('is-embed'));
  assert.equal($('#embed-bar').hidden, false);
  assert.ok($('#btn-embed-select').disabled, 'aucune entreprise choisie au départ');
  const css = readFileSync(path.join(ROOT, 'css/embed.css'), 'utf8');
  assert.match(css, /body\.is-embed \.app-header/);
});

check('La recherche part automatiquement du nom et du code postal', () => {
  assert.equal($('#champ-nom').value, 'Allianz');
  assert.equal($('#champ-cp').value, '75015');
  const rows = $$('#results-list .result-item');
  assert.ok(rows.length >= 2, `${rows.length} résultat(s)`);
});

check('Le localisateur annonce sa disponibilité au formulaire parent', () => {
  const ready = posts.find((message) => message.type === 'locator:ready');
  assert.ok(ready, 'message locator:ready envoyé');
  assert.equal(ready.source, 'company-locator');
  const list = posts.filter((message) => message.type === 'locator:results').at(-1);
  assert.ok(list, 'message locator:results envoyé');
  assert.ok(list.payload.count >= 2);
  assert.ok(list.payload.rows[0].siret);
});

// Le visiteur choisit son établissement dans la liste, comme dans le formulaire.
click($('#results-list .result-item'));
await waitFor(() => $('#detail-card').innerHTML.includes('EXEMPLE'), 'fiche de l\'établissement');
// La position GPS est calculée juste après la sélection (BAN) : on attend
// qu'elle soit disponible, comme le fait le visiteur avant de confirmer.
await waitFor(() => !$('#btn-copy-gps').disabled, 'position GPS de l\'établissement');

check('L\'entreprise choisie est transmise au formulaire', () => {
  assert.equal($('#btn-embed-select').disabled, false);
  click($('#btn-embed-select'));
  const selection = posts.filter((message) => message.type === 'locator:selected').at(-1);
  assert.ok(selection, 'message locator:selected envoyé');
  assert.equal(selection.payload.siret.length, 14);
  assert.ok(selection.payload.adresse);
  assert.ok(Number.isFinite(selection.payload.latitude));
  assert.match($('#btn-embed-select').textContent, /transmise/);
});

check('Aucune erreur JavaScript pendant le parcours intégré', () => {
  assert.deepEqual(errors, []);
});

const failed = results.filter((item) => !item.ok).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies.`);
if (failed) process.exitCode = 1;
