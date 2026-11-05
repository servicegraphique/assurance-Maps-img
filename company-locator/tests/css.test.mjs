/**
 * Test de régression CSS — cascade réelle de la propriété `display`.
 *
 * Pourquoi ce test existe : jsdom n'applique PAS `!important` dans son calcul
 * de style. Un test basé sur getComputedStyle() laisserait donc passer le bug
 * où `.modal { display: flex }` écrase le `[hidden] { display: none }` du
 * navigateur, rendant les modales et la lightbox visibles en permanence.
 *
 * On rejoue donc ici la cascade telle que la spécification la définit :
 *   origine auteur !important > origine auteur normale > origine navigateur.
 * À origine et importance égales : spécificité, puis ordre d'apparition.
 *
 * Exécution : npm run test:css   (nécessite `npm install`, jsdom uniquement)
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEETS = ['vendor/leaflet/leaflet.css', 'css/style.css', 'css/map.css', 'css/responsive.css'];

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8080/' });
const { window } = dom;
const { document } = window;

// Injection des feuilles dans l'ordre réel de index.html.
for (const sheet of SHEETS) {
  const style = document.createElement('style');
  style.textContent = readFileSync(path.join(ROOT, sheet), 'utf8');
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/* Mini-moteur de cascade                                              */
/* ------------------------------------------------------------------ */

/** Spécificité (a, b, c) — suffisante pour les sélecteurs de ce projet. */
function specificity(selector) {
  const cleaned = selector.replace(/::[a-z-]+/g, ' ');           // pseudo-éléments → type
  const ids = (cleaned.match(/#[\w-]+/g) || []).length;
  const classes = (cleaned.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[a-z-]+(\([^)]*\))?/g) || []).length;
  const types = (cleaned.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[a-z-]+(\([^)]*\))?/g, '')
    .match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + classes * 100 + types;
}

/** Règles @media applicables au contexte demandé. */
function mediaApplies(mediaText, context) {
  const text = (mediaText || '').trim();
  if (!text) return true;
  if (context === 'print') return /print/.test(text);
  return !/^\s*print\s*$/.test(text) && !/\bprint\b/.test(text);
}

function collectRules(context) {
  const rules = [];
  let order = 0;
  for (const sheet of document.styleSheets) {
    let cssRules;
    try { cssRules = sheet.cssRules; } catch { continue; }
    const walk = (list, mediaText) => {
      for (const rule of list) {
        if (rule.type === 4 || rule.constructor.name === 'CSSMediaRule') {
          walk(rule.cssRules, rule.media.mediaText);
        } else if (rule.selectorText && rule.style) {
          const value = rule.style.getPropertyValue('display');
          if (!value) continue;
          if (!mediaApplies(mediaText, context)) continue;
          rules.push({
            selector: rule.selectorText,
            value,
            important: rule.style.getPropertyPriority('display') === 'important',
            order: order++,
          });
        }
      }
    };
    walk(cssRules, '');
  }
  return rules;
}

/** Valeur de `display` réellement appliquée, comme le ferait un navigateur. */
function resolveDisplay(element, context = 'screen') {
  let winner = null;
  const consider = (candidate) => {
    if (!winner) { winner = candidate; return; }
    const rank = (rule) => (rule.origin === 'author' ? 1000000 : 0) + (rule.important ? 100000 : 0);
    if (rank(candidate) !== rank(winner)) {
      if (rank(candidate) > rank(winner)) winner = candidate;
      return;
    }
    if (candidate.spec !== winner.spec) {
      if (candidate.spec > winner.spec) winner = candidate;
      return;
    }
    if (candidate.order >= winner.order) winner = candidate;
  };

  // Feuille de style du navigateur (origine UA, la moins prioritaire).
  if (element.hasAttribute('hidden')) {
    consider({ origin: 'ua', important: false, spec: specificity('[hidden]'), order: -1, value: 'none', selector: 'UA [hidden]' });
  }

  for (const rule of collectRules(context)) {
    for (const selector of rule.selector.split(',')) {
      const trimmed = selector.trim();
      let matches = false;
      try { matches = element.matches(trimmed); } catch { matches = false; }
      if (!matches) continue;
      consider({ ...rule, origin: 'author', spec: specificity(trimmed), selector: trimmed });
      break;
    }
  }
  return winner ? winner.value : 'block';
}

/* ------------------------------------------------------------------ */
/* Vérifications                                                       */
/* ------------------------------------------------------------------ */

const results = [];
function check(label, fn) {
  try { fn(); results.push({ label, ok: true }); console.log(`  ✔ ${label}`); }
  catch (error) { results.push({ label, ok: false, error }); console.log(`  ✘ ${label}\n      ${error.message}`); }
}

console.log('\nCompany Locator France — cascade CSS et garde de démarrage\n');

check('La règle globale [hidden] est présente et prioritaire', () => {
  const css = readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/);
});

const hiddenElements = [...document.querySelectorAll('[hidden]')];
check('Des éléments masqués existent bien dans index.html', () => {
  assert.ok(hiddenElements.length >= 8, `${hiddenElements.length} éléments trouvés`);
});

check('Aucun élément [hidden] ne reste visible (modales, lightbox, panneaux…)', () => {
  const visibles = hiddenElements
    .map((element) => ({ id: element.id || element.className, display: resolveDisplay(element) }))
    .filter((entry) => entry.display !== 'none');
  assert.deepEqual(visibles, [], `éléments encore affichés : ${JSON.stringify(visibles)}`);
});

check('La modale des paramètres est masquée au chargement', () => {
  assert.equal(resolveDisplay(document.getElementById('modal-settings')), 'none');
});

check('La modale d\'historique est masquée au chargement', () => {
  assert.equal(resolveDisplay(document.getElementById('modal-history')), 'none');
});

check('La lightbox est masquée au chargement', () => {
  assert.equal(resolveDisplay(document.getElementById('lightbox')), 'none');
});

check('Retirer hidden réaffiche bien la modale (le correctif ne casse pas l\'ouverture)', () => {
  const modal = document.getElementById('modal-settings');
  modal.removeAttribute('hidden');
  assert.equal(resolveDisplay(modal), 'flex');
  modal.setAttribute('hidden', '');
  assert.equal(resolveDisplay(modal), 'none');
});

check('Retirer hidden réaffiche bien la lightbox', () => {
  const box = document.getElementById('lightbox');
  box.removeAttribute('hidden');
  assert.equal(resolveDisplay(box), 'flex');
  box.setAttribute('hidden', '');
});

check('Le panneau d\'état et la carte restent masqués tant qu\'ils sont inutilisés', () => {
  assert.equal(resolveDisplay(document.getElementById('status-panel')), 'none');
  assert.equal(resolveDisplay(document.getElementById('map-overlay')), 'none');
  assert.equal(resolveDisplay(document.getElementById('detail-card')), 'none');
});

check('À l\'impression, les panneaux d\'onglets masqués redeviennent visibles', () => {
  const panel = document.querySelector('.tab-panel[hidden]');
  if (!panel) return; // aucun onglet rendu statiquement : rien à vérifier
  assert.equal(resolveDisplay(panel, 'print'), 'block');
});

check('À l\'impression, modales et lightbox restent invisibles même ouvertes', () => {
  const modal = document.getElementById('modal-settings');
  modal.removeAttribute('hidden');
  assert.equal(resolveDisplay(modal, 'print'), 'none');
  modal.setAttribute('hidden', '');
});

/* --------------------------- Garde de démarrage -------------------- */

check('js/boot.js est chargé en script classique, avant le module applicatif', () => {
  const scripts = [...document.querySelectorAll('script[src]')];
  const boot = scripts.find((script) => script.getAttribute('src') === 'js/boot.js');
  assert.ok(boot, 'js/boot.js absent de index.html');
  assert.notEqual(boot.getAttribute('type'), 'module', 'boot.js doit rester un script classique');
  const app = scripts.find((script) => script.getAttribute('src') === 'js/app.js');
  assert.equal(app.getAttribute('type'), 'module');
  assert.ok(scripts.indexOf(boot) < scripts.indexOf(app), 'boot.js doit précéder app.js');
});

check('js/boot.js n\'utilise aucune syntaxe de module ES', () => {
  const source = readFileSync(path.join(ROOT, 'js/boot.js'), 'utf8');
  assert.equal(/^\s*import\s/m.test(source), false);
  assert.equal(/^\s*export\s/m.test(source), false);
});

check('js/app.js désarme le chien de garde une fois démarré', () => {
  const source = readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  assert.match(source, /window\.__companyLocatorReady\s*=\s*true/);
});

check('Le bloc « coordonnées de contact » possède ses styles dédiés', () => {
  const css = readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  ['.contact-head', '.contact-note', '.contact-list', '.contact-item', '.contact-link',
    '.contact-actions', '.contact-form', '.contact-form-actions', '.field-error']
    .forEach((selector) => assert.ok(css.includes(selector), `règle ${selector} présente`));
  // Les champs téléphone / e-mail reprennent l'habillage des champs texte.
  assert.match(css, /input\[type="tel"\][^{]*\{/);
  assert.match(css, /input\[type="email"\][^{]*\{/);
});

check('Aucun chemin absolu de machine dans les sources livrées', () => {
  const files = ['index.html', 'js/boot.js', 'js/app.js', 'css/style.css'];
  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(/[A-Za-z]:\\Users\\|\/home\/[a-z]|\/Users\/[a-z]/.test(source), false, file);
  }
});

check('Les lanceurs double-clic sont livrés', () => {
  assert.ok(existsSync(path.join(ROOT, 'Lancer-Company-Locator.bat')), 'lanceur Windows');
  assert.ok(existsSync(path.join(ROOT, 'lancer.sh')), 'lanceur macOS/Linux');
});

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications CSS réussies.`);
if (failed.length) {
  console.error('\nÉchecs :');
  failed.forEach((result) => console.error(` - ${result.label}: ${result.error.message}`));
  process.exit(1);
}
console.log('Aucun élément masqué ne fuite à l\'affichage.\n');
process.exit(0);
