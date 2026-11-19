/**
 * map.js — Cartes Leaflet de la fiche : Localisation (plan) et Vue satellite (IGN BD ORTHO®).
 */

import config from './config.js';
import { clamp, isPlausibleFranceCoords } from './utils.js';

function wmtsTileUrl({ wmtsUrl, layer, style, format, tileMatrixSet }) {
  const params = new URLSearchParams({
    SERVICE: 'WMTS',
    REQUEST: 'GetTile',
    VERSION: '1.0.0',
    LAYER: layer,
    STYLE: style || 'normal',
    FORMAT: format,
    TILEMATRIXSET: tileMatrixSet || 'PM',
  });
  return `${wmtsUrl}?${params}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
}

function buildPlanLayer(L) {
  return L.tileLayer(config.api.osm.tileUrl, {
    maxZoom: config.api.osm.maxZoom,
    attribution: config.api.osm.attribution,
    crossOrigin: 'anonymous',
  });
}

function buildPlanIgnLayer(L) {
  const c = config.api.planIgn;
  return L.tileLayer(wmtsTileUrl(c), {
    maxNativeZoom: c.maxNativeZoom,
    maxZoom: c.maxZoom,
    attribution: c.attribution,
  });
}

function buildOrthoLayer(L, layerName = config.api.orthoIgn.layer) {
  const c = config.api.orthoIgn;
  return L.tileLayer(wmtsTileUrl({ ...c, layer: layerName }), {
    minNativeZoom: c.minNativeZoom,
    maxNativeZoom: c.maxNativeZoom,
    maxZoom: c.maxZoom,
    attribution: c.attribution,
  });
}

/** Épingle rouge goutte d'eau (identique à la fiche CRM). */
function redPinIcon(L) {
  return L.divIcon({
    className: 'crm-pin-wrap',
    html: `<svg class="crm-pin-svg" viewBox="0 0 32 44" width="30" height="42" aria-hidden="true">
      <path d="M16 1C8.27 1 2 7.27 2 15c0 10.2 14 27 14 27s14-16.8 14-27C30 7.27 23.73 1 16 1z"
            fill="#e53935" stroke="#b71c1c" stroke-width="1.2"/>
      <circle cx="16" cy="15" r="5.2" fill="#7f1111"/>
    </svg>`,
    iconSize: [30, 42],
    iconAnchor: [15, 41],
    popupAnchor: [0, -36],
  });
}

let leafletReady = null;
export function ensureLeaflet() {
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.L) { resolve(window.L); return; }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      if (typeof window !== 'undefined' && window.L) {
        clearInterval(timer);
        resolve(window.L);
      } else if (attempts > 60) {
        clearInterval(timer);
        reject(new Error('Leaflet indisponible.'));
      }
    }, 50);
  });
  return leafletReady;
}

/** Carte « Localisation » (plan routier + épingle rouge). */
export async function createPlanMap(container) {
  const L = await ensureLeaflet();
  const map = L.map(container, {
    center: config.map.franceCenter,
    zoom: config.map.franceZoom,
    zoomControl: false,
    attributionControl: false,
    scrollWheelZoom: false,
  });

  let failures = 0;
  let successes = 0;
  let switched = false;
  const primary = buildPlanIgnLayer(L);
  primary.on('tileload', () => { successes += 1; });
  primary.on('tileerror', () => {
    failures += 1;
    if (!switched && failures >= 4 && successes === 0) {
      switched = true;
      map.removeLayer(primary);
      buildPlanLayer(L).addTo(map);
    }
  });
  primary.addTo(map);

  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());

  let marker = null;
  let currentPoint = null;

  return {
    map,
    setPoint(lat, lon, { zoom = config.map.planZoom, label = '' } = {}) {
      if (!isPlausibleFranceCoords(lat, lon)) return false;
      currentPoint = { lat, lon, label };
      if (marker) {
        marker.setLatLng([lat, lon]);
      } else {
        marker = L.marker([lat, lon], { icon: redPinIcon(L), title: label || 'Localisation' }).addTo(map);
      }
      map.setView([lat, lon], clamp(zoom, 5, 19), { animate: false });
      return true;
    },
    clear() {
      if (marker) { map.removeLayer(marker); marker = null; }
      currentPoint = null;
      map.setView(config.map.franceCenter, config.map.franceZoom, { animate: false });
    },
    getPoint: () => currentPoint,
    invalidate: () => map.invalidateSize({ animate: false }),
    destroy: () => map.remove(),
  };
}

/** Carte « Vue satellite » (orthophotographie IGN BD ORTHO® 20 cm centrée sur le bâtiment). */
export async function createSatelliteMap(container, { onStatus = null } = {}) {
  const L = await ensureLeaflet();
  const map = L.map(container, {
    center: config.map.franceCenter,
    zoom: config.map.franceZoom,
    zoomControl: false,
    attributionControl: false,
    scrollWheelZoom: false,
  });

  let activeLayer = null;
  let fallbackUsed = false;
  let failures = 0;
  let successes = 0;

  function mountOrtho(layerName) {
    if (activeLayer) map.removeLayer(activeLayer);
    const layer = buildOrthoLayer(L, layerName);
    layer.on('tileload', () => {
      successes += 1;
      if (successes === 1) onStatus?.({ ok: true });
    });
    layer.on('tileerror', () => {
      failures += 1;
      if (!fallbackUsed && failures >= 3 && successes === 0) {
        fallbackUsed = true;
        failures = 0;
        mountOrtho(config.api.orthoIgn.fallbackLayer);
      } else if (fallbackUsed && failures >= 5 && successes === 0) {
        onStatus?.({ ok: false });
      }
    });
    activeLayer = layer;
    layer.addTo(map);
  }

  mountOrtho(config.api.orthoIgn.layer);

  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());

  return {
    map,
    setPoint(lat, lon, { zoom = config.map.aerialZoom } = {}) {
      if (!isPlausibleFranceCoords(lat, lon)) return false;
      failures = 0;
      map.setView([lat, lon], clamp(zoom, 6, 20), { animate: false });
      return true;
    },
    clear() {
      map.setView(config.map.franceCenter, config.map.franceZoom, { animate: false });
    },
    invalidate: () => map.invalidateSize({ animate: false }),
    destroy: () => map.remove(),
  };
}

/** Carte plein écran ouverte dans la modale d'agrandissement (`⤢`). */
export async function createExpandedMap(container, { lat, lon, label = '', initialLayer = 'plan' } = {}) {
  const L = await ensureLeaflet();
  const center = isPlausibleFranceCoords(lat, lon) ? [lat, lon] : config.map.franceCenter;
  const zoom = isPlausibleFranceCoords(lat, lon) ? 16 : config.map.franceZoom;
  const map = L.map(container, {
    center,
    zoom,
    zoomControl: true,
    attributionControl: true,
  });
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  const layers = {
    plan: buildPlanLayer(L),
    ign: buildPlanIgnLayer(L),
    satellite: buildOrthoLayer(L),
  };
  let current = layers[initialLayer] ? initialLayer : 'plan';
  layers[current].addTo(map);

  if (isPlausibleFranceCoords(lat, lon)) {
    const marker = L.marker([lat, lon], { icon: redPinIcon(L), title: label }).addTo(map);
    if (label) marker.bindPopup(label);
  }

  return {
    map,
    setLayer(name) {
      if (!layers[name] || name === current) return;
      map.removeLayer(layers[current]);
      current = name;
      layers[current].addTo(map);
    },
    invalidate: () => map.invalidateSize({ animate: false }),
    destroy: () => map.remove(),
  };
}
