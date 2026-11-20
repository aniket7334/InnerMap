// Real 3D terrain for the Earth page from open elevation tiles ("terrarium" PNG: height =
// R*256 + G + B/256 - 32768 m; AWS Terrain Tiles, the same source as the 2D map's Terrain
// view - TERRAIN_SOURCE). Cesium asks for a grid of heights per (geographic) tile; we sample
// the matching web-mercator elevation tiles. Online only (tiles are not stored for the globe).
import { CustomHeightmapTerrainProvider, Credit, Math as CesiumMath } from 'cesium';
import { TERRAIN_SOURCE, buildTileUrl } from '../maps/providers';

const GRID = 32; // heights per tile side
const MAX_Z = 12; // finest elevation tiles we fetch (~30 m)
const cache = new Map(); // "z/x/y" -> Promise<Float32Array|null>
const order = [];

function elevationTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  const p = fetch(buildTileUrl(TERRAIN_SOURCE, z, x, y))
    .then((r) => (r.ok ? r.blob() : null))
    .then(async (blob) => {
      if (!blob) return null;
      const bmp = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      const px = ctx.getImageData(0, 0, 256, 256).data;
      const h = new Float32Array(256 * 256);
      for (let i = 0; i < h.length; i++) h[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      return h;
    })
    .catch(() => null);
  cache.set(key, p);
  order.push(key);
  while (order.length > 220) cache.delete(order.shift());
  return p;
}

function mercator(lngDeg, latDeg, z) {
  const n = 2 ** z;
  const lat = Math.max(-85.0511, Math.min(85.0511, latDeg));
  const x = ((lngDeg + 180) / 360) * n;
  const r = CesiumMath.toRadians(lat);
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return [x, y];
}

/**
 * @param exaggeration  vertical exaggeration (1 = true heights)
 */
export function createTerrariumTerrain(exaggeration = 1) {
  const provider = new CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    credit: new Credit('Elevation: Mapzen Terrain Tiles (SRTM, GMTED2010, ETOPO1)'),
    callback: async (x, y, level) => {
      const rect = provider.tilingScheme.tileXYToRectangle(x, y, level);
      const z = Math.min(MAX_Z, level + 1);
      const west = CesiumMath.toDegrees(rect.west);
      const east = CesiumMath.toDegrees(rect.east);
      const north = CesiumMath.toDegrees(rect.north);
      const south = CesiumMath.toDegrees(rect.south);
      // the elevation tiles this geographic tile covers
      const [x0, y0] = mercator(west, north, z);
      const [x1, y1] = mercator(east, south, z);
      const tiles = new Map();
      const n = 2 ** z;
      for (let ty = Math.floor(y0); ty <= Math.min(n - 1, Math.floor(y1)); ty++) {
        for (let tx = Math.floor(x0); tx <= Math.min(n - 1, Math.floor(x1)); tx++) tiles.set(`${tx}/${ty}`, elevationTile(z, tx, ty));
      }
      const loaded = new Map();
      await Promise.all([...tiles].map(async ([k, p]) => loaded.set(k, await p)));
      const out = new Float32Array(GRID * GRID);
      for (let j = 0; j < GRID; j++) {
        const lat = north + ((south - north) * j) / (GRID - 1);
        for (let i = 0; i < GRID; i++) {
          const lng = west + ((east - west) * i) / (GRID - 1);
          const [mx, my] = mercator(lng, lat, z);
          const tx = Math.min(n - 1, Math.floor(mx));
          const ty = Math.min(n - 1, Math.floor(my));
          const h = loaded.get(`${tx}/${ty}`);
          let v = 0;
          if (h) {
            const px = Math.min(255, Math.max(0, Math.floor((mx - tx) * 256)));
            const py = Math.min(255, Math.max(0, Math.floor((my - ty) * 256)));
            v = h[py * 256 + px];
          }
          out[j * GRID + i] = Math.max(-500, v) * exaggeration; // sea floor flattened near the coast
        }
      }
      return out;
    },
  });
  return provider;
}
let terrain = null;
/** The shared terrain provider (made once). */
export function terrariumTerrain() {
  if (!terrain) terrain = createTerrariumTerrain(1);
  return terrain;
}
