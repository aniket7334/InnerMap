// Map label typography for the vector basemap.
//
// The offline basemap is rendered in the browser by protomaps-leaflet: labels are drawn
// onto canvas tiles from vector data, each with a CSS font string such as
// "400 12px sans-serif". That means label size and font CAN be changed here.
// (Raster providers - OSM, satellite - have their labels baked into the downloaded
// images; nothing on the client can resize those. Only the saved-place labels, which
// Leaflet draws as HTML, follow the settings there.)
//
// We start from the stock label rules (same colours, order and collision rules) and wrap
// every font attribute so it is scaled per category and uses the chosen family.
import { CenteredTextSymbolizer, labelRules as stockLabelRules, paintRules as stockPaintRules } from 'protomaps-leaflet';
import { namedFlavor } from '@protomaps/basemaps';
import { labelFont } from './typographyConfig';

const FLAVOR = 'light';

/** Which settings category a label belongs to. */
function categoryFor(dataLayer, feature) {
  switch (dataLayer) {
    case 'places':
      return feature?.props?.kind === 'locality' ? 'cities' : 'places';
    case 'roads':
      return 'roads';
    case 'pois':
      return 'landmarks';
    default:
      return 'geographic'; // water, earth, landcover, landuse, boundaries
  }
}

const FONT_RE = /^\s*(.*?)\s*(\d+(?:\.\d+)?)px(?:\/[\d.]+)?\s+(.+)$/;

/** Rewrite one CSS font string: scale its size, swap the family, optionally embolden. */
export function restyleFont(font, scale, family, bold) {
  const m = FONT_RE.exec(font || '');
  if (!m) return font;
  let prefix = m[1];
  if (bold) {
    prefix = prefix.replace(/\b([1-9]00)\b/, (w) => String(Math.min(800, Number(w) + 200)));
    if (!/\b[1-9]00\b|bold/.test(prefix)) prefix = `${prefix} 600`.trim();
  }
  const size = Math.max(7, Math.round(Number(m[2]) * scale * 10) / 10);
  return `${prefix ? `${prefix} ` : ''}${size}px ${family || m[3]}`;
}

// protomaps-leaflet's FontAttr: { font } (string or fn) or { family, size, weight, style }.
function isFontAttr(obj) {
  return obj && typeof obj === 'object' && typeof obj.get === 'function' && (obj.constructor?.name === 'FontAttr' || 'font' in obj || ('family' in obj && 'size' in obj));
}

function wrapFonts(symbolizer, dataLayer, opts, seen = new Set()) {
  if (!symbolizer || typeof symbolizer !== 'object' || seen.has(symbolizer)) return 0;
  seen.add(symbolizer);
  let n = 0;
  for (const key of Object.keys(symbolizer)) {
    const v = symbolizer[key];
    if (key === 'font' && isFontAttr(v) && !v.__innerMapWrapped) {
      const original = v.get.bind(v);
      v.get = (zoom, feature) => {
        const cat = categoryFor(dataLayer, feature);
        return restyleFont(original(zoom, feature), opts.scale[cat] ?? 1, opts.family, opts.bold);
      };
      v.__innerMapWrapped = true;
      n += 1;
    } else if (Array.isArray(v)) {
      for (const item of v) n += wrapFonts(item, dataLayer, opts, seen);
    } else if (v && typeof v === 'object' && !(v instanceof Map)) {
      n += wrapFonts(v, dataLayer, opts, seen);
    }
  }
  return n;
}

/** Landmark (point of interest) labels: not in the stock rules, so added here. */
function landmarkRule(opts) {
  return {
    dataLayer: 'pois',
    minzoom: 14,
    symbolizer: new CenteredTextSymbolizer({
      labelProps: ['name:en', 'name'],
      fill: '#4b5563',
      stroke: '#ffffff',
      width: 2,
      lineHeight: 1.15,
      font: (_z, f) => restyleFont('400 11px sans-serif', opts.scale.landmarks, opts.family, opts.bold),
    }),
    // Busy city tiles carry many POIs; show only the ones the data marks as visible at this zoom.
    filter: (z, f) => {
      const p = f.props || {};
      if (!p.name && !p['name:en']) return false;
      const minZoom = p.min_zoom ?? p['pmap:min_zoom'];
      return minZoom === undefined ? z >= 16 : minZoom <= z;
    },
    sort: (a, b) => (a.min_zoom ?? 20) - (b.min_zoom ?? 20),
  };
}

/** Options shared by the 2D map and the 3D globe. */
export function labelStyleOptions(t) {
  const font = labelFont(t);
  return {
    family: font.stack,
    bold: t.mapLabels.weight === 'bold',
    scale: { ...t.mapLabels.scale },
    showLandmarks: t.mapLabels.showLandmarks,
  };
}

/** Label rules for the vector basemap with the user's map typography applied. */
export function buildLabelRules(t, lang = 'en') {
  const opts = labelStyleOptions(t);
  const rules = stockLabelRules(namedFlavor(FLAVOR), lang);
  for (const rule of rules) wrapFonts(rule.symbolizer, rule.dataLayer, opts);
  if (opts.showLandmarks) rules.push(landmarkRule(opts));
  return rules;
}

/** Everything leafletLayer() needs instead of `flavor` when custom label rules are used. */
export function vectorStyle(t) {
  const flavor = namedFlavor(FLAVOR);
  return {
    paintRules: stockPaintRules(flavor),
    labelRules: t ? buildLabelRules(t) : stockLabelRules(flavor, 'en'),
    backgroundColor: flavor.background,
  };
}
