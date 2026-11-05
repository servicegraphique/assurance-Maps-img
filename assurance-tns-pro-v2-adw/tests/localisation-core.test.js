'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const Core = require(path.join(__dirname, '..', 'localisation-core.js'));

const FR_QUERY = {
  company: 'Dupont & Fils',
  housenumber: '12',
  street: 'rue de la Paix',
  postcode: '75002',
  city: 'Paris',
  countryCode: 'FR'
};

function geopfPayload() {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [2.33115, 48.868989] },
        properties: {
          label: '12 Rue de la Paix 75002 Paris',
          type: 'housenumber',
          housenumber: '12',
          street: 'Rue de la Paix',
          postcode: '75002',
          city: 'Paris',
          score: 0.96,
          banId: 'abc'
        }
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [2.33, 48.86] },
        properties: { label: 'Paris 2e Arrondissement', type: 'municipality', city: 'Paris', postcode: '75002' }
      }
    ]
  };
}

function photonPayload() {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [4.3525, 50.8467] },
        properties: {
          osm_type: 'N',
          type: 'house',
          housenumber: '5',
          street: 'Grand-Place',
          city: 'Bruxelles',
          postcode: '1000',
          country: 'Belgique',
          countrycode: 'BE'
        }
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [2.3311, 48.8690] },
        properties: {
          type: 'house',
          housenumber: '10',
          street: 'Rue de la Paix',
          city: 'Paris',
          postcode: '75002',
          country: 'France',
          countrycode: 'FR'
        }
      }
    ]
  };
}

test('buildSearchQuery privilégie la rue et complète pays', () => {
  assert.equal(
    Core.buildSearchQuery(FR_QUERY),
    '12 rue de la Paix, 75002 Paris, France'
  );
});

test('buildSearchQuery utilise le nom de l’entreprise sans rue', () => {
  assert.equal(
    Core.buildSearchQuery({ company: 'Boulangerie Martin', postcode: '69002', city: 'Lyon', countryCode: 'FR' }),
    'Boulangerie Martin, 69002 Lyon, France'
  );
});

test('buildGeocodePlan interroge la BAN puis Photon en France', () => {
  const plan = Core.buildGeocodePlan(FR_QUERY, {});
  assert.equal(plan.length, 2);
  assert.equal(plan[0].provider, 'ban');
  assert.match(plan[0].url, /^https:\/\/data\.geopf\.fr\/geocodage\/search\?/);
  assert.match(plan[0].url, /postcode=75002/);
  assert.equal(plan[1].provider, 'photon');
  assert.match(plan[1].url, /photon\.komoot\.io\/api\//);
});

test('buildGeocodePlan n’utilise que Photon hors France', () => {
  const plan = Core.buildGeocodePlan({
    street: 'Grand-Place 5', postcode: '1000', city: 'Bruxelles', countryCode: 'BE'
  }, {});
  assert.equal(plan.length, 1);
  assert.equal(plan[0].provider, 'photon');
});

test('parseGeopf normalise les types et les coordonnées', () => {
  const results = Core.parseGeopf(geopfPayload());
  assert.equal(results.length, 2);
  assert.equal(results[0].precision, 'numero');
  assert.equal(results[0].lat, 48.868989);
  assert.equal(results[0].lon, 2.33115);
  assert.equal(results[0].provider, 'ban');
  assert.equal(results[0].countryCode, 'FR');
  assert.equal(results[1].precision, 'commune');
});

test('parseGeopf ignore les entrées sans géométrie valide', () => {
  const results = Core.parseGeopf({ features: [{ properties: {} }, null, { geometry: { coordinates: ['a', 'b'] } }] });
  assert.deepEqual(results, []);
});

test('parsePhoton filtre sur le pays et construit un libellé lisible', () => {
  const results = Core.parsePhoton(photonPayload(), 'BE');
  assert.equal(results.length, 1);
  assert.equal(results[0].countryCode, 'BE');
  assert.equal(results[0].label, '5 Grand-Place, 1000 Bruxelles, Belgique');
  assert.equal(results[0].precision, 'numero');
  assert.equal(results[0].lon, 4.3525);
});

test('mergeResults déduplique les doublons de coordonnées', () => {
  const ban = Core.parseGeopf(geopfPayload());
  const photon = Core.parsePhoton(photonPayload(), 'FR');
  const merged = Core.mergeResults([ban, photon]);
  assert.equal(merged.length, 3);
});

test('isValidPostcode gère les formats européens', () => {
  assert.equal(Core.isValidPostcode('FR', '75002'), true);
  assert.equal(Core.isValidPostcode('FR', '7500'), false);
  assert.equal(Core.isValidPostcode('BE', '1000'), true);
  assert.equal(Core.isValidPostcode('NL', '1012 AB'), true);
  assert.equal(Core.isValidPostcode('NL', '1012AB'), true);
  assert.equal(Core.isValidPostcode('GB', 'SW1A 1AA'), true);
  assert.equal(Core.isValidPostcode('GB', 'SW1A1AA'), true);
  assert.equal(Core.isValidPostcode('PT', '1250-096'), true);
  assert.equal(Core.isValidPostcode('LV', 'LV-1050'), true);
  assert.equal(Core.isValidPostcode('IE', ''), true);
  assert.equal(Core.isValidPostcode('IE', 'D02 X285'), true);
  assert.equal(Core.isValidPostcode('XX', '12'), true);
});

test('validateSearchFields signale les champs manquants', () => {
  const check = Core.validateSearchFields({ countryCode: 'FR' });
  assert.equal(check.ok, false);
  assert.ok(check.errors.street);
  assert.ok(check.errors.city);
  assert.ok(check.errors.postcode);
});

test('validateSearchFields accepte le nom d’entreprise seul', () => {
  const check = Core.validateSearchFields({
    company: 'Garage Central', postcode: '33000', city: 'Bordeaux', countryCode: 'FR'
  });
  assert.equal(check.ok, true);
});

test('validateSearchFields refuse un code postal invalide', () => {
  const check = Core.validateSearchFields({ street: '1 rue X', postcode: '7500', city: 'Paris', countryCode: 'FR' });
  assert.equal(check.ok, false);
  assert.match(check.errors.postcode, /invalide/i);
});

test('distanceMeters et bboxAround restent cohérents', () => {
  const d = Core.distanceMeters(48.868989, 2.33115, 48.858844, 2.294351);
  assert.ok(d > 2800 && d < 3200, 'distance Opéra/Tour Eiffel ~2,9 km, obtenu ' + d);
  const bbox = Core.bboxAround(48.868989, 2.33115, 90);
  assert.equal(bbox.length, 4);
  assert.ok(bbox[0] < 2.33115 && bbox[2] > 2.33115);
  assert.ok(bbox[1] < 48.868989 && bbox[3] > 48.868989);
});

test('buildPanoramaxUrl encode la bbox et la limite', () => {
  const url = Core.buildPanoramaxUrl(48.868989, 2.33115, { photoLimit: 12, photoRadiusMeters: 90 });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://api.panoramax.xyz/api/search');
  assert.match(parsed.searchParams.get('bbox'), /^-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+$/);
  assert.equal(parsed.searchParams.get('limit'), '12');
});

test('parsePanoramax trie par distance et ignore les images non prêtes', () => {
  const payload = {
    features: [
      {
        id: 'loin',
        geometry: { type: 'Point', coordinates: [2.3320, 48.8695] },
        assets: { thumb: { href: 'https://exemple/loin-thumb.jpg' }, sd: { href: 'https://exemple/loin.jpg' } },
        providers: [{ name: 'Alice' }],
        properties: { 'geovisio:status': 'ready', license: 'CC-BY-SA-4.0', datetime: '2024-05-01T10:00:00Z' },
        links: [{ rel: 'license', title: 'License for this object (CC-BY-SA-4.0)', href: 'https://creativecommons.org/licenses/by-sa/4.0/' }]
      },
      {
        id: 'proche',
        geometry: { type: 'Point', coordinates: [2.3312, 48.8690] },
        assets: { thumb: { href: 'https://exemple/proche-thumb.jpg' }, sd: { href: 'https://exemple/proche.jpg' } },
        providers: [{ name: 'Bob' }],
        properties: { 'geovisio:status': 'ready', license: 'CC-BY-SA-4.0' }
      },
      {
        id: 'pas-prete',
        geometry: { type: 'Point', coordinates: [2.3311, 48.8689] },
        assets: { thumb: { href: 'https://exemple/x.jpg' } },
        properties: { 'geovisio:status': 'processing' }
      }
    ]
  };
  const results = Core.parsePanoramax(payload, 48.868989, 2.33115);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'proche');
  assert.equal(results[0].credit, 'Bob');
  assert.equal(results[0].provider, 'panoramax');
  assert.match(results[0].viewerUrl, /api\.panoramax\.xyz\/#focus=pic&pic=proche/);
  assert.ok(results[0].distance < results[1].distance);
});

test('parseCommons retient les photos et ignore les SVG', () => {
  const payload = {
    query: {
      pages: {
        '1': {
          title: 'File:Facade.jpg',
          coordinates: [{ lat: 48.8690, lon: 2.3312 }],
          imageinfo: [{
            url: 'https://upload.wikimedia.org/facade.jpg',
            thumburl: 'https://upload.wikimedia.org/facade-800.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Facade.jpg',
            extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="#">Jane Doe</a>' } }
          }]
        },
        '2': {
          title: 'File:Carte.svg',
          imageinfo: [{ url: 'https://upload.wikimedia.org/carte.svg' }]
        }
      }
    }
  };
  const results = Core.parseCommons(payload, 48.868989, 2.33115);
  assert.equal(results.length, 1);
  assert.equal(results[0].thumb, 'https://upload.wikimedia.org/facade-800.jpg');
  assert.equal(results[0].credit, 'Jane Doe');
  assert.equal(results[0].license, 'CC BY-SA 4.0');
  assert.equal(results[0].provider, 'commons');
});

test('buildReversePlan propose la BAN puis Photon', () => {
  const plan = Core.buildReversePlan(48.8689, 2.3311, {});
  assert.deepEqual(plan.map((step) => step.provider), ['ban-reverse', 'photon-reverse']);
  assert.match(plan[0].url, /data\.geopf\.fr\/geocodage\/reverse\?/);
  assert.match(plan[1].url, /photon\.komoot\.io\/reverse\?/);
});

test('parseReverse conserve les coordonnées demandées', () => {
  const address = Core.parseReverse(geopfPayload(), 48.8691, 2.3312, 'FR');
  assert.equal(address.lat, 48.8691);
  assert.equal(address.lon, 2.3312);
  assert.equal(address.precision, 'numero');
});

test('manualAddress produit une adresse de repli exploitable', () => {
  const address = Core.manualAddress(FR_QUERY, 48.8691, 2.3312);
  assert.equal(address.provider, 'manuel');
  assert.equal(address.lat, 48.8691);
  assert.equal(address.precision, 'approximatif');
  assert.match(address.label, /12 rue de la Paix/);
});

test('toLeadFields expose les champs loc_ attendus', () => {
  const state = Core.createState();
  state.localisation = {
    query: FR_QUERY,
    address: Core.sanitizeAddress(Core.parseGeopf(geopfPayload())[0]),
    validated: true,
    mode: 'ign'
  };
  state.batiment = {
    query: FR_QUERY,
    address: Core.sanitizeAddress(Core.parseGeopf(geopfPayload())[0]),
    photo: Core.sanitizePhoto({
      provider: 'panoramax',
      providerLabel: 'Panoramax',
      thumb: 'https://exemple/thumb.jpg',
      image: 'https://exemple/photo.jpg',
      credit: 'Alice',
      license: 'CC-BY-SA-4.0'
    }),
    mode: 'facade',
    validated: true
  };
  const fields = Core.toLeadFields(state);
  assert.equal(fields.loc_adresse, '12 Rue de la Paix 75002 Paris');
  assert.equal(fields.loc_code_postal, '75002');
  assert.equal(fields.loc_pays, 'France');
  assert.equal(fields.loc_latitude, '48.868989');
  assert.equal(fields.loc_longitude, '2.331150');
  assert.equal(fields.loc_validee, 'oui');
  assert.equal(fields.loc_batiment_photo, 'https://exemple/photo.jpg');
  assert.equal(fields.loc_batiment_photo_source, 'Panoramax');
  assert.equal(fields.loc_batiment_vue, 'rue');
  assert.equal(fields.loc_vue, 'plan ign');
  assert.equal(fields.loc_batiment_validee, 'oui');
  assert.match(fields.loc_batiment_vue_aerienne, /bboxSR=4326/);
  assert.match(Core.toRecap(state), /Bâtiment - photo : Panoramax/);
});

test('toLeadFields laisse vides les champs non renseignés', () => {
  const fields = Core.toLeadFields(Core.createState());
  assert.equal(fields.loc_adresse, '');
  assert.equal(fields.loc_latitude, '');
  assert.equal(fields.loc_batiment_validee, 'non');
  assert.equal(fields.loc_batiment_vue, 'vue aerienne');
  assert.equal(Core.isStateValidated(Core.createState()), false);
});

test('la vue aérienne est le mode d’affichage par défaut du bâtiment', () => {
  const state = Core.createState();
  assert.equal(state.batiment.mode, 'aerienne');
  assert.equal(Core.sanitizeState({}).batiment.mode, 'aerienne');
  // Ancienne valeur enregistrée : « facade » devient la vue « rue ».
  const legacy = Core.sanitizeState({ batiment: { mode: 'facade' } });
  assert.equal(legacy.batiment.mode, 'rue');
  const street = Core.sanitizeState({ localisation: { mode: 'rue' }, batiment: { mode: 'ign' } });
  assert.equal(street.localisation.mode, 'rue');
  assert.equal(street.batiment.mode, 'ign');
});

test('sanitizeState écarte les coordonnées invalides', () => {
  const state = Core.sanitizeState({
    version: 1,
    localisation: { address: { label: 'Test', lat: 'nord', lon: null }, validated: true },
    batiment: { address: { label: 'X', lat: 1, lon: 2 }, validated: true }
  });
  assert.equal(state.localisation.address, null);
  assert.equal(state.localisation.validated, false);
  assert.equal(state.batiment.validated, true);
  assert.equal(Core.isStateValidated(state), false);
});

test('parseState tolère un stockage corrompu ou une autre version', () => {
  assert.deepEqual(Core.parseState('{oops'), Core.createState());
  assert.deepEqual(Core.parseState(JSON.stringify({ version: 99 })), Core.createState());
  const roundTrip = Core.parseState(Core.serializeState(Core.createState()));
  assert.equal(roundTrip.version, Core.STATE_VERSION);
});

test('la liste des pays contient la France en premier et couvre l’Europe', () => {
  assert.equal(Core.COUNTRIES[0].code, 'FR');
  const codes = Core.COUNTRIES.map((country) => country.code);
  ['BE', 'CH', 'ES', 'IT', 'DE', 'NL', 'PT', 'GB', 'IE', 'PL'].forEach((code) => {
    assert.ok(codes.includes(code), 'pays manquant : ' + code);
  });
  assert.ok(codes.length >= 40);
});

test('le script de la page et les fichiers du module existent', () => {
  const root = path.join(__dirname, '..');
  ['localisation.js', 'localisation-core.js', 'localisation.css', 'index.html',
    'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css'].forEach((file) => {
    assert.ok(fs.existsSync(path.join(root, file)), 'fichier manquant : ' + file);
  });
});

test('index.html branche l’étape localisation dans le parcours', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /data-go-to="localisation" data-answer="code-postal"/);
  assert.match(html, /data-answer="localisation" data-go-to="societe"/);
  assert.match(html, /id="loc-section"/);
  assert.match(html, /href="localisation\.css"/);
  assert.match(html, /src="localisation-core\.js" defer/);
  assert.match(html, /src="localisation\.js" defer/);
  assert.equal((html.match(/data-loc-bloc=/g) || []).length, 2);
  assert.equal((html.match(/data-loc-map=/g) || []).length, 2);
  assert.equal((html.match(/data-loc-validate/g) || []).length, 2);
  assert.equal((html.match(/data-loc-search/g) || []).length, 2);
});

test('lead-handler relaie les champs de localisation', () => {
  const handler = fs.readFileSync(path.join(__dirname, '..', 'lead-handler.js'), 'utf8');
  assert.match(handler, /window\.LocalisationEntreprise/);
  assert.match(handler, /loc_adresse/);
  assert.match(handler, /loc_batiment_photo/);
});
