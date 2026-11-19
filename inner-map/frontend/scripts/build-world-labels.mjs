// Builds frontend/public/data/world-labels.json - the names shown on the 3D Earth everywhere
// in the world (countries, states/provinces, cities and towns, oceans/seas/bays).
//
//   node scripts/build-world-labels.mjs            (downloads the source files once)
//   node scripts/build-world-labels.mjs --src=DIR  (uses already downloaded .geojson files)
//
// Source: Natural Earth (https://www.naturalearthdata.com), public domain - no attribution
// required, free for any use. Files from github.com/nvkelso/natural-earth-vector.
// Output is compact: one array per name, coordinates rounded to ~100 m.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'data', 'world-labels.json');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const src = args.src || join(tmpdir(), 'innermap-natural-earth');
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const FILES = {
  cities: 'ne_10m_populated_places_simple',
  countries: 'ne_50m_admin_0_countries',
  states: 'ne_10m_admin_1_label_points',
  marine: 'ne_10m_geography_marine_polys',
};

async function load(name) {
  const file = join(src, `${name}.geojson`);
  if (!existsSync(file)) {
    mkdirSync(src, { recursive: true });
    console.log(`downloading ${name}…`);
    const res = await fetch(`${BASE}/${name}.geojson`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(readFileSync(file, 'utf8')).features;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const clean = (s) => String(s || '').trim();

// ---- point inside a polygon, far from its edges (for sea / bay names) ---------------------
function ringsOf(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
function inside(pt, rings) {
  let inPoly = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inPoly = !inPoly;
    }
  }
  return inPoly;
}
function edgeDist(pt, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(pt[0] - (ax + t * dx), pt[1] - (ay + t * dy)));
    }
  }
  return best;
}
function labelPoint(geom) {
  // the largest polygon part, then a grid search for the most "inside" point
  const parts = ringsOf(geom);
  let part = parts[0];
  let bestArea = -1;
  for (const p of parts) {
    let xs = Infinity;
    let xe = -Infinity;
    let ys = Infinity;
    let ye = -Infinity;
    for (const [x, y] of p[0]) {
      xs = Math.min(xs, x);
      xe = Math.max(xe, x);
      ys = Math.min(ys, y);
      ye = Math.max(ye, y);
    }
    const area = (xe - xs) * (ye - ys);
    if (area > bestArea) {
      bestArea = area;
      part = p;
    }
  }
  let xs = Infinity;
  let xe = -Infinity;
  let ys = Infinity;
  let ye = -Infinity;
  for (const [x, y] of part[0]) {
    xs = Math.min(xs, x);
    xe = Math.max(xe, x);
    ys = Math.min(ys, y);
    ye = Math.max(ye, y);
  }
  let best = null;
  const N = 36;
  for (let i = 0; i <= N; i += 1) {
    for (let j = 0; j <= N; j += 1) {
      const pt = [xs + ((xe - xs) * i) / N, ys + ((ye - ys) * j) / N];
      if (!inside(pt, part)) continue;
      const d = edgeDist(pt, part);
      if (!best || d > best.d) best = { pt, d };
    }
  }
  return best ? best.pt : [(xs + xe) / 2, (ys + ye) / 2];
}

async function main() {
  const [cities, countries, states, marine] = await Promise.all(Object.values(FILES).map(load));

  // countries: [name, lng, lat, rank]  (rank: Natural Earth LABELRANK, 1 = most prominent)
  const C = countries
    .map((f) => f.properties)
    .filter((p) => clean(p.NAME) && Number.isFinite(p.LABEL_X))
    // short common name ("China", "Czechia"); the long form only where the short one is abbreviated ("Dem. Rep. Congo")
    .map((p) => [clean(/\./.test(p.NAME) ? p.NAME_LONG || p.NAME_EN : p.NAME), r3(p.LABEL_X), r3(p.LABEL_Y), p.LABELRANK ?? 5]);

  // states/provinces: [name, lng, lat, rank, country]  (skip aggregations and tiny islands)
  const seen = new Set();
  const S = [];
  for (const f of states) {
    const p = f.properties;
    if (p.featurecla !== 'Admin-1 scale rank' || !clean(p.name)) continue;
    const key = `${p.name}|${p.admin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [lng, lat] = f.geometry.coordinates;
    S.push([clean(p.name), r3(lng), r3(lat), p.scalerank ?? 8, clean(p.admin)]);
  }

  // cities and towns: [name, lng, lat, rank, population, kind] kind: 2 = national capital, 1 = state capital
  const P = cities
    .map((f) => f.properties)
    .filter((p) => clean(p.name))
    .map((p) => [
      clean(p.name),
      r3(p.longitude),
      r3(p.latitude),
      p.scalerank ?? 10,
      p.pop_max > 0 ? p.pop_max : 0,
      p.adm0cap ? 2 : /Admin-1 capital/.test(p.featurecla || '') ? 1 : 0,
    ])
    .sort((a, b) => a[3] - b[3] || b[4] - a[4]);

  // oceans, seas, bays, gulfs, straits…: [name, lng, lat, rank, kind]
  const M = marine
    .filter((f) => clean(f.properties.name))
    .map((f) => {
      const [lng, lat] = labelPoint(f.geometry);
      return [clean(f.properties.name_en || f.properties.name), r3(lng), r3(lat), f.properties.scalerank ?? 5, f.properties.featurecla];
    });

  // more towns: GeoNames "cities15000" (every place with 15,000+ people, CC BY 4.0, attribution
  // shown on the Earth). Get it from https://download.geonames.org/export/dump/cities15000.zip and
  // unzip cities15000.txt into the --src folder. Skipped (with a note) when the file is missing.
  const gnFile = join(src, 'cities15000.txt');
  let towns = 0;
  if (existsSync(gnFile)) {
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const grid = new Map();
    const cell = (lng, lat) => `${Math.floor(lng * 10)},${Math.floor(lat * 10)}`;
    const addToGrid = (c) => {
      const k = cell(c[1], c[2]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
    };
    P.forEach(addToGrid);
    const near = (lng, lat, name) => {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const c of grid.get(cell(lng + dx / 10, lat + dy / 10)) || []) {
            const d = Math.hypot(c[1] - lng, c[2] - lat);
            if (d < 0.02 || (d < 0.12 && norm(c[0]) === name)) return true; // same place
          }
        }
      }
      return false;
    };
    const rows = readFileSync(gnFile, 'utf8')
      .split('\n')
      .map((l) => l.split('\t'))
      .filter((r) => r.length > 14 && clean(r[1]))
      .map((r) => ({ name: clean(r[1]), lat: Number(r[4]), lng: Number(r[5]), code: r[7], pop: Number(r[14]) || 0 }))
      .sort((a, b) => b.pop - a.pop);
    for (const t of rows) {
      if (t.code === 'PPLH' || t.code === 'PPLW' || t.code === 'PPLQ') continue; // historical / destroyed / abandoned
      if (near(t.lng, t.lat, norm(t.name))) continue;
      const rank = t.code === 'PPLX' ? 11 : t.pop >= 500000 ? 7 : t.pop >= 200000 ? 8 : t.pop >= 80000 ? 9 : t.pop >= 40000 ? 10 : 11;
      const c = [t.name, r3(t.lng), r3(t.lat), rank, t.pop, 0];
      P.push(c);
      addToGrid(c);
      towns += 1;
    }
    P.sort((a, b) => a[3] - b[3] || b[4] - a[4]);
  } else {
    console.log(`note: ${gnFile} not found - only Natural Earth cities are included`);
  }

  const data = {
    source: 'Natural Earth (public domain) - naturalearthdata.com' + (towns ? '; GeoNames (CC BY 4.0) - geonames.org' : ''),
    builtAt: new Date().toISOString().slice(0, 10),
    countries: C,
    states: S,
    cities: P.map(([n, x, y, rank, , kind]) => [n, x, y, rank, kind]), // [name, lng, lat, rank, kind]
    marine: M,
  };
  mkdirSync(dirname(out), { recursive: true });
  const json = JSON.stringify(data);
  writeFileSync(out, json);
  console.log(`countries ${C.length}, states ${S.length}, cities ${P.length} (${towns} from GeoNames), seas ${M.length} -> ${out} (${(json.length / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
