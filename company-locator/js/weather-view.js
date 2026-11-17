import { el, safeUrl } from './utils.js';
import { BASE_LAYERS, ignTimeLink } from './map.js';
import { fetchWeather, weatherDescription, photosForPeriod } from './weather-data.js';
import { fetchStreetPhotos } from './images.js';
import { proxyState } from './transport.js';

export function createWeatherView(host, position, settings) {
  let controller = new AbortController(), requestId = 0;
  let destroyed = false, weather = null, photos = null, photoError = '', map = null;
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
  function photoSection(title, list, empty) {
    const block = el('div', { class: 'weather-photos' }, [el('h4', { text: title })]);
    if (photos === null) block.append(el('p', { text: 'Recherche de photographies de rue…' }));
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
  function render() {
    if (destroyed) return;
    historicBody.replaceChildren(); currentBody.replaceChildren();
    if (!weather) {
      historicBody.append(el('p', { text: 'Chargement de la météo…' }));
      currentBody.append(el('p', { text: 'Chargement de la météo…' }));
      return;
    }
    if (weather.error) {
      historicBody.append(el('p', { text: weather.error })); currentBody.append(el('p', { text: weather.error }));
      historicBody.append(el('p', { text: 'Impossible de vérifier les dates locales des photos sans la réponse météo.' }));
      return;
    }
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
    const from = i >= 14 ? weather.daily.time[i - 14] : null, to = i >= 7 ? weather.daily.time[i - 7] : null;
    let older = [], today = [];
    try { older = photosForPeriod(photos || [], from, to, weather.timezone); today = photosForPeriod(photos || [], day, day, weather.timezone); }
    catch { photoError = 'Fuseau horaire des photographies indisponible.'; }
    historicBody.append(el('p', { text: 'Image aérienne datée de cette période : indisponible dans les sources intégrées.' }), photoSection(`Vue de rue photographiée entre ${from || 'J-14'} et ${to || 'J-7'}`, older, 'Aucune photographie datée trouvée dans cette période parmi les résultats à proximité.'));
    currentBody.append(el('p', { text: 'Image aérienne en direct : indisponible dans les sources intégrées.' }), photoSection('Vue de rue photographiée aujourd’hui — pas une vidéo en direct', today, 'Aucune photographie datée d’aujourd’hui trouvée parmi les résultats à proximité.'));
  }
  select.addEventListener('change', render);
  render();
  function load() {
    controller.abort(); controller = new AbortController();
    const signal = controller.signal, id = ++requestId;
    weather = null; photos = null; photoError = ''; render();
    fetchWeather(position.lat, position.lon, { signal, proxy: proxyState().available }).then(value => {
      if (destroyed || id !== requestId) return; weather = value; render();
    }, error => {
      if (destroyed || id !== requestId || signal.aborted) return;
      weather = { error: `Météo indisponible : ${error.message}` }; render();
    });
    fetchStreetPhotos({ lat: position.lat, lon: position.lon, radiusM: settings.streetRadiusM, providers: settings.streetProviders, limit: 50, signal }).then(result => {
      if (destroyed || id !== requestId) return;
      photos = result.photos;
      const failures = result.sources.filter(source => source.status === 'error' || source.status === 'unavailable');
      if (!photos.length && failures.length) photoError = 'Photographies indisponibles ou sources non configurées ; réessayez plus tard.';
      render();
    }, () => {
      if (destroyed || id !== requestId || signal.aborted) return;
      photos = []; photoError = 'Photographies de rue indisponibles.'; render();
    });
  }
  reload.addEventListener('click', load);
  load();
  return { destroy() { destroyed = true; controller.abort(); map?.remove(); }, invalidate() { map?.invalidateSize(); } };
}
