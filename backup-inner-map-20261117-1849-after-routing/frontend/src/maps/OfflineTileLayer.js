// A Leaflet tile layer that reads tiles from IndexedDB first.
//
// For every tile Leaflet asks for:
//   1. Downloaded tile in IndexedDB?          -> show it (works with no internet)
//   2. Online?                                 -> load it from the tile server as usual
//   3. Offline, but a lower-zoom ancestor tile
//      was downloaded?                         -> crop + upscale that ancestor ("overzoom")
//   4. Nothing available                       -> show a clear "Not downloaded" placeholder
//
// So the map never pretends to have coverage for areas that were not downloaded.
import L from 'leaflet';
import { tileKey } from './tileMath';
import { getTile } from '../offline/tileStore';
import { isOnline } from '../offline/connectivity';

const MAX_OVERZOOM = 5;
let placeholderUrl = null;

function getPlaceholder(size) {
  if (placeholderUrl) return placeholderUrl;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8ecef';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#d3d9de';
  ctx.lineWidth = 1;
  for (let i = -size; i < size; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, size);
    ctx.lineTo(i + size, 0);
    ctx.stroke();
  }
  ctx.strokeStyle = '#c4ccd3';
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  ctx.fillStyle = '#7b8794';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Not downloaded', size / 2, size / 2 - 4);
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('No offline data here', size / 2, size / 2 + 14);
  placeholderUrl = c.toDataURL('image/png');
  return placeholderUrl;
}

async function blobFromAncestor(layerId, coords, size) {
  for (let dz = 1; dz <= MAX_OVERZOOM && coords.z - dz >= 0; dz += 1) {
    const factor = 2 ** dz;
    const px = Math.floor(coords.x / factor);
    const py = Math.floor(coords.y / factor);
    const rec = await getTile(tileKey(layerId, coords.z - dz, px, py));
    if (rec) {
      const bitmap = await createImageBitmap(rec.blob);
      const sub = bitmap.width / factor;
      const sx = (coords.x % factor) * sub;
      const sy = (coords.y % factor) * sub;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bitmap, sx, sy, sub, sub, 0, 0, size, size);
      bitmap.close?.();
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }
  }
  return null;
}

export const OfflineTileLayer = L.TileLayer.extend({
  options: {
    layerId: null, // provider.layerId: the IndexedDB key prefix for this provider's tiles
  },

  initialize(url, options) {
    L.TileLayer.prototype.initialize.call(this, url, options);
    this.on('tileunload', (e) => this._releaseTile(e.tile));
  },

  createTile(coords, done) {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');
    tile.decoding = 'async';
    this._loadTile(tile, coords, done);
    return tile;
  },

  _releaseTile(tile) {
    if (tile && tile._objectUrl) {
      URL.revokeObjectURL(tile._objectUrl);
      tile._objectUrl = null;
    }
  },

  _showBlob(tile, blob, done) {
    const url = URL.createObjectURL(blob);
    tile._objectUrl = url;
    tile.onload = () => done(null, tile);
    tile.onerror = () => this._showFallback(tile, tile._coords, done);
    tile.src = url;
  },

  async _showFallback(tile, coords, done) {
    try {
      const blob = coords ? await blobFromAncestor(this.options.layerId, coords, this.getTileSize().x) : null;
      if (blob) {
        tile.classList.add('tile-overzoomed');
        this._showBlob(tile, blob, done);
        return;
      }
    } catch {
      /* fall through to placeholder */
    }
    tile.classList.add('tile-missing');
    tile.onload = () => done(null, tile);
    tile.onerror = () => done(null, tile);
    tile.src = getPlaceholder(this.getTileSize().x);
  },

  async _loadTile(tile, coords, done) {
    tile._coords = coords;
    const key = tileKey(this.options.layerId, coords.z, coords.x, coords.y);
    let rec = null;
    try {
      rec = await getTile(key);
    } catch (err) {
      console.warn('[tiles] IndexedDB read failed', err);
    }

    if (rec) {
      tile.classList.add('tile-offline');
      this._showBlob(tile, rec.blob, done);
      return;
    }

    if (isOnline() && navigator.onLine) {
      tile.onload = () => done(null, tile);
      // Network failed (e.g. connection dropped) -> try offline fallbacks instead.
      tile.onerror = () => this._showFallback(tile, coords, done);
      tile.src = this.getTileUrl(coords);
      return;
    }

    this._showFallback(tile, coords, done);
  },
});

/** Raster (PNG/JPEG) base layer for a provider from maps/providers.js. */
export function createOfflineTileLayer(provider) {
  return new OfflineTileLayer(provider.url, {
    attribution: provider.attribution,
    minZoom: provider.minZoom,
    maxZoom: provider.maxZoom,
    maxNativeZoom: provider.maxDataZoom,
    subdomains: provider.subdomains.length ? provider.subdomains : 'abc',
    layerId: provider.layerId,
  });
}
