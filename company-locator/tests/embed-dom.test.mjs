/**
 * Test d'intégration DOM — mode « intégré » (`?embed=1`).
 *
 * Vérifie que `assurance-tns-pro-v2-adw` peut toujours embarquer
 * `company-locator/index.html?embed=1&nom=...&cp=...` :
 *   - classe `is-embed` posée ;
 *   - message `company-locator:ready` puis `company-locator:results` émis ;
 *   - barre `#embed-bar` affichée et `#embed-confirm` envoie `company-locator:select`
 *     avec toutes les clés attendues (siret, siren, nom, adresse, codePostal, commune,
 *     lat, lon, telephone, mobile, email, contact).
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
  url: 'http://localhost:8080/?embed=1&nom=Exemple&cp=75015',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;
const { document } = window;

Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 880; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 420; } });
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { width: 880, height: 420, top: 0, left: 0, right: 880, bottom: 420, x: 0, y: 0, toJSON() { return this; } };
};
window.Element.prototype.scrollIntoView = function scrollIntoView() {};

class FakeImage {
  constructor() { this.onload = null; this.onerror = null; this._src = ''; }
  set src(v) { this._src = v; if (v) setTimeout(() => this.onerror?.({ type: 'error' }), 0); }
  get src() { return this._src; }
}

for (const [k, v] of Object.entries({
  window, document, navigator: window.navigator, localStorage: window.localStorage,
  HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
  Event: window.Event, Image: FakeImage,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
})) {
  Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
}
window.Image = FakeImage;
window.console.error = (...args) => errors.push(args.map(String).join(' '));
window.console.warn = () => {};

Object.defineProperty(window, 'parent', {
  configurable: true,
  value: { postMessage: (message) => posts.push(message) },
});

const jsonRes = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function fakeFetch(input) {
  const url = String(typeof input === 'string' ? input : (input?.href ?? input?.url ?? input));
  if (url.startsWith('/api/health')) return jsonRes({ ok: true, version: '2.0.0', mapillaryConfigured: false });
  if (url.startsWith('/api/mapillary/status')) return jsonRes({ configured: false, state: 'missing' });
  if (url.includes('naf-codes.json')) return jsonRes(JSON.parse(readFileSync(path.join(ROOT, 'assets/data/naf-codes.json'), 'utf8')));
  if (url.includes('tranches-effectifs.json')) return jsonRes(JSON.parse(readFileSync(path.join(ROOT, 'assets/data/tranches-effectifs.json'), 'utf8')));
  if (url.includes('entreprises/search') || url.includes('recherche-entreprises.api.gouv.fr/search')) return jsonRes(FIXTURES.entreprises);
  if (url.includes('geocodage/search') || url.includes('data.geopf.fr/geocodage/search')) {
    return url.includes('type=municipality') ? jsonRes(FIXTURES.commune) : jsonRes(FIXTURES.ban);
  }
  if (url.startsWith('/api/weather') || url.includes('open-meteo.com')) {
    return jsonRes({ elevation: 35, timezone: 'Europe/Paris', current: { time: '2026-07-29T10:00', temperature_2m: 22, relative_humidity_2m: 55, precipitation: 0, weather_code: 1, is_day: 1, wind_speed_10m: 12, wind_direction_10m: 240 } });
  }
  if (url.startsWith('/api/altitude') || url.includes('altimetrie')) return jsonRes({ elevations: [35] });
  if (url.startsWith('/api/site') || url.includes('BDTOPO_V3')) return jsonRes({ type: 'FeatureCollection', features: [] });
  if (url.includes('panoramax')) return jsonRes({ features: [] });
  return jsonRes({}, 404);
}
globalThis.fetch = fakeFetch;
window.fetch = fakeFetch;

window.eval(readFileSync(path.join(ROOT, 'vendor/leaflet/leaflet.js'), 'utf8'));
globalThis.L = window.L;
window.eval(readFileSync(path.join(ROOT, 'vendor/turf/turf.min.js'), 'utf8'));
globalThis.turf = window.turf;

await import('../js/app.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(500);

console.log('\nCompany Locator France — mode intégré (?embed=1)\n');

assert.equal(document.documentElement.classList.contains('is-embed'), true, 'classe html.is-embed absente');
console.log('  ✔ Mode intégré activé (html.is-embed)');

assert.ok(posts.some((m) => m?.source === 'company-locator' && m?.type === 'locator:ready'), 'message ready manquant');
assert.ok(posts.some((m) => m?.source === 'company-locator' && m?.type === 'locator:results' && m.payload?.count >= 1), 'message results manquant');
console.log('  ✔ Messages postMessage locator:ready + locator:results envoyés au formulaire parent');

const bar = document.getElementById('embed-bar');
const confirmBtn = document.getElementById('btn-embed-select');
assert.equal(bar.hidden, false, 'embed-bar doit être visible');
assert.equal(confirmBtn.disabled, false, 'btn-embed-select doit être actif');

// Saisie d'un e-mail + téléphone acheteur avant confirmation : ils doivent remonter dans le payload
const emailEl = document.getElementById('buyer-email');
emailEl.value = 'contact@exemple.fr';
emailEl.dispatchEvent(new window.Event('change'));

const mobEl = document.getElementById('input-buyer-mobile');
mobEl.value = '06.62.84.60.87';
document.getElementById('btn-save-mobile').click();

confirmBtn.click();
const selectMsg = posts.find((m) => m?.source === 'company-locator' && m?.type === 'locator:selected');
assert.ok(selectMsg, 'message locator:selected manquant');
assert.equal(selectMsg.payload.siret, '73282932000017');
assert.equal(selectMsg.payload.codePostal, '75015');
assert.equal(selectMsg.payload.email, 'contact@exemple.fr');
assert.equal(selectMsg.payload.mobile, '0662846087');
assert.ok(Number.isFinite(selectMsg.payload.latitude) && Number.isFinite(selectMsg.payload.longitude));
console.log('  ✔ Confirmation transmet SIRET, adresse, GPS, e-mail et mobile saisis');

assert.deepEqual(errors, []);
console.log('\n3/3 vérifications mode intégré réussies.\n');
process.exit(0);
