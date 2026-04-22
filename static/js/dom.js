/**
 * dom.js
 * Caches frequently used DOM elements and small viewport helpers.
 */

import { BREAKPOINTS } from "./constants.js";

export const elements = {
  app: document.getElementById("app"),
  topbar: document.getElementById("topbar"),

  // Controls
  controls: document.getElementById("controls"),
  desktopControlsSlot: document.getElementById("desktopControlsSlot"),
  mobileControlsSlot: document.getElementById("mobileControlsSlot"),
  fuelSelect: document.getElementById("fuelSelect"),
  brandSelect: document.getElementById("brandSelect"),
  radiusSelect: document.getElementById("radiusSelect"),
  filterToggle: document.getElementById("filterToggle"),
  helpBtn: document.getElementById("helpBtn"),

  // Search
  addressSearch: document.getElementById("addressSearch"),
  searchBtn: document.getElementById("searchBtn"),
  searchSuggestions: document.getElementById("searchSuggestions"),
  searchHereBtn: document.getElementById("searchHereBtn"),
  locateBtn: document.getElementById("locateBtn"),

  // Map
  map: document.getElementById("map"),

  // Detail Panel
  panel: document.getElementById("panel"),
  panelContent: document.getElementById("panelContent"),
  panelClose: document.getElementById("panelClose"),

  // History Panel
  historyPanel: document.getElementById("historyPanel"),
  historyPanelClose: document.getElementById("historyPanelClose"),
  historyToggle: document.getElementById("historyToggle"),
  historyList: document.getElementById("historyList"),
  themeToggle: document.getElementById("themeToggle"),
};

export function isMobileView() {
  return window.innerWidth <= BREAKPOINTS.DESKTOP;
}
