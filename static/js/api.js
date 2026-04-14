import { state } from './state.js';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class TTLCache {
  constructor(maxSize) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    // Refresh LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  set(key, promise) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}

const searchCache = new TTLCache(20);
const detailPromises = new Map(); // In-flight detail requests deduplication

function getQuantizedKey(lat, lng, radius, fuelId) {
  const qLat = Math.round(lat * 10000) / 10000;
  const qLng = Math.round(lng * 10000) / 10000;
  return `search:${qLat}:${qLng}:${radius}:${fuelId}`;
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
      { id: 3, name: 'HVO' },
      { id: 4, name: 'GPL' },
      { id: 5, name: 'Metano' },
    ];
  }
}

export function searchStations(lat, lng, radius, fuelId) {
  const cacheKey = getQuantizedKey(lat, lng, radius, fuelId);
  
  const cached = searchCache.get(cacheKey);
  if (cached) {
    return cached.promise;
  }

  if (state.requests.searchAbortController) {
    state.requests.searchAbortController.abort();
  }
  state.requests.searchAbortController = new AbortController();
  const signal = state.requests.searchAbortController.signal;
  
  const url = `/api/search?lat=${lat}&lng=${lng}&radius=${radius}&fuel=${fuelId}`;
  const promise = fetch(url, { signal })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });

  searchCache.set(cacheKey, promise);
  return promise;
}

export function fetchStationDetails(id) {
  const sId = String(id);
  
  // Check details cache in state
  if (state.detailsCache.has(sId)) {
    const entry = state.detailsCache.get(sId);
    if (Date.now() <= entry.expiresAt) {
      return Promise.resolve(entry.data);
    } else {
      state.detailsCache.delete(sId);
    }
  }

  // Deduplicate in-flight requests
  if (detailPromises.has(sId)) {
    return detailPromises.get(sId);
  }

  if (state.requests.detailAbortController) {
    state.requests.detailAbortController.abort();
  }
  state.requests.detailAbortController = new AbortController();
  const signal = state.requests.detailAbortController.signal;

  const promise = fetch(`/api/station?id=${id}`, { signal })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      state.detailsCache.set(sId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      detailPromises.delete(sId);
      return data;
    })
    .catch(err => {
      detailPromises.delete(sId);
      throw err;
    });

  detailPromises.set(sId, promise);
  return promise;
}

export async function geocodeAddress(query, lang) {
  const url = `/api/geocode?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': lang }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}
