// Vector base layer: OpenStreetMap vector tiles drawn by protomaps-leaflet inside Leaflet,
// with place names, roads, water, parks and buildings.
//
// protomaps-leaflet accepts any object with getZxy(z, x, y, signal) as its tile source.
// Ours checks IndexedDB first, so downloaded areas render with no network at all:
//   1. Tile downloaded on this device?  -> decompress it from IndexedDB
//   2. Network available?               -> fetch it from the Inner Map server
//   3. Otherwise                        -> no data (the map shows a "Not downloaded" notice)
import { leafletLayer } from 'protomaps-leaflet';
import { vectorStyle } from '../typography/mapLabels';
import { tileKey } from './tileMath';
import { buildTileUrl } from './providers';
import { getTile, readTileBytes } from '../offline/tileStore';

// Counters for diagnostics (visible in the browser console as window.__innerMap.tileStats).
export const tileStats = { fromDevice: 0, fromNetwork: 0, missing: 0 };

// Also used by the 3D globe (src/globe/VectorImageryProvider.js).
export class LocalFirstVectorSource {
  constructor(provider) {
    this.provider = provider;
  }

  async getZxy(z, x, y, signal) {
    try {
      const rec = await getTile(tileKey(this.provider.layerId, z, x, y));
      if (rec) {
        tileStats.fromDevice += 1;
        return { data: await readTileBytes(rec) };
      }
    } catch (err) {
      console.warn('[vector] IndexedDB read failed', err);
    }

    if (navigator.onLine) {
      try {
        const res = await fetch(buildTileUrl(this.provider, z, x, y), { signal });
        if (res.ok && res.status !== 204) {
          tileStats.fromNetwork += 1;
          return { data: await res.arrayBuffer() };
        }
      } catch (err) {
        // A newer zoom level cancelled this request: let the library handle the abort.
        if (signal?.aborted) throw err;
      }
    }
    tileStats.missing += 1;
    return undefined; // drawn as empty background; MapView explains it with a notice
  }
}

/**
 * @param provider  vector provider definition
 * @param typography  optional typography settings: label size/family per category
 *                    (see typography/mapLabels.js). Without it the stock style is used.
 */
export function createVectorTileLayer(provider, typography) {
  return leafletLayer({
    url: new LocalFirstVectorSource(provider),
    ...vectorStyle(typography),
    lang: 'en',
    maxDataZoom: provider.maxDataZoom,
    minZoom: provider.minZoom,
    maxZoom: provider.maxZoom,
    attribution: provider.attribution,
  });
}
