/**
 * labels.js — Référentiels INSEE (codes NAF et tranches d'effectifs).
 */

const FILES = {
  naf: 'naf-codes.json',
  effectifs: 'tranches-effectifs.json',
};

const data = {};
let loadPromise = null;

export function loadLabels() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      try {
        const url = new URL(`../assets/data/${file}`, import.meta.url);
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data[key] = await response.json();
      } catch {
        data[key] = {};
      }
    }),
  ).then(() => data);
  return loadPromise;
}

/** Accepte « 68.20B » comme « 6820B ». */
function normalizeNafKey(code) {
  const raw = String(code ?? '').trim().toUpperCase();
  if (!raw) return '';
  if (raw.includes('.')) return raw;
  return raw.length >= 4 ? `${raw.slice(0, 2)}.${raw.slice(2)}` : raw;
}

export function nafLabel(code) {
  const key = normalizeNafKey(code);
  return key ? (data.naf?.[key] || data.naf?.[code] || '') : '';
}

export function effectifLabel(code) {
  return code ? (data.effectifs?.[code] || '') : '';
}

/** Format CRM compact : « 6820B – Location de terrains et d'autres biens immobiliers ». */
export function nafCompactWithLabel(code) {
  if (!code) return '—';
  const compact = String(code).trim().toUpperCase().replace(/\./g, '');
  const label = nafLabel(code);
  return label ? `${compact} – ${label}` : compact;
}

export const EFFECTIF_OPTIONS = [
  { value: '', label: 'Effectif inconnu' },
  { value: '00', label: '0 salarié' },
  { value: '01', label: '1 ou 2 salariés' },
  { value: '02', label: '3 à 5 salariés' },
  { value: '03', label: '6 à 9 salariés' },
  { value: '11', label: '10 à 19 salariés' },
  { value: '12', label: '20 à 49 salariés' },
  { value: '21', label: '50 à 99 salariés' },
  { value: '22', label: '100 à 199 salariés' },
  { value: '31', label: '200 à 249 salariés' },
  { value: '32', label: '250 à 499 salariés' },
  { value: '41', label: '500 à 999 salariés' },
  { value: '42', label: '1 000 à 1 999 salariés' },
  { value: '51', label: '2 000 à 4 999 salariés' },
  { value: '52', label: '5 000 à 9 999 salariés' },
  { value: '53', label: '10 000 salariés et plus' },
];

/** Convertit un code INSEE en valeur de liste CRM (`NN` → inconnu). */
export function normalizeEffectifOption(code) {
  const clean = String(code ?? '').trim().toUpperCase();
  if (!clean || clean === 'NN') return '';
  return EFFECTIF_OPTIONS.some((opt) => opt.value === clean) ? clean : '';
}

export default {
  loadLabels,
  nafLabel,
  effectifLabel,
  nafCompactWithLabel,
  normalizeEffectifOption,
  EFFECTIF_OPTIONS,
};
