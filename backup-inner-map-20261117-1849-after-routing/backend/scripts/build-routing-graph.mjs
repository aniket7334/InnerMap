// Builds the offline road-routing graph for an area from OpenStreetMap data.
//
//   node scripts/build-routing-graph.mjs --name=mumbai --bbox=72.75,18.85,73.10,19.35
//
// 1. Downloads routable ways (highway=*) inside the box from an Overpass API server, in a few
//    smaller cells (kinder to the shared server), with retries. Raw responses are cached in
//    data/.osm-cache so a rebuild does not download again.
// 2. Builds the graph (junctions, edges with length, one-way and access rules, speed, name,
//    shape) with shared/routing/graph.mjs - the same code the browser uses.
// 3. Writes data/<name>.routing.json.gz, which the backend serves at /api/routing/graph.
//
// Data: © OpenStreetMap contributors, ODbL. Overpass public servers allow light use only
// (see https://wiki.openstreetmap.org/wiki/Overpass_API); this is a one-off download.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph } from '../../shared/routing/graph.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const cacheDir = join(dataDir, '.osm-cache');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);
const name = String(args.name || 'mumbai').replace(/[^a-z0-9-]/gi, '');
const [west, south, east, north] = String(args.bbox || '72.75,18.85,73.10,19.35').split(',').map(Number);
const grid = Number(args.grid || 2);
const servers = String(
  args.overpass ||
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter,https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter'
).split(',');
const USER_AGENT = 'InnerMap-routing-graph-builder/1.0 (self-hosted, one-off download)';

const HIGHWAYS =
  'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|' +
  'unclassified|residential|living_street|service|road|track|pedestrian|footway|path|cycleway|steps|bridleway';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  let wait = 15000;
  // Public servers are often overloaded: keep trying for a while (finished cells are cached,
  // so if it still fails, simply run the script again - it continues where it stopped).
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const server = servers[attempt % servers.length];
    try {
      const res = await fetch(server, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(300000),
      });
      if (res.ok) return await res.json();
      console.warn(`  ${server}: HTTP ${res.status}, retrying in ${wait / 1000}s`);
    } catch (err) {
      console.warn(`  ${server}: ${err.message}, retrying in ${wait / 1000}s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 120000);
  }
  throw new Error('All Overpass servers failed. Try again later.');
}

async function main() {
  mkdirSync(cacheDir, { recursive: true });
  console.log(`[routing] Building "${name}" for bbox ${west},${south},${east},${north} (${grid}x${grid} cells)`);
  const ways = new Map();
  const dLat = (north - south) / grid;
  const dLon = (east - west) / grid;
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      const s = south + i * dLat;
      const w = west + j * dLon;
      const cellBox = [s, w, s + dLat, w + dLon].map((v) => v.toFixed(5));
      const cacheFile = join(cacheDir, `${name}-${cellBox.join('_')}.json.gz`);
      let data;
      if (existsSync(cacheFile)) {
        data = JSON.parse(gunzipSync(readFileSync(cacheFile)).toString('utf8'));
        console.log(`  cell ${i},${j}: from cache (${data.elements.length} ways)`);
      } else {
        const q = `[out:json][timeout:240];way["highway"~"^(${HIGHWAYS})$"](${cellBox.join(',')});out body geom qt;`;
        const t = Date.now();
        data = await overpass(q);
        writeFileSync(cacheFile, gzipSync(JSON.stringify(data)));
        console.log(`  cell ${i},${j}: ${data.elements.length} ways in ${Math.round((Date.now() - t) / 1000)}s`);
        await sleep(5000); // be polite between queries
      }
      for (const el of data.elements) if (el.type === 'way') ways.set(el.id, el);
    }
  }

  console.log(`[routing] ${ways.size} unique ways, building graph...`);
  const graph = buildGraph([...ways.values()], {
    bounds: { south, west, north, east },
    source: 'OpenStreetMap (Overpass API)',
    license: '© OpenStreetMap contributors, ODbL 1.0',
    builtAt: new Date().toISOString(),
    name,
  });
  const json = JSON.stringify(graph);
  const out = join(dataDir, `${name}.routing.json.gz`);
  writeFileSync(out, gzipSync(json, { level: 9 }));
  console.log(
    `[routing] ${graph.nodeId.length} junctions, ${graph.edgeA.length} road segments, ` +
      `${graph.names.length} names -> ${out} (${(readFileSync(out).length / 1048576).toFixed(1)} MB gzip, ` +
      `${(json.length / 1048576).toFixed(1)} MB raw)`
  );
}

main().catch((err) => {
  console.error('[routing] Failed:', err.message);
  process.exit(1);
});
