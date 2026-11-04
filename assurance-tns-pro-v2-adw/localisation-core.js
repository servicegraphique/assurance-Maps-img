/* localisation-core.js — logique pure du module « Localisation et identification
 * de votre entreprise ».
 *
 * Aucun accès au DOM : ce fichier contient les listes de pays, la construction
 * des requêtes de géocodage / d'imagerie, l'analyse des réponses et la
 * normalisation de l'état. Il est chargé comme global (window.LocCore) par la
 * page et comme module CommonJS par les tests (node --test).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LocCore = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Pays européens pris en charge
   * ------------------------------------------------------------------ *
   * postcode : expression régulière appliquée après normalisation
   *            (majuscules, espaces et tirets retirés pour le test).
   * optional : vrai lorsque le code postal n'est pas obligatoire
   *            (Irlande : Eircode facultatif).
   */
  var COUNTRIES = [
    { code: 'FR', name: 'France', pattern: /^\d{5}$/, example: '75002' },
    { code: 'BE', name: 'Belgique', pattern: /^\d{4}$/, example: '1000' },
    { code: 'LU', name: 'Luxembourg', pattern: /^\d{4}$/, example: 'L-1648' },
    { code: 'CH', name: 'Suisse', pattern: /^\d{4}$/, example: '1201' },
    { code: 'MC', name: 'Monaco', pattern: /^\d{5}$/, example: '98000' },
    { code: 'AD', name: 'Andorre', pattern: /^AD\d{3}$/, example: 'AD500' },
    { code: 'ES', name: 'Espagne', pattern: /^\d{5}$/, example: '28013' },
    { code: 'PT', name: 'Portugal', pattern: /^\d{4}-?\d{3}$/, example: '1250-096' },
    { code: 'IT', name: 'Italie', pattern: /^\d{5}$/, example: '00187' },
    { code: 'DE', name: 'Allemagne', pattern: /^\d{5}$/, example: '10117' },
    { code: 'AT', name: 'Autriche', pattern: /^\d{4}$/, example: '1010' },
    { code: 'NL', name: 'Pays-Bas', pattern: /^\d{4}\s?[A-Z]{2}$/, example: '1012 AB' },
    { code: 'GB', name: 'Royaume-Uni', pattern: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/, example: 'SW1A 1AA' },
    { code: 'IE', name: 'Irlande', pattern: /^[A-Z]\d{2}\s?[A-Z0-9]{4}$/, example: 'D02 X285', optional: true },
    { code: 'DK', name: 'Danemark', pattern: /^\d{4}$/, example: '1050' },
    { code: 'SE', name: 'Suède', pattern: /^\d{3}\s?\d{2}$/, example: '111 20' },
    { code: 'NO', name: 'Norvège', pattern: /^\d{4}$/, example: '0158' },
    { code: 'FI', name: 'Finlande', pattern: /^\d{5}$/, example: '00100' },
    { code: 'IS', name: 'Islande', pattern: /^\d{3}$/, example: '101' },
    { code: 'PL', name: 'Pologne', pattern: /^\d{2}-?\d{3}$/, example: '00-001' },
    { code: 'CZ', name: 'Tchéquie', pattern: /^\d{3}\s?\d{2}$/, example: '110 00' },
    { code: 'SK', name: 'Slovaquie', pattern: /^\d{3}\s?\d{2}$/, example: '811 01' },
    { code: 'HU', name: 'Hongrie', pattern: /^\d{4}$/, example: '1051' },
    { code: 'RO', name: 'Roumanie', pattern: /^\d{6}$/, example: '010011' },
    { code: 'BG', name: 'Bulgarie', pattern: /^\d{4}$/, example: '1000' },
    { code: 'GR', name: 'Grèce', pattern: /^\d{3}\s?\d{2}$/, example: '105 57' },
    { code: 'HR', name: 'Croatie', pattern: /^\d{5}$/, example: '10000' },
    { code: 'SI', name: 'Slovénie', pattern: /^\d{4}$/, example: '1000' },
    { code: 'RS', name: 'Serbie', pattern: /^\d{5}$/, example: '11000' },
    { code: 'BA', name: 'Bosnie-Herzégovine', pattern: /^\d{5}$/, example: '71000' },
    { code: 'ME', name: 'Monténégro', pattern: /^\d{5}$/, example: '81000' },
    { code: 'MK', name: 'Macédoine du Nord', pattern: /^\d{4}$/, example: '1000' },
    { code: 'AL', name: 'Albanie', pattern: /^\d{4}$/, example: '1001' },
    { code: 'XK', name: 'Kosovo', pattern: /^\d{5}$/, example: '10000' },
    { code: 'EE', name: 'Estonie', pattern: /^\d{5}$/, example: '10111' },
    { code: 'LV', name: 'Lettonie', pattern: /^(LV-?)?\d{4}$/, example: 'LV-1050' },
    { code: 'LT', name: 'Lituanie', pattern: /^(LT-?)?\d{5}$/, example: 'LT-01100' },
    { code: 'MT', name: 'Malte', pattern: /^[A-Z]{3}\s?\d{4}$/, example: 'VLT 1117' },
    { code: 'CY', name: 'Chypre', pattern: /^\d{4}$/, example: '1010' },
    { code: 'MD', name: 'Moldavie', pattern: /^MD-?\d{4}$/, example: 'MD-2012' },
    { code: 'UA', name: 'Ukraine', pattern: /^\d{5}$/, example: '01001' },
    { code: 'TR', name: 'Turquie', pattern: /^\d{5}$/, example: '34000' },
    { code: 'SM', name: 'Saint-Marin', pattern: /^\d{5}$/, example: '47890' },
    { code: 'LI', name: 'Liechtenstein', pattern: /^\d{4}$/, example: '9490' }
  ];

  var COUNTRY_BY_CODE = COUNTRIES.reduce(function (map, country) {
    map[country.code] = country;
    return map;
  }, {});

  /* ------------------------------------------------------------------ *
   * Utilitaires texte
   * ------------------------------------------------------------------ */
  function normalizeSpace(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeKey(value) {
    var text = normalizeSpace(value).toLowerCase();
    return text.normalize ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text;
  }

  function stripHtml(value) {
    return normalizeSpace(String(value == null ? '' : value).replace(/<[^>]*>/g, ' '));
  }

  function getCountry(code) {
    return COUNTRY_BY_CODE[String(code || '').toUpperCase()] || null;
  }

  function countryName(code) {
    var country = getCountry(code);
    return country ? country.name : normalizeSpace(code);
  }

  /* Code postal : normalisation légère (majuscules + espaces réduits) puis
   * test sur une version sans espaces ni tirets pour absorber les variantes
   * de saisie (75002 / 750 02, SW1A1AA / SW1A 1AA, LV1050 / LV-1050). */
  function normalizePostcode(value) {
    return normalizeSpace(value).toUpperCase();
  }

  function isValidPostcode(countryCode, value) {
    var country = getCountry(countryCode);
    var postcode = normalizePostcode(value);
    if (!country) return postcode.length >= 2 && postcode.length <= 12;
    if (!postcode) return country.optional === true;
    var compact = postcode.replace(/[\s-]/g, '');
    if (country.pattern.test(postcode)) return true;
    if (country.pattern.test(compact)) return true;
    /* Variante compacte sans préfixe pays (LV-1050 -> 1050). */
    var stripped = compact.replace(/^[A-Z]{2}/, '');
    return stripped !== compact && country.pattern.test(stripped);
  }

  function postcodeHint(countryCode) {
    var country = getCountry(countryCode);
    if (!country) return '';
    if (country.optional) return 'Exemple : ' + country.example + ' (facultatif)';
    return 'Exemple : ' + country.example;
  }

  /* ------------------------------------------------------------------ *
   * Recherche d'adresse
   * ------------------------------------------------------------------ */
  function streetLine(query) {
    return normalizeSpace([query.housenumber, query.street].filter(Boolean).join(' '));
  }

  /* Requête textuelle commune aux géocodeurs. Le nom de l'entreprise n'est
   * utilisé que lorsque la rue n'est pas connue : l'ajouter systématiquement
   * dégrade fortement la précision des géocodeurs d'adresse. */
  function buildSearchQuery(query) {
    query = query || {};
    var parts = [];
    var street = streetLine(query);
    if (street) {
      parts.push(street);
    } else if (normalizeSpace(query.company)) {
      parts.push(normalizeSpace(query.company));
    }
    var locality = normalizeSpace([normalizePostcode(query.postcode), normalizeSpace(query.city)].filter(Boolean).join(' '));
    if (locality) parts.push(locality);
    var country = countryName(query.countryCode);
    if (country) parts.push(country);
    return parts.join(', ');
  }

  /* Plan de géocodage : base adresse nationale (France) puis Photon
   * (couverture européenne, sans clé). Chaque étape est tentée dans l'ordre
   * jusqu'à obtenir au moins un résultat. */
  function buildGeocodePlan(query, config) {
    config = config || {};
    query = query || {};
    var geopfUrl = config.geopfUrl || 'https://data.geopf.fr/geocodage/search';
    var photonUrl = config.photonUrl || 'https://photon.komoot.io/api/';
    var q = buildSearchQuery(query);
    var plan = [];
    if (!q) return plan;

    if (query.countryCode === 'FR' && streetLine(query)) {
      var ban = new URL(geopfUrl);
      ban.searchParams.set('q', q);
      ban.searchParams.set('limit', String(config.banLimit || 8));
      if (normalizePostcode(query.postcode)) {
        ban.searchParams.set('postcode', normalizePostcode(query.postcode).replace(/\s/g, ''));
      }
      plan.push({ provider: 'ban', url: ban.toString() });
    }

    var photon = new URL(photonUrl);
    photon.searchParams.set('q', q);
    photon.searchParams.set('limit', String(config.photonLimit || 10));
    photon.searchParams.set('lang', 'fr');
    plan.push({ provider: 'photon', url: photon.toString() });
    return plan;
  }

  /* Analyse BAN / Géoplateforme (api data.geopf.fr/geocodage) */
  function parseGeopf(payload) {
    var features = payload && Array.isArray(payload.features) ? payload.features : [];
    var results = [];
    features.forEach(function (feature) {
      if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) return;
      var props = feature.properties || {};
      var type = String(props.type || '');
      var precision = 'adresse';
      if (type === 'housenumber') precision = 'numero';
      else if (type === 'street') precision = 'rue';
      else if (type === 'locality' || type === 'municipality' || type === 'village') precision = 'commune';
      else if (type && type !== 'housenumber') precision = 'approximatif';
      results.push({
        provider: 'ban',
        providerLabel: 'Base Adresse Nationale',
        label: normalizeSpace(props.label || props.name || ''),
        housenumber: normalizeSpace(props.housenumber || ''),
        street: normalizeSpace(props.street || props.name || ''),
        postcode: normalizePostcode(props.postcode || ''),
        city: normalizeSpace(props.city || props.municipality || ''),
        countryCode: 'FR',
        country: 'France',
        lat: Number(feature.geometry.coordinates[1]),
        lon: Number(feature.geometry.coordinates[0]),
        precision: precision,
        score: typeof props.score === 'number' ? props.score : null,
        banId: props.banId || props.id || ''
      });
    });
    return results.filter(function (r) {
      return isFinite(r.lat) && isFinite(r.lon);
    });
  }

  /* Analyse Photon (komoot) — renvoie des adresses, lieux-dits et POI
   * (utile lorsque l'utilisateur ne connaît que le nom de l'entreprise). */
  function parsePhoton(payload, expectedCountry) {
    var features = payload && Array.isArray(payload.features) ? payload.features : [];
    var wanted = expectedCountry ? String(expectedCountry).toUpperCase() : '';
    var results = [];
    features.forEach(function (feature) {
      if (!feature || !feature.geometry || !Array.isArray(feature.geometry.coordinates)) return;
      var props = feature.properties || {};
      var countryCode = String(props.countrycode || '').toUpperCase();
      if (wanted && countryCode && countryCode !== wanted) return;
      var street = normalizeSpace(props.street || '');
      var name = normalizeSpace(props.name || '');
      var type = String(props.type || '');
      var precision = 'adresse';
      if (type === 'house' || type === 'housenumber') precision = 'numero';
      else if (type === 'street') precision = 'rue';
      else if (type === 'city' || type === 'district') precision = 'commune';
      else if (type === 'locality') precision = 'approximatif';
      var labelParts = [
        normalizeSpace([props.housenumber, street || name].filter(Boolean).join(' ')),
        normalizeSpace([normalizePostcode(props.postcode), normalizeSpace(props.city || props.district || props.locality)].filter(Boolean).join(' ')),
        normalizeSpace(props.country || '')
      ].filter(Boolean);
      results.push({
        provider: 'photon',
        providerLabel: 'OpenStreetMap (Photon)',
        label: normalizeSpace(labelParts.join(', ')),
        housenumber: normalizeSpace(props.housenumber || ''),
        street: street || (props.osm_key === 'place' ? '' : name),
        name: name,
        postcode: normalizePostcode(props.postcode || ''),
        city: normalizeSpace(props.city || props.district || props.locality || ''),
        countryCode: countryCode || (wanted || ''),
        country: normalizeSpace(props.country || countryName(countryCode)),
        lat: Number(feature.geometry.coordinates[1]),
        lon: Number(feature.geometry.coordinates[0]),
        precision: precision,
        score: null,
        banId: ''
      });
    });
    return results.filter(function (r) {
      return isFinite(r.lat) && isFinite(r.lon);
    });
  }

  function mergeResults(lists) {
    var out = [];
    var seen = {};
    (lists || []).forEach(function (list) {
      (list || []).forEach(function (item) {
        var key = [item.lat.toFixed(5), item.lon.toFixed(5)].join(',');
        if (seen[key]) return;
        seen[key] = true;
        out.push(item);
      });
    });
    return out;
  }

  /* Géocodage inverse */
  function buildReversePlan(lat, lon, config) {
    config = config || {};
    var geopfUrl = config.geopfReverseUrl || 'https://data.geopf.fr/geocodage/reverse';
    var photonUrl = config.photonReverseUrl || 'https://photon.komoot.io/reverse';
    var a = new URL(geopfUrl);
    a.searchParams.set('lat', String(lat));
    a.searchParams.set('lon', String(lon));
    a.searchParams.set('limit', '1');
    var b = new URL(photonUrl);
    b.searchParams.set('lat', String(lat));
    b.searchParams.set('lon', String(lon));
    b.searchParams.set('limit', '1');
    return [
      { provider: 'ban-reverse', url: a.toString() },
      { provider: 'photon-reverse', url: b.toString() }
    ];
  }

  function parseReverse(payload, lat, lon, fallbackCountry) {
    var fromGeopf = parseGeopf(payload);
    var results = fromGeopf.length ? fromGeopf : parsePhoton(payload, fallbackCountry);
    if (!results.length) return null;
    var best = results[0];
    best.lat = Number(lat);
    best.lon = Number(lon);
    best.label = best.label || formatCoords(lat, lon);
    return best;
  }

  /* ------------------------------------------------------------------ *
   * Photographies du bâtiment
   * ------------------------------------------------------------------ */
  function distanceMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bboxAround(lat, lon, radiusMeters) {
    var dLat = radiusMeters / 111320;
    var cos = Math.cos(lat * Math.PI / 180);
    var dLon = radiusMeters / (111320 * (Math.abs(cos) < 0.00001 ? 0.00001 : cos));
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
  }

  function buildPanoramaxUrl(lat, lon, config) {
    config = config || {};
    var base = config.panoramaxUrl || 'https://api.panoramax.xyz/api/search';
    var url = new URL(base);
    var bbox = bboxAround(lat, lon, config.photoRadiusMeters || 90);
    url.searchParams.set('bbox', bbox.map(function (v) { return v.toFixed(6); }).join(','));
    url.searchParams.set('limit', String(config.photoLimit || 20));
    return url.toString();
  }

  function parsePanoramax(payload, lat, lon) {
    var features = payload && Array.isArray(payload.features) ? payload.features : [];
    var out = [];
    features.forEach(function (feature) {
      if (!feature || !feature.assets || !feature.geometry) return;
      var coords = feature.geometry.coordinates || [];
      var props = feature.properties || {};
      if (props['geovisio:status'] && props['geovisio:status'] !== 'ready') return;
      var assets = feature.assets;
      var thumb = assets.thumb && assets.thumb.href;
      var image = (assets.sd && assets.sd.href) || (assets.hd && assets.hd.href);
      if (!thumb && !image) return;
      var producer = '';
      if (Array.isArray(feature.providers) && feature.providers.length) producer = feature.providers[0].name || '';
      if (!producer) producer = props['geovisio:producer'] || '';
      var license = props.license || '';
      var licenseLink = '';
      (feature.links || []).forEach(function (link) {
        if (link && link.rel === 'license') {
          if (!license) license = link.title || '';
          licenseLink = link.href || '';
        }
      });
      out.push({
        provider: 'panoramax',
        providerLabel: 'Panoramax',
        id: feature.id || '',
        thumb: thumb || image,
        image: image || thumb,
        credit: producer,
        license: license,
        licenseLink: licenseLink,
        datetime: props.datetime || props.created || '',
        azimuth: typeof props['view:azimuth'] === 'number' ? props['view:azimuth'] : null,
        lat: Number(coords[1]),
        lon: Number(coords[0]),
        distance: isFinite(coords[1]) && isFinite(coords[0]) ? distanceMeters(lat, lon, Number(coords[1]), Number(coords[0])) : Infinity,
        viewerUrl: feature.id ? 'https://api.panoramax.xyz/#focus=pic&pic=' + encodeURIComponent(feature.id) : ''
      });
    });
    return out
      .filter(function (item) { return isFinite(item.distance); })
      .sort(function (a, b) { return a.distance - b.distance; });
  }

  function buildCommonsUrl(lat, lon, config) {
    config = config || {};
    var base = config.commonsUrl || 'https://commons.wikimedia.org/w/api.php';
    var url = new URL(base);
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    url.searchParams.set('generator', 'geosearch');
    url.searchParams.set('ggscoord', lat + '|' + lon);
    url.searchParams.set('ggsradius', String(Math.round(config.commonsRadiusMeters || 120)));
    url.searchParams.set('ggslimit', '10');
    url.searchParams.set('ggsnamespace', '6');
    url.searchParams.set('prop', 'coordinates|imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata');
    url.searchParams.set('iiurlwidth', '800');
    url.searchParams.set('iiextmetadatafilter', 'LicenseShortName|Artist');
    return url.toString();
  }

  function parseCommons(payload, lat, lon) {
    var pages = payload && payload.query && payload.query.pages ? payload.query.pages : {};
    var out = [];
    Object.keys(pages).forEach(function (key) {
      var page = pages[key] || {};
      var info = page.imageinfo && page.imageinfo[0];
      if (!info) return;
      var title = String(page.title || '');
      if (!/\.(jpe?g|png|webp)$/i.test(title)) return;
      var meta = info.extmetadata || {};
      var coords = page.coordinates && page.coordinates[0];
      out.push({
        provider: 'commons',
        providerLabel: 'Wikimedia Commons',
        id: title,
        thumb: info.thumburl || info.url,
        image: info.url || info.thumburl,
        credit: stripHtml(meta.Artist && meta.Artist.value) || 'Contributeurs Wikimedia Commons',
        license: stripHtml(meta.LicenseShortName && meta.LicenseShortName.value) || '',
        licenseLink: info.descriptionurl || '',
        datetime: '',
        lat: coords ? Number(coords.lat) : lat,
        lon: coords ? Number(coords.lon) : lon,
        distance: coords ? distanceMeters(lat, lon, Number(coords.lat), Number(coords.lon)) : Infinity,
        viewerUrl: info.descriptionurl || ''
      });
    });
    return out.sort(function (a, b) { return a.distance - b.distance; });
  }

  /* Image aérienne statique (repli sans Leaflet) */
  function buildAerialImageUrl(lat, lon, config) {
    config = config || {};
    var base = config.aerialExportUrl || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export';
    var halfLat = 0.00035;
    var halfLon = 0.0006;
    var url = new URL(base);
    url.searchParams.set('bbox', [lon - halfLon, lat - halfLat, lon + halfLon, lat + halfLat].join(','));
    url.searchParams.set('bboxSR', '4326');
    url.searchParams.set('imageSR', '4326');
    url.searchParams.set('size', '640,360');
    url.searchParams.set('format', 'jpg');
    url.searchParams.set('f', 'image');
    return url.toString();
  }

  /* ------------------------------------------------------------------ *
   * Validation des saisies
   * ------------------------------------------------------------------ */
  function validateSearchFields(fields) {
    fields = fields || {};
    var errors = {};
    var country = getCountry(fields.countryCode);
    var street = streetLine(fields);
    var company = normalizeSpace(fields.company);

    if (!country) errors.countryCode = 'Sélectionnez un pays.';
    if (!street && !company) {
      errors.street = 'Indiquez le numéro et le nom de rue, ou à défaut le nom de l\u2019entreprise.';
    }
    if (!normalizeSpace(fields.city)) errors.city = 'Indiquez la ville.';
    if (country && country.optional !== true && !normalizeSpace(fields.postcode)) {
      errors.postcode = 'Indiquez le code postal.';
    } else if (normalizeSpace(fields.postcode) && !isValidPostcode(fields.countryCode, fields.postcode)) {
      errors.postcode = 'Code postal invalide pour ' + countryName(fields.countryCode) + ' (' + postcodeHint(fields.countryCode) + ').';
    }

    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      query: buildSearchQuery(fields)
    };
  }

  function formatCoords(lat, lon) {
    var la = Number(lat);
    var lo = Number(lon);
    if (!isFinite(la) || !isFinite(lo)) return '';
    return la.toFixed(6) + ', ' + lo.toFixed(6);
  }

  function formatCoordLabel(lat, lon) {
    var la = Number(lat);
    var lo = Number(lon);
    if (!isFinite(la) || !isFinite(lo)) return '';
    return 'Lat. ' + la.toFixed(6) + ' \u00B7 Lon. ' + lo.toFixed(6);
  }

  function precisionLabel(precision) {
    var map = {
      numero: 'Num\u00E9ro de rue',
      rue: 'Rue',
      commune: 'Commune',
      approximatif: 'Approximatif',
      adresse: 'Adresse'
    };
    return map[precision] || 'Adresse';
  }

  /* ------------------------------------------------------------------ *
   * Saisie libre d'une adresse (repli lorsque le géocodage échoue)
   * ------------------------------------------------------------------ */
  function manualAddress(fields, lat, lon) {
    fields = fields || {};
    var street = streetLine(fields);
    return {
      provider: 'manuel',
      providerLabel: 'Saisie manuelle',
      label: [normalizeSpace([street, normalizePostcode(fields.postcode), normalizeSpace(fields.city)].filter(Boolean).join(' ')), countryName(fields.countryCode)].filter(Boolean).join(', '),
      housenumber: normalizeSpace(fields.housenumber || ''),
      street: normalizeSpace(fields.street || ''),
      postcode: normalizePostcode(fields.postcode || ''),
      city: normalizeSpace(fields.city || ''),
      countryCode: String(fields.countryCode || '').toUpperCase(),
      country: countryName(fields.countryCode),
      lat: isFinite(lat) ? Number(lat) : null,
      lon: isFinite(lon) ? Number(lon) : null,
      precision: 'approximatif',
      score: null,
      banId: ''
    };
  }

  /* ------------------------------------------------------------------ *
   * État, persistance et champs de lead
   * ------------------------------------------------------------------ */
  var STATE_VERSION = 1;
  var DEFAULT_QUERY = {
    company: '',
    housenumber: '',
    street: '',
    postcode: '',
    city: '',
    countryCode: 'FR'
  };

  function emptyBlock() {
    return {
      query: Object.assign({}, DEFAULT_QUERY),
      address: null,
      photo: null,
      photos: [],
      mode: 'facade',
      validated: false,
      updatedAt: ''
    };
  }

  function createState() {
    return {
      version: STATE_VERSION,
      localisation: emptyBlock(),
      batiment: emptyBlock()
    };
  }

  function sanitizeAddress(address) {
    if (!address || typeof address !== 'object') return null;
    var lat = Number(address.lat);
    var lon = Number(address.lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    return {
      provider: String(address.provider || ''),
      providerLabel: String(address.providerLabel || ''),
      label: normalizeSpace(address.label),
      housenumber: normalizeSpace(address.housenumber),
      street: normalizeSpace(address.street),
      postcode: normalizePostcode(address.postcode),
      city: normalizeSpace(address.city),
      countryCode: String(address.countryCode || '').toUpperCase(),
      country: normalizeSpace(address.country),
      lat: lat,
      lon: lon,
      precision: String(address.precision || ''),
      score: typeof address.score === 'number' ? address.score : null,
      banId: String(address.banId || '')
    };
  }

  function sanitizePhoto(photo) {
    if (!photo || typeof photo !== 'object') return null;
    var url = String(photo.image || photo.thumb || '');
    if (!url) return null;
    return {
      provider: String(photo.provider || ''),
      providerLabel: String(photo.providerLabel || ''),
      id: String(photo.id || ''),
      thumb: String(photo.thumb || url),
      image: url,
      credit: String(photo.credit || ''),
      license: String(photo.license || ''),
      licenseLink: String(photo.licenseLink || ''),
      datetime: String(photo.datetime || ''),
      viewerUrl: String(photo.viewerUrl || ''),
      distance: isFinite(Number(photo.distance)) ? Number(photo.distance) : null
    };
  }

  function sanitizeBlock(block) {
    var base = emptyBlock();
    if (!block || typeof block !== 'object') return base;
    var query = block.query && typeof block.query === 'object' ? block.query : {};
    Object.keys(DEFAULT_QUERY).forEach(function (key) {
      if (query[key] != null) base.query[key] = String(query[key]);
    });
    base.address = sanitizeAddress(block.address);
    base.photo = sanitizePhoto(block.photo);
    base.mode = block.mode === 'aerienne' ? 'aerienne' : 'facade';
    base.validated = block.validated === true && !!base.address;
    base.updatedAt = String(block.updatedAt || '');
    return base;
  }

  function sanitizeState(state) {
    var base = createState();
    if (!state || typeof state !== 'object') return base;
    base.localisation = sanitizeBlock(state.localisation);
    base.batiment = sanitizeBlock(state.batiment);
    return base;
  }

  function parseState(raw) {
    if (!raw) return createState();
    try {
      var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || parsed.version !== STATE_VERSION) return createState();
      return sanitizeState(parsed);
    } catch (e) {
      return createState();
    }
  }

  function serializeState(state) {
    return JSON.stringify(sanitizeState(state));
  }

  function addressFields(prefix, block) {
    var address = block && block.address ? block.address : null;
    var fields = {};
    fields[prefix + '_adresse'] = address ? address.label : '';
    fields[prefix + '_rue'] = address ? normalizeSpace([address.housenumber, address.street].filter(Boolean).join(' ')) : '';
    fields[prefix + '_code_postal'] = address ? address.postcode : '';
    fields[prefix + '_ville'] = address ? address.city : '';
    fields[prefix + '_pays'] = address ? address.country : '';
    fields[prefix + '_pays_code'] = address ? address.countryCode : '';
    fields[prefix + '_latitude'] = address && isFinite(address.lat) ? address.lat.toFixed(6) : '';
    fields[prefix + '_longitude'] = address && isFinite(address.lon) ? address.lon.toFixed(6) : '';
    fields[prefix + '_precision'] = address ? address.precision : '';
    fields[prefix + '_source'] = address ? address.provider : '';
    fields[prefix + '_validee'] = block && block.validated ? 'oui' : 'non';
    return fields;
  }

  /* Champs envoyés dans le lead (CRM / Google Sheets). */
  function toLeadFields(state) {
    var safe = sanitizeState(state);
    var fields = {};
    var loc = addressFields('loc', safe.localisation);
    Object.keys(loc).forEach(function (key) { fields[key] = loc[key]; });

    var bat = addressFields('loc_batiment', safe.batiment);
    Object.keys(bat).forEach(function (key) { fields[key] = bat[key]; });
    var photo = safe.batiment.photo;
    fields.loc_batiment_photo = photo ? photo.image : '';
    fields.loc_batiment_photo_vignette = photo ? photo.thumb : '';
    fields.loc_batiment_photo_source = photo ? photo.providerLabel || photo.provider : '';
    fields.loc_batiment_photo_licence = photo ? photo.license : '';
    fields.loc_batiment_photo_auteur = photo ? photo.credit : '';
    fields.loc_batiment_photo_date = photo ? photo.datetime : '';
    fields.loc_batiment_photo_lien = photo ? (photo.viewerUrl || '') : '';
    fields.loc_batiment_vue = safe.batiment.mode === 'aerienne' ? 'vue aerienne' : 'facade';
    fields.loc_batiment_vue_aerienne = safe.batiment.address
      ? buildAerialImageUrl(safe.batiment.address.lat, safe.batiment.address.lon)
      : '';
    fields.loc_batiment_validee = safe.batiment.validated ? 'oui' : 'non';
    return fields;
  }

  /* Récapitulatif lisible, ajouté au champ « autre_info_fj » du lead pour
   * que les informations apparaissent aussi dans Google Sheets. */
  function toRecap(state) {
    var safe = sanitizeState(state);
    var lines = [];
    ['localisation', 'batiment'].forEach(function (key) {
      var block = safe[key];
      if (!block.address) return;
      var title = key === 'localisation' ? 'Localisation' : 'Bâtiment';
      lines.push(title + ' : ' + block.address.label + ' (' + formatCoords(block.address.lat, block.address.lon) + ')');
      if (key === 'batiment' && block.photo) {
        lines.push('Bâtiment - photo : ' + (block.photo.providerLabel || block.photo.provider) + (block.photo.license ? ' (' + block.photo.license + ')' : ''));
      }
    });
    return lines.join('\n');
  }

  function isStateValidated(state) {
    var safe = sanitizeState(state);
    return safe.localisation.validated && safe.batiment.validated;
  }

  return {
    COUNTRIES: COUNTRIES,
    STATE_VERSION: STATE_VERSION,
    DEFAULT_QUERY: DEFAULT_QUERY,
    getCountry: getCountry,
    countryName: countryName,
    normalizeSpace: normalizeSpace,
    normalizeKey: normalizeKey,
    normalizePostcode: normalizePostcode,
    isValidPostcode: isValidPostcode,
    postcodeHint: postcodeHint,
    streetLine: streetLine,
    buildSearchQuery: buildSearchQuery,
    buildGeocodePlan: buildGeocodePlan,
    parseGeopf: parseGeopf,
    parsePhoton: parsePhoton,
    mergeResults: mergeResults,
    buildReversePlan: buildReversePlan,
    parseReverse: parseReverse,
    distanceMeters: distanceMeters,
    bboxAround: bboxAround,
    buildPanoramaxUrl: buildPanoramaxUrl,
    parsePanoramax: parsePanoramax,
    buildCommonsUrl: buildCommonsUrl,
    parseCommons: parseCommons,
    buildAerialImageUrl: buildAerialImageUrl,
    validateSearchFields: validateSearchFields,
    formatCoords: formatCoords,
    formatCoordLabel: formatCoordLabel,
    precisionLabel: precisionLabel,
    manualAddress: manualAddress,
    emptyBlock: emptyBlock,
    createState: createState,
    sanitizeAddress: sanitizeAddress,
    sanitizePhoto: sanitizePhoto,
    sanitizeState: sanitizeState,
    parseState: parseState,
    serializeState: serializeState,
    toLeadFields: toLeadFields,
    toRecap: toRecap,
    isStateValidated: isStateValidated
  };
});
