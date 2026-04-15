import { state, updateURL } from './state.js';
import { priceColor } from './formatters.js';

let moveTimeout;
let markerClickHandler = null;

export function initMap(onSearch, onMarkerClick, center = [41.9028, 12.4964], zoom = 13) {
  markerClickHandler = onMarkerClick;
  state.map = L.map('map', {
    center: center,
    zoom: zoom,
    zoomControl: true,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    referrerPolicy: 'strict-origin-when-cross-origin',
  }).addTo(state.map);
  
  state.map.on('click', (e) => {
    onSearch(e.latlng.lat, e.latlng.lng);
  });
  
  state.map.on('moveend', () => {
    clearTimeout(moveTimeout);
    moveTimeout = setTimeout(() => {
      const center = state.map.getCenter();
      const zoom = state.map.getZoom();

      let significant = false;
      if (state.lastSearchZoom !== zoom) {
        significant = true;
      } else if (state.lastSearchCenter) {
        const bounds = state.map.getBounds();
        const viewWidth = Math.abs(bounds.getEast() - bounds.getWest());
        const dist = center.distanceTo(state.lastSearchCenter);
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
      syncMarkers();
      updateURL();
    }, 250);
  });
  
  state.map.on('dblclick', (e) => {
    e.originalEvent.preventDefault();
  });
}

export function syncMarkers() {
  if (!state.map) return;
  const newStationIds = new Set();
  
  let minPrice = Infinity;
  let maxPrice = -Infinity;
  const renderable = [];
  
  const bounds = state.map.getBounds().pad(0.2);
  
  for (const s of state.stationsById.values()) {
    if (!s.location || !s.selectedPrice) continue;
    
    const sId = String(s.id);
    const isSelected = sId === state.selectedStationId;
    if (!isSelected && !bounds.contains([s.location.lat, s.location.lng])) continue;
    
    const price = s.selectedPrice;
    if (price < minPrice) minPrice = price;
    if (price > maxPrice) maxPrice = price;
    renderable.push({
      id: String(s.id),
      lat: s.location.lat,
      lng: s.location.lng,
      price: price
    });
  }

  if (minPrice === Infinity) minPrice = 0;
  if (maxPrice === -Infinity) maxPrice = 0;

  for (const item of renderable) {
    const sId = item.id;
    newStationIds.add(sId);
    const color = priceColor(item.price, minPrice, maxPrice);
    const priceText = item.price.toFixed(3);

    if (state.markers.has(sId)) {
      const entry = state.markers.get(sId);
      if (entry.color !== color || entry.price !== priceText) {
        if (entry.el) {
          entry.el.style.setProperty('--marker-color', color);
        }
        if (entry.priceEl) {
          entry.priceEl.textContent = priceText;
        }
        entry.color = color;
        entry.price = priceText;
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
      const marker = L.marker([item.lat, item.lng], { icon }).addTo(state.map);
      
      const root = marker.getElement();
      let el = null;
      let priceEl = null;
      if (root) {
        el = root.querySelector('.price-marker');
        if (el) priceEl = el.querySelector('.marker-price');
      }

      const entry = { marker, el, priceEl, color, price: priceText };
      
      marker.on('click', () => {
        if (markerClickHandler) markerClickHandler(sId);
      });
      
      state.markers.set(sId, entry);
    }
  }

  for (const [id, entry] of state.markers.entries()) {
    if (!newStationIds.has(String(id))) {
      entry.marker.remove();
      state.markers.delete(id);
      if (state.selectedStationId === id) state.selectedStationId = null;
    }
  }
}

export function selectMarker(id) {
  const sId = String(id);
  
  // Remove previous selection
  if (state.selectedStationId && state.markers.has(state.selectedStationId)) {
    const prevEntry = state.markers.get(state.selectedStationId);
    if (prevEntry.el) {
      prevEntry.el.classList.remove('selected');
    }
    prevEntry.marker.setZIndexOffset(0);
  }

  // Set new selection
  state.selectedStationId = sId;
  const mapEl = document.getElementById('map');
  
  if (sId && state.markers.has(sId)) {
    const targetEntry = state.markers.get(sId);
    targetEntry.marker.setZIndexOffset(1000);
    if (targetEntry.el) {
      targetEntry.el.classList.add('selected');
    }
    if (mapEl) mapEl.classList.add('has-selection');
  } else {
    if (mapEl) mapEl.classList.remove('has-selection');
  }
}
