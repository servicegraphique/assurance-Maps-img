/**
 * commune-stats.js — Population, département et région de la commune du site.
 *
 * Indicateurs KPI « Population », « Département » et « Région » :
 *
 *  - Source principale : API Géo France — https://geo.api.gouv.fr/communes
 *    (population municipale + département/région rattachés au code INSEE,
 *    publique, sans clé, CORS ouvert) ;
 *  - Repli local : tables INSEE 101 départements / 18 régions embarquées, afin
 *    que « Département » et « Région » restent renseignés hors-ligne ou si
 *    l'API est injoignable — la population affiche alors « — ».
 *
 * Module testé dans tests/unit/commune-stats.test.mjs.
 */

import { departmentFromCode, fetchJson, normalizeText, TtlCache } from './utils.js';
import { formatIntFr } from './enrichment.js';
import { cacheStore } from './storage.js';

export const GEO_API_COMMUNES = 'https://geo.api.gouv.fr/communes';
export const GEO_API_FIELDS = 'nom,population,departement,region';

/* ==================================================================== */
/* 1. Tables locales INSEE (repli hors-ligne)                            */
/* ==================================================================== */

/** `code|nom` — codes région INSEE (métropole + DROM + collectivités). */
const REGION_ROWS = [
  '01|Guadeloupe',
  '02|Martinique',
  '03|Guyane',
  '04|La Réunion',
  '06|Mayotte',
  '11|Île-de-France',
  '24|Centre-Val de Loire',
  '27|Bourgogne-Franche-Comté',
  '28|Normandie',
  '32|Hauts-de-France',
  '44|Grand Est',
  '53|Bretagne',
  '54|Pays de la Loire',
  '75|Nouvelle-Aquitaine',
  '76|Occitanie',
  '84|Auvergne-Rhône-Alpes',
  '93|Provence-Alpes-Côte d\'Azur',
  '94|Corse',
  '975|Saint-Pierre-et-Miquelon',
  '977|Saint-Barthélemy',
  '978|Saint-Martin',
  '984|Terres australes françaises',
  '986|Wallis-et-Futuna',
  '987|Polynésie française',
  '988|Nouvelle-Calédonie',
];

/** `code|nom|codeRégion` — 101 départements (dont 2A/2B) + collectivités. */
const DEPT_ROWS = [
  '01|Ain|84', '02|Aisne|32', '03|Allier|84', '04|Alpes-de-Haute-Provence|93',
  '05|Hautes-Alpes|93', '06|Alpes-Maritimes|93', '07|Ardèche|84', '08|Ardennes|44',
  '09|Ariège|76', '10|Aube|44', '11|Aude|76', '12|Aveyron|76',
  '13|Bouches-du-Rhône|93', '14|Calvados|28', '15|Cantal|84', '16|Charente|75',
  '17|Charente-Maritime|75', '18|Cher|24', '19|Corrèze|75', '2A|Corse-du-Sud|94',
  '2B|Haute-Corse|94', '21|Côte-d\'Or|27', '22|Côtes-d\'Armor|53', '23|Creuse|75',
  '24|Dordogne|75', '25|Doubs|27', '26|Drôme|84', '27|Eure|28',
  '28|Eure-et-Loir|24', '29|Finistère|53', '30|Gard|76', '31|Haute-Garonne|76',
  '32|Gers|76', '33|Gironde|75', '34|Hérault|76', '35|Ille-et-Vilaine|53',
  '36|Indre|24', '37|Indre-et-Loire|24', '38|Isère|84', '39|Jura|27',
  '40|Landes|75', '41|Loir-et-Cher|24', '42|Loire|84', '43|Haute-Loire|84',
  '44|Loire-Atlantique|53', '45|Loiret|24', '46|Lot|76', '47|Lot-et-Garonne|75',
  '48|Lozère|76', '49|Maine-et-Loire|53', '50|Manche|28', '51|Marne|44',
  '52|Haute-Marne|44', '53|Mayenne|53', '54|Meurthe-et-Moselle|44', '55|Meuse|44',
  '56|Morbihan|53', '57|Moselle|44', '58|Nièvre|27', '59|Nord|32',
  '60|Oise|32', '61|Orne|28', '62|Pas-de-Calais|32', '63|Puy-de-Dôme|84',
  '64|Pyrénées-Atlantiques|75', '65|Hautes-Pyrénées|76', '66|Pyrénées-Orientales|76',
  '67|Bas-Rhin|44', '68|Haut-Rhin|44', '69|Rhône|84', '69M|Métropole de Lyon|84',
  '70|Haute-Saône|27', '71|Saône-et-Loire|27', '72|Sarthe|53', '73|Savoie|84',
  '74|Haute-Savoie|84', '75|Paris|11', '76|Seine-Maritime|28', '77|Seine-et-Marne|11',
  '78|Yvelines|11', '79|Deux-Sèvres|75', '80|Somme|32', '81|Tarn|76',
  '82|Tarn-et-Garonne|76', '83|Var|93', '84|Vaucluse|93', '85|Vendée|53',
  '86|Vienne|75', '87|Haute-Vienne|75', '88|Vosges|44', '89|Yonne|27',
  '90|Territoire de Belfort|27', '91|Essonne|11', '92|Hauts-de-Seine|11',
  '93|Seine-Saint-Denis|11', '94|Val-de-Marne|11', '95|Val-d\'Oise|11',
  '971|Guadeloupe|01', '972|Martinique|02', '973|Guyane|03', '974|La Réunion|04',
  '975|Saint-Pierre-et-Miquelon|975', '976|Mayotte|06', '977|Saint-Barthélemy|977',
  '978|Saint-Martin|978', '984|Terres australes françaises|984',
  '986|Wallis-et-Futuna|986', '987|Polynésie française|987',
  '988|Nouvelle-Calédonie|988',
];

const REGIONS = new Map();
const DEPARTMENTS = new Map();
for (const row of REGION_ROWS) {
  const [code, name] = row.split('|');
  REGIONS.set(code, { code, name });
}
for (const row of DEPT_ROWS) {
  const [code, name, regionCode] = row.split('|');
  DEPARTMENTS.set(code, { code, name, regionCode });
}

export const ADMIN_DIVISIONS = {
  departments: DEPARTMENTS.size,
  regions: REGIONS.size,
};

const trim = (value) => String(value ?? '').trim();

/** « 13 » / « 2a » / « 971 » → code normalisé ; sinon `''`. */
function normalizeDeptCode(value) {
  const v = trim(value).toUpperCase();
  if (v === '2A' || v === '2B') return v;
  if (/^\d$/.test(v)) return `0${v}`;
  if (/^\d{2}$/.test(v) || /^\d{3}$/.test(v)) return v;
  return '';
}

/** « 93 » / « 01 » / « 975 » → code normalisé ; sinon `''`. */
function normalizeRegionCode(value) {
  const v = trim(value);
  if (/^\d{2}$/.test(v) || /^\d{3}$/.test(v)) return v;
  return '';
}

/* ==================================================================== */
/* 2. Résolution locale (immédiate, sans réseau)                         */
/* ==================================================================== */

/**
 * Département et région depuis les seules données de l'établissement
 * (champs `departement` / `region` de SIRENE, code postal, code INSEE) —
 * tables locales, aucun appel réseau.
 */
export function divisionFromLocal(etablissement = {}) {
  const codePostal = trim(etablissement.codePostal);
  const codeCommune = trim(etablissement.codeCommune);
  const rawDept = trim(etablissement.departement);
  const rawRegion = trim(etablissement.region);

  const rawDeptCode = normalizeDeptCode(rawDept);
  const deptCode = rawDeptCode || departmentFromCode(codePostal, codeCommune);
  const deptRow = DEPARTMENTS.get(deptCode) || null;

  const rawRegionCode = normalizeRegionCode(rawRegion);
  const deptName = rawDept && !rawDeptCode ? rawDept : (deptRow?.name || '');
  const regionCode = rawRegionCode || deptRow?.regionCode || '';
  const regionRow = REGIONS.get(regionCode) || null;
  const regionName = rawRegion && !rawRegionCode ? rawRegion : (regionRow?.name || '');

  return { deptCode, deptName, regionCode, regionName };
}

/**
 * URLs candidates Géo API, par ordre de fiabilité :
 * code INSEE de la commune, puis code postal (repli pour arrondissements…).
 */
export function communeStatsUrls(etablissement = {}) {
  const codeCommune = trim(etablissement.codeCommune).toUpperCase();
  const codePostal = trim(etablissement.codePostal);
  const urls = [];

  if (/^(?:\d{5}|2[AB]\d{3})$/.test(codeCommune)) {
    const params = new URLSearchParams({ code: codeCommune, fields: GEO_API_FIELDS, format: 'json' });
    urls.push(`${GEO_API_COMMUNES}?${params}`);
  }
  if (/^\d{5}$/.test(codePostal)) {
    const params = new URLSearchParams({ codePostal, fields: GEO_API_FIELDS, format: 'json' });
    urls.push(`${GEO_API_COMMUNES}?${params}`);
  }
  return urls;
}

/** Population formatée française ; `—` si indisponible. */
export function formatPopulation(population) {
  if (population == null) return '—';
  const value = Number(population);
  if (!Number.isFinite(value) || value < 0) return '—';
  return formatIntFr(value);
}

/* ==================================================================== */
/* 3. Appel API Géo France (avec cache TTL et repli local)               */
/* ==================================================================== */

const cache = new TtlCache({
  store: cacheStore,
  prefix: 'cache:admin:',
  ttlMs: 7 * 24 * 3600 * 1000, // 7 jours : population mise à jour ~annuellement
  maxEntries: 80,
});

/** Plusieurs communes peuvent partager un code postal : on préfère le nom. */
function pickCommune(list, communeName) {
  if (list.length === 1) return list[0];
  const wanted = normalizeText(communeName);
  return (wanted && list.find((c) => normalizeText(c?.nom) === wanted)) || list[0];
}

async function queryGeoApi(urls, etablissement, signal) {
  let firstError = null;
  for (const url of urls) {
    try {
      const data = await fetchJson(url, {
        signal,
        timeoutMs: 9000,
        retries: 1,
        retryBaseDelayMs: 400,
        label: 'API Géo France',
      });
      if (Array.isArray(data) && data.length) return pickCommune(data, etablissement.commune);
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  if (firstError) throw firstError;
  return null;
}

function normalizeEntry(entry, local) {
  const deptCode = normalizeDeptCode(entry?.departement?.code) || local.deptCode;
  const deptName = trim(entry?.departement?.nom)
    || DEPARTMENTS.get(deptCode)?.name
    || local.deptName;
  const regionCode = normalizeRegionCode(entry?.region?.code)
    || local.regionCode
    || DEPARTMENTS.get(deptCode)?.regionCode
    || '';
  const regionName = trim(entry?.region?.nom)
    || REGIONS.get(regionCode)?.name
    || local.regionName;
  const rawPop = entry?.population;
  const population = rawPop != null && Number.isFinite(Number(rawPop)) && Number(rawPop) >= 0
    ? Math.round(Number(rawPop))
    : null;

  return { population, deptCode, deptName, regionCode, regionName };
}

/**
 * Population, département et région de l'établissement.
 * Ne rejette jamais : en cas d'indisponibilité réseau, renvoie le repli local
 * (`population: null`, à afficher « — »). Résultat mis en cache 7 jours.
 */
export async function fetchCommuneStats(etablissement = {}, { signal = null } = {}) {
  const local = divisionFromLocal(etablissement);
  const fallback = { population: null, ...local, source: 'local' };

  const urls = communeStatsUrls(etablissement);
  if (!urls.length) return fallback;

  try {
    const entry = await cache.wrap(`commune:${urls[0]}`, () => queryGeoApi(urls, etablissement, signal));
    if (!entry) return fallback;
    return { ...normalizeEntry(entry, local), source: 'geoapi' };
  } catch {
    return fallback;
  }
}
