// Typography settings: options, defaults and validation.
// Two independent groups (as recommended):
//   - Interface typography: menus, buttons, panels and all app text
//   - Map typography: labels drawn by the vector map renderer + saved-place labels
// The backend whitelists the same keys (backend/utils/typography.js).

const SYSTEM_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Font families. "bundled" fonts ship with the app (no external font service). */
export const FONT_FAMILIES = [
  { id: 'system', label: 'System default', stack: SYSTEM_STACK, bundled: false, note: 'Your device’s own interface font' },
  { id: 'roboto', label: 'Roboto', family: 'Roboto', stack: `'Roboto', ${SYSTEM_STACK}`, bundled: true },
  { id: 'inter', label: 'Inter', family: 'Inter', stack: `'Inter', ${SYSTEM_STACK}`, bundled: true },
  {
    id: 'arial',
    label: 'Arial',
    stack: "Arial, 'Helvetica Neue', Helvetica, 'Liberation Sans', sans-serif",
    bundled: false,
    note: 'Installed with the operating system; similar fallback on Linux/Android',
  },
  { id: 'open-sans', label: 'Open Sans', family: 'Open Sans', stack: `'Open Sans', ${SYSTEM_STACK}`, bundled: true },
  { id: 'lato', label: 'Lato', family: 'Lato', stack: `'Lato', ${SYSTEM_STACK}`, bundled: true, note: 'Lato has Regular and Bold only; Medium/Semibold use the nearest' },
];

export const SIZE_PRESETS = [
  { id: 'xs', label: 'Extra small', px: 12 },
  { id: 'sm', label: 'Small', px: 13 },
  { id: 'md', label: 'Medium', px: 14 },
  { id: 'lg', label: 'Large', px: 16 },
  { id: 'xl', label: 'Extra large', px: 18 },
  { id: 'custom', label: 'Custom', px: null },
];
export const CUSTOM_SIZE_MIN = 12;
export const CUSTOM_SIZE_MAX = 24;
/** The design was drawn at 14 px; every size is scaled relative to it. */
export const BASE_PX = 14;

/** Each weight setting shifts the whole weight ladder so hierarchy is kept. */
export const FONT_WEIGHTS = [
  { id: 'regular', label: 'Regular', ladder: [400, 500, 600, 700] },
  { id: 'medium', label: 'Medium', ladder: [500, 600, 700, 700] },
  { id: 'semibold', label: 'Semibold', ladder: [600, 700, 700, 800] },
  { id: 'bold', label: 'Bold', ladder: [700, 700, 800, 800] },
];

export const APPEARANCES = [
  { id: 'normal', label: 'Normal' },
  { id: 'more', label: 'Slightly increased contrast' },
  { id: 'high', label: 'High readability', note: 'Darker text, more line spacing, underlined links' },
];

/** Independently scalable parts of the interface -> CSS variable. */
export const SECTIONS = [
  { id: 'sidebar', label: 'Sidebar', cssVar: '--scale-sidebar' },
  { id: 'nav', label: 'Navigation menu', cssVar: '--scale-nav' },
  { id: 'toolbar', label: 'Toolbar', cssVar: '--scale-toolbar' },
  { id: 'buttons', label: 'Buttons', cssVar: '--scale-buttons' },
  { id: 'search', label: 'Search box', cssVar: '--scale-search' },
  { id: 'location', label: 'Location panel', cssVar: '--scale-location' },
  { id: 'offlineMaps', label: 'Downloaded maps page', cssVar: '--scale-offline-maps' },
  { id: 'navigation', label: 'Offline navigation panel', cssVar: '--scale-navigation' },
  { id: 'settings', label: 'Settings page', cssVar: '--scale-settings' },
  { id: 'dialogs', label: 'Confirmation dialogs', cssVar: '--scale-dialogs' },
  { id: 'notifications', label: 'Notifications and messages', cssVar: '--scale-notifications' },
];
export const SECTION_MIN = 0.8;
export const SECTION_MAX = 1.5;

/** Map label categories (vector renderer) + saved places (Leaflet labels). */
export const LABEL_CATEGORIES = [
  { id: 'places', label: 'Place names', hint: 'States, countries, neighbourhoods' },
  { id: 'cities', label: 'City and town labels' },
  { id: 'roads', label: 'Road labels' },
  { id: 'landmarks', label: 'Landmark labels', hint: 'Stations, parks, hospitals and other points of interest' },
  { id: 'geographic', label: 'Geographic labels', hint: 'Sea, bays, creeks, lakes' },
  { id: 'saved', label: 'Saved location labels', hint: 'Names next to your saved places' },
];
export const LABEL_MIN = 0.6;
export const LABEL_MAX = 2;

export const DEFAULT_TYPOGRAPHY = Object.freeze({
  version: 1,
  fontFamily: 'inter', // the redesign's typeface (bundled, works offline); users can change it in Settings
  sizePreset: 'md',
  customSize: 16,
  fontWeight: 'regular',
  appearance: 'normal',
  advanced: false,
  sections: Object.freeze(Object.fromEntries(SECTIONS.map((s) => [s.id, 1]))),
  mapLabels: Object.freeze({
    fontFamily: 'interface', // follow the interface font
    weight: 'normal',
    showSavedLabels: true,
    showLandmarks: true,
    scale: Object.freeze(Object.fromEntries(LABEL_CATEGORIES.map((c) => [c.id, 1]))),
  }),
});

const clamp = (v, min, max, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
const pick = (v, list, fallback) => (list.some((o) => o.id === v) ? v : fallback);

/** Merge any (possibly partial or old) settings object onto the defaults. */
export function normalizeTypography(input) {
  const d = DEFAULT_TYPOGRAPHY;
  const t = input && typeof input === 'object' ? input : {};
  const m = t.mapLabels && typeof t.mapLabels === 'object' ? t.mapLabels : {};
  const sections = {};
  for (const s of SECTIONS) sections[s.id] = clamp(t.sections?.[s.id], SECTION_MIN, SECTION_MAX, 1);
  const scale = {};
  for (const c of LABEL_CATEGORIES) scale[c.id] = clamp(m.scale?.[c.id], LABEL_MIN, LABEL_MAX, 1);
  return {
    version: 1,
    fontFamily: pick(t.fontFamily, FONT_FAMILIES, d.fontFamily),
    sizePreset: pick(t.sizePreset, SIZE_PRESETS, d.sizePreset),
    customSize: Math.round(clamp(t.customSize, CUSTOM_SIZE_MIN, CUSTOM_SIZE_MAX, d.customSize)),
    fontWeight: pick(t.fontWeight, FONT_WEIGHTS, d.fontWeight),
    appearance: pick(t.appearance, APPEARANCES, d.appearance),
    advanced: typeof t.advanced === 'boolean' ? t.advanced : d.advanced,
    sections,
    mapLabels: {
      fontFamily: m.fontFamily === 'interface' ? 'interface' : pick(m.fontFamily, FONT_FAMILIES, 'interface'),
      weight: m.weight === 'bold' ? 'bold' : 'normal',
      showSavedLabels: typeof m.showSavedLabels === 'boolean' ? m.showSavedLabels : true,
      showLandmarks: typeof m.showLandmarks === 'boolean' ? m.showLandmarks : true,
      scale,
    },
  };
}

export function fontById(id) {
  return FONT_FAMILIES.find((f) => f.id === id) || FONT_FAMILIES[0];
}

/** Interface base size in px. */
export function basePx(t) {
  if (t.sizePreset === 'custom') return t.customSize;
  return SIZE_PRESETS.find((p) => p.id === t.sizePreset)?.px || BASE_PX;
}

/** The font used for map labels (may follow the interface font). */
export function labelFont(t) {
  return fontById(t.mapLabels.fontFamily === 'interface' ? t.fontFamily : t.mapLabels.fontFamily);
}

/** Section multipliers only apply in advanced mode; otherwise everything follows the global size. */
export function effectiveSections(t) {
  return t.advanced ? t.sections : DEFAULT_TYPOGRAPHY.sections;
}

/** A short key that changes only when the vector map labels need re-rendering. */
export function mapLabelKey(t) {
  const f = labelFont(t);
  const s = t.mapLabels.scale;
  return [f.id, t.mapLabels.weight, t.mapLabels.showLandmarks ? 1 : 0, s.places, s.cities, s.roads, s.landmarks, s.geographic].join('|');
}
