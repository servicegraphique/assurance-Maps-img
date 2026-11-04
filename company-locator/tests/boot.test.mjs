/**
 * Test du garde de démarrage (js/boot.js).
 *
 * Reproduit le cas réel remonté par un utilisateur : index.html ouvert en
 * double-cliquant sous Windows (file:///C:/…/index.html). Les modules ES sont
 * alors bloqués : js/app.js ne s'exécute jamais. boot.js, script classique,
 * doit afficher la marche à suivre au lieu de laisser un écran vide.
 *
 * Exécution : npm run test:boot   (nécessite `npm install`, jsdom uniquement)
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const BOOT = readFileSync(path.join(ROOT, 'js/boot.js'), 'utf8');

const results = [];
async function check(label, fn) {
  try { await fn(); results.push({ label, ok: true }); console.log(`  ✔ ${label}`); }
  catch (error) { results.push({ label, ok: false, error }); console.log(`  ✘ ${label}\n      ${error.message}`); }
}

/**
 * Charge la page dans une fenêtre jsdom.
 * `timers: 'capture'` intercepte setTimeout pour déclencher le chien de garde
 * à la demande, sans attendre 8 secondes et sans modifier le code de production.
 */
async function load(url, { timers = 'capture', modules = true } = {}) {
  const dom = new JSDOM(HTML, { url, runScripts: 'outside-only' });
  const { window } = dom;
  // Comme un vrai navigateur : on attend la fin de l'analyse du document.
  if (window.document.readyState !== 'complete') {
    await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  }
  // jsdom n'implémente pas `noModule` : on le déclare pour simuler un
  // navigateur moderne (tout navigateur gérant les modules ES gère noModule).
  if (modules) {
    Object.defineProperty(window.HTMLScriptElement.prototype, 'noModule', { value: false, configurable: true });
  }
  const captured = [];
  if (timers === 'capture') {
    window.setTimeout = (fn, ms) => { captured.push({ fn, ms }); return captured.length; };
  }
  window.eval(BOOT);
  return { window, document: window.document, captured, fire: () => captured.forEach((timer) => timer.fn()) };
}

console.log('\nCompany Locator France — garde de démarrage\n');

/* ------------------------- Cas file:// (Windows) ------------------- */

const fileCase = await load('file:///C:/Users/Brandon/Desktop/company-locator/index.html');
const banner = fileCase.document.getElementById('boot-error');
const text = () => banner.textContent.replace(/\s+/g, ' ').trim();

await check('En file://, le bandeau d\'aide s\'affiche immédiatement', async () => {
  assert.equal(banner.hidden, false);
  assert.ok(text().length > 100, 'bandeau vide');
});

await check('Le bandeau explique la cause (file:// bloque les modules)', async () => {
  assert.match(text(), /file:\/\//);
  assert.match(text(), /modules JavaScript/);
});

await check('Le bandeau propose le lanceur double-clic Windows', async () => {
  assert.match(text(), /Lancer-Company-Locator\.bat/);
});

await check('Le bandeau donne la commande exacte, avec le vrai dossier de l\'utilisateur', async () => {
  assert.match(text(), /cd "C:\\Users\\Brandon\\Desktop\\company-locator"/);
  assert.match(text(), /node server\.js/);
});

await check('Le bandeau indique la bonne adresse à ouvrir', async () => {
  assert.match(text(), /http:\/\/localhost:8080\//);
  assert.match(text(), /nodejs\.org/);
});

await check('Les modales et la lightbox restent masquées malgré l\'absence de JS applicatif', async () => {
  for (const id of ['modal-settings', 'modal-history', 'lightbox']) {
    assert.equal(fileCase.document.getElementById(id).hasAttribute('hidden'), true, id);
  }
});

await check('Le chemin affiché est déduit de l\'URL, jamais codé en dur', async () => {
  assert.equal(/C:\\Users\\Brandon/.test(BOOT), false);
  const autre = await load('file:///home/marie/projets/company-locator/index.html');
  assert.match(autre.document.getElementById('boot-error').textContent, /cd "\/home\/marie\/projets\/company-locator"/);
});

/* ------------------------- Cas servi en http ----------------------- */

const httpCase = await load('http://localhost:8080/', { timers: 'capture' });

await check('En http://, aucun bandeau d\'erreur au chargement', async () => {
  assert.equal(httpCase.document.getElementById('boot-error').hidden, true);
});

await check('Aucun faux diagnostic « navigateur ancien » avant le délai', async () => {
  const partiel = await load('http://localhost:8080/', { modules: false });
  assert.equal(partiel.document.getElementById('boot-error').hidden, true);
});

await check('Un chien de garde est armé pour détecter un module qui ne démarre pas', async () => {
  assert.equal(httpCase.captured.length, 1);
  assert.ok(httpCase.captured[0].ms >= 3000, 'délai trop court');
});

await check('Démarrage réussi : le chien de garde ne montre rien', async () => {
  httpCase.window.__companyLocatorReady = true;
  httpCase.fire();
  assert.equal(httpCase.document.getElementById('boot-error').hidden, true);
});

await check('Module jamais exécuté : le chien de garde explique quoi faire', async () => {
  const silent = await load('http://localhost:8080/', { timers: 'capture' });
  silent.fire();
  const contenu = silent.document.getElementById('boot-error');
  assert.equal(contenu.hidden, false);
  assert.match(contenu.textContent, /n'a pas démarré/);
  assert.match(contenu.textContent, /node server\.js/);
  assert.match(contenu.textContent, /F12/);
});

await check('Une erreur déjà affichée par app.js n\'est pas écrasée par le chien de garde', async () => {
  const failing = await load('http://localhost:8080/', { timers: 'capture' });
  const cible = failing.document.getElementById('boot-error');
  cible.hidden = false;
  cible.textContent = 'Carte indisponible : erreur précise de app.js';
  failing.fire();
  assert.equal(cible.textContent, 'Carte indisponible : erreur précise de app.js');
});

/* ------------------------- Navigateur ancien ----------------------- */

await check('Navigateur sans support des modules : diagnostic posé après le délai', async () => {
  const dom = new JSDOM(HTML, { url: 'http://localhost:8080/', runScripts: 'outside-only' });
  const { window } = dom;
  await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  // jsdom ne définit pas noModule : c'est exactement l'état d'un navigateur
  // ancien, aucun patch n'est nécessaire ici.
  const timers = [];
  window.setTimeout = (fn, ms) => { timers.push(fn); return timers.length; };
  window.eval(BOOT);
  const contenu = window.document.getElementById('boot-error');
  // Aucun faux positif immédiat : on attend la confirmation du chien de garde.
  assert.equal(contenu.hidden, true, 'diagnostic trop tôt');
  timers.forEach((fn) => fn());
  assert.equal(contenu.hidden, false);
  assert.match(contenu.textContent, /Navigateur trop ancien/);
  assert.match(contenu.textContent, /Chrome, Edge, Firefox ou Safari/);
});

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications de démarrage réussies.`);
if (failed.length) {
  console.error('\nÉchecs :');
  failed.forEach((result) => console.error(` - ${result.label}: ${result.error.message}`));
  process.exit(1);
}
console.log('Le cas « fichier ouvert en double-cliquant » est correctement expliqué.\n');
process.exit(0);
