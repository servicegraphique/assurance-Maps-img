/* =====================================================================
   lead-handler.js - Véhicules de société : soumission autonome alignee sur la
   LP de reference "assurance-consultant-conseil-v2" (production).
   ---------------------------------------------------------------------
   - CRM production HelloLead : enveloppe { payload: { formId, id,
     data } }, transport "nocors" (sendBeacon/fetch text/plain) ou "cors".
   - Google Sheets (Apps Script partage AGV/AMR) : champs plats
     form-urlencoded, reponse status:"ok" verifiee, mapping
     q1-q3 + solution + enjeu (recap autre_info_fj construit par scan
     generique des questions/reponses du formulaire).
   - Honeypot anti-spam "website" : rempli = succes affiche, 0 envoi.
   - Tracking URL (alias utm_ / ltm_, hash inclus), persistance
     sessionStorage, FILTRE PAR CONSENTEMENT (banniere existante,
     cookie "user_cookie_preferences") : analytics = utm/ltm/page_url,
     marketing = click IDs + user_data (conversions ameliorees).
   - Pont iframe Webflow pour landing-url apres consentement ; verification
     SMS par le module separe verification-sms.js (appel direct a l'API).
   - Interception de l'envoi simule jQuery (Formly $form.submit()) +
     capture native. APIs QA : window.lpLead, window.lpTracking.
   ===================================================================== */
var UBE_CONFIG = {
  leadApiUrl: 'https://mc.hellolead.pro/mon_compte/api/webflow/get_information.php',
  leadApiMode: 'nocors',
  leadApiCredentials: 'omit',
  googleScriptUrl: 'https://script.google.com/macros/s/AKfycbwrbyCb9-cAmIRPGNvnb-aM-CkhQAerrkfP3_HSw-ewmThxsn4vbZt5daaq2aOnL01a1w/exec',
  sheetTimeoutMs: 15000,
  formId: 'ADW_LP_ASSURANCE_TNS_PRO',          // a confirmer/enregistrer cote CRM
  formName: 'Assurance-TNS-Pro-Form',
  source: 'LP TNS PRO',   // source de secours sans campagne
  microField: 'reponse_3',  // champ radio auto-entrepreneur ('' = aucun)
  publicLandingPath: '',
  debug: false
};

(function () {
  'use strict';
  var form = document.querySelector('form[data-ubepro-lead="1"]');
  if (!form) return;
  var CONFIG = Object.assign({}, UBE_CONFIG, window.UBE_CONFIG_OVERRIDE || {});
  var VERSION = '2026-10-27-ubepro.fonctionnel2-sms1';
  var wrap = form.parentElement;
  /* Noms de champs variables selon les formulaires Webflow ('telephone-2', 'Nom 2', 'Email'...) :
     resolution par nom normalise (minuscules, sans accents ni separateurs, suffixe numerique tolere) */
  var FIELD_ALIASES = {
    nom: ['nom'], prenom: ['prenom'], mail: ['mail', 'email'],
    telephone: ['telephone', 'phone', 'tel'], societe: ['societe', 'entreprise'],
    code_postal: ['codepostal', 'cp'], ville: ['ville'], civilite: ['civilite'], siret: ['siret']
  };
  function normaliseNom(n) {
    var s = String(n || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s.replace(/[\s_-]+/g, '');
  }
  function nomCorrespond(n, aliases) {
    for (var j = 0; j < aliases.length; j++) {
      if (n === aliases[j]) return true;
      if (n.indexOf(aliases[j]) === 0 && /^\d+$/.test(n.slice(aliases[j].length))) return true;
    }
    return false;
  }
  function fieldEl(name) {
    var aliases = FIELD_ALIASES[name];
    if (!aliases) return form.querySelector('[name="' + name + '"]');
    var els = form.querySelectorAll('[name]');
    for (var i = 0; i < els.length; i++) {
      if (nomCorrespond(normaliseNom(els[i].name), aliases)) return els[i];
    }
    return null;
  }
  // Conserver la catégorie métier initiale, sans reprendre une campagne non consentie.
  var categoryField = fieldEl('categorie');
  var initialCategory = categoryField ? String(categoryField.defaultValue || '').trim() : '';
  var phone = fieldEl('telephone');
  var btn = form.querySelector('.bouton-valider') || form.querySelector('[data-form="submit-btn"]') || form.querySelector('input[type="submit"]');
  var done = wrap ? wrap.querySelector('.w-form-done') : null;
  var fail = wrap ? wrap.querySelector('.w-form-fail') : null;
  var BTN_TEXT = btn ? (btn.tagName === 'A' || btn.tagName === 'BUTTON' ? btn.textContent.trim() : btn.value) : 'Valider';
  if (fail) fail.style.display = 'none';

  var TRACKING_KEY = 'lp_tracking_v1';
  var PAGE_URL_KEY = 'lp_tracking_page_url_v1';
  var PARENT_URL_KEY = 'lp_public_landing_url_v1';
  var PARENT_BRIDGE_CHANNEL = 'ubepro-assurance-v1';
  var ALLOWED_PARENT_ORIGINS = ['https://www.comparateurpro.fr'];
  var parentBridgeNonce = '';
  var sending = false;
  var submissionId = makeId();

  var TRACKING_DEFS = [
    { key: 'source', aliases: ['ltm_source', 'utm_source', 'source'] },
    { key: 'categorie', aliases: ['categorie', 'utm_category', 'ltm_category', 'category'] },
    { key: 'user', aliases: ['user', 'utm_user', 'ltm_user'] },
    { key: 'utm_source', aliases: ['utm_source', 'ltm_source', 'source'] },
    { key: 'utm_medium', aliases: ['utm_medium', 'medium'] },
    { key: 'utm_campaign', aliases: ['utm_campaign', 'campaign'] },
    { key: 'utm_content', aliases: ['utm_content', 'content'] },
    { key: 'utm_term', aliases: ['utm_term', 'term'] },
    { key: 'utm_id', aliases: ['utm_id', 'campaign_id'] },
    { key: 'utm_category', aliases: ['utm_category', 'ltm_category', 'categorie', 'category'] },
    { key: 'utm_user', aliases: ['utm_user', 'ltm_user', 'user'] },
    { key: 'ltm_source', aliases: ['ltm_source', 'utm_source', 'source'] },
    { key: 'ltm_category', aliases: ['ltm_category', 'utm_category', 'categorie', 'category'] },
    { key: 'ltm_typ', aliases: ['ltm_typ', 'utm_typ', 'typ'] },
    { key: 'ltm_user', aliases: ['ltm_user', 'utm_user', 'user'] },
    { key: 'gclid', aliases: ['gclid'] },
    { key: 'gbraid', aliases: ['gbraid'] },
    { key: 'wbraid', aliases: ['wbraid'] },
    { key: 'msclkid', aliases: ['msclkid'] },
    { key: 'fbclid', aliases: ['fbclid'] },
    { key: 'ttclid', aliases: ['ttclid'] }
  ];
  var CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid', 'ttclid'];

  function clean(value, limit) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit || 500);
  }
  function cleanParam(value) { return clean(value, 500).replace(/[<>]/g, ''); }
  function debugLog() {
    if (CONFIG.debug && window.console && console.log) {
      console.log.apply(console, ['[lp lead]'].concat([].slice.call(arguments)));
    }
  }
  function makeId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  /* ================= Consentement (banniere existante) ================= */
  function lireCookie(nom) {
    try {
      var parts = document.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p.indexOf(nom + '=') === 0) {
          var v = p.slice(nom.length + 1);
          try { return decodeURIComponent(v); } catch (e) { return v; }
        }
      }
    } catch (e) {}
    return '';
  }
  function lirePreferences() {
    try {
      var brut = lireCookie('user_cookie_preferences');
      if (brut) {
        var p = JSON.parse(brut);
        return { necessary: true, analytics: p.analytics === true, marketing: p.marketing === true, choiceMade: true };
      }
    } catch (e) {}
    try {
      var saved = localStorage.getItem('ubeproCookiePreferencesV1');
      if (saved) {
        var parsed = JSON.parse(saved);
        return { necessary: true, analytics: parsed.analytics === true, marketing: parsed.marketing === true, choiceMade: true };
      }
      var legacy = localStorage.getItem('cookiesChoice');
      if (legacy === 'accept') return { necessary: true, analytics: true, marketing: true, choiceMade: true };
      if (legacy === 'refuse') return { necessary: true, analytics: false, marketing: false, choiceMade: true };
    } catch (e) {}
    return { necessary: true, analytics: false, marketing: false, choiceMade: false };
  }
  var preferences = lirePreferences();
  function analyticsGranted() { return preferences.analytics === true; }
  function marketingGranted() { return preferences.marketing === true; }
  function trackingGranted() { return analyticsGranted() || marketingGranted(); }
  function trackingKeyGranted(key) {
    return CLICK_IDS.indexOf(key) !== -1 ? marketingGranted() : analyticsGranted();
  }
  function rafraichirConsentement() {
    preferences = lirePreferences();
    purgeUnconsentedTracking();
    captureTracking(entryUrl);
    captureTracking(window.location.href);
  }

  /* ================= Tracking URL ================= */
  function parseUrlParams(rawUrl) {
    var params = Object.create(null);
    try {
      var url = new URL(rawUrl || window.location.href, window.location.href);
      function collect(search) {
        new URLSearchParams(search || '').forEach(function (value, key) {
          var k = String(key).trim().toLowerCase();
          var v = cleanParam(value);
          if (k && v) params[k] = v;
        });
      }
      collect(url.search);
      var hash = url.hash.slice(1);
      var hi = hash.indexOf('?');
      collect(hi >= 0 ? hash.slice(hi + 1) : (hash.indexOf('=') >= 0 && hash.charAt(0) !== '/' ? hash : ''));
    } catch (e) {}
    return params;
  }
  function isAnalyticsUrlParam(key) {
    var n = String(key || '').toLowerCase();
    return /^(utm_|ltm_)/.test(n) ||
      ['source', 'categorie', 'category', 'medium', 'campaign', 'content', 'term', 'user', 'campaign_id'].indexOf(n) !== -1;
  }
  function filterUrlByConsent(rawUrl) {
    if (!trackingGranted()) return '';
    try {
      var url = new URL(String(rawUrl || ''));
      var keys = [];
      url.searchParams.forEach(function (v, k) { keys.push(k); });
      keys.forEach(function (key) {
        var n = key.toLowerCase();
        if (!analyticsGranted() && isAnalyticsUrlParam(n)) url.searchParams.delete(key);
        if (!marketingGranted() && CLICK_IDS.indexOf(n) !== -1) url.searchParams.delete(key);
      });
      return url.href.slice(0, 2000);
    } catch (e) { return ''; }
  }
  function safeReferrer() {
    try {
      var r = new URL(document.referrer);
      return clean(r.origin + r.pathname, 1000);
    } catch (e) { return ''; }
  }
  function isAllowedParentOrigin(origin) { return ALLOWED_PARENT_ORIGINS.indexOf(origin) !== -1; }
  function resolveParentOrigin() {
    try {
      var o = new URL(document.referrer).origin;
      if (isAllowedParentOrigin(o)) return o;
    } catch (e) {}
    return 'https://www.comparateurpro.fr';
  }
  var parentTargetOrigin = resolveParentOrigin();
  var entryUrl = typeof window.__UBE_ENTRY_URL__ === 'string' ? window.__UBE_ENTRY_URL__ : window.location.href;
  var parentLandingUrlReceived = window.parent === window;
  try {
    var initialEntry = new URL(entryUrl);
    if (isAllowedParentOrigin(initialEntry.origin) &&
        (!CONFIG.publicLandingPath || initialEntry.pathname.replace(/\/+$/, '') === CONFIG.publicLandingPath.replace(/\/+$/, ''))) {
      parentLandingUrlReceived = true;
    }
  } catch (e) {}

  function readStoredTracking() {
    if (!trackingGranted()) return {};
    try {
      var saved = JSON.parse(sessionStorage.getItem(TRACKING_KEY) || '{}');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
      var result = {};
      TRACKING_DEFS.forEach(function (def) {
        if (trackingKeyGranted(def.key) && typeof saved[def.key] === 'string') {
          var v = cleanParam(saved[def.key]);
          if (v) result[def.key] = v;
        }
      });
      return result;
    } catch (e) { return {}; }
  }
  var trackingValues = parentLandingUrlReceived ? readStoredTracking() : {};
  var trackedPageUrl = '';
  if (analyticsGranted() && parentLandingUrlReceived) {
    trackedPageUrl = clean(entryUrl, 1000);
    try {
      var savedPageUrl = sessionStorage.getItem(PAGE_URL_KEY);
      if (savedPageUrl && Object.keys(trackingValues).length) trackedPageUrl = clean(savedPageUrl, 1000);
    } catch (e) {}
  }
  function purgeUnconsentedTracking() {
    var retained = {};
    TRACKING_DEFS.forEach(function (def) {
      if (trackingKeyGranted(def.key) && trackingValues[def.key]) retained[def.key] = trackingValues[def.key];
    });
    trackingValues = retained;
    if (parentLandingUrlReceived && trackingGranted()) {
      var filtered = filterUrlByConsent(entryUrl);
      if (filtered) entryUrl = filtered;
    }
    try {
      if (Object.keys(retained).length) sessionStorage.setItem(TRACKING_KEY, JSON.stringify(retained));
      else sessionStorage.removeItem(TRACKING_KEY);
      if (analyticsGranted() && parentLandingUrlReceived) {
        trackedPageUrl = clean(filterUrlByConsent(entryUrl), 1000);
        if (trackedPageUrl) sessionStorage.setItem(PAGE_URL_KEY, trackedPageUrl);
      } else {
        trackedPageUrl = '';
        sessionStorage.removeItem(PAGE_URL_KEY);
      }
    } catch (e) {}
  }
  function captureTracking(rawUrl) {
    if (!trackingGranted()) return Object.assign({}, trackingValues);
    var params = parseUrlParams(rawUrl || window.location.href);
    var found = {};
    TRACKING_DEFS.forEach(function (def) {
      if (!trackingKeyGranted(def.key)) return;
      var alias = null;
      for (var i = 0; i < def.aliases.length; i++) {
        if (params[def.aliases[i]]) { alias = def.aliases[i]; break; }
      }
      if (alias) found[def.key] = params[alias];
    });
    if (Object.keys(found).length) {
      trackingValues = Object.assign({}, trackingValues, found);
      try { sessionStorage.setItem(TRACKING_KEY, JSON.stringify(trackingValues)); } catch (e) {}
      if (analyticsGranted()) {
        trackedPageUrl = clean(filterUrlByConsent(rawUrl || window.location.href), 1000);
        try { sessionStorage.setItem(PAGE_URL_KEY, trackedPageUrl); } catch (e) {}
      }
    }
    return Object.assign({}, trackingValues);
  }
  function getCurrentUrlCategory() {
    if (!analyticsGranted()) return '';
    var current = parseUrlParams(window.location.href);
    var entry = parseUrlParams(entryUrl);
    return current.categorie || current.utm_category || current.ltm_category || current.category ||
      entry.categorie || entry.utm_category || entry.ltm_category || entry.category || '';
  }
  function getTrackingPayload() {
    if (trackingGranted()) {
      captureTracking(entryUrl);
      captureTracking(window.location.href);
    }
    var result = {};
    TRACKING_DEFS.forEach(function (def) {
      result[def.key] = trackingKeyGranted(def.key) ? cleanParam(trackingValues[def.key] || '') : '';
    });
    return result;
  }
  function remplirChampsCaches() {
    var t = getTrackingPayload();
    Object.keys(t).forEach(function (k) {
      var input = form.querySelector('input[name="' + k + '"]');
      if (!input || !t[k]) return;
      if (input.value === '' || (k === 'source' && input.value === 'SOURCE PAR DEFAUT')) input.value = t[k];
    });
    var cat = getCurrentUrlCategory();
    var catField = form.querySelector('input[name="categorie"]');
    if (cat && catField && !catField.value) catField.value = cat;
    var pu = form.querySelector('input[name="page_url"]');
    if (pu) pu.value = analyticsGranted() && parentLandingUrlReceived ? clean(trackedPageUrl || entryUrl, 1000) : '';
    var rf = form.querySelector('input[name="referrer"]');
    if (rf && !rf.value) rf.value = safeReferrer();
  }
  purgeUnconsentedTracking();
  captureTracking(entryUrl);
  captureTracking(window.location.href);
  remplirChampsCaches();
  window.lpTracking = Object.freeze({
    version: VERSION,
    inspect: function () {
      return {
        version: VERSION,
        current_url: clean(entryUrl || window.location.href, 1000),
        page_url: analyticsGranted() ? clean(trackedPageUrl, 1000) : '',
        values: getTrackingPayload()
      };
    }
  });

  /* ================= Pont iframe Webflow (sans SMS) ================= */
  function parentBridgePost(message) {
    if (window.parent === window) return false;
    var payload = Object.assign({ channel: PARENT_BRIDGE_CHANNEL }, message || {});
    if (parentBridgeNonce && payload.type !== 'bridge-ready') payload.nonce = parentBridgeNonce;
    try { window.parent.postMessage(payload, parentTargetOrigin); return true; } catch (e) { return false; }
  }
  function sendConsentStateToParent() {
    if (!parentBridgeNonce) return;
    parentBridgePost({
      type: 'consent-state',
      choiceMade: !!preferences.choiceMade,
      analytics: analyticsGranted(),
      marketing: marketingGranted()
    });
  }
  function sanitizePublicLandingUrl(rawUrl) {
    if (!trackingGranted()) return '';
    try {
      var url = new URL(String(rawUrl || ''));
      if (!isAllowedParentOrigin(url.origin)) return '';
      if (CONFIG.publicLandingPath &&
          url.pathname.replace(/\/+$/, '') !== CONFIG.publicLandingPath.replace(/\/+$/, '')) return '';
      return filterUrlByConsent(url.href);
    } catch (e) { return ''; }
  }
  function applyPublicLandingUrl(rawUrl) {
    var publicUrl = sanitizePublicLandingUrl(rawUrl);
    if (!publicUrl) return;
    var priorUrl = '';
    try { priorUrl = sessionStorage.getItem(PARENT_URL_KEY) || ''; } catch (e) {}
    if (priorUrl !== publicUrl) {
      trackingValues = {};
      trackedPageUrl = '';
      try {
        sessionStorage.removeItem(TRACKING_KEY);
        sessionStorage.removeItem(PAGE_URL_KEY);
      } catch (e) {}
    }
    entryUrl = publicUrl;
    parentLandingUrlReceived = true;
    captureTracking(entryUrl);
    if (analyticsGranted()) {
      trackedPageUrl = clean(entryUrl, 1000);
      try { sessionStorage.setItem(PAGE_URL_KEY, trackedPageUrl); } catch (e) {}
    }
    try { sessionStorage.setItem(PARENT_URL_KEY, entryUrl); } catch (e) {}
    remplirChampsCaches();
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || !isAllowedParentOrigin(event.origin)) return;
    var message = event.data;
    if (!message || message.channel !== PARENT_BRIDGE_CHANNEL) return;
    if (message.type === 'bridge-init' && typeof message.nonce === 'string' && message.nonce.length >= 16) {
      parentBridgeNonce = message.nonce;
      rafraichirConsentement();
      sendConsentStateToParent();
      return;
    }
    if (!parentBridgeNonce || message.nonce !== parentBridgeNonce) return;
    if (message.type === 'landing-url') applyPublicLandingUrl(message.url);
  });
  if (window.parent !== window) parentBridgePost({ type: 'bridge-ready' });
  document.addEventListener('click', function (e) {
    var id = e.target && e.target.id;
    if (id === 'accept-all-banner-btn' || id === 'accept-all-modal-btn' ||
        id === 'refuse-all-modal-btn' || id === 'save-preferences-modal-btn' ||
        id === 'continue-without-accepting-btn') {
      window.setTimeout(function () {
        rafraichirConsentement();
        remplirChampsCaches();
        sendConsentStateToParent();
      }, 60);
    }
  });

  /* ================= Honeypot + champ recap ================= */
  var honeypot = form.querySelector('input[name="website"]');
  if (!honeypot) {
    honeypot = document.createElement('input');
    honeypot.type = 'text';
    honeypot.name = 'website';
    honeypot.tabIndex = -1;
    honeypot.autocomplete = 'off';
    honeypot.setAttribute('aria-hidden', 'true');
    honeypot.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
    form.appendChild(honeypot);
  }
  if (!form.querySelector('input[name="autre_info_fj"]')) {
    var recapHidden = document.createElement('input');
    recapHidden.type = 'hidden';
    recapHidden.name = 'autre_info_fj';
    form.appendChild(recapHidden);
  }

  /* ================= Lecture generique des reponses ================= */
  function textValue(name) {
    var f = fieldEl(name);
    return f ? String(f.value || '').trim() : '';
  }
  function champExiste(name) { return !!fieldEl(name); }
  function radioValue(name) {
    var f = form.querySelector('input[name="' + name + '"]:checked');
    if (f) return String(f.value || '').trim();
    var aliases = FIELD_ALIASES[name];
    if (!aliases) return '';
    var els = form.querySelectorAll('input:checked');
    for (var i = 0; i < els.length; i++) {
      if (nomCorrespond(normaliseNom(els[i].name), aliases)) return String(els[i].value || '').trim();
    }
    return '';
  }
  function libelleCase(input) {
    var n = input.name || '';
    var m = n.match(/^reponse_(\d+)_(\d+)$/);
    if (m) {
      var lib = textValue('reponse_lib_' + m[1] + '_' + m[2]);
      if (lib) return lib;
    }
    var lbl = input.closest ? input.closest('label') : null;
    var span = lbl ? lbl.querySelector('span') : null;
    return span ? span.textContent.trim() : String(input.value || n);
  }
  function reponseQuestion(num) {
    var checks = form.querySelectorAll('input[type="checkbox"][name^="reponse_' + num + '_"]:checked');
    if (checks.length) {
      var libs = [];
      for (var i = 0; i < checks.length; i++) libs.push(libelleCase(checks[i]));
      return libs.join(', ');
    }
    var radio = radioValue('reponse_' + num);
    var champs = form.querySelectorAll('[name="reponse_' + num + '"]');
    var textes = [];
    for (var j = 0; j < champs.length; j++) {
      var t = (champs[j].type || '').toLowerCase();
      if (t === 'radio' || t === 'checkbox' || t === 'hidden') continue;
      var v = String(champs[j].value || '').trim();
      if (v && textes.indexOf(v) === -1) textes.push(v);
    }
    // Certaines pages donnent le meme nom au choix radio et au champ libre.
    // Garder les deux si les deux ont ete saisis, au lieu de perdre le texte.
    if (radio && textes.indexOf(radio) === -1) textes.unshift(radio);
    return textes.join(' / ');
  }
  function numerosQuestions() {
    var nums = [];
    var fields = form.querySelectorAll('input[type="hidden"][name^="question_"]');
    for (var i = 0; i < fields.length; i++) {
      var m = (fields[i].name || '').match(/^question_(\d+)$/);
      if (m && nums.indexOf(m[1]) === -1) nums.push(m[1]);
    }
    nums.sort(function (a, b) { return parseInt(a, 10) - parseInt(b, 10); });
    return nums;
  }
  function normalizePhone(value) {
    var phone = String(value || '').trim().replace(/[\s().-]/g, '');
    if (/^\+?0033/.test(phone)) return '0' + phone.replace(/^\+?0033/, '').replace(/\D/g, '');
    if (/^\+33/.test(phone)) return '0' + phone.slice(3).replace(/\D/g, '');
    if (/^33\d{9}$/.test(phone)) return '0' + phone.slice(2);
    return phone.replace(/\D/g, '');
  }
  function currentPhone() { return normalizePhone(textValue('telephone')); }
  function versE164(digits) { return /^0[1-9]\d{8}$/.test(digits) ? '+33' + digits.slice(1) : digits; }
  function estMicro(data) {
    if (!CONFIG.microField) return false;
    return String(data[CONFIG.microField] || '').trim().toLowerCase() === 'oui';
  }

  function buildData() {
    rafraichirConsentement();
    var tracking = getTrackingPayload();
    var data = {
      nom: textValue('nom'),
      prenom: textValue('prenom'),
      mail: textValue('mail').toLowerCase(),
      telephone: currentPhone(),
      telephone_verifie: (window.smsVerification && window.smsVerification.estVerifie(currentPhone())) ? 'oui' : 'non',
      societe: textValue('societe'),
      code_postal: textValue('code_postal').replace(/\s+/g, '')
    };
    if (champExiste('ville')) data.ville = textValue('ville');
    if (champExiste('civilite')) data.civilite = radioValue('civilite') || textValue('civilite');
    if (champExiste('siret')) data.siret = textValue('siret');
    data.source = tracking.ltm_source || tracking.utm_source || tracking.source || CONFIG.source;
    data.categorie = analyticsGranted()
      ? (getCurrentUrlCategory() || textValue('categorie') || tracking.categorie || '')
      : initialCategory;
    data.coordonnee = textValue('coordonnee') || '1';
    data.consentement = String(radioValue('consentement')).toLowerCase() === 'oui' ? 'oui' : 'non';

    var recap = [];
    numerosQuestions().forEach(function (num) {
      var q = textValue('question_' + num);
      var r = reponseQuestion(num);
      data['question_' + num] = q;
      data['reponse_' + num] = r;
      if (r) recap.push(clean(q, 90).replace(/\?\s*$/, '') + ' : ' + r);
    });
    // Champs de precision (reponse_champ_N_M)
    var extras = form.querySelectorAll('[name^="reponse_champ_"]');
    for (var i = 0; i < extras.length; i++) {
      var en = extras[i].name;
      if (en.indexOf('reponse_champ_lib_') === 0) continue;
      var ev = String(extras[i].value || '').trim();
      data[en] = ev;
      if (ev) {
        var libName = en.replace('reponse_champ_', 'reponse_champ_lib_');
        var lib = textValue(libName) || 'Precision';
        recap.push(clean(lib, 90).replace(/\?\s*$/, '') + ' : ' + ev);
      }
    }
    data.autre_info_fj = recap.join('\n');

    if (trackingGranted()) {
      ['user', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
        'utm_category', 'utm_user', 'ltm_source', 'ltm_category', 'ltm_typ', 'ltm_user'].forEach(function (key) {
        if (tracking[key]) data[key] = tracking[key];
      });
      if (analyticsGranted()) {
        if (parentLandingUrlReceived) data.page_url = clean(trackedPageUrl || entryUrl, 1000);
        data.page_referrer = safeReferrer();
        data.user_agent = clean(navigator.userAgent, 300);
        data.langue = clean(navigator.language || '', 20);
      }
    }
    if (marketingGranted()) {
      CLICK_IDS.forEach(function (key) {
        if (tracking[key]) data[key] = tracking[key];
      });
    }
    return data;
  }

  /* ================= Livraisons (contrats de la reference) ================= */
  function sendCrm(data) {
    if (!CONFIG.leadApiUrl || CONFIG.leadApiMode === 'off') {
      return Promise.reject(new Error('API CRM d\u00e9sactiv\u00e9e ou URL absente.'));
    }
    var body = JSON.stringify({ payload: { formId: CONFIG.formId, id: submissionId, data: data } });
    if (CONFIG.leadApiMode === 'cors') {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = controller ? window.setTimeout(function () { controller.abort(); }, 6000) : null;
      return fetch(CONFIG.leadApiUrl, {
        method: 'POST', mode: 'cors',
        credentials: CONFIG.leadApiCredentials === 'include' ? 'include' : 'omit',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: body,
        signal: controller ? controller.signal : undefined
      }).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json().catch(function () { return null; }).then(function (json) {
          if (!json || json.status !== 'ok') throw new Error((json && json.message) || 'R\u00e9ponse CRM inattendue.');
          return { state: 'ok', confirmed: true, via: 'cors', response: json };
        });
      }).finally(function () { if (timer) window.clearTimeout(timer); });
    }
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
        if (navigator.sendBeacon(CONFIG.leadApiUrl, blob)) {
          return Promise.resolve({ state: 'unverified', confirmed: false, via: 'beacon' });
        }
      }
    } catch (e) { debugLog('sendBeacon CRM \u00e9chou\u00e9; repli fetch.', e); }
    var controller2 = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer2 = controller2 ? window.setTimeout(function () { controller2.abort(); }, 6000) : null;
    return fetch(CONFIG.leadApiUrl, {
      method: 'POST', mode: 'no-cors',
      credentials: CONFIG.leadApiCredentials === 'include' ? 'include' : 'omit',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: body, keepalive: true,
      signal: controller2 ? controller2.signal : undefined
    }).then(function () {
      return { state: 'unverified', confirmed: false, via: 'fetch-no-cors' };
    }).finally(function () { if (timer2) window.clearTimeout(timer2); });
  }

  function buildSheetData(data) {
    var sheetData = {
      form_id: CONFIG.formId,
      id_lead: submissionId,
      civilite: data.civilite || '',
      nom: data.nom || '',
      prenom: data.prenom || '',
      mail: data.mail || '',
      telephone: data.telephone || '',
      telephone_verifie: data.telephone_verifie || 'non',
      societe: data.societe || '',
      code_postal: data.code_postal || '',
      ville: data.ville || '',
      site: '',
      solution: clean(data.reponse_1 || '', 500),
      enjeu: clean(data.autre_info_fj || '', 500),
      question_1: data.question_1 || '',
      reponse_1: data.reponse_1 || '',
      question_2: data.question_2 || '',
      reponse_2: data.reponse_2 || '',
      question_3: data.question_3 || '',
      reponse_3: data.reponse_3 || '',
      source: data.source || CONFIG.source,
      categorie: data.categorie || '',
      website: ''
    };
    ['user', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
      'utm_id', 'utm_category', 'utm_user', 'ltm_source', 'ltm_category', 'ltm_typ',
      'ltm_user', 'gclid', 'msclkid', 'fbclid', 'page_url', 'page_referrer',
      'user_agent', 'langue'].forEach(function (key) {
      if (data[key]) sheetData[key] = data[key];
    });
    return sheetData;
  }
  function sendToGoogleSheets(data) {
    if (!CONFIG.googleScriptUrl) return Promise.reject(new Error('URL Google Apps Script manquante.'));
    var body = new URLSearchParams();
    var sheetData = buildSheetData(data);
    Object.keys(sheetData).forEach(function (key) {
      body.append(key, String(sheetData[key] == null ? '' : sheetData[key]));
    });
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, CONFIG.sheetTimeoutMs || 15000) : null;
    return fetch(CONFIG.googleScriptUrl, {
      method: 'POST', mode: 'cors', credentials: 'omit',
      body: body,
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      return response.json().catch(function () { return null; }).then(function (json) {
        if (!response.ok) throw new Error('HTTP ' + response.status + (json && json.message ? ': ' + json.message : ''));
        if (!json || json.status !== 'ok') throw new Error((json && json.message) || 'R\u00e9ponse Google Sheets inattendue.');
        return { state: 'ok', confirmed: true, response: json };
      });
    }).finally(function () { if (timer) window.clearTimeout(timer); });
  }

  /* ================= GTM ================= */
  function pushLeadEvents(data) {
    window.dataLayer = window.dataLayer || [];
    var micro = estMicro(data);
    var eventData = {
      event: micro ? 'formulaire_micro_entrepreneur' : 'formulaire_lead',
      form_id: CONFIG.formId,
      form_name: CONFIG.formName,
      lead_type: micro ? 'micro_entrepreneur' : 'standard',
      telephone_verifie: data.telephone_verifie === 'oui'
    };
    if (analyticsGranted()) {
      if (parentLandingUrlReceived) eventData.page_url = clean(trackedPageUrl || entryUrl, 1000);
      eventData.categorie = clean(data.categorie || '', 200);
      eventData.lead_source = clean(data.source || '', 200);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
        'utm_category', 'utm_user', 'ltm_source', 'ltm_category', 'ltm_typ', 'ltm_user'].forEach(function (key) {
        if (data[key]) eventData[key] = data[key];
      });
    }
    if (marketingGranted()) {
      CLICK_IDS.forEach(function (key) {
        if (data[key]) eventData[key] = data[key];
      });
      eventData.user_data = {
        email: data.mail || '',
        phone_number: versE164(data.telephone || ''),
        address: {
          first_name: data.prenom || '', last_name: data.nom || '',
          postal_code: data.code_postal || '', country: 'FR'
        }
      };
    }
    window.dataLayer.push(eventData);
  }

  /* ================= Soumission ================= */
  var msg = null;
  if (phone) {
    msg = document.createElement('p');
    msg.setAttribute('role', 'status');
    msg.style.cssText = 'margin:8px 0;font-size:14px;color:#c62828;display:none';
    phone.insertAdjacentElement('afterend', msg);
    phone.addEventListener('input', function () { msg.style.display = 'none'; });
  }
  function erreur(t) {
    if (msg) { msg.textContent = t; msg.style.display = 'block'; }
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; if (btn.tagName === 'A' || btn.tagName === 'BUTTON') btn.textContent = BTN_TEXT; else btn.value = BTN_TEXT; }
  }
  function derniereEtape() { return !btn || btn.getClientRects().length > 0; }
  function showMerci() {
    if (fail) fail.style.display = 'none';
    form.style.display = 'none';
    var cible = done || document.querySelector('.form-audi-success') || document.querySelector('.w-form-done');
    if (cible) {
      cible.style.display = 'block';
      if (cible.scrollIntoView) cible.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    var merci = document.createElement('div');
    merci.className = 'ubepro-merci';
    merci.style.cssText = 'padding:18px;border-radius:8px;background:#e8f5e9;color:#137333;font-weight:600;text-align:center;margin:12px 0';
    merci.textContent = 'Merci ! Votre demande a bien \u00e9t\u00e9 envoy\u00e9e.';
    form.insertAdjacentElement('afterend', merci);
    if (merci.scrollIntoView) merci.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function sauvegarderEtRediriger(data) {
    try {
      [['nom', data.nom], ['prenom', data.prenom], ['societe', data.societe],
        ['code_postal', data.code_postal], ['mail', data.mail], ['telephone', textValue('telephone')]].forEach(function (pair) {
        if (pair[1]) localStorage.setItem(pair[0], pair[1]);
      });
      localStorage.setItem('source', (data.source || '') + ' TYP');
    } catch (e) {}
    var target = redirectTarget();
    if (target) window.setTimeout(function () { location.href = target; }, 3000);
  }

  // Rediriger uniquement APRES confirmation, sans laisser une URL de campagne
  // envoyer le visiteur vers une origine non autorisee.
  function redirectTarget() {
    try {
      var link = new URLSearchParams(location.search).get('ltm_typ') ||
        parseUrlParams(entryUrl).ltm_typ || '';
      if (link) {
        var campaign = new URL('/' + link, location.origin);
        if (campaign.origin === location.origin && /^https?:$/.test(campaign.protocol)) return campaign.href;
        return '';
      }
      var original = form.getAttribute('data-redirect') || form.getAttribute('redirect') || '';
      if (!original) return '';
      var target = new URL(original, location.href);
      if (target.origin === location.origin || target.origin === 'https://www.comparateurpro.fr') return target.href;
    } catch (e) {}
    return '';
  }

  function submitLead() {
    if (sending) return;
    if (honeypot && clean(honeypot.value)) {
      debugLog('Honeypot rempli; envoi ignor\u00e9.');
      showMerci();
      return;
    }
    if (champExiste('mail') && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(textValue('mail'))) {
      erreur('Indiquez une adresse e-mail valide.');
      return;
    }
    if (champExiste('code_postal') && !/^\d{5}$/.test(textValue('code_postal').replace(/\s+/g, ''))) {
      erreur('Indiquez un code postal \u00e0 cinq chiffres.');
      return;
    }
    if (phone && !/^0[1-9]\d{8}$/.test(currentPhone())) {
      erreur('Veuillez saisir un num\u00e9ro de t\u00e9l\u00e9phone fran\u00e7ais valide (10 chiffres).');
      phone.focus();
      return;
    }
    /* Verification SMS (verification-sms.js) : l'envoi du lead exige un numero verifie. */
    var smsModule = window.smsVerification;
    if (phone && (!smsModule || typeof smsModule.estVerifie !== 'function')) {
      erreur('Vérification par SMS indisponible. Rechargez la page puis réessayez.');
      return;
    }
    if (phone && !smsModule.estVerifie(currentPhone())) {
      erreur(/^0[67]\d{8}$/.test(currentPhone())
        ? 'Veuillez vérifier votre numéro par SMS (bouton « Recevoir le code ») avant l’envoi du formulaire.'
        : 'Un numéro mobile français (06 ou 07) vérifié par SMS est requis pour envoyer le formulaire.');
      if (typeof smsModule.afficher === 'function') smsModule.afficher();
      if (phone) phone.focus();
      return;
    }
    if (form.querySelector('input[name="consentement"]') &&
        String(radioValue('consentement')).toLowerCase() !== 'oui') {
      erreur('Vous devez accepter les termes et conditions.');
      return;
    }

    sending = true;
    if (btn) { var wait = btn.getAttribute('data-wait') || 'Patienter...'; if (btn.tagName === 'A' || btn.tagName === 'BUTTON') btn.textContent = wait; else btn.value = wait; btn.disabled = true; }
    if (msg) msg.style.display = 'none';

    remplirChampsCaches();
    var data = buildData();
    var recapField = form.querySelector('[name="autre_info_fj"]');
    if (recapField) recapField.value = data.autre_info_fj;
    debugLog('Payload CRM/Sheets pr\u00e9par\u00e9.', { formId: CONFIG.formId, categorie: data.categorie });
    var crmDelivery = sendCrm(data).then(function (result) {
      return { ok: true, result: result };
    }).catch(function (error) { return { ok: false, error: error }; });
    var sheetDelivery = sendToGoogleSheets(data).then(function (result) {
      return { ok: true, result: result };
    }).catch(function (error) { return { ok: false, error: error }; });

    Promise.all([crmDelivery, sheetDelivery]).then(function (results) {
      var crm = results[0];
      var sheet = results[1];
      if (!crm.ok) debugLog('\u00c9chec du transport CRM.', crm.error);
      if (!sheet.ok) debugLog('\u00c9chec du transport Google Sheets.', sheet.error);
      // Un beacon accepté ou une réponse opaque ne confirme pas la réception.
      if ((crm.ok && crm.result.confirmed) || (sheet.ok && sheet.result.confirmed)) {
        pushLeadEvents(data);
        sauvegarderEtRediriger(data);
        showMerci();
      } else {
        sending = false;
        erreur('Nous n\u2019avons pas pu transmettre votre demande. V\u00e9rifiez votre connexion puis r\u00e9essayez.');
      }
    });
  }

  /* ---- Couche jQuery : chemin reel (Formly appelle $form.submit()) ---- */
  function installerJQuery() {
    if (!window.jQuery) return;
    var $f = window.jQuery(form);
    $f.off('submit');
    $f.on('submit', function (e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (derniereEtape()) submitLead();
      return false;
    });
  }
  if (window.jQuery) {
    window.jQuery(installerJQuery);
    window.addEventListener('load', installerJQuery);
  }

  /* ---- Couche native : vrais evenements submit ---- */
  document.addEventListener('submit', function (e) {
    if (e.target !== form) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (derniereEtape()) submitLead();
  }, true);

  /* ---- API de controle QA ---- */
  window.lpLead = Object.freeze({
    version: VERSION,
    config: {
      leadApiUrl: CONFIG.leadApiUrl,
      leadApiMode: CONFIG.leadApiMode,
      formId: CONFIG.formId,
      googleScriptUrl: CONFIG.googleScriptUrl,
      source: CONFIG.source
    },
    preview: function () {
      return { payload: { formId: CONFIG.formId, id: submissionId, data: buildData() } };
    },
    googleSheetPreview: function () { return buildSheetData(buildData()); },
    redirectPreview: redirectTarget,
    tracking: window.lpTracking.inspect
  });
  /* Aliases historiques du site ubepro (retrocompatibilite) */
  window.ubeproLead = window.agvLead = window.tnsLead = window.lpLead;
  window.ubeproTracking = window.lpTracking;
})();
