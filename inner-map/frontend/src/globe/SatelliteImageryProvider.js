// CesiumJS imagery provider for the licensed satellite source (SATELLITE_SOURCE, by default
// EOX Sentinel-2 cloudless). Tiles downloaded as an offline "satellite pack" are read from
// IndexedDB first; otherwise they are fetched when online. Where neither is possible the tile is
// transparent, so the built-in Natural Earth imagery underneath shows (never a fake picture).
import { Credit, Event as CesiumEvent, WebMercatorTilingScheme } from 'cesium';
import { getTile } from '../offline/tileStore';
import { tileKey } from '../maps/tileMath';
import { buildTileUrl, SATELLITE_SOURCE } from '../maps/providers';
import { isOnline } from '../offline/connectivity';

const TILE = 256;

function blank() {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  return c;
}

export class SatelliteImageryProvider {
  constructor(source = SATELLITE_SOURCE) {
    this._source = source;
    this.tilingScheme = new WebMercatorTilingScheme();
    this.rectangle = this.tilingScheme.rectangle;
    this.tileWidth = TILE;
    this.tileHeight = TILE;
    this.minimumLevel = 0;
    // Deeper levels are drawn from the deepest real tiles by Cesium itself.
    this.maximumLevel = source.maxDataZoom;
    this.tileDiscardPolicy = undefined;
    this.errorEvent = new CesiumEvent();
    this.credit = new Credit(source.attribution, true);
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
    let blob = null;
    try {
      const rec = await getTile(tileKey(this._source.layerId, level, x, y));
      if (rec) blob = rec.blob;
    } catch {
      /* storage unavailable */
    }
    if (!blob && isOnline() && navigator.onLine) {
      try {
        const res = await fetch(buildTileUrl(this._source, level, x, y), { credentials: 'omit' });
        if (res.ok) blob = await res.blob();
      } catch {
        /* network failed */
      }
    }
    if (!blob) return blank();
    try {
      // Cesium uploads ImageBitmaps as if already flipped; a canvas is drawn the right way up
      // (the same as the vector layer).
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close?.();
      return canvas;
    } catch {
      return blank();
    }
  }
}
