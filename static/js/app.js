import { state, getStateFromURL, updateURL } from './state.js';
import { translations, t } from './i18n.js';
import { fetchFuels, searchStations, geocodeAddress } from './api.js';
import { initMap, syncMarkers } from './map.js';
import { updateUILanguage, setStatus, closePanel } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
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
  
  initMap(searchAt, [startLat, startLng], startZoom);
  
  await loadFuels(urlState.fuel);
  setupControls();
  
  // Initial search
  searchAt(startLat, startLng);
});

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
  }

  select.addEventListener('change', () => {
    state.selectedFuelId = parseInt(select.value);
    const c = state.map.getCenter();
    searchAt(c.lat, c.lng);
    updateURL();
  });
}

function setupControls() {
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
      searchAt(c.lat, c.lng);
      updateURL();
    });
  });

  document.getElementById('radiusSelect').addEventListener('change', (e) => {
    state.radius = parseInt(e.target.value);
    const c = state.map.getCenter();
    searchAt(c.lat, c.lng);
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
  });

  document.getElementById('panelClose').addEventListener('click', closePanel);

  const filterToggle = document.getElementById('filterToggle');
  const controls = document.getElementById('controls');
  filterToggle.addEventListener('click', () => {
    filterToggle.classList.toggle('active');
    controls.classList.toggle('mobile-hidden');
  });

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

async function searchAt(lat, lng) {
  setStatus(t('searching'));
  try {
    const data = await searchStations(lat, lng, state.radius, state.selectedFuelId, state.mode);
    state.stations = data.results || [];
    
    // Store search parameters for move throttling
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
