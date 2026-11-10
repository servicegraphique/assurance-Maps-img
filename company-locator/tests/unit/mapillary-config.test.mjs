/**
 * Tests unitaires — js/mapillary-config.js
 *
 * Le tableau de bord Mapillary expose deux valeurs faciles à confondre :
 * le « Client ID » (un nombre) et le « Client Token » `MLY|id|secret`, seul
 * utilisable comme jeton. Ces tests vérifient que l'application classe
 * correctement la valeur fournie, explique quoi faire, et **ne transmet
 * jamais le secret** au navigateur.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanMapillaryValue, mapillaryTokenShape, composeClientToken,
  resolveMapillaryToken, mapillaryStatusPayload, CLIENT_TOKEN_PATTERN, MAPILLARY_DASHBOARD_URL,
} from '../../js/mapillary-config.js';

const CLIENT_ID = '28966464223012415';
const SECRET = 'abcdef0123456789abcdef0123456789';
const TOKEN = `MLY|${CLIENT_ID}|${SECRET}`;

test('Nettoyage des valeurs copiées-collées', () => {
  assert.equal(cleanMapillaryValue('  MLY|1|2  '), 'MLY|1|2');
  assert.equal(cleanMapillaryValue('"MLY|1|2"'), 'MLY|1|2');
  assert.equal(cleanMapillaryValue("'MLY|1|2'"), 'MLY|1|2');
  assert.equal(cleanMapillaryValue('Bearer MLY|1|2'), 'MLY|1|2');
  assert.equal(cleanMapillaryValue('OAuth MLY|1|2'), 'MLY|1|2');
  assert.equal(cleanMapillaryValue(null), '');
  assert.equal(cleanMapillaryValue(undefined), '');
});

test('Forme de la valeur : jeton, Client ID, secret seul, inconnue', () => {
  assert.equal(mapillaryTokenShape(''), 'empty');
  assert.equal(mapillaryTokenShape(TOKEN), 'client-token');
  assert.equal(mapillaryTokenShape(CLIENT_ID), 'client-id');
  assert.equal(mapillaryTokenShape(SECRET), 'client-secret');
  assert.equal(mapillaryTokenShape('MLY|seulement-deux-segments'), 'unknown');
  assert.equal(mapillaryTokenShape('pas un jeton'), 'unknown');
  assert.equal(mapillaryTokenShape('MLY|1|2'), 'client-token');
  assert.ok(CLIENT_TOKEN_PATTERN.test(TOKEN));
});

test('Composition du « Client Token » à partir de l’ID et du secret', () => {
  assert.equal(composeClientToken(CLIENT_ID, SECRET), TOKEN);
  assert.equal(composeClientToken(` ${CLIENT_ID} `, ` ${SECRET} `), TOKEN);
  assert.equal(composeClientToken(CLIENT_ID, ''), '');
  assert.equal(composeClientToken('', SECRET), '');
  assert.equal(composeClientToken(null, null), '');
});

test('Un Client Token complet est accepté tel quel', () => {
  const resolution = resolveMapillaryToken({ token: TOKEN, source: 'server.config.json' });
  assert.equal(resolution.state, 'ready');
  assert.equal(resolution.configured, true);
  assert.equal(resolution.token, TOKEN);
  assert.equal(resolution.shape, 'client-token');
  assert.match(resolution.message, /MLY/);
});

test('Un Client ID seul est diagnostiqué, jamais utilisé comme jeton', () => {
  const resolution = resolveMapillaryToken({ token: CLIENT_ID });
  assert.equal(resolution.state, 'incomplete');
  assert.equal(resolution.configured, false);
  assert.equal(resolution.token, '', 'aucun jeton inventé');
  assert.match(resolution.message, new RegExp(CLIENT_ID));
  assert.match(resolution.message, /Client ID/);
  assert.match(resolution.message, /Client Secret/);
  assert.match(resolution.message, /MLY\|/);
});

test('Client ID + Client Secret : le serveur compose le jeton', () => {
  const resolution = resolveMapillaryToken({ clientId: CLIENT_ID, clientSecret: SECRET });
  assert.equal(resolution.state, 'ready');
  assert.equal(resolution.configured, true);
  assert.equal(resolution.token, TOKEN);
  assert.equal(resolution.shape, 'composed');
  assert.equal(resolution.source, 'client-id+secret');
  assert.match(resolution.message, /combinés/i);
});

test('Secret seul, jeton mal formé et absence totale de configuration', () => {
  const secretOnly = resolveMapillaryToken({ clientSecret: SECRET });
  assert.equal(secretOnly.state, 'incomplete');
  assert.match(secretOnly.message, /Client ID/);

  const malformed = resolveMapillaryToken({ token: 'MLY|pas-complet' });
  assert.equal(malformed.state, 'invalid');
  assert.match(malformed.message, /MLY\|/);

  const missing = resolveMapillaryToken({});
  assert.equal(missing.state, 'missing');
  assert.match(missing.message, /server\.config\.json/);
  assert.match(missing.message, /Panoramax/);
});

test('Le statut exposé ne contient jamais le secret', () => {
  const payload = mapillaryStatusPayload(resolveMapillaryToken({ token: TOKEN }));
  assert.equal(payload.configured, true);
  assert.equal(payload.mode, 'proxy');
  assert.equal(payload.state, 'ready');
  assert.ok(payload.tokenLength > 0);
  const serialised = JSON.stringify(payload);
  assert.ok(!serialised.includes(SECRET), 'aucun fragment du secret');
  assert.ok(!serialised.includes(CLIENT_ID), 'aucun fragment du Client ID');

  const incomplete = mapillaryStatusPayload(resolveMapillaryToken({ token: CLIENT_ID }));
  assert.equal(incomplete.configured, false);
  assert.equal(incomplete.mode, 'none');
  assert.equal(incomplete.state, 'incomplete');
  assert.equal(incomplete.tokenLength, 0);
});

test('Le tableau de bord est référencé pour la reprise en main', () => {
  assert.match(MAPILLARY_DASHBOARD_URL, /^https:\/\/www\.mapillary\.com\/dashboard\/developers$/);
});
