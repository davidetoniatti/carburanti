import { state, updateURL } from './state.js';
import { t } from './i18n.js';
import { priceColor, escapeHtml, shortName } from './formatters.js';
import { fetchStationDetails, searchStations } from './api.js';
import { renderPanel, setStatus } from './ui.js';

let moveTimeout;

export function initMap(onSearch, center = [41.9028, 12.4964], zoom = 13) {
  state.map = L.map('map', {
    center: center,
    zoom: zoom,
    zoomControl: true,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(state.map);
  
  state.map.on('click', (e) => {
    onSearch(e.latlng.lat, e.latlng.lng);
  });
  
  state.map.on('moveend', () => {
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      const center = state.map.getCenter();
      const zoom = state.map.getZoom();

      // Check if move is significant (zoom change or center moved > 25% of view)
      let significant = false;
      if (state.lastSearchZoom !== zoom) {
        significant = true;
      } else if (state.lastSearchCenter) {
        const bounds = state.map.getBounds();
        const viewWidth = Math.abs(bounds.getEast() - bounds.getWest());
        const dist = center.distanceTo(state.lastSearchCenter);
        // Approximate degrees to meters at 45 lat is roughly 111km, 
        // but Leaflet distanceTo is in meters. View width in degrees to meters:
        const viewWidthMeters = viewWidth * 111320 * Math.cos(center.lat * Math.PI / 180);
        if (dist > viewWidthMeters * 0.25) {
          significant = true;
        }
      } else {
        significant = true;
      }

      if (significant) {
        onSearch(center.lat, center.lng);
      }
      updateURL();
    }, 250);
  });
  
  state.map.on('dblclick', (e) => {
    e.originalEvent.preventDefault();
  });
}

export function syncMarkers() {
  const newStationIds = new Set();
  const stationPrices = [];
  const processedStations = [];

  for (const s of state.stations) {
    if (!s.location) continue;
    const price = s.selectedPrice;
    if (!price) continue;
    stationPrices.push(price);
    processedStations.push({ station: s, price });
  }

  const minPrice = stationPrices.length ? Math.min(...stationPrices) : 0;
  const maxPrice = stationPrices.length ? Math.max(...stationPrices) : 0;

  for (const item of processedStations) {
    const { station, price } = item;
    newStationIds.add(station.id);
    const color = priceColor(price, minPrice, maxPrice);
    const priceText = price.toFixed(3);

    if (state.markers.has(station.id)) {
      const entry = state.markers.get(station.id);
      entry.station = station;
      const el = entry.marker.getElement();
      if (el) {
        const markerInner = el.querySelector('.price-marker');
        if (markerInner) {
          if (markerInner.style.color !== color || markerInner.querySelector('.marker-price').textContent !== priceText) {
            markerInner.style.borderColor = color;
            markerInner.style.color = color;
            markerInner.querySelector('.marker-price').textContent = priceText;
          }
        }
      }
    } else {
      const icon = L.divIcon({
        className: '',
        html: `<div class="price-marker" style="border-color:${color};color:${color}" data-id="${station.id}">
          <span class="marker-name">${escapeHtml(shortName(station.name))}</span>
          <span class="marker-price">${priceText}</span>
        </div>`,
        iconAnchor: [30, 20],
        iconSize: [60, 36],
      });
      const marker = L.marker([station.location.lat, station.location.lng], { icon }).addTo(state.map);
      marker.on('click', () => openStation(station.id, marker));
      state.markers.set(station.id, { marker, station });
    }
  }

  for (const [id, entry] of state.markers.entries()) {
    if (!newStationIds.has(id)) {
      entry.marker.remove();
      state.markers.delete(id);
      if (state.selectedMarker === entry.marker) state.selectedMarker = null;
    }
  }
}

export async function openStation(id, marker) {
  if (state.selectedMarker) {
    const el = state.selectedMarker.getElement();
    if (el) el.querySelector('.price-marker')?.classList.remove('selected');
  }
  state.selectedMarker = marker;
  const el = marker.getElement();
  if (el) el.querySelector('.price-marker')?.classList.add('selected');
  
  const panel = document.getElementById('panel');
  panel.classList.remove('hidden');
  document.getElementById('panelContent').innerHTML = `
    <div class="panel-loading">
      <div class="spinner"></div>
      <p>${t('loading_details')}</p>
    </div>`;
    
  try {
    const station = await fetchStationDetails(id);
    state.currentStationData = station;
    renderPanel(station);
  } catch (err) {
    document.getElementById('panelContent').innerHTML = `
      <div class="panel-loading"><p>${t('error', { msg: err.message })}</p></div>`;
  }
}
