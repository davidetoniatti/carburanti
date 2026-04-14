import { state, updateURL, addToHistory } from './state.js';
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
        const btn = document.getElementById('searchHereBtn');
        if (btn) btn.classList.remove('hidden');
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
    const sId = String(station.id);
    newStationIds.add(sId);
    const color = priceColor(price, minPrice, maxPrice);
    const priceText = price.toFixed(3);

    if (state.markers.has(sId)) {
      const entry = state.markers.get(sId);
      entry.station = station;
      const el = entry.marker.getElement();
      if (el) {
        const markerInner = el.querySelector('.price-marker');
        if (markerInner) {
          if (markerInner.style.getPropertyValue('--marker-color') !== color) {
            markerInner.style.setProperty('--marker-color', color);
          }
          markerInner.querySelector('.marker-price').textContent = priceText;
        }
      }
    } else {
      const icon = L.divIcon({
        className: '',
        html: `<div class="price-marker" style="--marker-color:${color}" data-id="${sId}">
          <span class="marker-price">${priceText}</span>
        </div>`,
        iconAnchor: [24, 12],
        iconSize: [48, 24],
      });
      const marker = L.marker([station.location.lat, station.location.lng], { icon }).addTo(state.map);
      marker.on('click', () => openStation(sId, marker));
      state.markers.set(sId, { marker, station });
    }
  }

  for (const [id, entry] of state.markers.entries()) {
    if (!newStationIds.has(String(id))) {
      entry.marker.remove();
      state.markers.delete(id);
      if (state.selectedMarker === entry.marker) state.selectedMarker = null;
    }
  }
}

export async function openStation(id, marker) {
  const sId = String(id);
  
  // Track known location from marker or state
  let knownLocation = null;
  let targetMarker = marker;

  if (marker) {
    const ll = marker.getLatLng();
    knownLocation = { lat: ll.lat, lng: ll.lng };
  } else {
    const entry = state.markers.get(sId);
    if (entry) {
      targetMarker = entry.marker;
      const ll = entry.marker.getLatLng();
      knownLocation = { lat: ll.lat, lng: ll.lng };
    }
  }

  // Remove previous selection
  if (state.selectedMarker) {
    const prevEl = state.selectedMarker.getElement();
    if (prevEl) {
      prevEl.querySelector('.price-marker')?.classList.remove('selected');
    }
    state.selectedMarker.setZIndexOffset(0);
  }

  // Set new selection
  state.selectedMarker = targetMarker;
  if (targetMarker) {
    targetMarker.setZIndexOffset(1000);
    const el = targetMarker.getElement();
    if (el) {
      el.querySelector('.price-marker')?.classList.add('selected');
    }
  }
  
  document.getElementById('map').classList.add('has-selection');
  
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
    
    // Merge known location if missing from details
    if (!station.location && knownLocation) {
      station.location = knownLocation;
    }
    
    addToHistory(station);
    
    // Smoothly fly to the station
    if (station.location) {
      const zoom = Math.max(state.map.getZoom(), 15);
      // Small offset to the left if panel is open on desktop
      const isDesktop = window.innerWidth > 900;
      const offset = isDesktop ? 0.002 : 0;
      state.map.flyTo([station.location.lat, station.location.lng - offset], zoom, {
        duration: 0.8
      });
    }
    
    renderPanel(station);
  } catch (err) {
    document.getElementById('panelContent').innerHTML = `
      <div class="panel-loading"><p>${t('error', { msg: err.message })}</p></div>`;
  }
}
