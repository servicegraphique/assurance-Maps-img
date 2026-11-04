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
 * Jeton :       variable d'environnement MAPILLARY_TOKEN
 *               ou fichier server.config.json { "mapillaryToken": "MLY|…" }
 *
 * Aucune base de données, aucun compte, aucun service payant.
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const MAPILLARY_GRAPH = 'https://graph.mapillary.com';

/* ------------------------------------------------------------------ */
/* 1. Jeton Mapillary (jamais renvoyé au client)                       */
/* ------------------------------------------------------------------ */

function readToken() {
  if (process.env.MAPILLARY_TOKEN?.trim()) return process.env.MAPILLARY_TOKEN.trim();
  try {
    const file = path.join(ROOT, 'server.config.json');
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof parsed.mapillaryToken === 'string' && parsed.mapillaryToken.trim()) {
        return parsed.mapillaryToken.trim();
      }
    }
  } catch (error) {
    console.warn('[serveur] server.config.json illisible :', error.message);
  }
  return '';
}

let TOKEN = readToken();

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
    return sendJson(response, 200, {
      configured: Boolean(TOKEN),
      mode: TOKEN ? 'proxy' : 'none',
      message: TOKEN
        ? 'Jeton Mapillary chargé côté serveur. Il n\'est jamais transmis au navigateur.'
        : 'Aucun jeton Mapillary. Renseignez MAPILLARY_TOKEN ou server.config.json, puis relancez le serveur.',
    });
  }

  if (url.pathname !== '/api/mapillary/images') {
    return sendJson(response, 404, { error: 'Route inconnue' });
  }

  if (!TOKEN) {
    return sendJson(response, 501, {
      configured: false,
      error: 'Jeton Mapillary absent',
      message: 'Créez server.config.json avec { "mapillaryToken": "MLY|…" } puis relancez node server.js. Les photos Panoramax fonctionnent sans jeton.',
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
  upstream.searchParams.set('access_token', TOKEN);
  upstream.searchParams.set('fields', 'id,thumb_1024_url,thumb_2048_url,captured_at,compass_angle,is_pano,geometry');
  upstream.searchParams.set('bbox', bbox);
  upstream.searchParams.set('limit', String(limit));

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const upstreamResponse = await fetch(upstream, { signal: controller.signal, headers: { Accept: 'application/json' } });
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
        message: detail || 'Vérifiez la validité du jeton client Mapillary.',
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
    return response.end('<!doctype html><meta charset="utf-8"><h1>404</h1><p>Fichier introuvable.</p><p><a href="/">Retour à l\'application</a></p>');
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
      node: process.version,
    });
  }

  if (url.pathname.startsWith('/api/mapillary')) {
    return handleMapillary(request, response, url);
  }

  if (url.pathname.startsWith('/api/proxy/')) {
    return handlePublicProxy(request, response, url);
  }

  if (url.pathname === '/api/reload-token') {
    TOKEN = readToken();
    return sendJson(response, 200, { configured: Boolean(TOKEN) });
  }

  return serveStatic(request, response, url);
});

server.listen(PORT, HOST, () => {
  const tokenState = TOKEN ? 'chargé (proxy actif)' : 'absent (Panoramax reste disponible sans jeton)';
  console.log('');
  console.log('  Company Locator France — serveur local');
  console.log('  --------------------------------------');
  console.log(`  Application : http://localhost:${PORT}/`);
  console.log(`  Santé       : http://localhost:${PORT}/api/health`);
  console.log(`  Jeton Mapillary : ${tokenState}`);
  console.log('  Arrêt : Ctrl + C');
  console.log('');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[serveur] Le port ${PORT} est déjà utilisé. Lancez : PORT=8090 node server.js (ou sous PowerShell : $env:PORT=8090; node server.js)`);
    process.exit(1);
  }
  console.error('[serveur] Erreur :', error.message);
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n[serveur] Arrêt…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
