// Road data (offline routing graphs) for the server's map areas.
//
// Map tiles of a city come from the Protomaps build (areaService). Offline directions need a
// separate road network (one-way streets, access rules, speeds), which is built from
// OpenStreetMap with scripts/build-routing-graph.mjs - the same builder as data/mumbai.routing.json.gz.
// This service builds it for every map area automatically:
//   - after a new area is prepared,
//   - and once at start-up for areas that do not have it yet.
// An area marked "skipped" in roads.json is left out of the automatic builds (a manual request
// through POST /api/routing/areas/:id/build still builds it).
// One build at a time, in a separate process; raw downloads are cached in data/.osm-cache.
// Output: data/areas/<area id>.routing.json.gz, status in data/areas/roads.status (JSON; not a
// .json file on purpose: `npm run dev` (nodemon) restarts the server when a .json file changes,
// which would stop a build half-way).
// Data: © OpenStreetMap contributors (ODbL), via the Overpass API (light, one-off use per area).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config/env');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'build-routing-graph.mjs');
const MAX_ATTEMPTS = 2; // automatic tries per area (a manual request always tries again)

const statusFile = () => path.join(config.vectorAreasDir, 'roads.status');
const oldStatusFile = () => path.join(config.vectorAreasDir, 'roads.json'); // earlier name, read once
const graphFile = (id) => path.join(config.vectorAreasDir, `${id}.routing.json.gz`);

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function readStatus() {
  return readJson(statusFile(), null) || readJson(oldStatusFile(), {});
}
function writeStatus(st) {
  fs.mkdirSync(config.vectorAreasDir, { recursive: true });
  fs.writeFileSync(statusFile(), JSON.stringify(st, null, 2));
}
function registryAreas() {
  return readJson(path.join(config.vectorAreasDir, 'areas.json'), { areas: [] }).areas || [];
}

const queue = [];
let running = null; // { id, name, progress, cells, done, startedAt }

/** Cells of ~0.15° per side, so each Overpass query stays small. */
function gridFor(b) {
  const span = Math.max(b.east - b.west, b.north - b.south);
  return Math.max(1, Math.min(8, Math.ceil(span / 0.15)));
}

function runNext() {
  if (running || !queue.length) return;
  const id = queue.shift();
  const area = registryAreas().find((a) => a.id === id);
  if (!area) return runNext();
  if (readStatus()[id]?.status === 'skipped') return runNext();
  const b = area.bounds;
  const grid = gridFor(b);
  const out = graphFile(id);
  const tmp = `${out}.tmp`;
  running = { id, name: area.name, cells: grid * grid, done: 0, startedAt: Date.now() };
  const st = readStatus();
  st[id] = { ...(st[id] || {}), status: 'building', startedAt: new Date().toISOString(), attempts: (st[id]?.attempts || 0) + 1, error: null };
  writeStatus(st);
  console.log(`[roads] building road data for ${area.name} (${id}), ${grid}x${grid} cells`);
  const child = spawn(process.execPath, [SCRIPT, `--name=${id}`, `--bbox=${b.west},${b.south},${b.east},${b.north}`, `--grid=${grid}`, `--out=${tmp}`], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let tail = '';
  const onData = (d) => {
    const text = d.toString();
    tail = (tail + text).slice(-2000);
    const cells = text.match(/cell \d+,\d+:/g);
    if (cells && running) running.done = Math.min(running.cells, running.done + cells.length);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('close', (code) => {
    const s = readStatus();
    if (code === 0 && fs.existsSync(tmp)) {
      fs.renameSync(tmp, out);
      s[id] = { status: 'ready', builtAt: new Date().toISOString(), bytes: fs.statSync(out).size, attempts: s[id]?.attempts || 1 };
      console.log(`[roads] ${area.name}: ready (${(s[id].bytes / 1048576).toFixed(1)} MB)`);
    } else {
      fs.rmSync(tmp, { force: true });
      const msg = (tail.match(/Failed:.*$/m) || [])[0] || `builder exited with code ${code}`;
      s[id] = { ...(s[id] || {}), status: 'failed', error: msg.slice(0, 300) };
      console.warn(`[roads] ${area.name}: failed - ${msg}`);
    }
    writeStatus(s);
    running = null;
    runNext();
  });
  return undefined;
}

/** Queue a build for a map area (no-op when ready, queued or building). */
function requestBuild(id, { manual = false } = {}) {
  const area = registryAreas().find((a) => a.id === id);
  if (!area) return { error: 'Unknown map area.', status: 404 };
  const st = readStatus()[id];
  if (fs.existsSync(graphFile(id))) return { state: 'ready' };
  if (running?.id === id || queue.includes(id)) return { state: 'building' };
  if (!manual && st?.status === 'skipped') return { state: 'skipped' };
  if (!manual && st?.status === 'failed' && (st.attempts || 0) >= MAX_ATTEMPTS) return { state: 'failed', error: st.error };
  queue.push(id);
  const s = readStatus();
  s[id] = { ...(s[id] || {}), status: 'queued', error: null };
  writeStatus(s);
  runNext();
  return { state: 'queued' };
}

/** At start-up: build road data for map areas that do not have it yet (ROUTING_AUTO_BUILD=off to skip). */
function backfill() {
  if (String(process.env.ROUTING_AUTO_BUILD || 'on').toLowerCase() === 'off') return;
  for (const a of registryAreas()) {
    const st = readStatus()[a.id];
    // an earlier run stopped half-way because the server restarted: not the area's fault - try
    // again from scratch (downloaded pieces are cached, so it continues where it stopped)
    if (st?.status === 'building' || st?.status === 'queued' || (st?.status === 'failed' && /Interrupted/.test(st.error || ''))) {
      const s = readStatus();
      s[a.id] = { ...st, status: 'failed', attempts: 0, error: 'Interrupted (the server restarted).' };
      writeStatus(s);
    }
    requestBuild(a.id);
  }
}

/** Road data of every map area: [{ id, name, bounds, status, bytes, progress, error }]. */
function list() {
  const st = readStatus();
  return registryAreas().map((a) => {
    const ready = fs.existsSync(graphFile(a.id));
    const s = st[a.id] || {};
    return {
      id: a.id,
      name: a.name,
      bounds: a.bounds,
      status: ready ? 'ready' : running?.id === a.id ? 'building' : queue.includes(a.id) ? 'queued' : s.status === 'failed' || s.status === 'skipped' ? s.status : 'missing',
      bytes: ready ? fs.statSync(graphFile(a.id)).size : null,
      progress: running?.id === a.id ? running.done / running.cells : null,
      error: s.status === 'failed' ? s.error : null,
    };
  });
}

/** Ready graphs of map areas: [{ id, file, bounds }]. */
function readyGraphs() {
  return registryAreas()
    .filter((a) => fs.existsSync(graphFile(a.id)))
    .map((a) => ({ id: a.id, name: a.name, file: graphFile(a.id), bounds: a.bounds }));
}

module.exports = { requestBuild, backfill, list, readyGraphs };
