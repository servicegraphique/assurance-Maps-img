/**
 * labels.js — Traduction des codes administratifs en libellés lisibles.
 *
 * Responsabilité : charger une seule fois les référentiels publics INSEE
 * livrés dans assets/data/ puis fournir des getters synchrones.
 * Aucune donnée d'entreprise ici, uniquement des nomenclatures.
 */

const FILES = {
  naf: 'naf-codes.json',
  departements: 'departements.json',
  regions: 'regions.json',
  naturesJuridiques: 'natures-juridiques.json',
  effectifs: 'tranches-effectifs.json',
};

const data = {};
let loadPromise = null;

/** Charge les référentiels en parallèle (≈ 60 Ko, une seule fois). */
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
        // Dégradation douce : les codes bruts resteront affichés.
        data[key] = {};
      }
    }),
  ).then(() => data);
  return loadPromise;
}

export const nafLabel = (code) => (code ? data.naf?.[code] || '' : '');
export const departementLabel = (code) => (code ? data.departements?.[code] || '' : '');
export const regionLabel = (code) => (code ? data.regions?.[code] || '' : '');
export const natureJuridiqueLabel = (code) => (code ? data.naturesJuridiques?.[code] || '' : '');
export const effectifLabel = (code) => (code ? data.effectifs?.[code] || '' : '');

/** « 62.01Z — Programmation informatique » (ou le code seul si inconnu). */
export function nafWithLabel(code) {
  if (!code) return '';
  const label = nafLabel(code);
  return label ? `${code} — ${label}` : code;
}

/** Suggestions de villes pour le datalist (départements → non, on garde léger). */
export const labelsReady = () => Boolean(data.naf);

export default { loadLabels, nafLabel, departementLabel, regionLabel, natureJuridiqueLabel, effectifLabel, nafWithLabel };
