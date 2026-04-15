import { state } from './state.js';
import { t } from './i18n.js';
import { escapeHtml, timeAgo } from './formatters.js';
import { openStationById } from './app.js';

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
  
  if (!document.getElementById('panel').classList.contains('hidden') && state.currentStationData) {
    renderPanel(state.currentStationData);
  }
}

export function showToast(msg, type = 'info') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = `toast toast--${type}`;
  toast.textContent = msg;
  document.getElementById('app').appendChild(toast);

  // Trigger reflow so the transition plays from opacity 0
  toast.offsetHeight;
  toast.classList.add('toast--visible');

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
}

export function closePanel() {
  const panel = document.getElementById('panel');
  panel.classList.add('hidden');
  panel.classList.remove('peek', 'full');
  document.getElementById('map').classList.remove('has-selection');
  state.currentStationData = null;

  if (state.selectedStationId && state.markers.has(state.selectedStationId)) {
    const entry = state.markers.get(state.selectedStationId);
    if (entry.el) entry.el.classList.remove('selected');
    entry.marker.setZIndexOffset(0);
  }
  state.selectedStationId = null;
}

export function toggleHistoryPanel() {
  const panel = document.getElementById('historyPanel');
  const btn = document.getElementById('historyToggle');
  const isHidden = panel.classList.contains('hidden');
  
  if (isHidden) {
    closePanel();
    renderHistory();
    panel.classList.remove('hidden');
    if (window.innerWidth <= 900) panel.classList.add('peek');
    btn.classList.add('active');
  } else {
    closeHistoryPanel();
  }
}

export function closeHistoryPanel() {
  const panel = document.getElementById('historyPanel');
  panel.classList.add('hidden');
  panel.classList.remove('peek', 'full');
  document.getElementById('historyToggle').classList.remove('active');
}

export function bindHistoryEvents() {
  document.getElementById('historyList').addEventListener('click', (e) => {
    const item = e.target.closest('.history-item');
    if (!item) return;

    const id = String(item.dataset.id);
    const historyEntry = state.history.find(entry => String(entry.id) === id);

    openStationById(id, historyEntry?.location, true);
    closeHistoryPanel();
  });
}

export function renderHistory() {
  const list = document.getElementById('historyList');

  if (state.history.length === 0) {
    list.innerHTML = `<li class="empty-msg">${t('no_history')}</li>`;
    return;
  }

  list.innerHTML = state.history.map(entry => `
    <li class="history-item" data-id="${entry.id}">
      <div class="history-item-brand">${entry.brand ? escapeHtml(entry.brand) : t('nd')}</div>
      <div class="history-item-name">${escapeHtml(entry.name || t('nd'))}</div>
      <div class="history-item-address">${escapeHtml(entry.address || t('addr_not_available'))}</div>
    </li>
  `).join('');
}

function renderFuelRow(name, selfPrice, servedPrice) {
  const selfText = selfPrice !== Infinity ? selfPrice.toFixed(3) : '--.---';
  const servedText = servedPrice !== Infinity ? servedPrice.toFixed(3) : '--.---';
  return `
    <div class="fuel-row">
      <span class="fuel-name">${escapeHtml(name)}</span>
      <div class="fuel-prices-combined">
        <div class="price-group">
          <span class="price-label">SELF</span>
          <span class="price-value">${selfText}</span>
        </div>
        <span class="price-sep">|</span>
        <div class="price-group">
          <span class="price-label">SERV</span>
          <span class="price-value">${servedText}</span>
        </div>
      </div>
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
  const fuelMap = new Map();
  let latestDate = null;
  
  (station.fuels || []).forEach(f => {
    const key = f.name || 'Fuel';
    if (!fuelMap.has(key)) {
      fuelMap.set(key, { selfMin: Infinity, servedMin: Infinity });
    }
    const entry = fuelMap.get(key);
    
    if (f.isSelf && f.price < entry.selfMin) {
      entry.selfMin = f.price;
    } else if (!f.isSelf && f.price < entry.servedMin) {
      entry.servedMin = f.price;
    }
    
    if (f.insertDate && (!latestDate || f.insertDate > latestDate)) {
      latestDate = f.insertDate;
    }
  });
  
  let fuelHtml = '';
  for (const [name, entry] of fuelMap.entries()) {
    fuelHtml += renderFuelRow(name, entry.selfMin, entry.servedMin);
  }
  
  const addr = station.address || t('addr_not_available');
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
