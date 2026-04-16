import { state, getStateFromURL, updateURL, addToHistory } from './state.js';
import { hasLocale, t } from './i18n.js';
import { fetchFuels, searchStations, geocodeAddress, fetchStationDetails } from './api.js';
import { initMap, syncMarkers, selectMarker } from './map.js';
import { updateUILanguage, closePanelUI, toggleHistoryPanel, closeHistoryPanelUI, renderPanel, showToast, bindHistoryEvents } from './ui.js';
import { Sheet } from './Sheet.js';
import { checkTutorial } from './tutorial.js';
import { BREAKPOINTS, TIMEOUTS, MAP_CONFIG, SEARCH_CONFIG } from './constants.js';
import { elements } from './dom.js';

document.addEventListener('DOMContentLoaded', bootstrapApp);

export function closePanel() {
  closePanelUI();
  state.currentStationData = null;

  if (state.selectedStationId && state.markers.has(state.selectedStationId)) {
    const entry = state.markers.get(state.selectedStationId);
    if (entry.el) entry.el.classList.remove('selected');
    entry.marker.setZIndexOffset(0);
  }
  state.selectedStationId = null;
}

export function closeHistoryPanel() {
  closeHistoryPanelUI();
}


async function bootstrapApp() {
  const browserLang = navigator.language.split('-')[0];
  if (hasLocale(browserLang)) state.lang = browserLang;

  const savedTheme = localStorage.getItem('ohmypieno_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  state.theme = savedTheme;

  elements.langSelect.value = state.lang;
  updateUILanguage();

  const urlState = getStateFromURL();
  if (urlState.radius) {
    state.radius = urlState.radius;
    elements.radiusSelect.value = state.radius;
  }

  const startLat  = urlState.lat  || MAP_CONFIG.DEFAULT_LAT;
  const startLng  = urlState.lng  || MAP_CONFIG.DEFAULT_LNG;
  const startZoom = urlState.zoom || MAP_CONFIG.DEFAULT_ZOOM;

  initMap(performSearch, openStationById, [startLat, startLng], startZoom);

  await loadFuels(urlState.fuel);
  bindControls();
  bindHistoryEvents(openStationById);
  new Sheet('panel', 'bottom');
  new Sheet('historyPanel', 'bottom');
  new Sheet('controls', 'top');
  performSearch(startLat, startLng);
  checkTutorial();
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ohmypieno_theme', theme);
}

function toggleTheme() {
  const next = state.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

async function loadFuels(defaultFuelId) {
  state.fuels = await fetchFuels();
  elements.fuelSelect.innerHTML = state.fuels.map(f =>
    `<option value="${f.id}">${f.name}</option>`
  ).join('');

  const validDefault = defaultFuelId && state.fuels.some(f => f.id === defaultFuelId);
  state.selectedFuelId = validDefault ? defaultFuelId : (state.fuels[0]?.id || 1);
  elements.fuelSelect.value = state.selectedFuelId;
  if (!validDefault) updateURL();

  elements.fuelSelect.addEventListener('change', () => {
    state.selectedFuelId = parseInt(elements.fuelSelect.value);
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
    updateURL();
  });
}

function bindControls() {
  elements.radiusSelect.addEventListener('change', (e) => {
    state.radius = parseInt(e.target.value);
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
    updateURL();
  });

  elements.locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast(t('geo_not_supported'), 'error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        state.userLocation = { lat: latitude, lng: longitude };
        state.map.setView([latitude, longitude], MAP_CONFIG.DEFAULT_ZOOM);
        performSearch(latitude, longitude);
      },
      ()    => showToast(t('pos_error'), 'error'),
      { timeout: TIMEOUTS.GEO_MS }
    );
  });

  elements.langSelect.addEventListener('change', (e) => {
    state.lang = e.target.value;
    updateUILanguage();
    updateURL();
  });

  elements.historyToggle.addEventListener('click', toggleHistoryPanel);

  elements.panel.addEventListener('sheetClosed', closePanel);
  elements.historyPanel.addEventListener('sheetClosed', closeHistoryPanel);

  elements.filterToggle.addEventListener('click', () => {
    elements.filterToggle.classList.toggle('active');
    elements.controls.classList.toggle('mobile-hidden');
  });

  elements.controls.addEventListener('sheetClosed', () => {
    elements.filterToggle.classList.remove('active');
  });

  elements.searchHereBtn.addEventListener('click', () => {
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
  });

  elements.themeToggle.addEventListener('click', toggleTheme);

  bindAddressSearch();
}

function resetSearchUI() {
  closePanel();
  closeHistoryPanel();
  elements.searchSuggestions.classList.add('hidden');
}

function bindAddressSearch() {
  const addressInput  = elements.addressSearch;
  const searchBtn     = elements.searchBtn;
  const suggestionsBox = elements.searchSuggestions;
  let debounceTimeout;


  addressInput.addEventListener('input', () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => showSuggestions(addressInput, suggestionsBox), TIMEOUTS.SUGGESTIONS_DEBOUNCE_MS);
  });

  suggestionsBox.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    const lat = parseFloat(item.dataset.lat);
    const lon = parseFloat(item.dataset.lon);
    addressInput.value = item.textContent.trim();
    state.map.setView([lat, lon], MAP_CONFIG.DEFAULT_ZOOM);
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
        state.map.setView([lat, lon], MAP_CONFIG.DEFAULT_ZOOM);
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
  if (query.length < SEARCH_CONFIG.MIN_ADDRESS_LENGTH) { box.classList.add('hidden'); return; }
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
  elements.searchHereBtn.classList.add('hidden');
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
  elements.panel.classList.remove('hidden');
  if (window.innerWidth <= BREAKPOINTS.DESKTOP) elements.panel.classList.add('peek');
  elements.panelContent.innerHTML = `
    <div class="panel-loading">
      <div class="spinner"></div>
      <p>${t('loading_details')}</p>
    </div>`;
}

function showPanelError(message) {
  elements.panelContent.innerHTML =
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
  const zoom = Math.max(state.map.getZoom(), MAP_CONFIG.DEFAULT_ZOOM);

  if (window.innerWidth > BREAKPOINTS.DESKTOP) {
    const panelWidth = elements.panel?.offsetWidth ?? 0;
    state.map.flyTo([lat, lng], zoom, { duration: MAP_CONFIG.FLY_DURATION_S });
    return;
  }

  state.map.flyTo([lat, lng], zoom, { duration: MAP_CONFIG.FLY_DURATION_S });
}

export async function openStationById(id, knownLocation = null, forceSearch = false) {
  const sId = String(id);
  selectMarker(sId);
  
  if (window.innerWidth <= BREAKPOINTS.DESKTOP) {
    closeHistoryPanelUI();
  }

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
