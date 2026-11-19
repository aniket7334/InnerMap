// A CesiumJS imagery provider that draws Inner Map's OpenStreetMap vector tiles onto the
// 3D globe. Tiles come from IndexedDB first (downloaded areas work with no internet), then
// from the Inner Map server - exactly like the 2D map. Rendering uses protomaps' painter
// with the same "light" style, so 2D and 3D look the same.
import { Credit, Event as CesiumEvent, Rectangle, WebMercatorTilingScheme } from 'cesium';
import { View, TileCache, PmtilesSource, Labelers, paint, paintRules, labelRules } from 'protomaps-leaflet';
import { namedFlavor } from '@protomaps/basemaps';
import { LocalFirstVectorSource } from '../maps/VectorTileLayer';
import { buildLabelRules } from '../typography/mapLabels';

const TILE = 256;
const LEVEL_DIFF = 1; // same as the 2D layer: display zoom z uses data zoom z-1 (512px data tiles)

export class VectorImageryProvider {
  /**
   * @param provider  the 'local-vector' entry from maps/providers.js
   * @param bounds    { south, west, north, east } where data can exist (server coverage)
   * @param typography optional typography settings for label size/font (typography/mapLabels.js)
   * @param style     'map' (full map, default) or 'labels' (roads + names only, transparent -
   *                  for laying over satellite imagery)
   */
  constructor(provider, bounds, typography, style = 'map') {
    const flavor = namedFlavor('light');
    this._labelsOnly = style === 'labels';
    this._paintRules = this._labelsOnly ? paintRules(flavor).filter((r) => r.dataLayer === 'roads') : paintRules(flavor);
    this._background = flavor.background;
    // PmtilesSource parses the raw tile bytes our source returns (any object with getZxy works).
    // shouldCancelZooms=false: Cesium loads several zoom levels at once, unlike Leaflet.
    const source = new PmtilesSource(new LocalFirstVectorSource(provider), false);
    this._view = new View(new TileCache(source, TILE * (1 << LEVEL_DIFF)), provider.maxDataZoom, LEVEL_DIFF);
    const scratch = document.createElement('canvas').getContext('2d');
    this._labelers = new Labelers(scratch, typography ? buildLabelRules(typography) : labelRules(flavor, 'en'), 16, () => {});

    // Properties CesiumJS reads from an imagery provider.
    this.tilingScheme = new WebMercatorTilingScheme();
    this.rectangle = bounds
      ? Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north)
      : this.tilingScheme.rectangle;
    this.tileWidth = TILE;
    this.tileHeight = TILE;
    this.minimumLevel = 0;
    this.maximumLevel = 19;
    this.tileDiscardPolicy = undefined;
    this.errorEvent = new CesiumEvent();
    this.credit = new Credit(
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Protomaps',
      true
    );
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
    const coords = { z: level, x, y };
    let prepared;
    try {
      prepared = await this._view.getDisplayTile(coords);
    } catch (err) {
      if (err?.name === 'AbortError') return canvas;
      throw err;
    }
    // No data for this tile (not downloaded and offline, or outside the data area):
    // return a transparent tile so the base globe imagery shows through.
    if (!prepared || !prepared.data || prepared.data.size === 0) return canvas;

    const tiles = new Map([['', [prepared]]]);
    this._labelers.add(level, tiles);
    const ctx = canvas.getContext('2d');
    if (!this._labelsOnly) {
      ctx.fillStyle = this._background;
      ctx.fillRect(0, 0, TILE, TILE);
    }
    const pad = 16;
    const bbox = { minX: TILE * x - pad, minY: TILE * y - pad, maxX: TILE * (x + 1) + pad, maxY: TILE * (y + 1) + pad };
    paint(ctx, level, tiles, this._labelers.getIndex(level), this._paintRules, bbox, { x: TILE * x, y: TILE * y }, false, '');
    return canvas;
  }
}
