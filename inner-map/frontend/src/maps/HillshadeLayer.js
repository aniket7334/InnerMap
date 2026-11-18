// Terrain view: hill shading computed on the device from real elevation data
// (TERRAIN_SOURCE, "terrarium" PNG tiles: elevation = R*256 + G + B/256 - 32768 metres).
// Tiles come from IndexedDB when downloaded, otherwise from the network when online.
// Where no elevation data is available the layer stays empty and reports it (no fake relief).
import L from 'leaflet';
import { tileKey } from './tileMath';
import { buildTileUrl } from './providers';
import { getTile } from '../offline/tileStore';
import { isOnline } from '../offline/connectivity';

const SIZE = 256;
const cache = new Map(); // "z/x/y" -> Float32Array | null (null = not available)
const pending = new Map();
const MAX_CACHE = 96;

function remember(key, grid) {
  cache.set(key, grid);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
}

async function decode(blob) {
  const bmp = await createImageBitmap(blob);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(SIZE, SIZE) : Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
  bmp.close?.();
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const grid = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < grid.length; i += 1) grid[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  return grid;
}

/** Elevation grid (256x256 metres) of one DEM tile at z <= maxDataZoom, or null. */
async function loadDemTile(source, z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    let blob = null;
    try {
      const rec = await getTile(tileKey(source.layerId, z, x, y));
      if (rec) blob = rec.blob;
    } catch {
      /* ignore */
    }
    if (!blob && isOnline() && navigator.onLine) {
      try {
        const res = await fetch(buildTileUrl(source, z, x, y));
        if (res.ok) blob = await res.blob();
      } catch {
        /* offline or blocked */
      }
    }
    const grid = blob ? await decode(blob).catch(() => null) : null;
    remember(key, grid);
    return grid;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** Elevation grid for any display tile (deeper zooms are sampled from the deepest DEM tile). */
async function demGrid(source, z, x, y) {
  const maxZ = source.maxDataZoom;
  if (z <= maxZ) return loadDemTile(source, z, x, y);
  const f = 2 ** (z - maxZ);
  const parent = await loadDemTile(source, maxZ, Math.floor(x / f), Math.floor(y / f));
  if (!parent) return null;
  const ox = (x % f) * (SIZE / f);
  const oy = (y % f) * (SIZE / f);
  const grid = new Float32Array(SIZE * SIZE);
  for (let j = 0; j < SIZE; j += 1) {
    const py = Math.min(SIZE - 1.001, oy + (j + 0.5) / f - 0.5);
    const y0 = Math.max(0, Math.floor(py));
    const ty = py - y0;
    for (let i = 0; i < SIZE; i += 1) {
      const pxx = Math.min(SIZE - 1.001, ox + (i + 0.5) / f - 0.5);
      const x0 = Math.max(0, Math.floor(pxx));
      const tx = pxx - x0;
      const a = parent[y0 * SIZE + x0];
      const b = parent[y0 * SIZE + x0 + 1];
      const c = parent[(y0 + 1) * SIZE + x0];
      const d = parent[(y0 + 1) * SIZE + x0 + 1];
      grid[j * SIZE + i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return grid;
}

/** Elevation in metres at a point (uses the DEM tile at zoom <= 15), or null if unavailable. */
export async function elevationAt(source, lat, lng, zoom = 14) {
  const z = Math.min(source.maxDataZoom, Math.max(0, Math.round(zoom)));
  const n = 2 ** z;
  const fx = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const grid = await loadDemTile(source, z, Math.floor(fx), Math.floor(fy));
  if (!grid) return null;
  const i = Math.min(SIZE - 1, Math.floor((fx % 1) * SIZE));
  const j = Math.min(SIZE - 1, Math.floor((fy % 1) * SIZE));
  const v = grid[j * SIZE + i];
  return Number.isFinite(v) && v > -12000 ? v : null;
}

function shade(grid, z, y) {
  // Ground size of one pixel at this tile's latitude.
  const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z)));
  const cell = (40075016.686 * Math.cos(lat)) / 2 ** z / SIZE;
  // Exaggerate relief when zoomed out so hills stay visible.
  const zf = z >= 13 ? 1.5 : z >= 10 ? 2.5 : 4;
  const az = (315 * Math.PI) / 180;
  const alt = (45 * Math.PI) / 180;
  const flat = Math.sin(alt);
  const out = new Uint8ClampedArray(SIZE * SIZE * 4);
  const at = (i, j) => grid[Math.min(SIZE - 1, Math.max(0, j)) * SIZE + Math.min(SIZE - 1, Math.max(0, i))];
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      // Horn's method
      const dzdx = (at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1) - (at(i - 1, j - 1) + 2 * at(i - 1, j) + at(i - 1, j + 1))) / (8 * cell);
      const dzdy = (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1) - (at(i - 1, j - 1) + 2 * at(i, j - 1) + at(i + 1, j - 1))) / (8 * cell);
      const slope = Math.atan(zf * Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      let v = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - aspect);
      v = Math.max(0, v);
      const k = (j * SIZE + i) * 4;
      if (v < flat) {
        // shadow
        out[k + 3] = Math.min(150, ((flat - v) / flat) * 230);
      } else {
        // lit slope
        out[k] = 255;
        out[k + 1] = 255;
        out[k + 2] = 255;
        out[k + 3] = Math.min(90, ((v - flat) / (1 - flat)) * 160);
      }
    }
  }
  return out;
}

export const HillshadeLayer = L.GridLayer.extend({
  options: { tileSize: SIZE, opacity: 0.85, className: 'hillshade-layer', source: null, maxZoom: 19 },

  initialize(options) {
    L.GridLayer.prototype.initialize.call(this, options);
    this.missing = 0;
    this.loaded = 0;
  },

  createTile(coords, done) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    demGrid(this.options.source, coords.z, coords.x, coords.y)
      .then((grid) => {
        if (!grid) {
          this.missing += 1;
          this.fire('demstatus', { missing: this.missing, loaded: this.loaded });
          done(null, canvas);
          return;
        }
        this.loaded += 1;
        this.fire('demstatus', { missing: this.missing, loaded: this.loaded });
        const ctx = canvas.getContext('2d');
        ctx.putImageData(new ImageData(shade(grid, coords.z, coords.y), SIZE, SIZE), 0, 0);
        done(null, canvas);
      })
      .catch((err) => done(err, canvas));
    return canvas;
  },
});
