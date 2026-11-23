/**
 * Test d'intégration DOM — Fiche CRM Company Locator France (v2.0.0).
 *
 * Charge réellement index.html + Leaflet + Turf + js/app.js dans jsdom
 * avec des réponses d'API simulées, et vérifie l'intégralité des blocs de
 * la fiche : Coordonnées Acheteurs, Demande de devis, Localisation,
 * Vue satellite, Météo actuelle, Note financière, Consommation d'électricité,
 * Vue de la rue, les 5 cartes d'indicateurs, RAC / Prelead / Génération de lead,
 * Mise en relation, persistance locale et barre de recherche masquable.
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
  panoramax: readJson('panoramax-search.json'),
};

const ROGNAC_FIXTURE = {
  results: [{
    siren: '883292302',
    nom_complet: 'ABIOTECH-MTS',
    nom_raison_sociale: 'ABIOTECH-MTS',
    etat_administratif: 'A',
    activite_principale: '68.20B',
    date_creation: '2020-03-01',
    tranche_effectif_salarie: 'NN',
    dirigeants: [{ nom: 'RICHARD', prenoms: 'MARC', qualite: 'Gérant', type_dirigeant: 'personne physique' }],
    finances: { 2024: { ca: 540000, resultat_net: 48000 }, 2023: { ca: 515000, resultat_net: 44000 } },
    siege: {
      siret: '88329230200014',
      est_siege: true,
      etat_administratif: 'A',
      liste_enseignes: ['2MR'],
      nom_commercial: '2MR',
      numero_voie: '4',
      type_voie: 'RUE',
      libelle_voie: 'DU LAVOIR',
      adresse: '4 RUE DU LAVOIR 13340 ROGNAC',
      code_postal: '13340',
      libelle_commune: 'ROGNAC',
      commune: '13081',
      departement: '13',
      activite_principale: '68.20B',
      date_creation: '2020-03-01',
      latitude: '43.4538',
      longitude: '5.1921',
    },
    matching_etablissements: [],
  }],
  total_results: 1,
  page: 1,
  per_page: 25,
  total_pages: 1,
};

const ROGNAC_BAN = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [5.1921, 43.4538] },
    properties: {
      label: '4 Rue du Lavoir 13340 Rognac',
      score: 0.96,
      type: 'housenumber',
      name: '4 Rue du Lavoir',
      postcode: '13340',
      city: 'Rognac',
      citycode: '13081',
    },
  }],
};

const ROGNAC_BDTOPO = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { usage_1: 'Industriel', hauteur: 8 },
    geometry: {
      type: 'Polygon',
      coordinates: [[[5.19185, 43.45366], [5.19235, 43.45366], [5.19235, 43.45394], [5.19185, 43.45394], [5.19185, 43.45366]]],
    },
  }],
};

const errors = [];
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost:8080/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;
const { document } = window;

Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 400; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 260; } });
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { width: 400, height: 260, top: 0, left: 0, right: 400, bottom: 260, x: 0, y: 0, toJSON() { return this; } };
};
window.Element.prototype.scrollIntoView = function scrollIntoView() {};

class FakeImage {
  constructor() { this.onload = null; this.onerror = null; this._src = ''; }
  set src(v) { this._src = v; if (v) setTimeout(() => this.onload?.({ type: 'load' }), 0); }
  get src() { return this._src; }
}

for (const [k, v] of Object.entries({
  window, document, navigator: window.navigator, localStorage: window.localStorage,
  HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
  Event: window.Event, KeyboardEvent: window.KeyboardEvent, Image: FakeImage,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
})) {
  Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
}
window.Image = FakeImage;
window.console.error = (...args) => errors.push(args.map(String).join(' '));
window.console.warn = () => {};
process.on('uncaughtException', (e) => errors.push(`uncaught: ${e.stack || e}`));
process.on('unhandledRejection', (e) => errors.push(`unhandled: ${e?.stack || e}`));

const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function fakeFetch(input) {
  const url = String(typeof input === 'string' ? input : (input?.href ?? input?.url ?? input));
  if (url.startsWith('/api/health')) return jsonRes({ ok: true, app: 'Company Locator France', version: '2.0.0', mapillaryConfigured: false });
  if (url.startsWith('/api/mapillary/status')) return jsonRes({ configured: false, state: 'missing' });
  if (url.includes('naf-codes.json')) {
    return jsonRes(JSON.parse(readFileSync(path.join(ROOT, 'assets/data/naf-codes.json'), 'utf8')));
  }
  if (url.includes('tranches-effectifs.json')) {
    return jsonRes(JSON.parse(readFileSync(path.join(ROOT, 'assets/data/tranches-effectifs.json'), 'utf8')));
  }
  if (url.includes('entreprises/search') || url.includes('recherche-entreprises.api.gouv.fr/search')) {
    if (url.includes('88329230200014')) return jsonRes(ROGNAC_FIXTURE);
    return jsonRes(FIXTURES.entreprises);
  }
  if (url.includes('geocodage/search') || url.includes('data.geopf.fr/geocodage/search')) {
    if (url.includes('13340') || url.toLowerCase().includes('rognac')) return jsonRes(ROGNAC_BAN);
    return jsonRes(FIXTURES.ban);
  }
  if (url.startsWith('/api/weather') || url.includes('api.open-meteo.com')) {
    return jsonRes({
      elevation: 45,
      timezone: 'Europe/Paris',
      current: {
        time: '2026-07-29T11:45',
        temperature_2m: 26.1,
        relative_humidity_2m: 52,
        precipitation: 0,
        weather_code: 2,
        is_day: 1,
        wind_speed_10m: 18.2,
        wind_direction_10m: 268,
      },
    });
  }
  if (url.startsWith('/api/altitude') || url.includes('altimetrie')) {
    return jsonRes({ elevations: [45.2] });
  }
  if (url.startsWith('/api/site') || url.includes('BDTOPO_V3')) {
    return jsonRes(ROGNAC_BDTOPO);
  }
  if (url.includes('geo.api.gouv.fr/communes')) {
    if (url.includes('code=13081') || url.includes('codePostal=13340')) {
      return jsonRes([{
        code: '13081',
        nom: 'Rognac',
        population: 4587,
        departement: { code: '13', nom: 'Bouches-du-Rhône' },
        region: { code: '93', nom: 'Provence-Alpes-Côte d\'Azur' },
      }]);
    }
    return jsonRes([]);
  }
  if (url.includes('panoramax')) {
    if (url.includes('43.45')) {
      return jsonRes({
        features: [{
          id: 'rognac-pic-1',
          geometry: { type: 'Point', coordinates: [5.1920, 43.4537] },
          assets: {
            sd: { href: 'https://panoramax.example/rognac-sd.jpg' },
            thumb: { href: 'https://panoramax.example/rognac-thumb.jpg' },
          },
          properties: {
            datetime: '2025-06-12T10:15:00Z',
            'view:azimuth': 42,
            'pers:interior_orientation': { field_of_view: 90 },
            'geovisio:producer': 'Contributeur OSM',
            license: 'CC-BY-SA-4.0',
          },
          links: [],
        }],
      });
    }
    return jsonRes(FIXTURES.panoramax);
  }
  return jsonRes({ error: `unexpected ${url}` }, 404);
}
globalThis.fetch = fakeFetch;
window.fetch = fakeFetch;

// Chargement de Leaflet et Turf dans la fenêtre avant app.js
window.eval(readFileSync(path.join(ROOT, 'vendor/leaflet/leaflet.js'), 'utf8'));
globalThis.L = window.L;
window.eval(readFileSync(path.join(ROOT, 'vendor/turf/turf.min.js'), 'utf8'));
globalThis.turf = window.turf;

await import('../js/app.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await wait(450);

const results = [];
async function check(label, fn) {
  try { await fn(); results.push({ ok: true }); console.log(`  ✔ ${label}`); }
  catch (err) { results.push({ ok: false, err }); console.log(`  ✘ ${label}\n      ${err.message}`); }
}

console.log('\nCompany Locator France — intégration DOM fiche CRM\n');

await check('Démarrage sans erreur console et garde __companyLocatorReady levé', () => {
  assert.equal(window.__companyLocatorReady, true);
  assert.deepEqual(errors, []);
});

await check('Coordonnées Acheteurs : société, badge actif, SIRET, NAF, date de création et acheteur', () => {
  assert.equal(document.getElementById('co-name').textContent, 'ABIOTECH-MTS');
  assert.equal(document.getElementById('co-enseigne').textContent, '2MR');
  assert.equal(document.getElementById('co-street').textContent, '4 RUE DU LAVOIR');
  assert.equal(document.getElementById('co-city').textContent, '13340 ROGNAC');
  assert.equal(document.getElementById('co-status').textContent, 'Entreprise active');
  assert.equal(document.getElementById('co-siret').textContent, '88329230200014');
  assert.match(document.getElementById('co-naf').textContent, /^NAF\s+6820B – Location de terrains/i);
  assert.equal(document.getElementById('co-created').textContent, 'Mars 2020');
  assert.equal(document.getElementById('buyer-prenom').value, 'Marc');
  assert.equal(document.getElementById('buyer-nom').value, 'RICHARD');
});

await check('Localisation et Vue satellite : cartes initialisées, coordonnées, altitude et lien Google Earth', () => {
  assert.match(document.getElementById('loc-address').textContent, /4 Rue du Lavoir, 13340 Rognac, France/);
  assert.equal(document.getElementById('loc-coords').textContent, '43.4538° N, 5.1921° E');
  assert.equal(document.getElementById('loc-altitude').textContent, 'Altitude : 45 m');
  assert.match(document.getElementById('btn-google-earth').href, /^https:\/\/earth\.google\.com\/web\/@43\.453800,5\.192100/);
});

await check('Météo actuelle : titre ville+CP, température, vent, humidité, précipitations et MAJ', () => {
  assert.equal(document.getElementById('weather-title').textContent, 'Météo actuelle à Rognac (13340)');
  assert.equal(document.getElementById('weather-temp').textContent, '26°C');
  assert.equal(document.getElementById('weather-desc').textContent, 'Partiellement nuageux');
  assert.equal(document.getElementById('weather-wind').textContent, '18 km/h (O)');
  assert.equal(document.getElementById('weather-humidity').textContent, '52%');
  assert.equal(document.getElementById('weather-precip').textContent, '0 mm');
  assert.equal(document.getElementById('weather-updated').textContent, '29/07/2026 11:45');
});

await check('Note financière et Consommation électrique (12 mois J–D) rendues', () => {
  const score = Number(document.getElementById('fin-score').textContent);
  assert.ok(score >= 70 && score <= 95);
  assert.match(document.getElementById('fin-solvency').textContent, /Bonne|Excellente/);
  assert.equal(document.getElementById('fin-year').textContent, '2024');
  assert.match(document.getElementById('elec-month').textContent, /^\d[\d\s]*$/);
  assert.match(document.getElementById('elec-year').textContent, /^\d[\d\s]*$/);
  assert.equal(document.querySelectorAll('#elec-chart .elec-bar-col').length, 12);
});

await check('Vue de la rue : photo réelle chargée + lien Google Street View', () => {
  const img = document.getElementById('street-img');
  assert.match(img.src, /^https:\/\/panoramax\.example\/rognac-sd\.jpg/);
  img.dispatchEvent(new window.Event('load'));
  assert.equal(img.hidden, false);
  assert.equal(document.getElementById('street-empty').hidden, true);
  assert.match(document.getElementById('btn-street-view').href, /google\.com\/maps/);
});

await check('5 indicateurs de site remplis : surface, solaire, population, département et région', () => {
  assert.match(document.getElementById('kpi-surface-val').textContent, /m²$/);
  assert.equal(document.getElementById('kpi-solar-val').textContent, 'Très bon');
  assert.equal(document.getElementById('kpi-pop-val').textContent, '4 587');
  assert.equal(document.getElementById('kpi-pop-sub').textContent, 'Nbre d\'habitant');
  assert.equal(document.getElementById('kpi-dept-val').textContent, '13');
  assert.equal(document.getElementById('kpi-dept-sub').textContent, 'Bouches-du-Rhône');
  assert.equal(document.getElementById('kpi-region-val').textContent, 'Provence-Alpes-Côte d\'Azur');
  assert.equal(document.getElementById('kpi-region-sub').textContent, 'Code 93');
});

await check('Sections CRM : accordéons RAC/Prelead/Génération, modales, sauvegarde locale et masquage recherche', async () => {
  const racBtn = document.querySelector('[data-accordion="rac"] .crm-accordion-head');
  const racBody = document.getElementById('panel-rac');
  assert.equal(racBody.hidden, true);
  racBtn.click();
  assert.equal(racBody.hidden, false);
  racBtn.click();
  assert.equal(racBody.hidden, true);

  document.getElementById('btn-mise-en-relation').click();
  assert.equal(document.getElementById('crm-modal').hidden, false);
  document.querySelector('[data-close-modal]').click();
  assert.equal(document.getElementById('crm-modal').hidden, true);

  const { crmSheets } = await import('../js/storage.js');
  const web = document.getElementById('co-website');
  web.value = 'https://abiotech-mts.fr';
  web.dispatchEvent(new window.Event('change'));
  assert.equal(crmSheets.get('88329230200014').website, 'https://abiotech-mts.fr');

  document.getElementById('btn-hide-search').click();
  assert.equal(document.getElementById('search-toolbar').hidden, true);
  assert.equal(document.getElementById('btn-show-search').hidden, false);
  document.getElementById('btn-show-search').click();
  assert.equal(document.getElementById('search-toolbar').hidden, false);
});

await check('Recherche d’une autre société via la barre du haut', async () => {
  const q = document.getElementById('champ-recherche');
  q.value = 'Exemple';
  document.getElementById('search-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(450);
  assert.equal(document.getElementById('co-siret').textContent, '73282932000017');
  assert.deepEqual(errors, []);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications DOM réussies.\n`);
process.exit(failed.length ? 1 : 0);
