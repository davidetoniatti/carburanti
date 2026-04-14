import { state, getStateFromURL, updateURL, addToHistory } from './state.js';
import { translations, t } from './i18n.js';
import { fetchFuels, searchStations, geocodeAddress, fetchStationDetails } from './api.js';
import { initMap, syncMarkers, selectMarker } from './map.js';
import { updateUILanguage, setStatus, closePanel, toggleHistoryPanel, closeHistoryPanel, renderPanel } from './ui.js';

document.addEventListener('DOMContentLoaded', bootstrapApp);

async function bootstrapApp() {
  const browserLang = navigator.language.split('-')[0];
  if (translations[browserLang]) {
    state.lang = browserLang;
  }
  document.getElementById('langSelect').value = state.lang;
  updateUILanguage();
  
  const urlState = getStateFromURL();
  if (urlState.mode) state.mode = urlState.mode;
  if (urlState.radius) {
    state.radius = urlState.radius;
    document.getElementById('radiusSelect').value = state.radius;
  }
  
  const startLat = urlState.lat || 41.9028;
  const startLng = urlState.lng || 12.4964;
  const startZoom = urlState.zoom || 13;
  
  initMap(performSearch, openStationById, [startLat, startLng], startZoom);
  
  await loadFuels(urlState.fuel);
  bindControls();
  
  performSearch(startLat, startLng);
}

async function loadFuels(defaultFuelId) {
  state.fuels = await fetchFuels();
  const select = document.getElementById('fuelSelect');
  select.innerHTML = state.fuels.map(f =>
    `<option value="${f.id}">${f.name}</option>`
  ).join('');
  
  if (defaultFuelId && state.fuels.some(f => f.id === defaultFuelId)) {
    state.selectedFuelId = defaultFuelId;
    select.value = defaultFuelId;
  } else {
    state.selectedFuelId = state.fuels[0]?.id || 1;
    select.value = state.selectedFuelId;
    updateURL();
  }

  select.addEventListener('change', () => {
    state.selectedFuelId = parseInt(select.value);
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
    updateURL();
  });
}

function bindControls() {
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    if (btn.dataset.mode === state.mode) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      const c = state.map.getCenter();
      performSearch(c.lat, c.lng);
      updateURL();
    });
  });

  document.getElementById('radiusSelect').addEventListener('change', (e) => {
    state.radius = parseInt(e.target.value);
    const c = state.map.getCenter();
    performSearch(c.lat, c.lng);
    updateURL();
  });

  document.getElementById('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) {
      setStatus(t('geo_not_supported'));
      return;
    }
    setStatus(t('detecting_pos'));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.map.setView([pos.coords.latitude, pos.coords.longitude], 14);
      },
      () => setStatus(t('pos_error')),
      { timeout: 10000 }
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

  const filterToggle = document.getElementById('filterToggle');
  const controls = document.getElementById('controls');
  filterToggle.addEventListener('click', () => {
    filterToggle.classList.toggle('active');
    controls.classList.toggle('mobile-hidden');
  });

  const searchHereBtn = document.getElementById('searchHereBtn');
  if (searchHereBtn) {
    searchHereBtn.addEventListener('click', () => {
      const c = state.map.getCenter();
      performSearch(c.lat, c.lng);
    });
  }

  const addressInput = document.getElementById('addressSearch');
  const searchBtn = document.getElementById('searchBtn');
  const doSearch = async () => {
    const query = addressInput.value.trim();
    if (!query) return;
    setStatus(t('loading'));
    try {
      const data = await geocodeAddress(query, state.lang);
      if (data && data.length > 0) {
        const { lat, lon } = data[0];
        state.map.setView([lat, lon], 14);
        performSearch(lat, lon);
      } else {
        setStatus(t('nd'));
      }
    } catch (err) {
      setStatus(t('error', { msg: err.message }));
    }
  };
  searchBtn.addEventListener('click', doSearch);
  addressInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doSearch();
  });
}

export async function performSearch(lat, lng) {
  setStatus(t('searching'));
  const btn = document.getElementById('searchHereBtn');
  if (btn) btn.classList.add('hidden');
  
  try {
    const data = await searchStations(lat, lng, state.radius, state.selectedFuelId, state.mode);
    
    state.stationsById.clear();
    state.visibleStationIds.clear();
    
    for (const s of (data.results || [])) {
      state.stationsById.set(String(s.id), s);
      state.visibleStationIds.add(String(s.id));
    }
    
    state.lastSearchCenter = L.latLng(lat, lng);
    state.lastSearchZoom = state.map ? state.map.getZoom() : null;
    
    syncMarkers();
    
    const count = state.markers.size;
    setStatus(
      t('stations_found', { count: count, radius: state.radius }),
      t('stations_count', { count: count })
    );
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus(t('error', { msg: err.message }));
  }
}

export async function openStationById(id, knownLocation = null) {
  const sId = String(id);
  
  selectMarker(sId);
  
  const panel = document.getElementById('panel');
  panel.classList.remove('hidden');
  document.getElementById('panelContent').innerHTML = `
    <div class="panel-loading">
      <div class="spinner"></div>
      <p>${t('loading_details')}</p>
    </div>`;
    
  try {
    const station = await fetchStationDetails(sId);
    state.currentStationData = station;
    
    if (!station.location && knownLocation) {
      station.location = knownLocation;
    } else if (!station.location && state.stationsById.has(sId)) {
      station.location = state.stationsById.get(sId).location;
    }
    
    addToHistory(station);
    
    if (station.location) {
      const zoom = Math.max(state.map.getZoom(), 15);
      const isDesktop = window.innerWidth > 900;
      const offset = isDesktop ? 0.002 : 0;
      state.map.flyTo([station.location.lat, station.location.lng - offset], zoom, {
        duration: 0.8
      });
    }
    
    renderPanel(station);
  } catch (err) {
    if (err.name === 'AbortError') return;
    document.getElementById('panelContent').innerHTML = `
      <div class="panel-loading"><p>${t('error', { msg: err.message })}</p></div>`;
  }
}
