import { state } from './state.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const SEARCH_CACHE_SIZE = 20;
const DETAILS_CACHE_SIZE = 100;

class TTLCache {
  constructor(maxSize, ttlMs = CACHE_TTL_MS) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}

const searchCache = new TTLCache(SEARCH_CACHE_SIZE);
const detailsCache = new TTLCache(DETAILS_CACHE_SIZE);
const detailPromises = new Map();

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
    console.error('fetchFuels error:', err);
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
    return cached;
  }

  state.requests.searchAbortController?.abort();
  state.requests.searchAbortController = new AbortController();

  const promise = fetch(
    `/api/search?lat=${lat}&lng=${lng}&radius=${radius}&fuel=${fuelId}`,
    { signal: state.requests.searchAbortController.signal }
  ).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });

  searchCache.set(cacheKey, promise);
  return promise;
}

export function fetchStationDetails(id) {
  const stationId = String(id);

  const cached = detailsCache.get(stationId);
  if (cached) {
    return Promise.resolve(cached);
  }

  if (detailPromises.has(stationId)) {
    return detailPromises.get(stationId);
  }

  state.requests.detailAbortController?.abort();
  state.requests.detailAbortController = new AbortController();

  const promise = fetch(`/api/station?id=${id}`, {
    signal: state.requests.detailAbortController.signal,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      detailsCache.set(stationId, data);
      detailPromises.delete(stationId);
      return data;
    })
    .catch((err) => {
      detailPromises.delete(stationId);
      throw err;
    });

  detailPromises.set(stationId, promise);
  return promise;
}

export async function geocodeAddress(query, lang) {
  const url = `/api/geocode?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': lang },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}
