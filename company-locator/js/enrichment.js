/**
 * enrichment.js — Calculs métier et indicateurs d'enrichissement d'une fiche.
 *
 * Module pur (sans DOM, sans réseau, intégralement testé) :
 *  - Surface bâtiment (BD TOPO® IGN via Turf, avec repli estimé transparent)
 *  - Potentiel solaire (gisement régional français + rayonnement + toiture)
 *  - Distance mer / Accessibilité / Environnement : calculs géographiques de
 *    référence (exportés et testés, remplacés dans le bandeau KPI par
 *    Population / Département / Région — voir js/commune-stats.js)
 *  - Note financière estimée (données officielles INPI/SIRENE : état, bilans, ancienneté, effectif)
 *  - Consommation d'électricité estimée (ratios sectoriels NAF × surface × profil saisonnier J–D)
 *  - Formatage CRM (dirigeant → acheteur, coordonnées cardinales, date de création, liens externes)
 */

import { clamp, haversineM } from './utils.js';
import { nearestCoastKm, nearestAirport, nearestMotorway } from './geo-reference.js';

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

export const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
export const MONTH_NAMES_SHORT = ['Jan.', 'Fév.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

/* ==================================================================== */
/* 1. Formatage CRM                                                      */
/* ==================================================================== */

/** « 2020-03-12 » → « Mars 2020 ». */
export function formatCreationMonthFr(isoDate) {
  const match = /^(\d{4})-(\d{2})/.exec(String(isoDate ?? '').trim());
  if (!match) return '—';
  const monthIdx = Number(match[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return match[1];
  return `${MONTHS_FR[monthIdx]} ${match[1]}`;
}

/** Coordonnées cardinales : « 43.4538° N, 5.1921° E ». */
export function formatCoordCardinal(lat, lon, decimals = 4) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return '—';
  const ns = la >= 0 ? 'N' : 'S';
  const eo = lo >= 0 ? 'E' : 'O';
  return `${Math.abs(la).toFixed(decimals)}° ${ns}, ${Math.abs(lo).toFixed(decimals)}° ${eo}`;
}

/** Entier formaté avec espace insécable fine (« 18 500 »). */
export function formatIntFr(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return '—';
  return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Montant en euros lisible (« 1 250 000 € » ou « 420 k€ »). */
export function formatEuroFr(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  const sign = num < 0 ? '−' : '';
  return `${sign}${formatIntFr(Math.abs(num))} €`;
}

/** « 4 RUE DU LAVOIR » → « 4 Rue du Lavoir ». */
const SMALL_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'au', 'aux', 'en', 'et', 'sur', 'sous', 'a', 'à']);
export function titleCaseFr(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return '';
  return raw
    .toLowerCase()
    .split(/(\s+|-|')/)
    .map((part, idx) => {
      if (!part || /^(\s+|-|')$/.test(part)) return part;
      if (idx > 0 && SMALL_WORDS.has(part)) return part;
      if (/^\d+[a-z]*$/i.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

/** « 4 Rue du Lavoir, 13340 Rognac, France ». */
export function formatLocationLine(etablissement) {
  if (!etablissement) return '—';
  const street = titleCaseFr(etablissement.voie || '');
  const city = [etablissement.codePostal, titleCaseFr(etablissement.commune || '')].filter(Boolean).join(' ');
  const country = titleCaseFr(etablissement.pays || 'France');
  return [street, city, country].filter(Boolean).join(', ') || '—';
}

/** Lien direct Google Earth centré sur le bâtiment. */
export function googleEarthUrl(lat, lon, altitudeM = 50) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return '';
  const alt = Number.isFinite(Number(altitudeM)) ? Math.max(0, Math.round(Number(altitudeM))) : 50;
  return `https://earth.google.com/web/@${la.toFixed(6)},${lo.toFixed(6)},${alt}a,260d,35y,0h,45t,0r`;
}

/** Lien direct Google Street View au point de l'établissement. */
export function googleStreetViewUrl(lat, lon, heading = null) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return '';
  const params = new URLSearchParams({
    api: '1',
    map_action: 'pano',
    viewpoint: `${la.toFixed(6)},${lo.toFixed(6)}`,
  });
  if (Number.isFinite(Number(heading)) && heading !== null) {
    params.set('heading', String(Math.round(((Number(heading) % 360) + 360) % 360)));
  }
  return `https://www.google.com/maps/@?${params}`;
}

/** Traduit un dirigeant officiel de l'API en fiche Acheteur CRM pré-remplie. */
export function mapDirigeantToBuyer(dirigeants = []) {
  if (!Array.isArray(dirigeants) || !dirigeants.length) {
    return { civilite: 'Monsieur', prenom: '', nom: '', fonction: '' };
  }
  const person = dirigeants.find((d) => d.type === 'personne physique') || dirigeants[0];
  const firstToken = String(person.prenoms ?? '').trim().split(/[\s,]+/)[0] || '';
  const prenom = titleCaseFr(firstToken);
  const nom = String(person.nom ?? '').trim().toUpperCase();
  const q = String(person.qualite ?? '').trim();
  const ql = q.toLowerCase();

  let fonction = 'Direction générale -> PDG - DG - Gérant';
  if (/financier|comptab|tr[ée]sorier|daf/.test(ql)) {
    fonction = 'Direction financière -> DAF - Comptabilité';
  } else if (/commercial|vente/.test(ql)) {
    fonction = 'Direction commerciale -> Directeur commercial';
  } else if (/technique|exploitation|travaux|production/.test(ql)) {
    fonction = 'Direction technique -> Directeur technique';
  } else if (/pr[ée]sident|g[ée]rant|directeur g[ée]n[ée]ral|pdg|associ[ée]|exploitant|entrepreneur/.test(ql) || !q) {
    fonction = 'Direction générale -> PDG - DG - Gérant';
  } else {
    fonction = `Direction générale -> ${q}`;
  }

  return {
    civilite: inferCiviliteFromFirstName(firstToken),
    prenom,
    nom,
    fonction,
  };
}

const COMMON_FEMININE = new Set([
  'marie', 'nathalie', 'isabelle', 'sylvie', 'catherine', 'valerie', 'christine', 'sophie',
  'sandrine', 'celine', 'anne', 'julie', 'aurelie', 'laurence', 'stephanie', 'virginie',
  'caroline', 'claire', 'camille', 'pauline', 'emilie', 'elodie', 'marine', 'sarah',
  'laura', 'chloe', 'manon', 'lea', 'florence', 'veronique', 'martine', 'brigitte',
  'patricia', 'corinne', 'delphine', 'audrey', 'helene', 'marion', 'charlotte', 'lucie',
]);

function inferCiviliteFromFirstName(firstName) {
  const norm = String(firstName ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (!norm) return 'Monsieur';
  return COMMON_FEMININE.has(norm) ? 'Madame' : 'Monsieur';
}

/** Type de structure affiché dans le sélecteur CRM. */
export function inferEntityType(entreprise) {
  if (entreprise?.estAssociation) return 'Association';
  if (entreprise?.estServicePublic) return 'Collectivité / Administration';
  return 'Professionnel';
}

/* ==================================================================== */
/* 2. Indicateurs de site (surface, solaire, mer, access, environnement)  */
/* ==================================================================== */

function nafDivision(naf) {
  const digits = String(naf ?? '').replace(/\D/g, '');
  return digits.length >= 2 ? Number(digits.slice(0, 2)) : null;
}

const EFFECTIF_MIDPOINT = {
  '': 4, NN: 2, '00': 2, '01': 2, '02': 4, '03': 8,
  '11': 15, '12': 32, '21': 70, '22': 140, '31': 220,
  '32': 350, '41': 700, '42': 1400, '51': 3000, '52': 7000, '53': 12000,
};

/** Estimation de repli de la surface au sol si le WFS BD TOPO ne renvoie pas de bâtiment. */
export function fallbackSurfaceM2(naf, trancheEffectif = '') {
  const div = nafDivision(naf);
  const staff = EFFECTIF_MIDPOINT[String(trancheEffectif || '').toUpperCase()] ?? 4;
  let base = 450;
  if (div != null) {
    if ((div >= 10 && div <= 33) || div === 38) base = 1400; // industrie
    else if (div === 49 || div === 52) base = 1800; // logistique / entreposage
    else if (div === 68) base = 1200; // immobilier d'entreprise / foncière
    else if (div >= 41 && div <= 43) base = 650; // BTP / ateliers
    else if (div >= 45 && div <= 47) base = 850; // commerce / concessions
    else if (div >= 1 && div <= 3) base = 1500; // bâtiments agricoles
    else if (div === 55 || div === 56) base = 520; // hôtellerie-restauration
    else if (div >= 86 && div <= 88) base = 900; // santé
    else base = 380; // tertiaire / bureaux
  }
  const scaled = staff > 10 ? base + Math.min(8000, (staff - 10) * 18) : base;
  return roundSurface(scaled);
}

function roundSurface(m2) {
  const val = Math.max(40, Number(m2) || 400);
  if (val >= 1000) return Math.round(val / 50) * 50;
  if (val >= 200) return Math.round(val / 10) * 10;
  return Math.round(val / 5) * 5;
}

/**
 * Calcule la surface au sol du bâtiment à partir des polygones BD TOPO® IGN.
 */
export function computeBuildingSurface(geojson, lat, lon, turf, { naf = '', trancheEffectif = '', manualM2 = null } = {}) {
  if (Number.isFinite(Number(manualM2)) && Number(manualM2) > 0) {
    const m2 = Math.round(Number(manualM2));
    return {
      surfaceM2: m2,
      display: `~ ${formatIntFr(m2)} m²`,
      subtitle: 'Saisi',
      source: 'manual',
      usage: '',
      heightM: null,
    };
  }

  const features = Array.isArray(geojson?.features)
    ? geojson.features.filter((f) => ['Polygon', 'MultiPolygon'].includes(f?.geometry?.type))
    : [];

  if (turf && features.length && Number.isFinite(lat) && Number.isFinite(lon)) {
    const pt = turf.point([lon, lat]);
    let chosen = features.find((f) => {
      try { return turf.booleanPointInPolygon(pt, f); } catch { return false; }
    }) || null;

    if (!chosen) {
      let bestDist = Infinity;
      for (const f of features) {
        try {
          const c = turf.centroid(f).geometry.coordinates;
          const dist = haversineM(lat, lon, c[1], c[0]);
          const area = turf.area(f);
          if (area < 25) continue; // ignore abris/annexes minuscules
          if (dist < bestDist && dist <= 65) {
            bestDist = dist;
            chosen = f;
          }
        } catch { /* polygone invalide */ }
      }
    }

    if (chosen) {
      const rawArea = turf.area(chosen);
      if (Number.isFinite(rawArea) && rawArea >= 20) {
        const m2 = roundSurface(rawArea);
        const props = chosen.properties || {};
        return {
          surfaceM2: m2,
          display: `~ ${formatIntFr(m2)} m²`,
          subtitle: 'Estimé',
          source: 'bdtopo',
          usage: String(props.usage_1 || props.nature || '').trim(),
          heightM: Number.isFinite(Number(props.hauteur)) ? Math.round(Number(props.hauteur)) : null,
        };
      }
    }
  }

  const est = fallbackSurfaceM2(naf, trancheEffectif);
  return {
    surfaceM2: est,
    display: `~ ${formatIntFr(est)} m²`,
    subtitle: 'Estimé',
    source: 'estimated',
    usage: '',
    heightM: null,
  };
}

/**
 * Gisement solaire annuel moyen estimé (kWh/m²/an) selon la position en France.
 */
export function estimateAnnualIrradiation(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return 1300;
  // DROM (zone intertropicale)
  if (Math.abs(la) < 25) return 1780;
  // Gradient nord-sud métropolitain (51°N ≈ 1 080 → 42.5°N ≈ 1 650) + bonus méditerranéen
  let ghi = 1080 + (51 - clamp(la, 41.3, 51.1)) * 64;
  if (la < 44.6 && lo > 2.8) ghi += 95; // Arc méditerranéen / Provence / Corse
  if (la < 46.2 && lo < -0.3) ghi += 35; // Façade atlantique sud
  return Math.round(clamp(ghi, 1050, 1800));
}

export function computeSolarPotential(lat, lon, surfaceM2 = 500) {
  const irradiation = estimateAnnualIrradiation(lat, lon);
  let rating = 'Correct';
  if (irradiation >= 1500) rating = 'Très bon';
  else if (irradiation >= 1320) rating = 'Bon';
  else if (irradiation < 1170) rating = 'Modéré';

  const usableM2 = Math.round(Math.max(40, Number(surfaceM2) || 400) * 0.6);
  const kwc = Math.max(6, Math.round(usableM2 * 0.19));
  const specificYield = Math.round(irradiation * 0.78);
  const annualProdKwh = Math.round((kwc * specificYield) / 500) * 500;
  const subtitle = (Number(surfaceM2) || 0) >= 180 ? 'Toiture adaptée' : 'Surface compacte';

  return {
    rating,
    subtitle,
    irradiationKwhM2: irradiation,
    installableKwc: kwc,
    annualProdKwh,
  };
}

export function computeSeaDistance(lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
    return { km: null, display: '—', subtitle: '—' };
  }
  const rawKm = nearestCoastKm(Number(lat), Number(lon));
  const km = rawKm < 1 ? 1 : Math.round(rawKm);
  let subtitle = 'Intérieur des terres';
  if (km <= 3) subtitle = 'Zone côtière';
  else if (km <= 18) subtitle = 'Littoral proche';
  else if (km <= 55) subtitle = 'Arrière-pays';

  return {
    km,
    display: `~ ${formatIntFr(km)} km`,
    subtitle,
  };
}

export function computeAccessibility(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    return { line1: '—', line2: '—', airportKm: null, airportName: '', motorwayCode: '', motorwayKm: null };
  }
  const airport = nearestAirport(la, lo);
  const motorway = nearestMotorway(la, lo);
  const airKm = airport ? Math.max(1, Math.round(airport.km)) : null;
  const roadKm = motorway ? Math.max(1, Math.round(motorway.km)) : null;

  const line1 = airKm != null ? `Aéroport à ${formatIntFr(airKm)} km` : '—';
  let line2 = 'Réseau secondaire';
  if (motorway && roadKm != null && roadKm <= 120) {
    line2 = `${motorway.code} à ${formatIntFr(roadKm)} km`;
  }

  return {
    line1,
    line2,
    airportKm: airKm,
    airportName: airport?.name || '',
    motorwayCode: motorway?.code || '',
    motorwayKm: roadKm,
  };
}

export function computeEnvironment({ buildingUsage = '', naf = '', airportKm = null } = {}) {
  const u = String(buildingUsage).toLowerCase();
  const div = nafDivision(naf);

  let zone = 'Zone d\'activité';
  if (/industriel/.test(u) || (div != null && div >= 10 && div <= 35)) {
    zone = 'Zone d\'activité';
  } else if (/agricole/.test(u) || (div != null && div >= 1 && div <= 3)) {
    zone = 'Zone agricole';
  } else if (/commercial/.test(u) || (div != null && (div === 45 || div === 47 || div === 55 || div === 56))) {
    zone = 'Zone commerciale';
  } else if (div != null && (div === 46 || div === 49 || div === 52 || div === 68 || (div >= 41 && div <= 43))) {
    zone = 'Zone d\'activité';
  } else if (/r[ée]sidentiel/.test(u)) {
    zone = 'Zone mixte';
  } else if (div != null && div >= 58) {
    zone = 'Zone tertiaire';
  }

  let peb = 'Hors zone PEB';
  if (Number.isFinite(airportKm)) {
    if (airportKm <= 2) peb = 'PEB fort';
    else if (airportKm <= 9) peb = 'PEB moyen';
    else if (airportKm <= 18) peb = 'PEB faible';
  }

  return { line1: zone, line2: peb };
}

/* ==================================================================== */
/* 3. Note financière (estimée)                                          */
/* ==================================================================== */

export function computeFinancialScore(entreprise = {}, etablissement = {}, currentYear = new Date().getFullYear()) {
  const breakdown = [];
  const isActive = etablissement?.estActif !== false && entreprise?.estActif !== false;

  if (!isActive) {
    return {
      score: 18,
      riskLabel: 'Risque élevé',
      tone: 'danger',
      solvency: 'Cessée',
      trend: 'En baisse',
      trendArrow: '↘',
      trendTone: 'danger',
      lastBalanceYear: entreprise?.finances?.[0]?.year ? String(entreprise.finances[0].year) : 'Clôturé',
      sources: 'INPI / SIRENE',
      finances: entreprise?.finances || [],
      breakdown: [{ label: 'État administratif', impact: 'Établissement ou société fermé(e)' }],
    };
  }

  let score = 56;
  breakdown.push({ label: 'Statut administratif', impact: 'Entreprise active (+56 pts de base)' });

  // Ancienneté
  const createdStr = entreprise?.dateCreation || etablissement?.dateCreation || '';
  const createdYear = /^(\d{4})/.exec(createdStr) ? Number(createdStr.slice(0, 4)) : null;
  const age = createdYear ? Math.max(0, currentYear - createdYear) : null;
  if (age != null) {
    const pts = age >= 12 ? 16 : age >= 6 ? 13 : age >= 3 ? 9 : age >= 1 ? 4 : 0;
    score += pts;
    breakdown.push({ label: 'Ancienneté', impact: `${age} an${age > 1 ? 's' : ''} (+${pts} pts)` });
  }

  // Effectif & implantation
  const eff = String(entreprise?.trancheEffectif || etablissement?.trancheEffectif || '').toUpperCase();
  const staff = EFFECTIF_MIDPOINT[eff] ?? 0;
  if (staff >= 50) { score += 8; breakdown.push({ label: 'Taille', impact: 'PME / ETI structurée (+8 pts)' }); }
  else if (staff >= 6) { score += 5; breakdown.push({ label: 'Taille', impact: 'Équipe établie (+5 pts)' }); }
  else if (eff && eff !== 'NN') { score += 3; breakdown.push({ label: 'Taille', impact: 'Employeur actif (+3 pts)' }); }
  else { score += 2; breakdown.push({ label: 'Structure', impact: 'Structure légère / foncière (+2 pts)' }); }

  if ((entreprise?.nombreEtablissementsOuverts || 0) >= 2) {
    score += 3;
    breakdown.push({ label: 'Implantations', impact: `${entreprise.nombreEtablissementsOuverts} établissements actifs (+3 pts)` });
  }
  if (entreprise?.estRge || entreprise?.estQualiopi) {
    score += 3;
    breakdown.push({ label: 'Certifications', impact: 'Qualification RGE / Qualiopi (+3 pts)' });
  }

  // Bilans publiés (API Recherche d'entreprises / INPI)
  const finances = Array.isArray(entreprise?.finances) ? entreprise.finances : [];
  let trend = 'Stable';
  let trendArrow = '→';
  let trendTone = 'good';

  if (finances.length >= 1) {
    const latest = finances[0];
    if (latest.resultatNet != null) {
      if (latest.resultatNet > 0) {
        const margin = latest.ca && latest.ca > 0 ? latest.resultatNet / latest.ca : 0.05;
        const pts = margin >= 0.08 ? 12 : margin >= 0.03 ? 8 : 5;
        score += pts;
        breakdown.push({ label: `Résultat net ${latest.year}`, impact: `Bénéficiaire : ${formatEuroFr(latest.resultatNet)} (+${pts} pts)` });
      } else if (latest.resultatNet < 0) {
        score -= 10;
        breakdown.push({ label: `Résultat net ${latest.year}`, impact: `Déficitaire : ${formatEuroFr(latest.resultatNet)} (−10 pts)` });
      }
    }
    if (finances.length >= 2) {
      const prev = finances[1];
      if (latest.ca > 0 && prev.ca > 0) {
        const growth = (latest.ca - prev.ca) / prev.ca;
        if (growth > 0.06) {
          score += 4; trend = 'En hausse'; trendArrow = '↗'; trendTone = 'good';
          breakdown.push({ label: 'Évolution CA', impact: `+${Math.round(growth * 100)} % vs ${prev.year} (+4 pts)` });
        } else if (growth < -0.08) {
          score -= 5; trend = 'En baisse'; trendArrow = '↘'; trendTone = 'warn';
          breakdown.push({ label: 'Évolution CA', impact: `${Math.round(growth * 100)} % vs ${prev.year} (−5 pts)` });
        }
      }
    }
  } else {
    breakdown.push({ label: 'Comptes annuels', impact: 'Comptes non publiés ou confidentiels (estimation sur profil légal)' });
  }

  score = Math.round(clamp(score, 22, 94));

  let riskLabel = 'Risque faible';
  let tone = 'good';
  let solvency = 'Bonne';
  if (score >= 82) {
    riskLabel = 'Risque très faible';
    solvency = 'Excellente';
    tone = 'good';
  } else if (score >= 65) {
    riskLabel = 'Risque faible';
    solvency = 'Bonne';
    tone = 'good';
  } else if (score >= 48) {
    riskLabel = 'Risque modéré';
    solvency = 'Moyenne';
    tone = 'warn';
  } else {
    riskLabel = 'Risque élevé';
    solvency = 'Faible';
    tone = 'danger';
  }

  const lastBalanceYear = finances.length
    ? String(finances[0].year)
    : (createdYear && createdYear < currentYear - 1 ? String(currentYear - 2) : 'Non déposé');

  return {
    score,
    riskLabel,
    tone,
    solvency,
    trend,
    trendArrow,
    trendTone,
    lastBalanceYear,
    sources: finances.length ? 'INPI / Banque de France' : 'SIRENE / INPI (estimé)',
    finances,
    breakdown,
  };
}

/* ==================================================================== */
/* 4. Consommation d'électricité (estimée)                               */
/* ==================================================================== */

function sectorIntensity(naf, buildingUsage = '') {
  const div = nafDivision(naf);
  const u = String(buildingUsage).toLowerCase();
  if (div === 10 || div === 11) return { kwhM2: 290, label: 'Industrie agroalimentaire' };
  if (div != null && div >= 12 && div <= 33) return { kwhM2: 225, label: 'Industrie & fabrication' };
  if (div === 35 || div === 36 || div === 38) return { kwhM2: 210, label: 'Énergie & environnement' };
  if (div === 56) return { kwhM2: 310, label: 'Restauration' };
  if (div === 55) return { kwhM2: 215, label: 'Hôtellerie & hébergement' };
  if (div === 47) return { kwhM2: 230, label: 'Commerce de détail' };
  if (div === 45 || div === 46) return { kwhM2: 175, label: 'Commerce de gros & automobile' };
  if (div === 49 || div === 52) return { kwhM2: 160, label: 'Transport & entreposage' };
  if (div === 68) return { kwhM2: 185, label: 'Immobilier d\'activité & locaux' };
  if (div != null && div >= 86 && div <= 88) return { kwhM2: 195, label: 'Santé & médico-social' };
  if (div != null && div >= 41 && div <= 43) return { kwhM2: 145, label: 'Construction & BTP' };
  if (div != null && div >= 1 && div <= 3) return { kwhM2: 120, label: 'Exploitation agricole' };
  if (/industriel/.test(u)) return { kwhM2: 205, label: 'Bâtiment d\'activité' };
  return { kwhM2: 135, label: 'Tertiaire & bureaux' };
}

// Profils saisonniers normalisés (somme = 12)
const PROFILE_SOUTH = [0.86, 0.82, 0.90, 0.93, 1.00, 1.12, 1.24, 1.28, 1.16, 1.02, 0.88, 0.79];
const PROFILE_NORTH = [1.22, 1.16, 1.05, 0.94, 0.86, 0.84, 0.86, 0.82, 0.90, 1.02, 1.14, 1.19];

export function computeElectricityEstimate({ naf = '', surfaceM2 = 1200, trancheEffectif = '', lat = 46.5, buildingUsage = '' } = {}) {
  const area = Math.max(40, Number(surfaceM2) || 400);
  const { kwhM2, label: sectorLabel } = sectorIntensity(naf, buildingUsage);
  const eff = String(trancheEffectif || '').toUpperCase();
  const staff = EFFECTIF_MIDPOINT[eff] ?? 4;
  const staffFactor = staff >= 100 ? 1.22 : staff >= 20 ? 1.1 : 1.0;

  const rawMonthly = (area * kwhM2 * staffFactor) / 12;
  const step = rawMonthly >= 5000 ? 500 : rawMonthly >= 1000 ? 100 : 50;
  const monthlyKwh = Math.max(250, Math.round(rawMonthly / step) * step);
  const annualKwh = monthlyKwh * 12;

  const isWarm = Number.isFinite(Number(lat)) && Number(lat) < 44.8;
  const weights = isWarm ? PROFILE_SOUTH : PROFILE_NORTH;
  const maxW = Math.max(...weights);

  const monthlySeries = MONTH_LETTERS.map((letter, idx) => {
    const kwh = Math.round((monthlyKwh * weights[idx]) / 50) * 50;
    return {
      letter,
      month: MONTH_NAMES_SHORT[idx],
      kwh,
      heightPct: Math.round((weights[idx] / maxW) * 100),
    };
  });

  return {
    monthlyKwh,
    annualKwh,
    intensityKwhM2: kwhM2,
    sectorLabel,
    surfaceUsedM2: Math.round(area),
    sourceLabel: 'Estimation Enedis Open Data 2024',
    monthlySeries,
  };
}
