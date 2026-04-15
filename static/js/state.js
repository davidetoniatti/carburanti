import { SEARCH_CONFIG, HISTORY_CONFIG } from './constants.js';

export const state = {
  map: null,
  markers: new Map(),
  stationsById: new Map(),
  fuels: [],
  selectedFuelId: null,
  radius: SEARCH_CONFIG.DEFAULT_RADIUS,
  selectedStationId: null,
  lang: 'en',
  requests: {
    searchAbortController: null,
    detailAbortController: null,
  },
  currentStationData: null,
  lastSearchCenter: null,
  lastSearchZoom: null,
  history: [],
};

export function addToHistory(station) {
  const stationId = String(station.id);
  const previous = state.history.find((item) => String(item.id) === stationId);

  const nextEntry = {
    id: stationId,
    name: station.name || previous?.name,
    brand: station.brand || previous?.brand,
    address: station.address || previous?.address,
    location: station.location || previous?.location,
    timestamp: Date.now(),
  };

  state.history = [
    nextEntry,
    ...state.history.filter((item) => String(item.id) !== stationId),
  ].slice(0, HISTORY_CONFIG.MAX_SIZE);
}

export function getStateFromURL() {
  const params = new URLSearchParams(window.location.search);

  return {
    lat: parseFloat(params.get('lat')),
    lng: parseFloat(params.get('lng')),
    zoom: parseInt(params.get('zoom'), 10),
    fuel: parseInt(params.get('fuel'), 10),
    radius: parseInt(params.get('radius'), 10),
  };
}

export function updateURL() {
  const params = new URLSearchParams();

  if (state.map) {
    const center = state.map.getCenter();
    params.set('lat', center.lat.toFixed(6));
    params.set('lng', center.lng.toFixed(6));
    params.set('zoom', state.map.getZoom());
  }

  if (state.selectedFuelId) {
    params.set('fuel', state.selectedFuelId);
  }

  params.set('radius', state.radius);

  const newRelativePathQuery = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, '', newRelativePathQuery);
}
