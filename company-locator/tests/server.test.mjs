/**
 * Test d'intégration — server.js (processus réel, requêtes HTTP réelles)
 *
 * Vérifie la configuration du jeton Mapillary de bout en bout :
 *  - le serveur démarre sur le port demandé et sert `/api/health` ;
 *  - `/api/mapillary/status` décrit l'état **sans jamais renvoyer le secret** ;
 *  - un Client ID seul est refusé avec une consigne actionnable (501) ;
 *  - un jeton complet est accepté (état `ready`) et le proxy tente l'appel ;
 *  - `node server.js --check-mapillary` donne un verdict en ligne de commande.
 *
 * Aucune requête ne sort réellement vers Mapillary : les cas `ready` ne
 * contrôlent que l'état local, jamais la réponse distante.
 *
 * Exécution : npm run test:server
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_ID = '28966464223012415';
const SECRET = 'abcdef0123456789abcdef0123456789';
const TOKEN = `MLY|${CLIENT_ID}|${SECRET}`;

let nextPort = 8390 + Math.floor(Math.random() * 60);

/** Lance le serveur et attend la bannière de démarrage. */
function startServer(env = {}, { port = nextPort++ } = {}) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      MAPILLARY_TOKEN: '',
      MAPILLARY_CLIENT_ID: '',
      MAPILLARY_CLIENT_SECRET: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Le serveur n'a pas démarré :\n${output}`)), 10000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (/Arrêt : Ctrl \+ C/.test(output)) {
        clearTimeout(timer);
        resolve({ port, output: () => output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Le serveur s'est arrêté (code ${code}) :\n${output}`));
    });
  });

  return { child, ready, output: () => output, port };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
    setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
  });
}

const getJson = async (port, pathname) => {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return { status: response.status, body: await response.json() };
};

test('Client ID seul : diagnostic clair, aucun jeton utilisé, aucun secret exposé', async () => {
  const server = startServer({ MAPILLARY_CLIENT_ID: CLIENT_ID });
  try {
    await server.ready;

    const health = await getJson(server.port, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.ok, true);
    assert.equal(health.body.mapillaryConfigured, false);
    assert.equal(health.body.mapillaryState, 'incomplete');

    const status = await getJson(server.port, '/api/mapillary/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.configured, false);
    assert.equal(status.body.mode, 'none');
    assert.equal(status.body.state, 'incomplete');
    assert.equal(status.body.tokenLength, 0);
    assert.match(status.body.message, /Client ID/);
    assert.match(status.body.message, /Client Secret/);
    assert.match(status.body.dashboardUrl, /mapillary\.com\/dashboard\/developers$/);

    const images = await getJson(server.port, '/api/mapillary/images?bbox=2.28,48.83,2.32,48.86');
    assert.equal(images.status, 501, 'aucun appel amont avec un identifiant inutilisable');
    assert.equal(images.body.configured, false);
    assert.match(images.body.error, /incomplète/);
    assert.match(images.body.message, /MLY\|/);

    // Le secret ne doit apparaître nulle part, même tronqué.
    const everything = JSON.stringify([health.body, status.body, images.body]);
    assert.ok(!everything.includes(SECRET));
  } finally {
    await stop(server.child);
  }
});

test('Client ID + Client Secret : jeton composé, état « ready », secret jamais renvoyé', async () => {
  const server = startServer({ MAPILLARY_CLIENT_ID: CLIENT_ID, MAPILLARY_CLIENT_SECRET: SECRET });
  try {
    await server.ready;

    const status = await getJson(server.port, '/api/mapillary/status');
    assert.equal(status.body.configured, true);
    assert.equal(status.body.mode, 'proxy');
    assert.equal(status.body.state, 'ready');
    assert.ok(status.body.tokenLength > 0);
    assert.match(status.body.message, /combinés/i);

    const serialised = JSON.stringify(status.body);
    assert.ok(!serialised.includes(SECRET), 'le Client Secret ne sort jamais du serveur');
    assert.ok(!serialised.includes(CLIENT_ID), 'le Client ID ne sort pas non plus');

    const health = await getJson(server.port, '/api/health');
    assert.equal(health.body.mapillaryConfigured, true);
    assert.equal(health.body.mapillaryState, 'ready');

    // La bannière annonce le jeton sans jamais l'afficher.
    const banner = server.output();
    assert.match(banner, /Jeton Mapillary : chargé/);
    assert.ok(!banner.includes(SECRET), 'le secret n’est pas journalisé');
  } finally {
    await stop(server.child);
  }
});

test('Un Client Token complet est accepté tel quel', async () => {
  const server = startServer({ MAPILLARY_TOKEN: TOKEN });
  try {
    await server.ready;
    const status = await getJson(server.port, '/api/mapillary/status');
    assert.equal(status.body.configured, true);
    assert.equal(status.body.state, 'ready');
    assert.ok(!JSON.stringify(status.body).includes(SECRET));
  } finally {
    await stop(server.child);
  }
});

test('Jeton mal formé : état « invalid » et message explicite', async () => {
  const server = startServer({ MAPILLARY_TOKEN: 'MLY|pas-complet' });
  try {
    await server.ready;
    const status = await getJson(server.port, '/api/mapillary/status');
    assert.equal(status.body.configured, false);
    assert.equal(status.body.state, 'invalid');
    assert.match(status.body.message, /MLY\|/);
  } finally {
    await stop(server.child);
  }
});

test('--check-mapillary : verdict en ligne de commande, code de sortie 1 sans jeton utilisable', async () => {
  const run = (env) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.js', '--check-mapillary'], {
      cwd: ROOT,
      env: {
        ...process.env, MAPILLARY_TOKEN: '', MAPILLARY_CLIENT_ID: '', MAPILLARY_CLIENT_SECRET: '', ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => resolve({ code, output }));
  });

  const withClientId = await run({ MAPILLARY_CLIENT_ID: CLIENT_ID });
  assert.equal(withClientId.code, 1);
  assert.match(withClientId.output, /État {4}: incomplete/);
  assert.match(withClientId.output, /Client ID/);
  assert.match(withClientId.output, /mapillary\.com\/dashboard\/developers/);
  assert.ok(!withClientId.output.includes(SECRET));

  const withSecret = await run({ MAPILLARY_CLIENT_ID: CLIENT_ID, MAPILLARY_CLIENT_SECRET: SECRET });
  assert.equal(withSecret.code, 1, 'sans réseau, la vérification échoue proprement');
  assert.match(withSecret.output, /État {4}: ready/);
  assert.match(withSecret.output, /✔|✘/);
  assert.ok(!withSecret.output.includes(SECRET), 'le secret n’est jamais imprimé');
});
