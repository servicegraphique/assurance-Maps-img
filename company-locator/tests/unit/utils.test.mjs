/**
 * Tests unitaires — utils.js (validations, géographie, cache, HTTP).
 * Exécution : node --test tests/unit/
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidSiren, isValidSiret, isValidCodePostal, formatSiren, formatSiret,
  departmentFromCode, haversineM, isPlausibleFranceCoords, bboxAround, parseCoord,
  normalizeText, similarity, levenshtein, uniqBy, escapeHtml, safeUrl,
  RateLimiter, TtlCache, fetchJson, AppError, ERR, slugifyFilename,
} from '../../js/utils.js';

test('SIREN : longueur et clé de Luhn', () => {
  assert.equal(isValidSiren('732829320'), true);
  assert.equal(isValidSiren('130 025 265'), true, 'les espaces sont ignorés');
  assert.equal(isValidSiren('732829321'), false, 'clé incorrecte');
  assert.equal(isValidSiren('12345678'), false, '8 chiffres');
  assert.equal(isValidSiren('356000000'), true, 'dérogation La Poste');
  assert.equal(isValidSiren('abcdefghi'), false);
});

test('SIRET : 14 chiffres, Luhn et cas La Poste', () => {
  assert.equal(isValidSiret('13002526500013'), true);
  assert.equal(isValidSiret('73282932000017'), true);
  assert.equal(isValidSiret('73282932000018'), false);
  assert.equal(isValidSiret('35600000000001'), true, 'La Poste : somme des chiffres multiple de 5');
  assert.equal(isValidSiret('35600000000002'), false, 'La Poste : somme non multiple de 5');
  assert.equal(isValidSiret('1300252650001'), false);
});

test('Codes postaux français acceptés / refusés', () => {
  ['75015', '69002', '59000', '20000', '20137', '97100', '97600', '01000', '2A001'].forEach((cp) => {
    assert.equal(isValidCodePostal(cp), true, cp);
  });
  ['7501', '750155', '00000', '99000', 'ABCDE', '', '2B00'].forEach((cp) => {
    assert.equal(isValidCodePostal(cp), false, cp);
  });
});

test('Formatage des identifiants', () => {
  assert.equal(formatSiren('732829320'), '732 829 320');
  assert.equal(formatSiret('13002526500013'), '130 025 265 00013');
  assert.equal(formatSiren('123'), '123');
});

test('Département déduit du code postal / code commune', () => {
  assert.equal(departmentFromCode('75015', '75115'), '75');
  assert.equal(departmentFromCode('97100', '97105'), '971');
  assert.equal(departmentFromCode('20000', '2A004'), '2A');
  assert.equal(departmentFromCode('20200', '2B033'), '2B');
  assert.equal(departmentFromCode('20100', ''), '2A');
  assert.equal(departmentFromCode('20300', ''), '2B');
  assert.equal(departmentFromCode('', '69123'), '69');
});

test('Distance haversine : Paris → Lyon ≈ 392 km', () => {
  const distance = haversineM(48.8566, 2.3522, 45.7640, 4.8357);
  assert.ok(distance > 385000 && distance < 400000, `distance=${distance}`);
  assert.equal(Math.round(haversineM(48.85, 2.35, 48.85, 2.35)), 0);
});

test('Emprise France : coordonnées plausibles ou rejetées', () => {
  assert.equal(isPlausibleFranceCoords(48.8566, 2.3522), true);
  assert.equal(isPlausibleFranceCoords(-20.8823, 55.4504), true, 'La Réunion');
  assert.equal(isPlausibleFranceCoords(4.9372, -52.3260), true, 'Guyane');
  assert.equal(isPlausibleFranceCoords(51.5074, -0.1278), false, 'Londres');
  assert.equal(isPlausibleFranceCoords(0, 0), false, 'nul island');
  assert.equal(isPlausibleFranceCoords(NaN, 2), false);
});

test('Bounding box autour d\'un point', () => {
  const [west, south, east, north] = bboxAround(48.8566, 2.3522, 100);
  assert.ok(west < 2.3522 && east > 2.3522);
  assert.ok(south < 48.8566 && north > 48.8566);
  const height = haversineM(south, 2.3522, north, 2.3522);
  assert.ok(Math.abs(height - 200) < 2, `hauteur=${height}`);
});

test('parseCoord accepte les chaînes à virgule', () => {
  assert.equal(parseCoord('48,8566'), 48.8566);
  assert.equal(parseCoord('2.3522'), 2.3522);
  assert.equal(parseCoord(''), null);
  assert.equal(parseCoord(null), null);
  assert.equal(parseCoord('abc'), null);
});

test('Normalisation et similarité de noms', () => {
  assert.equal(normalizeText('Société Générale — S.A.'), 'societe generale s a');
  assert.equal(similarity('ALLIANZ', 'allianz'), 1);
  assert.ok(similarity('Allianz France', 'Aliaanz France') > 0.8);
  assert.ok(similarity('Renault', 'Peugeot') < 0.5);
  assert.equal(levenshtein('chat', 'chats'), 1);
});

test('uniqBy déduplique par clé', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 1 }];
  assert.equal(uniqBy(items, (item) => item.id).length, 2);
});

test('escapeHtml et safeUrl neutralisent les injections', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html;base64,AAA'), '');
  assert.equal(safeUrl('https://exemple.fr/a'), 'https://exemple.fr/a');
  assert.equal(safeUrl(''), '');
});

test('slugifyFilename produit un nom compatible Windows', () => {
  assert.equal(slugifyFilename('Allianz 75015 / Paris'), 'allianz-75015-paris');
  assert.equal(slugifyFilename('***', 'export'), 'export');
});

test('RateLimiter espace les appels', async () => {
  const limiter = new RateLimiter(60);
  const started = Date.now();
  await Promise.all([1, 2, 3].map((n) => limiter.schedule(async () => n)));
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 110, `elapsed=${elapsed}`);
});

test('TtlCache : succès, expiration et dédoublonnage', async () => {
  const cache = new TtlCache({ ttlMs: 50 });
  let calls = 0;
  const producer = async () => { calls += 1; await new Promise((r) => setTimeout(r, 10)); return 'valeur'; };

  const [a, b] = await Promise.all([cache.wrap('k', producer), cache.wrap('k', producer)]);
  assert.equal(a, 'valeur');
  assert.equal(b, 'valeur');
  assert.equal(calls, 1, 'un seul appel pour deux demandes simultanées');

  await cache.wrap('k', producer);
  assert.equal(calls, 1, 'lecture depuis le cache');

  await new Promise((r) => setTimeout(r, 60));
  await cache.wrap('k', producer);
  assert.equal(calls, 2, 'expiration respectée');
});

test('fetchJson : retry sur 5xx puis succès', async () => {
  const original = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts < 3) return new Response('erreur', { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const data = await fetchJson('https://exemple.invalid/x', { retries: 2, retryBaseDelayMs: 1 });
    assert.deepEqual(data, { ok: true });
    assert.equal(attempts, 3);
  } finally {
    global.fetch = original;
  }
});

test('fetchJson : 429 typé RATE_LIMIT après épuisement des retries', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': '0' } });
  try {
    await assert.rejects(
      () => fetchJson('https://exemple.invalid/x', { retries: 1, retryBaseDelayMs: 1 }),
      (error) => error instanceof AppError && error.code === ERR.RATE_LIMIT,
    );
  } finally {
    global.fetch = original;
  }
});

test('fetchJson : 400 renvoie le message de l\'API', async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ detail: 'Code postal invalide' }), { status: 400 });
  try {
    await assert.rejects(
      () => fetchJson('https://exemple.invalid/x', { retries: 0 }),
      (error) => error.code === ERR.HTTP_CLIENT && error.userMessage.includes('Code postal invalide'),
    );
  } finally {
    global.fetch = original;
  }
});

test('fetchJson : échec réseau → message explicite', async () => {
  const original = global.fetch;
  global.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    await assert.rejects(
      () => fetchJson('https://exemple.invalid/x', { retries: 0, label: 'service test' }),
      (error) => error.code === ERR.NETWORK && /connexion Internet/i.test(error.userMessage),
    );
  } finally {
    global.fetch = original;
  }
});
