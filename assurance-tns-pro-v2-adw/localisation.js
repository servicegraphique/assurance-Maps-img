/* localisation.js — Module « Localisation et identification de votre entreprise »
 *
 * Étape du formulaire existant qui permet de :
 *  1. rechercher l'adresse de l'entreprise, l'afficher sur une carte et
 *     enregistrer ses coordonnées GPS (bloc 1) ;
 *  2. retrouver une photographie réelle du bâtiment (façade) ou une vue
 *     aérienne/satellite, avec ses coordonnées GPS (bloc 2).
 *
 * Aucune clé d'API n'est nécessaire : OpenStreetMap, Base Adresse Nationale
 * (Géoplateforme / Etalab), Photon, Panoramax, Wikimedia Commons et Esri.
 * La configuration peut être surchargée via window.LOCALISATION_CONFIG
 * (voir LOCALISATION.md).
 */
(function () {
  'use strict';

  var Core = window.LocCore;
  if (!Core) {
    return;
  }

  /* ================================================================== *
   * Configuration
   * ================================================================== */
  var DEFAULTS = {
    defaultCountry: 'FR',
    persist: true,
    storageKey: 'cpro_loc_entreprise_v1',
    clearStoredOnSubmit: true,
    requireValidation: true,
    /* Reprend l'adresse saisie dans l'étape « société » (champs adresse,
       code_postal, ville) pour préremplir — et lancer — la recherche. */
    prefillFromCompany: true,
    autoSearchFromCompany: true,
    mapZoom: 16,
    aerialZoom: 19,
    photoRadiusMeters: 90,
    photoLimit: 12,
    photoProviderOrder: ['panoramax', 'commons'],
    requestTimeoutMs: 9000,
    maxResults: 8,
    tiles: {
      /* Fond « Plan OSM » : serveur OpenStreetMap France (le serveur public
         tile.openstreetmap.org bloque les applications hors politique d'usage :
         403 « Access blocked »). */
      osm: 'https://tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
      osmAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> France',
      /* Fond « Plan IGN » : WMTS Géoplateforme (IGN), sans clé, France. */
      ign: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
      ignAttribution: 'Plan IGN &copy; <a href="https://www.ign.fr/" target="_blank" rel="noopener">IGN</a> – Géoplateforme',
      /* Fond « Photo aérienne ». */
      aerial: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      aerialAttribution: 'Photo aérienne &copy; Esri, Maxar, Earthstar Geographics',
      /* Repli commun si un plan ne répond pas (403, réseau, extension…). */
      street: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      streetAttribution: 'Fond de carte &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, HERE, Garmin',
      streetFallback: '',
      streetFallbackAttribution: ''
    },
    urls: {
      geopf: 'https://data.geopf.fr/geocodage/search',
      geopfReverse: 'https://data.geopf.fr/geocodage/reverse',
      photon: 'https://photon.komoot.io/api/',
      photonReverse: 'https://photon.komoot.io/reverse',
      panoramax: 'https://api.panoramax.xyz/api/search',
      commons: 'https://commons.wikimedia.org/w/api.php',
      aerialExport: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export'
    },
    debug: false
  };

  function isPlainObject(value) {
    return value && typeof value === 'object' && Object.prototype.toString.call(value) !== '[object Array]';
  }

  function mergeConfig(base, extra) {
    var out = {};
    Object.keys(base).forEach(function (key) {
      out[key] = isPlainObject(base[key]) ? mergeConfig(base[key], {}) : base[key];
    });
    Object.keys(extra || {}).forEach(function (key) {
      if (isPlainObject(extra[key]) && isPlainObject(out[key])) {
        out[key] = mergeConfig(out[key], extra[key]);
      } else if (extra[key] !== undefined) {
        out[key] = extra[key];
      }
    });
    return out;
  }

  var CFG = mergeConfig(DEFAULTS, window.LOCALISATION_CONFIG || {});

  /* ================================================================== *
   * Utilitaires
   * ================================================================== */
  var BLOCKS = ['localisation', 'batiment'];
  var BLOCK_LABEL = {
    localisation: 'la localisation',
    batiment: 'le bâtiment'
  };
  var BLOCK_FIELD = {
    localisation: 'Localisation',
    batiment: 'Bâtiment'
  };

  var STATE = Core.createState();
  var UI = { blocks: {}, modals: {}, gate: null, gateText: null, nextBtn: null };
  var MAPS = {};
  var rootEl = null;
  var stepEl = null;
  var formEl = null;
  var cardEl = null;
  var hiddenEl = null;
  var lastVisible = null;
  var openModalName = null;
  var lastFocused = null;
  var bodyOverflow = '';
  var gateBypassed = false;
  var modal = { name: null, results: [], busy: false, query: null, photoIndex: 0 };
  var reverseToken = 0;
  var photoToken = 0;
  var photosLoading = false;
  var STREET_INDEX = { localisation: 0, batiment: 0 };
  var VIEW_ORDER = ['osm', 'ign', 'aerienne', 'rue'];
  var VIEW_TITLES = { osm: 'Plan OSM', ign: 'Plan IGN', aerienne: 'Photo aérienne', rue: 'Street View' };

  function log() {
    if (!CFG.debug || !window.console) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[localisation]');
    console.info.apply(console, args);
  }

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $$(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function nowIso() {
    try {
      return new Date().toISOString();
    } catch (e) {
      return '';
    }
  }

  function trim(value) {
    return Core.normalizeSpace(value);
  }

  function emit(eventName, detail) {
    var payload = {
      name: eventName,
      state: Core.sanitizeState(STATE),
      fields: Core.toLeadFields(STATE)
    };
    if (detail) {
      Object.keys(detail).forEach(function (key) { payload[key] = detail[key]; });
    }
    try {
      document.dispatchEvent(new CustomEvent('localisation:' + eventName, { detail: payload }));
    } catch (e) {
      log('CustomEvent indisponible', e);
    }
  }

  /* ================================================================== *
   * Réseau
   * ================================================================== */
  function fetchJson(url) {
    if (typeof window.fetch !== 'function') {
      return Promise.reject(new Error('fetch indisponible'));
    }
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () { controller.abort(); }, CFG.requestTimeoutMs)
      : null;
    var options = {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller ? controller.signal : undefined
    };
    return window.fetch(url, options).then(function (response) {
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' sur ' + url);
      }
      return response.json();
    }).finally(function () {
      if (timer) window.clearTimeout(timer);
    });
  }

  /* Chaîne de repli : chaque fournisseur est essayé jusqu'à obtenir un
   * résultat exploitable. Une erreur réseau sur l'un ne bloque pas l'autre. */
  function firstSuccessful(plan, parse) {
    var index = 0;
    var failures = 0;
    function next() {
      if (index >= plan.length) return Promise.resolve({ results: [], failures: failures });
      var step = plan[index++];
      return fetchJson(step.url).then(function (payload) {
        var results = parse(step, payload) || [];
        if (results.length) return { results: results, failures: failures };
        return next();
      }).catch(function (error) {
        failures += 1;
        log('Fournisseur en échec', step.provider, error && error.message);
        return next();
      });
    }
    return next().then(function (outcome) {
      outcome.planned = plan.length;
      return outcome;
    });
  }

  /* ================================================================== *
   * État
   * ================================================================== */
  function loadState() {
    if (!CFG.persist) return Core.createState();
    try {
      var raw = window.localStorage.getItem(CFG.storageKey);
      if (!raw) return Core.createState();
      return Core.parseState(raw);
    } catch (e) {
      log('Lecture du stockage impossible', e);
      return Core.createState();
    }
  }

  function persist() {
    if (!CFG.persist) return;
    try {
      window.localStorage.setItem(CFG.storageKey, Core.serializeState(STATE));
    } catch (e) {
      log('Écriture du stockage impossible', e);
    }
  }

  function queryFromAddress(address, base) {
    return {
      company: (base && base.company) || '',
      housenumber: address && address.housenumber ? address.housenumber : '',
      street: address && address.street ? address.street : '',
      postcode: address && address.postcode ? address.postcode : ((base && base.postcode) || ''),
      city: address && address.city ? address.city : ((base && base.city) || ''),
      countryCode: (address && address.countryCode) || (base && base.countryCode) || CFG.defaultCountry
    };
  }

  function mainFieldValue(name) {
    if (!formEl) return '';
    var field = formEl.querySelector('[name="' + name + '"]');
    return field ? trim(field.value) : '';
  }

  /* Adresse saisie dans l'étape « société » (nom + rue, code postal, ville). */
  function companyQuery() {
    return {
      company: mainFieldValue('societe'),
      housenumber: '',
      street: mainFieldValue('adresse'),
      postcode: mainFieldValue('code_postal'),
      city: mainFieldValue('ville'),
      countryCode: CFG.defaultCountry
    };
  }

  function isCompanyAddressComplete(query) {
    return !!trim(query.street) && Core.validateSearchFields(query).ok;
  }

  /* Complète les requêtes des deux blocs avec l'adresse de société, sans
     écraser une adresse déjà trouvée ni une saisie manuelle. */
  function applyQueryPrefill(query) {
    var changed = false;
    BLOCKS.forEach(function (name) {
      var block = STATE[name];
      if (block.address) return;
      ['company', 'street', 'postcode', 'city'].forEach(function (key) {
        if (!trim(block.query[key]) && trim(query[key])) {
          block.query[key] = query[key];
          changed = true;
        }
      });
      if (!block.query.countryCode) {
        block.query.countryCode = query.countryCode;
        changed = true;
      }
    });
    if (changed) persist();
    return changed;
  }

  var lastPrefillSignature = '';

  /* Recherche automatique à partir des informations de société : l'utilisateur
     n'a pas à ressaisir son adresse dans la modale. */
  function autoSearchFromCompany(query) {
    var signature = [query.street, query.postcode, query.city]
      .map(function (value) { return Core.normalizeKey(value); }).join('|');
    lastPrefillSignature = signature;
    setStatus('localisation', 'Recherche de l’adresse renseignée à l’étape société…', 'loading');

    var plan = Core.buildGeocodePlan(query, {
      geopfUrl: CFG.urls.geopf,
      photonUrl: CFG.urls.photon,
      banLimit: 8,
      photonLimit: 10
    });

    return firstSuccessful(plan, function (step, payload) {
      var results = step.provider === 'ban'
        ? Core.parseGeopf(payload)
        : Core.parsePhoton(payload, query.countryCode);
      return step.provider === 'photon' ? results.slice(0, CFG.maxResults) : results;
    }).then(function (outcome) {
      var best = (outcome.results || [])[0];
      if (!best) {
        setStatus('localisation', 'Adresse non retrouvée automatiquement. Cliquez sur « Rechercher » pour la préciser.', 'error');
        emit('prefill:empty', { query: query });
        return null;
      }
      applyResult('localisation', best, query);
      applyResult('batiment', best, query);
      setStatus('localisation', 'Adresse reprise des informations de société. Vérifiez le repère, ajustez-le si besoin, puis cliquez sur « Valider ».', 'ok');
      emit('prefill:applied', { adresse: best.label });
      return best;
    }).catch(function (error) {
      setStatus('localisation', 'La recherche automatique a échoué. Renseignez l’adresse avec « Rechercher ».', 'error');
      log('Préremplissage en échec', error && error.message);
      emit('prefill:error', { message: error && error.message });
      return null;
    });
  }

  /* Appelé lorsque l'étape devient visible (et par l'API publique). */
  function maybeAutoFill(force) {
    if (!CFG.prefillFromCompany) return Promise.resolve(null);
    var query = companyQuery();
    applyQueryPrefill(query);
    if (!CFG.autoSearchFromCompany && !force) return Promise.resolve(null);
    if (!isCompanyAddressComplete(query)) {
      if (force) setStatus('localisation', 'Complétez l’adresse à l’étape société, ou lancez une recherche avec le bouton « Rechercher ».', '');
      return Promise.resolve(null);
    }
    var signature = [query.street, query.postcode, query.city]
      .map(function (value) { return Core.normalizeKey(value); }).join('|');
    if (!force && signature === lastPrefillSignature) return Promise.resolve(null);
    /* Ne jamais écraser une adresse déjà obtenue ni une validation. */
    if (STATE.localisation.address || STATE.localisation.validated) {
      if (!force) return Promise.resolve(null);
      if (STATE.localisation.validated) return Promise.resolve(null);
    }
    return autoSearchFromCompany(query);
  }

  /* ================================================================== *
   * Champs cachés transmis avec le lead
   * ================================================================== */
  function syncHiddenFields() {
    if (!hiddenEl) return;
    var fields = Core.toLeadFields(STATE);
    Object.keys(fields).forEach(function (name) {
      var input = hiddenEl.querySelector('input[name="' + name + '"]');
      if (!input) {
        input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        hiddenEl.appendChild(input);
      }
      input.value = fields[name] == null ? '' : String(fields[name]);
    });
  }

  /* ================================================================== *
   * Rendu des blocs
   * ================================================================== */
  function setStatus(name, text, tone) {
    var ui = UI.blocks[name];
    if (!ui || !ui.status) return;
    ui.status.textContent = text || '';
    if (tone) {
      ui.status.setAttribute('data-tone', tone);
    } else {
      ui.status.removeAttribute('data-tone');
    }
    if (tone === 'loading') {
      ui.status.setAttribute('aria-busy', 'true');
    } else {
      ui.status.removeAttribute('aria-busy');
    }
  }

  function renderBlock(name) {
    var ui = UI.blocks[name];
    var block = STATE[name];
    if (!ui) return;
    var address = block.address;

    if (ui.address) {
      ui.address.textContent = address
        ? (address.label || Core.formatCoords(address.lat, address.lon))
        : (name === 'localisation'
          ? 'Adresse non renseignée'
          : 'Adresse du bâtiment non renseignée');
      ui.address.setAttribute('data-empty', address ? '0' : '1');
    }
    if (ui.coords) {
      ui.coords.textContent = address ? Core.formatCoordLabel(address.lat, address.lon) : '';
    }
    if (ui.meta) {
      if (address) {
        var parts = [Core.precisionLabel(address.precision)];
        if (address.providerLabel) parts.push(address.providerLabel);
        ui.meta.textContent = parts.filter(Boolean).join(' · ');
      } else {
        ui.meta.textContent = name === 'localisation'
          ? 'Cliquez sur « Rechercher » ou directement sur la carte.'
          : 'Renseignez l’adresse : le bâtiment s’affiche en vue aérienne.';
      }
    }
    if (ui.badge) {
      ui.badge.textContent = block.validated ? 'Validée' : (address ? 'À valider' : 'À compléter');
      ui.badge.setAttribute('data-state', block.validated ? 'ok' : (address ? 'draft' : ''));
    }
    if (ui.validateBtn) {
      ui.validateBtn.classList.toggle('loc-btn--validated', block.validated);
      ui.validateBtn.setAttribute('aria-pressed', block.validated ? 'true' : 'false');
      ui.validateBtn.setAttribute('aria-label', block.validated
        ? 'Valider à nouveau ' + BLOCK_LABEL[name]
        : 'Valider ' + BLOCK_LABEL[name]);
    }
    if (block.validated) {
      ui.root.removeAttribute('data-attention');
    }

    renderMedia(name);
  }

  /* Images de rue disponibles (Panoramax / Commons) : la liste est partagée
     par les deux blocs, leurs adresses étant en général identiques. */
  function photoList() {
    var photos = STATE.batiment.photos || [];
    return photos.filter(function (photo) { return !!(photo && photo.image); });
  }

  function currentStreetPhoto(name) {
    var pool = photoList();
    if (!pool.length) return null;
    return pool[Math.abs(STREET_INDEX[name] || 0) % pool.length];
  }

  /* Les attributions de tuiles contiennent du HTML (liens, entités) : on les
     affiche en texte simple sous la carte. */
  function plainAttribution(value) {
    if (!value) return '';
    var text = String(value).replace(/<[^>]*>/g, '');
    text = text
      .replace(/&copy;/gi, '©')
      .replace(/&amp;/gi, '&')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&deg;/gi, '°')
      .replace(/&quot;/gi, '"');
    return text.replace(/\s+/g, ' ').trim();
  }

  function attributionFor(view) {
    var tiles = CFG.tiles || {};
    if (view === 'aerienne') return tiles.aerialAttribution || '';
    if (view === 'ign') return tiles.ignAttribution || '';
    return tiles.osmAttribution || '';
  }

  /* Affiche l'image de rue (plein cadre, libellé d'adresse, crédit, flèches). */
  function renderStreet(name, ui) {
    var block = STATE[name];
    var pool = photoList();
    var photo = currentStreetPhoto(name);

    if (ui.rueImg) {
      if (photo) {
        if (ui.rueImg.getAttribute('src') !== photo.image) ui.rueImg.src = photo.image;
        ui.rueImg.alt = 'Image de rue' + (block.address ? ' — ' + block.address.label : '');
        /* Les photos Panoramax sont des panoramas 360° : on recadre la bande
           centrale pour retrouver le cadrage d'une vue de rue classique. */
        ui.rueImg.classList.toggle('loc-rue__img--360', photo.provider === 'panoramax');
      } else {
        ui.rueImg.removeAttribute('src');
        ui.rueImg.classList.remove('loc-rue__img--360');
      }
    }
    if (ui.rueCredit) {
      ui.rueCredit.textContent = photo
        ? [photo.providerLabel || 'Source ouverte', photo.license].filter(Boolean).join(' · ')
        : '';
    }
    if (ui.rueAddress) {
      ui.rueAddress.textContent = block.address ? block.address.label : '';
      ui.rueAddress.hidden = !block.address;
    }
    var multiple = pool.length > 1;
    if (ui.ruePrev) ui.ruePrev.hidden = !multiple;
    if (ui.rueNext) ui.rueNext.hidden = !multiple;
    if (ui.rueLink) {
      if (photo && photo.viewerUrl) {
        ui.rueLink.href = photo.viewerUrl;
        ui.rueLink.hidden = false;
      } else {
        ui.rueLink.removeAttribute('href');
        ui.rueLink.hidden = true;
      }
    }
    return photo;
  }

  /* Rendu de la zone média d'un bloc, selon la vue choisie. */
  function renderMedia(name) {
    var ui = UI.blocks[name];
    var block = STATE[name];
    if (!ui) return;
    var view = viewOf(name);
    var hasAddress = !!block.address;
    var pool = photoList();
    var isStreet = view === 'rue';

    if (ui.tabs) {
      ui.tabs.forEach(function (tab) {
        tab.setAttribute('aria-pressed', tab.getAttribute('data-loc-view') === view ? 'true' : 'false');
      });
    }

    var showStreet = isStreet && hasAddress && pool.length > 0;
    var showMap = !isStreet && (hasAddress || name === 'localisation');
    var showPlaceholder = !showStreet && !showMap;
    var showLoading = isStreet && !showStreet && photosLoading;

    if (ui.rue) ui.rue.hidden = !showStreet;
    if (showStreet) renderStreet(name, ui);

    if (ui.map) {
      var wasHidden = ui.map.hidden;
      ui.map.hidden = !showMap;
      if (showMap && wasHidden) {
        window.setTimeout(function () {
          if (MAPS[name]) MAPS[name].map.invalidateSize();
        }, 80);
      }
    }
    if (showMap) {
      if (window.L) {
        ensureMap(name);
        applyBasemap(name);
        centerMap(name);
      } else {
        renderMapFallback(name);
      }
    }

    if (ui.loading) ui.loading.hidden = !showLoading;

    if (ui.placeholder) {
      ui.placeholder.hidden = !showPlaceholder;
      if (showPlaceholder) {
        if (isStreet) {
          if (ui.placeholderTitle) ui.placeholderTitle.textContent = 'Image de rue indisponible';
          if (ui.placeholderText) {
            ui.placeholderText.textContent = hasAddress
              ? 'Aucune image de rue n’est disponible dans les sources ouvertes pour cette adresse.'
              : 'Renseignez votre adresse pour afficher l’image de rue.';
          }
          if (ui.aerialTrigger) ui.aerialTrigger.hidden = !hasAddress;
        } else {
          if (ui.placeholderTitle) ui.placeholderTitle.textContent = 'Vue du bâtiment';
          if (ui.placeholderText) {
            ui.placeholderText.textContent = 'Renseignez l’adresse du bâtiment pour afficher la carte.';
          }
          if (ui.aerialTrigger) ui.aerialTrigger.hidden = true;
        }
      }
    }

    if (ui.credit) {
      ui.credit.textContent = '';
      if (showStreet) {
        var photo = currentStreetPhoto(name);
        if (photo) {
          var bits = ['Image : ' + (photo.credit || photo.providerLabel || 'source ouverte')];
          if (photo.license) bits.push(photo.license);
          if (photo.datetime) bits.push(formatDate(photo.datetime));
          if (isFinite(photo.distance) && photo.distance >= 0) {
            bits.push('à ' + Math.round(photo.distance) + ' m de l’adresse');
          }
          ui.credit.appendChild(document.createTextNode(bits.join(' · ')));
          if (photo.viewerUrl) {
            ui.credit.appendChild(document.createTextNode(' · '));
            var link = document.createElement('a');
            link.href = photo.viewerUrl;
            link.target = '_blank';
            link.rel = 'noopener nofollow';
            link.textContent = 'ouvrir le panorama';
            ui.credit.appendChild(link);
          }
        }
      } else if (showMap) {
        ui.credit.appendChild(document.createTextNode(plainAttribution(attributionFor(view))));
      }
    }
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '';
    try {
      return date.toLocaleDateString('fr-FR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch (e) {
      return '';
    }
  }

  function renderAll() {
    BLOCKS.forEach(renderBlock);
  }

  /* ================================================================== *
   * Vues (plan OSM, plan IGN, photo aérienne, Street View) et cartes
   * ================================================================== */
  function isStepVisible() {
    if (!rootEl) return false;
    if (!rootEl.getClientRects().length) return false;
    return rootEl.offsetParent !== null || window.getComputedStyle(rootEl).position === 'fixed';
  }

  function viewOf(name) {
    var block = STATE[name];
    var view = block ? block.mode : null;
    if (view === 'facade') return 'rue';
    return VIEW_ORDER.indexOf(view) !== -1 ? view : (name === 'batiment' ? 'aerienne' : 'osm');
  }

  function viewLabel(view) {
    return VIEW_TITLES[view] || VIEW_TITLES.osm;
  }

  function zoomFor(name, view) {
    if (view === 'aerienne') return name === 'batiment' ? CFG.aerialZoom : Math.max(CFG.mapZoom + 1, 17);
    if (view === 'rue') return CFG.mapZoom;
    return name === 'batiment' ? CFG.mapZoom + 1 : CFG.mapZoom;
  }

  /* Couche de base correspondant à une vue. */
  function basemapSpec(view) {
    var tiles = CFG.tiles || {};
    if (view === 'aerienne') {
      return { url: tiles.aerial, attribution: tiles.aerialAttribution || '', maxNativeZoom: 19, maxZoom: 19 };
    }
    if (view === 'ign') {
      return { url: tiles.ign, attribution: tiles.ignAttribution || '', maxNativeZoom: 18, maxZoom: 19 };
    }
    return { url: tiles.osm, attribution: tiles.osmAttribution || '', maxNativeZoom: 19, maxZoom: 19 };
  }

  /* Repli commun (Esri) quand les tuiles d'un plan ne répondent pas. */
  function fallbackSpec(view) {
    var tiles = CFG.tiles || {};
    if (view === 'aerienne' || !tiles.street) return null;
    return { url: tiles.street, attribution: tiles.streetAttribution || '', maxNativeZoom: 19, maxZoom: 19 };
  }

  /* Chaîne de repli exposée pour les tests et le support. */
  function streetTileProviders() {
    var view = 'osm';
    var chain = [];
    var spec = basemapSpec(view);
    if (spec && spec.url) chain.push({ url: spec.url, attribution: spec.attribution });
    var fb = fallbackSpec(view);
    if (fb && fb.url && fb.url !== spec.url) chain.push({ url: fb.url, attribution: fb.attribution });
    return chain;
  }

  function showMapNotice(map, text) {
    if (!map || !map.getContainer) return;
    var container = map.getContainer();
    if (!container || container.querySelector('.loc-map__notice')) return;
    var notice = document.createElement('div');
    notice.className = 'loc-map__notice';
    notice.textContent = text || 'Fond de carte indisponible';
    container.appendChild(notice);
  }

  /* Ajoute une couche de tuiles et bascule sur la suivante si elle échoue
     (403, réseau, blocage d'extension…), pour ne jamais laisser la carte vide. */
  function attachTiles(entry, chain) {
    var index = 0;

    function attach() {
      var spec = chain[index];
      var layer = window.L.tileLayer(spec.url, {
        maxZoom: spec.maxZoom || 19,
        maxNativeZoom: spec.maxNativeZoom || 18,
        attribution: spec.attribution || ''
      });
      var errors = 0;
      layer.on('tileerror', function () {
        if (!entry.map.hasLayer(layer)) return;
        errors += 1;
        if (errors < 3) return;
        entry.map.removeLayer(layer);
        if (index < chain.length - 1) {
          index += 1;
          log('Tuiles indisponibles, bascule sur « ' + chain[index].url + ' »');
          attach();
        } else {
          showMapNotice(entry.map, 'Fond de carte indisponible');
        }
      });
      layer.addTo(entry.map);
      entry.layer = layer;
    }

    attach();
  }

  function ensureMap(name) {
    var ui = UI.blocks[name];
    if (!ui || !ui.map) return null;
    if (MAPS[name]) return MAPS[name];
    var block = STATE[name];
    if (!block.address && name === 'batiment') return null;
    if (!window.L) return null;
    var view = viewOf(name);
    var center = block.address ? [block.address.lat, block.address.lon] : [46.6, 2.4];
    var map;
    try {
      map = window.L.map(ui.map, {
        zoomControl: true,
        scrollWheelZoom: false,
        attributionControl: true,
        minZoom: 3,
        maxZoom: 19
      }).setView(center, block.address ? zoomFor(name, view) : 5);
    } catch (e) {
      log('Initialisation de la carte impossible', e);
      renderMapFallback(name);
      return null;
    }
    var entry = { map: map, marker: null, layer: null, layerView: null, centerKey: '' };
    if (name === 'localisation') {
      entry.marker = window.L.marker(center, { draggable: true, keyboard: false });
      entry.marker.on('dragend', function () {
        var pos = entry.marker.getLatLng();
        reverseGeocode(pos.lat, pos.lng);
      });
      map.on('click', function (event) {
        placeMarker(event.latlng.lat, event.latlng.lng, true);
      });
    } else if (block.address) {
      entry.marker = window.L.marker(center, { keyboard: false }).addTo(map);
    }
    MAPS[name] = entry;
    applyBasemap(name);
    window.setTimeout(function () { map.invalidateSize(); }, 160);
    return entry;
  }

  function applyBasemap(name) {
    var entry = MAPS[name];
    if (!entry) return;
    var view = viewOf(name);
    if (entry.layerView === view) return;
    if (entry.layer && entry.map.hasLayer(entry.layer)) entry.map.removeLayer(entry.layer);
    entry.layer = null;
    entry.layerView = view;
    if (view === 'rue') return;
    var spec = basemapSpec(view);
    if (!spec || !spec.url) return;
    var chain = [spec];
    var fb = fallbackSpec(view);
    if (fb && fb.url && fb.url !== spec.url) chain.push(fb);
    attachTiles(entry, chain);
  }

  /* Recentre la carte uniquement quand l'adresse ou la vue change. */
  function centerMap(name, force) {
    var entry = MAPS[name];
    var block = STATE[name];
    if (!entry || !block) return;
    var view = viewOf(name);
    var key = block.address
      ? [block.address.lat, block.address.lon, view].join('|')
      : 'none|' + view;
    if (!force && entry.centerKey === key) return;
    entry.centerKey = key;
    if (block.address) {
      entry.map.setView([block.address.lat, block.address.lon], zoomFor(name, view));
      if (entry.marker) {
        entry.marker.setLatLng([block.address.lat, block.address.lon]);
        if (!entry.map.hasLayer(entry.marker)) entry.marker.addTo(entry.map);
      }
    } else if (name === 'localisation') {
      entry.map.setView([46.6, 2.4], 5);
      if (entry.marker && entry.map.hasLayer(entry.marker)) entry.map.removeLayer(entry.marker);
    }
    window.setTimeout(function () { entry.map.invalidateSize(); }, 60);
  }

  function refreshMap(name, force) {
    var block = STATE[name];
    if (!block) return;
    if (viewOf(name) === 'rue') return;
    if (name === 'batiment' && !block.address) return;
    if (!window.L) {
      renderMapFallback(name);
      return;
    }
    ensureMap(name);
    applyBasemap(name);
    centerMap(name, force);
  }

  function renderMapFallback(name) {
    var ui = UI.blocks[name];
    var block = STATE[name];
    if (!ui || !ui.map || !block) return;
    var address = block.address;
    if (!address) return;
    var view = viewOf(name);
    var key = view + '|' + address.lat + '|' + address.lon;
    if (ui.map.getAttribute('data-fallback') === key) return;
    ui.map.setAttribute('data-fallback', key);
    ui.map.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'loc-map__fallback';
    var coords = document.createElement('p');
    coords.className = 'loc-map__fallback-coords';
    coords.textContent = Core.formatCoords(address.lat, address.lon);
    var text = document.createElement('p');
    text.textContent = window.L ? 'Carte interactive indisponible.' : 'Carte interactive indisponible (Leaflet non chargé).';
    var link = document.createElement('a');
    link.href = 'https://www.openstreetmap.org/?mlat=' + address.lat + '&mlon=' + address.lon + '#map=18/' + address.lat + '/' + address.lon;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Ouvrir la carte';
    wrap.appendChild(coords);
    wrap.appendChild(text);
    wrap.appendChild(link);

    if (view === 'aerienne') {
      var img = document.createElement('img');
      img.src = aerialImageUrl(address, CFG);
      img.alt = 'Vue aérienne du bâtiment';
      img.loading = 'lazy';
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1';
      ui.map.style.position = 'relative';
      ui.map.appendChild(img);
      wrap.style.background = 'rgba(255,255,255,.86)';
    }
    wrap.style.position = 'relative';
    wrap.style.zIndex = '1';
    ui.map.appendChild(wrap);
  }

  function aerialImageUrl(address, config) {
    var url = Core.buildAerialImageUrl(address.lat, address.lon, {});
    if (config && config.urls && config.urls.aerialExport) {
      try {
        var parsed = new URL(url);
        url = new URL(config.urls.aerialExport) + '?' + parsed.searchParams.toString();
      } catch (e) { /* on garde l'URL par défaut */ }
    }
    return url;
  }

  function placeMarker(lat, lon, shouldReverse) {
    var entry = MAPS.localisation;
    if (!entry || !entry.marker) return;
    entry.marker.setLatLng([lat, lon]);
    if (!entry.map.hasLayer(entry.marker)) entry.marker.addTo(entry.map);
    if (shouldReverse) reverseGeocode(lat, lon);
  }

  /* Change la vue d'un bloc (Plan OSM, Plan IGN, Photo aérienne, Street View). */
  function setView(name, view) {
    var block = STATE[name];
    if (!block) return;
    var next = VIEW_ORDER.indexOf(view) !== -1 ? view : (name === 'batiment' ? 'aerienne' : 'osm');
    block.mode = next;
    if (next === 'rue') ensureStreetPhotos();
    renderBlock(name);
    if (next !== 'rue') refreshMap(name, next === 'aerienne');
    syncHiddenFields();
    persist();
    if (block.validated) {
      setStatus(name, 'Vue enregistrée : ' + viewLabel(next) + '.', 'ok');
    }
    emit('change', { bloc: name, vue: next, mode: next });
  }

  /* Navigation entre les images de rue disponibles. */
  function stepStreet(name, delta) {
    var pool = photoList();
    if (pool.length < 2) return;
    STREET_INDEX[name] = ((STREET_INDEX[name] || 0) + delta + pool.length) % pool.length;
    if (name === 'batiment') {
      STATE.batiment.photo = pool[STREET_INDEX.batiment];
      STATE.batiment.validated = false;
    }
    renderBlock(name);
    syncHiddenFields();
    persist();
    setStatus(name, 'Image de rue ' + (STREET_INDEX[name] + 1) + ' sur ' + pool.length + '.', '');
  }

  /* Charge les images de rue si elles ne le sont pas encore. */
  function ensureStreetPhotos() {
    if (photoList().length || photosLoading) return;
    if (!STATE.batiment.address && !STATE.localisation.address) return;
    if (!STATE.batiment.address && STATE.localisation.address) {
      applyResult('batiment', STATE.localisation.address, STATE.localisation.query);
      return;
    }
    loadBuildingPhotos();
  }

  /* ================================================================== *
   * Géocodage inverse (déplacement du repère)
   * ================================================================== */
  function reverseGeocode(lat, lon, sourceName) {
    var name = sourceName || 'localisation';
    var token = ++reverseToken;
    setStatus(name, 'Recherche de l’adresse correspondant à cette position…', 'loading');
    var plan = Core.buildReversePlan(lat, lon, CFG.urls);
    return firstSuccessful(plan, function (step, payload) {
      var parsed = Core.parseReverse(payload, lat, lon, null);
      return parsed ? [parsed] : [];
    }).then(function (outcome) {
      if (token !== reverseToken) return;
      var results = outcome.results || [];
      var block = STATE[name];
      var address = results.length ? Core.sanitizeAddress(results[0]) : null;
      if (!address) {
        address = Core.manualAddress(block.query, lat, lon);
      }
      block.address = address;
      block.query = queryFromAddress(address, block.query);
      block.validated = false;
      block.updatedAt = nowIso();
      if (name === 'batiment') {
        block.photo = null;
        block.photos = [];
        block.mode = 'aerienne';
        STREET_INDEX.batiment = 0;
        STREET_INDEX.localisation = 0;
      }
      renderBlock(name);
      refreshMap(name);
      syncHiddenFields();
      persist();
      setStatus(name, results.length
        ? 'Position mise à jour. Vérifiez l’adresse puis cliquez sur « Valider ».'
        : 'Position enregistrée. L’adresse n’a pas pu être déterminée automatiquement.', results.length ? 'ok' : 'error');
      emit('change', { bloc: name, source: 'carte' });
      if (name === 'batiment') loadBuildingPhotos();
    });
  }

  /* ================================================================== *
   * Photographies du bâtiment
   * ================================================================== */
  function loadBuildingPhotos() {
    var block = STATE.batiment;
    var address = block.address;
    if (!address) return Promise.resolve([]);
    var token = ++photoToken;
    photosLoading = true;
    if (UI.blocks.batiment.loading) UI.blocks.batiment.loading.hidden = false;
    renderBlock('batiment');
    setStatus('batiment', 'Recherche des images de rue du bâtiment…', 'loading');

    var providers = Array.isArray(CFG.photoProviderOrder) ? CFG.photoProviderOrder : [];
    var tasks = providers.map(function (provider) {
      if (provider === 'panoramax') {
        return fetchJson(Core.buildPanoramaxUrl(address.lat, address.lon, {
          panoramaxUrl: CFG.urls.panoramax,
          photoRadiusMeters: CFG.photoRadiusMeters,
          photoLimit: CFG.photoLimit
        })).then(function (payload) {
          return Core.parsePanoramax(payload, address.lat, address.lon);
        }).catch(function (error) {
          log('Panoramax indisponible', error && error.message);
          return [];
        });
      }
      if (provider === 'commons') {
        return fetchJson(Core.buildCommonsUrl(address.lat, address.lon, {
          commonsUrl: CFG.urls.commons,
          commonsRadiusMeters: 130
        })).then(function (payload) {
          return Core.parseCommons(payload, address.lat, address.lon);
        }).catch(function (error) {
          log('Wikimedia Commons indisponible', error && error.message);
          return [];
        });
      }
      return Promise.resolve([]);
    });

    return Promise.all(tasks).then(function (lists) {
      if (token !== photoToken) return [];
      var photos = [];
      lists.forEach(function (list) {
        (list || []).forEach(function (item) { photos.push(item); });
      });
      photos = photos.slice(0, 8);
      photosLoading = false;
      block.photos = photos;
      STREET_INDEX.batiment = 0;
      STREET_INDEX.localisation = 0;
      if (photos.length) {
        block.photo = photos[0];
        setStatus('batiment', block.mode === 'rue'
          ? 'Image de rue trouvée (' + (photos[0].providerLabel || 'source ouverte') + '). Vérifiez qu’il s’agit bien de vos locaux puis validez.'
          : 'Image de rue disponible (' + photos.length + (photos.length > 1 ? ' images' : ' image') + ') : ouvrez l’onglet « Street View » du bloc.', 'ok');
      } else {
        block.photo = null;
        setStatus('batiment', 'Aucune image de rue n’est disponible pour cette adresse : la carte et la photo aérienne restent disponibles.', '');
      }
      if (UI.blocks.batiment.loading) UI.blocks.batiment.loading.hidden = true;
      renderBlock('batiment');
      renderBlock('localisation');
      refreshMap('batiment');
      window.setTimeout(function () { refreshMap('batiment'); }, 60);
      syncHiddenFields();
      persist();
      emit('change', { bloc: 'batiment', photos: photos.length });
      return photos;
    }).catch(function (error) {
      if (token !== photoToken) return [];
      photosLoading = false;
      if (UI.blocks.batiment.loading) UI.blocks.batiment.loading.hidden = true;
      renderBlock('batiment');
      renderBlock('localisation');
      refreshMap('batiment');
      setStatus('batiment', 'La recherche d’images de rue a échoué. La carte et la photo aérienne restent disponibles.', 'error');
      emit('change', { bloc: 'batiment', error: error && error.message });
      return [];
    });
  }

  /* ================================================================== *
   * Validation
   * ================================================================== */
  function validateBlock(name) {
    var block = STATE[name];
    var ui = UI.blocks[name];
    if (!block.address) {
      setStatus(name, 'Lancez d’abord une recherche d’adresse (« Rechercher » ou clic sur la carte).', 'error');
      if (ui) {
        ui.root.setAttribute('data-attention', '1');
        window.setTimeout(function () { ui.root.removeAttribute('data-attention'); }, 2600);
      }
      return false;
    }
    if (block.mode === 'rue' && !photoList().length) {
      block.mode = name === 'batiment' ? 'aerienne' : 'osm';
    }
    block.validated = true;
    block.updatedAt = nowIso();
    renderBlock(name);
    refreshMap(name);
    syncHiddenFields();
    persist();
    hideGate();
    setStatus(name, name === 'localisation'
      ? 'Localisation validée. Vous pouvez maintenant identifier le bâtiment.'
      : 'Bâtiment validé. Merci, ces informations accompagneront votre demande.', 'ok');
    emit('validee', {
      bloc: name,
      adresse: block.address.label,
      latitude: block.address.lat,
      longitude: block.address.lon,
      vue: block.mode
    });
    return true;
  }

  function invalidate(name) {
    var block = STATE[name];
    if (!block.validated) return;
    block.validated = false;
    renderBlock(name);
    syncHiddenFields();
    persist();
  }

  /* ================================================================== *
   * Modales de recherche
   * ================================================================== */
  function countryOptions(selected) {
    var countries = Core.COUNTRIES.slice().sort(function (a, b) {
      if (a.code === 'FR') return -1;
      if (b.code === 'FR') return 1;
      return a.name.localeCompare(b.name, 'fr');
    });
    return countries.map(function (country) {
      return '<option value="' + country.code + '"' + (country.code === selected ? ' selected' : '') + '>' +
        country.name + '</option>';
    }).join('');
  }

  function fieldHTML(name, id, label, options) {
    options = options || {};
    return [
      '<div class="loc-field" data-field="' + name + '">',
      '  <label for="' + id + '">' + label + (options.optional ? ' <span style="font-weight:400;color:#98a2b3">(facultatif)</span>' : '') + '</label>',
      options.select
        ? '  <select id="' + id + '" name="' + name + '" autocomplete="' + (options.autocomplete || 'off') + '">' + options.select + '</select>'
        : '  <input id="' + id + '" name="' + name + '" type="' + (options.type || 'text') + '"' +
          (options.inputmode ? ' inputmode="' + options.inputmode + '"' : '') +
          (options.placeholder ? ' placeholder="' + options.placeholder + '"' : '') +
          ' autocomplete="' + (options.autocomplete || 'off') + '">',
      '  <span class="loc-field__error" data-error></span>',
      '</div>'
    ].join('');
  }

  function buildModal(name) {
    var id = 'loc-modal-' + name;
    var isBatiment = name === 'batiment';
    var wrapper = document.createElement('div');
    wrapper.className = 'loc-modal';
    wrapper.id = id;
    wrapper.hidden = true;
    wrapper.innerHTML = [
      '<div class="loc-modal__backdrop" data-loc-close></div>',
      '<div class="loc-modal__panel" role="dialog" aria-modal="true" aria-labelledby="' + id + '-title" tabindex="-1">',
      '  <button type="button" class="loc-modal__close" data-loc-close aria-label="Fermer la fenêtre">\u00D7</button>',
      '  <h3 class="loc-modal__title" id="' + id + '-title">' + (isBatiment
        ? 'Rechercher le bâtiment de votre entreprise'
        : 'Rechercher la localisation de votre entreprise') + '</h3>',
      '  <p class="loc-modal__intro">' + (isBatiment
        ? 'Indiquez l’adresse de vos locaux : nous recherchons une photographie de la façade ou une vue aérienne du bâtiment.'
        : 'Indiquez l’adresse de votre entreprise : elle sera positionnée sur la carte avec ses coordonnées GPS.') + '</p>',
      '  <form class="loc-form" novalidate>',
      fieldHTML('company', id + '-company', 'Nom de l’entreprise', {
        optional: true,
        autocomplete: 'organization',
        placeholder: 'Ex. Dupont & Fils'
      }),
      fieldHTML('street', id + '-street', 'Numéro et nom de rue', {
        autocomplete: 'address-line1',
        placeholder: 'Ex. 12 rue de la Paix'
      }),
      '  <div class="loc-field-row">',
      fieldHTML('postcode', id + '-postcode', 'Code postal', {
        inputmode: 'numeric',
        autocomplete: 'postal-code',
        placeholder: '75002'
      }),
      fieldHTML('city', id + '-city', 'Ville', {
        autocomplete: 'address-level2',
        placeholder: 'Paris'
      }),
      '  </div>',
      fieldHTML('countryCode', id + '-country', 'Pays', {
        select: countryOptions(CFG.defaultCountry),
        autocomplete: 'country'
      }),
      '  <p class="loc-form__hint" data-loc-postcode-hint></p>',
      '  <p class="loc-form__error" data-loc-error role="alert" hidden></p>',
      '  <div class="loc-results" data-loc-results hidden>',
      '    <h4 class="loc-results__title" data-loc-results-title>Adresses trouvées</h4>',
      '    <div data-loc-results-list></div>',
      '    <div class="loc-results__actions">',
      '      <button type="button" class="loc-btn loc-btn--primary" data-loc-use>Utiliser cette adresse</button>',
      '    </div>',
      '    <p class="loc-results__manual">Vous ne trouvez pas votre adresse ? Précisez le numéro, ou recherchez avec le nom de l’entreprise.</p>',
      '  </div>',
      '  <div class="loc-modal__actions">',
      '    <button type="button" class="loc-btn loc-btn--ghost" data-loc-close>Annuler</button>',
      '    <button type="submit" class="loc-btn loc-btn--primary" data-loc-submit>Lancer la recherche</button>',
      '  </div>',
      '  </form>',
      '</div>'
    ].join('');
    document.body.appendChild(wrapper);

    var modalUi = {
      root: wrapper,
      panel: wrapper.querySelector('.loc-modal__panel'),
      form: wrapper.querySelector('form'),
      submit: wrapper.querySelector('[data-loc-submit]'),
      error: wrapper.querySelector('[data-loc-error]'),
      results: wrapper.querySelector('[data-loc-results]'),
      resultsTitle: wrapper.querySelector('[data-loc-results-title]'),
      resultsList: wrapper.querySelector('[data-loc-results-list]'),
      useBtn: wrapper.querySelector('[data-loc-use]'),
      postcodeHint: wrapper.querySelector('[data-loc-postcode-hint]'),
      country: wrapper.querySelector('[name="countryCode"]')
    };

    wx(modalUi.form, 'submit', function (event) {
      event.preventDefault();
      handleSearch(name);
    });
    wx(wrapper.querySelectorAll('[data-loc-close]'), 'click', function () {
      closeModal(name);
    });
    wx(modalUi.useBtn, 'click', function () {
      useSelectedResult(name);
    });
    wx(modalUi.country, 'change', function () {
      var hint = Core.postcodeHint(modalUi.country.value);
      modalUi.postcodeHint.textContent = hint;
      var field = wrapper.querySelector('[name="postcode"]');
      if (field) field.placeholder = (Core.getCountry(modalUi.country.value) || {}).example || '';
      clearFieldError(modalUi.form, 'postcode');
    });
    wx(modalUi.resultsList, 'click', function (event) {
      var item = event.target.closest ? event.target.closest('.loc-result') : null;
      if (!item) return;
      var input = item.querySelector('input[type="radio"]');
      if (input) input.checked = true;
    });
    wx(modalUi.resultsList, 'dblclick', function (event) {
      var item = event.target.closest ? event.target.closest('.loc-result') : null;
      if (!item) return;
      var input = item.querySelector('input[type="radio"]');
      if (input) input.checked = true;
      useSelectedResult(name);
    });

    UI.modals[name] = modalUi;
    return modalUi;
  }

  function wx(target, eventName, handler) {
    if (!target) return;
    if (target.addEventListener) {
      target.addEventListener(eventName, handler);
      return;
    }
    Array.prototype.forEach.call(target, function (node) {
      node.addEventListener(eventName, handler);
    });
  }

  function fillModal(name) {
    var modalUi = UI.modals[name];
    var block = STATE[name];
    var query = block.query || {};
    var company = trim(query.company) || mainFieldValue('societe');
    var postcode = trim(query.postcode) || mainFieldValue('code_postal');
    var city = trim(query.city) || mainFieldValue('ville');
    var street = Core.streetLine(query) || trim(query.street) || mainFieldValue('adresse');

    if (!trim(query.street) && name === 'batiment' && STATE.localisation.address) {
      query = queryFromAddress(STATE.localisation.address, query);
      street = Core.streetLine(query) || street;
      postcode = trim(query.postcode) || postcode;
      city = trim(query.city) || city;
    }
    if (!trim(query.company)) query.company = company;
    if (!trim(query.postcode)) query.postcode = postcode;
    if (!trim(query.city)) query.city = city;
    if (!trim(query.street)) query.street = street;
    if (!query.countryCode) query.countryCode = CFG.defaultCountry;

    setFieldValue(modalUi, 'company', trim(query.company));
    setFieldValue(modalUi, 'street', Core.streetLine(query) || trim(query.street) || street);
    setFieldValue(modalUi, 'postcode', trim(query.postcode));
    setFieldValue(modalUi, 'city', trim(query.city));
    setFieldValue(modalUi, 'countryCode', query.countryCode);

    modalUi.postcodeHint.textContent = Core.postcodeHint(query.countryCode);
    var postcodeField = modalUi.form.querySelector('[name="postcode"]');
    if (postcodeField) postcodeField.placeholder = (Core.getCountry(query.countryCode) || {}).example || '';

    clearAllErrors(modalUi.form);
    modalUi.error.hidden = true;
    modalUi.error.textContent = '';
    modalUi.results.hidden = true;
    modalUi.resultsList.innerHTML = '';
    modalUi.submit.disabled = false;
    modalUi.submit.textContent = 'Lancer la recherche';
    modal.results = [];
    modal.busy = false;
  }

  function setFieldValue(modalUi, name, value) {
    var field = modalUi.form.querySelector('[name="' + name + '"]');
    if (field) field.value = value == null ? '' : value;
  }

  function fieldValue(modalUi, name) {
    var field = modalUi.form.querySelector('[name="' + name + '"]');
    return field ? trim(field.value) : '';
  }

  function readForm(modalUi) {
    return {
      company: fieldValue(modalUi, 'company'),
      street: fieldValue(modalUi, 'street'),
      housenumber: '',
      postcode: fieldValue(modalUi, 'postcode'),
      city: fieldValue(modalUi, 'city'),
      countryCode: fieldValue(modalUi, 'countryCode') || CFG.defaultCountry
    };
  }

  function clearFieldError(form, name) {
    var field = form.querySelector('[data-field="' + name + '"]');
    if (!field) return;
    field.removeAttribute('data-invalid');
    var error = field.querySelector('[data-error]');
    if (error) error.textContent = '';
  }

  function clearAllErrors(form) {
    $$('[data-field]', form).forEach(function (field) {
      field.removeAttribute('data-invalid');
      var error = field.querySelector('[data-error]');
      if (error) error.textContent = '';
    });
  }

  function showFieldErrors(form, errors) {
    var first = null;
    Object.keys(errors).forEach(function (name) {
      var field = form.querySelector('[data-field="' + name + '"]');
      if (!field) return;
      field.setAttribute('data-invalid', '1');
      var error = field.querySelector('[data-error]');
      if (error) error.textContent = errors[name];
      if (!first) first = field;
    });
    if (first) {
      var input = first.querySelector('input, select');
      if (input && input.focus) input.focus();
    }
  }

  function openModal(name) {
    var modalUi = UI.modals[name];
    if (!modalUi) return;
    closeModal(openModalName);
    modal.name = name;
    openModalName = name;
    lastFocused = document.activeElement;
    fillModal(name);
    modalUi.root.hidden = false;
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    var firstInput = modalUi.form.querySelector('input[name="street"]');
    if (firstInput) {
      window.setTimeout(function () {
        firstInput.focus();
        if (firstInput.select && (firstInput.value === '' || firstInput.value == null)) {
          firstInput.select();
        }
      }, 30);
    }
    emit('modal:open', { bloc: name });
  }

  function closeModal(name) {
    var target = name || openModalName;
    if (!target) return;
    var modalUi = UI.modals[target];
    if (modalUi) modalUi.root.hidden = true;
    if (openModalName === target) openModalName = null;
    document.body.style.overflow = bodyOverflow || '';
    if (lastFocused && lastFocused.focus && document.contains(lastFocused)) {
      try { lastFocused.focus(); } catch (e) { /* ignore */ }
    }
    lastFocused = null;
  }

  function handleSearch(name) {
    var modalUi = UI.modals[name];
    if (!modalUi || modal.busy) return;
    var fields = readForm(modalUi);
    var check = Core.validateSearchFields(fields);
    clearAllErrors(modalUi.form);
    modalUi.error.hidden = true;
    if (!check.ok) {
      showFieldErrors(modalUi.form, check.errors);
      modalUi.error.textContent = 'Merci de vérifier les champs signalés.';
      modalUi.error.hidden = false;
      return;
    }

    modal.busy = true;
    modal.query = fields;
    modalUi.results.hidden = true;
    modalUi.resultsList.innerHTML = '';
    modalUi.submit.disabled = true;
    modalUi.submit.textContent = 'Recherche en cours…';

    var plan = Core.buildGeocodePlan(fields, {
      geopfUrl: CFG.urls.geopf,
      photonUrl: CFG.urls.photon,
      banLimit: 8,
      photonLimit: 10
    });

    firstSuccessful(plan, function (step, payload) {
      var results = step.provider === 'ban'
        ? Core.parseGeopf(payload)
        : Core.parsePhoton(payload, fields.countryCode);
      if (step.provider === 'photon') {
        results = results.slice(0, CFG.maxResults);
      }
      return results;
    }).then(function (outcome) {
      modal.busy = false;
      modalUi.submit.disabled = false;
      modalUi.submit.textContent = 'Nouvelle recherche';
      var merged = Core.mergeResults([outcome.results || []]).slice(0, CFG.maxResults);
      modal.results = merged;
      if (!merged.length) {
        var networkDown = outcome.failures > 0 && outcome.failures >= outcome.planned;
        modalUi.error.textContent = networkDown
          ? 'La recherche est momentanément indisponible. Vérifiez votre connexion puis réessayez.'
          : 'Aucune adresse trouvée. Vérifiez le numéro et la ville, ou essayez le nom de l’entreprise.';
        modalUi.error.hidden = false;
        emit(networkDown ? 'search:error' : 'search:empty', { bloc: name, query: fields });
        return;
      }
      renderResults(modalUi, merged);
      emit('search:results', { bloc: name, count: merged.length, query: fields });
    }).catch(function (error) {
      modal.busy = false;
      modalUi.submit.disabled = false;
      modalUi.submit.textContent = 'Lancer la recherche';
      modalUi.error.textContent = 'La recherche est momentanément indisponible. Réessayez dans quelques instants.';
      modalUi.error.hidden = false;
      log('Recherche en échec', error && error.message);
      emit('search:error', { bloc: name, message: error && error.message });
    });
  }

  function renderResults(modalUi, results) {
    modalUi.resultsList.innerHTML = '';
    results.forEach(function (result, index) {
      var label = document.createElement('label');
      label.className = 'loc-result';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'loc-result-' + modal.name;
      input.value = String(index);
      if (index === 0) input.checked = true;
      var body = document.createElement('span');
      body.className = 'loc-result__body';
      var labelText = document.createElement('span');
      labelText.className = 'loc-result__label';
      labelText.textContent = result.label || Core.formatCoords(result.lat, result.lon);
      var meta = document.createElement('span');
      meta.className = 'loc-result__meta';
      var metaBits = [];
      if (result.postcode || result.city) {
        metaBits.push([result.postcode, result.city].filter(Boolean).join(' '));
      }
      metaBits.push(Core.formatCoords(result.lat, result.lon));
      meta.textContent = metaBits.join(' · ');
      var precision = document.createElement('span');
      precision.className = 'loc-result__precision';
      precision.textContent = Core.precisionLabel(result.precision) + (result.providerLabel ? ' · ' + result.providerLabel : '');
      body.appendChild(labelText);
      body.appendChild(meta);
      body.appendChild(precision);
      label.appendChild(input);
      label.appendChild(body);
      modalUi.resultsList.appendChild(label);
    });
    modalUi.resultsTitle.textContent = results.length > 1
      ? results.length + ' adresses trouvées — sélectionnez la bonne'
      : 'Une adresse trouvée';
    modalUi.results.hidden = false;
  }

  function useSelectedResult(name) {
    var modalUi = UI.modals[name];
    if (!modalUi) return;
    var checked = modalUi.resultsList.querySelector('input[type="radio"]:checked');
    var index = checked ? parseInt(checked.value, 10) : 0;
    var result = modal.results[index];
    if (!result) return;
    applyResult(name, result, readForm(modalUi));
  }

  function applyResult(name, result, fields) {
    var block = STATE[name];
    var address = Core.sanitizeAddress(result);
    block.query = {
      company: trim(fields.company),
      housenumber: address.housenumber || '',
      street: address.street || trim(fields.street),
      postcode: address.postcode || trim(fields.postcode),
      city: address.city || trim(fields.city),
      countryCode: address.countryCode || trim(fields.countryCode) || CFG.defaultCountry
    };
    block.address = address;
    block.validated = false;
    block.updatedAt = nowIso();
    if (name === 'batiment') {
      block.photo = null;
      block.photos = [];
      block.mode = 'aerienne';
    }
    renderBlock(name);
    refreshMap(name);
    syncHiddenFields();
    persist();
    closeModal(name);
    if (name === 'batiment') {
      setStatus('batiment', 'Adresse du bâtiment enregistrée. Recherche des images de rue…', 'loading');
      loadBuildingPhotos();
    } else {
      setStatus('localisation', 'Adresse trouvée. Vérifiez le repère (déplaçable), puis cliquez sur « Valider ».', 'ok');
    }
    emit('change', { bloc: name, source: 'recherche' });
  }

  /* ================================================================== *
   * Message de garde (validation avant de poursuivre)
   * ================================================================== */
  function showGate() {
    if (!UI.gate) return;
    var missing = BLOCKS.filter(function (name) { return !STATE[name].validated; });
    if (!missing.length) {
      hideGate();
      return;
    }
    var labels = missing.map(function (name) { return BLOCK_FIELD[name]; });
    UI.gateText.textContent = labels.length === 1
      ? 'Il reste à valider : ' + labels[0] + '.'
      : 'Il reste à valider : ' + labels.join(' et ') + '.';
    UI.gate.hidden = false;
    missing.forEach(function (name) {
      UI.blocks[name].root.setAttribute('data-attention', '1');
    });
    var target = UI.blocks[missing[0]].root;
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function hideGate() {
    if (!UI.gate) return;
    UI.gate.hidden = true;
    BLOCKS.forEach(function (name) {
      UI.blocks[name].root.removeAttribute('data-attention');
    });
  }

  function onDocumentClick(event) {
    if (!CFG.requireValidation || gateBypassed) return;
    var target = event.target;
    if (!target || !target.closest) return;
    var nextBtn = target.closest('[data-form="next-btn"]');
    if (!nextBtn || !rootEl.contains(nextBtn)) return;
    if (Core.isStateValidated(STATE)) {
      hideGate();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    showGate();
    emit('validation:requise', {});
  }

  function skipValidation() {
    gateBypassed = true;
    hideGate();
    emit('validation:ignoree', {});
    if (UI.nextBtn) {
      UI.nextBtn.click();
    }
  }

  /* ================================================================== *
   * Visibilité de l'étape
   * ================================================================== */
  function syncVisibility(force) {
    var visible = isStepVisible();
    if (visible) {
      /* Reprend l'adresse de l'étape « société » dès l'affichage de l'étape. */
      maybeAutoFill(false);
    }
    if (!force && visible === lastVisible) {
      if (visible) {
        BLOCKS.forEach(function (name) {
          if (MAPS[name]) window.setTimeout(function () { MAPS[name].map.invalidateSize(); }, 60);
        });
      }
      return;
    }
    lastVisible = visible;
    if (cardEl) cardEl.classList.toggle('loc-widen', visible);
    if (!visible) return;
    renderBlock('localisation');
    if (STATE.batiment.address || STATE.batiment.mode === 'rue') renderBlock('batiment');
    window.setTimeout(function () {
      BLOCKS.forEach(function (name) {
        if (MAPS[name]) MAPS[name].map.invalidateSize();
      });
    }, 160);
  }

  /* ================================================================== *
   * Initialisation
   * ================================================================== */
  function collectBlocks() {
    BLOCKS.forEach(function (name) {
      var root = rootEl.querySelector('[data-loc-bloc="' + name + '"]');
      if (!root) return;
      var ui = {
        root: root,
        address: root.querySelector('[data-loc-address]'),
        coords: root.querySelector('[data-loc-coords]'),
        meta: root.querySelector('[data-loc-meta]'),
        badge: root.querySelector('[data-loc-badge]'),
        status: root.querySelector('[data-loc-status]'),
        searchBtn: root.querySelector('[data-loc-search]'),
        validateBtn: root.querySelector('[data-loc-validate]')
      };
      ui.media = root.querySelector('[data-loc-media]');
      ui.map = root.querySelector('[data-loc-map]');
      ui.placeholder = root.querySelector('[data-loc-placeholder]');
      ui.placeholderTitle = root.querySelector('[data-loc-placeholder-title]');
      ui.placeholderText = root.querySelector('[data-loc-placeholder-text]');
      ui.loading = root.querySelector('[data-loc-loading]');
      ui.credit = root.querySelector('[data-loc-credit]');
      ui.tabs = $$('[data-loc-view]', root);
      ui.rue = root.querySelector('[data-loc-rue]');
      ui.rueImg = root.querySelector('[data-loc-rue-img]');
      ui.rueCredit = root.querySelector('[data-loc-rue-credit]');
      ui.rueAddress = root.querySelector('[data-loc-rue-address]');
      ui.ruePrev = root.querySelector('[data-loc-rue-prev]');
      ui.rueNext = root.querySelector('[data-loc-rue-next]');
      ui.rueLink = root.querySelector('[data-loc-rue-link]');
      ui.aerialTrigger = root.querySelector('[data-loc-view-aerial]');
      UI.blocks[name] = ui;
      bindBlock(name, ui);
    });
  }

  function bindBlock(name, ui) {
    wx(ui.searchBtn, 'click', function () { openModal(name); });
    wx(ui.validateBtn, 'click', function () { validateBlock(name); });

    (ui.tabs || []).forEach(function (tab) {
      wx(tab, 'click', function () { setView(name, tab.getAttribute('data-loc-view')); });
    });
    wx(ui.ruePrev, 'click', function () { stepStreet(name, -1); });
    wx(ui.rueNext, 'click', function () { stepStreet(name, 1); });
    wx(ui.aerialTrigger, 'click', function () { setView(name, 'aerienne'); });
    wx(ui.rueImg, 'error', function () {
      setStatus(name, 'L’image de rue n’a pas pu être chargée. La carte et la photo aérienne restent disponibles.', 'error');
      setView(name, 'aerienne');
    });
  }

  function bindGlobalEvents() {
    document.addEventListener('click', onDocumentClick, true);

    document.addEventListener('keydown', function (event) {
      if (!openModalName) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal(openModalName);
        return;
      }
      if (event.key === 'Tab') {
        var modalUi = UI.modals[openModalName];
        if (!modalUi) return;
        var focusables = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modalUi.panel)
          .filter(function (el) { return !el.disabled && el.offsetParent !== null; });
        if (!focusables.length) return;
        var first = focusables[0];
        var last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    if (UI.skipBtn) {
      UI.skipBtn.addEventListener('click', skipValidation);
    }

    window.addEventListener('resize', function () {
      if (MAPS.localisation) MAPS.localisation.map.invalidateSize();
      if (MAPS.batiment) MAPS.batiment.map.invalidateSize();
      syncVisibility(true);
    });

    if (formEl && CFG.clearStoredOnSubmit) {
      formEl.addEventListener('submit', function () {
        window.setTimeout(function () {
          try {
            window.localStorage.removeItem(CFG.storageKey);
          } catch (e) {
            log('Purge du stockage impossible', e);
          }
        }, 15000);
      });
    }
  }

  function watchSteps() {
    if (!formEl || typeof MutationObserver === 'undefined') return;
    var observer = new MutationObserver(function () {
      syncVisibility(false);
    });
    observer.observe(formEl, {
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden'],
      subtree: true
    });
  }

  function init() {
    rootEl = document.getElementById('loc-section');
    if (!rootEl) return;
    stepEl = rootEl.closest ? rootEl.closest('[data-form="step"]') : null;
    formEl = rootEl.closest ? rootEl.closest('form') : null;
    cardEl = rootEl.closest ? rootEl.closest('.formulaire-iard') : null;

    if (formEl) {
      hiddenEl = document.createElement('div');
      hiddenEl.className = 'loc-hidden-fields';
      hiddenEl.setAttribute('aria-hidden', 'true');
      formEl.appendChild(hiddenEl);
    }

    UI.gate = rootEl.querySelector('[data-loc-gate]');
    UI.gateText = rootEl.querySelector('[data-loc-gate-text]');
    UI.skipBtn = rootEl.querySelector('[data-loc-skip]');
    UI.nextBtn = rootEl.querySelector('[data-form="next-btn"]');

    STATE = loadState();
    collectBlocks();
    BLOCKS.forEach(buildModal);
    renderAll();
    syncHiddenFields();
    bindGlobalEvents();
    watchSteps();
    syncVisibility(true);

    window.setTimeout(function () { syncVisibility(false); }, 400);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) syncVisibility(true);
    });

    /* API publique (intégrations CRM / tests) */
    window.LocalisationEntreprise = {
      version: '1.0.0',
      getState: function () { return Core.sanitizeState(STATE); },
      getLeadFields: function () { return Core.toLeadFields(STATE); },
      getRecap: function () { return Core.toRecap(STATE); },
      isValidated: function () { return Core.isStateValidated(STATE); },
      isRequired: function () { return CFG.requireValidation; },
      prefill: function () { return maybeAutoFill(true); },
      getConfig: function () { return JSON.parse(JSON.stringify(CFG)); },
      getTileProviders: function () { return streetTileProviders(); },
      getView: function (name) { return viewOf(name === 'batiment' ? 'batiment' : 'localisation'); },
      setView: function (name, view) { setView(name === 'batiment' ? 'batiment' : 'localisation', view); },
      open: function (name) { openModal(name === 'batiment' ? 'batiment' : 'localisation'); },
      reset: function () {
        STATE = Core.createState();
        modal.photoIndex = 0;
        renderAll();
        syncHiddenFields();
        persist();
      }
    };

    log('Module localisation initialisé', { requireValidation: CFG.requireValidation });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
