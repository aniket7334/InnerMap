// Transit layer for the Earth page: railway, metro (subway), light rail, monorail and tram lines,
// and stations, drawn on transparent tiles from OpenStreetMap data (OpenFreeMap vector tiles,
// OpenMapTiles schema - the same tiles as the local place names). Online only.
import { Credit, Event as CesiumEvent, WebMercatorTilingScheme } from 'cesium';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { tileTemplate } from './localLabels';

const TILE = 256;
const MIN_LEVEL = 8; // lines only from about city scale; farther out the tiles stay empty
const DATA_MAX = 14; // the vector tiles go to zoom 14; closer in we draw from the zoom-14 tile
const LINES = {
  rail: { color: '#3c4a5c', width: 2.6, dash: [7, 6], casing: '#ffffff' },
  narrow_gauge: { color: '#3c4a5c', width: 2, dash: [5, 5], casing: '#ffffff' },
  subway: { color: '#1a73e8', width: 3.2 },
  light_rail: { color: '#8e24aa', width: 2.8 },
  monorail: { color: '#00897b', width: 2.8 },
  tram: { color: '#e91e63', width: 2.2 },
  funicular: { color: '#6d4c41', width: 2.2 },
};
const tileCache = new Map();
const order = [];

function dataTile(template, z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const p = fetch(template.replace('{z}', z).replace('{x}', x).replace('{y}', y))
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((buf) => (buf ? new VectorTile(new Pbf(buf)) : null))
    .catch(() => null);
  tileCache.set(key, p);
  order.push(key);
  while (order.length > 120) tileCache.delete(order.shift());
  return p;
}

export class TransitImageryProvider {
  constructor() {
    this.tilingScheme = new WebMercatorTilingScheme();
    this.rectangle = this.tilingScheme.rectangle;
    this.tileWidth = TILE;
    this.tileHeight = TILE;
    // 0, not MIN_LEVEL: a high minimum makes Cesium cover the whole globe with thousands of tiles
    this.minimumLevel = 0;
    this.maximumLevel = 18;
    this.tileDiscardPolicy = undefined;
    this.errorEvent = new CesiumEvent();
    this.credit = new Credit('Transit: © OpenMapTiles © OpenStreetMap contributors', false);
    this.proxy = undefined;
    this.hasAlphaChannel = true;
  }

  getTileCredits() {
    return [];
  }

  pickFeatures() {
    return undefined;
  }

  async requestImage(x, y, level) {
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    if (level < MIN_LEVEL) return canvas;
    let template;
    try {
      template = await tileTemplate();
    } catch {
      return canvas;
    }
    // closer than the data's zoom: draw the matching part of the zoom-14 tile, enlarged
    const dz = Math.max(0, level - DATA_MAX);
    const z = level - dz;
    const scale = 2 ** dz;
    const tx = Math.floor(x / scale);
    const ty = Math.floor(y / scale);
    const ox = (x - tx * scale) * (TILE / scale);
    const oy = (y - ty * scale) * (TILE / scale);
    const tile = await dataTile(template, z, tx, ty);
    if (!tile) return canvas;
    const g = canvas.getContext('2d');
    const draw = (layerName, fn) => {
      const layer = tile.layers[layerName];
      if (!layer) return;
      const k = (TILE * scale) / layer.extent;
      for (let i = 0; i < layer.length; i++) fn(layer.feature(i), k);
    };
    const pathOf = (rings, k) => {
      g.beginPath();
      for (const ring of rings) {
        ring.forEach((pt, j) => {
          const px = pt.x * k - ox;
          const py = pt.y * k - oy;
          if (j === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        });
      }
    };
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const widthBoost = level >= 15 ? 1.5 : level >= 13 ? 1.2 : 1;
    // lines: a white casing first so they read over the imagery
    for (const pass of ['casing', 'line']) {
      draw('transportation', (f, k) => {
        const p = f.properties;
        if (p.class !== 'rail' && p.class !== 'transit') return;
        const style = LINES[p.subclass] || (p.class === 'rail' ? LINES.rail : LINES.subway);
        if (p.service && level < 14) return; // sidings and yards only close up
        pathOf(f.loadGeometry(), k);
        if (pass === 'casing') {
          g.setLineDash([]);
          g.strokeStyle = 'rgba(255,255,255,0.85)';
          g.lineWidth = (style.width + 2.4) * widthBoost;
        } else {
          g.strokeStyle = style.color;
          g.lineWidth = style.width * widthBoost;
          g.setLineDash(style.dash && level >= 12 ? style.dash : []);
        }
        g.stroke();
      });
    }
    g.setLineDash([]);
    // stations
    draw('poi', (f, k) => {
      const p = f.properties;
      if (p.class !== 'railway' && !(p.class === 'bus' && p.subclass === 'bus_station' && level >= 14)) return;
      const [pt] = f.loadGeometry()[0] || [];
      if (!pt) return;
      const px = pt.x * k - ox;
      const py = pt.y * k - oy;
      const r = (p.subclass === 'station' ? 5 : 4) * widthBoost;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fillStyle = '#ffffff';
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = p.subclass === 'subway' ? '#1a73e8' : p.class === 'bus' ? '#0288d1' : '#3c4a5c';
      g.stroke();
    });
    return canvas;
  }
}
