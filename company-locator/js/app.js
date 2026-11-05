/**
 * app.js — Point d'entrée et orchestration de Company Locator France.
 *
 * Responsabilité : câbler l'interface aux modules métier, gérer l'état
 * courant (recherche, sélection, fiche, images), le routage par ancre,
 * les paramètres, l'historique et l'état des services.
 *
 * Aucune requête HTTP directe ici : tout passe par entreprise-api.js,
 * geocoding.js et images.js. Aucun rendu DOM complexe ici : voir ui.js.
 */

import config from './config.js';
import { AppError, ERR, toUserMessage, debounce, formatCoords, isValidCodePostal, isPlausibleFranceCoords } from './utils.js';
import { loadLabels } from './labels.js';
import * as api from './entreprise-api.js';
import { resolvePosition, reverseGeocode, ping as pingGeocoding } from './geocoding.js';
import { runSearch, summarize, validateCriteria, readCriteria, sortRows } from './search.js';
import * as mapModule from './map.js';
import * as images from './images.js';
import * as streetview from './streetview.js';
import { detectProxy, transportLabel, proxyState } from './transport.js';
import * as exporter from './export.js';
import * as ui from './ui.js';
import {
  settings, history, favorites, storageInfo, purgeCache, purgeUserData,
} from './storage.js';

/* ==================================================================== */
/* 1. État applicatif                                                    */
/* ==================================================================== */

const state = {
  criteria: null,
  result: null,
  rows: [],
  page: 1,
  selectedSiret: null,
  fiche: null,
  positions: new Map(),
  street: { loading: false, photos: [], sources: [], error: null },
  // 4e vue de la carte : image de rue de l'établissement sélectionné.
  mapStreet: { active: false, loading: false, photos: [], index: 0, target: null, error: null },
  // D. Vue immersive : rien n'est chargé tant que `loaded` reste faux.
  streetview: { providerKey: null, loaded: false, heading: 0, photoIndex: 0 },
  googleStreetView: { configured: false, checked: false, message: '' },
  etabs: { loading: false, list: null, error: null, notice: null },
  map: null,
  aerial: null,
  searchAbort: null,
  historyTab: 'searches',
  mapillaryAccess: { mode: 'none', detail: '' },
  statuses: [],
};

const dom = {};

function cacheDom() {
  const ids = [
    'search-form', 'champ-nom', 'champ-cp', 'champ-ville', 'champ-adresse', 'champ-identifiant', 'champ-etat',
    'btn-search', 'btn-reset', 'form-error', 'results-list', 'results-summary', 'results-notice', 'results-status',
    'pagination', 'champ-tri', 'btn-export-results', 'btn-export-geojson', 'detail-card', 'map', 'map-card',
    'map-overlay', 'map-readout', 'map-credits', 'btn-recenter', 'btn-copy-gps', 'btn-fullscreen', 'workspace',
    'map-street', 'map-street-prev', 'map-street-next', 'map-street-close',
    'btn-status', 'status-panel', 'status-list', 'btn-recheck', 'btn-settings', 'modal-settings', 'settings-body',
    'btn-history', 'modal-history', 'history-body', 'btn-export-favorites', 'viewbar-count', 'villes-suggestions',
    'boot-error', 'advanced-search',
  ];
  ids.forEach((id) => { dom[id] = document.getElementById(id); });
  dom.viewbarButtons = [...document.querySelectorAll('.viewbar-btn')];
  dom.baselayerButtons = [...document.querySelectorAll('[data-baselayer]')];
  dom.examples = [...document.querySelectorAll('.chip-example')];
}

/* ==================================================================== */
/* 2. Utilitaires d'interface                                            */
/* ==================================================================== */

function setFormError(message, errors = {}) {
  const node = dom['form-error'];
  if (!message) {
    node.hidden = true;
    node.textContent = '';
  } else {
    node.hidden = false;
    node.textContent = message;
  }
  const mapping = { codePostal: 'champ-cp', identifiant: 'champ-identifiant', nom: 'champ-nom' };
  Object.entries(mapping).forEach(([key, id]) => {
    dom[id]?.setAttribute('aria-invalid', String(Boolean(errors[key])));
  });
}

function setView(view) {
  dom.workspace.dataset.view = view;
  dom.viewbarButtons.forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  });
  if (view === 'map') setTimeout(() => state.map?.invalidate(), 80);
  if (view === 'detail' && state.fiche?.activeTab === 'images') setTimeout(() => state.aerial?.invalidate(), 80);
}

function readForm() {
  return readCriteria({
    nom: dom['champ-nom'].value,
    codePostal: dom['champ-cp'].value,
    ville: dom['champ-ville'].value,
    adresse: dom['champ-adresse'].value,
    identifiant: dom['champ-identifiant'].value,
  });
}

function writeForm(criteria = {}) {
  dom['champ-nom'].value = criteria.nom || '';
  dom['champ-cp'].value = criteria.codePostal || '';
  dom['champ-ville'].value = criteria.ville || '';
  dom['champ-adresse'].value = criteria.adresse || '';
  dom['champ-identifiant'].value = criteria.identifiant || '';
  if (criteria.adresse || criteria.identifiant) dom['advanced-search'].open = true;
}

function updateCitySuggestions(rows) {
  const list = dom['villes-suggestions'];
  if (!list) return;
  const cities = [...new Set(rows.map((row) => row.etablissement.commune).filter(Boolean))].sort().slice(0, 30);
  list.replaceChildren(...cities.map((city) => {
    const option = document.createElement('option');
    option.value = city;
    return option;
  }));
}

/* ==================================================================== */
/* 3. Recherche                                                          */
/* ==================================================================== */

async function doSearch({ page = 1, criteria = null } = {}) {
  const input = criteria || readForm();
  const validation = validateCriteria(input);
  if (!validation.valid) {
    setFormError(validation.message, validation.errors);
    return;
  }
  setFormError('');

  state.searchAbort?.abort();
  const controller = new AbortController();
  state.searchAbort = controller;

  const current = settings.get();
  dom['btn-search'].classList.add('is-busy');
  dom['btn-search'].disabled = true;
  ui.renderResultsSkeleton(dom['results-list']);
  dom['results-summary'].textContent = 'Recherche en cours…';
  ui.renderNotices(dom['results-notice'], []);
  dom.pagination.hidden = true;

  try {
    const result = await runSearch(input, {
      page,
      perPage: current.perPage,
      etat: dom['champ-etat'].value,
      sort: current.sort,
      fuzzy: current.fuzzyFallback,
      signal: controller.signal,
    });

    state.criteria = result.criteria;
    state.result = result;
    state.rows = result.rows;
    state.page = result.page;

    renderResultsView();
    history.addSearch({ criteria: result.criteria, totalResults: result.totalResults });
    updateCitySuggestions(result.rows);

    if (result.rows.length === 1) {
      await selectEtablissement(result.rows[0].etablissement.siret, { auto: true });
    }
  } catch (error) {
    if (error instanceof AppError && error.code === ERR.ABORTED) return;
    const message = toUserMessage(error);
    state.rows = [];
    state.result = null;
    dom['results-list'].replaceChildren();
    dom['results-list'].append(ui.emptyState({
      iconName: error instanceof AppError && error.code === ERR.INVALID_INPUT ? 'alert' : 'search',
      title: error instanceof AppError && error.code === ERR.INVALID_INPUT ? 'Critères à corriger' : 'Recherche impossible',
      message,
      action: error instanceof AppError && error.retryable
        ? Object.assign(document.createElement('button'), {
          type: 'button', className: 'btn btn-sm btn-outline', textContent: 'Réessayer', onclick: () => doSearch({ page, criteria: input }),
        })
        : null,
    }));
    dom['results-summary'].textContent = 'Aucun résultat.';
    dom['results-status'].textContent = message;
    dom['btn-export-results'].disabled = true;
    dom['btn-export-geojson'].disabled = true;
    dom['viewbar-count'].textContent = '0';
    state.map?.setRows([]);
    if (error instanceof AppError && error.code === ERR.INVALID_INPUT) setFormError(message, error.details || {});
  } finally {
    dom['btn-search'].classList.remove('is-busy');
    dom['btn-search'].disabled = false;
  }
}

function renderResultsView() {
  const { rows, result } = state;
  if (!rows.length) {
    dom['results-list'].replaceChildren();
    dom['results-list'].append(ui.emptyState({
      iconName: 'search',
      title: 'Aucune entreprise trouvée',
      message: 'Aucun établissement ne correspond à ces critères. Vérifiez l\'orthographe, élargissez le code postal, ou basculez le filtre d\'état sur « Tous ».',
    }));
  } else {
    ui.renderResults(dom['results-list'], {
      rows,
      selectedSiret: state.selectedSiret,
      onSelect: (siret) => selectEtablissement(siret),
      handlers: { onCopy: async (value, label) => {
        const { copyText } = await import('./utils.js');
        const ok = await copyText(value);
        ui.toast(ok ? `Copié : ${label}` : 'Copie impossible sur ce navigateur', ok ? 'success' : 'error');
      } },
    });
  }

  dom['results-summary'].textContent = result ? summarize(result) : 'Aucune recherche effectuée.';
  dom['results-status'].textContent = dom['results-summary'].textContent;
  dom['viewbar-count'].textContent = String(rows.length);
  ui.renderNotices(dom['results-notice'], result?.notices || []);
  ui.renderPagination(dom.pagination, {
    page: state.page,
    totalPages: result?.totalPages || 0,
    onPage: (page) => doSearch({ page, criteria: state.criteria }),
  });

  dom['btn-export-results'].disabled = rows.length === 0;
  dom['btn-export-geojson'].disabled = rows.length === 0;

  state.map?.setRows(rows);
  state.map?.fitAll();
}

/* ==================================================================== */
/* 4. Sélection d'un établissement et fiche                              */
/* ==================================================================== */

async function selectEtablissement(siret, options = {}) {
  if (!siret) return;
  let row = state.rows.find((item) => item.etablissement.siret === siret);

  if (!row) {
    // Lien profond, historique ou fiche enregistrée : on recharge depuis l'API.
    try {
      dom['results-summary'].textContent = 'Chargement de l\'établissement…';
      const fetched = await api.fetchBySiret(siret);
      row = fetched.row;
      if (!row) {
        ui.toast('Établissement introuvable dans l\'API officielle.', 'error');
        return;
      }
    } catch (error) {
      ui.toast(toUserMessage(error), 'error');
      return;
    }
  }

  state.selectedSiret = siret;
  destroyAerial();
  const current = settings.get();
  state.fiche = {
    row,
    position: state.positions.get(siret) || null,
    positionLoading: !state.positions.has(siret),
    positionError: null,
    activeTab: current.autoOpenAerial ? 'images' : 'fiche',
    isFavorite: favorites.has(siret),
    apiUrl: `https://recherche-entreprises.api.gouv.fr/search?q=${row.etablissement.siret}`,
  };
  state.street = { loading: false, photos: [], sources: [], error: null };
  // Nouvelle fiche : on referme toute vue immersive précédente (elle pointait
  // sur un autre bâtiment) et on repart de la source préférée.
  state.streetview = { providerKey: null, loaded: false, heading: config.streetView.heading, photoIndex: 0 };
  state.etabs = { loading: false, list: null, error: null, notice: null };

  ui.renderDetail(dom['detail-card'], state.fiche, detailHandlers());
  ui.renderGpsSection(state.fiche, detailHandlers());
  ui.setActiveTab(dom['detail-card'], state.fiche.activeTab);
  ui.renderComplementaryPhotos(siret, images.getComplementaryPhotos(siret), detailHandlers());
  ui.renderEtablissements({ ...state.etabs, currentSiret: siret }, detailHandlers());

  state.map?.select(siret, { position: state.fiche.position, pan: true, openPopup: !options.fromMap });
  dom['btn-copy-gps'].disabled = !state.fiche.position;
  // La vue de rue éventuellement ouverte suit l'établissement consulté.
  if (state.mapStreet.active) openMapStreet({ force: true });
  dom['btn-copy-gps'].dataset.siret = siret;

  document.querySelectorAll('.result-item').forEach((item) => {
    item.classList.toggle('is-selected', item.dataset.siret === siret);
  });

  history.addView({
    siret,
    siren: row.entreprise.siren,
    nom: row.etablissement.nomAffiche,
    commune: row.etablissement.commune,
    codePostal: row.etablissement.codePostal,
  });

  if (!options.auto) setView('detail');
  if (window.location.hash !== `#/etablissement/${siret}`) {
    window.history.replaceState(null, '', `#/etablissement/${siret}`);
  }

  if (state.fiche.activeTab === 'images') showImagesTab();

  if (!state.fiche.position) await computePosition(row);
}

async function computePosition(row) {
  const siret = row.etablissement.siret;
  try {
    // On géocode toujours l'adresse propre de l'établissement : l'adresse
    // saisie dans le formulaire ne sert qu'au classement des résultats.
    const position = await resolvePosition(row.etablissement);
    if (state.selectedSiret !== siret) {
      state.positions.set(siret, position);
      return;
    }
    state.positions.set(siret, position);
    state.fiche.position = position;
    state.fiche.positionLoading = false;
    state.fiche.positionError = null;
    state.map?.upsertPosition(row, position);
    state.map?.select(siret, { position, pan: true, openPopup: false });
    dom['btn-copy-gps'].disabled = false;
  } catch (error) {
    if (state.selectedSiret !== siret) return;
    state.fiche.positionLoading = false;
    state.fiche.positionError = toUserMessage(error);
    dom['btn-copy-gps'].disabled = true;
  }
  ui.renderGpsSection(state.fiche, detailHandlers());
  ui.updateOsmSlot(state.fiche.position);
  if (state.fiche.activeTab === 'images') showImagesTab();
}

function destroyAerial() {
  if (state.aerial) {
    try { state.aerial.destroy(); } catch { /* carte déjà retirée */ }
    state.aerial = null;
  }
}

/* ---------------------------- Onglet images ------------------------- */

async function showImagesTab() {
  const fiche = state.fiche;
  if (!fiche) return;

  // A. Vue aérienne
  destroyAerial();
  const node = ui.renderAerialPlaceholder(fiche, detailHandlers());
  if (node && fiche.position) {
    try {
      state.aerial = await mapModule.createAerialMap({
        container: node,
        position: fiche.position,
        zoom: config.imagery.aerialZoom,
        onTileStatus: (status) => {
          if (!status.ok) {
            destroyAerial();
            ui.renderAerialError('Les tuiles BD ORTHO® de l\'IGN n\'ont pas pu être chargées pour cette zone.');
          }
        },
      });
      state.aerial.map.on('zoomend', () => {
        if (ui.detailRefs.aerialZoomNote) ui.detailRefs.aerialZoomNote.textContent = `Zoom ${state.aerial.getZoom()}`;
      });
      setTimeout(() => state.aerial?.invalidate(), 120);
    } catch (error) {
      ui.renderAerialError(toUserMessage(error));
    }
  }

  // B. Photos de rue
  ui.renderComplementaryPhotos(fiche.row.etablissement.siret, images.getComplementaryPhotos(fiche.row.etablissement.siret), detailHandlers());
  if (!fiche.position) {
    ui.renderStreetPhotos({ loading: false, photos: [], sources: [], radiusM: settings.get().streetRadiusM, error: 'Aucune coordonnée disponible : la recherche de photographies de rue est impossible.' }, detailHandlers());
    renderStreetViewSection();
    return;
  }
  if (!state.street.photos.length && !state.street.error) await loadStreetPhotos();
  else {
    ui.renderStreetPhotos({ ...state.street, radiusM: settings.get().streetRadiusM }, detailHandlers());
    renderStreetViewSection();
  }
}

/**
 * D. Vue immersive. Recalcule les sources disponibles puis rend la section.
 * Aucun iframe n'est créé ici : seul un clic utilisateur déclenche le chargement.
 */
function renderStreetViewSection() {
  const fiche = state.fiche;
  if (!fiche) return;
  const providers = streetview.availableProviders({
    photos: state.street.photos,
    position: fiche.position,
    googleConfigured: state.googleStreetView.configured,
  });

  const view = state.streetview;
  let selected = providers.find((provider) => provider.key === view.providerKey && provider.status === 'ready') || null;
  if (!selected) {
    const best = streetview.pickProvider(providers, settings.get().streetViewProvider || config.streetView.preferredProvider);
    selected = best;
    view.providerKey = best?.key || null;
    view.photoIndex = 0;
    view.loaded = false;
  }
  if (selected && view.photoIndex >= (selected.photos?.length || 0)) view.photoIndex = 0;

  ui.renderStreetView({
    providers,
    selected,
    loaded: view.loaded,
    heading: view.heading,
    photoIndex: view.photoIndex,
    position: fiche.position,
  }, detailHandlers());
}

/** URL du cadre, reconstruite à chaque rendu (orientation, photo choisie). */
function streetViewUrl() {
  const fiche = state.fiche;
  const view = state.streetview;
  if (!fiche || !view.providerKey) return null;
  const providers = streetview.availableProviders({
    photos: state.street.photos,
    position: fiche.position,
    googleConfigured: state.googleStreetView.configured,
  });
  const selected = providers.find((provider) => provider.key === view.providerKey);
  if (!selected || selected.status !== 'ready') return null;
  const photo = selected.photos?.[view.photoIndex] || selected.photo || null;
  return streetview.embedUrlFor(view.providerKey, {
    photo,
    position: fiche.position,
    heading: view.heading,
    pitch: config.streetView.pitch,
    fov: config.streetView.fov,
  });
}

async function loadStreetPhotos() {
  const fiche = state.fiche;
  if (!fiche?.position) return;
  const current = settings.get();
  const siret = fiche.row.etablissement.siret;
  state.street = { loading: true, photos: [], sources: [], error: null };
  ui.renderStreetPhotos({ ...state.street, radiusM: current.streetRadiusM }, detailHandlers());

  try {
    const result = await images.fetchStreetPhotos({
      lat: fiche.position.lat,
      lon: fiche.position.lon,
      radiusM: current.streetRadiusM,
      providers: current.streetProviders,
      limit: config.imagery.maxStreetPhotos,
    });
    if (state.selectedSiret !== siret) return;
    state.street = { loading: false, photos: result.photos, sources: result.sources, error: null };
  } catch (error) {
    if (state.selectedSiret !== siret) return;
    state.street = { loading: false, photos: [], sources: [], error: toUserMessage(error) };
  }
  ui.renderStreetPhotos({ ...state.street, radiusM: current.streetRadiusM }, detailHandlers());
  renderStreetViewSection();
}

/* ------------------------ Callbacks de la fiche --------------------- */

function detailHandlers() {
  const copy = async (value, label) => {
    const { copyText } = await import('./utils.js');
    const ok = await copyText(value);
    ui.toast(ok ? `Copié : ${label}` : 'Copie impossible sur ce navigateur', ok ? 'success' : 'error');
  };

  return {
    onCopyValue: (value, label) => copy(value, label || 'la valeur'),
    onCopyAddress: () => copy(exporter.addressText(state.fiche.row.etablissement), 'l\'adresse'),
    onCopySiret: () => copy(state.fiche.row.etablissement.siret, 'le SIRET'),
    onCopyGps: () => copy(exporter.gpsText(state.fiche.position), 'les coordonnées GPS'),
    onExportFiche: () => {
      const { filename } = exporter.exportFicheCsv({
        etablissement: state.fiche.row.etablissement,
        entreprise: state.fiche.row.entreprise,
        position: state.fiche.position,
      });
      ui.toast(`Fiche exportée : ${filename}`, 'success');
    },
    onToggleFavorite: () => {
      destroyAerial();
      const siret = state.fiche.row.etablissement.siret;
      if (favorites.has(siret)) {
        favorites.remove(siret);
        state.fiche.isFavorite = false;
        ui.toast('Fiche retirée des enregistrements.', 'info');
      } else {
        favorites.save({
          etablissement: state.fiche.row.etablissement,
          entreprise: state.fiche.row.entreprise,
          position: state.fiche.position,
        });
        state.fiche.isFavorite = true;
        ui.toast('Fiche enregistrée sur cet appareil.', 'success');
      }
      ui.renderDetail(dom['detail-card'], state.fiche, detailHandlers());
      ui.setActiveTab(dom['detail-card'], state.fiche.activeTab);
      ui.renderGpsSection(state.fiche, detailHandlers());
      refreshCurrentTab();
    },
    onTabChange: (tab) => {
      state.fiche.activeTab = tab;
      ui.setActiveTab(dom['detail-card'], tab);
      refreshCurrentTab();
    },
    onReverseGeocode: async () => {
      if (!state.fiche.position) return;
      ui.toast('Géocodage inverse en cours…', 'info', 1800);
      try {
        const result = await reverseGeocode(state.fiche.position.lat, state.fiche.position.lon);
        ui.renderReverseResult(result);
      } catch (error) {
        ui.renderReverseResult(null);
        ui.toast(toUserMessage(error), 'error');
      }
    },
    onAerialZoom: (delta) => {
      if (!state.aerial) return;
      state.aerial.setZoom(state.aerial.getZoom() + delta);
    },
    onAerialRecenter: () => state.aerial?.recenter(),
    onRadiusChange: (radius) => {
      settings.set({ streetRadiusM: radius });
      loadStreetPhotos();
    },
    onReloadPhotos: () => loadStreetPhotos(),

    /* D. Vue immersive — chargement strictement sur clic. */
    resolveUrl: () => streetViewUrl(),
    onSelectProvider: (key) => {
      state.streetview.providerKey = key;
      state.streetview.photoIndex = 0;
      state.streetview.loaded = false; // changer de source ne charge rien tout seul
      renderStreetViewSection();
    },
    onLoadEmbed: () => {
      state.streetview.loaded = true;
      renderStreetViewSection();
    },
    onCloseEmbed: () => {
      state.streetview.loaded = false;
      renderStreetViewSection();
    },
    onHeadingChange: (degrees) => {
      state.streetview.heading = streetview.normalizeHeading(degrees);
      renderStreetViewSection();
    },
    onPhotoChange: (index) => {
      state.streetview.photoIndex = Math.max(0, index);
      renderStreetViewSection();
    },
    onOpenPhoto: (photo) => {
      const all = [...state.street.photos, ...images.getComplementaryPhotos(state.fiche.row.etablissement.siret)];
      const index = all.findIndex((item) => item.id === photo.id);
      ui.openLightbox(all, Math.max(0, index));
    },
    onAddPhoto: (payload) => {
      try {
        images.addComplementaryPhoto(state.fiche.row.etablissement.siret, payload);
        ui.toast('Photographie ajoutée avec sa source.', 'success');
      } catch (error) {
        ui.toast(toUserMessage(error), 'error');
      }
      ui.renderComplementaryPhotos(state.fiche.row.etablissement.siret, images.getComplementaryPhotos(state.fiche.row.etablissement.siret), detailHandlers());
    },
    onRemovePhoto: (photo) => {
      images.removeComplementaryPhoto(state.fiche.row.etablissement.siret, photo.id);
      ui.renderComplementaryPhotos(state.fiche.row.etablissement.siret, images.getComplementaryPhotos(state.fiche.row.etablissement.siret), detailHandlers());
      ui.toast('Photographie retirée.', 'info');
    },
    onLoadEtablissements: async (codePostal) => {
      if (codePostal && !isValidCodePostal(codePostal)) {
        ui.toast('Code postal invalide (5 caractères).', 'error');
        return;
      }
      const siret = state.fiche.row.etablissement.siret;
      state.etabs = { loading: true, list: null, error: null, notice: null };
      ui.renderEtablissements({ ...state.etabs, currentSiret: siret }, detailHandlers());
      try {
        const result = await api.fetchEtablissementsOfSiren(state.fiche.row.entreprise.siren, { codePostal });
        if (state.selectedSiret !== siret) return;
        const total = result.entreprise?.nombreEtablissements || 0;
        state.etabs = {
          loading: false,
          list: result.etablissements,
          error: null,
          notice: `L'API publique renvoie le siège et les établissements correspondant au filtre (100 maximum par page)`
            + `${codePostal ? ` pour le code postal ${codePostal}` : ''}. ${total > result.etablissements.length ? `Cette société déclare ${total} établissements : la liste exhaustive n'est pas exposée par cette API, consultez la fiche officielle pour la totalité.` : ''}`,
        };
      } catch (error) {
        if (state.selectedSiret !== siret) return;
        state.etabs = { loading: false, list: null, error: toUserMessage(error), notice: null };
      }
      ui.renderEtablissements({ ...state.etabs, currentSiret: siret }, detailHandlers());
    },
    onSelectSiret: (siret) => selectEtablissement(siret),
  };
}

function refreshCurrentTab() {
  const tab = state.fiche?.activeTab;
  if (tab === 'images') showImagesTab();
  if (tab === 'etablissements') ui.renderEtablissements({ ...state.etabs, currentSiret: state.selectedSiret }, detailHandlers());
}

/* ==================================================================== */
/* 5. Paramètres, historique, état des services                          */
/* ==================================================================== */

function openSettings() {
  ui.renderSettings(dom['settings-body'], {
    settings: settings.get(),
    info: storageInfo(),
    mapillaryAccess: state.mapillaryAccess,
    googleStreetView: state.googleStreetView,
    transport: { label: transportLabel(), ...proxyState() },
  }, {
    onSetting: (key, value) => {
      settings.set({ [key]: value });
      if (key === 'defaultBaseLayer') applyBaseLayer(value);
      if (key === 'perPage' && state.criteria) doSearch({ page: 1, criteria: state.criteria });
      if (key === 'streetRadiusM' && state.fiche?.activeTab === 'images') loadStreetPhotos();
      openSettings();
      ui.toast('Paramètre enregistré.', 'success', 1600);
    },
    onPurgeCache: () => {
      purgeCache();
      api.clearEntrepriseCache();
      ui.toast('Cache des API vidé.', 'success');
      openSettings();
    },
    onPurgeData: () => {
      if (!window.confirm('Effacer l\'historique, les fiches enregistrées, les photos ajoutées et le cache de cet appareil ?')) return;
      purgeUserData();
      ui.toast('Données locales effacées.', 'success');
      openSettings();
    },
    onResetSettings: () => {
      settings.reset();
      applyBaseLayer(settings.get().defaultBaseLayer);
      ui.toast('Paramètres réinitialisés.', 'success');
      openSettings();
    },
  });
  ui.openModal('modal-settings');
}

function openHistory(tab = state.historyTab) {
  state.historyTab = tab;
  ui.renderHistory(dom['history-body'], {
    tab,
    searches: history.listSearches(),
    views: history.listViews(),
    favorites: favorites.list(),
    enabled: history.isEnabled(),
  }, {
    onHistoryTab: (key) => openHistory(key),
    onEnableHistory: () => {
      settings.set({ historyEnabled: true });
      ui.toast('Historique local activé.', 'success');
      openHistory(tab);
    },
    onReplaySearch: (item) => {
      ui.closeModal('modal-history');
      writeForm(item.criteria);
      doSearch({ page: 1, criteria: item.criteria });
    },
    onRemoveSearch: (item) => { history.removeSearch(item.signature); openHistory(tab); },
    onRemoveView: (item) => { history.removeView(item.siret); openHistory(tab); },
    onSelectSiret: (siret) => { ui.closeModal('modal-history'); selectEtablissement(siret); },
    onOpenFavorite: (item) => {
      ui.closeModal('modal-history');
      if (item.position) state.positions.set(item.etablissement.siret, item.position);
      const existing = state.rows.find((row) => row.etablissement.siret === item.etablissement.siret);
      if (!existing) state.rows = [{ etablissement: item.etablissement, entreprise: item.entreprise }, ...state.rows];
      selectEtablissement(item.etablissement.siret);
    },
    onRemoveFavorite: (siret) => { favorites.remove(siret); openHistory(tab); },
    onClearHistory: (kind) => {
      const labels = { searches: 'les recherches', views: 'les fiches consultées', favorites: 'les fiches enregistrées' };
      if (!window.confirm(`Supprimer ${labels[kind]} de cet appareil ?`)) return;
      if (kind === 'searches') history.clearSearches();
      if (kind === 'views') history.clearViews();
      if (kind === 'favorites') favorites.clear();
      ui.toast('Suppression effectuée.', 'success');
      openHistory(tab);
    },
  });
  ui.openModal('modal-history');
}

async function checkServices() {
  state.statuses = [
    { key: 'entreprises', name: 'API Recherche d\'entreprises', state: 'checking', detail: 'Test d\'une requête réelle…' },
    { key: 'geocoding', name: 'Géocodage BAN / Géoplateforme IGN', state: 'checking', detail: 'Test d\'une adresse réelle…' },
    { key: 'ortho', name: 'Photographie aérienne IGN (BD ORTHO®)', state: 'checking', detail: 'Chargement d\'une tuile…' },
    { key: 'panoramax', name: 'Photographies de rue Panoramax', state: 'checking', detail: 'Recherche test…' },
    { key: 'mapillary', name: 'Photographies de rue Mapillary', state: 'checking', detail: 'Détection du jeton…' },
  ];
  ui.renderStatus(dom['status-list'], state.statuses);
  const transportNode = document.getElementById('status-transport');
  if (transportNode) transportNode.textContent = transportLabel();
  updateStatusPill();

  const update = (key, patch) => {
    const item = state.statuses.find((service) => service.key === key);
    if (item) Object.assign(item, patch);
    ui.renderStatus(dom['status-list'], state.statuses);
    updateStatusPill();
  };

  await Promise.allSettled([
    api.ping().then(
      (result) => update('entreprises', { state: 'ok', detail: `Réponse en ${result.latencyMs} ms — aucune clé requise.` }),
      (error) => update('entreprises', { state: 'ko', detail: toUserMessage(error) }),
    ),
    pingGeocoding().then(
      (result) => update('geocoding', { state: 'ok', detail: `Adresse test géocodée en ${result.latencyMs} ms.` }),
      (error) => update('geocoding', { state: 'ko', detail: toUserMessage(error) }),
    ),
    mapModule.pingTiles('ortho').then(
      (result) => update('ortho', result.ok
        ? { state: 'ok', detail: `Tuile BD ORTHO® chargée en ${result.latencyMs} ms.` }
        : { state: 'ko', detail: `Tuile non chargée (${result.reason}).` }),
    ),
    images.pingPanoramax().then(
      (result) => update('panoramax', { state: 'ok', detail: `${result.detail} en ${result.latencyMs} ms — sans jeton.` }),
      (error) => update('panoramax', { state: 'ko', detail: toUserMessage(error) }),
    ),
    images.pingMapillary().then(
      (result) => update('mapillary', result.skipped
        ? { state: 'skipped', detail: result.detail }
        : { state: 'ok', detail: result.detail }),
      (error) => update('mapillary', { state: 'ko', detail: toUserMessage(error) }),
    ),
  ]);
}

function updateStatusPill() {
  const core = state.statuses.filter((service) => ['entreprises', 'geocoding'].includes(service.key));
  const done = core.filter((service) => service.state !== 'checking');
  const okCount = core.filter((service) => service.state === 'ok').length;
  const dot = dom['btn-status'].querySelector('.status-dot');
  const label = dom['btn-status'].querySelector('.status-label');
  if (done.length < core.length) {
    dot.dataset.state = 'checking';
    label.textContent = 'Vérification des API…';
    return;
  }
  if (okCount === core.length) {
    dot.dataset.state = 'ok';
    label.textContent = 'API opérationnelles';
  } else if (okCount > 0) {
    dot.dataset.state = 'partial';
    label.textContent = 'Service partiellement disponible';
  } else {
    dot.dataset.state = 'ko';
    label.textContent = 'API injoignables';
  }
}

/* ------------------- 4e vue : Street View sur la carte ------------- */

const MAP_STREET_KEY = 'street';

/** Point et libellé de la vue de rue : fiche ouverte, sinon sélection, sinon centre. */
function mapStreetTarget() {
  const fiche = state.fiche;
  if (fiche?.position) {
    const e = fiche.row.etablissement;
    return {
      siret: e.siret,
      lat: Number(fiche.position.lat),
      lon: Number(fiche.position.lon),
      label: [e.nomAffiche, e.adresse].filter(Boolean).join(' — '),
    };
  }
  const siret = state.map?.getSelected();
  const row = siret ? state.rows.find((r) => r.etablissement.siret === siret) : null;
  if (row) {
    const known = state.positions.get(siret);
    const lat = Number(known?.lat ?? row.etablissement.latitude);
    const lon = Number(known?.lon ?? row.etablissement.longitude);
    if (isPlausibleFranceCoords(lat, lon)) {
      return {
        siret,
        lat,
        lon,
        label: [row.etablissement.nomAffiche, row.etablissement.adresse].filter(Boolean).join(' — '),
      };
    }
  }
  const center = state.map?.getCenter();
  if (center && isPlausibleFranceCoords(center.lat, center.lon)) {
    return { siret: null, lat: center.lat, lon: center.lon, label: 'Centre de la carte' };
  }
  return null;
}

function renderMapStreet() {
  const { loading, photos, index, target, error } = state.mapStreet;
  let status = 'loading';
  let message = 'Recherche d’une image de rue autour de ce point…';
  let photo = null;
  if (!loading) {
    if (error) {
      status = 'error';
      message = error;
    } else if (!photos.length) {
      status = 'empty';
      message = 'Aucune photographie de rue n’est disponible pour ce point. Élargissez le rayon de recherche dans les paramètres, déplacez la carte, ou revenez au plan.';
    } else {
      photo = images.streetPhotoView(photos[index], { index, total: photos.length });
      if (photo) {
        status = 'ready';
      } else {
        status = 'empty';
        message = 'La photographie reçue n’est pas affichable (URL non sûre ou absente). Aucune image de substitution n’est utilisée.';
      }
    }
  }
  ui.renderMapStreet(dom['map-street'], {
    status, photo, message, label: target?.label || '',
  });
  renderMapStreetCredits(status, photo);
}

/**
 * Le pied de carte reste visible sous la vue de rue : il doit donc décrire
 * l'image réellement affichée, jamais un fond de plan absent.
 */
function renderMapStreetCredits(status, photo) {
  const node = dom['map-credits'];
  if (!node) return;
  if (status === 'ready' && photo) {
    node.textContent = `Vue de rue — ${photo.credit || 'crédit non fourni par la source'}`;
  } else if (status === 'loading') {
    node.textContent = 'Vue de rue — recherche de la photographie…';
  } else {
    node.textContent = 'Vue de rue — aucune photographie affichée (pas d’image de substitution).';
  }
}

async function openMapStreet({ force = false } = {}) {
  const target = mapStreetTarget();
  if (state.mapStreet.creditsBackup == null && dom['map-credits']) {
    state.mapStreet.creditsBackup = dom['map-credits'].textContent;
  }
  state.mapStreet = { ...state.mapStreet, active: true, seq: (state.mapStreet.seq || 0) + 1 };
  const seq = state.mapStreet.seq;
  dom.baselayerButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.baselayer === MAP_STREET_KEY);
  });
  dom['map-street'].hidden = false;

  if (!target) {
    state.mapStreet = {
      ...state.mapStreet,
      active: true,
      loading: false,
      photos: [],
      index: 0,
      target: null,
      error: 'Sélectionnez un établissement — ou déplacez la carte sur l’adresse — pour afficher sa vue de rue.',
    };
    renderMapStreet();
    return;
  }

  const same = state.mapStreet.target
    && state.mapStreet.target.lat === target.lat
    && state.mapStreet.target.lon === target.lon;
  if (!force && same && (state.mapStreet.photos.length || state.mapStreet.error)) {
    renderMapStreet();
    return;
  }

  state.mapStreet = { ...state.mapStreet, active: true, loading: true, photos: [], index: 0, target, error: null };
  renderMapStreet();

  const current = settings.get();
  try {
    const result = await images.fetchStreetPhotos({
      lat: target.lat,
      lon: target.lon,
      radiusM: current.streetRadiusM,
      providers: current.streetProviders,
      limit: config.imagery.maxStreetPhotos,
    });
    if (!state.mapStreet.active || state.mapStreet.seq !== seq) return;
    state.mapStreet = { ...state.mapStreet, loading: false, photos: result.photos, index: 0, error: null };
  } catch (error) {
    if (!state.mapStreet.active || state.mapStreet.seq !== seq) return;
    state.mapStreet = { ...state.mapStreet, loading: false, photos: [], error: toUserMessage(error) };
  }
  renderMapStreet();
}

function closeMapStreet() {
  state.mapStreet = { ...state.mapStreet, active: false };
  if (dom['map-street']) dom['map-street'].hidden = true;
  if (dom['map-credits'] && state.mapStreet.creditsBackup != null) {
    dom['map-credits'].textContent = state.mapStreet.creditsBackup;
  }
  state.mapStreet.creditsBackup = null;
}

function stepMapStreet(delta) {
  const total = state.mapStreet.photos.length;
  if (!total) return;
  state.mapStreet.index = (state.mapStreet.index + delta + total) % total;
  renderMapStreet();
}

function applyBaseLayer(key) {
  // « Street View » n'est pas un fond de tuiles : c'est une image de rue
  // superposée à la carte, centrée sur l'établissement affiché.
  if (key === MAP_STREET_KEY) {
    openMapStreet();
    return;
  }
  closeMapStreet();
  const applied = state.map?.setBaseLayer(key);
  dom.baselayerButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.baselayer === applied));
}

/* ==================================================================== */
/* 6. Câblage des événements                                             */
/* ==================================================================== */

function wireEvents() {
  dom['search-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    doSearch({ page: 1 });
  });

  dom['search-form'].addEventListener('reset', () => {
    setTimeout(() => {
      setFormError('');
      state.rows = [];
      state.result = null;
      state.criteria = null;
      state.selectedSiret = null;
      state.fiche = null;
      state.positions.clear();
      destroyAerial();
      dom['detail-card'].hidden = true;
      dom['results-list'].replaceChildren();
      dom['results-list'].append(ui.emptyState({
        iconName: 'search',
        title: 'Nouvelle recherche',
        message: 'Saisissez un nom, un code postal, une ville ou un SIREN/SIRET. Les données proviennent de l\'API officielle Recherche d\'entreprises.',
      }));
      dom['results-summary'].textContent = 'Aucune recherche effectuée.';
      dom['viewbar-count'].textContent = '0';
      dom['btn-export-results'].disabled = true;
      dom['btn-export-geojson'].disabled = true;
      dom.pagination.hidden = true;
      ui.renderNotices(dom['results-notice'], []);
      state.map?.setRows([]);
      state.map?.fitAll();
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      setView('results');
    }, 0);
  });

  dom['champ-cp'].addEventListener('input', (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^0-9AB]/g, '').slice(0, 5);
  });
  dom['champ-identifiant'].addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/[^0-9\s]/g, '').slice(0, 20);
  });

  dom.examples.forEach((button) => {
    button.addEventListener('click', () => {
      writeForm({ nom: button.dataset.nom || '', codePostal: button.dataset.cp || '' });
      doSearch({ page: 1 });
    });
  });

  dom['champ-tri'].addEventListener('change', (event) => {
    settings.set({ sort: event.target.value });
    if (state.result) {
      // Re-tri local : aucun nouvel appel API.
      state.rows = sortRows(state.rows, event.target.value, state.criteria || {});
      renderResultsView();
    }
  });

  dom['champ-etat'].addEventListener('change', (event) => {
    settings.set({ etat: event.target.value });
    if (state.criteria) doSearch({ page: 1, criteria: state.criteria });
  });

  dom['btn-export-results'].addEventListener('click', () => {
    const { filename, count } = exporter.exportResultsCsv(state.rows, state.criteria || {});
    ui.toast(`${count} ligne(s) exportée(s) : ${filename}`, 'success');
  });

  dom['btn-export-geojson'].addEventListener('click', () => {
    const { filename, count } = exporter.exportResultsGeoJson(state.rows, state.positions, state.criteria || {});
    ui.toast(count ? `${count} point(s) exporté(s) : ${filename}` : 'Aucun établissement géolocalisé à exporter.', count ? 'success' : 'warning');
  });

  dom['btn-export-favorites'].addEventListener('click', () => {
    const { count, filename } = exporter.exportFavoritesJson();
    ui.toast(count ? `${count} fiche(s) exportée(s) : ${filename}` : 'Aucune fiche enregistrée.', count ? 'success' : 'warning');
  });

  dom.baselayerButtons.forEach((button) => {
    button.addEventListener('click', () => applyBaseLayer(button.dataset.baselayer));
  });

  dom['map-street-prev'].addEventListener('click', () => stepMapStreet(-1));
  dom['map-street-next'].addEventListener('click', () => stepMapStreet(1));
  dom['map-street-close'].addEventListener('click', () => {
    const previous = state.map?.getBaseLayer() || settings.get().defaultBaseLayer || config.map.defaultBaseLayer;
    applyBaseLayer(previous);
  });

  dom['btn-recenter'].addEventListener('click', () => {
    if (state.fiche?.position) {
      state.map?.select(state.selectedSiret, { position: state.fiche.position, pan: true, openPopup: false });
    } else {
      state.map?.fitAll();
    }
  });

  dom['btn-copy-gps'].addEventListener('click', async () => {
    const position = state.fiche?.position;
    const { copyText } = await import('./utils.js');
    if (!position) { ui.toast('Aucune coordonnée à copier.', 'warning'); return; }
    const ok = await copyText(formatCoords(position.lat, position.lon));
    ui.toast(ok ? 'Coordonnées GPS copiées.' : 'Copie impossible sur ce navigateur.', ok ? 'success' : 'error');
  });

  dom['btn-fullscreen'].addEventListener('click', () => {
    mapModule.toggleFullscreen(dom['map-card'], state.map, dom['btn-fullscreen']);
  });

  dom.viewbarButtons.forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.view));
  });

  dom['btn-settings'].addEventListener('click', openSettings);
  dom['btn-history'].addEventListener('click', () => openHistory());
  dom['btn-recheck'].addEventListener('click', () => checkServices());

  dom['btn-status'].addEventListener('click', () => {
    const panel = dom['status-panel'];
    panel.hidden = !panel.hidden;
    dom['btn-status'].setAttribute('aria-expanded', String(!panel.hidden));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      dom['champ-nom'].focus();
    }
  });

  window.addEventListener('hashchange', () => {
    const match = window.location.hash.match(/^#\/etablissement\/(\d{14})$/);
    if (match && match[1] !== state.selectedSiret) selectEtablissement(match[1]);
  });

  window.addEventListener('resize', debounce(() => {
    state.map?.invalidate();
    state.aerial?.invalidate();
  }, 200));

  window.addEventListener('online', () => { ui.toast('Connexion rétablie.', 'success'); checkServices(); });
  window.addEventListener('offline', () => ui.toast('Connexion Internet perdue : les API ne répondront pas.', 'error', 6000));
}

/* ==================================================================== */
/* 7. Démarrage                                                          */
/* ==================================================================== */

async function boot() {
  cacheDom();
  ui.initUi();

  const current = settings.get();
  dom['champ-tri'].value = current.sort;
  dom['champ-etat'].value = current.etat;

  dom['results-list'].append(ui.emptyState({
    iconName: 'search',
    title: 'Recherchez une entreprise française',
    message: 'Nom + code postal, ville seule, code postal seul ou SIREN/SIRET. Les résultats proviennent de l\'API officielle Recherche d\'entreprises, les coordonnées de la Base Adresse Nationale et de SIRENE.',
  }));

  loadLabels().catch(() => { /* libellés optionnels */ });

  try {
    state.map = await mapModule.createMap({
      container: dom.map,
      overlay: dom['map-overlay'],
      readout: dom['map-readout'],
      credits: dom['map-credits'],
      onMarkerSelect: (siret, options) => selectEtablissement(siret, options),
    });
    applyBaseLayer(current.defaultBaseLayer);
  } catch (error) {
    dom['boot-error'].hidden = false;
    dom['boot-error'].textContent = `Carte indisponible : ${toUserMessage(error)} — Servez le dossier avec « node server.js » ou « python -m http.server » plutôt que d'ouvrir le fichier en double-cliquant.`;
  }

  wireEvents();

  // Le chemin réseau (proxy local ou appel direct) est décidé avant tout appel.
  await detectProxy();
  images.detectMapillaryAccess().then((access) => { state.mapillaryAccess = access; });
  streetview.detectGoogleStreetView().then((google) => { state.googleStreetView = google; });
  checkServices();

  const match = window.location.hash.match(/^#\/etablissement\/(\d{14})$/);
  if (match) selectEtablissement(match[1]);

  // Démarrage réussi : désarme le chien de garde de js/boot.js.
  window.__companyLocatorReady = true;
}

boot().catch((error) => {
  const banner = document.getElementById('boot-error');
  if (banner) {
    banner.hidden = false;
    banner.textContent = `Erreur au démarrage : ${toUserMessage(error)}`;
  }
  console.error('[Company Locator] Échec du démarrage', error);
});
