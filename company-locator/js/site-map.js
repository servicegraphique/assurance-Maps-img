import { BASE_LAYERS } from './map.js';
import { fetchSiteSource, SITE_SOURCES } from './site-data.js';
import { measure } from './site-measure.js';
import { proxyState } from './transport.js';
import { el } from './utils.js';

const SOURCES = {
  batiments: { label: 'Bâtiments · IGN BD TOPO', color: '#2563eb', kind: 'Toiture' },
  parkings: { label: 'Parkings · OpenStreetMap / Overpass', color: '#e11d48', kind: 'Parking' },
  'parking-ign': { label: 'Parkings · IGN BD TOPO (complément)', color: '#ea580c', kind: 'Parking' },
  parcelle: { label: 'Parcelle · API Carto / cadastre', color: '#16a34a', kind: 'Parcelle' },
};

export function createSiteMap(host, position) {
  const L = window.L, turf = window.turf;
  if (!L || !turf || !window.osmtogeojson || !L.PM) {
    host.append(el('p', { class: 'notice notice-warning', text: 'Les outils cartographiques ne sont pas disponibles. Rechargez la page via le serveur de l’application.' }));
    return { destroy() {}, invalidate() {} };
  }
  const toolbar = el('div', { class: 'site-toolbar' });
  const analyzeButton = el('button', { type: 'button', class: 'btn btn-sm btn-outline', text: 'Choisir un point sur la carte' });
  const resetButton = el('button', { type: 'button', class: 'btn btn-sm btn-outline', text: 'Analyser le GPS de l’établissement', disabled: !position });
  const copyButton = el('button', { type: 'button', class: 'btn btn-sm btn-outline', text: 'Corriger une copie du polygone sélectionné', disabled: true });
  const slope = el('input', { type: 'number', min: '0', max: '80', step: '1', value: '30', 'aria-label': 'Pente de toiture en degrés' });
  const label = el('label', { class: 'site-slope' }, ['Pente du toit (°)', slope]);
  toolbar.append(analyzeButton, resetButton, copyButton, label);
  const hint = el('p', { class: 'muted-xs', text: 'Sélectionnez un polygone pour ses mesures. Utilisez les outils à gauche de la carte pour dessiner, modifier ou supprimer un polygone manuel. Les dessins ne sont pas enregistrés.' });
  const mapNode = el('div', { class: 'site-map', role: 'application', 'aria-label': 'Carte de mesure des bâtiments, parkings et parcelles' });
  const status = el('div', { class: 'site-status', role: 'status', 'aria-live': 'polite' });
  const details = el('div', { class: 'site-details', 'aria-live': 'polite', text: 'Sélectionnez un polygone pour afficher ses mesures.' });
  const caveat = el('p', { class: 'muted-xs', text: 'Les objets proches ne sont pas nécessairement liés à l’entreprise. L’emprise est au sol ; les dimensions correspondent au rectangle englobant orienté, et non forcément aux côtés réels. La toiture est une estimation simplifiée : pente uniforme supposée, sans prise en compte des formes de toit. Mesures indicatives, non cadastrales ni de géomètre.' });
  host.append(toolbar, hint, mapNode, status, details, caveat);
  const center = position ? [position.lat, position.lon] : [46.6, 2.5];
  const map = L.map(mapNode, { center, zoom: position ? 19 : 6, scrollWheelZoom: false });
  const ortho = BASE_LAYERS.ortho.build(L).addTo(map);
  L.control.layers({ 'Photo aérienne IGN': ortho, 'Plan IGN': BASE_LAYERS.planign.build(L), 'Plan OpenStreetMap': BASE_LAYERS.osm.build(L) }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);
  map.attributionControl.addAttribution('Données : IGN BD TOPO / API Carto et © OpenStreetMap contributors');
  map.pm.setLang('fr');
  map.pm.addControls({ position: 'topleft', drawMarker: false, drawCircleMarker: false, drawPolyline: false, drawRectangle: false, drawCircle: false, drawText: false, drawPolygon: true, editMode: true, dragMode: false, cutPolygon: false, removalMode: true, rotateMode: false });
  const layers = L.layerGroup().addTo(map);
  const marker = L.marker(center, { pmIgnore: true }).addTo(map);
  if (!position) marker.remove();
  let selected = null, selectedLayer = null, selectingPoint = false, seq = 0, controller = null, destroyed = false;
  let statuses = {};
  function renderStatus() {
    status.replaceChildren(...SITE_SOURCES.map(key => el('p', { text: `${SOURCES[key].label} : ${statuses[key] || 'en attente'}` })));
  }
  function showDetails(feature, layer, labelText, manual = false) {
    selected = { feature, labelText, manual }; selectedLayer = layer;
    copyButton.disabled = manual;
    try {
      const value = slope.valueAsNumber;
      const m = measure(feature, turf, value);
      const num = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n);
      const content = [el('strong', { text: `${labelText}${manual ? ' · dessin manuel' : ''}` }),
        el('p', { text: `Surface au sol : ${num(m.surface)} m² · Périmètre : ${num(m.perimetre)} m` }),
        el('p', { text: `Rectangle englobant : ${num(m.longueur)} × ${num(m.largeur)} m` })];
      if (labelText === 'Toiture' || manual) content.push(el('p', { text: `Toiture estimée à ${num(value)}° : ${num(m.surfaceToit)} m² (hypothèse simplifiée)` }));
      const official = feature.properties?.contenance;
      if (labelText === 'Parcelle') content.push(el('p', { text: official !== undefined && official !== null && official !== '' ? `Contenance cadastrale officielle : ${String(official)} m²` : 'Contenance cadastrale officielle non fournie.' }));
      details.replaceChildren(...content);
      layer?.bindTooltip(`${labelText} : ${num(m.surface)} m² · ${num(m.longueur)} × ${num(m.largeur)} m`);
    } catch (error) { details.textContent = `Mesure impossible : ${error.message}. Vérifiez le polygone et la pente (0 à 80°).`; }
  }
  function addManual(layer) {
    layer.setStyle({ color: '#9333ea', fillOpacity: 0.2 });
    layer.on('click', e => {
      if (selectingPoint) { L.DomEvent.stopPropagation(e); choosePoint(e.latlng); return; }
      showDetails(layer.toGeoJSON(), layer, 'Polygone', true);
    });
    layer.on('pm:edit pm:change', () => showDetails(layer.toGeoJSON(), layer, 'Polygone', true));
    layer.on('pm:remove', () => { if (selectedLayer === layer) { selected = null; selectedLayer = null; copyButton.disabled = true; details.textContent = 'Polygone supprimé.'; } });
    showDetails(layer.toGeoJSON(), layer, 'Polygone', true);
  }
  map.on('pm:create', e => addManual(e.layer));
  map.on('pm:drawstart', () => { selectingPoint = false; analyzeButton.textContent = 'Choisir un point sur la carte'; analyzeButton.setAttribute('aria-pressed', 'false'); });
  slope.addEventListener('input', () => { if (selected) showDetails(selected.manual ? selectedLayer.toGeoJSON() : selected.feature, selectedLayer, selected.labelText, selected.manual); });
  copyButton.addEventListener('click', () => {
    if (!selected || selected.manual) return;
    const original = selected.feature;
    L.geoJSON(original, { style: { color: '#9333ea', fillOpacity: 0.2 }, onEachFeature: (_f, layer) => { layer.addTo(map); addManual(layer); layer.pm.enable(); } });
  });
  function draw(source, data) {
    const spec = SOURCES[source];
    let collection = source === 'parkings' ? window.osmtogeojson(data) : data;
    let features = collection.features.filter(f => ['Polygon', 'MultiPolygon'].includes(f.geometry?.type));
    if (source === 'parking-ign') features = features.filter(f => /parking/i.test(String(f.properties?.nature || '')));
    features = features.slice(0, 500);
    L.geoJSON({ type: 'FeatureCollection', features }, {
      pmIgnore: true,
      style: { color: spec.color, weight: 2, fillOpacity: 0.12 },
      onEachFeature: (feature, layer) => {
        layer.options.pmIgnore = true;
        layer.on('click', e => {
          L.DomEvent.stopPropagation(e);
          if (selectingPoint) { choosePoint(e.latlng); return; }
          showDetails(feature, layer, spec.kind);
        });
      },
    }).addTo(layers);
    return features.length;
  }
  async function analyze(lat, lon) {
    controller?.abort(); controller = new AbortController(); const signal = controller.signal, current = ++seq;
    layers.clearLayers(); selected = null; selectedLayer = null; copyButton.disabled = true;
    details.textContent = 'Sélectionnez un polygone pour afficher ses mesures.';
    marker.setLatLng([lat, lon]).addTo(map);
    statuses = Object.fromEntries(SITE_SOURCES.map(k => [k, 'chargement…'])); renderStatus();
    await Promise.all(SITE_SOURCES.map(async key => {
      try {
        const data = await fetchSiteSource(key, lat, lon, { signal, proxy: proxyState().available });
        if (destroyed || current !== seq) return;
        const count = draw(key, data);
        statuses[key] = `${count} polygone(s)${count === 500 ? ' (limite atteinte)' : ''}`;
      } catch (error) {
        if (destroyed || current !== seq || signal.aborted) return;
        statuses[key] = `indisponible — ${error.message}`;
      }
      renderStatus();
    }));
  }
  analyzeButton.addEventListener('click', () => {
    selectingPoint = !selectingPoint;
    analyzeButton.textContent = selectingPoint ? 'Cliquez sur la carte pour analyser · Annuler' : 'Choisir un point sur la carte';
    analyzeButton.setAttribute('aria-pressed', String(selectingPoint));
  });
  function choosePoint(point) {
    if (!point) return;
    selectingPoint = false; analyzeButton.textContent = 'Choisir un point sur la carte'; analyzeButton.setAttribute('aria-pressed', 'false');
    analyze(point.lat, point.lng);
  }
  map.on('click', e => { if (selectingPoint) choosePoint(e.latlng); });
  resetButton.addEventListener('click', () => { if (position) { map.setView(center, 19); analyze(position.lat, position.lon); } });
  renderStatus();
  if (position) analyze(position.lat, position.lon);
  else status.prepend(el('p', { text: 'GPS indisponible : choisissez un point sur la carte ou dessinez manuellement.' }));
  return { destroy() { destroyed = true; seq++; controller?.abort(); map.remove(); }, invalidate() { map.invalidateSize(); } };
}
