import { state, getStateFromURL, updateURL, addToHistory } from './state.js';
import { hasLocale, t } from './i18n.js';
import { fetchFuels, searchStations, geocodeAddress, fetchStationDetails } from './api.js';
import { initMap, syncMarkers, selectMarker } from './map.js';
import { updateUILanguage, closePanel, toggleHistoryPanel, closeHistoryPanel, renderPanel, showToast, bindHistoryEvents } from './ui.js';
import { initBottomSheet } from './bottomSheet.js';

document.addEventListener('DOMContentLoaded', bootstrapApp);

const DEFAULT_ZOOM        = 15;
const DEFAULT_LAT         = 41.9028; // Rome
const DEFAULT_LNG         = 12.4964;
const GEO_TIMEOUT_MS      = 10_000;
const FLY_DURATION_S      = 0.8;
const DESKTOP_BREAKPOINT  = 900;
const SUGGESTIONS_DEBOUNCE_MS = 400;
const MIN_ADDRESS_QUERY_LENGTH = 3;

async function bootstrapApp() {
  const browserLang = navigator.language.split('-')[0];
  if (hasLocale(browserLang)) state.lang = browserLang;

  document.getElementById('langSelect').value = state.lang;
  updateUILanguage();

  const urlState = getStateFromURL();
  if (urlState.radius) {
    state.radius = urlState.radius;
    document.getElementById('radiusSelect').value = state.radius;
  }

  const startLat  = urlState.lat  || DEFAULT_LAT;
  const startLng  = urlState.lng  || DEFAULT_LNG;
  const startZoom = urlState.zoom || DEFAULT_ZOOM;

  initMap(performSearch, openStationById, [startLat, startLng], startZoom);

  await loadFuels(urlState.fuel);
  bindControls();
  bindHistoryEvents();
  initBottomSheet('panel');
  initBottomSheet('historyPanel');
  performSearch(startLat, startLng);
}

async function loadFuels(defaultFuelId) {
  state.fuels = await fetchFuels();
  const select = document.getElementById('fuelSelect');
  select.innerHTML = state.fuels.map(f =>
    `<option value="${f.id}">${f.name}</option>`
  ).join('');

  const validDefault = defaultFuelId && state.fuels.some(f => f.id === defaultFuelId);
  state.selectedFuelId = validDefault ? defaultFuelId : (state.fuels[0]?.id || 1);
  select.value = state.selectedFuelId;
  if (!validDefault) updateURL();

  select.addEventListener('change', () => {
    state.selectedFuelId = parseInt(select.value);
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
    updateURL();
  });
}

function bindControls() {
  document.getElementById('radiusSelect').addEventListener('change', (e) => {
    state.radius = parseInt(e.target.value);
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
    updateURL();
  });

  document.getElementById('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast(t('geo_not_supported'), 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => state.map.setView([pos.coords.latitude, pos.coords.longitude], DEFAULT_ZOOM),
      ()    => showToast(t('pos_error'), 'error'),
      { timeout: GEO_TIMEOUT_MS }
    );
  });

  document.getElementById('langSelect').addEventListener('change', (e) => {
    state.lang = e.target.value;
    updateUILanguage();
    updateURL();
  });

  document.getElementById('panelClose').addEventListener('click', closePanel);
  document.getElementById('historyToggle').addEventListener('click', toggleHistoryPanel);
  document.getElementById('historyPanelClose').addEventListener('click', closeHistoryPanel);

  document.getElementById('panel').addEventListener('sheetClosed', closePanel);
  document.getElementById('historyPanel').addEventListener('sheetClosed', closeHistoryPanel);

  const filterToggle = document.getElementById('filterToggle');
  const controls     = document.getElementById('controls');
  filterToggle.addEventListener('click', () => {
    filterToggle.classList.toggle('active');
    controls.classList.toggle('mobile-hidden');
  });

  document.getElementById('searchHereBtn').addEventListener('click', () => {
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
  });

  bindAddressSearch();
}

function resetSearchUI() {
  closePanel();
  closeHistoryPanel();
  document.getElementById('searchSuggestions').classList.add('hidden');
}

function bindAddressSearch() {
  const addressInput  = document.getElementById('addressSearch');
  const searchBtn     = document.getElementById('searchBtn');
  const suggestionsBox = document.getElementById('searchSuggestions');
  let debounceTimeout;

  addressInput.addEventListener('input', () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => showSuggestions(addressInput, suggestionsBox), SUGGESTIONS_DEBOUNCE_MS);
  });

  suggestionsBox.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    const lat = parseFloat(item.dataset.lat);
    const lon = parseFloat(item.dataset.lon);
    addressInput.value = item.textContent.trim();
    state.map.setView([lat, lon], DEFAULT_ZOOM);
    performSearch(lat, lon);
    resetSearchUI();
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) suggestionsBox.classList.add('hidden');
  });

  const doSearch = async () => {
    const query = addressInput.value.trim();
    if (!query) return;
    resetSearchUI();
    try {
      const data = await geocodeAddress(query, state.lang);
      if (data?.length > 0) {
        const { lat, lon } = data[0];
        state.map.setView([lat, lon], DEFAULT_ZOOM);
        performSearch(lat, lon);
      } else {
        showToast(t('nd'), 'info');
      }
    } catch (err) {
      showToast(t('error', { msg: err.message }), 'error');
    }
  };

  searchBtn.addEventListener('click', doSearch);
  addressInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') doSearch(); });
}

async function showSuggestions(input, box) {
  const query = input.value.trim();
  if (query.length < MIN_ADDRESS_QUERY_LENGTH) { box.classList.add('hidden'); return; }
  try {
    const results = await geocodeAddress(query, state.lang);
    if (results?.length > 0) {
      box.innerHTML = results.map(res =>
        `<div class="suggestion-item" data-lat="${res.lat}" data-lon="${res.lon}">
          ${res.display_name}
        </div>`
      ).join('');
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  } catch {
    box.classList.add('hidden');
  }
}

export async function performSearch(lat, lng) {
  document.getElementById('searchHereBtn').classList.add('hidden');
  try {
    const data = await searchStations(lat, lng, state.radius, state.selectedFuelId);
    state.stationsById.clear();
    for (const s of (data.results || [])) {
      state.stationsById.set(String(s.id), s);
    }
    state.lastSearchCenter = L.latLng(lat, lng);
    state.lastSearchZoom   = state.map?.getZoom() ?? null;
    syncMarkers();
  } catch (err) {
    if (err.name !== 'AbortError') showToast(t('error', { msg: err.message }), 'error');
  }
}

function showPanelLoading() {
  const panel = document.getElementById('panel');
  panel.classList.remove('hidden');
  if (window.innerWidth <= DESKTOP_BREAKPOINT) panel.classList.add('peek');
  document.getElementById('panelContent').innerHTML = `
    <div class="panel-loading">
      <div class="spinner"></div>
      <p>${t('loading_details')}</p>
    </div>`;
}

function showPanelError(message) {
  document.getElementById('panelContent').innerHTML =
    `<div class="panel-loading"><p>${t('error', { msg: message })}</p></div>`;
}

function resolveStationLocation(station, knownLocation) {
  return station.location ?? knownLocation ?? state.stationsById.get(String(station.id))?.location ?? null;
}

async function ensureStationVisible(station, forceSearch) {
  const sId = String(station.id);
  if (!station.location) return;

  if (forceSearch || !state.markers.has(sId)) {
    await performSearch(station.location.lat, station.location.lng);
    selectMarker(sId);
  }
}

function focusMapOnStation(station) {
  if (!station.location) return;

  const { lat, lng } = station.location;
  const zoom = Math.max(state.map.getZoom(), DEFAULT_ZOOM);

  if (window.innerWidth > DESKTOP_BREAKPOINT) {
    const panelWidth = document.getElementById('panel')?.offsetWidth ?? 0;
    state.map.flyTo([lat, lng], zoom, { duration: FLY_DURATION_S });
    return;
  }

  state.map.flyTo([lat, lng], zoom, { duration: FLY_DURATION_S });
}

export async function openStationById(id, knownLocation = null, forceSearch = false) {
  const sId = String(id);
  selectMarker(sId);
  showPanelLoading();

  try {
    const station = await fetchStationDetails(sId);
    station.location = resolveStationLocation(station, knownLocation);
    state.currentStationData = station;

    addToHistory(station);
    await ensureStationVisible(station, forceSearch);

    focusMapOnStation(station);
    renderPanel(station);
  } catch (err) {
    if (err.name === 'AbortError') return;
    showPanelError(err.message);
  }
}
