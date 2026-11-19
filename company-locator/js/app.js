/**
 * app.js — Orchestrateur de la Fiche Entreprise CRM.
 *
 * Charge une entreprise française depuis l'API officielle Recherche d'entreprises,
 * résout ses coordonnées GPS (BAN / Géoplateforme IGN), affiche la carte plan,
 * l'orthophotographie IGN BD ORTHO®, la vue de rue Panoramax/Mapillary, la météo
 * actuelle Open-Meteo, l'altitude, l'emprise bâtie BD TOPO®, la note financière
 * estimée, la consommation d'électricité estimée et les 5 indicateurs de site,
 * tout en persistant localement les saisies CRM par SIRET.
 */

import config from './config.js';
import {
  digitsOnly, isValidCodePostal, isValidSiren, isValidSiret,
  escapeHtml, safeUrl, toUserMessage,
} from './utils.js';
import { loadLabels, nafCompactWithLabel, normalizeEffectifOption } from './labels.js';
import { fetchBySiret } from './entreprise-api.js';
import { runSearch } from './search.js';
import { resolvePosition } from './geocoding.js';
import { createPlanMap, createSatelliteMap, createExpandedMap } from './map.js';
import { fetchStreetPhotos, pickStreetPhotoIndex, streetPhotoView, bearingDeg } from './images.js';
import { fetchSiteSource, fetchAltitude } from './site-data.js';
import {
  fetchWeather, weatherDescription, weatherIconKind, windCardinalFr, formatWeatherTimestamp,
} from './weather-data.js';
import {
  normalizePhoneFr, isMobileFr, formatPhoneFr, formatPhoneDots, phoneHref, isValidEmail, buildContactRecord,
} from './contact.js';
import { crmSheets, defaultQuoteId, userContacts, uiPrefs } from './storage.js';
import { createEmbedBridge } from './embed.js';
import {
  formatCreationMonthFr, formatCoordCardinal, formatLocationLine, formatIntFr, titleCaseFr,
  googleEarthUrl, googleStreetViewUrl, mapDirigeantToBuyer, inferEntityType,
  computeBuildingSurface, computeSolarPotential, computeSeaDistance,
  computeAccessibility, computeEnvironment, computeFinancialScore, computeElectricityEstimate,
} from './enrichment.js';
import {
  weatherSvg, renderElectricityChart, renderCompanyLogo, formatDateTimeCrm,
  renderCommentsBox, renderResultsDropdown, buildFinancialModalHtml, buildElectricityModalHtml,
  openModal, closeModal, toast,
} from './ui.js';

const $ = (id) => document.getElementById(id);

const state = {
  rows: [],
  current: null, // { etablissement, entreprise }
  position: null,
  altitudeM: null,
  buildingGeojson: null,
  building: null,
  solar: null,
  finance: null,
  electricity: null,
  streetPhotos: [],
  streetIndex: 0,
  commentsExpanded: false,
  planMap: null,
  satMap: null,
  activeController: null,
  embed: null,
};

/* ==================================================================== */
/* 1. Analyse intelligente de la barre de recherche                      */
/* ==================================================================== */

function parseSearchInput(rawQuery, rawLocation) {
  const q = String(rawQuery ?? '').trim();
  const loc = String(rawLocation ?? '').trim();
  const qDigits = digitsOnly(q);
  const looksNumericOnly = /^[\d\s.\-]+$/.test(q) && qDigits.length > 0;

  const criteria = { nom: '', codePostal: '', ville: '', adresse: '', identifiant: '' };

  if (looksNumericOnly && (qDigits.length === 9 || qDigits.length === 14)) {
    criteria.identifiant = qDigits;
  } else if (looksNumericOnly && qDigits.length === 5 && isValidCodePostal(q)) {
    criteria.codePostal = q.toUpperCase();
  } else {
    criteria.nom = q;
  }

  if (loc) {
    const locClean = loc.replace(/\s+/g, '').toUpperCase();
    if (isValidCodePostal(locClean)) criteria.codePostal = locClean;
    else criteria.ville = loc;
  }

  return criteria;
}

function setSearchStatus(message, tone = 'info') {
  const el = $('search-status');
  if (el) {
    el.textContent = message || '';
    el.dataset.tone = tone;
  }
  const embedStatus = $('embed-status-text');
  if (embedStatus) embedStatus.textContent = message || '';
}

function setSearchCollapsed(collapsed, { persist = true } = {}) {
  if (state.embed?.active) return;
  const bar = $('search-toolbar');
  const showBtn = $('btn-show-search');
  if (bar) bar.hidden = Boolean(collapsed);
  if (showBtn) showBtn.hidden = !collapsed;
  if (persist) uiPrefs.set({ searchCollapsed: Boolean(collapsed) });
  setTimeout(() => {
    state.planMap?.invalidate();
    state.satMap?.invalidate();
  }, 40);
}

/* ==================================================================== */
/* 2. Recherche & sélection d'un établissement                           */
/* ==================================================================== */

async function executeSearch(criteria, { silent = false } = {}) {
  setSearchStatus('Recherche en cours…');
  const searchBtn = $('btn-search');
  if (searchBtn) searchBtn.disabled = true;

  try {
    const result = await runSearch(criteria, {
      perPage: config.search.perPage,
      etat: 'tous',
      sort: 'pertinence',
      fuzzyFallback: true,
    });

    state.rows = result.rows || [];
    updateResultsUI();
    state.embed?.notifyResults(state.rows);

    if (!state.rows.length) {
      setSearchStatus('Aucun établissement trouvé.', 'error');
      if (!silent) toast('Aucun établissement trouvé pour cette recherche.', 'error');
      return false;
    }

    const count = state.rows.length;
    setSearchStatus(count > 1 ? `${count} établissements trouvés` : '');
    await selectRow(state.rows[0]);
    return true;
  } catch (error) {
    const msg = toUserMessage(error);
    if (!silent) {
      setSearchStatus(msg, 'error');
      state.embed?.notifyError(msg);
    } else {
      setSearchStatus('');
    }
    return false;
  } finally {
    if (searchBtn) searchBtn.disabled = false;
  }
}

async function loadBySiret(siret, { silent = false } = {}) {
  const id = digitsOnly(siret);
  if (!isValidSiret(id)) return false;
  if (!silent) setSearchStatus('Chargement de la fiche…');
  try {
    const { row, entreprise } = await fetchBySiret(id);
    const chosen = row || (entreprise?.etablissements?.[0]
      ? { etablissement: entreprise.etablissements[0], entreprise }
      : null);
    if (!chosen) {
      if (!silent) setSearchStatus('SIRET introuvable.', 'error');
      return false;
    }
    state.rows = entreprise?.etablissements?.length
      ? entreprise.etablissements.map((etab) => ({ etablissement: etab, entreprise }))
      : [chosen];
    updateResultsUI();
    setSearchStatus('');
    await selectRow(chosen);
    return true;
  } catch (error) {
    if (!silent) setSearchStatus(toUserMessage(error), 'error');
    else setSearchStatus('');
    return false;
  }
}

function updateResultsUI() {
  const toggle = $('btn-results-toggle');
  const countLabel = $('results-count-label');
  const dropdown = $('results-dropdown');
  const selectedSiret = state.current?.etablissement?.siret || '';

  if (toggle && countLabel) {
    const show = state.rows.length > 1;
    toggle.hidden = !show;
    countLabel.textContent = `${state.rows.length} résultats`;
    if (!show && dropdown) {
      dropdown.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  }

  renderResultsDropdown(dropdown, state.rows, selectedSiret, (siret) => {
    const found = state.rows.find((r) => r.etablissement.siret === siret);
    if (dropdown) dropdown.hidden = true;
    $('btn-results-toggle')?.setAttribute('aria-expanded', 'false');
    if (found) selectRow(found);
  });

  // Mode intégré (?embed=1)
  if (state.embed?.active) {
    const picker = $('embed-picker');
    const select = $('embed-select-row');
    if (picker && select) {
      picker.hidden = state.rows.length <= 1;
      select.innerHTML = state.rows.map((r) => {
        const e = r.etablissement;
        const label = `${r.entreprise.raisonSociale || e.nomAffiche} — ${e.codePostal || ''} ${e.commune || ''} (${e.siret})`;
        const sel = e.siret === selectedSiret ? ' selected' : '';
        return `<option value="${escapeHtml(e.siret)}"${sel}>${escapeHtml(label)}</option>`;
      }).join('');
    }
  }
}

/* ==================================================================== */
/* 3. Remplissage complet de la fiche CRM                                */
/* ==================================================================== */

function getEffectiveSheet(row) {
  const { etablissement, entreprise } = row;
  const saved = crmSheets.get(etablissement.siret) || {};
  const savedContact = userContacts.get(etablissement.siret) || {};
  const defaultBuyer = mapDirigeantToBuyer(entreprise.dirigeants);

  return {
    logoUrl: saved.logoUrl || '',
    effectif: saved.effectif !== undefined
      ? saved.effectif
      : normalizeEffectifOption(etablissement.trancheEffectif || entreprise.trancheEffectif),
    entityType: saved.entityType || inferEntityType(entreprise),
    website: saved.website || '',
    telStandard: saved.telStandard ?? savedContact.telephone ?? '',
    civilite: saved.civilite || defaultBuyer.civilite || 'Monsieur',
    prenom: saved.prenom !== undefined ? saved.prenom : defaultBuyer.prenom,
    nom: saved.nom !== undefined ? saved.nom : defaultBuyer.nom,
    fonction: saved.fonction !== undefined ? saved.fonction : defaultBuyer.fonction,
    email: saved.email !== undefined ? saved.email : (savedContact.email || ''),
    mobile: saved.mobile !== undefined ? saved.mobile : (savedContact.mobile || ''),
    manualSurfaceM2: saved.manualSurfaceM2 ?? null,
    quote: {
      id: saved.quote?.id || defaultQuoteId(etablissement.siret),
      createdAt: saved.quote?.createdAt || new Date().toISOString(),
      category: saved.quote?.category || 'Solutions photovoltaïques',
      segment: saved.quote?.segment || 'FSI Installateurs',
      origin: saved.quote?.origin || 'Demande Hellodevis',
      advisor: saved.quote?.advisor || 'hellodevis_28',
      criteria: saved.quote?.criteria || 'Installation photovoltaïque sur toiture / ombrière professionnelle — étude d\'autoconsommation.',
      callNote: saved.quote?.callNote || '',
      bimpStatus: saved.quote?.bimpStatus || 'En cours de qualification',
      bimpNote: saved.quote?.bimpNote || '',
    },
    comments: Array.isArray(saved.comments) ? saved.comments : [],
    qualifications: Array.isArray(saved.qualifications) ? saved.qualifications : [],
    quoteHistory: Array.isArray(saved.quoteHistory) ? saved.quoteHistory : [],
    rac: saved.rac || { status: '', date: '', note: '' },
    prelead: saved.prelead || { owner: 'Propriétaire', delay: '3 à 6 mois', budget: '' },
    leadgen: saved.leadgen || { channel: 'Hellodevis Web', max: '4' },
  };
}

/** Synchronise les coordonnées saisies vers `userContacts` (utilisé par ?embed=1). */
function syncContactStore(siret) {
  if (!siret) return;
  const sheet = crmSheets.get(siret) || {};
  const fullName = [sheet.prenom, sheet.nom].filter(Boolean).join(' ').trim();
  const std = normalizePhoneFr(sheet.telStandard || '');
  const dir = normalizePhoneFr(sheet.mobile || '');
  let telephone = '';
  let mobile = '';
  if (std) {
    if (isMobileFr(std)) mobile = std;
    else telephone = std;
  }
  if (dir) {
    if (isMobileFr(dir)) mobile = dir;
    else if (!telephone) telephone = dir;
  }
  const email = isValidEmail(sheet.email || '') ? sheet.email : '';
  const record = buildContactRecord({ telephone, mobile, email, contact: fullName });
  if (record) userContacts.save(siret, record);
  else userContacts.remove(siret);
}

async function selectRow(row) {
  if (!row?.etablissement) return;

  state.activeController?.abort();
  const controller = new AbortController();
  state.activeController = controller;
  const { signal } = controller;

  state.current = row;
  state.position = null;
  state.altitudeM = null;
  state.buildingGeojson = null;
  state.streetPhotos = [];
  state.streetIndex = 0;
  state.commentsExpanded = false;

  const { etablissement, entreprise } = row;
  if (!state.embed?.active) {
    uiPrefs.set({ lastSiret: etablissement.siret });
    try { window.history.replaceState(null, '', `#siret=${etablissement.siret}`); } catch { /* ignore */ }
  }

  updateResultsUI();
  renderCompanyAndBuyer(row);
  renderFinanceCard(row);
  updateEmbedBar();

  // Réinitialise les zones dépendantes du GPS pendant le chargement
  const cityTitle = titleCaseFr(etablissement.commune || '');
  $('weather-title').textContent = cityTitle
    ? `Météo actuelle à ${cityTitle}${etablissement.codePostal ? ` (${etablissement.codePostal})` : ''}`
    : 'Météo actuelle';
  $('weather-icon').innerHTML = weatherSvg('partly-cloudy');
  $('weather-temp').textContent = '…';
  $('weather-desc').textContent = 'Chargement…';
  $('weather-wind').textContent = '—';
  $('weather-humidity').textContent = '—';
  $('weather-precip').textContent = '—';
  $('weather-updated').textContent = '—';
  $('loc-address').textContent = formatLocationLine(etablissement);
  $('loc-coords').textContent = 'Localisation…';
  $('loc-altitude').textContent = 'Altitude : …';
  resetStreetCard('Recherche d\'une vue de rue…');

  // Calcul initial immédiat de la surface et de l'électricité avant retour BD TOPO
  recomputeSiteAndEnergy({ lat: etablissement.latitude, lon: etablissement.longitude });

  // 1. Géocodage précis (BAN + SIRENE)
  let position = null;
  try {
    position = await resolvePosition(etablissement, { signal });
  } catch {
    if (signal.aborted) return;
    if (Number.isFinite(etablissement.latitude) && Number.isFinite(etablissement.longitude)) {
      position = { lat: etablissement.latitude, lon: etablissement.longitude, precision: 'sirene', source: 'SIRENE' };
    }
  }
  if (signal.aborted) return;

  state.position = position;
  updateEmbedBar();

  if (!position) {
    $('loc-coords').textContent = 'Coordonnées indisponibles';
    $('loc-altitude').textContent = 'Altitude : —';
    $('weather-temp').textContent = '—';
    $('weather-desc').textContent = 'Indisponible';
    resetStreetCard('Coordonnées GPS indisponibles');
    setExternalLink($('btn-google-earth'), '');
    setExternalLink($('btn-street-view'), '');
    state.planMap?.clear();
    state.satMap?.clear();
    return;
  }

  const { lat, lon } = position;
  $('loc-coords').textContent = formatCoordCardinal(lat, lon, 4);
  setExternalLink($('btn-google-earth'), googleEarthUrl(lat, lon, 50));
  setExternalLink($('btn-street-view'), googleStreetViewUrl(lat, lon));

  const displayName = entreprise.raisonSociale || etablissement.nomAffiche;
  state.planMap?.setPoint(lat, lon, { zoom: config.map.planZoom, label: displayName });
  $('sat-empty').hidden = true;
  state.satMap?.setPoint(lat, lon, { zoom: config.map.aerialZoom });

  // Mise à jour immédiate des KPI géographiques (mer, accessibilité, solaire, environnement)
  recomputeSiteAndEnergy({ lat, lon });

  // 2. Enrichissements parallèles : Météo + Altitude + Emprise BD TOPO + Vue de la rue
  loadWeatherAndAltitude(lat, lon, signal);
  loadBuildingFootprint(lat, lon, signal);
  loadStreetView(lat, lon, signal);
}

function setExternalLink(anchor, url) {
  if (!anchor) return;
  const clean = safeUrl(url);
  if (clean) {
    anchor.href = clean;
    anchor.classList.remove('is-disabled');
    anchor.removeAttribute('aria-disabled');
  } else {
    anchor.href = '#';
    anchor.classList.add('is-disabled');
    anchor.setAttribute('aria-disabled', 'true');
  }
}

function renderCompanyAndBuyer(row) {
  const { etablissement, entreprise } = row;
  const sheet = getEffectiveSheet(row);

  const mainName = (entreprise.raisonSociale || entreprise.nomComplet || etablissement.nomAffiche || 'ENTREPRISE').toUpperCase();
  const subName = (etablissement.enseignes?.[0] || etablissement.nomCommercial || entreprise.sigle || '').toUpperCase();

  $('co-name').textContent = mainName;
  const ensEl = $('co-enseigne');
  if (subName && subName !== mainName) {
    ensEl.textContent = subName;
    ensEl.hidden = false;
  } else {
    ensEl.textContent = '';
    ensEl.hidden = true;
  }

  $('co-street').textContent = (etablissement.voie || etablissement.adresse || '—').toUpperCase();
  $('co-city').textContent = [etablissement.codePostal, etablissement.commune].filter(Boolean).join(' ').toUpperCase() || '—';
  $('co-country').textContent = (etablissement.pays || 'FRANCE').toUpperCase();

  const statusEl = $('co-status');
  if (etablissement.etatAdministratif === 'A') {
    statusEl.textContent = 'Entreprise active';
    statusEl.dataset.state = 'active';
  } else if (etablissement.etatAdministratif === 'C') {
    statusEl.textContent = 'Entreprise fermée';
    statusEl.dataset.state = 'closed';
  } else {
    statusEl.textContent = 'État inconnu';
    statusEl.dataset.state = 'neutral';
  }

  renderCompanyLogo({
    imgEl: $('co-logo-img'),
    fallbackEl: $('co-logo-fallback'),
    name: mainName,
    logoUrl: sheet.logoUrl,
  });

  $('co-siret').textContent = etablissement.siret || '—';
  $('btn-copy-siret').disabled = !etablissement.siret;

  renderTelStandard(sheet.telStandard);
  $('tel-standard-editor').hidden = true;

  $('co-naf').textContent = `NAF  ${nafCompactWithLabel(etablissement.naf || entreprise.naf)}`;
  $('co-created').textContent = formatCreationMonthFr(entreprise.dateCreation || etablissement.dateCreation);

  $('co-effectif').value = sheet.effectif;
  $('co-type').value = sheet.entityType;
  $('co-website').value = sheet.website;

  // Acheteur
  $('buyer-civilite').value = sheet.civilite;
  $('buyer-prenom').value = sheet.prenom;
  $('buyer-nom').value = sheet.nom;
  $('buyer-fonction').value = sheet.fonction;
  $('buyer-email').value = sheet.email;
  renderBuyerMobile(sheet.mobile);
  $('mobile-editor').hidden = true;

  // Commentaires
  renderCommentsSection(sheet.comments);

  // Demande de devis
  renderQuoteSection(sheet.quote);

  // Accordéons RAC / Prelead / Génération de lead
  $('rac-status').value = sheet.rac.status || '';
  $('rac-date').value = sheet.rac.date || '';
  $('rac-note').value = sheet.rac.note || '';
  $('prelead-owner').value = sheet.prelead.owner || 'Propriétaire';
  $('prelead-delay').value = sheet.prelead.delay || '3 à 6 mois';
  $('prelead-budget').value = sheet.prelead.budget || '';
  $('leadgen-channel').value = sheet.leadgen.channel || 'Hellodevis Web';
  $('leadgen-max').value = sheet.leadgen.max || '4';

  document.title = `${mainName} — Fiche Entreprise`;
}

function renderTelStandard(phone) {
  const link = $('co-tel-link');
  const href = phoneHref(phone);
  if (phone && href) {
    link.textContent = formatPhoneDots(phone);
    link.href = href;
    link.hidden = false;
  } else {
    link.textContent = '';
    link.hidden = true;
  }
}

function renderBuyerMobile(mobile) {
  const link = $('buyer-mobile-link');
  const hint = $('btn-add-mobile-hint');
  const href = phoneHref(mobile);
  if (mobile && href) {
    link.textContent = formatPhoneDots(mobile);
    link.href = href;
    link.hidden = false;
    hint.hidden = true;
  } else {
    link.textContent = '';
    link.hidden = true;
    hint.hidden = false;
  }
}

function renderCommentsSection(comments) {
  renderCommentsBox($('comments-box'), comments, { expanded: state.commentsExpanded });
  const moreLabel = $('comments-more-label');
  if (moreLabel) {
    moreLabel.textContent = state.commentsExpanded && comments.length > 1 ? 'Voir moins' : 'Voir plus';
  }
}

function renderQuoteSection(quote) {
  $('quote-id').textContent = quote.id;
  $('quote-date').textContent = formatDateTimeCrm(quote.createdAt, { withA: true });
  $('quote-category').textContent = quote.category;
  $('quote-segment').textContent = quote.segment;
  $('quote-origin').textContent = quote.origin;
  $('quote-advisor').textContent = quote.advisor;
}

function renderFinanceCard(row) {
  const fin = computeFinancialScore(row.entreprise, row.etablissement);
  state.finance = fin;

  $('fin-score').textContent = String(fin.score);
  const riskEl = $('fin-risk');
  riskEl.textContent = fin.riskLabel;
  riskEl.dataset.tone = fin.tone;

  const solvEl = $('fin-solvency');
  solvEl.textContent = fin.solvency;
  solvEl.dataset.tone = fin.tone;

  const trendEl = $('fin-trend');
  trendEl.textContent = fin.trend;
  trendEl.dataset.tone = fin.trendTone;
  $('fin-arrow').textContent = fin.trendArrow;

  $('fin-year').textContent = fin.lastBalanceYear;
  $('fin-sources').textContent = fin.sources;
}

function recomputeSiteAndEnergy({ lat, lon } = {}) {
  if (!state.current) return;
  const { etablissement, entreprise } = state.current;
  const sheet = getEffectiveSheet(state.current);
  const naf = etablissement.naf || entreprise.naf;
  const eff = sheet.effectif || etablissement.trancheEffectif || entreprise.trancheEffectif;

  const building = computeBuildingSurface(
    state.buildingGeojson,
    lat,
    lon,
    typeof window !== 'undefined' ? window.turf : null,
    { naf, trancheEffectif: eff, manualM2: sheet.manualSurfaceM2 },
  );
  state.building = building;
  $('kpi-surface-val').textContent = building.display;
  $('kpi-surface-sub').textContent = building.subtitle;

  const solar = computeSolarPotential(lat, lon, building.surfaceM2);
  state.solar = solar;
  $('kpi-solar-val').textContent = solar.rating;
  $('kpi-solar-sub').textContent = solar.subtitle;

  const sea = computeSeaDistance(lat, lon);
  $('kpi-sea-val').textContent = sea.display;
  $('kpi-sea-sub').textContent = sea.subtitle;

  const access = computeAccessibility(lat, lon);
  $('kpi-access-1').textContent = access.line1;
  $('kpi-access-2').textContent = access.line2;

  const env = computeEnvironment({ buildingUsage: building.usage, naf, airportKm: access.airportKm });
  $('kpi-env-1').textContent = env.line1;
  $('kpi-env-2').textContent = env.line2;

  const elec = computeElectricityEstimate({
    naf,
    surfaceM2: building.surfaceM2,
    trancheEffectif: eff,
    lat,
    buildingUsage: building.usage,
  });
  state.electricity = elec;
  $('elec-month').textContent = formatIntFr(elec.monthlyKwh);
  $('elec-year').textContent = formatIntFr(elec.annualKwh);
  $('elec-source').textContent = elec.sourceLabel;
  renderElectricityChart($('elec-chart'), elec.monthlySeries);
}

/* ==================================================================== */
/* 4. Chargements asynchrones : Météo, Altitude, BD TOPO, Vue de rue     */
/* ==================================================================== */

async function loadWeatherAndAltitude(lat, lon, signal) {
  let altitudeSet = false;
  try {
    const data = await fetchWeather(lat, lon, { signal });
    if (signal.aborted) return;
    const c = data.current;
    $('weather-icon').innerHTML = weatherSvg(weatherIconKind(c.weather_code, c.is_day));
    $('weather-temp').textContent = Number.isFinite(Number(c.temperature_2m))
      ? `${Math.round(Number(c.temperature_2m))}°C`
      : '—';
    $('weather-desc').textContent = weatherDescription(c.weather_code);

    const wind = Number.isFinite(Number(c.wind_speed_10m)) ? `${Math.round(Number(c.wind_speed_10m))} km/h` : '—';
    const dir = windCardinalFr(c.wind_direction_10m);
    $('weather-wind').textContent = dir && wind !== '—' ? `${wind} (${dir})` : wind;

    $('weather-humidity').textContent = Number.isFinite(Number(c.relative_humidity_2m))
      ? `${Math.round(Number(c.relative_humidity_2m))}%`
      : '—';
    $('weather-precip').textContent = Number.isFinite(Number(c.precipitation))
      ? `${Number(c.precipitation)} mm`
      : '—';
    $('weather-updated').textContent = formatWeatherTimestamp(c.time);

    if (Number.isFinite(Number(data.elevation))) {
      state.altitudeM = Math.round(Number(data.elevation));
      $('loc-altitude').textContent = `Altitude : ${state.altitudeM} m`;
      setExternalLink($('btn-google-earth'), googleEarthUrl(lat, lon, state.altitudeM));
      altitudeSet = true;
    }
  } catch {
    if (signal.aborted) return;
    $('weather-temp').textContent = '—';
    $('weather-desc').textContent = 'Météo indisponible';
  }

  if (!altitudeSet && !signal.aborted) {
    const alt = await fetchAltitude(lat, lon, { signal });
    if (signal.aborted) return;
    if (alt != null) {
      state.altitudeM = alt;
      $('loc-altitude').textContent = `Altitude : ${alt} m`;
      setExternalLink($('btn-google-earth'), googleEarthUrl(lat, lon, alt));
    } else {
      $('loc-altitude').textContent = 'Altitude : —';
    }
  }
}

async function loadBuildingFootprint(lat, lon, signal) {
  try {
    const geojson = await fetchSiteSource('batiments', lat, lon, { signal });
    if (signal.aborted) return;
    state.buildingGeojson = geojson;
    recomputeSiteAndEnergy({ lat, lon });
  } catch {
    // Le repli sectoriel estimé est déjà affiché.
  }
}

function resetStreetCard(message) {
  const img = $('street-img');
  const empty = $('street-empty');
  const emptyText = $('street-empty-text');
  const credit = $('street-credit');
  if (img) {
    img.hidden = true;
    img.classList.remove('is-pano');
    img.style.width = '';
    img.style.left = '';
    img.removeAttribute('src');
  }
  if (empty) empty.hidden = false;
  if (emptyText) emptyText.textContent = message;
  if (credit) credit.hidden = true;
  $('street-prev').hidden = true;
  $('street-next').hidden = true;
}

function showStreetPhoto(index) {
  const photos = state.streetPhotos;
  if (!photos.length || !state.position) {
    resetStreetCard('Aperçu direct non couvert — ouvrir dans Google Street View');
    return;
  }
  const safeIdx = ((index % photos.length) + photos.length) % photos.length;
  state.streetIndex = safeIdx;
  const photo = photos[safeIdx];
  const view = streetPhotoView(photo, { index: safeIdx, total: photos.length, target: state.position });
  if (!view) {
    resetStreetCard('Aperçu direct non couvert');
    return;
  }

  const img = $('street-img');
  const empty = $('street-empty');
  const credit = $('street-credit');

  img.classList.toggle('is-pano', Boolean(view.pano));
  if (view.pano) {
    img.style.width = `${view.pano.widthPct.toFixed(1)}%`;
    img.style.left = `${view.pano.leftPct.toFixed(1)}%`;
  } else {
    img.style.width = '';
    img.style.left = '';
  }

  img.onload = () => {
    empty.hidden = true;
    img.hidden = false;
  };
  img.onerror = () => {
    if (img.src !== view.thumbUrl && view.thumbUrl) {
      img.src = view.thumbUrl;
    } else {
      resetStreetCard('Photographie indisponible — ouvrir dans Google Street View');
    }
  };
  img.alt = view.alt;
  img.src = view.url;

  if (credit) {
    credit.textContent = view.credit;
    credit.hidden = false;
  }

  const multiple = photos.length > 1;
  $('street-prev').hidden = !multiple;
  $('street-next').hidden = !multiple;

  // Oriente aussi le lien Google Street View vers la façade
  if (Number.isFinite(photo.lat) && Number.isFinite(photo.lon)) {
    const heading = bearingDeg(photo.lat, photo.lon, state.position.lat, state.position.lon);
    setExternalLink($('btn-street-view'), googleStreetViewUrl(state.position.lat, state.position.lon, heading));
  }
}

async function loadStreetView(lat, lon, signal) {
  try {
    const { photos } = await fetchStreetPhotos({ lat, lon, signal, expandIfEmpty: true });
    if (signal.aborted) return;
    state.streetPhotos = photos;
    if (!photos.length) {
      resetStreetCard('Accès direct via Google Street View');
      return;
    }
    const bestIdx = pickStreetPhotoIndex(photos, { lat, lon });
    showStreetPhoto(bestIdx);
  } catch {
    if (signal.aborted) return;
    resetStreetCard('Accès direct via Google Street View');
  }
}

/* ==================================================================== */
/* 5. Mode intégré (?embed=1 pour assurance-tns-pro-v2-adw)              */
/* ==================================================================== */

function updateEmbedBar() {
  if (!state.embed?.active) return;
  const bar = $('embed-bar');
  const title = $('embed-bar-title');
  const sub = $('embed-bar-sub');
  const btn = $('btn-embed-select');
  if (!bar) return;
  bar.hidden = false;

  if (!state.current) {
    title.textContent = 'Aucune entreprise sélectionnée';
    sub.textContent = 'Choisissez votre établissement dans la liste.';
    btn.disabled = true;
    return;
  }

  const { etablissement, entreprise } = state.current;
  title.textContent = entreprise.raisonSociale || etablissement.nomAffiche;
  sub.textContent = `SIRET ${etablissement.siret} · ${formatLocationLine(etablissement)}`;
  btn.disabled = false;
}

function sendEmbedSelection() {
  if (!state.embed?.active || !state.current) return false;
  const siret = state.current.etablissement.siret;
  syncContactStore(siret);
  const contacts = userContacts.get(siret);
  const ok = state.embed.notifySelection({
    row: state.current,
    position: state.position,
    contacts,
  });
  if (ok) toast('Entreprise transmise au formulaire.', 'success');
  return ok;
}

/* ==================================================================== */
/* 6. Actions & modales CRM interactives                                 */
/* ==================================================================== */

function currentSiret() {
  return state.current?.etablissement?.siret || '';
}

function patchCurrentSheet(partial) {
  const siret = currentSiret();
  if (!siret) return null;
  const next = crmSheets.patch(siret, partial);
  syncContactStore(siret);
  return next;
}

function copyText(text, label) {
  if (!text || text === '—') return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast(`${label} copié : ${text}`, 'success'),
      () => toast(text),
    );
  } else {
    toast(text);
  }
}

function openCommentsModal() {
  const siret = currentSiret();
  if (!siret) { toast('Recherchez d\'abord une entreprise.'); return; }
  const sheet = getEffectiveSheet(state.current);

  const listHtml = sheet.comments.length
    ? sheet.comments.map((c) => `
      <div class="comment-item">
        <p class="comment-head"><span class="comment-chevron">›</span>${escapeHtml(formatDateTimeCrm(c.at))} - ${escapeHtml(c.author)}</p>
        <p class="comment-text">${escapeHtml(c.text)}</p>
      </div>`).join('')
    : '<p class="comment-empty">Aucun commentaire pour cette fiche.</p>';

  openModal({
    title: 'Historique commentaires',
    html: `
      <form id="form-add-comment" class="modal-form">
        <label class="acc-field">
          <span>Conseiller</span>
          <input type="text" name="author" class="crm-input" value="${escapeHtml(sheet.quote.advisor || 'hellodevis_28')}" maxlength="40">
        </label>
        <label class="acc-field">
          <span>Nouveau commentaire</span>
          <textarea name="text" class="modal-textarea" placeholder="Ex. changement d'adresse en cours, précision toiture…" required></textarea>
        </label>
        <div class="modal-actions">
          <button type="submit" class="btn-search">Ajouter le commentaire</button>
        </div>
      </form>
      <div class="comments-box">${listHtml}</div>
    `,
    onMount(body) {
      body.querySelector('#form-add-comment')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const text = String(fd.get('text') || '').trim();
        const author = String(fd.get('author') || 'hellodevis_28').trim();
        if (!text) return;
        const updated = crmSheets.addComment(siret, { text, author });
        renderCommentsSection(updated?.comments || []);
        closeModal();
        toast('Commentaire ajouté.', 'success');
      });
    },
  });
}

function openQualificationsModal() {
  const siret = currentSiret();
  if (!siret) { toast('Recherchez d\'abord une entreprise.'); return; }
  const sheet = getEffectiveSheet(state.current);

  const rows = sheet.qualifications.length
    ? `<table class="modal-table">
        <thead><tr><th>Date</th><th>Qualification</th><th>Détail</th></tr></thead>
        <tbody>${sheet.qualifications.map((q) => `
          <tr>
            <td>${escapeHtml(formatDateTimeCrm(q.at))}</td>
            <td><strong>${escapeHtml(q.label)}</strong></td>
            <td>${escapeHtml(q.detail || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p class="modal-note">Aucune qualification enregistrée sur cette société.</p>';

  openModal({
    title: 'Historique qualifications',
    html: `
      <form id="form-add-qualif" class="modal-form">
        <div class="modal-form-row">
          <label class="acc-field">
            <span>Statut de qualification</span>
            <select name="label" class="crm-input crm-select">
              <option value="Qualifié — Projet confirmé">Qualifié — Projet confirmé</option>
              <option value="En cours — Rappel prévu">En cours — Rappel prévu</option>
              <option value="Devis transmis">Devis transmis</option>
              <option value="Injoignable">Injoignable</option>
              <option value="Sans suite / Hors cible">Sans suite / Hors cible</option>
            </select>
          </label>
          <label class="acc-field">
            <span>Précision</span>
            <input type="text" name="detail" class="crm-input" placeholder="Commentaire court…" maxlength="160">
          </label>
        </div>
        <div class="modal-actions">
          <button type="submit" class="btn-search">Enregistrer</button>
        </div>
      </form>
      ${rows}
    `,
    onMount(body) {
      body.querySelector('#form-add-qualif')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        crmSheets.addEvent(siret, 'qualifications', {
          label: String(fd.get('label') || ''),
          detail: String(fd.get('detail') || ''),
          author: sheet.quote.advisor,
        });
        closeModal();
        toast('Qualification enregistrée.', 'success');
      });
    },
  });
}

function openQuoteCriteriaModal() {
  const siret = currentSiret();
  if (!siret) { toast('Recherchez d\'abord une entreprise.'); return; }
  const { quote } = getEffectiveSheet(state.current);

  openModal({
    title: `Critères de la demande #${quote.id}`,
    html: `
      <form id="form-quote-criteria" class="modal-form">
        <div class="modal-form-row">
          <label class="acc-field">
            <span>ID Demande</span>
            <input type="text" name="id" class="crm-input" value="${escapeHtml(quote.id)}" maxlength="20" required>
          </label>
          <label class="acc-field">
            <span>Catégorie</span>
            <input type="text" name="category" class="crm-input" value="${escapeHtml(quote.category)}" maxlength="80" required>
          </label>
        </div>
        <div class="modal-form-row">
          <label class="acc-field">
            <span>Segment fournisseur</span>
            <input type="text" name="segment" class="crm-input" value="${escapeHtml(quote.segment)}" maxlength="60">
          </label>
          <label class="acc-field">
            <span>Login Conseiller acheteur</span>
            <input type="text" name="advisor" class="crm-input" value="${escapeHtml(quote.advisor)}" maxlength="40">
          </label>
        </div>
        <label class="acc-field">
          <span>Critères techniques du projet</span>
          <textarea name="criteria" class="modal-textarea">${escapeHtml(quote.criteria)}</textarea>
        </label>
        <div class="modal-actions">
          <button type="submit" class="btn-search">Enregistrer</button>
        </div>
      </form>
    `,
    onMount(body) {
      body.querySelector('#form-quote-criteria')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const nextQuote = {
          ...quote,
          id: String(fd.get('id') || quote.id).trim(),
          category: String(fd.get('category') || quote.category).trim(),
          segment: String(fd.get('segment') || '').trim(),
          advisor: String(fd.get('advisor') || '').trim(),
          criteria: String(fd.get('criteria') || '').trim(),
        };
        patchCurrentSheet({ quote: nextQuote });
        crmSheets.addEvent(siret, 'quoteHistory', { label: 'Critères mis à jour', detail: nextQuote.category, author: nextQuote.advisor });
        renderQuoteSection(nextQuote);
        closeModal();
        toast('Demande de devis mise à jour.', 'success');
      });
    },
  });
}

function openQuoteHistoryModal() {
  const siret = currentSiret();
  if (!siret) { toast('Recherchez d\'abord une entreprise.'); return; }
  const sheet = getEffectiveSheet(state.current);
  const events = [
    ...sheet.quoteHistory,
    { at: sheet.quote.createdAt, label: 'Création de la demande', detail: `${sheet.quote.origin} — ${sheet.quote.category}`, author: sheet.quote.advisor },
  ];
  openModal({
    title: `Historique de la demande #${sheet.quote.id}`,
    html: `
      <table class="modal-table">
        <thead><tr><th>Date</th><th>Événement</th><th>Détail</th></tr></thead>
        <tbody>${events.map((e) => `
          <tr>
            <td>${escapeHtml(formatDateTimeCrm(e.at))}</td>
            <td><strong>${escapeHtml(e.label)}</strong></td>
            <td>${escapeHtml(e.detail || '—')}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `,
  });
}

function openCallNoteModal() {
  const siret = currentSiret();
  if (!siret) { toast('Recherchez d\'abord une entreprise.'); return; }
  const { quote } = getEffectiveSheet(state.current);
  openModal({
    title: `Suivi d'appel — Conseiller ${quote.advisor}`,
    html: `
      <form id="form-call-note" class="modal-form">
        <p class="modal-note">Aucun enregistrement audio n'est rattaché en local. Vous pouvez consigner ci-dessous le compte rendu d'appel de qualification.</p>
        <label class="acc-field">
          <span>Compte rendu d'entretien</span>
          <textarea name="callNote" class="modal-textarea" placeholder="Résumé de l'échange avec l'acheteur…">${escapeHtml(quote.callNote || '')}</textarea>
        </label>
        <div class="modal-actions">
          <button type="submit" class="btn-search">Enregistrer</button>
        </div>
      </form>
    `,
    onMount(body) {
      body.querySelector('#form-call-note')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const note = String(new FormData(event.currentTarget).get('callNote') || '').trim();
        patchCurrentSheet({ quote: { ...quote, callNote: note } });
        closeModal();
        toast('Compte rendu d\'appel enregistré.', 'success');
      });
    },
  });
}

function openBimpModal() {
  const siret = currentSiret();
  if (!siret) { toast('Recherchez d\'abord une entreprise.'); return; }
  const { quote } = getEffectiveSheet(state.current);
  const statuses = ['En cours de qualification', 'Lead validé — transmis', 'RDV fournisseur planifié', 'Devis signé', 'Lead contesté / SAV'];
  openModal({
    title: 'Suivi Lead indicateur BIMP',
    html: `
      <form id="form-bimp" class="modal-form">
        <label class="acc-field">
          <span>État BIMP</span>
          <select name="bimpStatus" class="crm-input crm-select">
            ${statuses.map((s) => `<option value="${escapeHtml(s)}"${s === quote.bimpStatus ? ' selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
        </label>
        <label class="acc-field">
          <span>Observation indicateur BIMP</span>
          <textarea name="bimpNote" class="modal-textarea" placeholder="Retour fournisseur, avancement du dossier…">${escapeHtml(quote.bimpNote || '')}</textarea>
        </label>
        <div class="modal-actions">
          <button type="submit" class="btn-search">Mettre à jour</button>
        </div>
      </form>
    `,
    onMount(body) {
      body.querySelector('#form-bimp')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const fd = new FormData(event.currentTarget);
        const bimpStatus = String(fd.get('bimpStatus') || '');
        const bimpNote = String(fd.get('bimpNote') || '').trim();
        patchCurrentSheet({ quote: { ...quote, bimpStatus, bimpNote } });
        crmSheets.addEvent(siret, 'quoteHistory', { label: 'Suivi BIMP', detail: bimpStatus, author: quote.advisor });
        closeModal();
        toast(`Indicateur BIMP : ${bimpStatus}`, 'success');
      });
    },
  });
}

function openSurfaceModal() {
  const siret = currentSiret();
  if (!siret || !state.building) return;
  const sheet = getEffectiveSheet(state.current);
  const b = state.building;
  const sourceText = b.source === 'bdtopo'
    ? 'Calculée à partir de l\'emprise vectorielle IGN BD TOPO® au point GPS.'
    : b.source === 'manual'
      ? 'Valeur saisie manuellement pour cette fiche.'
      : 'Estimée d\'après l\'activité (code NAF) et la tranche d\'effectif.';

  openModal({
    title: 'Surface bâtiment',
    html: `
      <p>Surface retenue : <strong>${escapeHtml(b.display)}</strong>${b.heightM ? ` · Hauteur BD TOPO : ${b.heightM} m` : ''}</p>
      <p class="modal-note">${escapeHtml(sourceText)}</p>
      <form id="form-surface" class="modal-form">
        <label class="acc-field">
          <span>Corriger la surface au sol (m²) — laisser vide pour le calcul automatique</span>
          <input type="number" name="m2" class="crm-input" min="20" max="500000" step="10"
                 value="${sheet.manualSurfaceM2 ? escapeHtml(String(sheet.manualSurfaceM2)) : ''}"
                 placeholder="${escapeHtml(String(b.surfaceM2))}">
        </label>
        <div class="modal-actions">
          <button type="submit" class="btn-search">Appliquer</button>
        </div>
      </form>
    `,
    onMount(body) {
      body.querySelector('#form-surface')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const raw = String(new FormData(event.currentTarget).get('m2') || '').trim();
        const num = raw ? Number(raw) : null;
        patchCurrentSheet({ manualSurfaceM2: num && Number.isFinite(num) && num >= 20 ? Math.round(num) : null });
        recomputeSiteAndEnergy(state.position || {});
        closeModal();
        toast('Surface et estimations énergétiques recalculées.', 'success');
      });
    },
  });
}

function openLogoModal() {
  const siret = currentSiret();
  if (!siret) return;
  const sheet = getEffectiveSheet(state.current);
  openModal({
    title: 'Logo de l\'entreprise',
    html: `
      <form id="form-logo" class="modal-form">
        <label class="acc-field">
          <span>URL du logo (https://…) — laisser vide pour l'affichage automatique</span>
          <input type="url" name="logoUrl" class="crm-input" value="${escapeHtml(sheet.logoUrl)}"
                 placeholder="https://exemple.fr/logo.png">
        </label>
        <div class="modal-actions">
          <button type="submit" class="btn-search">Enregistrer</button>
        </div>
      </form>
    `,
    onMount(body) {
      body.querySelector('#form-logo')?.addEventListener('submit', (event) => {
        event.preventDefault();
        const raw = String(new FormData(event.currentTarget).get('logoUrl') || '').trim();
        const clean = raw ? safeUrl(raw) : '';
        patchCurrentSheet({ logoUrl: clean });
        renderCompanyLogo({
          imgEl: $('co-logo-img'),
          fallbackEl: $('co-logo-fallback'),
          name: $('co-name').textContent,
          logoUrl: clean,
        });
        closeModal();
        toast('Logo mis à jour.', 'success');
      });
    },
  });
}

function openExpandedMapModal() {
  let controller = null;
  const pos = state.position;
  const label = state.current
    ? `${state.current.entreprise.raisonSociale || state.current.etablissement.nomAffiche} — ${formatLocationLine(state.current.etablissement)}`
    : '';

  openModal({
    title: label ? `Localisation — ${label}` : 'Carte de localisation',
    wide: true,
    html: `
      <div class="modal-map-toolbar">
        <button type="button" class="modal-layer-btn is-active" data-layer="ign">Plan IGN</button>
        <button type="button" class="modal-layer-btn" data-layer="plan">OpenStreetMap</button>
        <button type="button" class="modal-layer-btn" data-layer="satellite">Vue satellite</button>
      </div>
      <div id="modal-map-canvas" class="modal-map-box"></div>
    `,
    onMount(body) {
      const box = body.querySelector('#modal-map-canvas');
      createExpandedMap(box, {
        lat: pos?.lat,
        lon: pos?.lon,
        label,
        initialLayer: 'ign',
      }).then((ctrl) => {
        controller = ctrl;
        setTimeout(() => ctrl.invalidate(), 50);
      }).catch(() => {});

      body.querySelectorAll('[data-layer]').forEach((btn) => {
        btn.addEventListener('click', () => {
          body.querySelectorAll('[data-layer]').forEach((b) => b.classList.toggle('is-active', b === btn));
          controller?.setLayer(btn.dataset.layer);
        });
      });
    },
    onClose() {
      controller?.destroy();
      controller = null;
    },
  });
}

function openMiseEnRelationModal() {
  if (!state.current) { toast('Recherchez d\'abord une entreprise.'); return; }
  if (state.embed?.active) { sendEmbedSelection(); return; }

  const { etablissement, entreprise } = state.current;
  const sheet = getEffectiveSheet(state.current);
  const companyName = entreprise.raisonSociale || etablissement.nomAffiche;
  const buyerLine = [sheet.civilite, sheet.prenom, sheet.nom].filter(Boolean).join(' ').trim();
  const summaryLines = [
    `Société : ${companyName} (SIRET ${etablissement.siret})`,
    `Adresse : ${formatLocationLine(etablissement)}`,
    state.position ? `GPS : ${formatCoordCardinal(state.position.lat, state.position.lon)}` : '',
    `Acheteur : ${buyerLine}${sheet.fonction ? ` — ${sheet.fonction}` : ''}`,
    sheet.mobile ? `Ligne directe : ${formatPhoneDots(sheet.mobile)}` : '',
    sheet.email ? `E-mail : ${sheet.email}` : '',
    `Demande #${sheet.quote.id} : ${sheet.quote.category} (${sheet.quote.segment})`,
    state.building ? `Surface bâtiment : ${state.building.display} · Potentiel solaire : ${state.solar?.rating || '—'}` : '',
    state.electricity ? `Consommation estimée : ${formatIntFr(state.electricity.monthlyKwh)} kWh/mois (${formatIntFr(state.electricity.annualKwh)} kWh/an)` : '',
    `Fournisseurs max. : ${sheet.leadgen.max}`,
  ].filter(Boolean).join('\n');

  openModal({
    title: `Mise en relation — ${companyName}`,
    html: `
      <p>Vérifiez le récapitulatif de la fiche avant validation de la mise en relation :</p>
      <pre class="comments-box" style="white-space:pre-wrap;font-family:inherit;font-size:11.5px">${escapeHtml(summaryLines)}</pre>
      <div class="modal-actions">
        <button type="button" id="btn-mer-copy" class="btn-crm-outline">Copier la fiche</button>
        <button type="button" id="btn-mer-confirm" class="btn-crm-green">Valider la mise en relation</button>
      </div>
    `,
    onMount(body) {
      body.querySelector('#btn-mer-copy')?.addEventListener('click', () => {
        copyText(summaryLines, 'Récapitulatif');
      });
      body.querySelector('#btn-mer-confirm')?.addEventListener('click', () => {
        const siret = etablissement.siret;
        crmSheets.addEvent(siret, 'quoteHistory', {
          label: 'Mise en relation effectuée',
          detail: `${sheet.quote.category} — ${sheet.leadgen.max} fournisseurs max.`,
          author: sheet.quote.advisor,
        });
        crmSheets.addEvent(siret, 'qualifications', {
          label: 'Mise en relation validée',
          detail: `Demande #${sheet.quote.id} (${sheet.quote.category})`,
          author: sheet.quote.advisor,
        });
        closeModal();
        toast('Mise en relation enregistrée avec succès.', 'success');
      });
    },
  });
}

/* ==================================================================== */
/* 7. Événements de l'interface                                          */
/* ==================================================================== */

function bindEvents() {
  // Recherche
  $('search-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const q = $('champ-recherche')?.value || '';
    const cp = $('champ-cp')?.value || '';
    const criteria = parseSearchInput(q, cp);
    if (criteria.identifiant && isValidSiret(criteria.identifiant) && !criteria.codePostal && !criteria.ville) {
      loadBySiret(criteria.identifiant);
      return;
    }
    executeSearch(criteria);
  });

  // Masquer / afficher la barre de recherche
  $('btn-hide-search')?.addEventListener('click', () => setSearchCollapsed(true));
  $('btn-show-search')?.addEventListener('click', () => {
    setSearchCollapsed(false);
    $('champ-recherche')?.focus();
  });

  // Liste déroulante des résultats
  $('btn-results-toggle')?.addEventListener('click', () => {
    const drop = $('results-dropdown');
    const btn = $('btn-results-toggle');
    if (!drop || !btn) return;
    const willOpen = drop.hidden;
    drop.hidden = !willOpen;
    btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  document.addEventListener('click', (event) => {
    const anchor = event.target.closest?.('.search-results-anchor');
    if (!anchor) {
      const drop = $('results-dropdown');
      if (drop && !drop.hidden) {
        drop.hidden = true;
        $('btn-results-toggle')?.setAttribute('aria-expanded', 'false');
      }
    }
    if (event.target.closest?.('[data-close-modal]')) closeModal();
  });

  // Raccourcis clavier : / ouvre la recherche, Échap ferme la modale
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
      const drop = $('results-dropdown');
      if (drop) drop.hidden = true;
      return;
    }
    const tag = document.activeElement?.tagName || '';
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) && !state.embed?.active) {
      event.preventDefault();
      setSearchCollapsed(false);
      $('champ-recherche')?.focus();
      $('champ-recherche')?.select();
    }
  });

  // Sélecteur mode intégré
  $('embed-select-row')?.addEventListener('change', (event) => {
    const found = state.rows.find((r) => r.etablissement.siret === event.target.value);
    if (found) selectRow(found);
  });
  $('btn-embed-select')?.addEventListener('click', sendEmbedSelection);

  // Copie SIRET & GPS
  $('btn-copy-siret')?.addEventListener('click', () => copyText(currentSiret(), 'SIRET'));
  $('loc-coords')?.addEventListener('click', () => {
    if (state.position) copyText(`${state.position.lat.toFixed(6)}, ${state.position.lon.toFixed(6)}`, 'GPS');
  });

  // Logo entreprise
  $('btn-company-logo')?.addEventListener('click', openLogoModal);

  // Téléphone standard
  $('btn-tel-standard')?.addEventListener('click', () => {
    if (!currentSiret()) return;
    const sheet = getEffectiveSheet(state.current);
    const editor = $('tel-standard-editor');
    editor.hidden = !editor.hidden;
    if (!editor.hidden) {
      $('input-tel-standard').value = sheet.telStandard ? formatPhoneFr(sheet.telStandard) : '';
      $('input-tel-standard').focus();
    }
  });
  $('btn-save-tel')?.addEventListener('click', () => {
    const raw = $('input-tel-standard').value.trim();
    if (!raw) {
      patchCurrentSheet({ telStandard: '' });
      renderTelStandard('');
      $('tel-standard-editor').hidden = true;
      return;
    }
    const norm = normalizePhoneFr(raw);
    if (!norm) { toast('Numéro français à 10 chiffres attendu.', 'error'); return; }
    patchCurrentSheet({ telStandard: norm });
    renderTelStandard(norm);
    $('tel-standard-editor').hidden = true;
    toast('N° tél standard enregistré.', 'success');
  });
  $('btn-cancel-tel')?.addEventListener('click', () => { $('tel-standard-editor').hidden = true; });

  // Ligne directe acheteur
  const toggleMobileEditor = () => {
    if (!currentSiret()) return;
    const sheet = getEffectiveSheet(state.current);
    const editor = $('mobile-editor');
    editor.hidden = !editor.hidden;
    if (!editor.hidden) {
      $('input-buyer-mobile').value = sheet.mobile ? formatPhoneDots(sheet.mobile) : '';
      $('input-buyer-mobile').focus();
    }
  };
  $('btn-edit-mobile')?.addEventListener('click', toggleMobileEditor);
  $('btn-add-mobile-hint')?.addEventListener('click', toggleMobileEditor);
  $('btn-save-mobile')?.addEventListener('click', () => {
    const raw = $('input-buyer-mobile').value.trim();
    if (!raw) {
      patchCurrentSheet({ mobile: '' });
      renderBuyerMobile('');
      $('mobile-editor').hidden = true;
      return;
    }
    const norm = normalizePhoneFr(raw);
    if (!norm) { toast('Numéro français à 10 chiffres attendu.', 'error'); return; }
    patchCurrentSheet({ mobile: norm });
    renderBuyerMobile(norm);
    $('mobile-editor').hidden = true;
    toast('Ligne directe enregistrée.', 'success');
  });
  $('btn-cancel-mobile')?.addEventListener('click', () => { $('mobile-editor').hidden = true; });

  // Sauvegarde automatique des champs Société & Acheteur
  $('co-effectif')?.addEventListener('change', (e) => {
    patchCurrentSheet({ effectif: e.target.value });
    recomputeSiteAndEnergy(state.position || {});
  });
  $('co-type')?.addEventListener('change', (e) => patchCurrentSheet({ entityType: e.target.value }));
  $('co-website')?.addEventListener('change', (e) => patchCurrentSheet({ website: e.target.value.trim() }));
  $('buyer-civilite')?.addEventListener('change', (e) => patchCurrentSheet({ civilite: e.target.value }));
  $('buyer-prenom')?.addEventListener('change', (e) => patchCurrentSheet({ prenom: e.target.value.trim() }));
  $('buyer-nom')?.addEventListener('change', (e) => {
    const val = e.target.value.trim().toUpperCase();
    e.target.value = val;
    patchCurrentSheet({ nom: val });
  });
  $('buyer-fonction')?.addEventListener('change', (e) => patchCurrentSheet({ fonction: e.target.value.trim() }));
  $('buyer-email')?.addEventListener('change', (e) => {
    const val = e.target.value.trim();
    if (val && !isValidEmail(val)) {
      toast('Adresse e-mail invalide.', 'error');
      return;
    }
    patchCurrentSheet({ email: val });
  });

  // Commentaires & liens Acheteur
  $('btn-comments-history')?.addEventListener('click', openCommentsModal);
  $('btn-comments-more')?.addEventListener('click', () => {
    if (!currentSiret()) return;
    const sheet = getEffectiveSheet(state.current);
    if (sheet.comments.length <= 1) {
      openCommentsModal();
      return;
    }
    state.commentsExpanded = !state.commentsExpanded;
    renderCommentsSection(sheet.comments);
  });

  $('btn-new-sheet-same')?.addEventListener('click', () => {
    const siret = currentSiret();
    if (!siret) { toast('Recherchez d\'abord une entreprise.'); return; }
    const sheet = getEffectiveSheet(state.current);
    const newId = String(3800000 + Math.floor(Math.random() * 199999));
    const nextQuote = { ...sheet.quote, id: newId, createdAt: new Date().toISOString() };
    patchCurrentSheet({ quote: nextQuote });
    crmSheets.addEvent(siret, 'quoteHistory', { label: `Nouvelle fiche #${newId} créée`, detail: nextQuote.category, author: nextQuote.advisor });
    renderQuoteSection(nextQuote);
    toast(`Nouvelle fiche #${newId} créée sur cette société.`, 'success');
  });

  $('btn-new-sheet-other')?.addEventListener('click', () => {
    if (state.embed?.active) {
      state.embed.requestSearch();
      return;
    }
    setSearchCollapsed(false);
    const input = $('champ-recherche');
    const cp = $('champ-cp');
    if (input) { input.value = ''; input.focus(); }
    if (cp) cp.value = '';
    setSearchStatus('Saisissez une nouvelle société ou un SIRET.');
  });

  $('btn-qualifications')?.addEventListener('click', openQualificationsModal);

  // Demande de devis
  $('btn-quote-criteria')?.addEventListener('click', openQuoteCriteriaModal);
  $('btn-quote-history')?.addEventListener('click', openQuoteHistoryModal);
  $('btn-quote-audio')?.addEventListener('click', openCallNoteModal);
  $('btn-resend-suppliers')?.addEventListener('click', () => {
    const siret = currentSiret();
    if (!siret) { toast('Recherchez d\'abord une entreprise.'); return; }
    const sheet = getEffectiveSheet(state.current);
    crmSheets.addEvent(siret, 'quoteHistory', {
      label: 'Renvoi coordonnées fournisseurs',
      detail: sheet.email ? `Envoyé vers ${sheet.email}` : 'Enregistré sur la fiche',
      author: sheet.quote.advisor,
    });
    toast('Renvoi des coordonnées fournisseurs enregistré.', 'success');
  });
  $('btn-bimp-track')?.addEventListener('click', openBimpModal);

  // Carte agrandie
  $('btn-expand-map')?.addEventListener('click', openExpandedMapModal);

  // Navigation Vue de la rue
  $('street-prev')?.addEventListener('click', () => showStreetPhoto(state.streetIndex - 1));
  $('street-next')?.addEventListener('click', () => showStreetPhoto(state.streetIndex + 1));

  // Détails Financier, Électricité, KPI Surface & Solaire
  $('btn-finance-detail')?.addEventListener('click', () => {
    if (!state.finance || !state.current) return;
    openModal({
      title: 'Note financière (estimée) — Détail',
      html: buildFinancialModalHtml(state.finance, state.current.entreprise, state.current.etablissement),
    });
  });

  $('btn-elec-detail')?.addEventListener('click', () => {
    if (!state.electricity) return;
    openModal({
      title: 'Consommation d\'électricité (estimée) — Évolution mensuelle',
      html: buildElectricityModalHtml(state.electricity, state.solar),
    });
  });

  $('kpi-surface')?.addEventListener('click', openSurfaceModal);
  $('kpi-solar')?.addEventListener('click', () => {
    if (!state.solar) return;
    openModal({
      title: 'Potentiel solaire du site',
      html: `
        <table class="modal-table">
          <tbody>
            <tr><th>Qualification</th><td><strong>${escapeHtml(state.solar.rating)}</strong> (${escapeHtml(state.solar.subtitle)})</td></tr>
            <tr><th>Gisement annuel estimé</th><td>${escapeHtml(formatIntFr(state.solar.irradiationKwhM2))} kWh / m² / an</td></tr>
            <tr><th>Puissance crête installable</th><td>~ ${escapeHtml(formatIntFr(state.solar.installableKwc))} kWc (60 % de la toiture)</td></tr>
            <tr><th>Production annuelle estimée</th><td>~ ${escapeHtml(formatIntFr(state.solar.annualProdKwh))} kWh / an</td></tr>
          </tbody>
        </table>
        <p class="modal-note">Estimation indicative avant étude de calepinage, d'ombrage et de structure de charpente.</p>
      `,
    });
  });

  // Accordéons RAC, Prelead, Génération de lead
  document.querySelectorAll('.crm-accordion-head').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      const sign = btn.querySelector('.crm-accordion-sign');
      if (!panel) return;
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (sign) sign.textContent = open ? '−' : '+';
    });
  });

  const saveRac = () => patchCurrentSheet({
    rac: { status: $('rac-status').value, date: $('rac-date').value, note: $('rac-note').value.trim() },
  });
  ['rac-status', 'rac-date', 'rac-note'].forEach((id) => $(id)?.addEventListener('change', saveRac));

  const savePrelead = () => patchCurrentSheet({
    prelead: { owner: $('prelead-owner').value, delay: $('prelead-delay').value, budget: $('prelead-budget').value.trim() },
  });
  ['prelead-owner', 'prelead-delay', 'prelead-budget'].forEach((id) => $(id)?.addEventListener('change', savePrelead));

  const saveLeadgen = () => patchCurrentSheet({
    leadgen: { channel: $('leadgen-channel').value, max: $('leadgen-max').value },
  });
  ['leadgen-channel', 'leadgen-max'].forEach((id) => $(id)?.addEventListener('change', saveLeadgen));

  // Mise en relation
  $('btn-mise-en-relation')?.addEventListener('click', openMiseEnRelationModal);
}

/* ==================================================================== */
/* 8. Démarrage                                                          */
/* ==================================================================== */

async function boot() {
  window.__companyLocatorReady = true;

  // Rendu initial des icônes statiques
  $('weather-icon').innerHTML = weatherSvg('partly-cloudy');
  renderElectricityChart($('elec-chart'), []);

  // Mode intégré (?embed=1)
  state.embed = createEmbedBridge(window);
  const isEmbed = state.embed.init();
  if (isEmbed) {
    state.embed.onSearch(({ nom, codePostal }) => {
      executeSearch({ nom: nom || '', codePostal: codePostal || '', ville: '', adresse: '', identifiant: '' });
    });
    updateEmbedBar();
  } else if (uiPrefs.get().searchCollapsed) {
    setSearchCollapsed(true, { persist: false });
  }

  bindEvents();

  // Chargement en parallèle des libellés INSEE et des deux cartes Leaflet
  const [, planRes, satRes] = await Promise.allSettled([
    loadLabels(),
    createPlanMap($('map-plan')),
    createSatelliteMap($('map-satellite'), {
      onStatus: ({ ok }) => { $('sat-empty').hidden = ok; },
    }),
  ]);
  if (planRes.status === 'fulfilled') state.planMap = planRes.value;
  if (satRes.status === 'fulfilled') state.satMap = satRes.value;

  // Paramètres d'URL / ancre
  const params = new URLSearchParams(window.location.search);
  const hashMatch = /siret=(\d{14})/.exec(window.location.hash || '');
  const urlSiret = digitsOnly(params.get('siret') || (hashMatch ? hashMatch[1] : ''));
  const urlNom = (params.get('nom') || params.get('q') || '').trim();
  const urlCp = (params.get('cp') || params.get('codePostal') || '').trim();

  if (isEmbed) {
    if (state.embed.params.nom || state.embed.params.codePostal) {
      await executeSearch({
        nom: state.embed.params.nom,
        codePostal: state.embed.params.codePostal,
        ville: '',
        adresse: '',
        identifiant: '',
      });
    }
    return;
  }

  if (urlSiret && isValidSiret(urlSiret)) {
    $('champ-recherche').value = urlSiret;
    await loadBySiret(urlSiret);
    return;
  }

  if (urlNom || urlCp) {
    $('champ-recherche').value = urlNom;
    $('champ-cp').value = urlCp;
    await executeSearch(parseSearchInput(urlNom, urlCp));
    return;
  }

  // Ouverture directe : charge le dernier SIRET consulté ou l'entreprise par défaut (sauf ?empty=1)
  if (params.get('empty') !== '1') {
    const initialSiret = uiPrefs.get().lastSiret || config.app.defaultSiret;
    if (initialSiret && isValidSiret(initialSiret)) {
      await loadBySiret(initialSiret, { silent: true });
    }
  }
}

boot().catch((error) => {
  const banner = $('boot-error');
  if (banner) {
    banner.hidden = false;
    banner.textContent = `Erreur au démarrage : ${toUserMessage(error)}`;
  }
});
