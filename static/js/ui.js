import { state } from './state.js';
import { t } from './i18n.js';
import { escapeHtml, timeAgo } from './formatters.js';
import { openStationById, closePanel } from './app.js';
import { BREAKPOINTS, TIMEOUTS } from './constants.js';
import { elements } from './dom.js';

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
  
  if (!elements.panel.classList.contains('hidden') && state.currentStationData) {
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
  elements.app.appendChild(toast);

  // Trigger reflow so the transition plays from opacity 0
  toast.offsetHeight;
  toast.classList.add('toast--visible');

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, TIMEOUTS.TOAST_MS);
}

export function closePanelUI() {
  elements.panel.classList.add('hidden');
  elements.panel.classList.remove('peek', 'full');
  elements.map.classList.remove('has-selection');
}

export function toggleHistoryPanel() {
  const isHidden = elements.historyPanel.classList.contains('hidden');
  
  if (isHidden) {
    if (window.innerWidth <= BREAKPOINTS.DESKTOP) {
      closePanel();
    }
    renderHistory();
    elements.historyPanel.classList.remove('hidden');
    if (window.innerWidth <= BREAKPOINTS.DESKTOP) elements.historyPanel.classList.add('peek');
    elements.historyToggle.classList.add('active');
  } else {
    closeHistoryPanelUI();
  }
}

export function closeHistoryPanelUI() {
  elements.historyPanel.classList.add('hidden');
  elements.historyPanel.classList.remove('peek', 'full');
  elements.historyToggle.classList.remove('active');
}

export function bindHistoryEvents(onHistoryClick) {
  elements.historyList.addEventListener('click', (e) => {
    const item = e.target.closest('.history-item');
    if (!item) return;

    const id = String(item.dataset.id);
    const historyEntry = state.history.find(entry => String(entry.id) === id);

    onHistoryClick(id, historyEntry?.location);
    closeHistoryPanelUI();
  });
}

export function renderHistory() {
  if (state.history.length === 0) {
    elements.historyList.innerHTML = `<li class="empty-msg">${t('no_history')}</li>`;
    return;
  }

  elements.historyList.innerHTML = state.history.map(entry => `
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
    
  elements.panelContent.innerHTML = `
    <div class="station-header">
      <div class="station-brand">${escapeHtml(station.brand || t('nd'))}</div>
      <div class="station-address">${escapeHtml(addr)}</div>
      <div class="station-update-container">
        ${latestDate ? `<div class="station-update">${t('last_update', { time: timeAgo(latestDate) })}</div>` : ''}
        <a href="${mapsUrl}" target="_blank" rel="noopener" class="station-map-link">
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
    <div class="station-contacts">
      ${renderContactRow('phone', station.phoneNumber, 'tel:')}
      ${renderContactRow('email', station.email, 'mailto:')}
      ${renderContactRow('web', station.website)}
    </div>

    <div class="section-title">${t('additional_info')}</div>
    <div class="station-footer">
      <div class="footer-row"><span class="footer-label">${t('station_name')}:</span> ${escapeHtml(station.name)}</div>
      <div class="footer-row"><span class="footer-label">${t("station_id")}:</span> ${station.id}</div>
      ${station.company ? `<div class="footer-row"><span class="footer-label">${t('company')}:</span> ${escapeHtml(station.company)}</div>` : ''}
    </div>
  `;
}
