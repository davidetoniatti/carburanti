export const STORAGE_KEYS = {
    TUTORIAL_SEEN: 'ohmypieno_tutorial_seen',
    THEME:         'ohmypieno_theme',
};

export const BREAKPOINTS = {
    DESKTOP: 900
};

export const TIMEOUTS = {
    GEO_MS: 10000,
    SUGGESTIONS_DEBOUNCE_MS: 400,
    TOAST_MS: 3000
};

export const MAP_CONFIG = {
    DEFAULT_ZOOM: 15,
    DEFAULT_LAT: 41.9028, // Rome
    DEFAULT_LNG: 12.4964,
    FLY_DURATION_S: 0.8
};

export const SEARCH_CONFIG = {
    MIN_ADDRESS_LENGTH: 3,
    DEFAULT_RADIUS: 5
};

export const HISTORY_CONFIG = {
    MAX_SIZE: 10
};

export const SHEET_CONFIG = {
    DRAG_THRESHOLD: 50,
    VELOCITY_THRESHOLD: 0.5,
    PEEK_HEIGHT_VH: 50,
    FULL_HEIGHT_VH: 0,
    HIDDEN_HEIGHT_VH: 100
};

export const TUTORIAL_STEPS = [
    { textKey: 'tutorial_step1', highlight: null },
    { textKey: 'tutorial_step2', highlight: '.price-marker' },
    { textKey: 'tutorial_step3', highlight: '.search-wrap' },
    { textKey: 'tutorial_step4', highlight: '#filterToggle' },
    { textKey: 'tutorial_step5', highlight: '#historyToggle' },
    { textKey: 'tutorial_step6', highlight: '#themeToggle' },
    { textKey: 'tutorial_step7', highlight: '#locateBtn' },
];
