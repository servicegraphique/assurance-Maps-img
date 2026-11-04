/**
 * live-smoke.mjs — Test de fumée contre les VRAIES API publiques.
 *
 * À lancer sur une machine ayant un accès Internet normal :
 *     node tests/live-smoke.mjs
 *     node tests/live-smoke.mjs --mapillary   (si un jeton est configuré)
 *
 * Ce script n'écrit rien, ne modifie rien et n'utilise aucune fixture.
 * Il imprime un diagnostic par service et renvoie un code de sortie non nul
 * si un service essentiel échoue.
 *
 * Il complète les tests hors-ligne (`npm test`, `npm run test:dom`) : ces
 * derniers valident la logique, celui-ci valide la connectivité réelle.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

const record = (name, ok, detail, essential = true) => {
  results.push({ name, ok, detail, essential });
  console.log(`${ok ? '  ✔' : '  ✘'} ${name}\n      ${detail}`);
};

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

async function getJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} — ${text.slice(0, 160)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

console.log('\nCompany Locator France — test de fumée réseau réel\n');
console.log('Entreprises (API DINUM)');

/* ---------------------------------------------------------------- */
/* 1. API Recherche d'entreprises                                    */
/* ---------------------------------------------------------------- */

const cases = [
  { label: 'Allianz + 75015', params: { q: 'Allianz', code_postal: '75015', per_page: '5' } },
  { label: 'AXA + 69002', params: { q: 'AXA', code_postal: '69002', per_page: '5' } },
  { label: 'Renault + 59000', params: { q: 'Renault', code_postal: '59000', per_page: '5' } },
  { label: 'Code postal seul 33000', params: { code_postal: '33000', per_page: '5' } },
  { label: 'SIRET DINUM 13002526500013', params: { q: '13002526500013', per_page: '5' } },
  { label: 'SIREN DINUM 130025265', params: { q: 'siren:130025265', per_page: '1', limite_matching_etablissements: '100' } },
];

let firstEtablissement = null;

for (const testCase of cases) {
  const url = `https://recherche-entreprises.api.gouv.fr/search?${new URLSearchParams(testCase.params)}`;
  try {
    const { value, ms } = await timed(() => getJson(url));
    const count = value.results?.length ?? 0;
    const total = value.total_results ?? 0;
    const premier = value.results?.[0];
    const etablissement = premier?.siege || premier?.matching_etablissements?.[0];
    if (etablissement && !firstEtablissement) firstEtablissement = etablissement;
    const coords = etablissement?.latitude ? `${etablissement.latitude}, ${etablissement.longitude}` : 'coordonnées absentes';
    record(testCase.label, total > 0,
      `${total} unité(s) légale(s), ${count} en page — ${premier?.nom_complet ?? '—'} — SIRET ${etablissement?.siret ?? '—'} — ${coords} (${ms} ms)`);
  } catch (error) {
    record(testCase.label, false, error.message);
  }
  await new Promise((resolve) => setTimeout(resolve, 250)); // quota 7 req/s
}

/* ---------------------------------------------------------------- */
/* 2. Géocodage BAN / Géoplateforme                                  */
/* ---------------------------------------------------------------- */

console.log('\nGéocodage (BAN / Géoplateforme IGN)');

const adresseTest = firstEtablissement?.adresse || '20 avenue de Segur 75007 Paris';
try {
  const params = new URLSearchParams({ q: adresseTest, limit: '1', autocomplete: '0' });
  const { value, ms } = await timed(() => getJson(`https://data.geopf.fr/geocodage/search?${params}`));
  const feature = value.features?.[0];
  if (!feature) throw new Error('aucun résultat');
  const [lon, lat] = feature.geometry.coordinates;
  record('Géocodage direct', true,
    `« ${adresseTest} » → ${feature.properties.label} | ${lat}, ${lon} | type ${feature.properties.type} | score ${feature.properties.score} (${ms} ms)`);

  const reverse = await getJson(`https://data.geopf.fr/geocodage/reverse?lat=${lat}&lon=${lon}&limit=1`);
  const back = reverse.features?.[0];
  record('Géocodage inverse', Boolean(back),
    back ? `${lat}, ${lon} → ${back.properties.label}` : 'aucune adresse retournée', false);
} catch (error) {
  record('Géocodage BAN', false, error.message);
}

try {
  const { value } = await timed(() => getJson('https://data.geopf.fr/geocodage/search?q=Lyon&type=municipality&limit=1&autocomplete=0'));
  const feature = value.features?.[0];
  record('Résolution de commune → code INSEE', Boolean(feature?.properties?.citycode),
    feature ? `${feature.properties.city} → ${feature.properties.citycode}` : 'aucune commune trouvée', false);
} catch (error) {
  record('Résolution de commune', false, error.message, false);
}

/* ---------------------------------------------------------------- */
/* 3. Tuiles IGN (photo aérienne)                                    */
/* ---------------------------------------------------------------- */

console.log('\nImagerie IGN');

function tileUrl(layer, format, z, x, y) {
  return `https://data.geopf.fr/wmts?${new URLSearchParams({
    SERVICE: 'WMTS', REQUEST: 'GetTile', VERSION: '1.0.0', LAYER: layer,
    STYLE: 'normal', FORMAT: format, TILEMATRIXSET: 'PM',
    TILEMATRIX: String(z), TILEROW: String(y), TILECOL: String(x),
  })}`;
}

// Tuile centrée sur Paris (z15).
for (const [label, layer, format] of [
  ['BD ORTHO® 20 cm (HR)', 'HR.ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'],
  ['BD ORTHO® standard (repli)', 'ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'],
  ['Plan IGN', 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'],
]) {
  try {
    const { value: bytes, ms } = await timed(async () => {
      const response = await fetch(tileUrl(layer, format, 15, 16598, 11481));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      return buffer.byteLength;
    });
    record(label, bytes > 1000, `${bytes} octets reçus (${ms} ms)`, label.includes('standard'));
  } catch (error) {
    record(label, false, error.message, label.includes('standard'));
  }
}

try {
  const response = await fetch('https://tile.openstreetmap.org/15/16598/11481.png', {
    headers: { 'User-Agent': 'CompanyLocatorFrance/1.0 (test local)' },
  });
  record('Tuiles OpenStreetMap', response.ok, `HTTP ${response.status}`, false);
} catch (error) {
  record('Tuiles OpenStreetMap', false, error.message, false);
}

/* ---------------------------------------------------------------- */
/* 4. Photographies de rue                                           */
/* ---------------------------------------------------------------- */

console.log('\nPhotographies de rue');

try {
  const { value, ms } = await timed(() => getJson(
    'https://api.panoramax.xyz/api/search?place_position=2.3522,48.8566&place_distance=0-150&limit=5',
  ));
  const count = value.features?.length ?? 0;
  const first = value.features?.[0];
  record('Panoramax (sans jeton)', count > 0,
    `${count} photo(s) autour de Paris${first ? ` — ${first.properties?.datetime ?? 'date inconnue'} — ${first.assets?.thumb?.href ? 'vignette disponible' : 'pas de vignette'}` : ''} (${ms} ms)`);
} catch (error) {
  record('Panoramax', false, error.message);
}

let token = process.env.MAPILLARY_TOKEN || '';
if (!token && existsSync(path.join(ROOT, 'server.config.json'))) {
  try {
    token = JSON.parse(readFileSync(path.join(ROOT, 'server.config.json'), 'utf8')).mapillaryToken || '';
  } catch { /* fichier illisible */ }
}

if (token) {
  try {
    const params = new URLSearchParams({
      access_token: token,
      fields: 'id,thumb_1024_url,captured_at,compass_angle,is_pano,geometry',
      bbox: '2.3400,48.8500,2.3650,48.8650',
      limit: '5',
    });
    const { value, ms } = await timed(() => getJson(`https://graph.mapillary.com/images?${params}`));
    const count = value.data?.length ?? 0;
    record('Mapillary (jeton configuré)', count > 0, `${count} photo(s) autour de Paris (${ms} ms)`, false);
  } catch (error) {
    record('Mapillary', false, `${error.message} (jeton présent mais refusé ?)`, false);
  }
} else {
  console.log('  – Mapillary : aucun jeton configuré, test ignoré (Panoramax couvre ce besoin sans jeton).');
}

/* ---------------------------------------------------------------- */
/* Bilan                                                             */
/* ---------------------------------------------------------------- */

const failed = results.filter((result) => !result.ok);
const essentialFailed = failed.filter((result) => result.essential);
console.log(`\n${results.length - failed.length}/${results.length} tests réseau réussis.`);
if (failed.length) {
  console.log('Échecs :');
  failed.forEach((result) => console.log(` - ${result.name}${result.essential ? ' (essentiel)' : ' (optionnel)'}`));
}
if (essentialFailed.length) {
  console.log('\nDes services essentiels sont injoignables depuis cette machine.');
  console.log('Vérifiez la connexion Internet, le pare-feu ou le proxy d\'entreprise.');
  process.exit(1);
}
console.log('\nConnectivité réelle validée.\n');
process.exit(0);
