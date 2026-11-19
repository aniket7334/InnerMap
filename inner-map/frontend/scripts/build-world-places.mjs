// Builds frontend/public/data/places/*.json - names of towns and villages worldwide, shown on the
// 3D Earth when you zoom in to a region (bigger cities are in world-labels.json).
//
//   node scripts/build-world-places.mjs              (downloads cities500.zip once)
//   node scripts/build-world-places.mjs --src=DIR    (uses an already extracted cities500.txt)
//
// Source: GeoNames "cities500" - every populated place with 500 or more people
// (https://download.geonames.org/export/dump/), licence CC BY 4.0 - credited on the globe.
// Output: one small file per 4°x4° area, "<lat>_<lng>.json" named by its south-west corner, so the
// app loads only the areas in view (and the service worker keeps visited ones for offline use).
// Each place: [name, lng, lat, population, kind]  kind: 0 town, 1 village/locality, 2 suburb/district.
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'data', 'places');
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const src = args.src || join(tmpdir(), 'innermap-geonames');
const TILE = 4; // degrees
const MAX_POP = 15000; // bigger places are already in world-labels.json (GeoNames cities15000)

async function ensureSource() {
  const txt = join(src, 'cities500.txt');
  if (existsSync(txt)) return txt;
  mkdirSync(src, { recursive: true });
  const zip = join(src, 'cities500.zip');
  if (!existsSync(zip)) {
    console.log('downloading cities500.zip from GeoNames…');
    const res = await fetch('https://download.geonames.org/export/dump/cities500.zip');
    if (!res.ok) throw new Error(`GeoNames: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  }
  // Unzip: Windows' own tar (bsdtar) reads zip files; elsewhere use unzip.
  // (run inside the folder with a bare file name: some tars read "C:\..." as a remote host)
  if (process.platform === 'win32') {
    execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', 'cities500.zip'], { cwd: src, stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-o', 'cities500.zip'], { cwd: src, stdio: 'inherit' });
  }
  return txt;
}

// GeoNames feature codes -> kind
const SUBURB = new Set(['PPLX', 'PPLA4']);
const VILLAGE = new Set(['PPLL', 'PPLF', 'PPLR', 'PPLS', 'PPLW']);

const r4 = (v) => Math.round(v * 10000) / 10000;
const file = await ensureSource();
const lines = readFileSync(file, 'utf8').split('\n');
const tiles = new Map();
let count = 0;
for (const line of lines) {
  if (!line) continue;
  const f = line.split('\t');
  const name = (f[1] || '').trim();
  const lat = Number(f[4]);
  const lng = Number(f[5]);
  const code = f[7];
  const pop = Number(f[14]) || 0;
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || pop >= MAX_POP) continue;
  if (code === 'PPLH' || code === 'PPLQ' || code === 'PPLCH') continue; // historical / abandoned
  const kind = SUBURB.has(code) ? 2 : VILLAGE.has(code) || pop < 2000 ? 1 : 0;
  const key = `${Math.floor(lat / TILE) * TILE}_${Math.floor(lng / TILE) * TILE}`;
  if (!tiles.has(key)) tiles.set(key, []);
  tiles.get(key).push([name, r4(lng), r4(lat), pop, kind]);
  count++;
}

if (existsSync(outDir)) for (const f of readdirSync(outDir)) if (f.endsWith('.json')) rmSync(join(outDir, f));
mkdirSync(outDir, { recursive: true });
let bytes = 0;
for (const [key, list] of tiles) {
  list.sort((a, b) => b[3] - a[3]); // biggest first
  const json = JSON.stringify(list);
  bytes += json.length;
  writeFileSync(join(outDir, `${key}.json`), json);
}
writeFileSync(
  join(outDir, 'index.json'),
  JSON.stringify({ source: 'GeoNames cities500 (CC BY 4.0)', tile: TILE, built: new Date().toISOString().slice(0, 10), tiles: [...tiles.keys()].sort() })
);
console.log(`wrote ${count} places in ${tiles.size} area files (${(bytes / 1e6).toFixed(1)} MB) to ${outDir}`);
