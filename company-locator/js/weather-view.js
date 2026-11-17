import { el, safeUrl } from './utils.js';
import { BASE_LAYERS, ignTimeLink } from './map.js';
import { fetchWeather, weatherDescription, photosForPeriod } from './weather-data.js';
import { fetchPanoramax } from './images.js';
import { fetchSatellite, satellitePeriods } from './satellite.js';
import { proxyState } from './transport.js';

export function createWeatherView(host, position, settings) {
  let controller = new AbortController(), requestId = 0;
  let destroyed = false, weather = null, photos = null, photoError = '', map = null;
  let satellite = { historic: null, recent: null }, datedPhotos = { historic: null, today: null };
  let periods = satellitePeriods();
  const controls = el('div', { class: 'weather-controls' });
  const select = el('select', { 'aria-label': 'Date météo passée' }, [
    el('option', { value: '7', text: 'Il y a 7 jours' }),
    el('option', { value: '14', text: 'Il y a 14 jours' }),
  ]);
  const reload = el('button', { type: 'button', class: 'btn btn-sm btn-outline', text: 'Actualiser la météo et les photos' });
  controls.append(el('label', {}, ['Comparer la météo : ', select]), reload);
  const historic = el('section', { class: 'weather-card' }, [el('h3', { text: 'A. Il y a une à deux semaines' })]);
  const current = el('section', { class: 'weather-card' }, [el('h3', { text: 'B. Conditions actuelles' })]);
  const historicBody = el('div', {}), currentBody = el('div', {});
  historic.append(historicBody); current.append(currentBody);
  const grid = el('div', { class: 'weather-grid' }, [historic, current]);
  const notice = el('p', { class: 'notice notice-info', text: 'La météo provient d’Open-Meteo : données modélisées, pas une station en direct. Les images aériennes et les vues de rue ne sont pas des flux en temps réel. Une photo de rue datée d’aujourd’hui ne prouve pas la situation actuelle.' });
  const aerial = el('section', { class: 'weather-aerial' });
  aerial.append(el('h3', { text: 'Image aérienne de référence — IGN BD ORTHO®' }), el('p', { class: 'muted-xs', text: 'Date de prise de vue non fournie ici : cette image ne prouve ni la situation actuelle ni celle d’il y a une ou deux semaines.' }));
  const mapNode = el('div', { class: 'weather-map', role: 'application', 'aria-label': 'Image aérienne IGN de référence' });
  const tileStatus = el('p', { class: 'muted-xs', role: 'status' });
  aerial.append(mapNode, tileStatus);
  aerial.append(el('a', { class: 'btn btn-sm btn-outline', href: ignTimeLink(position.lat, position.lon), target: '_blank', rel: 'noopener noreferrer', text: 'Comparer les millésimes IGN' }));
  host.replaceChildren(notice, controls, grid, aerial);
  if (window.L) {
    try {
      map = window.L.map(mapNode, { center: [position.lat, position.lon], zoom: 19, scrollWheelZoom: false });
      const tiles = BASE_LAYERS.ortho.build(window.L);
      let failedTiles = 0, loadedTiles = 0;
      tiles.on('tileload', () => { loadedTiles++; tileStatus.textContent = ''; });
      tiles.on('tileerror', () => { if (++failedTiles >= 3 && !loadedTiles) tileStatus.textContent = 'Image aérienne IGN indisponible pour le moment.'; });
      tiles.addTo(map);
      window.L.marker([position.lat, position.lon]).addTo(map);
      setTimeout(() => { if (!destroyed) map?.invalidateSize(); }, 80);
    } catch { mapNode.textContent = 'Image aérienne indisponible.'; }
  } else mapNode.textContent = 'Carte indisponible.';

  const num = (value, suffix) => value == null || !Number.isFinite(Number(value)) ? 'Non disponible' : `${Number(value).toLocaleString('fr-FR')} ${suffix}`;
  function photoSection(title, list, empty, state = null) {
    const block = el('div', { class: 'weather-photos' }, [el('h4', { text: title })]);
    if (state?.error) block.append(el('p', { text: state.error }));
    else if (state?.loading || (!state && photos === null)) block.append(el('p', { text: 'Recherche de photographies de rue…' }));
    else if (!list.length) block.append(el('p', { text: photoError || empty }));
    else list.slice(0, 3).forEach(photo => {
      const url = safeUrl(photo.thumbUrl), source = safeUrl(photo.pageUrl);
      if (!url) return;
      const item = el('div', { class: 'weather-photo' });
      const image = el('img', { src: url, alt: 'Photographie de rue à proximité', loading: 'lazy' });
      image.addEventListener('error', () => { image.remove(); });
      item.append(image, el('p', { text: `${photo.providerName} · prise de vue : ${photo.capturedAt} · ${photo.distanceM != null ? `${photo.distanceM} m · ` : ''}${photo.licence || 'licence non renseignée'}` }));
      if (source) item.append(el('a', { href: source, target: '_blank', rel: 'noopener noreferrer', text: 'Voir la source' }));
      block.append(item);
    });
    return block;
  }
  function satelliteSection(key) {
    const range = periods[key];
    const block = el('div', { class: 'weather-photos' }, [el('h4', { text: `Satellite Sentinel‑2 — ${range.start} à ${range.end} (UTC)` })]);
    const result = satellite[key];
    if (!result) { block.append(el('p', { text: 'Recherche de scènes satellite…' })); return block; }
    if (result.error) { block.append(el('p', { text: `Satellite indisponible : ${result.error}` })); return block; }
    if (!result.scenes.length) { block.append(el('p', { text: 'Aucune scène satellite datée trouvée pour cette période.' })); return block; }
    const scene = result.scenes[0];
    block.append(el('p', { text: `Acquisition : ${scene.date} · Nuages sur la scène : ${scene.cloud === null ? 'non renseignés' : `${scene.cloud.toFixed(1)} %`}. Pas une image en direct.` }));
    const image = el('img', { src: scene.thumbnail, alt: 'Aperçu régional de la scène satellite Sentinel-2', loading: 'lazy', class: 'satellite-preview' });
    image.addEventListener('error', () => { image.remove(); block.append(el('p', { text: 'Aperçu satellite indisponible pour cette scène.' })); });
    block.append(image, el('p', { class: 'muted-xs', text: 'Aperçu de toute la scène régionale, non centré sur l’adresse. Résolution native : 10 m ; insuffisante pour identifier une toiture. Les nuages indiqués concernent la scène entière.' }));
    if (scene.source) block.append(el('a', { href: scene.source, target: '_blank', rel: 'noopener noreferrer', text: 'Métadonnées de la scène' }));
    block.append(el('p', { class: 'muted-xs', text: 'Contient des données Copernicus Sentinel modifiées, distribuées par Element 84 / AWS.' }));
    return block;
  }
  function render() {
    if (destroyed) return;
    historicBody.replaceChildren(); currentBody.replaceChildren();
    if (!weather) {
      historicBody.append(el('p', { text: 'Chargement de la météo…' }));
      currentBody.append(el('p', { text: 'Chargement de la météo…' }));
    } else if (weather.error) {
      historicBody.append(el('p', { text: weather.error })); currentBody.append(el('p', { text: weather.error }));
    } else {
      const day = weather.current.time.slice(0, 10);
      const i = weather.daily.time.indexOf(day);
      const selected = i >= 0 ? i - Number(select.value) : -1;
      const date = weather.daily.time[selected];
      if (date) {
        const d = weather.daily;
        historicBody.append(el('p', { text: `Météo modélisée du ${date} (${weather.timezone}) : ${weatherDescription(d.weather_code?.[selected])}` }),
          el('p', { text: `Min. ${num(d.temperature_2m_min?.[selected], '°C')} · Max. ${num(d.temperature_2m_max?.[selected], '°C')} · Précipitations ${num(d.precipitation_sum?.[selected], 'mm')} · Vent max. ${num(d.wind_speed_10m_max?.[selected], 'km/h')}` }));
      } else historicBody.append(el('p', { text: 'Météo passée indisponible pour cette date.' }));
      const c = weather.current;
      currentBody.append(el('p', { text: `Météo modélisée au ${c.time} (${weather.timezone}) : ${weatherDescription(c.weather_code)}` }),
        el('p', { text: `${num(c.temperature_2m, '°C')} · Humidité ${num(c.relative_humidity_2m, '%')} · Précipitations ${num(c.precipitation, 'mm')} · Vent ${num(c.wind_speed_10m, 'km/h')}` }));
    }
    historicBody.append(satelliteSection('historic'));
    currentBody.append(satelliteSection('recent'));
    const older = photosForPeriod(datedPhotos.historic?.photos || [], periods.historic.start, periods.historic.end, 'UTC');
    const today = photosForPeriod(datedPhotos.today?.photos || [], periods.recent.end, periods.recent.end, 'UTC');
    historicBody.append(photoSection(`Vue de rue entre ${periods.historic.start} et ${periods.historic.end} (UTC)`, older, 'Aucune photo datée trouvée pour cette période.', datedPhotos.historic || { loading: true }));
    currentBody.append(photoSection('Vue de rue photographiée aujourd’hui — pas une vidéo en direct', today, 'Aucune photo datée d’aujourd’hui trouvée.', datedPhotos.today || { loading: true }));
    const fallback = photosForPeriod(photos || [], '1900-01-01', periods.recent.end, 'UTC');
    if (photos !== null && datedPhotos.today?.photos && !today.length && fallback.length) currentBody.append(photoSection('Photo récente parmi les résultats — hors période, pas une vue actuelle', fallback.slice(0, 1), ''));
  }
  select.addEventListener('change', render);
  render();
  function load() {
    controller.abort(); controller = new AbortController();
    const signal = controller.signal, id = ++requestId;
    weather = null; photos = null; photoError = ''; satellite = { historic: null, recent: null }; datedPhotos = { historic: null, today: null }; periods = satellitePeriods(); render();
    fetchWeather(position.lat, position.lon, { signal, proxy: proxyState().available }).then(value => {
      if (destroyed || id !== requestId) return; weather = value; render();
    }, error => {
      if (destroyed || id !== requestId || signal.aborted) return;
      weather = { error: `Météo indisponible : ${error.message}` }; render();
    });
    fetchPanoramax({ lat: position.lat, lon: position.lon, radiusM: settings.streetRadiusM, limit: 30, signal, sortByRecent: true }).then(result => {
      if (destroyed || id !== requestId) return;
      photos = result.photos;
      if (result.skipped) photoError = 'Panoramax est désactivé.';
      render();
    }, () => {
      if (destroyed || id !== requestId || signal.aborted) return;
      photos = []; photoError = 'Panoramax indisponible ; réessayez plus tard.'; render();
    });
    for (const key of ['historic', 'today']) {
      const start = key === 'historic' ? periods.historic.start : periods.recent.end;
      const end = key === 'historic' ? periods.historic.end : periods.recent.end;
      fetchPanoramax({ lat: position.lat, lon: position.lon, radiusM: settings.streetRadiusM, limit: 30, signal, sortByRecent: true, datetime: `${start}T00:00:00Z/${end}T23:59:59Z` }).then(result => {
        if (destroyed || id !== requestId) return;
        datedPhotos[key] = result.skipped ? { error: 'Panoramax est désactivé.' } : { photos: result.photos }; render();
      }, () => {
        if (destroyed || id !== requestId || signal.aborted) return;
        datedPhotos[key] = { error: 'Recherche Panoramax indisponible ; réessayez plus tard.' }; render();
      });
    }
    for (const key of ['historic', 'recent']) {
      const range = periods[key];
      fetchSatellite(position.lat, position.lon, range.start, range.end, { signal }).then(scenes => {
        if (destroyed || id !== requestId) return;
        satellite[key] = { scenes }; render();
      }, error => {
        if (destroyed || id !== requestId || signal.aborted) return;
        satellite[key] = { error: error.userMessage || error.message }; render();
      });
    }
  }
  reload.addEventListener('click', load);
  load();
  return { destroy() { destroyed = true; controller.abort(); map?.remove(); }, invalidate() { map?.invalidateSize(); } };
}
