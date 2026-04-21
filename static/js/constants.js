export const STORAGE_KEYS = {
  TUTORIAL_SEEN: "ohmypieno_tutorial_seen",
  THEME: "ohmypieno_theme",
};

export const BREAKPOINTS = {
  DESKTOP: 900,
};

export const TIMEOUTS = {
  GEO_MS: 10000,
  SUGGESTIONS_DEBOUNCE_MS: 400,
  TOAST_MS: 3000,
};

export const MAP_CONFIG = {
  DEFAULT_ZOOM: 15,
  DEFAULT_LAT: 41.9028, // Rome
  DEFAULT_LNG: 12.4964,
  FLY_DURATION_S: 0.8,
};

export const SEARCH_CONFIG = {
  MIN_ADDRESS_LENGTH: 3,
  DEFAULT_RADIUS: 5,
};

export const HISTORY_CONFIG = {
  MAX_SIZE: 10,
};

// MIMIT returns brand names glued (no spaces): e.g. "PompeBianche", "AgipEni".
// BUCKET is the literal label that also doubles as the catch-all for the
// long tail beyond TOP_N most common brands in the current zone.
export const BRAND_CONFIG = {
  BUCKET: "PompeBianche",
  TOP_N: 10,
};

export const SHEET_CONFIG = {
  DRAG_THRESHOLD: 50,
  VELOCITY_THRESHOLD: 0.5,
  PEEK_HEIGHT_VH: 50,
  FULL_HEIGHT_VH: 0,
  HIDDEN_HEIGHT_VH: 100,
};

// Tutorial step icons. These match the app's existing topbar SVGs where
// possible, so the tutorial's visual vocabulary matches the real buttons.
// Inline strings are safe to drop into innerHTML — content is static and
// controlled here, no user input interpolated.
const ICON_FUEL =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="22" x2="15" y2="22"/><line x1="4" y1="9" x2="14" y2="9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/></svg>';
const ICON_PIN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';
const ICON_SEARCH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const ICON_FILTER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>';
const ICON_HISTORY =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>';
const ICON_THEME =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>';
const ICON_LOCATE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8" stroke-dasharray="2 4"/></svg>';

export const TUTORIAL_STEPS = [
  { textKey: "tutorial_step1", highlight: null, icon: ICON_FUEL },
  { textKey: "tutorial_step2", highlight: ".price-marker", icon: ICON_PIN },
  { textKey: "tutorial_step3", highlight: ".search-wrap", icon: ICON_SEARCH },
  // On desktop the #filterToggle button is hidden — the selects live inline
  // in the topbar. Highlight them directly instead.
  {
    textKey: "tutorial_step4",
    highlight: "#filterToggle",
    highlightDesktop: "#fuelSelect, #radiusSelect",
    icon: ICON_FILTER,
  },
  {
    textKey: "tutorial_step5",
    highlight: "#historyToggle",
    icon: ICON_HISTORY,
  },
  { textKey: "tutorial_step6", highlight: "#themeToggle", icon: ICON_THEME },
  { textKey: "tutorial_step7", highlight: "#locateBtn", icon: ICON_LOCATE },
];
