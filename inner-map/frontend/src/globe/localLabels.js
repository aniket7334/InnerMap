// Local names on the 3D Earth when you zoom in: towns, villages, hamlets, suburbs and
// neighbourhoods, buildings and landmarks (stations, hospitals, colleges, temples, malls,
// museums, parks…), streets and waters - drawn by the world-label layer, so they never overlap.
//
// Online: OpenStreetMap data from OpenFreeMap vector tiles (OpenMapTiles schema; free, no key),
//         more detail the closer you are: towns -> villages -> neighbourhoods -> buildings/streets.
// Offline: towns and villages from GeoNames (bundled per 4° area, kept by the service worker for
//          areas you visited) - building and street names need the internet.
import { Credit, Math as CesiumMath } from 'cesium';
import Pbf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const TILEJSON = import.meta.env.VITE_LABEL_TILES_URL || 'https://tiles.openfreemap.org/planet';
const maxTiles = (z) => (z >= 14 ? 12 : z === 13 ? 16 : 24); // low-zoom tiles are small and cover more
const KM = 1000;

// camera height (m) -> vector tile zoom with the right amount of detail
function zoomFor(height) {
  if (height < 3500) return 14; // buildings, landmarks, streets
  if (height < 12000) return 13; // neighbourhoods, important buildings
  if (height < 45000) return 12; // villages, hamlets, suburbs
  if (height < 160000) return 10; // towns and big villages
  return null;
}

// ---------------------------------------------------------------- styles (Google-Earth-like legibility)
const C = {
  town: '#ffffff',
  village: '#eceff1',
  hamlet: '#cfd8dc',
  suburb: '#ffe0b2',
  street: '#fff8e1',
  water: '#a9d6ff',
};
// points of interest: dot colour and importance by class
const POI = {
  attraction: ['#fbbc04', 0], museum: ['#fbbc04', 0], monument: ['#fbbc04', 0], castle: ['#fbbc04', 0], historic: ['#fbbc04', 1], art_gallery: ['#fbbc04', 1], zoo: ['#81c995', 1], stadium: ['#81c995', 1],
  railway: ['#4fc3f7', 0], bus: ['#4fc3f7', 3], aerialway: ['#4fc3f7', 3], ferry_terminal: ['#4fc3f7', 1],
  hospital: ['#f28b82', 1], doctors: ['#f28b82', 4], pharmacy: ['#f28b82', 5],
  college: ['#8ab4f8', 1], school: ['#8ab4f8', 3], library: ['#8ab4f8', 3], kindergarten: ['#8ab4f8', 6],
  place_of_worship: ['#c58af9', 2], religion: ['#c58af9', 2],
  park: ['#81c995', 2], garden: ['#81c995', 3], campsite: ['#81c995', 4], playground: ['#81c995', 6],
  shop: ['#f48fb1', 4], mall: ['#f48fb1', 1], department_store: ['#f48fb1', 2], grocery: ['#f48fb1', 5],
  restaurant: ['#ff8a65', 4], cafe: ['#ff8a65', 5], fast_food: ['#ff8a65', 5], bar: ['#ff8a65', 5], beer: ['#ff8a65', 5],
  lodging: ['#ce93d8', 3], town_hall: ['#e0e0e0', 1], police: ['#e0e0e0', 3], fire_station: ['#e0e0e0', 3], post: ['#e0e0e0', 4], bank: ['#e0e0e0', 4], fuel: ['#e0e0e0', 5], cinema: ['#ff8a65', 3], theatre: ['#ff8a65', 2],
};

const nameOf = (p) => (p['name:en'] || p.name_en || p.name || '').trim();

function placeItem(p, lng, lat) {
  const text = nameOf(p);
  if (!text) return null;
  const cls = p.class;
  if (cls === 'city' || cls === 'country' || cls === 'state' || cls === 'province' || cls === 'continent') return null; // world names have these
  if (cls === 'town') return { lng, lat, text, px: 17, weight: 600, color: C.town, dot: true, dotSize: 7, prio: 14 + (p.rank || 10) * 0.05, far: 220 * KM };
  if (cls === 'village') return { lng, lat, text, px: 15, weight: 500, color: C.village, dot: true, dotSize: 6, prio: 16 + (p.rank || 10) * 0.05, far: 90 * KM };
  if (cls === 'suburb' || cls === 'quarter' || cls === 'borough') return { lng, lat, text: text.toUpperCase(), px: 14.5, weight: 600, color: C.suburb, prio: 17, far: 70 * KM };
  if (cls === 'neighbourhood') return { lng, lat, text: text.toUpperCase(), px: 13.5, weight: 500, color: C.suburb, prio: 20, far: 18 * KM };
  if (cls === 'hamlet' || cls === 'isolated_dwelling' || cls === 'locality' || cls === 'island' || cls === 'islet')
    return { lng, lat, text, px: 14, weight: 500, color: C.hamlet, dot: cls !== 'island' && cls !== 'islet', dotSize: 5, prio: 21, far: 30 * KM };
  return null;
}

function poiItem(p, lng, lat) {
  const text = nameOf(p);
  if (!text || text.length > 48) return null;
  const style = POI[p.class] || POI[p.subclass];
  const [color, level] = style || ['#bdc1c6', 6];
  const rank = p.rank || 30;
  return {
    lng,
    lat,
    text,
    px: level <= 1 ? 15.5 : 14,
    weight: level <= 1 ? 600 : 500,
    color: '#ffffff',
    dot: true,
    dotColor: color,
    dotSize: level <= 1 ? 9 : 7.5,
    prio: 24 + level * 1.5 + Math.min(rank, 60) * 0.05,
    far: level <= 1 ? 16 * KM : level <= 3 ? 7 * KM : 4 * KM,
  };
}

const ROAD_LEVEL = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, minor: 4, service: 6, path: 7, track: 7 };

function lineMiddle(coords) {
  // middle vertex of the longest part
  let best = coords;
  if (Array.isArray(coords[0]?.[0])) best = coords.reduce((a, b) => (b.length > a.length ? b : a), coords[0]);
  return best[Math.floor(best.length / 2)];
}

/** Decodes one OpenMapTiles vector tile into label items. */
function decodeTile(buffer, x, y, z) {
  const tile = new VectorTile(new Pbf(buffer));
  const out = [];
  const each = (layerName, fn) => {
    const layer = tile.layers[layerName];
    if (!layer) return;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      try {
        fn(f.properties, f.toGeoJSON(x, y, z).geometry);
      } catch {
        /* skip a malformed feature */
      }
    }
  };
  each('place', (p, g) => {
    if (g.type !== 'Point') return;
    const it = placeItem(p, g.coordinates[0], g.coordinates[1]);
    if (it) out.push(it);
  });
  if (z >= 13) {
    each('poi', (p, g) => {
      const c = g.type === 'Point' ? g.coordinates : null;
      if (!c) return;
      const it = poiItem(p, c[0], c[1]);
      if (it) out.push(it);
    });
  }
  if (z >= 12) {
    each('water_name', (p, g) => {
      const text = nameOf(p);
      if (!text) return;
      const c = g.type === 'Point' ? g.coordinates : lineMiddle(g.coordinates);
      if (c) out.push({ lng: c[0], lat: c[1], text, px: 14.5, weight: 500, italic: true, color: C.water, prio: 22, far: 80 * KM });
    });
  }
  if (z >= 14) {
    // one label per street name in the tile, at the middle of its longest piece
    const seen = new Set();
    each('transportation_name', (p, g) => {
      const text = nameOf(p);
      const level = ROAD_LEVEL[p.class] ?? 5;
      if (!text || level > 6 || seen.has(text) || (g.type !== 'LineString' && g.type !== 'MultiLineString')) return;
      seen.add(text);
      const c = lineMiddle(g.coordinates);
      if (c) out.push({ lng: c[0], lat: c[1], text, px: level <= 1 ? 14.5 : 13.5, weight: 500, italic: true, color: C.street, prio: 30 + level, far: level <= 2 ? 8 * KM : 4 * KM });
    });
  }
  return out;
}

// ---------------------------------------------------------------- tiles in view
function tileXY(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const r = CesiumMath.toRadians(Math.max(-85, Math.min(85, lat)));
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

/** Tiles covering the view, nearest to the centre first, at most `max`. */
function tilesInView(rect, center, z, max) {
  const [x0, y0] = tileXY(CesiumMath.toDegrees(rect.west), CesiumMath.toDegrees(rect.north), z);
  const [x1, y1] = tileXY(CesiumMath.toDegrees(rect.east), CesiumMath.toDegrees(rect.south), z);
  const [cx, cy] = tileXY(center.lng, center.lat, z);
  const list = [];
  const xs = x0 <= x1 ? x1 - x0 + 1 : 2 ** z - x0 + x1 + 1;
  if (xs * (y1 - y0 + 1) > 400) return [[cx, cy]]; // looking at the horizon: just the centre
  for (let i = 0; i < xs; i++) {
    const x = (x0 + i) % 2 ** z;
    for (let y = y0; y <= y1; y++) list.push([x, y]);
  }
  list.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
  return list.slice(0, max);
}

let templatePromise = null;
function tileTemplate() {
  if (!templatePromise) {
    templatePromise = fetch(TILEJSON)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => j.tiles[0])
      .catch((err) => {
        templatePromise = null;
        throw err;
      });
  }
  return templatePromise;
}

// ---------------------------------------------------------------- offline: GeoNames towns and villages
const GEO_TILE = 4;
function geoItem([name, lng, lat, pop, kind]) {
  if (kind === 2) return { lng, lat, text: name.toUpperCase(), px: 14, weight: 600, color: C.suburb, prio: 18, far: 25 * KM };
  if (pop >= 5000) return { lng, lat, text: name, px: 17, weight: 600, color: C.town, dot: true, dotSize: 7, prio: 14.5, far: 120 * KM };
  if (pop >= 2000) return { lng, lat, text: name, px: 15, weight: 500, color: C.village, dot: true, dotSize: 6, prio: 16, far: 60 * KM };
  return { lng, lat, text: name, px: 14, weight: 500, color: C.village, dot: true, dotSize: 5, prio: 17, far: 35 * KM };
}
let geoIndex = null;
function geoTiles() {
  if (!geoIndex) {
    geoIndex = fetch('/data/places/index.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => new Set(d.tiles))
      .catch((err) => {
        geoIndex = null;
        throw err;
      });
  }
  return geoIndex;
}

/**
 * @param viewer Cesium viewer
 * @param layer  world-label layer (createWorldLabels) - draws the names
 * @param opts   { isOnline(): bool, skip(lat, lng): bool }  skip: areas where another layer already draws local names
 */
export function createLocalLabels(viewer, layer, opts = {}) {
  const cache = new Map(); // key -> Promise<items[]>
  const order = []; // LRU of cache keys
  let enabled = true;
  let timer = 0;
  let generation = 0;
  const credit = new Credit('Local names: © OpenMapTiles © OpenStreetMap contributors', false);
  let creditShown = false;
  const showCredit = (on) => {
    if (on === creditShown || viewer.isDestroyed()) return;
    if (on) viewer.creditDisplay.addStaticCredit(credit);
    else viewer.creditDisplay.removeStaticCredit(credit);
    creditShown = on;
  };

  const remember = (key, promise) => {
    cache.set(key, promise);
    order.push(key);
    while (order.length > 160) cache.delete(order.shift());
    return promise;
  };
  const filtered = (items) => (opts.skip ? items.filter((it) => !opts.skip(it.lat, it.lng)) : items);

  const osmTile = (template, z, x, y) => {
    const key = `osm/${z}/${x}/${y}`;
    if (cache.has(key)) return cache.get(key);
    const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    return remember(
      key,
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : r.status === 404 ? null : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((buf) => (buf ? decodeTile(buf, x, y, z) : []))
        .catch((err) => {
          cache.delete(key);
          throw err;
        })
    );
  };
  const geoTile = (k) => {
    const key = `geo/${k}`;
    if (cache.has(key)) return cache.get(key);
    return remember(
      key,
      fetch(`/data/places/${k}.json`)
        .then((r) => (r.ok ? r.json() : []))
        .then((list) => list.map(geoItem))
        .catch((err) => {
          cache.delete(key);
          throw err;
        })
    );
  };

  const update = async () => {
    const id = ++generation;
    if (!enabled || viewer.isDestroyed()) {
      layer.keepGroups(new Set());
      showCredit(false);
      return;
    }
    const camera = viewer.camera;
    const height = camera.positionCartographic.height;
    const z = zoomFor(height);
    const rect = camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
    const c = camera.positionCartographic;
    const center = { lng: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) };
    if (!z || !rect) {
      layer.keepGroups(new Set());
      showCredit(false);
      return;
    }
    const online = opts.isOnline ? opts.isOnline() : navigator.onLine;
    const wanted = new Set();
    if (online) {
      let template;
      try {
        template = await tileTemplate();
      } catch {
        template = null;
      }
      if (template && id === generation) {
        const tiles = tilesInView(rect, center, z, maxTiles(z));
        showCredit(true);
        tiles.forEach(([x, y]) => wanted.add(`osm/${z}/${x}/${y}`));
        layer.keepGroups(wanted); // drop names of tiles left behind right away
        for (const [x, y] of tiles) {
          osmTile(template, z, x, y)
            .then((items) => id === generation && layer.setGroup(`osm/${z}/${x}/${y}`, filtered(items)))
            .catch(() => {});
        }
        return;
      }
    }
    // offline (or the online names could not be reached): towns and villages from GeoNames
    showCredit(false);
    if (height > 160000) {
      layer.keepGroups(new Set());
      return;
    }
    let index;
    try {
      index = await geoTiles();
    } catch {
      return;
    }
    if (id !== generation) return;
    const keys = [];
    const s = Math.floor(CesiumMath.toDegrees(rect.south) / GEO_TILE) * GEO_TILE;
    const n = Math.floor(CesiumMath.toDegrees(rect.north) / GEO_TILE) * GEO_TILE;
    const w = Math.floor(CesiumMath.toDegrees(rect.west) / GEO_TILE) * GEO_TILE;
    const e = Math.floor(CesiumMath.toDegrees(rect.east) / GEO_TILE) * GEO_TILE;
    for (let la = s; la <= n; la += GEO_TILE) for (let lo = w; lo <= e && keys.length < 9; lo += GEO_TILE) if (index.has(`${la}_${lo}`)) keys.push(`${la}_${lo}`);
    keys.forEach((k) => wanted.add(`geo/${k}`));
    layer.keepGroups(wanted);
    for (const k of keys) geoTile(k).then((items) => id === generation && layer.setGroup(`geo/${k}`, filtered(items))).catch(() => {});
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(update, 350);
  };
  const stopMoveEnd = viewer.camera.moveEnd.addEventListener(schedule);
  schedule();

  return {
    setEnabled(on) {
      enabled = on;
      schedule();
    },
    refresh: schedule,
    destroy() {
      clearTimeout(timer);
      generation++;
      stopMoveEnd();
      showCredit(false);
    },
  };
}
