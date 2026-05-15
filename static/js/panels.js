import { state, addToHistory, updateURL } from "./state.js";
import { t } from "./i18n.js";
import { elements, isMobileView } from "./dom.js";
import {
  searchStations,
  fetchStationDetails,
} from "./api.js";
import {
  syncMarkers,
  selectMarker,
  setUserLocationMarker,
} from "./map.js";
import {
  closePanelUI,
  toggleCollectionPanel,
  closeCollectionPanel,
  renderPanel,
  showToast,
  renderStationList,
} from "./ui.js";
import { checkTutorial } from "./tutorial.js";
import {
  MAP_CONFIG,
  BRAND_CONFIG,
} from "./constants.js";

let firstSearchDone = false;

export function closePanel() {
  closePanelUI();
  state.currentStationData = null;
  selectMarker(null);
}

export function toggleHistoryPanel() {
  toggleCollectionPanel(elements.historyPanel, elements.historyToggle, () => {
    renderStationList(state.history, elements.historyList, "no_history");
  });
}

export function toggleFavoritesPanel() {
  toggleCollectionPanel(elements.favoritesPanel, elements.favoritesToggle, () => {
    renderStationList(state.favorites, elements.favoritesList, "no_favorites");
  });
}

export function closeHistoryPanel() {
  closeCollectionPanel(elements.historyPanel, elements.historyToggle);
}

export function closeFavoritesPanel() {
  closeCollectionPanel(elements.favoritesPanel, elements.favoritesToggle);
}

export function refreshBrandOptions() {
  const counts = new Map();
  let bucketCount = 0;

  for (const station of state.stationsById.values()) {
    const brand = (station.brand || "").trim();
    if (!brand || brand === BRAND_CONFIG.BUCKET) {
      bucketCount++;
      continue;
    }
    counts.set(brand, (counts.get(brand) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const topEntries = sorted.slice(0, BRAND_CONFIG.TOP_N);
  for (const [, n] of sorted.slice(BRAND_CONFIG.TOP_N)) bucketCount += n;

  state.topBrands = new Set(topEntries.map(([name]) => name));

  const displayNames = topEntries.map(([name]) => name);
  if (bucketCount > 0) displayNames.push(BRAND_CONFIG.BUCKET);

  const selected = state.selectedBrand;
  const selectionInZone =
    selected &&
    (counts.has(selected) ||
      (selected === BRAND_CONFIG.BUCKET && bucketCount > 0));
  if (selected && !displayNames.includes(selected)) {
    displayNames.push(selected);
  }

  displayNames.sort((a, b) => a.localeCompare(b));

  const select = elements.brandSelect;
  select.innerHTML = "";

  const allOpt = document.createElement("option");
  allOpt.value = "";
  allOpt.textContent = t("brand_all");
  allOpt.setAttribute("data-i18n", "brand_all");
  select.appendChild(allOpt);

  for (const name of displayNames) {
    const opt = document.createElement("option");
    opt.value = name;
    if (name === selected && !selectionInZone) {
      opt.textContent = `${name} (${t("brand_not_in_area")})`;
      opt.disabled = true;
    } else {
      opt.textContent = name;
    }
    select.appendChild(opt);
  }

  select.value = selected ?? "";
}

export async function performSearch(lat, lng) {
  elements.searchHereBtn.classList.add("hidden");
  try {
    closePanel();
    const data = await searchStations(
      lat,
      lng,
      state.radius,
      state.selectedFuelId,
    );
    state.stationsById.clear();
    for (const s of data.results || []) {
      state.stationsById.set(String(s.id), s);
    }
    state.lastSearchCenter = L.latLng(lat, lng);
    state.lastSearchZoom = state.map?.getZoom() ?? null;
    refreshBrandOptions();
    syncMarkers();

    if (!firstSearchDone) {
      firstSearchDone = true;
      checkTutorial();
    }
  } catch (err) {
    if (err.name !== "AbortError")
      showToast(t("error", { msg: err.message }), "error");
  }
}

export function resetSearchUI() {
  closePanel();
  closeHistoryPanel();
  closeFavoritesPanel();
  elements.searchSuggestions.classList.add("hidden");
}

function showPanelLoading() {
  elements.panel.classList.remove("hidden");
  if (isMobileView()) elements.panel.classList.add("peek");
  elements.panelContent.innerHTML = `
    <div class="panel-loading">
      <div class="spinner"></div>
      <p>${t("loading_details")}</p>
    </div>`;
}

function showPanelError(message) {
  elements.panelContent.innerHTML = `<div class="panel-loading"><p>${t("error", { msg: message })}</p></div>`;
}

function resolveStationLocation(station, knownLocation) {
  return (
    station.location ??
    knownLocation ??
    state.stationsById.get(String(station.id))?.location ??
    null
  );
}

async function ensureStationVisible(station, forceSearch) {
  const sId = String(station.id);
  if (!station.location) return;

  if (forceSearch || !state.markers.has(sId)) {
    const zoom = Math.max(state.map.getZoom(), MAP_CONFIG.DEFAULT_ZOOM);
    state.map.setView([station.location.lat, station.location.lng], zoom, {
      animate: false,
    });
    await performSearch(station.location.lat, station.location.lng);
    selectMarker(sId);
  }
}

function focusMapOnStation(station) {
  if (!station.location) return;

  const { lat, lng } = station.location;
  const zoom = Math.max(state.map.getZoom(), MAP_CONFIG.DEFAULT_ZOOM);

  let target = [lat, lng];
  if (!isMobileView()) {
    const panelWidth = elements.panel?.offsetWidth ?? 0;
    if (panelWidth > 0) {
      const shifted = state.map
        .project([lat, lng], zoom)
        .add([panelWidth / 2, 0]);
      target = state.map.unproject(shifted, zoom);
    }
  }

  state.map.flyTo(target, zoom, { duration: MAP_CONFIG.FLY_DURATION_S });
}

export async function openStationById(
  id,
  knownLocation = null,
  forceSearch = false,
) {
  const sId = String(id);
  selectMarker(sId);

  closeHistoryPanel();
  closeFavoritesPanel();

  showPanelLoading();

  try {
    const station = await fetchStationDetails(sId);
    station.location = resolveStationLocation(station, knownLocation);

    addToHistory(station);
    await ensureStationVisible(station, forceSearch);

    state.currentStationData = station;
    focusMapOnStation(station);
    renderPanel(station);
  } catch (err) {
    if (err.name === "AbortError") return;
    showPanelError(err.message);
  }
}
