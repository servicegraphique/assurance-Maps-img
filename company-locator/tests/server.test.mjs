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
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Les tests ne doivent jamais dépendre du `server.config.json` de la machine
 * (qui contient le vrai jeton) : `CLF_CONFIG_FILE` pointe vers un fichier
 * temporaire, absent par défaut.
 */
const TMP = mkdtempSync(path.join(os.tmpdir(), 'clf-config-'));
const NO_CONFIG = path.join(TMP, 'absent.json');

const writeConfig = (name, content) => {
  const file = path.join(TMP, name);
  writeFileSync(file, JSON.stringify(content, null, 2), 'utf8');
  return file;
};
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
      CLF_CONFIG_FILE: NO_CONFIG,
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

test('server.config.json : Client ID seul → incomplete, Client ID + Secret → ready', async () => {
  const clientIdOnly = writeConfig('client-id.json', { mapillaryClientId: CLIENT_ID });
  const first = startServer({ CLF_CONFIG_FILE: clientIdOnly });
  try {
    await first.ready;
    const status = await getJson(first.port, '/api/mapillary/status');
    assert.equal(status.body.state, 'incomplete');
    assert.match(status.body.message, /Client ID/);
  } finally {
    await stop(first.child);
  }

  const full = writeConfig('full.json', { mapillaryClientId: CLIENT_ID, mapillaryClientSecret: SECRET });
  const second = startServer({ CLF_CONFIG_FILE: full });
  try {
    await second.ready;
    const status = await getJson(second.port, '/api/mapillary/status');
    assert.equal(status.body.configured, true);
    assert.equal(status.body.state, 'ready');
    assert.ok(!JSON.stringify(status.body).includes(SECRET), 'secret absent de la réponse');
  } finally {
    await stop(second.child);
  }
});

test('Le jeton explicite prime sur le fichier, sans jamais mélanger les sources', async () => {
  const fileWithId = writeConfig('id-seul.json', { mapillaryClientId: CLIENT_ID });
  const server = startServer({ CLF_CONFIG_FILE: fileWithId, MAPILLARY_TOKEN: 'MLY|pas-complet' });
  try {
    await server.ready;
    const status = await getJson(server.port, '/api/mapillary/status');
    // Le jeton (invalide) est évalué seul : le Client ID du fichier ne le « répare » pas.
    assert.equal(status.body.state, 'invalid');
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

/** Lance une commande CLI du serveur et rend le code de sortie + la sortie. */
function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server.js', ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        MAPILLARY_TOKEN: '', MAPILLARY_CLIENT_ID: '', MAPILLARY_CLIENT_SECRET: '',
        CLF_CONFIG_FILE: NO_CONFIG,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => resolve({ code, output }));
  });
}

test('--check-mapillary : verdict en ligne de commande, code de sortie 1 sans jeton utilisable', async () => {
  const run = (env) => runCli(['--check-mapillary'], env);

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

test('Fichier absent : --check-mapillary indique où le fichier est attendu', async () => {
  const missing = path.join(TMP, 'vraiment-absent.json');
  const { code, output } = await runCli(['--check-mapillary'], { CLF_CONFIG_FILE: missing });
  assert.equal(code, 1);
  assert.match(output, /État {4}: missing/);
  assert.match(output, /Fichier : introuvable/);
  assert.ok(output.includes(missing), 'le chemin attendu est affiché');
  assert.match(output, /--set-mapillary-token/);
});

test('--set-mapillary-token : écrit le jeton (mode 600) et conserve les autres clés', async () => {
  const file = path.join(TMP, 'ecrit.json');
  writeFileSync(file, JSON.stringify({ _note: 'à conserver', googleMapsEmbedKey: 'AIza-test' }), 'utf8');

  const { code, output } = await runCli(['--set-mapillary-token', TOKEN], { CLF_CONFIG_FILE: file });
  assert.equal(code, 0, output);
  assert.match(output, /✔ Jeton enregistré/);
  assert.ok(!output.includes(SECRET), 'le jeton n’est jamais imprimé');

  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(written.mapillaryToken, TOKEN);
  assert.equal(written._note, 'à conserver', 'les clés existantes sont préservées');
  assert.equal(written.googleMapsEmbedKey, 'AIza-test');
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600, 'fichier lisible par le seul propriétaire');
  }

  // Relecture par le serveur : l'état passe à « ready » sans intervention.
  const check = await runCli(['--check-mapillary'], { CLF_CONFIG_FILE: file });
  assert.match(check.output, /État {4}: ready/);
  assert.ok(check.output.includes(file), 'le fichier utilisé est affiché');
});

test('Fichier écrit avec un BOM (Bloc-notes, PowerShell 5.1) : toujours lisible', async () => {
  const file = path.join(TMP, 'avec-bom.json');
  // PowerShell `Set-Content -Encoding UTF8` et le Bloc-notes ajoutent ce BOM.
  writeFileSync(file, `\uFEFF${JSON.stringify({ mapillaryToken: TOKEN })}`, 'utf8');

  const check = await runCli(['--check-mapillary'], { CLF_CONFIG_FILE: file });
  assert.match(check.output, /État {4}: ready/, 'le BOM ne doit pas rendre le fichier illisible');
  assert.ok(!check.output.includes(SECRET));

  // Réécriture par --set-mapillary-token : les clés restent, le BOM disparaît.
  const set = await runCli(['--set-mapillary-token', TOKEN], { CLF_CONFIG_FILE: file });
  assert.equal(set.code, 0, set.output);
  assert.ok(!readFileSync(file, 'utf8').startsWith('\uFEFF'));
});

test('--set-mapillary-token : un jeton invalide est refusé et n’écrit rien', async () => {
  const file = path.join(TMP, 'jamais-ecrit.json');
  const { code, output } = await runCli(['--set-mapillary-token', CLIENT_ID], { CLF_CONFIG_FILE: file });
  assert.equal(code, 1);
  assert.match(output, /✘ Jeton refusé/);
  assert.match(output, /Client ID/);
  assert.equal(existsSync(file), false, 'aucun fichier créé');

  const noArg = await runCli(['--set-mapillary-token'], { CLF_CONFIG_FILE: file });
  assert.equal(noArg.code, 1);
  assert.match(noArg.output, /Usage/);
});
