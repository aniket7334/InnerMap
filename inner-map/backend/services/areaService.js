// Offline map areas for other cities: keeps the list of extracted areas
// (data/areas/areas.json + one .pmtiles file each) and runs extraction jobs one at a time.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');
const { extractArea, countTiles } = require('./areaExtractService');
const pmtiles = require('./pmtilesService');

// One city or metro region per area: up to about 110 x 110 km (~100-250 MB of map data).
const MAX_SPAN_DEG = 1.0;
const MAX_TILES = 60000;

const registryFile = () => path.join(config.vectorAreasDir, 'areas.json');

function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(registryFile(), 'utf8'));
  } catch {
    return { areas: [] };
  }
}

function writeRegistry(reg) {
  fs.mkdirSync(config.vectorAreasDir, { recursive: true });
  fs.writeFileSync(registryFile(), JSON.stringify(reg, null, 2));
}

/** id -> display name, for the coverage info. */
function areaNames() {
  return Object.fromEntries(readRegistry().areas.map((a) => [a.id, a.name]));
}

const jobs = new Map(); // id -> job
const queue = [];
let running = null;

function publicJob(j) {
  return {
    id: j.id,
    areaId: j.areaId,
    name: j.name,
    bounds: j.bounds,
    status: j.status, // queued | running | done | failed
    phase: j.phase,
    progress: j.progress,
    error: j.error || null,
    result: j.result || null,
    createdAt: j.createdAt,
  };
}

function slug(name) {
  const s = String(name || 'area')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return s || 'area';
}

function validate(bounds) {
  const b = bounds || {};
  const nums = ['west', 'south', 'east', 'north'].map((k) => Number(b[k]));
  if (!nums.every(Number.isFinite)) return 'Area bounds are missing.';
  const [west, south, east, north] = nums;
  if (west < -180 || east > 180 || south < -85 || north > 85 || west >= east || south >= north) return 'Area bounds are not valid.';
  if (east - west > MAX_SPAN_DEG || north - south > MAX_SPAN_DEG) {
    return `Choose a smaller area: one city at a time (at most ${MAX_SPAN_DEG}° ≈ 110 km across).`;
  }
  if (countTiles({ west, south, east, north }) > MAX_TILES) return 'Choose a smaller area.';
  return null;
}

/** Already fully inside an area the server has? */
function coveredBy(bounds, areas) {
  return areas.find(
    (a) => bounds.west >= a.bounds.west && bounds.east <= a.bounds.east && bounds.south >= a.bounds.south && bounds.north <= a.bounds.north
  );
}

async function runNext() {
  if (running || !queue.length) return;
  running = queue.shift();
  const job = running;
  job.status = 'running';
  try {
    const outFile = path.join(config.vectorAreasDir, `${job.areaId}.pmtiles`);
    job.result = await extractArea({
      bounds: job.bounds,
      outFile,
      name: job.name,
      onProgress: (p) => {
        job.phase = p.phase;
        job.progress = p.total ? Math.min(1, p.done / p.total) : 0;
      },
    });
    const reg = readRegistry();
    reg.areas = reg.areas.filter((a) => a.id !== job.areaId);
    reg.areas.push({
      id: job.areaId,
      name: job.name,
      bounds: job.bounds,
      build: job.result.build,
      tiles: job.result.tiles,
      bytes: job.result.bytes,
      createdAt: new Date().toISOString(),
      createdBy: job.userId,
    });
    writeRegistry(reg);
    await pmtiles.closeArchive(outFile); // re-read the new file
    job.status = 'done';
    job.progress = 1;
    // offline directions: build this area's road data next (in the background)
    require('./roadDataService').requestBuild(job.areaId);
  } catch (err) {
    job.status = 'failed';
    job.error = `Could not get the map data: ${err.message}`;
    console.error('[areas] extract failed', job.name, err);
  } finally {
    running = null;
    runNext();
  }
}

/**
 * Queues an extraction. Returns { job } or { error, status }.
 */
async function requestArea({ name, bounds, userId }) {
  const err = validate(bounds);
  if (err) return { error: err, status: 400 };
  const b = {
    west: Math.round(Number(bounds.west) * 1e5) / 1e5,
    south: Math.round(Number(bounds.south) * 1e5) / 1e5,
    east: Math.round(Number(bounds.east) * 1e5) / 1e5,
    north: Math.round(Number(bounds.north) * 1e5) / 1e5,
  };
  const info = await pmtiles.getInfo(config.vectorTilesFile, config.vectorAreasDir, areaNames());
  const existing = coveredBy(b, info.areas || []);
  if (existing) return { existing };
  // Same area already being prepared?
  for (const j of jobs.values()) {
    if ((j.status === 'queued' || j.status === 'running') && coveredBy(b, [{ bounds: j.bounds }])) return { job: publicJob(j) };
  }
  if (queue.length >= 5) return { error: 'The server is busy preparing other areas. Try again in a few minutes.', status: 429 };
  const cleanName = String(name || '').trim().slice(0, 80) || 'Map area';
  const job = {
    id: crypto.randomUUID(),
    areaId: `${slug(cleanName)}-${crypto.randomBytes(3).toString('hex')}`,
    name: cleanName,
    bounds: b,
    userId,
    status: 'queued',
    phase: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  runNext();
  return { job: publicJob(job) };
}

function getJob(id) {
  const j = jobs.get(id);
  return j ? publicJob(j) : null;
}

async function listAreas() {
  const info = await pmtiles.getInfo(config.vectorTilesFile, config.vectorAreasDir, areaNames());
  return { areas: info.areas || [], jobs: [...jobs.values()].filter((j) => j.status !== 'done').map(publicJob) };
}

module.exports = { requestArea, getJob, listAreas, areaNames, MAX_SPAN_DEG };
