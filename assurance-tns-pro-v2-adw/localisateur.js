/* localisateur.js — Étape « Localisez votre entreprise » du formulaire.
 *
 * Remplace l'ancien module de localisation : au lieu d'une carte maison, le
 * formulaire intègre le LOCALISATEUR D'ENTREPRISES (`company-locator/`) dans
 * une iframe, à l'étape qui suit le nom de société et le code postal.
 *
 * Fonctionnement :
 *  1. à l'affichage de l'étape, le localisateur est chargé avec `?embed=1`
 *     accompagné du nom de société et du code postal saisis ;
 *  2. le localisateur cherche tout seul, affiche les résultats, la carte et
 *     la vue de rue ;
 *  3. la personne sélectionne son établissement et clique sur
 *     « Utiliser cette entreprise » ;
 *  4. la fiche choisie revient ici par `postMessage` : elle remplit les champs
 *     cachés du formulaire (adresse, ville, SIRET, GPS…) et le récapitulatif.
 *
 * Aucune clé d'API, aucun traceur. Si l'iframe ne peut pas fonctionner
 * (formulaire ouvert en file://, dossier absent du serveur), un message clair
 * et un lien direct sont proposés — le reste du formulaire reste utilisable.
 *
 * API publique : window.LocalisateurEntreprise
 */
(function () {
  'use strict';

  var SOURCE = 'company-locator';
  var PARENT_SOURCE = 'tns-form';
  var CONFIG = window.LOCALISATEUR_CONFIG || {};
  var READY_TIMEOUT_MS = Number(CONFIG.readyTimeoutMs) > 0 ? Number(CONFIG.readyTimeoutMs) : 9000;

  var rootEl = null;
  var stepEl = null;
  var formEl = null;
  var frameEl = null;
  var ui = {};
  var state = {
    loading: false,
    ready: false,
    failed: false,
    results: 0,
    selection: null,
    lastQuery: '',
    allowNext: false
  };
  var hiddenWrap = null;
  var readyTimer = null;
  var observer = null;

  /* ------------------------------------------------------------------ */
  /* 1. Utilitaires                                                      */
  /* ------------------------------------------------------------------ */

  function log() {
    if (window.console && window.console.debug) {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[localisateur]');
      window.console.debug.apply(window.console, args);
    }
  }

  function trim(value) {
    return String(value == null ? '' : value).trim();
  }

  function field(name) {
    if (!formEl) return null;
    return formEl.querySelector('[name="' + name + '"]');
  }

  function fieldValue(name) {
    var input = field(name);
    return input ? trim(input.value) : '';
  }

  function setFieldValue(name, value) {
    var input = field(name);
    if (!input) return;
    input.value = value == null ? '' : String(value);
  }

  function setStatus(message, tone) {
    if (!ui.status) return;
    ui.status.textContent = message || '';
    ui.status.setAttribute('data-tone', tone || '');
  }

  function stepVisible() {
    if (!stepEl) return false;
    if (!stepEl.getClientRects().length) return false;
    return stepEl.offsetParent !== null || window.getComputedStyle(stepEl).position === 'fixed';
  }

  /* ------------------------------------------------------------------ */
  /* 2. Champs cachés et récapitulatif                                   */
  /* ------------------------------------------------------------------ */

  var HIDDEN_FIELDS = [
    'loc_entreprise', 'loc_siret', 'loc_siren', 'loc_adresse', 'loc_code_postal',
    'loc_commune', 'loc_latitude', 'loc_longitude', 'loc_precision', 'loc_source',
    'loc_naf', 'loc_page'
  ];

  function ensureHiddenFields() {
    if (hiddenWrap || !formEl) return;
    hiddenWrap = document.createElement('div');
    hiddenWrap.className = 'loc-hidden-fields';
    hiddenWrap.setAttribute('aria-hidden', 'true');
    hiddenWrap.style.display = 'none';
    HIDDEN_FIELDS.forEach(function (name) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = '';
      hiddenWrap.appendChild(input);
    });
    formEl.appendChild(hiddenWrap);
  }

  function syncHiddenFields(selection) {
    ensureHiddenFields();
    var data = selection || {};
    var values = {
      loc_entreprise: data.nom || '',
      loc_siret: data.siret || '',
      loc_siren: data.siren || '',
      loc_adresse: data.adresseComplete || data.adresse || '',
      loc_code_postal: data.codePostal || '',
      loc_commune: data.commune || '',
      loc_latitude: data.latitude == null ? '' : String(data.latitude),
      loc_longitude: data.longitude == null ? '' : String(data.longitude),
      loc_precision: data.precision || '',
      loc_source: data.source || '',
      loc_naf: data.naf || '',
      loc_page: data.pageUrl || ''
    };
    Object.keys(values).forEach(function (name) { setFieldValue(name, values[name]); });

    /* Les colonnes historiques du formulaire (adresse, ville) sont conservées
       pour les intégrations existantes, mais ne sont plus saisies à la main. */
    setFieldValue('adresse', data.adresse || '');
    setFieldValue('ville', data.commune || '');
  }

  function renderRecap(selection) {
    if (!ui.recap) return;
    if (!selection || !selection.siret) {
      ui.recap.hidden = true;
      return;
    }
    ui.recap.hidden = false;
    ui.recapTitle.textContent = selection.nom || 'Entreprise sélectionnée';
    ui.recapAddress.textContent = selection.adresseComplete || selection.adresse || '';
    var bits = [];
    if (selection.siret) bits.push('SIRET ' + selection.siret);
    if (selection.naf) bits.push('NAF ' + selection.naf);
    bits.push(selection.latitude == null
      ? 'Position GPS non disponible'
      : 'GPS ' + Number(selection.latitude).toFixed(5) + ', ' + Number(selection.longitude).toFixed(5));
    ui.recapMeta.textContent = bits.join(' · ');
  }

  /* ------------------------------------------------------------------ */
  /* 3. Iframe et messages                                               */
  /* ------------------------------------------------------------------ */

  /* Le localisateur doit toujours s'ouvrir en mode intégré. */
  function withEmbedFlag(url) {
    if (/[?&]embed=1(&|$)/.test(url)) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'embed=1';
  }

  function frameUrl() {
    if (!frameEl) return '';
    /* `frameSrc` permet de pointer vers un localisateur hébergé ailleurs
       (sous-domaine, CDN) sans modifier le HTML. */
    var base = trim(CONFIG.frameSrc) || frameEl.getAttribute('data-src') || frameEl.getAttribute('src') || '';
    if (!base) return '';
    var url = withEmbedFlag(base.split('#')[0]);
    var params = [];
    var nom = fieldValue('societe');
    var cp = fieldValue('code_postal');
    if (nom) params.push('nom=' + encodeURIComponent(nom));
    if (cp) params.push('cp=' + encodeURIComponent(cp));
    if (params.length) url += (url.indexOf('?') === -1 ? '?' : '&') + params.join('&');
    return url;
  }

  function updateFallbackLink() {
    if (!ui.fallbackLink) return;
    var url = frameUrl();
    ui.fallbackLink.setAttribute('href', url || '../company-locator/index.html');
    ui.fallbackLink.setAttribute('data-ready-url', url || '');
  }

  function startReadyTimer() {
    window.clearTimeout(readyTimer);
    readyTimer = window.setTimeout(function () {
      if (state.ready || state.failed) return;
      fail('Le localisateur met trop de temps à répondre. Vérifiez votre connexion, ou ouvrez-le dans un nouvel onglet.');
    }, READY_TIMEOUT_MS);
  }

  function fail(message) {
    state.failed = true;
    state.loading = false;
    if (ui.loading) ui.loading.hidden = true;
    if (ui.fallback) ui.fallback.hidden = false;
    if (ui.fallbackText) ui.fallbackText.textContent = message;
    updateFallbackLink();
    setStatus(message, 'error');
  }

  function loadFrame(force) {
    if (!frameEl) return;
    var url = frameUrl();
    if (!url) return;
    if (!force && frameEl.getAttribute('src') === url) return;
    state.loading = true;
    state.failed = false;
    state.ready = false;
    state.lastQuery = querySignature();
    if (ui.loading) ui.loading.hidden = false;
    if (ui.fallback) ui.fallback.hidden = true;
    updateFallbackLink();
    setStatus('Chargement du localisateur…', 'loading');
    frameEl.setAttribute('src', url);
    startReadyTimer();
  }

  function querySignature() {
    return trim(fieldValue('societe')).toLowerCase() + '|' + trim(fieldValue('code_postal')).toLowerCase();
  }

  function postToFrame(message) {
    if (!frameEl || !frameEl.contentWindow) return false;
    try {
      frameEl.contentWindow.postMessage(message, '*');
      return true;
    } catch (error) {
      log('Envoi au localisateur impossible', error && error.message);
      return false;
    }
  }

  /* Nouvelle recherche : l'entreprise précédemment choisie ne correspond plus
     au nom ou au code postal saisi, on repart d'une sélection vide. */
  function clearSelection() {
    if (!state.selection) return;
    state.selection = null;
    syncHiddenFields(null);
    renderRecap(null);
    if (ui.nextBtn) ui.nextBtn.classList.add('is-blocked');
  }

  function requestSearch() {
    var nom = fieldValue('societe');
    var cp = fieldValue('code_postal');
    var signature = querySignature();
    if (signature !== state.lastQuery) clearSelection();
    state.lastQuery = signature;
    postToFrame({
      source: PARENT_SOURCE,
      type: 'locator:search',
      payload: { nom: nom, codePostal: cp }
    });
    setStatus(nom || cp
      ? 'Recherche de « ' + (nom || cp) + ' » dans le localisateur…'
      : 'Renseignez le nom de votre société et son code postal à l’étape précédente.', nom || cp ? 'loading' : '');
  }

  function onMessage(event) {
    if (!frameEl || event.source !== frameEl.contentWindow) return;
    var data = event.data;
    if (!data || typeof data !== 'object' || data.source !== SOURCE) return;

    if (data.type === 'locator:ready') {
      window.clearTimeout(readyTimer);
      state.ready = true;
      state.loading = false;
      state.failed = false;
      if (ui.loading) ui.loading.hidden = true;
      if (ui.fallback) ui.fallback.hidden = true;
      requestSearch();
      return;
    }

    if (data.type === 'locator:results') {
      var count = data.payload && typeof data.payload.count === 'number' ? data.payload.count : 0;
      state.results = count;
      if (!state.selection) {
        setStatus(count
          ? count + (count > 1 ? ' établissements trouvés' : ' établissement trouvé')
            + ' — sélectionnez le vôtre puis cliquez sur « Utiliser cette entreprise ».'
          : 'Aucun établissement trouvé avec ce nom et ce code postal. Vérifiez la saisie, ou utilisez le localisateur pour élargir la recherche.',
          count ? 'ok' : 'error');
      }
      return;
    }

    if (data.type === 'locator:error') {
      setStatus((data.payload && data.payload.message) || 'La recherche n’a pas abouti.', 'error');
      return;
    }

    if (data.type === 'locator:selected') {
      applySelection(data.payload || {});
      return;
    }
  }

  function applySelection(selection) {
    if (!selection || !selection.siret) return;
    state.selection = selection;
    state.failed = false;
    syncHiddenFields(selection);
    renderRecap(selection);
    if (ui.gate) ui.gate.hidden = true;
    setStatus('Entreprise sélectionnée : ' + (selection.nom || selection.siret)
      + '. Vous pouvez continuer.', 'ok');
    if (ui.nextBtn) ui.nextBtn.classList.remove('is-blocked');
    try {
      document.dispatchEvent(new CustomEvent('localisateur:selected', { detail: selection }));
    } catch (error) {
      log('Événement localisateur:selected non émis', error && error.message);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 4. Navigation et garde-fou                                          */
  /* ------------------------------------------------------------------ */

  function onNextClick(event) {
    if (state.allowNext || state.selection) return;
    /* Rien de sélectionné : on explique au lieu de bloquer sèchement. */
    event.preventDefault();
    event.stopPropagation();
    state.allowNext = false;
    if (ui.gate) ui.gate.hidden = false;
    if (ui.gateText) {
      ui.gateText.textContent = state.failed || !state.ready
        ? 'Le localisateur n’est pas disponible : ouvrez-le dans un onglet, ou continuez sans localisation.'
        : 'Sélectionnez votre entreprise dans le localisateur pour continuer.';
    }
    setStatus('Sélectionnez votre entreprise, ou choisissez de renseigner ces informations plus tard.', 'error');
    if (ui.nextBtn) ui.nextBtn.classList.add('is-blocked');
    if (ui.gate && ui.gate.focus) ui.gate.focus();
  }

  function skipValidation() {
    state.allowNext = true;
    if (ui.gate) ui.gate.hidden = true;
    setStatus('Vous pourrez préciser la localisation plus tard ; votre demande peut être envoyée.', 'ok');
    if (ui.nextBtn) {
      ui.nextBtn.classList.remove('is-blocked');
      ui.nextBtn.click();
    }
  }

  /* ------------------------------------------------------------------ */
  /* 5. Cycle de vie                                                     */
  /* ------------------------------------------------------------------ */

  function watchStep() {
    if (typeof MutationObserver === 'undefined' || !formEl) return;
    observer = new MutationObserver(function () { syncVisibility(); });
    observer.observe(formEl, { attributes: true, attributeFilter: ['style', 'class', 'hidden'], subtree: true });
  }

  var wasVisible = false;

  function syncVisibility(force) {
    var visible = stepVisible();
    if (visible) {
      var signature = querySignature();
      if (!state.ready && !state.loading && !state.failed) loadFrame();
      else if (state.ready && signature !== state.lastQuery && (fieldValue('societe') || fieldValue('code_postal'))) {
        requestSearch();
      }
      if (force || !wasVisible) updateFallbackLink();
    }
    wasVisible = visible;
  }

  function collectUi() {
    ui.status = rootEl.querySelector('[data-loc-status]');
    ui.loading = rootEl.querySelector('[data-loc-loading]');
    ui.fallback = rootEl.querySelector('[data-loc-fallback]');
    ui.fallbackText = rootEl.querySelector('[data-loc-fallback-text]');
    ui.fallbackLink = rootEl.querySelector('[data-loc-fallback-link]');
    ui.recap = rootEl.querySelector('[data-loc-recap]');
    ui.recapTitle = rootEl.querySelector('[data-loc-recap-title]');
    ui.recapAddress = rootEl.querySelector('[data-loc-recap-address]');
    ui.recapMeta = rootEl.querySelector('[data-loc-recap-meta]');
    ui.gate = rootEl.querySelector('[data-loc-gate]');
    ui.gateText = rootEl.querySelector('[data-loc-gate-text]');
    ui.skipBtn = rootEl.querySelector('[data-loc-skip]');
    ui.nextBtn = rootEl.querySelector('[data-form="next-btn"]');
    frameEl = rootEl.querySelector('[data-loc-app]') || document.getElementById('loc-app');
  }

  function bindHandlers() {
    window.addEventListener('message', onMessage);

    if (frameEl) {
      frameEl.addEventListener('load', function () {
        /* Une iframe qui charge mais ne répond pas (modules ES bloqués en
           file://) est détectée par la minuterie de démarrage. */
        if (!state.ready) startReadyTimer();
      });
    }

    if (ui.nextBtn) ui.nextBtn.addEventListener('click', onNextClick, true);
    if (ui.skipBtn) ui.skipBtn.addEventListener('click', skipValidation);

    /* Le nom ou le code postal a changé : on relance la recherche dès que
       l'étape est de nouveau affichée. */
    if (formEl) {
      ['societe', 'code_postal'].forEach(function (name) {
        var input = field(name);
        if (!input) return;
        input.addEventListener('change', function () {
          /* Après un échec (réseau, serveur absent), une nouvelle saisie
             relance le chargement du localisateur. */
          if (state.failed) {
            state.failed = false;
            if (stepVisible()) loadFrame(true);
            return;
          }
          if (!state.ready) return;
          if (querySignature() !== state.lastQuery) requestSearch();
        });
      });
    }

    window.addEventListener('resize', function () {
      if (stepVisible() && frameEl) frameEl.setAttribute('data-visible', '1');
    });

    if (formEl) {
      formEl.addEventListener('submit', function () {
        window.setTimeout(function () { syncHiddenFields(state.selection); }, 0);
      });
    }
  }

  function getLeadFields() {
    var selection = state.selection;
    if (!selection) return {};
    return {
      loc_entreprise: selection.nom || '',
      loc_siret: selection.siret || '',
      loc_siren: selection.siren || '',
      loc_adresse: selection.adresseComplete || selection.adresse || '',
      loc_code_postal: selection.codePostal || '',
      loc_commune: selection.commune || '',
      loc_latitude: selection.latitude == null ? '' : String(selection.latitude),
      loc_longitude: selection.longitude == null ? '' : String(selection.longitude),
      loc_precision: selection.precision || '',
      loc_source: selection.source || '',
      loc_naf: selection.naf || '',
      loc_page: selection.pageUrl || ''
    };
  }

  function getRecap() {
    var selection = state.selection;
    if (!selection) return '';
    var lines = [];
    lines.push('Entreprise : ' + (selection.nom || '') + (selection.siret ? ' (SIRET ' + selection.siret + ')' : ''));
    if (selection.adresseComplete) lines.push('Adresse : ' + selection.adresseComplete);
    if (selection.latitude != null) {
      lines.push('GPS : ' + selection.latitude + ', ' + selection.longitude
        + (selection.precision ? ' (' + selection.precision + ')' : ''));
    }
    return lines.filter(Boolean).join('\n');
  }

  function init() {
    rootEl = document.getElementById('loc-section');
    if (!rootEl) return;
    stepEl = rootEl.closest ? rootEl.closest('[data-form="step"]') : null;
    formEl = rootEl.closest ? rootEl.closest('form') : null;

    collectUi();
    ensureHiddenFields();
    bindHandlers();
    watchStep();
    syncVisibility(true);
    window.setTimeout(function () { syncVisibility(); }, 400);

    /* API publique (intégrations et tests) */
    window.LocalisateurEntreprise = {
      version: '2.0.0',
      isAvailable: function () { return !!frameEl; },
      isReady: function () { return state.ready; },
      isFailed: function () { return state.failed; },
      isValidated: function () { return !!state.selection; },
      getSelection: function () { return state.selection ? JSON.parse(JSON.stringify(state.selection)) : null; },
      getLeadFields: getLeadFields,
      getRecap: getRecap,
      getFrameUrl: frameUrl,
      load: function (force) { loadFrame(force !== false); },
      search: function () { requestSearch(); },
      select: function (payload) { applySelection(payload || {}); },
      reset: function () {
        state.selection = null;
        state.allowNext = false;
        syncHiddenFields(null);
        renderRecap(null);
        if (ui.gate) ui.gate.hidden = true;
        setStatus('', '');
      }
    };

    log('Étape localisateur initialisée');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
