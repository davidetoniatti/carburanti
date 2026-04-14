import { state } from './state.js';
import { t } from './i18n.js';
import { escapeHtml, timeAgo } from './formatters.js';

export function setStatus(msg, count = '') {
  const statusText = document.getElementById('statusText');
  const stationCount = document.getElementById('stationCount');
  if (statusText) statusText.textContent = msg;
  if (stationCount) stationCount.textContent = count;
}

export function updateUILanguage() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  
  if (state.stations.length === 0) {
    setStatus(t('status_initial'));
  } else {
    const count = state.markers.size;
    setStatus(
      t('stations_found', { count: count, radius: state.radius }),
      t('stations_count', { count: count })
    );
  }
  
  if (!document.getElementById('panel').classList.contains('hidden') && state.currentStationData) {
    renderPanel(state.currentStationData);
  }
}

export function closePanel() {
  document.getElementById('panel').classList.add('hidden');
  state.currentStationData = null;
  if (state.selectedMarker) {
    const el = state.selectedMarker.getElement();
    if (el) el.querySelector('.price-marker')?.classList.remove('selected');
    state.selectedMarker = null;
  }
}

function renderFuelCard(name, price, mode) {
  return `
    <div class="fuel-card">
      <div class="fuel-left">
        <span class="fuel-name">${escapeHtml(name)}</span>
        <span class="fuel-mode ${mode.toLowerCase()}">${mode}</span>
      </div>
      <div class="fuel-price">${price.toFixed(3)}<span> EUR/L</span></div>
    </div>`;
}

function renderHours(hours) {
  if (!hours || hours.length === 0) return '';
  const cells = hours.map((h, i) => {
    const day = t('days')[h.giornoSettimanaId - 1] || `G${i}`;
    let status = '', cls = '';
    if (h.flagH24) { status = t('h24'); cls = 'h24'; }
    else if (h.flagChiusura) { status = t('closed'); cls = 'closed'; }
    else if (h.flagNonComunicato) { status = t('nc'); cls = 'nc'; }
    else if (h.flagSelf) { status = 'Self'; cls = 'open'; }
    else { status = t('open'); cls = 'open'; }
    return `
      <div class="day-cell">
        <span class="day-name">${day}</span>
        <span class="day-status ${cls}">${status}</span>
      </div>`;
  }).join('');
  return `
    <div class="section-title">${t('weekly_hours')}</div>
    <div class="hours-grid">${cells}</div>`;
}

function renderContactRow(labelKey, value, hrefPrefix = '') {
  if (!value) return '';
  const escaped = escapeHtml(value);
  let finalHref = hrefPrefix + escaped;
  
  // Normalize website links
  if (labelKey === 'web' && !value.startsWith('http')) {
    finalHref = 'https://' + value;
  }

  const link = (hrefPrefix || labelKey === 'web') 
    ? `<a href="${finalHref}" target="_blank" rel="noopener">${escaped}</a>` 
    : escaped;

  return `
    <div class="info-row">
      <span class="info-label">${t(labelKey)}</span>
      ${link}
    </div>`;
}

export function renderPanel(station) {
  const fuelGroups = {};
  (station.fuels || []).forEach(f => {
    const key = f.name || 'Fuel';
    if (!fuelGroups[key]) fuelGroups[key] = [];
    fuelGroups[key].push(f);
  });
  
  const fuelHtml = Object.entries(fuelGroups).map(([name, fuels]) => {
    const selfFuels = fuels.filter(f => f.isSelf);
    const servedFuels = fuels.filter(f => !f.isSelf);
    let html = '';
    if (selfFuels.length) {
      const minSelf = Math.min(...selfFuels.map(f => f.price));
      html += renderFuelCard(name, minSelf, 'SELF');
    }
    if (servedFuels.length) {
      const minServed = Math.min(...servedFuels.map(f => f.price));
      html += renderFuelCard(name, minServed, 'SERVED');
    }
    return html;
  }).join('');
  
  const addr = station.address || t('addr_not_available');
  let latestDate = null;
  (station.fuels || []).forEach(f => {
    if (f.insertDate && (!latestDate || f.insertDate > latestDate)) {
      latestDate = f.insertDate;
    }
  });
  
  const mapsUrl = station.location
    ? `https://www.openstreetmap.org/?mlat=${station.location.lat}&mlon=${station.location.lng}&zoom=17`
    : '#';
    
  document.getElementById('panelContent').innerHTML = `
    <div class="station-header">
      <div class="station-brand-badge">${escapeHtml(station.brand || t('nd'))}</div>
      <div class="station-name">${escapeHtml(station.name)}</div>
      <div class="station-address">${escapeHtml(addr)}</div>
      <div class="station-id">${t("station_id")}: ${station.id}</div>
      ${latestDate ? `<div class="station-update">${t('last_update', { time: timeAgo(latestDate) })}</div>` : ''}
      ${station.company ? `<div class="station-company">${escapeHtml(station.company)}</div>` : ''}
      <div class="station-links">
        <a href="${mapsUrl}" target="_blank" rel="noopener" class="station-link">
          ${t('open_in_map')}
        </a>
      </div>
    </div>

    <div class="section-title">${t('fuel_prices')}</div>
    <div class="fuel-grid">
      ${fuelHtml || `<p class="empty-msg">${t('no_prices')}</p>`}
    </div>

    ${renderHours(station.orariapertura)}

    <div class="section-title">${t('contacts')}</div>
    <div>
      ${renderContactRow('phone', station.phoneNumber, 'tel:')}
      ${renderContactRow('email', station.email, 'mailto:')}
      ${renderContactRow('web', station.website)}
    </div>
  `;
}
