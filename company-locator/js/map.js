/**
 * map.js — Intégration cartographique Leaflet (aucune logique métier).
 *
 * Responsabilité : instancier et piloter les cartes, gérer les fonds
 * (OpenStreetMap, Plan IGN, BD ORTHO® IGN), les marqueurs, les popups,
 * le plein écran, les cercles d'incertitude et la détection d'échec des tuiles.
 *
 * Leaflet est servi localement depuis vendor/leaflet/ (aucun CDN).
 * Les attributions des fournisseurs sont toujours affichées sur la carte.
 */

import config, { buildWmtsUrl } from './config.js';
import { el, icon, escapeHtml, formatCoords, isPlausibleFranceCoords, clamp } from './utils.js';

/* ==================================================================== */
/* 1. Disponibilité de Leaflet                                           */
/* ==================================================================== */

let leafletPromise = null;

/** Attend que le script Leaflet (defer) soit prêt, avec échec explicite. */
export function ensureLeaflet(timeoutMs = 8000) {
  if (typeof window !== 'undefined' && window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (window.L) return resolve(window.L);
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('Leaflet n\'a pas pu être chargé (vendor/leaflet/leaflet.js). Servez le dossier via un serveur local.'));
      }
      setTimeout(check, 60);
    };
    check();
  });
  return leafletPromise;
}

/* ==================================================================== */
/* 2. Fonds de carte                                                     */
/* ==================================================================== */

export const BASE_LAYERS = {
  osm: {
    key: 'osm',
    label: 'Plan OpenStreetMap',
    isPhoto: false,
    build(L) {
      return L.tileLayer(config.api.osm.tileUrl, {
        maxZoom: config.api.osm.maxZoom,
        attribution: config.api.osm.attribution,
        crossOrigin: true,
      });
    },
  },
  planign: {
    key: 'planign',
    label: 'Plan IGN',
    isPhoto: false,
    build(L) {
      const c = config.api.planIgn;
      return L.tileLayer(buildWmtsUrl(c), {
        maxZoom: c.maxZoom,
        maxNativeZoom: c.maxNativeZoom,
        attribution: c.attribution,
        crossOrigin: true,
      });
    },
  },
  ortho: {
    key: 'ortho',
    label: 'Photographie aérienne IGN (BD ORTHO®)',
    isPhoto: true,
    build(L) {
      const c = config.api.orthoIgn;
      return L.tileLayer(buildWmtsUrl(c), {
        maxZoom: c.maxZoom,
        maxNativeZoom: c.maxNativeZoom,
        minNativeZoom: c.minNativeZoom,
        attribution: c.attribution,
        crossOrigin: true,
      });
    },
  },
};

/** Couche de repli si la couche HR (20 cm) ne couvre pas la zone. */
function buildOrthoFallback(L) {
  const c = config.api.orthoIgn;
  return L.tileLayer(buildWmtsUrl({ ...c, layer: c.fallbackLayer }), {
    maxZoom: c.maxZoom,
    maxNativeZoom: c.maxNativeZoom,
    attribution: c.attribution,
    crossOrigin: true,
  });
}

/* ==================================================================== */
/* 3. Marqueurs                                                          */
/* ==================================================================== */

function markerIcon(L, { index = null, siege = false, closed = false, selected = false } = {}) {
  const size = selected ? 32 : 26;
  const classes = ['clf-marker'];
  if (siege) classes.push('is-siege');
  if (closed) classes.push('is-closed');
  if (selected) classes.push('is-selected');
  return L.divIcon({
    className: classes.join(' '),
    html: `<span class="pin"><span class="pin-label">${index == null ? '' : escapeHtml(String(index))}</span></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 4],
  });
}

function targetIcon(L) {
  return L.divIcon({
    className: 'clf-target',
    html: '<div class="ring"><span class="dot"></span></div>',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

/** Contenu de popup construit en DOM (aucune injection HTML de données API). */
function popupContent(row, position, onSelect) {
  const { etablissement, entreprise } = row;
  const wrap = el('div', { class: 'clf-popup' });
  wrap.append(el('h4', { text: etablissement.nomAffiche }));
  if (entreprise.raisonSociale && entreprise.raisonSociale !== etablissement.nomAffiche) {
    wrap.append(el('p', { class: 'p-sub', text: entreprise.raisonSociale }));
  }
  wrap.append(el('p', { class: 'p-addr', text: etablissement.adresse || 'Adresse non publiée' }));

  const meta = el('p', { class: 'p-meta' });
  meta.append(el('span', {
    class: `badge ${etablissement.estActif ? 'badge-success' : 'badge-danger'}`,
    text: etablissement.estActif ? 'Actif' : (etablissement.etatAdministratif === 'C' ? 'Fermé' : 'État inconnu'),
  }));
  if (etablissement.estSiege) meta.append(el('span', { class: 'badge badge-accent', text: 'Siège' }));
  wrap.append(meta);

  if (position) {
    wrap.append(el('p', { class: 'p-coords', text: formatCoords(position.lat, position.lon) }));
  }
  wrap.append(el('button', {
    type: 'button',
    class: 'btn btn-sm btn-primary',
    text: 'Consulter la fiche',
    onclick: () => onSelect?.(row.etablissement.siret),
  }));
  return wrap;
}

/* ==================================================================== */
/* 4. Carte principale                                                   */
/* ==================================================================== */

/**
 * @param {object} options { container, overlay, readout, credits, onMarkerSelect, onCenterChange }
 */
export async function createMap(options) {
  const L = await ensureLeaflet();
  const { container, overlay = null, readout = null, credits = null, onMarkerSelect = null, onCenterChange = null } = options;

  const map = L.map(container, {
    center: config.map.franceCenter,
    zoom: config.map.franceZoom,
    zoomControl: true,
    attributionControl: true,
    // Rendu SVG (et non canvas) : plus compatible, et suffisant ici puisque
    // les marqueurs sont des éléments DOM et les vecteurs très peu nombreux.
    preferCanvas: false,
    worldCopyJump: false,
  });
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  const layers = {};
  let currentKey = null;
  let tileFailures = 0;
  let tileSuccesses = 0;
  let usedFallback = false;

  const markers = new Map();
  const markerLayer = L.layerGroup().addTo(map);
  const uncertaintyLayer = L.layerGroup().addTo(map);
  let selectedSiret = null;
  let rowsRef = [];

  function showOverlay({ title, message, iconName = 'info', transparent = false, action = null }) {
    if (!overlay) return;
    overlay.hidden = false;
    overlay.classList.toggle('is-transparent', transparent);
    overlay.replaceChildren(
      icon(iconName),
      el('h3', { text: title }),
      el('p', { text: message }),
      action || null,
    );
  }
  function hideOverlay() {
    if (!overlay) return;
    overlay.hidden = true;
    overlay.replaceChildren();
  }

  function updateCredits() {
    if (!credits) return;
    const layer = BASE_LAYERS[currentKey];
    const parts = [];
    if (layer?.isPhoto) parts.push('Photographie aérienne : IGN BD ORTHO® — ce n\'est pas un plan.');
    else parts.push('Fond de plan — pas une photographie.');
    const missing = rowsRef.filter((row) => !hasCoords(row)).length;
    if (rowsRef.length) {
      parts.push(`${rowsRef.length - missing}/${rowsRef.length} établissement(s) localisé(s)`);
    }
    credits.textContent = parts.join(' · ');
  }

  function attachTileEvents(layer) {
    layer.on('tileerror', () => {
      tileFailures += 1;
      // Bascule automatique HR → BD ORTHO standard, une seule fois.
      if (currentKey === 'ortho' && !usedFallback && tileFailures >= 4 && tileSuccesses === 0) {
        usedFallback = true;
        const fallback = buildOrthoFallback(L);
        map.removeLayer(layer);
        layers.ortho = fallback;
        attachTileEvents(fallback);
        fallback.addTo(map);
        if (credits) credits.textContent = 'Couche 20 cm indisponible : repli sur BD ORTHO® standard (IGN).';
        return;
      }
      if (tileFailures >= 6 && tileSuccesses === 0) {
        showOverlay({
          iconName: 'alert',
          title: currentKey === 'ortho' ? 'Photographie aérienne indisponible' : 'Fond de carte indisponible',
          message: currentKey === 'ortho'
            ? 'Les tuiles BD ORTHO® ne répondent pas pour cette zone ou cette connexion. Aucune image de remplacement n\'est affichée.'
            : 'Les tuiles du fond de carte ne répondent pas. Vérifiez votre connexion Internet.',
        });
      }
    });
    layer.on('tileload', () => {
      tileSuccesses += 1;
      if (tileSuccesses === 1) hideOverlay();
    });
  }

  function setBaseLayer(key) {
    const definition = BASE_LAYERS[key] ? key : 'osm';
    if (currentKey === definition) return definition;
    if (currentKey && layers[currentKey]) map.removeLayer(layers[currentKey]);
    tileFailures = 0;
    tileSuccesses = 0;
    if (definition !== 'ortho') usedFallback = false;
    if (!layers[definition]) {
      layers[definition] = BASE_LAYERS[definition].build(L);
      attachTileEvents(layers[definition]);
    }
    layers[definition].addTo(map);
    currentKey = definition;
    hideOverlay();
    updateCredits();
    return definition;
  }

  function hasCoords(row) {
    return isPlausibleFranceCoords(row.etablissement.latitude, row.etablissement.longitude);
  }

  function updateReadout() {
    if (!readout) return;
    const center = map.getCenter();
    readout.textContent = `Centre : ${formatCoords(center.lat, center.lng, 5)} · zoom ${map.getZoom()}`;
    onCenterChange?.({ lat: center.lat, lon: center.lng, zoom: map.getZoom() });
  }

  map.on('moveend zoomend', updateReadout);

  /** Remplace les marqueurs par ceux des résultats courants. */
  function setRows(rows) {
    rowsRef = rows;
    markerLayer.clearLayers();
    markers.clear();
    let index = 0;
    for (const row of rows) {
      if (!hasCoords(row)) continue;
      index += 1;
      const { etablissement } = row;
      const marker = L.marker([etablissement.latitude, etablissement.longitude], {
        icon: markerIcon(L, {
          index,
          siege: etablissement.estSiege,
          closed: !etablissement.estActif,
          selected: etablissement.siret === selectedSiret,
        }),
        title: `${etablissement.nomAffiche} — ${etablissement.commune || ''}`,
        alt: etablissement.nomAffiche,
        keyboard: true,
        riseOnHover: true,
      });
      marker.bindPopup(() => popupContent(row, null, onMarkerSelect), { maxWidth: 300, autoPan: true });
      marker.on('click', () => onMarkerSelect?.(etablissement.siret, { fromMap: true, keepPopup: true }));
      marker.addTo(markerLayer);
      markers.set(etablissement.siret, { marker, row, index });
    }
    updateCredits();
    if (rows.length && markers.size === 0) {
      showOverlay({
        iconName: 'pin',
        title: 'Aucune coordonnée disponible',
        message: 'Les établissements trouvés ne comportent pas de coordonnées exploitables. Ouvrez une fiche pour tenter un géocodage de l\'adresse.',
      });
    } else if (markers.size) {
      hideOverlay();
    }
    return markers.size;
  }

  function fitAll({ maxZoom = config.map.fitMaxZoom } = {}) {
    uncertaintyLayer.clearLayers();
    if (markers.size === 0) {
      map.setView(config.map.franceCenter, config.map.franceZoom);
      return false;
    }
    const bounds = L.latLngBounds([...markers.values()].map((entry) => entry.marker.getLatLng()));
    map.fitBounds(bounds, { padding: config.map.fitPadding, maxZoom });
    return true;
  }

  /** Met en avant un établissement (icône + centrage + popup). */
  function select(siret, { position = null, pan = true, openPopup = true } = {}) {
    selectedSiret = siret;
    for (const [key, entry] of markers) {
      entry.marker.setIcon(markerIcon(L, {
        index: entry.index,
        siege: entry.row.etablissement.estSiege,
        closed: !entry.row.etablissement.estActif,
        selected: key === siret,
      }));
    }
    const entry = markers.get(siret);
    const target = position && isPlausibleFranceCoords(position.lat, position.lon)
      ? [position.lat, position.lon]
      : (entry ? entry.marker.getLatLng() : null);

    if (target && pan) {
      map.setView(target, Math.max(map.getZoom(), config.map.establishmentZoom), { animate: true });
    }
    if (entry && openPopup) entry.marker.openPopup();
    if (position) drawUncertainty(position);
    updateCredits();
    return Boolean(target);
  }

  /** Ajoute un marqueur si l'établissement géocodé n'était pas encore placé. */
  function upsertPosition(row, position) {
    if (!position || !isPlausibleFranceCoords(position.lat, position.lon)) return;
    const existing = markers.get(row.etablissement.siret);
    if (existing) {
      existing.marker.setLatLng([position.lat, position.lon]);
      return;
    }
    const index = markers.size + 1;
    const marker = L.marker([position.lat, position.lon], {
      icon: markerIcon(L, { index, siege: row.etablissement.estSiege, closed: !row.etablissement.estActif, selected: true }),
      title: row.etablissement.nomAffiche,
      keyboard: true,
    });
    marker.bindPopup(() => popupContent(row, position, onMarkerSelect), { maxWidth: 300 });
    marker.on('click', () => onMarkerSelect?.(row.etablissement.siret, { fromMap: true, keepPopup: true }));
    marker.addTo(markerLayer);
    markers.set(row.etablissement.siret, { marker, row, index });
    hideOverlay();
  }

  /** Cercle pointillé matérialisant une localisation imprécise. */
  function drawUncertainty(position) {
    uncertaintyLayer.clearLayers();
    if (!position) return;
    const radiusByPrecision = { commune: 1200, voie: 350, sirene: 250, adresse: 0 };
    const radius = radiusByPrecision[position.precision] ?? 0;
    if (!radius) return;
    L.circle([position.lat, position.lon], {
      radius,
      color: '#ea580c',
      weight: 1.5,
      dashArray: '5 5',
      fillOpacity: 0.07,
      interactive: false,
      className: 'clf-uncertainty',
    }).addTo(uncertaintyLayer);
  }

  function invalidate() { map.invalidateSize({ animate: false }); }

  setBaseLayer(config.map.defaultBaseLayer);
  updateReadout();

  return {
    map,
    L,
    setRows,
    select,
    upsertPosition,
    fitAll,
    setBaseLayer,
    getBaseLayer: () => currentKey,
    isPhotoLayer: () => Boolean(BASE_LAYERS[currentKey]?.isPhoto),
    getCenter: () => ({ lat: map.getCenter().lat, lon: map.getCenter().lng }),
    getSelected: () => selectedSiret,
    markerCount: () => markers.size,
    invalidate,
    showOverlay,
    hideOverlay,
    setZoom: (zoom) => map.setZoom(clamp(zoom, 1, BASE_LAYERS[currentKey] ? 21 : 19)),
    destroy: () => map.remove(),
  };
}

/* ==================================================================== */
/* 5. Mini-carte « photographie aérienne »                               */
/* ==================================================================== */

/**
 * Carte dédiée à l'orthophotographie IGN, avec croix de visée sur le bâtiment.
 * @param {object} options { container, position, zoom, onTileStatus }
 */
export async function createAerialMap(options) {
  const L = await ensureLeaflet();
  const { container, position, zoom = config.imagery.aerialZoom, onTileStatus = null } = options;

  const map = L.map(container, {
    center: [position.lat, position.lon],
    zoom,
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false,
  });
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  let failures = 0;
  let successes = 0;
  let fallbackUsed = false;

  const layer = BASE_LAYERS.ortho.build(L);
  const attach = (tileLayer) => {
    tileLayer.on('tileload', () => {
      successes += 1;
      if (successes === 1) onTileStatus?.({ ok: true, fallbackUsed });
    });
    tileLayer.on('tileerror', () => {
      failures += 1;
      if (!fallbackUsed && failures >= 3 && successes === 0) {
        fallbackUsed = true;
        map.removeLayer(tileLayer);
        const fallback = buildOrthoFallback(L);
        attach(fallback);
        fallback.addTo(map);
        return;
      }
      if (failures >= 5 && successes === 0) onTileStatus?.({ ok: false, fallbackUsed });
    });
  };
  attach(layer);
  layer.addTo(map);

  L.marker([position.lat, position.lon], { icon: targetIcon(L), interactive: false, keyboard: false }).addTo(map);

  const radiusByPrecision = { commune: 1200, voie: 350, sirene: 250, adresse: 0 };
  const radius = radiusByPrecision[position.precision] ?? 0;
  if (radius) {
    L.circle([position.lat, position.lon], {
      radius, color: '#f97316', weight: 1.5, dashArray: '6 6', fillOpacity: 0.05, interactive: false,
    }).addTo(map);
    map.fitBounds(L.latLngBounds([position.lat, position.lon]).pad(0.02), { maxZoom: 17 });
  }

  // Le scroll molette n'est activé qu'après un clic (évite de piéger le défilement).
  map.on('click', () => map.scrollWheelZoom.enable());
  map.on('mouseout', () => map.scrollWheelZoom.disable());

  return {
    map,
    invalidate: () => map.invalidateSize({ animate: false }),
    setZoom: (value) => map.setZoom(clamp(value, 6, config.api.orthoIgn.maxZoom)),
    getZoom: () => map.getZoom(),
    recenter: () => map.setView([position.lat, position.lon], zoom),
    destroy: () => map.remove(),
  };
}

/* ==================================================================== */
/* 6. Plein écran & test de disponibilité                                */
/* ==================================================================== */

export function toggleFullscreen(card, controller, button) {
  const active = card.classList.toggle('is-fullscreen');
  document.body.classList.toggle('has-fullscreen-map', active);
  if (button) {
    button.setAttribute('aria-label', active ? 'Quitter le plein écran' : 'Passer la carte en plein écran');
    button.setAttribute('title', active ? 'Quitter le plein écran' : 'Plein écran');
    button.replaceChildren(icon(active ? 'collapse' : 'expand'));
    button.classList.toggle('is-active', active);
  }
  setTimeout(() => controller?.invalidate(), 60);
  return active;
}

/** Charge une tuile réelle pour tester la disponibilité du service. */
export function pingTiles(kind = 'ortho', timeoutMs = 9000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const c = kind === 'ortho' ? config.api.orthoIgn : config.api.planIgn;
    const url = buildWmtsUrl(c).replace('{z}', '15').replace('{y}', '11481').replace('{x}', '16598');
    const image = new Image();
    const timer = setTimeout(() => {
      image.src = '';
      resolve({ ok: false, latencyMs: Date.now() - started, reason: 'délai dépassé' });
    }, timeoutMs);
    image.onload = () => {
      clearTimeout(timer);
      resolve({ ok: true, latencyMs: Date.now() - started });
    };
    image.onerror = () => {
      clearTimeout(timer);
      resolve({ ok: false, latencyMs: Date.now() - started, reason: 'tuile refusée' });
    };
    image.referrerPolicy = 'no-referrer-when-downgrade';
    image.src = url;
  });
}

/** Lien OpenStreetMap centré sur l'établissement. */
export function osmLink(lat, lon, zoom = 18) {
  return `${config.api.osm.linkUrl}?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

/** Lien IGN « Remonter le temps » : comparaison des millésimes aériens. */
export function ignTimeLink(lat, lon, zoom = 18) {
  return `https://remonterletemps.ign.fr/comparer/basic?x=${lon}&y=${lat}&z=${zoom}&layer1=ORTHOIMAGERY.ORTHOPHOTOS&mode=doubleMap`;
}
