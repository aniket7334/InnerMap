// Builds the offline search index of one downloaded area, in the background.
// Reads the area's vector tiles from IndexedDB (already on the device - no network),
// decodes them and stores every NAMED place, street and point of interest in the
// `places` store. Nothing is invented: only features that have a name in the data.
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { getDB } from '../offline/db';
import { readTileBytes } from '../offline/tileStore';
import { IGNORED_KINDS, categoryOf } from './categories';

const tile2lng = (x, z) => (x / 2 ** z) * 360 - 180;
const tile2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function nameOf(p) {
  return (p['name:en'] || p.name || '').trim();
}

/** One representative point of a feature in lat/lng. */
function pointOf(feature, z, x, y) {
  const rings = feature.loadGeometry();
  const ext = feature.extent;
  let pt;
  if (feature.type === 1) pt = rings[0][0];
  else if (feature.type === 2) {
    const line = rings.reduce((a, b) => (b.length > a.length ? b : a), rings[0]);
    pt = line[Math.floor(line.length / 2)];
  } else {
    // polygon: centre of the outer ring's bounding box
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of rings[0]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    pt = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }
  if (!pt) return null;
  const lng = tile2lng(x + pt.x / ext, z);
  const lat = tile2lat(y + pt.y / ext, z);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

self.onmessage = async (e) => {
  const { regionId, layerId, maxDataZoom } = e.data;
  try {
    const db = await getDB();
    const keys = (await db.getAllKeysFromIndex('tiles', 'regions', regionId)).filter((k) => String(k).startsWith(`${layerId}/`));
    const found = new Map();
    const add = (entry) => {
      if (!found.has(entry.key)) found.set(entry.key, entry);
    };

    let done = 0;
    for (const key of keys) {
      const [, zs, xs, ys] = String(key).split('/');
      const z = Number(zs);
      const x = Number(xs);
      const y = Number(ys);
      const rec = await db.get('tiles', key);
      done += 1;
      if (done % 100 === 0) self.postMessage({ type: 'progress', done, total: keys.length });
      if (!rec) continue;
      let tile;
      try {
        tile = new VectorTile(new Pbf(await readTileBytes(rec)));
      } catch {
        continue; // unreadable tile: skip
      }
      const detail = z >= maxDataZoom; // full-detail tiles hold every POI and street

      const places = tile.layers.places;
      if (places) {
        for (let i = 0; i < places.length; i += 1) {
          const f = places.feature(i);
          const p = f.properties;
          const name = nameOf(p);
          if (!name) continue;
          const pt = pointOf(f, z, x, y);
          if (!pt) continue;
          // Same place appears at several zooms: one entry per name+kind (~1 km cell).
          add({
            key: `${layerId}|places|${p.kind}|${name}|${pt.lat.toFixed(2)}|${pt.lng.toFixed(2)}`,
            name,
            layer: 'places',
            kind: p.kind,
            lat: pt.lat,
            lng: pt.lng,
            minZoom: p.min_zoom ?? null,
            population: p.population ?? null,
          });
        }
      }
      if (detail && tile.layers.pois) {
        const pois = tile.layers.pois;
        for (let i = 0; i < pois.length; i += 1) {
          const f = pois.feature(i);
          const p = f.properties;
          const name = nameOf(p);
          if (!name || IGNORED_KINDS.has(p.kind)) continue;
          const pt = pointOf(f, z, x, y);
          if (!pt) continue;
          add({
            key: `${layerId}|pois|${p.kind}|${name}|${pt.lat.toFixed(4)}|${pt.lng.toFixed(4)}`,
            name,
            layer: 'pois',
            kind: p.kind,
            lat: pt.lat,
            lng: pt.lng,
            minZoom: p.min_zoom ?? null,
            population: null,
          });
        }
      }
      if (detail && tile.layers.roads) {
        const roads = tile.layers.roads;
        for (let i = 0; i < roads.length; i += 1) {
          const f = roads.feature(i);
          const p = f.properties;
          const name = nameOf(p);
          if (!name || p.kind === 'rail' || p.kind === 'ferry') continue;
          const pt = pointOf(f, z, x, y);
          if (!pt) continue;
          // A long road is split over many tiles: keep one point per ~1 km of it.
          add({
            key: `${layerId}|roads|${p.kind}|${name}|${pt.lat.toFixed(2)}|${pt.lng.toFixed(2)}`,
            name,
            layer: 'roads',
            kind: p.kind,
            lat: pt.lat,
            lng: pt.lng,
            minZoom: p.min_zoom ?? null,
            population: null,
          });
        }
      }
      if (z <= 13 && tile.layers.water) {
        const water = tile.layers.water;
        for (let i = 0; i < water.length; i += 1) {
          const f = water.feature(i);
          const p = f.properties;
          const name = nameOf(p);
          if (!name) continue;
          const pt = pointOf(f, z, x, y);
          if (!pt) continue;
          add({
            key: `${layerId}|water|${p.kind}|${name}|${pt.lat.toFixed(1)}|${pt.lng.toFixed(1)}`,
            name,
            layer: 'water',
            kind: p.kind,
            lat: pt.lat,
            lng: pt.lng,
            minZoom: p.min_zoom ?? null,
            population: null,
          });
        }
      }
    }

    // Store, sharing entries with overlapping areas (reference-counted by region id).
    const entries = [...found.values()];
    const BATCH = 500;
    for (let i = 0; i < entries.length; i += BATCH) {
      const tx = db.transaction('places', 'readwrite');
      for (const entry of entries.slice(i, i + BATCH)) {
        const existing = await tx.store.get(entry.key);
        if (existing) {
          if (!existing.regions.includes(regionId)) existing.regions.push(regionId);
          await tx.store.put(existing);
        } else {
          await tx.store.put({
            ...entry,
            nameLower: entry.name.toLowerCase(),
            category: categoryOf(entry.layer, entry.kind),
            regions: [regionId],
          });
        }
      }
      await tx.done;
    }
    const counts = { places: 0, pois: 0, roads: 0, water: 0 };
    entries.forEach((en) => {
      counts[en.layer] += 1;
    });
    self.postMessage({ type: 'done', count: entries.length, counts, tiles: keys.length });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
