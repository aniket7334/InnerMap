// Builds an offline map area: copies the vector tiles of one city/region out of the Protomaps
// daily OpenStreetMap build into a small local PMTiles file (data/areas/<id>.pmtiles).
//
// This does the same as the official `pmtiles extract <build> out.pmtiles --bbox=...` command
// that backend/data/README.md describes - the method Protomaps recommends instead of scraping a
// tile API: read the archive's directories, then download only the byte ranges of the tiles
// inside the area (z0-15), merged into a few large range requests. Done once per area; after
// that the server needs no internet for it.
//
// Data: © OpenStreetMap contributors (ODbL), Protomaps basemap. The app shows the attribution.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { zxyToTileId, Compression } = require('pmtiles');

const BUILDS_LIST = 'https://build-metadata.protomaps.dev/builds.json';
const BUILD_BASE = 'https://build.protomaps.com/';
const MAX_ZOOM = 15; // Protomaps basemap data is complete at z15
const MERGE_GAP = 256 * 1024; // join nearby byte ranges into one request
const MAX_REQUEST = 16 * 1024 * 1024;
const PARALLEL = 4;
const HEADER_BYTES = 127;
const ROOT_LIMIT = 16384 - HEADER_BYTES; // header + root directory fit in the first 16 KB

// ---------------------------------------------------------------- remote reading
async function fetchRange(url, offset, length, attempt = 1) {
  try {
    const res = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < length) throw new Error(`short read ${buf.length}/${length}`);
    return buf.subarray(0, length);
  } catch (err) {
    if (attempt >= 4) throw err;
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    return fetchRange(url, offset, length, attempt + 1);
  }
}

function decompress(buf, compression) {
  if (compression === Compression.Gzip) return zlib.gunzipSync(buf);
  if (compression === Compression.None || compression === Compression.Unknown) return buf;
  throw new Error(`Unsupported compression ${compression}`);
}

function readHeader(b) {
  const u64 = (o) => Number(b.readBigUInt64LE(o));
  if (b.toString('utf8', 0, 7) !== 'PMTiles' || b[7] !== 3) throw new Error('Not a PMTiles v3 archive');
  return {
    rootOffset: u64(8),
    rootLength: u64(16),
    metadataOffset: u64(24),
    metadataLength: u64(32),
    leafOffset: u64(40),
    leafLength: u64(48),
    dataOffset: u64(56),
    internalCompression: b[97],
    tileCompression: b[98],
    tileType: b[99],
  };
}

// Directory entries: { tileId, offset, length, runLength } (runLength 0 = leaf directory)
function readVarint(buf, pos) {
  let result = 0;
  let mul = 1;
  for (;;) {
    const byte = buf[pos.i];
    pos.i += 1;
    result += (byte & 0x7f) * mul;
    if (byte < 0x80) return result;
    mul *= 128;
  }
}

function parseDirectory(buf) {
  const pos = { i: 0 };
  const n = readVarint(buf, pos);
  const entries = new Array(n);
  let last = 0;
  for (let k = 0; k < n; k += 1) {
    last += readVarint(buf, pos);
    entries[k] = { tileId: last, offset: 0, length: 0, runLength: 1 };
  }
  for (let k = 0; k < n; k += 1) entries[k].runLength = readVarint(buf, pos);
  for (let k = 0; k < n; k += 1) entries[k].length = readVarint(buf, pos);
  for (let k = 0; k < n; k += 1) {
    const v = readVarint(buf, pos);
    entries[k].offset = v === 0 && k > 0 ? entries[k - 1].offset + entries[k - 1].length : v - 1;
  }
  return entries;
}

/** The entry covering tileId (last entry with entry.tileId <= tileId), or null. */
function findEntry(entries, tileId) {
  let lo = 0;
  let hi = entries.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].tileId <= tileId) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 ? entries[best] : null;
}

// ---------------------------------------------------------------- writing
function writeVarint(out, value) {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function serializeDirectory(entries) {
  const out = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    writeVarint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  entries.forEach((e, k) => {
    const prev = entries[k - 1];
    if (k > 0 && e.offset === prev.offset + prev.length) writeVarint(out, 0);
    else writeVarint(out, e.offset + 1);
  });
  return zlib.gzipSync(Buffer.from(out));
}

/** Root directory (and leaf directories when the root alone would be too big). */
function buildDirectories(entries) {
  const root = serializeDirectory(entries);
  if (root.length <= ROOT_LIMIT) return { root, leaves: Buffer.alloc(0) };
  for (let leafSize = 4096; ; leafSize *= 2) {
    const rootEntries = [];
    const parts = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const leaf = serializeDirectory(entries.slice(i, i + leafSize));
      rootEntries.push({ tileId: entries[i].tileId, offset, length: leaf.length, runLength: 0 });
      parts.push(leaf);
      offset += leaf.length;
    }
    const r = serializeDirectory(rootEntries);
    if (r.length <= ROOT_LIMIT) return { root: r, leaves: Buffer.concat(parts) };
  }
}

function writeHeader(h) {
  const b = Buffer.alloc(HEADER_BYTES);
  b.write('PMTiles', 0, 'utf8');
  b[7] = 3;
  const u64 = (o, v) => b.writeBigUInt64LE(BigInt(v), o);
  u64(8, h.rootOffset);
  u64(16, h.rootLength);
  u64(24, h.metadataOffset);
  u64(32, h.metadataLength);
  u64(40, h.leafOffset);
  u64(48, h.leafLength);
  u64(56, h.dataOffset);
  u64(64, h.dataLength);
  u64(72, h.addressedTiles);
  u64(80, h.tileEntries);
  u64(88, h.tileContents);
  b[96] = 0; // not clustered (identical tiles may share one copy)
  b[97] = Compression.Gzip; // directories + metadata
  b[98] = h.tileCompression;
  b[99] = h.tileType;
  b[100] = h.minZoom;
  b[101] = h.maxZoom;
  const e7 = (o, v) => b.writeInt32LE(Math.round(v * 1e7), o);
  e7(102, h.bounds.west);
  e7(106, h.bounds.south);
  e7(110, h.bounds.east);
  e7(114, h.bounds.north);
  b[118] = h.centerZoom;
  e7(119, (h.bounds.west + h.bounds.east) / 2);
  e7(123, (h.bounds.south + h.bounds.north) / 2);
  return b;
}

// ---------------------------------------------------------------- tiles in the area
function lngToX(lng, z) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}
function latToY(lat, z) {
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tileIdsIn(b, maxZoom) {
  const ids = [];
  for (let z = 0; z <= maxZoom; z += 1) {
    const n = 2 ** z;
    const x0 = Math.max(0, lngToX(b.west, z));
    const x1 = Math.min(n - 1, lngToX(b.east, z));
    const y0 = Math.max(0, latToY(b.north, z));
    const y1 = Math.min(n - 1, latToY(b.south, z));
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) ids.push(zxyToTileId(z, x, y));
  }
  return ids.sort((a, b2) => a - b2);
}

/** Number of tiles an area would need (to check the size before starting). */
function countTiles(bounds, maxZoom = MAX_ZOOM) {
  let count = 0;
  for (let z = 0; z <= maxZoom; z += 1) {
    count += (lngToX(bounds.east, z) - lngToX(bounds.west, z) + 1) * (latToY(bounds.south, z) - latToY(bounds.north, z) + 1);
  }
  return count;
}

// ---------------------------------------------------------------- main
async function latestBuildUrl() {
  const res = await fetch(BUILDS_LIST);
  if (!res.ok) throw new Error(`Build list: HTTP ${res.status}`);
  const keys = (await res.json()).map((b) => b.key).filter((k) => /^\d{8}\.pmtiles$/.test(k)).sort();
  // Only the last few builds are kept online: take the newest that answers.
  for (const key of keys.reverse().slice(0, 5)) {
    const head = await fetch(BUILD_BASE + key, { method: 'HEAD' });
    if (head.ok) return BUILD_BASE + key;
  }
  throw new Error('No Protomaps build is available right now');
}

/**
 * Extracts `bounds` into `outFile`.
 * @param onProgress ({ phase, done, total }) => void
 * @returns { tiles, bytes, build }
 */
async function extractArea({ bounds, outFile, name, onProgress = () => {}, buildUrl }) {
  const url = buildUrl || (await latestBuildUrl());
  onProgress({ phase: 'index', done: 0, total: 1 });
  const header = readHeader(await fetchRange(url, 0, HEADER_BYTES));

  // 1. Find every tile of the area in the archive's directories.
  const leafCache = new Map();
  const loadDir = async (offset, length) => decompress(await fetchRange(url, offset, length), header.internalCompression);
  const root = parseDirectory(await loadDir(header.rootOffset, header.rootLength));
  const wanted = tileIdsIn(bounds, MAX_ZOOM);
  const found = []; // { tileId, srcOffset, length }
  for (let i = 0; i < wanted.length; i += 1) {
    const id = wanted[i];
    let entries = root;
    for (let depth = 0; depth < 4; depth += 1) {
      const e = findEntry(entries, id);
      if (!e) {
        entries = null;
        break;
      }
      if (e.runLength > 0) {
        if (id < e.tileId + e.runLength) found.push({ tileId: id, srcOffset: e.offset, length: e.length });
        break;
      }
      const key = e.offset;
      if (!leafCache.has(key)) leafCache.set(key, parseDirectory(await loadDir(header.leafOffset + e.offset, e.length)));
      entries = leafCache.get(key);
    }
    if (i % 200 === 0) onProgress({ phase: 'index', done: i, total: wanted.length });
  }
  if (!found.length) throw new Error('The map build has no data for this area');

  // 2. Download the tile bytes in a few large range requests.
  const unique = [...new Map(found.map((t) => [t.srcOffset, t])).values()].sort((a, b) => a.srcOffset - b.srcOffset);
  const ranges = [];
  for (const t of unique) {
    const r = ranges[ranges.length - 1];
    if (r && t.srcOffset - (r.start + r.length) <= MERGE_GAP && t.srcOffset + t.length - r.start <= MAX_REQUEST) {
      r.length = Math.max(r.length, t.srcOffset + t.length - r.start);
      r.tiles.push(t);
    } else {
      ranges.push({ start: t.srcOffset, length: t.length, tiles: [t] });
    }
  }
  const totalBytes = ranges.reduce((s, r) => s + r.length, 0);
  let doneBytes = 0;
  const contents = new Map(); // srcOffset -> Buffer
  let next = 0;
  const worker = async () => {
    while (next < ranges.length) {
      const r = ranges[next];
      next += 1;
      const buf = await fetchRange(url, header.dataOffset + r.start, r.length);
      for (const t of r.tiles) contents.set(t.srcOffset, Buffer.from(buf.subarray(t.srcOffset - r.start, t.srcOffset - r.start + t.length)));
      doneBytes += r.length;
      onProgress({ phase: 'tiles', done: doneBytes, total: totalBytes });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  // 3. Write the new archive: header, root directory, metadata, leaf directories, tile data.
  const dataParts = [];
  const written = new Map(); // srcOffset -> { offset, length }
  let dataLength = 0;
  const entries = [];
  for (const t of found) {
    let w = written.get(t.srcOffset);
    if (!w) {
      const buf = contents.get(t.srcOffset);
      w = { offset: dataLength, length: buf.length };
      written.set(t.srcOffset, w);
      dataParts.push(buf);
      dataLength += buf.length;
    }
    entries.push({ tileId: t.tileId, offset: w.offset, length: w.length, runLength: 1 });
  }
  const { root: rootDir, leaves } = buildDirectories(entries);

  let srcMeta = {};
  try {
    srcMeta = JSON.parse(decompress(await fetchRange(url, header.metadataOffset, header.metadataLength), header.internalCompression).toString('utf8'));
  } catch {
    /* metadata is optional */
  }
  const meta = zlib.gzipSync(
    Buffer.from(
      JSON.stringify({
        ...srcMeta,
        name: name || srcMeta.name || 'Inner Map area',
        description: `Extract of ${url.split('/').pop()} for ${name || 'an area'} (${bounds.west},${bounds.south},${bounds.east},${bounds.north})`,
        attribution: srcMeta.attribution || '© OpenStreetMap contributors',
      })
    )
  );

  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + rootDir.length;
  const leafOffset = metadataOffset + meta.length;
  const dataOffset = leafOffset + leaves.length;
  const head = writeHeader({
    rootOffset,
    rootLength: rootDir.length,
    metadataOffset,
    metadataLength: meta.length,
    leafOffset,
    leafLength: leaves.length,
    dataOffset,
    dataLength,
    addressedTiles: entries.length,
    tileEntries: entries.length,
    tileContents: written.size,
    tileCompression: header.tileCompression,
    tileType: header.tileType,
    minZoom: 0,
    maxZoom: MAX_ZOOM,
    centerZoom: 12,
    bounds,
  });

  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  const tmp = `${outFile}.part`;
  const fh = await fsp.open(tmp, 'w');
  try {
    for (const part of [head, rootDir, meta, leaves, ...dataParts]) await fh.write(part);
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, outFile);
  const bytes = fs.statSync(outFile).size;
  onProgress({ phase: 'done', done: 1, total: 1 });
  return { tiles: entries.length, bytes, build: url.split('/').pop() };
}

module.exports = { extractArea, countTiles, latestBuildUrl, MAX_ZOOM };
