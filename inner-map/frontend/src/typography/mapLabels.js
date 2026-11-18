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
import {
  CenteredTextSymbolizer,
  CircleSymbolizer,
  GroupSymbolizer,
  LineSymbolizer,
  OffsetTextSymbolizer,
  labelRules as stockLabelRules,
  paintRules as stockPaintRules,
} from 'protomaps-leaflet';
import { CATEGORY_COLOURS, LABEL_FILTER_CATEGORIES, categoryOf } from '../search/categories';
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

// ---- businesses and landmarks (Stage 5) --------------------------------------------------
// Points of interest are not labelled by the stock style. One rule per category gives each a
// coloured dot and text colour, in priority order (earlier rules win label collisions).
// Only features that have a name in the data are labelled; nothing is invented.
const poiCategory = (f) => categoryOf('pois', f.props.kind);
const hasName = (f) => Boolean(f.props.name || f.props['name:en']);
// The data marks how prominent each feature is (min_zoom). Show it from that zoom.
const visibleAt = (z, f) => {
  const mz = f.props.min_zoom ?? f.props['pmap:min_zoom'];
  return mz === undefined ? z >= 16 : mz <= z;
};

function poiRule(category, opts) {
  const colour = CATEGORY_COLOURS[category] || CATEGORY_COLOURS.other;
  const base = category === 'places' ? '600 11.5px sans-serif' : '400 11px sans-serif';
  return {
    dataLayer: 'pois',
    minzoom: 13,
    filter: (z, f) => hasName(f) && poiCategory(f) === category && visibleAt(z, f),
    sort: (a, b) => (a.min_zoom ?? 20) - (b.min_zoom ?? 20),
    symbolizer: new GroupSymbolizer([
      new CircleSymbolizer({ radius: 3.5, fill: colour.dot, stroke: '#ffffff', width: 1.5 }),
      new OffsetTextSymbolizer({
        labelProps: ['name:en', 'name'],
        fill: colour.text,
        stroke: '#ffffff',
        width: 2.2,
        offsetX: 6,
        offsetY: 4,
        lineHeight: 1.1,
        font: () => restyleFont(base, opts.scale.landmarks, opts.family, opts.bold),
      }),
    ]),
  };
}

/** House numbers (OSM addr:housenumber on building/address points), from zoom 17. */
function houseNumberRule(opts) {
  return {
    dataLayer: 'buildings',
    minzoom: 17,
    filter: (z, f) => Boolean(f.props.addr_housenumber),
    symbolizer: new CenteredTextSymbolizer({
      labelProps: ['addr_housenumber'],
      fill: '#7a6f63',
      stroke: '#f3eee8',
      width: 1.5,
      font: () => restyleFont('400 9.5px sans-serif', opts.scale.landmarks, opts.family, false),
    }),
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

/** Default label filter: every business / landmark category on. */
export const DEFAULT_POI_FILTER = Object.freeze([...LABEL_FILTER_CATEGORIES]);

/** Label rules for the vector basemap with the user's map typography applied. */
export function buildLabelRules(t, lang = 'en', { poiFilter = DEFAULT_POI_FILTER } = {}) {
  const opts = labelStyleOptions(t);
  const rules = stockLabelRules(namedFlavor(FLAVOR), lang);
  for (const rule of rules) wrapFonts(rule.symbolizer, rule.dataLayer, opts);
  if (opts.showLandmarks) {
    for (const cat of LABEL_FILTER_CATEGORIES) if (poiFilter.includes(cat)) rules.push(poiRule(cat, opts));
  }
  rules.push(houseNumberRule(opts));
  return rules;
}

/** Thin outlines so building footprints stand out from the ground at street zooms. */
function buildingOutlineRule() {
  return {
    dataLayer: 'buildings',
    minzoom: 15,
    filter: (z, f) => f.props.kind === 'building' || f.props.kind === 'building_part',
    symbolizer: new LineSymbolizer({ color: '#c9bfb2', width: (z) => (z >= 17 ? 0.9 : 0.5) }),
  };
}

/** Everything leafletLayer() needs instead of `flavor` when custom label rules are used. */
export function vectorStyle(t, labelOptions) {
  const flavor = namedFlavor(FLAVOR);
  return {
    paintRules: [...stockPaintRules(flavor), buildingOutlineRule()],
    labelRules: t ? buildLabelRules(t, 'en', labelOptions) : stockLabelRules(flavor, 'en'),
    backgroundColor: flavor.background,
  };
}
