// Server-side whitelist for the typography settings document stored in
// user_preferences.typography (migration 004). Unknown keys are dropped and every
// value is checked, so the column can only ever hold a small, known JSON object.
// The front-end has the matching defaults in src/typography/typographyConfig.js.

const FAMILIES = ['system', 'roboto', 'inter', 'arial', 'open-sans', 'lato'];
const SIZE_PRESETS = ['xs', 'sm', 'md', 'lg', 'xl', 'custom'];
const WEIGHTS = ['regular', 'medium', 'semibold', 'bold'];
const APPEARANCES = ['normal', 'more', 'high'];
const SECTIONS = [
  'sidebar', 'nav', 'toolbar', 'buttons', 'search', 'location',
  'offlineMaps', 'navigation', 'settings', 'dialogs', 'notifications',
];
const LABEL_CATEGORIES = ['places', 'cities', 'roads', 'landmarks', 'geographic', 'saved'];
const LABEL_FAMILIES = ['interface', ...FAMILIES];
const LABEL_WEIGHTS = ['normal', 'bold'];
const MAX_BYTES = 4096;

const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/**
 * Returns { value } with a cleaned object, or { error } with a message.
 * Accepts null (clears the setting = defaults).
 */
function sanitizeTypography(input) {
  if (input === null) return { value: null };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'typography must be an object' };
  if (JSON.stringify(input).length > MAX_BYTES) return { error: 'typography settings are too large' };
  const out = { version: 1 };
  const bad = (key) => ({ error: `Invalid typography value: ${key}` });

  if (input.fontFamily !== undefined) {
    if (!FAMILIES.includes(input.fontFamily)) return bad('fontFamily');
    out.fontFamily = input.fontFamily;
  }
  if (input.sizePreset !== undefined) {
    if (!SIZE_PRESETS.includes(input.sizePreset)) return bad('sizePreset');
    out.sizePreset = input.sizePreset;
  }
  if (input.customSize !== undefined) {
    if (!isNum(input.customSize, 12, 24)) return bad('customSize');
    out.customSize = Math.round(input.customSize);
  }
  if (input.fontWeight !== undefined) {
    if (!WEIGHTS.includes(input.fontWeight)) return bad('fontWeight');
    out.fontWeight = input.fontWeight;
  }
  if (input.appearance !== undefined) {
    if (!APPEARANCES.includes(input.appearance)) return bad('appearance');
    out.appearance = input.appearance;
  }
  if (input.advanced !== undefined) {
    if (typeof input.advanced !== 'boolean') return bad('advanced');
    out.advanced = input.advanced;
  }
  if (input.sections !== undefined) {
    if (typeof input.sections !== 'object' || input.sections === null) return bad('sections');
    out.sections = {};
    for (const key of SECTIONS) {
      const v = input.sections[key];
      if (v === undefined) continue;
      if (!isNum(v, 0.8, 1.5)) return bad(`sections.${key}`);
      out.sections[key] = Math.round(v * 100) / 100;
    }
  }
  if (input.mapLabels !== undefined) {
    const m = input.mapLabels;
    if (typeof m !== 'object' || m === null) return bad('mapLabels');
    out.mapLabels = {};
    if (m.fontFamily !== undefined) {
      if (!LABEL_FAMILIES.includes(m.fontFamily)) return bad('mapLabels.fontFamily');
      out.mapLabels.fontFamily = m.fontFamily;
    }
    if (m.weight !== undefined) {
      if (!LABEL_WEIGHTS.includes(m.weight)) return bad('mapLabels.weight');
      out.mapLabels.weight = m.weight;
    }
    for (const flag of ['showSavedLabels', 'showLandmarks']) {
      if (m[flag] === undefined) continue;
      if (typeof m[flag] !== 'boolean') return bad(`mapLabels.${flag}`);
      out.mapLabels[flag] = m[flag];
    }
    if (m.scale !== undefined) {
      if (typeof m.scale !== 'object' || m.scale === null) return bad('mapLabels.scale');
      out.mapLabels.scale = {};
      for (const key of LABEL_CATEGORIES) {
        const v = m.scale[key];
        if (v === undefined) continue;
        if (!isNum(v, 0.6, 2)) return bad(`mapLabels.scale.${key}`);
        out.mapLabels.scale[key] = Math.round(v * 100) / 100;
      }
    }
  }
  return { value: out };
}

/** Parse the stored TEXT column; corrupt values fall back to defaults (null). */
function parseStoredTypography(text) {
  if (!text) return null;
  try {
    const { value, error } = sanitizeTypography(JSON.parse(text));
    return error ? null : value;
  } catch {
    return null;
  }
}

module.exports = { sanitizeTypography, parseStoredTypography };
