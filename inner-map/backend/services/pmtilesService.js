// Serves vector map tiles out of local PMTiles archives:
//   - the main file (VECTOR_TILES_FILE, e.g. data/mumbai.pmtiles), and
//   - every extra area extracted for other cities (data/areas/*.pmtiles, see areaService.js).
//
// The archives are extracts of the Protomaps OpenStreetMap basemap (see backend/data/README.md).
// Nothing is fetched from the internet when serving: tiles are read straight from the files on
// disk with byte-range reads. A tile is taken from the first archive whose area contains it.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { PMTiles, TileType } = require('pmtiles');

/** pmtiles "Source" that reads byte ranges from a local file. */
class NodeFileSource {
  constructor(filePath) {
    this.filePath = filePath;
    this.handle = null;
    this.opening = null; // one open for all reads: simultaneous first reads must not open the file twice
  }

  getKey() {
    return this.filePath;
  }

  async getBytes(offset, length) {
    // Without this, two tile requests at the same moment each opened the file and one handle was
    // dropped unclosed - which Node.js 26 treats as a fatal error (the server crashed).
    if (!this.handle) {
      if (!this.opening) this.opening = fsp.open(this.filePath, 'r');
      this.handle = await this.opening;
    }
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(buf, 0, length, offset);
    // Copy into a standalone ArrayBuffer of exactly the bytes read.
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead);
    return { data };
  }

  async close() {
    const h = this.handle || (this.opening ? await this.opening.catch(() => null) : null);
    this.handle = null;
    this.opening = null;
    if (h) await h.close().catch(() => {});
  }
}

// filePath -> { pm, header, metadata, mtime }
const archives = new Map();
const opening = new Map(); // filePath -> Promise of the entry being opened (shared by simultaneous requests)
let infoCache = null;
let infoKey = '';

async function openArchive(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const cached = archives.get(filePath);
  if (cached && cached.mtime === stat.mtimeMs) return cached;
  const key = `${filePath}|${stat.mtimeMs}`;
  if (opening.has(key)) return opening.get(key);
  const p = (async () => {
    if (cached) await cached.pm.source.close?.();
    const source = new NodeFileSource(filePath);
    try {
      const pm = new PMTiles(source);
      const header = await pm.getHeader();
      const metadata = (await pm.getMetadata().catch(() => null)) || {};
      const entry = { pm, header, metadata, mtime: stat.mtimeMs };
      archives.set(filePath, entry);
      return entry;
    } catch (err) {
      await source.close();
      throw err;
    }
  })();
  opening.set(key, p);
  try {
    return await p;
  } finally {
    opening.delete(key);
  }
}

async function closeArchive(filePath) {
  const a = archives.get(filePath);
  if (a) await a.pm.source.close?.();
  archives.delete(filePath);
  infoCache = null;
}

/** All archive files: the main one first, then the extracted areas. */
function archiveFiles(mainFile, areasDir) {
  const files = [];
  if (mainFile && fs.existsSync(mainFile)) files.push(mainFile);
  if (areasDir && fs.existsSync(areasDir)) {
    for (const f of fs.readdirSync(areasDir).sort()) if (f.endsWith('.pmtiles')) files.push(path.join(areasDir, f));
  }
  return files;
}

const boundsOf = (h) => ({ west: h.minLon, south: h.minLat, east: h.maxLon, north: h.maxLat });

/** Header + metadata summary of all archives, or { available: false } when there is none. */
async function getInfo(mainFile, areasDir, names = {}) {
  const files = archiveFiles(mainFile, areasDir);
  const key = files.map((f) => `${f}:${archives.get(f)?.mtime ?? ''}`).join('|') + JSON.stringify(names);
  if (infoCache && key === infoKey) return infoCache;
  const opened = (await Promise.all(files.map((f) => openArchive(f).catch(() => null)))).map((a, i) => a && { ...a, file: files[i] }).filter(Boolean);
  if (!opened.length) return { available: false, areas: [] };
  const main = opened[0];
  const areas = opened.map((a) => {
    const id = path.basename(a.file, '.pmtiles');
    return {
      id,
      // built-in file: named after the file (mumbai.pmtiles -> "Mumbai")
      name: names[id] || (a.file === mainFile ? id.charAt(0).toUpperCase() + id.slice(1) : a.metadata.name || id),
      builtIn: a.file === mainFile,
      bounds: boundsOf(a.header),
      maxZoom: a.header.maxZoom,
      bytes: fs.statSync(a.file).size,
      updatedAt: Math.round(fs.statSync(a.file).mtimeMs), // when the server's data for this area last changed
    };
  });
  const union = areas.reduce(
    (u, a) => ({
      west: Math.min(u.west, a.bounds.west),
      south: Math.min(u.south, a.bounds.south),
      east: Math.max(u.east, a.bounds.east),
      north: Math.max(u.north, a.bounds.north),
    }),
    { ...areas[0].bounds }
  );
  infoCache = {
    available: true,
    name: main.metadata.name || 'Vector basemap',
    description: main.metadata.description || null,
    attribution: main.metadata.attribution || '© OpenStreetMap contributors',
    version: main.metadata.version || null,
    tileType: main.header.tileType === TileType.Mvt ? 'mvt' : String(main.header.tileType),
    minZoom: Math.min(...opened.map((a) => a.header.minZoom)),
    maxZoom: Math.max(...opened.map((a) => a.header.maxZoom)),
    // `bounds`: the main area (kept for older app versions); `areas`: every area with data.
    bounds: areas[0].bounds,
    extent: union,
    areas,
    center: { lng: main.header.centerLon, lat: main.header.centerLat, zoom: main.header.centerZoom },
  };
  infoKey = key;
  return infoCache;
}

function tileBounds(z, x, y) {
  const n = 2 ** z;
  const lng = (v) => (v / n) * 360 - 180;
  const lat = (v) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI;
  return { west: lng(x), east: lng(x + 1), north: lat(y), south: lat(y + 1) };
}

/** Returns the decompressed tile bytes as a Buffer, or null if no archive has that tile. */
async function getTile(mainFile, areasDir, z, x, y) {
  const tb = tileBounds(z, x, y);
  for (const file of archiveFiles(mainFile, areasDir)) {
    const a = await openArchive(file).catch(() => null);
    if (!a) continue;
    const h = a.header;
    if (z < h.minZoom || z > h.maxZoom) continue;
    if (tb.east < h.minLon || tb.west > h.maxLon || tb.north < h.minLat || tb.south > h.maxLat) continue;
    const res = await a.pm.getZxy(z, x, y);
    if (res) return Buffer.from(res.data);
  }
  return null;
}

module.exports = { getInfo, getTile, closeArchive };
