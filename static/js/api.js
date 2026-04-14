import { state } from './state.js';
import { t } from './i18n.js';

// Simple LRU-like cache for search results
const searchCache = new Map();
const MAX_CACHE_SIZE = 20;

function getQuantizedKey(lat, lng, radius, fuelId, mode) {
  // Quantize to 4 decimal places (~11m) to match backend
  const qLat = Math.round(lat * 10000) / 10000;
  const qLng = Math.round(lng * 10000) / 10000;
  return `search:${qLat}:${qLng}:${radius}:${fuelId}:${mode}`;
}

export async function fetchFuels() {
  try {
    const res = await fetch('/api/fuels');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("fetchFuels error:", err);
    return [
      { id: 1, name: 'Benzina' },
      { id: 2, name: 'Gasolio' },
    ];
  }
}

export async function searchStations(lat, lng, radius, fuelId, mode) {
  const cacheKey = getQuantizedKey(lat, lng, radius, fuelId, mode);
  
  if (searchCache.has(cacheKey)) {
    console.log(`[Cache] Frontend hit for ${cacheKey}`);
    return searchCache.get(cacheKey);
  }

  if (state.searchAbortController) {
    state.searchAbortController.abort();
  }
  state.searchAbortController = new AbortController();
  
  const url = `/api/search?lat=${lat}&lng=${lng}&radius=${radius}&fuel=${fuelId}&mode=${mode}`;
  const res = await fetch(url, { signal: state.searchAbortController.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
  const data = await res.json();
  
  // Save to cache
  searchCache.set(cacheKey, data);
  if (searchCache.size > MAX_CACHE_SIZE) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
  
  return data;
}

export async function fetchStationDetails(id) {
  const res = await fetch(`/api/station?id=${id}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function geocodeAddress(query, lang) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=it&limit=1`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': lang }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}
