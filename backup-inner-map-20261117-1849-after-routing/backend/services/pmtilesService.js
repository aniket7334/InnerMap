// Serves vector map tiles out of a local PMTiles archive (one file, e.g. data/mumbai.pmtiles).
//
// The archive is an extract of the Protomaps OpenStreetMap basemap made with the official
// `pmtiles extract` tool (see backend/data/README.md). Nothing is fetched from the internet
// at runtime: tiles are read straight from the file on disk with byte-range reads.
const fs = require('fs');
const fsp = require('fs/promises');
const { PMTiles, TileType } = require('pmtiles');

/** pmtiles "Source" that reads byte ranges from a local file. */
class NodeFileSource {
  constructor(filePath) {
    this.filePath = filePath;
    this.handle = null;
  }

  getKey() {
    return this.filePath;
  }

  async getBytes(offset, length) {
    if (!this.handle) this.handle = await fsp.open(this.filePath, 'r');
    const buf = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(buf, 0, length, offset);
    // Copy into a standalone ArrayBuffer of exactly the bytes read.
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead);
    return { data };
  }
}

let archive = null;
let infoCache = null;

function openArchive(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  if (!archive || archive.source.getKey() !== filePath) {
    archive = new PMTiles(new NodeFileSource(filePath));
    infoCache = null;
  }
  return archive;
}

/** Header + metadata summary, or { available: false } when no archive is configured. */
async function getInfo(filePath) {
  const pm = openArchive(filePath);
  if (!pm) return { available: false };
  if (infoCache) return infoCache;
  const header = await pm.getHeader();
  const metadata = (await pm.getMetadata()) || {};
  infoCache = {
    available: true,
    name: metadata.name || 'Vector basemap',
    description: metadata.description || null,
    attribution: metadata.attribution || '© OpenStreetMap contributors',
    version: metadata.version || null,
    tileType: header.tileType === TileType.Mvt ? 'mvt' : String(header.tileType),
    minZoom: header.minZoom,
    maxZoom: header.maxZoom,
    bounds: { west: header.minLon, south: header.minLat, east: header.maxLon, north: header.maxLat },
    center: { lng: header.centerLon, lat: header.centerLat, zoom: header.centerZoom },
  };
  return infoCache;
}

/** Returns the decompressed tile bytes as a Buffer, or null if the archive has no such tile. */
async function getTile(filePath, z, x, y) {
  const pm = openArchive(filePath);
  if (!pm) return null;
  const res = await pm.getZxy(z, x, y);
  return res ? Buffer.from(res.data) : null;
}

module.exports = { getInfo, getTile };
