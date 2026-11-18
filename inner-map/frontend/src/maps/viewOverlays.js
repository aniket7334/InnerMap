// Overlays for the map views, drawn from the same offline vector data as the default map
// (so they work offline wherever that data is downloaded or served):
//   - labels only  -> place / road / water labels on top of satellite imagery ("hybrid")
//   - transit      -> railway, metro, monorail and tram lines + stations and stops (OpenStreetMap)
// Bus ROUTE lines are not part of this data (only the stops), so they are not drawn.
import {
  leafletLayer,
  LineSymbolizer,
  CircleSymbolizer,
  GroupSymbolizer,
  OffsetTextSymbolizer,
  LineLabelSymbolizer,
} from 'protomaps-leaflet';
import { LocalFirstVectorSource } from './VectorTileLayer';
import { buildLabelRules, labelStyleOptions, restyleFont } from '../typography/mapLabels';

function overlay(provider, paintRules, labelRules, extra = {}) {
  return leafletLayer({
    url: new LocalFirstVectorSource(provider),
    paintRules,
    labelRules,
    lang: 'en',
    maxDataZoom: provider.maxDataZoom,
    minZoom: provider.minZoom,
    maxZoom: provider.maxZoom,
    // same text as the base vector layer, so Leaflet shows the credit once
    attribution: provider.attribution,
    ...extra,
  });
}

/** Place, road and water labels (no fills) to lay over satellite imagery. */
export function createLabelsOverlay(provider, typography, labelOptions) {
  // Light text with a dark halo reads well on imagery.
  const layer = overlay(provider, [], buildLabelRules(typography, 'en', labelOptions));
  layer.options.className = 'labels-on-imagery';
  return layer;
}

const RAIL_COLOURS = {
  subway: '#7c3aed', // metro
  light_rail: '#0369a1',
  monorail: '#0e7490',
  tram: '#c2410c',
  narrow_gauge: '#b91c1c',
  rail: '#b91c1c', // suburban / mainline
};
const RAIL_KINDS = new Set(Object.keys(RAIL_COLOURS));

const isRail = (f) => f.props.kind === 'rail' && RAIL_KINDS.has(f.props.kind_detail || 'rail') && !f.props.service;
const railWidth = (z) => (z < 11 ? 1.2 : z < 13 ? 2 : z < 15 ? 3 : 4);

/** Transit overlay (OpenStreetMap railways and public-transport stops). */
export function createTransitOverlay(provider, typography) {
  const opts = labelStyleOptions(typography);
  const font = (base, cat = 'landmarks') => () => restyleFont(base, opts.scale[cat] ?? 1, opts.family, opts.bold);

  const paintRules = [
    // white casing under every line
    {
      dataLayer: 'roads',
      symbolizer: new LineSymbolizer({ color: '#ffffff', width: (z) => railWidth(z) + 2.5, opacity: 0.9 }),
      filter: (z, f) => isRail(f),
    },
    {
      dataLayer: 'roads',
      symbolizer: new LineSymbolizer({
        color: (z, f) => RAIL_COLOURS[f.props.kind_detail] || RAIL_COLOURS.rail,
        width: (z) => railWidth(z),
      }),
      filter: (z, f) => isRail(f),
    },
    // ferry routes (dashed)
    {
      dataLayer: 'roads',
      symbolizer: new LineSymbolizer({ color: '#0f766e', width: 1.5, dash: [4, 3] }),
      filter: (z, f) => f.props.kind === 'ferry',
    },
  ];

  const stop = (kind, minzoom, circle, textFont) => ({
    dataLayer: 'pois',
    minzoom,
    filter: (z, f) => kind.includes(f.props.kind),
    symbolizer: new GroupSymbolizer([
      new CircleSymbolizer(circle),
      new OffsetTextSymbolizer({
        labelProps: ['name:en', 'name'],
        fill: '#1f2937',
        stroke: '#ffffff',
        width: 2.5,
        offsetX: circle.radius + 3,
        offsetY: 4,
        font: textFont,
      }),
    ]),
  });

  const labelRules = [
    stop(['station', 'halt', 'train_station'], 11, { radius: 5, fill: '#ffffff', stroke: '#111827', width: 2 }, font('600 12px sans-serif')),
    stop(['subway_entrance'], 15, { radius: 3.5, fill: '#ffffff', stroke: RAIL_COLOURS.subway, width: 2 }, font('400 11px sans-serif')),
    stop(['bus_station'], 13, { radius: 4.5, fill: '#ffffff', stroke: '#1d4ed8', width: 2 }, font('600 11px sans-serif')),
    stop(['ferry_terminal', 'pier'], 13, { radius: 4.5, fill: '#ffffff', stroke: '#0f766e', width: 2 }, font('600 11px sans-serif')),
    stop(['tram_stop', 'stop', 'stop_position'], 15, { radius: 3, fill: '#ffffff', stroke: '#c2410c', width: 1.5 }, font('400 10.5px sans-serif')),
    stop(['bus_stop'], 15, { radius: 3, fill: '#1d4ed8', stroke: '#ffffff', width: 1 }, font('400 10.5px sans-serif')),
    // line names (e.g. "Harbour Line") along the track
    {
      dataLayer: 'roads',
      minzoom: 13,
      filter: (z, f) => isRail(f) && Boolean(f.props.name),
      symbolizer: new LineLabelSymbolizer({
        labelProps: ['name:en', 'name'],
        fill: '#7f1d1d',
        stroke: '#ffffff',
        width: 2,
        font: font('italic 400 10.5px sans-serif'),
      }),
    },
  ];
  return overlay(provider, paintRules, labelRules);
}

export const TRANSIT_LEGEND = [
  { colour: RAIL_COLOURS.rail, label: 'Suburban / mainline rail' },
  { colour: RAIL_COLOURS.subway, label: 'Metro' },
  { colour: RAIL_COLOURS.monorail, label: 'Monorail / light rail' },
  { colour: '#0f766e', label: 'Ferry', dashed: true },
];
