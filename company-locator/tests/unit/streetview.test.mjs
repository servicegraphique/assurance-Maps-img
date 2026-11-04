/**
 * Tests unitaires — streetview.js : disponibilité des sources immersives,
 * construction des URL, absence de clé dans le JavaScript public.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STREETVIEW_PROVIDERS,
  buildPanoramaxEmbed,
  buildMapillaryEmbed,
  buildGoogleEmbed,
  availableProviders,
  pickProvider,
  embedUrlFor,
  describeImmersion,
  nativePhotoId,
  normalizeHeading,
  frameAttributes,
  detectGoogleStreetView,
} from '../../js/streetview.js';

const pano360 = {
  id: 'panoramax:890b6268-7716-4e34-ada9-69985e6c1657',
  provider: 'panoramax',
  providerName: 'Panoramax',
  isPano: true,
  distanceM: 12,
  direction: 123.4,
  thumbUrl: 'https://api.panoramax.xyz/api/pictures/x/thumb.jpg',
  pageUrl: 'https://api.panoramax.xyz/#focus=pic&pic=x',
};
const panoFlat = { ...pano360, id: 'panoramax:flat-1', isPano: false, distanceM: 5 };
const mly = {
  id: 'mapillary:550092599700936',
  provider: 'mapillary',
  providerName: 'Mapillary',
  isPano: true,
  distanceM: 30,
  thumbUrl: 'https://scontent.example/thumb.jpg',
};

/* ----------------------------- Identifiants ------------------------ */

test('nativePhotoId retire le préfixe de fournisseur', () => {
  assert.equal(nativePhotoId(pano360), '890b6268-7716-4e34-ada9-69985e6c1657');
  assert.equal(nativePhotoId(mly), '550092599700936');
  assert.equal(nativePhotoId({ id: 'sans-prefixe' }), 'sans-prefixe');
  assert.equal(nativePhotoId(null), '');
});

/* ----------------------------- Panoramax --------------------------- */

test('Panoramax : URL immersive officielle avec orientation', () => {
  const url = buildPanoramaxEmbed(pano360, { heading: 90, pitch: -10, zoom: 40 });
  assert.ok(url.startsWith('https://api.panoramax.xyz/#focus=pic&pic='));
  assert.match(url, /pic=890b6268-7716-4e34-ada9-69985e6c1657/);
  assert.match(url, /xyz=90\.00\/-10\.00\/40$/);
});

test('Panoramax : sans cap fourni, on regarde dans l\'axe de la prise de vue', () => {
  assert.match(buildPanoramaxEmbed(pano360), /xyz=123\.40\//);
});

test('Panoramax : orientation bornée et cap normalisé', () => {
  assert.match(buildPanoramaxEmbed(pano360, { heading: -90, pitch: 500, zoom: 900 }), /xyz=270\.00\/90\.00\/100$/);
  assert.equal(normalizeHeading(-90), 270);
  assert.equal(normalizeHeading(720), 0);
  assert.equal(normalizeHeading('abc'), 0);
});

test('Panoramax : aucune URL pour une photo d\'un autre fournisseur', () => {
  assert.equal(buildPanoramaxEmbed(mly), null);
  assert.equal(buildPanoramaxEmbed(null), null);
});

test('Panoramax : la navigation dans la séquence n\'est pas désactivée', () => {
  assert.equal(buildPanoramaxEmbed(pano360).includes('nav=none'), false);
});

/* ----------------------------- Mapillary --------------------------- */

test('Mapillary : embed public, aucun jeton dans l\'URL', () => {
  const url = buildMapillaryEmbed(mly);
  assert.equal(new URL(url).origin + new URL(url).pathname, 'https://www.mapillary.com/embed');
  assert.equal(new URL(url).searchParams.get('image_key'), '550092599700936');
  assert.equal(new URL(url).searchParams.get('style'), 'photo');
  assert.equal(/access_token|client_token|MLY\|/.test(url), false);
});

test('Mapillary : style borné aux valeurs documentées', () => {
  assert.equal(new URL(buildMapillaryEmbed(mly, { style: 'split' })).searchParams.get('style'), 'split');
  assert.equal(new URL(buildMapillaryEmbed(mly, { style: 'pirate' })).searchParams.get('style'), 'photo');
});

/* ----------------------------- Google ------------------------------ */

test('Google : URL de même origine, la clé reste côté serveur', () => {
  const url = buildGoogleEmbed({ lat: 48.8509, lon: 2.2896, heading: 45, pitch: 5, fov: 80 });
  assert.ok(url.startsWith('/api/streetview/embed?'), url);
  const params = new URLSearchParams(url.split('?')[1]);
  assert.equal(params.get('lat'), '48.8509');
  assert.equal(params.get('lon'), '2.2896');
  assert.equal(params.get('heading'), '45.0');
  assert.equal(params.get('pitch'), '5.0');
  assert.equal(params.get('fov'), '80');
  assert.equal(params.get('radius'), '50');
  assert.equal(/key=|AIza/.test(url), false, 'aucune clé ne doit transiter par le JS');
});

test('Google : une coordonnée absente n\'est jamais interprétée comme 0', () => {
  // Number(null) === 0 : piège classique, golfe de Guinée garanti sinon.
  assert.equal(buildGoogleEmbed({ lat: 48.85, lon: null }), null);
  assert.equal(buildGoogleEmbed({ lat: null, lon: 2.29 }), null);
  assert.equal(buildGoogleEmbed({ lat: 48.85, lon: '' }), null);
  assert.equal(buildGoogleEmbed({ lat: 48.85 }), null);
  // Mais 0 reste une valeur légitime.
  assert.ok(buildGoogleEmbed({ lat: 0, lon: 0 }));
});

test('Google : coordonnées invalides refusées', () => {
  assert.equal(buildGoogleEmbed({ lat: 999, lon: 2 }), null);
  assert.equal(buildGoogleEmbed({ lat: 48, lon: 'abc' }), null);
  assert.equal(buildGoogleEmbed({}), null);
  assert.equal(buildGoogleEmbed(), null);
});

test('Google : champ de vision et inclinaison bornés', () => {
  const params = new URLSearchParams(buildGoogleEmbed({ lat: 48, lon: 2, fov: 500, pitch: -500, radiusM: 99999 }).split('?')[1]);
  assert.equal(params.get('fov'), '100');
  assert.equal(params.get('pitch'), '-90.0');
  assert.equal(params.get('radius'), '1000');
});

/* ----------------------------- Disponibilité ----------------------- */

test('Sans photo ni clé : aucune source prête, chaque refus est expliqué', () => {
  const providers = availableProviders({ photos: [], position: { lat: 48, lon: 2 }, googleConfigured: false });
  assert.equal(providers.length, 3);
  assert.deepEqual(providers.map((p) => p.status), ['unavailable', 'unavailable', 'unavailable']);
  providers.forEach((p) => assert.ok(p.reason.length > 20, `${p.key} sans explication`));
  assert.match(providers.find((p) => p.key === 'google').reason, /facturation activée/);
  assert.equal(pickProvider(providers), null);
});

test('Panoramax seul suffit : source prête sans aucune clé', () => {
  const providers = availableProviders({ photos: [pano360], position: { lat: 48, lon: 2 } });
  const panoramax = providers.find((p) => p.key === 'panoramax');
  assert.equal(panoramax.status, 'ready');
  assert.equal(panoramax.needsKey, false);
  assert.equal(pickProvider(providers).key, 'panoramax');
});

test('Les photographies sphériques sont préférées aux photos planes', () => {
  const providers = availableProviders({ photos: [panoFlat, pano360], position: null });
  const panoramax = providers.find((p) => p.key === 'panoramax');
  assert.equal(panoramax.photo.id, pano360.id, 'la 360° doit passer devant même si plus lointaine');
  assert.equal(panoramax.photos.length, 2);
});

test('Google devient disponible dès qu\'une clé est configurée, même sans photo locale', () => {
  const providers = availableProviders({ photos: [], position: { lat: 48.85, lon: 2.29 }, googleConfigured: true });
  const google = providers.find((p) => p.key === 'google');
  assert.equal(google.status, 'ready');
  assert.ok(google.url.startsWith('/api/streetview/embed?'));
});

test('Google reste indisponible sans coordonnées, même avec une clé', () => {
  const providers = availableProviders({ photos: [], position: null, googleConfigured: true });
  const google = providers.find((p) => p.key === 'google');
  assert.equal(google.status, 'unavailable');
  assert.match(google.reason, /Coordonnées indisponibles/);
});

test('La source préférée est respectée quand elle est prête', () => {
  const providers = availableProviders({ photos: [pano360, mly], position: { lat: 48, lon: 2 }, googleConfigured: true });
  assert.equal(pickProvider(providers, 'mapillary').key, 'mapillary');
  assert.equal(pickProvider(providers, 'google').key, 'google');
});

test('Une source préférée indisponible retombe sur une source prête', () => {
  const providers = availableProviders({ photos: [pano360], position: null, googleConfigured: false });
  assert.equal(pickProvider(providers, 'google').key, 'panoramax');
});

/* ----------------------------- Immersion --------------------------- */

test('Une photo plate n\'est jamais présentée comme immersive', () => {
  assert.equal(describeImmersion(pano360).immersive, true);
  const flat = describeImmersion(panoFlat);
  assert.equal(flat.immersive, false);
  assert.equal(flat.label, 'Photographie plane');
  assert.match(flat.detail, /sans vision à 360/);
});

test('embedUrlFor route vers le bon constructeur', () => {
  assert.match(embedUrlFor('panoramax', { photo: pano360 }), /^https:\/\/api\.panoramax\.xyz/);
  assert.match(embedUrlFor('mapillary', { photo: mly }), /^https:\/\/www\.mapillary\.com\/embed/);
  assert.match(embedUrlFor('google', { position: { lat: 48, lon: 2 } }), /^\/api\/streetview\/embed/);
  assert.equal(embedUrlFor('inconnu', {}), null);
});

/* ----------------------------- Cadre tiers ------------------------- */

test('Le cadre tiers est durci : sandbox, pas de référent, plein écran autorisé', () => {
  const attrs = frameAttributes('Vue immersive');
  assert.match(attrs.sandbox, /allow-scripts/);
  assert.match(attrs.sandbox, /allow-same-origin/);
  assert.equal(attrs.referrerpolicy, 'no-referrer');
  assert.equal(attrs.loading, 'lazy');
  assert.equal(attrs.allowfullscreen, 'true');
  assert.equal(attrs.title, 'Vue immersive');
});

test('Aucune source n\'exige de clé payante par défaut', () => {
  assert.equal(STREETVIEW_PROVIDERS.panoramax.needsKey, false);
  assert.equal(STREETVIEW_PROVIDERS.mapillary.needsKey, false);
  assert.equal(STREETVIEW_PROVIDERS.google.needsKey, true);
});

test('Hors navigateur, Google est considéré non configuré (aucun appel)', async () => {
  const state = await detectGoogleStreetView({ force: true });
  assert.equal(state.configured, false);
});
