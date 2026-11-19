/**
 * Test de régression CSS — cascade réelle de la propriété `display`.
 *
 * Vérifie que `[hidden]` gagne toujours sur les règles `.crm-modal`, `.search-toolbar`,
 * `.embed-bar`, `.street-credit`, etc., que la barre de recherche est masquable
 * proprement, et que tous les fichiers référencés par `index.html` existent.
 */

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHEETS = ['vendor/leaflet/leaflet.css', 'css/style.css', 'css/responsive.css', 'css/embed.css'];

const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost:8080/' });
const { window } = dom;
const { document } = window;

for (const sheet of SHEETS) {
  const style = document.createElement('style');
  style.textContent = readFileSync(path.join(ROOT, sheet), 'utf8');
  document.head.appendChild(style);
}

function specificity(selector) {
  const cleaned = selector.replace(/::[a-z-]+/g, ' ');
  const ids = (cleaned.match(/#[\w-]+/g) || []).length;
  const classes = (cleaned.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[a-z-]+(\([^)]*\))?/g) || []).length;
  const types = (cleaned.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[a-z-]+(\([^)]*\))?/g, '')
    .match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + classes * 100 + types;
}

function mediaApplies(mediaText, context) {
  const text = (mediaText || '').trim();
  if (!text) return true;
  if (context === 'print') return /print/.test(text);
  return !/^\s*print\s*$/.test(text) && !/\bprint\b/.test(text);
}

function walk(list, mediaText, out, counter) {
  for (const rule of list) {
    if (rule.cssRules && rule.media) {
      walk(rule.cssRules, rule.media.mediaText || rule.conditionText || '', out, counter);
    } else if (rule.selectorText && rule.style) {
      const value = rule.style.getPropertyValue('display');
      if (!value) continue;
      if (!mediaApplies(mediaText, counter.context)) continue;
      out.push({
        selector: rule.selectorText,
        value,
        important: rule.style.getPropertyPriority('display') === 'important' || /display\s*:[^;]*!important/i.test(rule.cssText || ''),
        order: counter.order++,
      });
    }
  }
}

function collectRules(context) {
  const rules = [];
  const counter = { order: 0, context };
  for (const sheet of document.styleSheets) {
    let cssRules;
    try { cssRules = sheet.cssRules; } catch { continue; }
    walk(cssRules, '', rules, counter);
  }
  return rules;
}

function resolveDisplay(element, context = 'screen') {
  let winner = null;
  const consider = (candidate) => {
    if (!winner) { winner = candidate; return; }
    if (candidate.origin !== winner.origin) {
      if (candidate.origin > winner.origin) winner = candidate;
      return;
    }
    if (candidate.spec !== winner.spec) {
      if (candidate.spec > winner.spec) winner = candidate;
      return;
    }
    if (candidate.order > winner.order) winner = candidate;
  };
  if (element.hasAttribute('hidden')) {
    consider({ origin: 1, spec: 100, order: -1, value: 'none' });
  }
  for (const rule of collectRules(context)) {
    for (const raw of rule.selector.split(',')) {
      const sel = raw.trim();
      if (!sel || /::/.test(sel)) continue;
      let matched = false;
      try { matched = element.matches(sel); } catch { continue; }
      if (!matched) continue;
      consider({ origin: rule.important ? 3 : 2, spec: specificity(sel), order: rule.order, value: rule.value });
    }
  }
  return winner ? winner.value : 'block';
}

const results = [];
function check(label, fn) {
  try { fn(); results.push({ ok: true }); console.log(`  ✔ ${label}`); }
  catch (err) { results.push({ ok: false, err }); console.log(`  ✘ ${label}\n      ${err.message}`); }
}

console.log('\nCompany Locator France — cascade CSS\n');

check('Tous les éléments [hidden] initiaux ont display: none', () => {
  for (const el of document.querySelectorAll('[hidden]')) {
    assert.equal(resolveDisplay(el), 'none', `<${el.tagName.toLowerCase()} id="${el.id}"> visible malgré [hidden]`);
  }
});

check('La modale passe de display:none à display:flex quand [hidden] est retiré', () => {
  const modal = document.getElementById('crm-modal');
  assert.equal(resolveDisplay(modal), 'none');
  modal.removeAttribute('hidden');
  assert.equal(resolveDisplay(modal), 'flex');
  modal.setAttribute('hidden', '');
  assert.equal(resolveDisplay(modal), 'none');
});

check('La barre de recherche est masquable ([hidden]) et masquée à l’impression', () => {
  const toolbar = document.getElementById('search-toolbar');
  assert.equal(resolveDisplay(toolbar), 'block');
  assert.equal(resolveDisplay(toolbar, 'print'), 'none');
  toolbar.setAttribute('hidden', '');
  assert.equal(resolveDisplay(toolbar), 'none');
  toolbar.removeAttribute('hidden');
});

check('Mode intégré (body.is-embed) masque la barre de recherche publique', () => {
  const toolbar = document.getElementById('search-toolbar');
  document.body.classList.add('is-embed');
  assert.equal(resolveDisplay(toolbar), 'none');
  document.body.classList.remove('is-embed');
});

check('Toutes les ressources locales référencées par index.html existent', () => {
  for (const el of document.querySelectorAll('link[href], script[src]')) {
    const ref = el.getAttribute('href') || el.getAttribute('src');
    if (/^https?:/.test(ref)) continue;
    const clean = ref.split('?')[0];
    assert.equal(existsSync(path.join(ROOT, clean)), true, `Ressource manquante : ${clean}`);
  }
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications CSS réussies.\n`);
if (failed.length) process.exit(1);
