/**
 * export.js — Exportation et copie des données.
 *
 * Responsabilité : sérialiser les résultats et les fiches (CSV, GeoJSON,
 * JSON), déclencher les téléchargements et copier les informations clés.
 *
 * Le CSV est produit en UTF-8 avec BOM, séparateur « ; » et fins de ligne
 * CRLF : c'est le format qu'Excel (version française, sous Windows) ouvre
 * correctement sans assistant d'importation.
 */

import config from './config.js';
import {
  downloadText, slugifyFilename, timestampForFilename, formatCoords,
  formatSiren, formatSiret, copyText, digitsOnly,
} from './utils.js';
import { nafLabel, departementLabel, regionLabel, natureJuridiqueLabel } from './labels.js';
import { favorites } from './storage.js';
import { osmLink } from './map.js';

/* ==================================================================== */
/* 1. Sérialisation CSV                                                  */
/* ==================================================================== */

/** Échappe une cellule CSV (guillemets doublés, cellules protégées). */
export function csvCell(value) {
  if (value == null) return '';
  let str = String(value);
  // Neutralise l'injection de formule dans Excel/LibreOffice.
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[";\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * @param {Array<object>} rows
 * @param {Array<{key:string,label:string,map?:Function}>} columns
 */
export function toCsv(rows, columns, { delimiter = ';', bom = true } = {}) {
  const header = columns.map((column) => csvCell(column.label)).join(delimiter);
  const lines = rows.map((row) => columns
    .map((column) => csvCell(column.map ? column.map(row) : row[column.key]))
    .join(delimiter));
  return `${bom ? '\uFEFF' : ''}${[header, ...lines].join('\r\n')}\r\n`;
}

/* ==================================================================== */
/* 2. Colonnes des résultats                                             */
/* ==================================================================== */

export const RESULT_COLUMNS = [
  { label: 'Raison sociale', map: (r) => r.entreprise.raisonSociale || r.entreprise.nomComplet },
  { label: 'Nom commercial / enseigne', map: (r) => r.etablissement.nomCommercial || r.etablissement.enseignes.join(' | ') },
  { label: 'SIREN', map: (r) => digitsOnly(r.entreprise.siren) },
  { label: 'SIRET', map: (r) => digitsOnly(r.etablissement.siret) },
  { label: 'Type', map: (r) => (r.etablissement.estSiege ? 'Siège' : 'Établissement') },
  { label: 'État', map: (r) => (r.etablissement.estActif ? 'Actif' : (r.etablissement.etatAdministratif === 'C' ? 'Fermé' : 'Inconnu')) },
  { label: 'Code NAF/APE', map: (r) => r.etablissement.naf },
  { label: 'Activité', map: (r) => nafLabel(r.etablissement.naf) },
  { label: 'Adresse', map: (r) => r.etablissement.adresse },
  { label: 'Code postal', map: (r) => r.etablissement.codePostal },
  { label: 'Commune', map: (r) => r.etablissement.commune },
  { label: 'Département', map: (r) => `${r.etablissement.departement} ${departementLabel(r.etablissement.departement)}`.trim() },
  { label: 'Région', map: (r) => regionLabel(r.etablissement.region) },
  { label: 'Pays', map: (r) => r.etablissement.pays },
  { label: 'Latitude', map: (r) => (Number.isFinite(r.etablissement.latitude) ? r.etablissement.latitude : '') },
  { label: 'Longitude', map: (r) => (Number.isFinite(r.etablissement.longitude) ? r.etablissement.longitude : '') },
  { label: 'Source coordonnées', map: (r) => (Number.isFinite(r.etablissement.latitude) ? 'SIRENE via API Recherche d\'entreprises' : '') },
  { label: 'Date création établissement', map: (r) => r.etablissement.dateCreation },
  { label: 'Date fermeture', map: (r) => r.etablissement.dateFermeture },
  { label: 'Forme juridique', map: (r) => natureJuridiqueLabel(r.entreprise.natureJuridique) },
  { label: 'Nombre d\'établissements (société)', map: (r) => r.entreprise.nombreEtablissements },
  { label: 'Lien OpenStreetMap', map: (r) => (Number.isFinite(r.etablissement.latitude) ? osmLink(r.etablissement.latitude, r.etablissement.longitude) : '') },
  { label: 'Fiche Annuaire des entreprises', map: (r) => r.etablissement.sourceUrl },
];

/** Export CSV des résultats affichés. */
export function exportResultsCsv(rows, criteria = {}) {
  const csv = toCsv(rows, RESULT_COLUMNS);
  const label = [criteria.nom, criteria.codePostal, criteria.ville].filter(Boolean).join(' ');
  const filename = `company-locator_resultats_${slugifyFilename(label, 'recherche')}_${timestampForFilename()}.csv`;
  downloadText(filename, csv, 'text/csv;charset=utf-8');
  return { filename, count: rows.length };
}

/* ==================================================================== */
/* 3. GeoJSON (SIG, QGIS…)                                               */
/* ==================================================================== */

export function toGeoJson(rows, positions = new Map()) {
  const features = [];
  for (const row of rows) {
    const position = positions.get(row.etablissement.siret);
    const lat = position?.lat ?? row.etablissement.latitude;
    const lon = position?.lon ?? row.etablissement.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(lon), Number(lat)] },
      properties: {
        nom: row.etablissement.nomAffiche,
        raison_sociale: row.entreprise.raisonSociale,
        siren: row.entreprise.siren,
        siret: row.etablissement.siret,
        siege: row.etablissement.estSiege,
        etat: row.etablissement.estActif ? 'actif' : 'ferme',
        naf: row.etablissement.naf,
        adresse: row.etablissement.adresse,
        code_postal: row.etablissement.codePostal,
        commune: row.etablissement.commune,
        precision: position?.precision || 'sirene',
        source_coordonnees: position?.source || 'SIRENE via API Recherche d\'entreprises',
      },
    });
  }
  return {
    type: 'FeatureCollection',
    name: 'company-locator-france',
    features,
    metadata: {
      generated_at: new Date().toISOString(),
      generator: `${config.app.name} ${config.app.version}`,
      crs: 'EPSG:4326',
    },
  };
}

export function exportResultsGeoJson(rows, positions, criteria = {}) {
  const geojson = toGeoJson(rows, positions);
  const label = [criteria.nom, criteria.codePostal, criteria.ville].filter(Boolean).join(' ');
  const filename = `company-locator_${slugifyFilename(label, 'recherche')}_${timestampForFilename()}.geojson`;
  downloadText(filename, JSON.stringify(geojson, null, 2), 'application/geo+json;charset=utf-8');
  return { filename, count: geojson.features.length };
}

/* ==================================================================== */
/* 4. Fiche détaillée                                                    */
/* ==================================================================== */

/** Construit les paires (champ, valeur, source) d'une fiche complète. */
export function ficheFields(fiche) {
  const { etablissement: e, entreprise: c, position: p } = fiche;
  const fields = [
    ['Dénomination / raison sociale', c.raisonSociale || c.nomComplet, 'API Recherche d\'entreprises (DINUM)'],
    ['Nom complet', c.nomComplet, 'API Recherche d\'entreprises'],
    ['Sigle', c.sigle, 'API Recherche d\'entreprises'],
    ['Nom commercial', e.nomCommercial, 'API Recherche d\'entreprises'],
    ['Enseignes', e.enseignes.join(' | '), 'API Recherche d\'entreprises'],
    ['SIREN', formatSiren(c.siren), 'INSEE / SIRENE'],
    ['SIRET', formatSiret(e.siret), 'INSEE / SIRENE'],
    ['Type d\'établissement', e.estSiege ? 'Siège social' : 'Établissement secondaire', 'INSEE / SIRENE'],
    ['État administratif', e.estActif ? 'Actif' : (e.etatAdministratif === 'C' ? 'Fermé' : 'Inconnu'), 'INSEE / SIRENE'],
    ['Date de création', e.dateCreation, 'INSEE / SIRENE'],
    ['Date de fermeture', e.dateFermeture, 'INSEE / SIRENE'],
    ['Code NAF/APE', e.naf, 'INSEE'],
    ['Activité (libellé)', nafLabel(e.naf), 'Nomenclature NAF rév. 2, INSEE'],
    ['Forme juridique', natureJuridiqueLabel(c.natureJuridique), 'INSEE, catégories juridiques'],
    ['Catégorie d\'entreprise', c.categorie, 'INSEE'],
    ['Nombre d\'établissements', c.nombreEtablissements, 'API Recherche d\'entreprises'],
    ['Établissements ouverts', c.nombreEtablissementsOuverts, 'API Recherche d\'entreprises'],
    ['Adresse complète', e.adresse, 'INSEE / SIRENE'],
    ['Numéro et voie', e.voie, 'INSEE / SIRENE'],
    ['Complément d\'adresse', e.complementAdresse, 'INSEE / SIRENE'],
    ['Code postal', e.codePostal, 'INSEE / SIRENE'],
    ['Commune', e.commune, 'INSEE / SIRENE'],
    ['Code commune INSEE', e.codeCommune, 'INSEE / COG'],
    ['Département', `${e.departement} — ${departementLabel(e.departement)}`.trim().replace(/—\s*$/, '').trim(), 'INSEE / COG'],
    ['Région', regionLabel(e.region), 'INSEE / COG'],
    ['Pays', e.pays, 'INSEE / SIRENE'],
    ['Latitude', p ? p.lat : '', p?.source || ''],
    ['Longitude', p ? p.lon : '', p?.source || ''],
    ['Précision de la position', p?.precision || '', p?.source || ''],
    ['Adresse géocodée', p?.label || '', p?.source || ''],
    ['Score de géocodage', p?.score ?? '', 'Base Adresse Nationale'],
    ['Écart SIRENE / BAN (m)', p?.divergenceM ?? '', 'Calcul local (haversine)'],
    ['Lien OpenStreetMap', p ? osmLink(p.lat, p.lon) : '', 'OpenStreetMap'],
    ['Fiche officielle', e.sourceUrl, 'Annuaire des Entreprises (DINUM)'],
  ];
  return fields.filter(([, value]) => value !== '' && value != null);
}

export function exportFicheCsv(fiche) {
  const rows = ficheFields(fiche).map(([champ, valeur, source]) => ({ champ, valeur, source }));
  const csv = toCsv(rows, [
    { key: 'champ', label: 'Champ' },
    { key: 'valeur', label: 'Valeur' },
    { key: 'source', label: 'Source' },
  ]);
  const filename = `company-locator_fiche_${fiche.etablissement.siret}_${timestampForFilename()}.csv`;
  downloadText(filename, csv, 'text/csv;charset=utf-8');
  return { filename, count: rows.length };
}

export function exportFicheJson(fiche) {
  const filename = `company-locator_fiche_${fiche.etablissement.siret}_${timestampForFilename()}.json`;
  downloadText(filename, JSON.stringify({
    exportedAt: new Date().toISOString(),
    generator: `${config.app.name} ${config.app.version}`,
    ...fiche,
  }, null, 2), 'application/json;charset=utf-8');
  return { filename };
}

export function exportFavoritesJson() {
  const list = favorites.list();
  const filename = `company-locator_fiches-enregistrees_${timestampForFilename()}.json`;
  downloadText(filename, JSON.stringify({
    exportedAt: new Date().toISOString(),
    count: list.length,
    fiches: list,
  }, null, 2), 'application/json;charset=utf-8');
  return { filename, count: list.length };
}

/* ==================================================================== */
/* 5. Presse-papiers & textes                                            */
/* ==================================================================== */

export function addressText(etablissement) {
  return [etablissement.adresse || etablissement.voie, etablissement.codePostal, etablissement.commune]
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim() || [etablissement.codePostal, etablissement.commune].filter(Boolean).join(' ');
}

export const gpsText = (position) => (position ? formatCoords(position.lat, position.lon) : '');

export const copyAddress = (etablissement) => copyText(addressText(etablissement));
export const copyGps = (position) => copyText(gpsText(position));
export const copySiret = (siret) => copyText(digitsOnly(siret));
export const copySiren = (siren) => copyText(digitsOnly(siren));
