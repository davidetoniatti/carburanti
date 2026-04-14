export const state = {
  map: null,
  markers: new Map(), // stationId -> { marker, el, priceEl, color, price }
  stationsById: new Map(),
  visibleStationIds: new Set(),
  detailsCache: new Map(),
  domRefs: {}, // For caching DOM elements if needed
  fuels: [],
  selectedFuelId: null,
  radius: 5,
  selectedStationId: null,
  lang: 'en',
  requests: {
    searchAbortController: null,
    detailAbortController: null,
    searchRequestId: 0,
  },
  currentStationData: null,
  lastSearchCenter: null,
  lastSearchZoom: null,
  history: []
};

export function addToHistory(station) {
  const sId = String(station.id);
  const existing = state.history.find(h => String(h.id) === sId);
  
  const entry = {
    id: sId,
    name: station.name || existing?.name,
    brand: station.brand || existing?.brand,
    address: station.address || existing?.address,
    location: station.location || existing?.location,
    timestamp: Date.now()
  };
  
  // Remove duplicate and keep latest 10
  state.history = [entry, ...state.history.filter(h => String(h.id) !== sId)].slice(0, 10);
}

export function getStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  return {
    lat: parseFloat(params.get('lat')),
    lng: parseFloat(params.get('lng')),
    zoom: parseInt(params.get('zoom')),
    fuel: parseInt(params.get('fuel')),
    radius: parseInt(params.get('radius'))
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
  if (state.selectedFuelId) params.set('fuel', state.selectedFuelId);
  params.set('radius', state.radius);
  
  const newRelativePathQuery = window.location.pathname + '?' + params.toString();
  window.history.replaceState(null, '', newRelativePathQuery);
}
