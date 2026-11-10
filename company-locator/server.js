/**
 * server.js — Petit serveur local, sans aucune dépendance npm.
 *
 * Deux rôles :
 *  1. servir les fichiers statiques de l'application (obligatoire : les
 *     modules ES ne fonctionnent pas en file://) ;
 *  2. servir de PROXY optionnel à Mapillary, afin que le jeton gratuit reste
 *     côté serveur et ne soit jamais envoyé au navigateur.
 *
 * Lancement :   node server.js
 * Port :        8080 par défaut, modifiable via la variable PORT.
 *               En cas de port occupé, les 9 ports suivants sont essayés.
 * Option :      --open  ouvre le navigateur au démarrage (utilisé par les lanceurs).
 *               --path <chemin> page ouverte par --open (ex. assurance-tns-pro-v2-adw/).
 *               --home <chemin> page servie sur « / » (utile quand la racine
 *               contient plusieurs dossiers et qu'aucun index.html n'existe).
 * Racine :      STATIC_ROOT (ou --root <dossier>) change le dossier servi.
 *               `STATIC_ROOT=.. node server.js` sert tout le dépôt, ce qui
 *               permet au formulaire d'assurance d'intégrer le localisateur
 *               en iframe tout en gardant le relais d'API local :
 *               http://localhost:8080/assurance-tns-pro-v2-adw/
 * Config :      server.config.json (racine servie ou dossier du serveur),
 *               ou CLF_CONFIG_FILE=<chemin> pour imposer un autre emplacement.
 * Jeton :       variable d'environnement MAPILLARY_TOKEN
 *               ou fichier server.config.json { "mapillaryToken": "MLY|…" }
 *               (le Client ID + Client Secret du tableau de bord suffisent :
 *               le jeton « MLY|<id>|<secret> » est composé automatiquement)
 * Options :     --check-mapillary  vérifie le jeton auprès de Mapillary et sort ;
 *               --set-mapillary-token "MLY|…"  enregistre le jeton dans
 *               server.config.json (fichier local, mode 600) et sort.
 *
 * Aucune base de données, aucun compte, aucun service payant.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMapillaryToken, mapillaryStatusPayload, MAPILLARY_DASHBOARD_URL } from './js/mapillary-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Racine servie : le dossier de l'application par défaut, surchargeable. */
function resolveRoot() {
  const flagIndex = process.argv.indexOf('--root');
  const fromFlag = flagIndex > -1 ? process.argv[flagIndex + 1] : '';
  const wanted = String(fromFlag || process.env.STATIC_ROOT || '').trim();
  if (!wanted) return { root: __dirname, custom: false };
  const resolved = path.resolve(__dirname, wanted);
  try {
    if (fs.statSync(resolved).isDirectory()) return { root: resolved, custom: resolved !== __dirname };
  } catch { /* dossier absent : on retombe sur l'application */ }
  console.error(`[serveur] Dossier introuvable : ${wanted} — service de l'application seule.`);
  return { root: __dirname, custom: false };
}

const { root: ROOT, custom: CUSTOM_ROOT } = resolveRoot();
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAPILLARY_GRAPH = 'https://graph.mapillary.com';

/* ------------------------------------------------------------------ */
/* 1. Jeton Mapillary (jamais renvoyé au client)                       */
/* ------------------------------------------------------------------ */

/**
 * Lit la configuration Mapillary, sans jamais la journaliser.
 *
 * Trois formes acceptées, dans cet ordre de priorité :
 *   1. `MAPILLARY_TOKEN` / `server.config.json { "mapillaryToken": "MLY|…" }` ;
 *   2. `MAPILLARY_CLIENT_ID` + `MAPILLARY_CLIENT_SECRET` (le jeton est composé) ;
 *   3. `mapillaryClientId` + `mapillaryClientSecret` dans server.config.json.
 *
 * La valeur peut aussi être le Client ID seul : on ne l'utilise pas comme
 * jeton, on explique quoi faire (voir `resolveMapillaryToken`).
 */
function readMapillaryConfig() {
  const fileConfig = {};
  // La racine servie peut être le dossier parent (STATIC_ROOT=..) : on cherche
  // aussi à côté du serveur, là où le README demande de déposer le fichier.
  // CLF_CONFIG_FILE force un emplacement précis (déploiement, tests) : dans ce
  // cas le fichier est le seul pris en compte, même s'il n'existe pas.
  const override = typeof process.env.CLF_CONFIG_FILE === 'string' && process.env.CLF_CONFIG_FILE.trim()
    ? path.resolve(process.env.CLF_CONFIG_FILE.trim())
    : '';
  const candidates = override
    ? [override]
    : [...new Set([path.join(__dirname, 'server.config.json'), path.join(ROOT, 'server.config.json')])];
  const file = candidates.find((candidate) => fs.existsSync(candidate)) || '';
  try {
    if (file) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      Object.assign(fileConfig, {
        token: typeof parsed.mapillaryToken === 'string' ? parsed.mapillaryToken : '',
        clientId: typeof parsed.mapillaryClientId === 'string' ? parsed.mapillaryClientId : '',
        clientSecret: typeof parsed.mapillaryClientSecret === 'string' ? parsed.mapillaryClientSecret : '',
      });
    }
  } catch (error) {
    console.warn('[serveur] server.config.json illisible :', error.message);
  }

  const env = {
    token: process.env.MAPILLARY_TOKEN || '',
    clientId: process.env.MAPILLARY_CLIENT_ID || '',
    clientSecret: process.env.MAPILLARY_CLIENT_SECRET || '',
  };

  // Un jeton explicite (variable d'environnement ou fichier) prime sur tout :
  // on ne mélange jamais un jeton avec un identifiant resté dans l'autre source.
  const token = env.token || fileConfig.token || '';
  const where = { file, fileExists: Boolean(file), expected: candidates[0], searched: candidates };
  if (token) {
    return {
      token, clientId: '', clientSecret: '', source: env.token ? 'environnement' : 'server.config.json', ...where,
    };
  }

  const clientId = env.clientId || fileConfig.clientId || '';
  const clientSecret = env.clientSecret || fileConfig.clientSecret || '';
  return {
    token: '',
    clientId,
    clientSecret,
    source: env.clientId || env.clientSecret ? 'environnement' : 'server.config.json',
    ...where,
  };
}

/** (Re)résout le jeton : état, forme et message explicatif. */
function reloadMapillary() {
  const config = readMapillaryConfig();
  MAPILLARY = resolveMapillaryToken(config);
  // Diagnostic local (jamais exposé par HTTP) : où le fichier était attendu.
  MAPILLARY.configFile = config.file;
  MAPILLARY.configExpected = config.expected;
  MAPILLARY.configSearched = config.searched;
  if (MAPILLARY.state === 'missing' && !config.fileExists) {
    MAPILLARY.message = 'Aucun fichier de configuration trouvé : créez « server.config.json » à côté de '
      + 'server.js (modèle : server.config.example.json), ou lancez la commande « node server.js '
      + '--set-mapillary-token \"MLY|…\" ». Les photos Panoramax restent disponibles sans jeton.';
  }
  TOKEN = MAPILLARY.token;
  return MAPILLARY;
}

/**
 * Clé Google Maps Embed (optionnelle).
 * L'API Maps Embed est gratuite et illimitée, mais Google exige un projet
 * Cloud avec facturation activée. La clé reste côté serveur : le navigateur
 * appelle /api/streetview/embed, le serveur redirige en ajoutant la clé.
 */
function readGoogleKey() {
  if (process.env.GOOGLE_MAPS_EMBED_KEY?.trim()) return process.env.GOOGLE_MAPS_EMBED_KEY.trim();
  try {
    const file = path.join(ROOT, 'server.config.json');
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof parsed.googleMapsEmbedKey === 'string' && parsed.googleMapsEmbedKey.trim()) {
        return parsed.googleMapsEmbedKey.trim();
      }
    }
  } catch { /* déjà signalé par readToken() */ }
  return '';
}

let MAPILLARY = resolveMapillaryToken({});
let TOKEN = '';
let GOOGLE_KEY = readGoogleKey();
reloadMapillary();

/* ------------------------------------------------------------------ */
/* 2. Utilitaires HTTP                                                 */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

/** Résout un chemin demandé en chemin disque sûr (anti path-traversal). */
function resolveSafePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded.replace(/^\/+/, '') || 'index.html';
  const target = path.resolve(ROOT, relative);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

/* ------------------------------------------------------------------ */
/* 3. Limitation de débit du proxy (protège le quota Mapillary)        */
/* ------------------------------------------------------------------ */

const proxyCalls = [];
function proxyRateLimited() {
  const now = Date.now();
  while (proxyCalls.length && now - proxyCalls[0] > 1000) proxyCalls.shift();
  if (proxyCalls.length >= 5) return true;
  proxyCalls.push(now);
  return false;
}

/* ------------------------------------------------------------------ */
/* 4. Proxy Mapillary                                                  */
/* ------------------------------------------------------------------ */

async function handleMapillary(request, response, url) {
  if (url.pathname === '/api/mapillary/status') {
    // Le jeton lui-même n'est jamais renvoyé : seulement l'état et la consigne.
    return sendJson(response, 200, {
      ...mapillaryStatusPayload(MAPILLARY),
      dashboardUrl: MAPILLARY_DASHBOARD_URL,
    });
  }

  if (url.pathname !== '/api/mapillary/images') {
    return sendJson(response, 404, { error: 'Route inconnue' });
  }

  if (!TOKEN) {
    return sendJson(response, 501, {
      configured: false,
      state: MAPILLARY.state,
      error: MAPILLARY.state === 'missing' ? 'Jeton Mapillary absent' : 'Configuration Mapillary incomplète',
      message: MAPILLARY.message,
      dashboardUrl: MAPILLARY_DASHBOARD_URL,
    });
  }

  if (proxyRateLimited()) {
    response.setHeader('Retry-After', '2');
    return sendJson(response, 429, { error: 'Trop de requêtes', message: 'Limite locale de 5 requêtes/seconde atteinte.' });
  }

  const bbox = url.searchParams.get('bbox') || '';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
  if (!/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(bbox)) {
    return sendJson(response, 400, { error: 'Paramètre bbox invalide', message: 'Format attendu : ouest,sud,est,nord' });
  }

  const upstream = new URL(`${MAPILLARY_GRAPH}/images`);
  upstream.searchParams.set('fields', 'id,thumb_1024_url,thumb_2048_url,captured_at,compass_angle,is_pano,geometry');
  upstream.searchParams.set('bbox', bbox);
  upstream.searchParams.set('limit', String(limit));

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    // En-tête OAuth : le jeton ne traîne ni dans l'URL ni dans les journaux.
    const upstreamResponse = await fetch(upstream, {
      signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `OAuth ${TOKEN}` },
    });
    clearTimeout(timer);
    const text = await upstreamResponse.text();

    if (!upstreamResponse.ok) {
      // On ne renvoie jamais l'URL amont (elle contient le jeton).
      let detail = '';
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.error?.message || '';
      } catch { /* réponse non JSON */ }
      console.warn(`[mapillary] HTTP ${upstreamResponse.status} ${detail}`);
      return sendJson(response, upstreamResponse.status === 401 || upstreamResponse.status === 403 ? 401 : 502, {
        error: 'Mapillary a refusé la requête',
        status: upstreamResponse.status,
        message: detail || 'Mapillary a refusé le jeton. Vérifiez qu’il s’agit bien du « Client Token » (MLY|…), '
          + 'et non du Client ID, sur mapillary.com/dashboard/developers.',
      });
    }

    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    return response.end(text);
  } catch (error) {
    const timeout = error.name === 'AbortError';
    return sendJson(response, timeout ? 504 : 502, {
      error: timeout ? 'Délai dépassé' : 'Échec réseau',
      message: timeout ? 'Mapillary n\'a pas répondu en 15 secondes.' : 'Impossible de joindre Mapillary depuis ce serveur.',
    });
  }
}

/* ------------------------------------------------------------------ */
/* 4 bis. Proxy générique des API publiques (contourne le CORS)        */
/*                                                                     */
/* L'API Recherche d'entreprises n'envoie pas d'en-tête CORS : un appel */
/* direct depuis le navigateur peut être bloqué. Ce relais de même      */
/* origine règle le problème sans aucun service tiers. Liste blanche    */
/* stricte : seules les trois API publiques déclarées sont relayées.    */
/* ------------------------------------------------------------------ */

const PUBLIC_PROXIES = {
  '/api/proxy/entreprises': { target: 'https://recherche-entreprises.api.gouv.fr', paths: ['/search'] },
  '/api/proxy/geocodage': { target: 'https://data.geopf.fr/geocodage', paths: ['/search', '/reverse'] },
  '/api/proxy/panoramax': { target: 'https://api.panoramax.xyz/api', paths: ['/search'] },
};

const publicCalls = [];
function publicRateLimited() {
  const now = Date.now();
  while (publicCalls.length && now - publicCalls[0] > 1000) publicCalls.shift();
  if (publicCalls.length >= 12) return true;
  publicCalls.push(now);
  return false;
}

/* ------------------------------------------------------------------ */
/* Google Street View — la clé ne quitte jamais le serveur             */
/* ------------------------------------------------------------------ */

let streetViewWindowStart = 0;
let streetViewCount = 0;
function streetViewRateLimited() {
  const now = Date.now();
  if (now - streetViewWindowStart > 1000) { streetViewWindowStart = now; streetViewCount = 0; }
  streetViewCount += 1;
  return streetViewCount > 8;
}

function handleStreetView(request, response, url) {
  if (url.pathname === '/api/streetview/status') {
    return sendJson(response, 200, {
      configured: Boolean(GOOGLE_KEY),
      // Aucune clé, aucun fragment de clé : seulement un booléen et un message.
      message: GOOGLE_KEY
        ? 'Clé Google Maps Embed chargée côté serveur. Elle n\'est jamais transmise au JavaScript public.'
        : 'Google Street View non configuré. Panoramax fournit une vue immersive 360° sans aucune clé. '
          + 'Pour activer Google : renseignez googleMapsEmbedKey dans server.config.json (API Maps Embed gratuite et illimitée, '
          + 'mais un projet Google Cloud avec facturation activée est requis).',
    });
  }

  if (url.pathname !== '/api/streetview/embed') {
    return sendJson(response, 404, { error: 'Route inconnue' });
  }

  if (!GOOGLE_KEY) {
    return sendJson(response, 501, {
      configured: false,
      error: 'Google Street View non configuré',
      message: 'Renseignez googleMapsEmbedKey dans server.config.json puis relancez node server.js. '
        + 'Panoramax reste disponible sans clé.',
    });
  }

  if (streetViewRateLimited()) {
    return sendJson(response, 429, { error: 'Trop de requêtes', message: 'Limite locale de 8 requêtes/seconde atteinte.' });
  }

  // Attention : Number(null) vaut 0. Un paramètre ABSENT doit être refusé,
  // jamais interprété comme la coordonnée 0 (golfe de Guinée).
  const rawLat = url.searchParams.get('lat');
  const rawLon = url.searchParams.get('lon');
  const lat = rawLat !== null && rawLat.trim() !== '' ? Number(rawLat) : NaN;
  const lon = rawLon !== null && rawLon.trim() !== '' ? Number(rawLon) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return sendJson(response, 400, { error: 'Coordonnées invalides', message: 'Paramètres lat et lon attendus, en degrés décimaux.' });
  }

  const bounded = (raw, min, max, fallback) => {
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  const heading = ((bounded(url.searchParams.get('heading'), -3600, 3600, 0) % 360) + 360) % 360;

  const target = new URL('https://www.google.com/maps/embed/v1/streetview');
  target.searchParams.set('key', GOOGLE_KEY);
  target.searchParams.set('location', `${lat},${lon}`);
  target.searchParams.set('heading', heading.toFixed(1));
  target.searchParams.set('pitch', bounded(url.searchParams.get('pitch'), -90, 90, 0).toFixed(1));
  target.searchParams.set('fov', bounded(url.searchParams.get('fov'), 10, 100, 90).toFixed(0));
  target.searchParams.set('radius', String(Math.round(bounded(url.searchParams.get('radius'), 1, 1000, 50))));

  // Redirection : la clé est ajoutée ici, jamais dans une réponse JSON ni
  // dans un fichier servi au navigateur.
  response.writeHead(302, {
    Location: target.toString(),
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end();
  return undefined;
}

async function handlePublicProxy(request, response, url) {
  const prefix = Object.keys(PUBLIC_PROXIES).find((key) => url.pathname.startsWith(key));
  if (!prefix) return sendJson(response, 404, { error: 'Relais inconnu' });

  const definition = PUBLIC_PROXIES[prefix];
  const subPath = url.pathname.slice(prefix.length) || '/';
  if (!definition.paths.includes(subPath)) {
    return sendJson(response, 403, {
      error: 'Chemin non autorisé',
      message: `Ce relais n'accepte que : ${definition.paths.join(', ')}`,
    });
  }
  if (publicRateLimited()) {
    response.setHeader('Retry-After', '2');
    return sendJson(response, 429, { error: 'Trop de requêtes', message: 'Limite locale de 12 requêtes/seconde atteinte.' });
  }
  if ([...url.searchParams.keys()].length > 20 || url.search.length > 2000) {
    return sendJson(response, 400, { error: 'Requête trop longue' });
  }

  const upstream = `${definition.target}${subPath}${url.search}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const upstreamResponse = await fetch(upstream, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'CompanyLocatorFrance/1.0 (application locale)' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    const body = await upstreamResponse.text();
    const retryAfter = upstreamResponse.headers.get('Retry-After');
    const headers = {
      'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': upstreamResponse.ok ? 'public, max-age=300' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    if (retryAfter) headers['Retry-After'] = retryAfter;
    response.writeHead(upstreamResponse.status, headers);
    return response.end(body);
  } catch (error) {
    const timeout = error.name === 'AbortError';
    return sendJson(response, timeout ? 504 : 502, {
      error: timeout ? 'Délai dépassé' : 'Échec réseau',
      message: timeout
        ? 'Le service public n\'a pas répondu en 20 secondes.'
        : 'Le serveur local n\'a pas pu joindre le service public. Vérifiez la connexion Internet de la machine '
          + 'qui exécute server.js (un environnement sandboxé ou un proxy d\'entreprise peut bloquer ces domaines).',
    });
  }
}

/* ------------------------------------------------------------------ */
/* 5. Fichiers statiques                                               */
/* ------------------------------------------------------------------ */

async function serveStatic(request, response, url) {
  // Racine sans index.html : on renvoie vers la page demandée (--home).
  if (HOME_PATH && (url.pathname === '/' || url.pathname === '')) {
    response.writeHead(302, { Location: `/${HOME_PATH}`, 'Cache-Control': 'no-store' });
    return response.end();
  }

  const target = resolveSafePath(url.pathname);
  if (!target) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end('Accès refusé');
  }

  let filePath = target;
  try {
    const stats = await fsp.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      await fsp.stat(filePath); // pas d'index → 404, jamais de listing
    }
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return response.end(CUSTOM_ROOT
      ? '<!doctype html><meta charset="utf-8"><h1>404</h1><p>Fichier introuvable.</p>'
        + '<p><a href="/company-locator/">Localisateur d\'entreprises</a> · '
        + '<a href="/assurance-tns-pro-v2-adw/">Formulaire d\'assurance</a></p>'
      : '<!doctype html><meta charset="utf-8"><h1>404</h1><p>Fichier introuvable.</p><p><a href="/">Retour à l\'application</a></p>');
  }

  // Le jeton et la configuration serveur ne doivent jamais être servis.
  const base = path.basename(filePath);
  if (base === 'server.config.json' || base.startsWith('.env')) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end('Accès refusé');
  }

  const extension = path.extname(filePath).toLowerCase();
  const isAsset = /\/(vendor|assets)\//.test(filePath.replace(/\\/g, '/'));
  try {
    const data = await fsp.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': MIME[extension] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': isAsset ? 'public, max-age=86400' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    if (request.method === 'HEAD') return response.end();
    return response.end(data);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end(`Erreur de lecture : ${error.message}`);
  }
}

/* ------------------------------------------------------------------ */
/* 6. Serveur                                                          */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return sendJson(response, 405, { error: 'Méthode non autorisée' });
  }

  if (url.pathname === '/api/health') {
    return sendJson(response, 200, {
      ok: true,
      app: 'Company Locator France',
      version: '1.0.0',
      mapillaryConfigured: Boolean(TOKEN),
      mapillaryState: MAPILLARY.state,
      googleStreetViewConfigured: Boolean(GOOGLE_KEY),
      node: process.version,
    });
  }

  if (url.pathname.startsWith('/api/streetview/')) {
    return handleStreetView(request, response, url);
  }

  if (url.pathname.startsWith('/api/mapillary')) {
    return handleMapillary(request, response, url);
  }

  if (url.pathname.startsWith('/api/proxy/')) {
    return handlePublicProxy(request, response, url);
  }

  if (url.pathname === '/api/reload-token') {
    reloadMapillary();
    GOOGLE_KEY = readGoogleKey();
    return sendJson(response, 200, {
      ...mapillaryStatusPayload(MAPILLARY),
      googleStreetViewConfigured: Boolean(GOOGLE_KEY),
    });
  }

  return serveStatic(request, response, url);
});

/** Ouvre le navigateur sur l'URL servie (option --open, utilisée par les lanceurs). */
async function openBrowser(url) {
  try {
    const { spawn } = await import('node:child_process');
    const [command, args] = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => console.log(`  Ouvrez manuellement : ${url}`));
    child.unref();
  } catch {
    console.log(`  Ouvrez manuellement : ${url}`);
  }
}

const OPEN_BROWSER = process.argv.includes('--open') || process.env.CLF_OPEN === '1';
/** Chemin ouvert par --open (utile quand la racine sert plusieurs dossiers). */
const pathFlag = process.argv.indexOf('--path');
const OPEN_PATH = pathFlag > -1
  ? String(process.argv[pathFlag + 1] || '').replace(/^\/+/, '')
  : '';

/** Page d'accueil facultative : redirige « / » vers un sous-dossier. */
const homeFlag = process.argv.indexOf('--home');
const HOME_PATH = (homeFlag > -1
  ? String(process.argv[homeFlag + 1] || '')
  : String(process.env.HOME_PATH || '')).replace(/^\/+/, '');
const MAX_PORT_TRIES = 10;
let attempt = 0;
let activePort = PORT;

server.on('listening', () => {
  const url = `http://localhost:${activePort}/`;
  const appUrl = `${url}${OPEN_PATH}`;
  const tokenState = MAPILLARY.configured
    ? `chargé (proxy actif, ${MAPILLARY.shape === 'composed' ? 'Client ID + Secret' : 'Client Token'})`
    : `${MAPILLARY.state === 'incomplete' ? 'incomplet' : (MAPILLARY.state === 'invalid' ? 'invalide' : 'absent')} (Panoramax reste disponible sans jeton)`;
  console.log('');
  console.log('  Company Locator France — serveur local');
  console.log('  --------------------------------------');
  console.log(`  Application : ${appUrl}`);
  if (CUSTOM_ROOT) {
    console.log(`  Racine      : ${ROOT}`);
    console.log(`  Formulaire  : ${url}assurance-tns-pro-v2-adw/`);
    console.log(`  Localisateur: ${url}company-locator/`);
  }
  console.log(`  Santé       : ${url}api/health`);
  console.log(`  Jeton Mapillary : ${tokenState}`);
  if (!MAPILLARY.configured) console.log(`  → ${MAPILLARY.message}`);
  console.log('  Arrêt : Ctrl + C');
  console.log('');
  if (OPEN_BROWSER) openBrowser(appUrl);
});

server.on('error', (error) => {
  // Port occupé : on essaie le suivant plutôt que d'échouer. Un double-clic
  // sur le lanceur ne doit jamais se solder par une fenêtre qui se referme.
  if (error.code === 'EADDRINUSE' && attempt < MAX_PORT_TRIES) {
    attempt += 1;
    activePort = PORT + attempt;
    console.log(`[serveur] Port ${activePort - 1} occupé, essai du port ${activePort}…`);
    setTimeout(() => server.listen(activePort, HOST), 150);
    return;
  }
  if (error.code === 'EADDRINUSE') {
    console.error(`[serveur] Ports ${PORT} à ${activePort} tous occupés. Libérez un port ou lancez : PORT=8090 node server.js`);
    process.exit(1);
  }
  console.error('[serveur] Erreur :', error.message);
  process.exit(1);
});

/* ------------------------------------------------------------------ */
/* 7. Vérification réelle du jeton (node server.js --check-mapillary)  */
/*                                                                     */
/* Un jeton mal copié ne se voit qu'au premier appel : cette option    */
/* interroge Mapillary une fois et donne un verdict sans ambiguïté.    */
/* ------------------------------------------------------------------ */

async function checkMapillary() {
  const line = (text) => console.log(`  ${text}`);
  console.log('');
  console.log('  Vérification du jeton Mapillary');
  console.log('  -------------------------------');
  line(`État    : ${MAPILLARY.state}`);
  line(`Source  : ${MAPILLARY.source}`);
  line(MAPILLARY.configFile
    ? `Fichier : ${MAPILLARY.configFile}`
    : `Fichier : introuvable — attendu à ${MAPILLARY.configExpected}`);
  if (MAPILLARY.state === 'missing') {
    line('Créer   : node server.js --set-mapillary-token "MLY|<client_id>|<client_secret>"');
  }
  line(MAPILLARY.message);
  if (!MAPILLARY.configured) {
    line(`Tableau de bord : ${MAPILLARY_DASHBOARD_URL}`);
    process.exitCode = 1;
    return;
  }

  const upstream = new URL(`${MAPILLARY_GRAPH}/images`);
  upstream.searchParams.set('fields', 'id,captured_at');
  upstream.searchParams.set('limit', '1');
  upstream.searchParams.set('bbox', '2.28,48.83,2.32,48.86'); // centre de Paris
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(upstream, {
      headers: { Accept: 'application/json', Authorization: `OAuth ${TOKEN}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await response.text();
    if (response.ok) {
      let count = 0;
      try { count = (JSON.parse(text).data || []).length; } catch { /* réponse inattendue */ }
      line(`✔ Jeton accepté par Mapillary (HTTP ${response.status}) — ${count} image(s) sur le secteur de test.`);
      return;
    }
    let detail = '';
    try { detail = JSON.parse(text)?.error?.message || ''; } catch { /* réponse non JSON */ }
    line(`✘ Mapillary a refusé le jeton (HTTP ${response.status})${detail ? ` : ${detail}` : ''}`);
    line('Copiez le « Client Token » (MLY|…) sur ' + MAPILLARY_DASHBOARD_URL);
    process.exitCode = 1;
  } catch (error) {
    line(error.name === 'AbortError'
      ? '✘ Aucune réponse de Mapillary en 15 secondes.'
      : `✘ Impossible de joindre Mapillary : ${error.message}`);
    line('Vérifiez que ce réseau autorise graph.mapillary.com.');
    process.exitCode = 1;
  }
}

/**
 * Enregistre le jeton dans server.config.json (ou dans CLF_CONFIG_FILE).
 * Le jeton est validé AVANT d'être écrit, n'est jamais imprimé, et les autres
 * clés du fichier (clé Google, commentaires) sont conservées.
 */
function setMapillaryToken(rawToken) {
  const line = (text) => console.log(`  ${text}`);
  console.log('');
  console.log('  Enregistrement du jeton Mapillary');
  console.log('  ---------------------------------');

  if (!rawToken) {
    line('✘ Aucun jeton fourni.');
    line('Usage : node server.js --set-mapillary-token "MLY|<client_id>|<client_secret>"');
    process.exitCode = 1;
    return;
  }

  const resolution = resolveMapillaryToken({ token: rawToken });
  if (resolution.state !== 'ready') {
    line(`✘ Jeton refusé (${resolution.state}) : ${resolution.message}`);
    line(`Tableau de bord : ${MAPILLARY_DASHBOARD_URL}`);
    process.exitCode = 1;
    return;
  }

  const configuredPath = String(process.env.CLF_CONFIG_FILE || '').trim();
  const target = configuredPath
    ? path.resolve(configuredPath)
    : path.join(__dirname, 'server.config.json');

  let payload = {};
  try {
    if (fs.existsSync(target)) payload = JSON.parse(fs.readFileSync(target, 'utf8')) || {};
  } catch (error) {
    line(`[serveur] ${path.basename(target)} illisible (${error.message}) : le fichier sera réécrit.`);
    payload = {};
  }

  payload.mapillaryToken = resolution.token;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    // `mode` ne s'applique qu'à la création : on resserre les droits d'un
    // fichier préexistant (ignoré silencieusement sous Windows).
    try { fs.chmodSync(target, 0o600); } catch { /* système sans permissions POSIX */ }
  } catch (error) {
    line(`✘ Écriture impossible dans ${target} : ${error.message}`);
    process.exitCode = 1;
    return;
  }

  line(`✔ Jeton enregistré dans ${target} (${resolution.token.length} caractères, fichier non versionné).`);
  line('Vérification : node server.js --check-mapillary');
}

const setTokenFlag = process.argv.indexOf('--set-mapillary-token');
if (setTokenFlag > -1) {
  setMapillaryToken(process.argv[setTokenFlag + 1]);
  process.exit(process.exitCode || 0);
}

if (process.argv.includes('--check-mapillary')) {
  await checkMapillary();
  process.exit(process.exitCode || 0);
}

server.listen(PORT, HOST);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n[serveur] Arrêt…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
