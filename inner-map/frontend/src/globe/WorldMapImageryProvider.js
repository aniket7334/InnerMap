// A street-map style world for the 3D Earth when there is no internet (offline mode or no
// connection): land, sea, coastlines and country borders drawn on the device from Natural
// Earth's 1:50m countries (public domain; world-atlas 2.0.2, ISC, public/data/world-countries-50m.json).
// Only an outline: at street level its coasts can be kilometres off (e.g. South Mumbai is drawn as
// sea) - the Earth says so there, and a downloaded area's street map covers it.
// The colours are the light map style of the downloaded street maps, so zooming into a
// downloaded area blends into its full street map. Country, state and city names come from the
// world-names layer on top.
import { Credit, Event as CesiumEvent, GeographicTilingScheme, Math as CesiumMath } from 'cesium';
import { feature, mesh } from 'topojson-client';
import { namedFlavor } from '@protomaps/basemaps';

const TILE = 256;
const URLS = { '50m': '/data/world-countries-50m.json' };
const flavor = namedFlavor('light');
const COLORS = {
  water: flavor.water, // #80deea
  land: flavor.earth, // #e2dfda
  coast: 'rgba(70, 150, 170, 0.55)',
  border: '#9e9aa8',
};

const dataPromises = {};
/** Loads (once) and prepares the outlines ('50m'). Fetched while online so it is cached for offline use. */
export function loadWorldCountries(res = '50m') {
  if (!dataPromises[res]) {
    dataPromises[res] = fetch(URLS[res])
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((topo) => {
        const land = feature(topo, topo.objects.land);
        const borders = mesh(topo, topo.objects.countries, (a, b) => a !== b);
        const polys = [];
        for (const f of land.features || [land]) {
          const g = f.geometry;
          const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
          for (const rings of list) polys.push({ rings, bbox: bboxOf(rings[0]) });
        }
        const lines = (borders.type === 'MultiLineString' ? borders.coordinates : [borders.coordinates]).map((l) => ({ l, bbox: bboxOf(l) }));
        return { polys, lines };
      })
      .catch((err) => {
        dataPromises[res] = null; // try again next time
        throw err;
      });
  }
  return dataPromises[res];
}

function bboxOf(pts) {
  let w = 180;
  let s = 90;
  let e = -180;
  let n = -90;
  for (const [x, y] of pts) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

export class WorldMapImageryProvider {
  constructor() {
    this.tilingScheme = new GeographicTilingScheme();
    this.rectangle = this.tilingScheme.rectangle;
    this.tileWidth = TILE;
    this.tileHeight = TILE;
    this.minimumLevel = 0;
    this.maximumLevel = 14; // drawn from outlines, so it stays sharp when zoomed in
    this.tileDiscardPolicy = undefined;
    this.errorEvent = new CesiumEvent();
    this.credit = new Credit('Natural Earth', false);
    this.proxy = undefined;
    this.hasAlphaChannel = true; // transparent when no outlines are stored yet (the bundled imagery shows)
    loadWorldCountries('50m').catch(() => {});
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
    const g = canvas.getContext('2d');
    let data;
    try {
      data = await loadWorldCountries('50m');
    } catch {
      // never opened online since this was added: leave it see-through (the bundled Earth
      // imagery shows) rather than painting everything as sea
      return canvas;
    }
    g.fillStyle = COLORS.water;
    g.fillRect(0, 0, TILE, TILE);
    const r = this.tilingScheme.tileXYToRectangle(x, y, level);
    const west = CesiumMath.toDegrees(r.west);
    const east = CesiumMath.toDegrees(r.east);
    const south = CesiumMath.toDegrees(r.south);
    const north = CesiumMath.toDegrees(r.north);
    const sx = TILE / (east - west);
    const sy = TILE / (north - south);
    const pad = 1 / sx; // one pixel, in degrees
    const hit = ([w, s, e, n]) => e >= west - pad && w <= east + pad && n >= south - pad && s <= north + pad;
    const path = (pts) => {
      for (let i = 0; i < pts.length; i++) {
        const px = (pts[i][0] - west) * sx;
        const py = (north - pts[i][1]) * sy;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
    };

    // land, with a soft coastline
    g.beginPath();
    for (const p of data.polys) {
      if (!hit(p.bbox)) continue;
      for (const ring of p.rings) {
        path(ring);
        g.closePath();
      }
    }
    g.fillStyle = COLORS.land;
    g.fill('evenodd');
    g.lineJoin = 'round';
    g.strokeStyle = COLORS.coast;
    g.lineWidth = level >= 6 ? 1.4 : 1;
    g.stroke();

    // country borders
    g.beginPath();
    for (const b of data.lines) if (hit(b.bbox)) path(b.l);
    g.strokeStyle = COLORS.border;
    g.lineWidth = level >= 5 ? 1.6 : level >= 3 ? 1.2 : 0.9;
    g.setLineDash(level >= 4 ? [6, 3] : []);
    g.stroke();
    return canvas;
  }
}
