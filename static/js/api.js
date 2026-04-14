import { state } from './state.js';
import { t } from './i18n.js';

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
  if (state.searchAbortController) {
    state.searchAbortController.abort();
  }
  state.searchAbortController = new AbortController();
  
  const url = `/api/search?lat=${lat}&lng=${lng}&radius=${radius}&fuel=${fuelId}&mode=${mode}`;
  const res = await fetch(url, { signal: state.searchAbortController.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
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
