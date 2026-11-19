import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  formatCreationMonthFr, formatCoordCardinal, formatIntFr, formatLocationLine,
  googleEarthUrl, googleStreetViewUrl, mapDirigeantToBuyer, inferEntityType,
  computeBuildingSurface, computeSolarPotential, computeSeaDistance,
  computeAccessibility, computeEnvironment, computeFinancialScore, computeElectricityEstimate,
} from '../../js/enrichment.js';
import { normalizeEntreprise } from '../../js/entreprise-api.js';
import { siteUrl, altitudeUrl } from '../../js/site-data.js';
import { crmSheets, defaultQuoteId, purgeEverything } from '../../js/storage.js';

const turfCode = readFileSync(new URL('../../vendor/turf/turf.min.js', import.meta.url), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(turfCode, ctx);
const { turf } = ctx;

test('Formatage CRM : date de création, coordonnées cardinales, adresse et liens externes', () => {
  assert.equal(formatCreationMonthFr('2020-03-15'), 'Mars 2020');
  assert.equal(formatCreationMonthFr('2015-11-01'), 'Novembre 2015');
  assert.equal(formatCreationMonthFr(''), '—');

  assert.equal(formatCoordCardinal(43.45381, 5.19212, 4), '43.4538° N, 5.1921° E');
  assert.equal(formatCoordCardinal(48.3904, -4.4861, 4), '48.3904° N, 4.4861° O');
  assert.equal(formatCoordCardinal(-20.882, 55.450, 3), '20.882° S, 55.450° E');

  assert.equal(formatIntFr(18500), '18 500');
  assert.equal(formatIntFr(222000), '222 000');

  assert.equal(
    formatLocationLine({ voie: '4 RUE DU LAVOIR', codePostal: '13340', commune: 'ROGNAC', pays: 'France' }),
    '4 Rue du Lavoir, 13340 Rognac, France',
  );

  assert.match(googleEarthUrl(43.4538, 5.1921, 45), /^https:\/\/earth\.google\.com\/web\/@43\.453800,5\.192100,45a/);
  assert.match(googleStreetViewUrl(43.4538, 5.1921, 120), /^https:\/\/www\.google\.com\/maps\/@\?.*map_action=pano.*viewpoint=43\.453800%2C5\.192100.*heading=120/);
});

test('Dirigeants & bilans normalisés depuis l’API entreprises → Acheteur CRM', () => {
  const ent = normalizeEntreprise({
    siren: '883292302',
    nom_complet: 'ABIOTECH-MTS',
    etat_administratif: 'A',
    activite_principale: '68.20B',
    date_creation: '2020-03-01',
    dirigeants: [
      { nom: 'RICHARD', prenoms: 'MARC JEAN', qualite: 'Gérant', type_dirigeant: 'personne physique' },
    ],
    finances: {
      2024: { ca: 820000, resultat_net: 74000 },
      2023: { ca: 790000, resultat_net: 68000 },
    },
    siege: { siret: '88329230200014', etat_administratif: 'A', code_postal: '13340', libelle_commune: 'ROGNAC' },
  });

  assert.equal(ent.dirigeants.length, 1);
  assert.equal(ent.finances.length, 2);
  assert.equal(ent.finances[0].year, 2024);

  const buyer = mapDirigeantToBuyer(ent.dirigeants);
  assert.equal(buyer.civilite, 'Monsieur');
  assert.equal(buyer.prenom, 'Marc');
  assert.equal(buyer.nom, 'RICHARD');
  assert.equal(buyer.fonction, 'Direction générale -> PDG - DG - Gérant');
  assert.equal(inferEntityType(ent), 'Professionnel');
});

test('Indicateurs de site pour Rognac (13340) : surface, solaire, mer, accessibilité, environnement', () => {
  const lat = 43.4538;
  const lon = 5.1921;

  // Bâtiment ~ 40 m × 30 m ≈ 1 200 m²
  const dLat = 30 / 110540;
  const dLon = 40 / (111320 * Math.cos((lat * Math.PI) / 180));
  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { usage_1: 'Industriel', hauteur: 8 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[lon - dLon / 2, lat - dLat / 2], [lon + dLon / 2, lat - dLat / 2],
          [lon + dLon / 2, lat + dLat / 2], [lon - dLon / 2, lat + dLat / 2], [lon - dLon / 2, lat - dLat / 2]]],
      },
    }],
  };

  const bld = computeBuildingSurface(geojson, lat, lon, turf, { naf: '68.20B' });
  assert.equal(bld.source, 'bdtopo');
  assert.ok(bld.surfaceM2 >= 1150 && bld.surfaceM2 <= 1250);
  assert.equal(bld.display, '~ 1 200 m²');
  assert.equal(bld.heightM, 8);

  const solar = computeSolarPotential(lat, lon, bld.surfaceM2);
  assert.equal(solar.rating, 'Très bon');
  assert.equal(solar.subtitle, 'Toiture adaptée');
  assert.ok(solar.installableKwc > 50);

  const sea = computeSeaDistance(lat, lon);
  assert.ok(sea.km >= 3 && sea.km <= 12);
  assert.equal(sea.subtitle, 'Littoral proche');

  const acc = computeAccessibility(lat, lon);
  assert.match(acc.line1, /^Aéroport à \d+ km$/);
  assert.match(acc.line2, /^A7 à \d+ km$/);

  const env = computeEnvironment({ buildingUsage: bld.usage, naf: '68.20B', airportKm: acc.airportKm });
  assert.equal(env.line1, 'Zone d\'activité');
  assert.equal(env.line2, 'PEB moyen');
});

test('Note financière et consommation d’électricité estimées', () => {
  const active = computeFinancialScore(
    { estActif: true, dateCreation: '2020-03-01', trancheEffectif: 'NN', finances: [] },
    { estActif: true },
    2026,
  );
  assert.ok(active.score >= 65 && active.score <= 80);
  assert.equal(active.riskLabel, 'Risque faible');
  assert.equal(active.solvency, 'Bonne');
  assert.equal(active.trend, 'Stable');
  assert.equal(active.trendArrow, '→');
  assert.equal(active.lastBalanceYear, '2024');

  const closed = computeFinancialScore({ estActif: false }, { estActif: false }, 2026);
  assert.ok(closed.score < 30);
  assert.equal(closed.tone, 'danger');

  const elec = computeElectricityEstimate({ naf: '68.20B', surfaceM2: 1200, lat: 43.4538 });
  assert.equal(elec.monthlyKwh, 18500);
  assert.equal(elec.annualKwh, 222000);
  assert.equal(elec.monthlySeries.length, 12);
  assert.equal(elec.monthlySeries[0].letter, 'J');
  assert.equal(elec.monthlySeries[11].letter, 'D');
});

test('URLs BD TOPO et altimétrie bornées + stockage CRM par SIRET', () => {
  const wfs = new URL(siteUrl('batiments', 43.4538, 5.1921));
  assert.equal(wfs.origin, 'https://data.geopf.fr');
  assert.equal(wfs.searchParams.get('typeName'), 'BDTOPO_V3:batiment');
  assert.throws(() => siteUrl('inconnu', 43.45, 5.19));

  const alti = new URL(altitudeUrl(43.4538, 5.1921));
  assert.equal(alti.origin, 'https://data.geopf.fr');
  assert.equal(alti.searchParams.get('zonly'), 'true');

  purgeEverything();
  const siret = '88329230200014';
  assert.match(defaultQuoteId(siret), /^\d{7}$/);
  crmSheets.patch(siret, { website: 'https://abiotech.fr', prenom: 'Marc' });
  crmSheets.addComment(siret, { text: 'changement d\'adresse en cours', author: 'hellodevis_28' });
  const saved = crmSheets.get(siret);
  assert.equal(saved.website, 'https://abiotech.fr');
  assert.equal(saved.comments.length, 1);
  assert.equal(saved.comments[0].author, 'hellodevis_28');
  purgeEverything();
});
