/**
 * Test d'intégration DOM — charge réellement index.html, Leaflet et js/app.js
 * dans un DOM simulé (jsdom), avec des réponses d'API rejouées depuis les
 * fixtures. Vérifie le parcours complet : recherche → résultats → carte →
 * fiche → géocodage → images → export → paramètres → historique.
 *
 * Exécution : npm run test:dom   (nécessite `npm install`, jsdom uniquement)
 * Aucun réseau réel n'est utilisé.
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
  panoramax: readJson('panoramax-search.json'),
  mapillary: readJson('mapillary-images.json'),
};

const errors = [];
const downloads = [];
const networkCalls = [];

/* ------------------------------------------------------------------ */
/* 1. DOM + globaux navigateur                                         */
/* ------------------------------------------------------------------ */

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost:8080/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;

// jsdom ne calcule pas la mise en page : on donne une taille aux conteneurs
// pour que Leaflet puisse initialiser la carte.
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 900; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 460; } });
window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { width: 900, height: 460, top: 0, left: 0, right: 900, bottom: 460, x: 0, y: 0, toJSON() { return this; } };
};
window.Element.prototype.scrollIntoView = function scrollIntoView() {};

class FakeImage {
  constructor() { this.onload = null; this.onerror = null; this._src = ''; }
  set src(value) {
    this._src = value;
    if (value) setTimeout(() => this.onerror?.({ type: 'error' }), 0);
  }
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
define('FormData', window.FormData);
define('getComputedStyle', window.getComputedStyle.bind(window));
define('requestAnimationFrame', (callback) => setTimeout(() => callback(Date.now()), 0));
define('cancelAnimationFrame', (id) => clearTimeout(id));
window.Image = FakeImage;
window.URL.createObjectURL = () => 'blob:test';
window.URL.revokeObjectURL = () => {};
window.confirm = () => true;
window.console.error = (...args) => errors.push(args.map(String).join(' '));
window.console.warn = () => {};

// Capture des téléchargements (export CSV / GeoJSON / JSON).
window.HTMLAnchorElement.prototype.click = function click() {
  if (this.download) downloads.push(this.download);
};

process.on('uncaughtException', (error) => errors.push(`uncaughtException: ${error.stack || error.message}`));
process.on('unhandledRejection', (error) => errors.push(`unhandledRejection: ${error?.stack || error}`));

/* ------------------------------------------------------------------ */
/* 2. Réseau simulé                                                    */
/* ------------------------------------------------------------------ */

const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'Content-Type': 'application/json' },
});

async function fakeFetch(input) {
  const url = String(typeof input === 'string' ? input : (input?.href ?? input?.url ?? input));
  networkCalls.push(url);

  if (url.startsWith('file://')) {
    const filePath = fileURLToPath(url);
    try {
      return new Response(readFileSync(filePath, 'utf8'), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  }

  if (url.startsWith('/api/health')) {
    return jsonResponse({ ok: true, app: 'Company Locator France', version: '1.0.0', mapillaryConfigured: true });
  }

  if (url.startsWith('/api/proxy/entreprises/search') || url.includes('recherche-entreprises.api.gouv.fr/search')) {
    const params = new URL(url, 'http://localhost:8080').searchParams;
    const q = params.get('q') || '';
    if (q === 'dinum') return jsonResponse({ results: [], total_results: 0, page: 1, per_page: 1, total_pages: 0 });
    if (q.startsWith('siren:')) {
      const siren = q.slice(6);
      const found = FIXTURES.entreprises.results.filter((r) => r.siren === siren);
      return jsonResponse({ ...FIXTURES.entreprises, results: found, total_results: found.length, total_pages: found.length ? 1 : 0 });
    }
    if (/^\d{14}$/.test(q)) {
      const results = FIXTURES.entreprises.results.filter((r) => r.siege?.siret === q
        || (r.matching_etablissements || []).some((e) => e.siret === q));
      return jsonResponse({ ...FIXTURES.entreprises, results, total_results: results.length, total_pages: results.length ? 1 : 0 });
    }
    if (/introuvable|zzzz/i.test(q)) {
      return jsonResponse({ results: [], total_results: 0, page: 1, per_page: 10, total_pages: 0 });
    }
    return jsonResponse(FIXTURES.entreprises);
  }

  if (url.includes('/geocodage/search') || url.includes('/api/proxy/geocodage/search')) {
    return jsonResponse(url.includes('type=municipality') ? FIXTURES.commune : FIXTURES.ban);
  }
  if (url.includes('/geocodage/reverse')) return jsonResponse(FIXTURES.ban);
  if (url.includes('api.panoramax.xyz') || url.startsWith('/api/proxy/panoramax')) return jsonResponse(FIXTURES.panoramax);
  if (url.includes('/api/streetview/status')) return jsonResponse({ configured: false, message: 'Non configuré (test).' });
  if (url.includes('/api/mapillary/status')) return jsonResponse({ configured: true });
  if (url.includes('/api/mapillary/images')) return jsonResponse(FIXTURES.mapillary);

  return new Response('not found', { status: 404 });
}

define('fetch', fakeFetch);
window.fetch = fakeFetch;

/* ------------------------------------------------------------------ */
/* 3. Leaflet puis application                                         */
/* ------------------------------------------------------------------ */

window.eval(readFileSync(path.join(ROOT, 'vendor/leaflet/leaflet.js'), 'utf8'));
assert.ok(window.L, 'Leaflet doit être disponible depuis vendor/leaflet/leaflet.js');

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

const $ = (selector) => window.document.querySelector(selector);
const $$ = (selector) => [...window.document.querySelectorAll(selector)];
const click = (node) => node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

const results = [];
const check = (label, fn) => {
  try {
    fn();
    results.push({ label, ok: true });
    console.log(`  ✔ ${label}`);
  } catch (error) {
    results.push({ label, ok: false, error });
    console.error(`  ✘ ${label}\n    ${error.message}`);
  }
};

console.log('\nTest d\'intégration DOM — Company Locator France\n');

await import('../js/app.js');

/* ---------------------------- Démarrage ---------------------------- */

await waitFor(() => $('#map .leaflet-pane'), 'initialisation de la carte Leaflet');
check('La carte Leaflet est initialisée avec un fond de tuiles', () => {
  assert.ok($('#map .leaflet-tile-pane'), 'panneau de tuiles présent');
  assert.ok($('#map .leaflet-control-attribution'), 'attribution obligatoire affichée');
});
check('L\'état vide invite à lancer une recherche', () => {
  assert.match($('#results-list').textContent, /Recherchez une entreprise française/);
});
await waitFor(() => $('#status-list li'), 'panneau d\'état des services');
check('Les 5 services publics sont testés et listés', () => {
  assert.equal($$('#status-list li').length, 5);
});

/* ---------------------------- Recherche ---------------------------- */

$('#champ-nom').value = 'SOCIETE DE TEST';
$('#champ-cp').value = '75015';
$('#search-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

await waitFor(() => $$('#results-list .result-item').length > 0, 'affichage des résultats');

check('3 établissements actifs affichés (le fermé est filtré)', () => {
  assert.equal($$('#results-list .result-item').length, 3);
});
check('Le résumé distingue établissements, sociétés et unités légales', () => {
  const summary = $('#results-summary').textContent;
  assert.match(summary, /3 établissements/);
  assert.match(summary, /2 sociétés/);
  assert.match(summary, /2 unités légales/);
});
check('Chaque résultat affiche SIRET, statut et adresse', () => {
  const first = $('#results-list .result-item');
  assert.match(first.textContent, /SIRET 732 829 320 00017/);
  assert.match(first.textContent, /Actif/);
  assert.match(first.textContent, /75015/);
});
check('Les exports sont activés après une recherche', () => {
  assert.equal($('#btn-export-results').disabled, false);
  assert.equal($('#btn-export-geojson').disabled, false);
});
check('La carte place un marqueur par établissement géolocalisé', () => {
  assert.equal($$('#map .clf-marker').length, 3);
});
check('Le fond de carte n\'est pas présenté comme une photographie', () => {
  assert.match($('#map-credits').textContent, /pas une photographie/);
});

/* ------------------------- Fiche détaillée ------------------------- */

click($('#results-list .result-item'));
await waitFor(() => !$('#detail-card').hidden && $('#titre-fiche'), 'ouverture de la fiche');
await waitFor(() => $('#gps-section .gps-coords'), 'résolution des coordonnées GPS');
await waitFor(() => /Île-de-France/.test($('#detail-card').textContent), 'chargement des référentiels INSEE');

check('La fiche affiche le nom, le SIREN et le SIRET formatés', () => {
  const text = $('#detail-card').textContent;
  assert.match(text, /732 829 320/);
  assert.match(text, /732 829 320 00017/);
  assert.match(text, /SOCIETE DE TEST A/);
});
check('Les informations géographiques sont complètes', () => {
  const text = $('#detail-card').textContent;
  assert.match(text, /75015/);
  assert.match(text, /Paris/);
  assert.match(text, /Île-de-France/);
  assert.match(text, /France/);
});
check('Le code NAF est traduit en activité lisible', () => {
  const badge = $('#detail-card .badge-primary').textContent;
  assert.match(badge, /47\.11D/, badge);
  assert.match(badge, /Supermarchés/, badge);
  assert.match($('#detail-card .info-grid').textContent, /SAS, société par actions simplifiée/);
});
/* --- Coordonnées de contact (saisie manuelle, stockage local) --- */

check('L\'onglet Informations propose un bloc « Coordonnées de contact » explicite', () => {
  const section = $('#contacts-section');
  assert.ok(section, 'bloc présent dans le panneau Informations');
  const text = section.textContent;
  assert.match(text, /Coordonnées de contact/);
  assert.match(text, /Non renseignées/);
  assert.match(text, /ne publie pas les coordonnées de contact/);
  assert.match(text, /seulement sur cet appareil|cet appareil/);
  assert.ok(section.querySelector('.contact-empty'), 'état vide explicite');
  assert.ok(section.querySelector('.contact-actions button'), 'action d\'ajout proposée');
});

click($('#contacts-section .contact-actions button'));
await waitFor(() => $('#contact-telephone'), 'ouverture du formulaire de contact');
$('#contact-telephone').value = '01 23 45 67 89';
$('#contact-mobile').value = '+33 6 12 34 56 78';
$('#contact-email').value = ' Contact@Exemple.FR ';
$('#contact-contact').value = 'Marie Dupont — accueil';
$('#contact-note').value = 'Standard 9h-17h';
$('.contact-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => $('#contacts-section .contact-list'), 'enregistrement des coordonnées');

check('Les coordonnées saisies sont normalisées, liées et marquées « Saisie manuelle »', () => {
  const items = $$('#contacts-section .contact-list .contact-item');
  assert.equal(items.length, 4, 'fixe, mobile, e-mail et contact');
  const hrefs = $$('#contacts-section .contact-link').map((a) => a.getAttribute('href'));
  assert.ok(hrefs.includes('tel:+33123456789'), hrefs.join(', '));
  assert.ok(hrefs.includes('tel:+33612345678'), hrefs.join(', '));
  assert.ok(hrefs.includes('mailto:contact@exemple.fr'), hrefs.join(', '));
  const text = $('#contacts-section').textContent;
  assert.match(text, /01 23 45 67 89/);
  assert.match(text, /06 12 34 56 78/);
  assert.match(text, /Marie Dupont — accueil/);
  assert.match(text, /Saisie manuelle/);
  assert.match(text, /Standard 9h-17h/);
  assert.match(text, /stockée uniquement sur cet appareil/);
  assert.ok(window.localStorage.getItem('clf:contacts').includes('73282932000017'), 'stocké par SIRET');
});

click($('#contacts-section .contact-actions button'));
await waitFor(() => $('#contact-telephone'), 'réouverture du formulaire');
$('#contact-telephone').value = '06 12 34 56 78'; // un mobile dans le champ « fixe »
$('.contact-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => $('#contacts-section .field-error'), 'message de validation');

check('Une incohérence fixe/mobile est bloquée avec un message clair', () => {
  const error = $('#contacts-section .field-error').textContent;
  assert.match(error, /mobile/i);
  assert.ok($('#contacts-section .field.has-error'), 'champ signalé');
  assert.equal($('#contact-telephone').getAttribute('aria-invalid'), 'true');
  // La saisie erronée n'écrase pas les coordonnées déjà enregistrées.
  assert.match(window.localStorage.getItem('clf:contacts'), /0123456789/);
  click($('#contacts-section .contact-form-actions .btn-outline'));
});

check('Les coordonnées GPS réelles sont affichées avec leur précision', () => {
  assert.match($('#gps-section .gps-coords').textContent, /^48\.841230, 2\.300120$/);
  assert.match($('#gps-section').textContent, /Niveau adresse/);
  assert.match($('#gps-section').textContent, /Base Adresse Nationale/);
});
check('Un lien OpenStreetMap est proposé', () => {
  const link = [...$('#detail-card').querySelectorAll('a')].find((a) => a.href.includes('openstreetmap.org'));
  assert.ok(link, 'lien OSM présent');
  assert.ok(link.href.includes('mlat=48.84123'));
});
check('L\'URL porte le SIRET (lien profond partageable)', () => {
  assert.match(window.location.hash, /^#\/etablissement\/\d{14}$/);
});

/* ----------------------------- Images ------------------------------ */

click([...$('#detail-card').querySelectorAll('.tab-btn')].find((button) => button.dataset.tab === 'images'));
await waitFor(() => $('#aerial-map .leaflet-tile-pane'), 'initialisation de la vue aérienne IGN');
await waitFor(() => $$('#street-host .photo-card').length > 0, 'chargement des photographies de rue');

check('La vue aérienne utilise bien la couche BD ORTHO® de l\'IGN', () => {
  const tiles = $$('#aerial-map img.leaflet-tile');
  assert.ok(tiles.length > 0, 'tuiles demandées');
  assert.ok(tiles.some((tile) => tile.src.includes('data.geopf.fr') && tile.src.includes('ORTHOIMAGERY')), 'WMTS IGN ortho');
  assert.match($('#aerial-host').textContent, /BD ORTHO/);
});
check('La vue aérienne est explicitement une photographie, pas un plan', () => {
  assert.match($('#detail-card').textContent, /Orthophotographie réelle, pas un plan/);
});
check('Les photos de rue Panoramax et Mapillary sont affichées avec source et date', () => {
  const cards = $$('#street-host .photo-card');
  assert.equal(cards.length, 3, '2 Panoramax + 1 Mapillary dans le rayon de 100 m');
  const text = $('#street-host').textContent;
  assert.match(text, /Panoramax/);
  assert.match(text, /Mapillary/);
  assert.match(text, /Prise de vue : \d{2}\/\d{2}\/\d{4}/);
  assert.match(text, /Licence :/);
  assert.match(text, /Voir la source/);
});
check('Le panneau indique le rayon de recherche et la limite d\'interprétation', () => {
  assert.match($('#street-host').textContent, /rayon de 100 m/);
});
check('Aucune photo officielle n\'est inventée : message explicite + formulaire sourcé', () => {
  const text = $('#complementary-host').textContent;
  assert.match(text, /Aucune photographie officielle vérifiée/);
  assert.match(text, /Source \/ auteur/);
});

/* ---------------------------- Lightbox ----------------------------- */

click($('#street-host .photo-thumb'));
await waitFor(() => !$('#lightbox').hidden, 'ouverture de la lightbox');
check('La lightbox affiche la photo, sa source et sa licence', () => {
  assert.ok($('#lightbox-img').src);
  assert.match($('#lightbox-caption').textContent, /Panoramax|Mapillary/);
  assert.match($('#lightbox-caption').textContent, /1 \/ 3/);
});
click($('#lightbox-next'));
check('La navigation entre photographies fonctionne', () => {
  assert.match($('#lightbox-caption').textContent, /2 \/ 3/);
});
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check('Échap ferme la lightbox', () => assert.equal($('#lightbox').hidden, true));

/* --------------------- D. Vue immersive Street View ---------------- */

await waitFor(() => $$('#streetview-host .sv-provider').length > 0, 'rendu de la section immersive');

check('La section « Vue immersive 360° » propose les trois sources', () => {
  const labels = $$('#streetview-host .sv-provider').map((node) => node.textContent);
  assert.equal(labels.length, 3);
  assert.match(labels.join(' '), /Panoramax 360/);
  assert.match(labels.join(' '), /Mapillary 360/);
  assert.match(labels.join(' '), /Google Street View/);
});

check('Aucun iframe tiers n\'est créé avant un clic explicite', () => {
  assert.equal($$('#streetview-host iframe').length, 0);
  assert.equal(networkCalls.some((url) => url.includes('/api/streetview/embed')), false);
  assert.ok($('#streetview-host .sv-launch'), 'bouton de chargement absent');
  assert.match($('#streetview-host .sv-consent').textContent, /avant votre clic/);
});

check('Google Street View est annoncé indisponible avec sa vraie raison', () => {
  const google = $$('#streetview-host .sv-provider').find((node) => /Google/.test(node.textContent));
  assert.equal(google.disabled, true);
  assert.match(google.title, /facturation activée/);
});

check('Panoramax est prêt sans clé et sélectionné par défaut', () => {
  const panoramax = $$('#streetview-host .sv-provider').find((node) => /Panoramax/.test(node.textContent));
  assert.equal(panoramax.disabled, false);
  assert.equal(panoramax.classList.contains('is-active'), true);
  assert.match(panoramax.textContent, /sans clé/);
});

click($('#streetview-host .sv-launch'));
await waitFor(() => $$('#streetview-host iframe').length === 1, 'chargement du viewer immersif');

check('Le clic charge le viewer immersif Panoramax dans un cadre durci', () => {
  const frame = $('#streetview-host iframe');
  assert.match(frame.src, /^https:\/\/api\.panoramax\.xyz\/#focus=pic&pic=/);
  assert.match(frame.getAttribute('sandbox'), /allow-scripts/);
  assert.match(frame.getAttribute('sandbox'), /allow-same-origin/);
  assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(frame.getAttribute('allowfullscreen'), 'true');
  assert.ok(frame.title.length > 10);
});

check('Aucun jeton ni clé dans l\'URL du cadre immersif', () => {
  const src = $('#streetview-host iframe').src;
  assert.equal(/access_token|client_token|key=|AIza|MLY\|/.test(src), false, src);
});

check('La source, la date et la licence de la vue immersive sont affichées', () => {
  const caption = $('#streetview-host .sv-caption').textContent;
  assert.match(caption, /Licence/);
  assert.match(caption, /360° immersif|Photographie plane/);
});

const capAvant = $('#streetview-host iframe').src;
const boutonDroite = $$('#streetview-host .sv-toolbar .btn').find((node) => /45°/.test(node.textContent));
click(boutonDroite);
await waitFor(() => $('#streetview-host iframe')?.src !== capAvant, 'réorientation du viewer');
check('Le cap est pilotable et se répercute dans l\'URL du viewer', () => {
  assert.match($('#streetview-host .sv-heading').textContent, /Cap \d+°/);
  assert.notEqual($('#streetview-host iframe').src, capAvant);
  assert.match($('#streetview-host iframe').src, /xyz=/);
});

const boutonNord = $$('#streetview-host .sv-compass .btn').find((node) => node.textContent === 'N');
click(boutonNord);
await waitFor(() => /xyz=0\.00\//.test($('#streetview-host iframe')?.src || ''), 'cap nord');
check('Les points cardinaux orientent la vue', () => {
  assert.match($('#streetview-host iframe').src, /xyz=0\.00\//);
});

const boutonFermer = $$('#streetview-host .sv-toolbar .btn').find((node) => /Fermer la vue/.test(node.textContent));
click(boutonFermer);
await waitFor(() => $$('#streetview-host iframe').length === 0, 'fermeture du viewer');
check('Fermer la vue retire l\'iframe et revient à l\'affiche de consentement', () => {
  assert.equal($$('#streetview-host iframe').length, 0);
  assert.ok($('#streetview-host .sv-launch'));
});


/* ------------------------- Bascule de fond ------------------------- */

click($('[data-baselayer="ortho"]'));
await waitFor(() => $$('#map img.leaflet-tile').some((tile) => tile.src.includes('ORTHOIMAGERY')), 'bascule en vue aérienne');
check('La bascule carte → photo aérienne est explicite', () => {
  assert.match($('#map-credits').textContent, /Photographie aérienne/);
  assert.ok($('[data-baselayer="ortho"]').classList.contains('is-active'));
});
click($('[data-baselayer="osm"]'));

/* ------------------- 4e vue : Street View sur la carte ------------- */

click($('[data-baselayer="street"]'));
await waitFor(() => $('#map-street').dataset.state === 'ready', 'vue de rue de l’établissement');
check('Le 4e bouton Street View affiche l’image de rue de la société', () => {
  assert.ok($('[data-baselayer="street"]').classList.contains('is-active'));
  assert.equal($('#map-street').hidden, false);
  const img = $('#map-street-img');
  assert.equal(img.hidden, false);
  assert.match(img.getAttribute('src'), /example\.invalid|mapillary/);
  assert.match($('#map-street-label').textContent, /\S/);
  assert.match($('#map-street-credit').textContent, /Panoramax|Mapillary|CC/);
  assert.match($('#map-credits').textContent, /Vue de rue/);
  if (img.classList.contains('is-pano')) {
    // Panorama : le cadrage est calculé pour faire face au bâtiment.
    assert.equal(img.style.getPropertyValue('--pano-width'), '280%');
    assert.match(img.style.getPropertyValue('--pano-left'), /^-\d/);
  }
});

const rueAvant = $('#map-street-img').getAttribute('src');
if (!$('#map-street-next').hidden) {
  click($('#map-street-next'));
  check('Les flèches parcourent les photographies de la rue', () => {
    assert.notEqual($('#map-street-img').getAttribute('src'), rueAvant);
    assert.match($('#map-street-counter').textContent, /Image \d+ sur \d+/);
  });
}

click($('[data-baselayer="planign"]'));
check('Le retour à un fond de plan masque la vue de rue', () => {
  assert.equal($('#map-street').hidden, true);
  assert.doesNotMatch($('#map-credits').textContent, /Vue de rue/);
  assert.ok($('[data-baselayer="planign"]').classList.contains('is-active'));
  assert.equal($('[data-baselayer="street"]').classList.contains('is-active'), false);
});
click($('[data-baselayer="osm"]'));

/* --------------------------- Plein écran --------------------------- */

click($('#btn-fullscreen'));
check('Le plein écran de la carte fonctionne', () => {
  assert.ok($('#map-card').classList.contains('is-fullscreen'));
});
click($('#btn-fullscreen'));
check('La sortie du plein écran fonctionne', () => {
  assert.equal($('#map-card').classList.contains('is-fullscreen'), false);
});

/* ------------------------------ Export ----------------------------- */

click($('#btn-export-results'));
check('L\'export CSV des résultats produit un fichier nommé', () => {
  assert.ok(downloads.some((name) => /company-locator_resultats_.*\.csv$/.test(name)), downloads.join(', '));
});
click($('#btn-export-geojson'));
check('L\'export GeoJSON produit un fichier nommé', () => {
  assert.ok(downloads.some((name) => /\.geojson$/.test(name)));
});
click([...$('#detail-card').querySelectorAll('.tab-btn')].find((button) => button.dataset.tab === 'fiche'));
click([...$('#detail-card').querySelectorAll('.detail-actions .btn')].find((button) => button.textContent.includes('Exporter la fiche')));
check('L\'export CSV d\'une fiche produit un fichier nommé par SIRET', () => {
  assert.ok(downloads.some((name) => /company-locator_fiche_\d{14}_.*\.csv$/.test(name)));
});

/* ----------------------- Fiche enregistrée ------------------------- */

click($('#detail-card .detail-head .icon-btn'));
await waitFor(() => $('#detail-card .detail-head .icon-btn').classList.contains('is-active'), 'enregistrement de la fiche');
check('La fiche peut être enregistrée localement', () => {
  assert.ok(window.localStorage.getItem('clf:favorites').includes('73282932000017'));
});
check('Les coordonnées de contact survivent au re-rendu de la fiche', () => {
  assert.match($('#contacts-section').textContent, /Marie Dupont — accueil/);
  assert.match($('#contacts-section').textContent, /01 23 45 67 89/);
});

/* ---------------------------- Paramètres --------------------------- */

click($('#btn-settings'));
await waitFor(() => !$('#modal-settings').hidden, 'ouverture des paramètres');
check('Les paramètres affichent l\'état du stockage et le mode Mapillary', () => {
  const text = $('#settings-body').textContent;
  assert.match(text, /Stockage local/);
  assert.match(text, /proxy local sécurisé/);
  assert.match(text, /Panoramax/);
});
const historySwitch = $('#settings-body input[type="checkbox"]');
historySwitch.checked = true;
historySwitch.dispatchEvent(new window.Event('change', { bubbles: true }));
check('L\'historique est opt-in et s\'active explicitement', () => {
  assert.equal(JSON.parse(window.localStorage.getItem('clf:settings')).historyEnabled, true);
});
click($('#modal-settings .modal-foot .btn'));
check('La modale des paramètres se ferme', () => assert.equal($('#modal-settings').hidden, true));

// L'historique étant opt-in, seules les actions POSTÉRIEURES à son activation
// sont mémorisées : on rejoue donc une recherche et une consultation.
$('#champ-nom').value = 'SOCIETE DE TEST';
$('#champ-cp').value = '75015';
$('#search-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => $$('#results-list .result-item').length > 0, 'seconde recherche');
click($('#results-list .result-item'));
await waitFor(() => !$('#detail-card').hidden, 'seconde consultation de fiche');

/* ---------------------------- Historique --------------------------- */

click($('#btn-history'));
await waitFor(() => !$('#modal-history').hidden, 'ouverture de l\'historique');
check('L\'historique liste les recherches et les fiches consultées', () => {
  assert.match($('#history-body').textContent, /Recherches \(/);
  assert.ok($$('#history-body .chip').length === 3);
});
click($$('#history-body .chip')[1]);
check('L\'onglet « fiches consultées » contient la fiche ouverte', () => {
  assert.match($('#history-body').textContent, /732 829 320 00017/);
});
click($$('#history-body .chip')[2]);
check('L\'onglet « fiches enregistrées » contient la favorite', () => {
  assert.match($('#history-body').textContent, /enregistrée le/);
});
click($('#modal-history .modal-foot .btn-primary'));

/* --------------------- Recherche sans résultat --------------------- */

$('#btn-reset').dispatchEvent(new window.Event('click', { bubbles: true }));
$('#search-form').dispatchEvent(new window.Event('reset', { bubbles: true, cancelable: true }));
await new Promise((resolve) => setTimeout(resolve, 60));
$('#champ-nom').value = 'ZZZZ Introuvable';
$('#champ-cp').value = '75015';
$('#search-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => $('#results-list .empty-state'), 'état « aucun résultat »');
check('Une recherche sans résultat affiche un message explicite', () => {
  assert.match($('#results-list').textContent, /Aucune entreprise trouvée|Recherche impossible/);
});

/* ---------------------- Validation du formulaire -------------------- */

$('#champ-nom').value = '';
$('#champ-cp').value = '999';
$('#search-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await waitFor(() => !$('#form-error').hidden, 'message d\'erreur de validation');
check('Un code postal invalide est refusé avant tout appel réseau', () => {
  assert.match($('#form-error').textContent, /code postal français valide/);
  assert.equal($('#champ-cp').getAttribute('aria-invalid'), 'true');
});

/* ------------------------------ Bilan ------------------------------ */

await new Promise((resolve) => setTimeout(resolve, 250));

const realErrors = errors.filter((message) => !/Could not load img|Not implemented|Error: Not implemented/i.test(message));
check('Aucune erreur JavaScript pendant le parcours complet', () => {
  assert.deepEqual(realErrors, []);
});
check('Aucun appel à un service payant ou non déclaré', () => {
  const hosts = new Set(networkCalls.filter((url) => url.startsWith('http')).map((url) => new URL(url).host));
  const allowed = new Set(['recherche-entreprises.api.gouv.fr', 'data.geopf.fr', 'api.panoramax.xyz']);
  assert.deepEqual([...hosts].filter((host) => !allowed.has(host)), []);
});
check('Le serveur local est détecté et utilisé comme relais de même origine', () => {
  assert.ok(networkCalls.includes('/api/health'), 'détection du serveur local');
  // L'API entreprises n'envoie pas d'en-tête CORS → relais local obligatoire.
  assert.ok(networkCalls.some((url) => url.startsWith('/api/proxy/entreprises/search')), 'recherche relayée en même origine');
  // Géoplateforme et Panoramax sont ouverts en CORS → appel direct autorisé.
  assert.ok(networkCalls.some((url) => url.startsWith('https://data.geopf.fr/geocodage/search')), 'géocodage en direct');
  assert.ok(networkCalls.some((url) => url.startsWith('https://api.panoramax.xyz/api/search')), 'Panoramax en direct');
});
check('Aucun jeton secret n\'apparaît dans les requêtes navigateur', () => {
  assert.equal(networkCalls.some((url) => /access_token=/.test(url)), false);
});

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies.`);
if (failed.length) {
  console.error('\nÉchecs :');
  failed.forEach((result) => console.error(` - ${result.label}: ${result.error.message}`));
  process.exit(1);
}
console.log('Parcours complet validé sans erreur.\n');
process.exit(0);
