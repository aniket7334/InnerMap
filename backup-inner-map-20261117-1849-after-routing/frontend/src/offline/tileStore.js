// Reference-counted tile storage in IndexedDB.
import { getDB } from './db';

export async function getTile(key) {
  const db = await getDB();
  return db.get('tiles', key);
}

/**
 * If the tile already exists, make sure regionId references it (dedup).
 * Returns the stored record or undefined if it is not stored yet.
 * Runs in one readwrite transaction so concurrent downloads cannot race.
 */
export async function addRegionRef(key, regionId) {
  const db = await getDB();
  const tx = db.transaction('tiles', 'readwrite');
  const rec = await tx.store.get(key);
  if (rec && !rec.regions.includes(regionId)) {
    rec.regions.push(regionId);
    await tx.store.put(rec);
  }
  await tx.done;
  return rec;
}

/**
 * Store a freshly downloaded tile (or just add the reference if another job stored it meanwhile).
 * `encoding` is 'gzip' when the blob was compressed with compressBlob().
 */
export async function putTile(key, blob, regionId, encoding = null) {
  const db = await getDB();
  const tx = db.transaction('tiles', 'readwrite');
  const existing = await tx.store.get(key);
  if (existing) {
    if (!existing.regions.includes(regionId)) existing.regions.push(regionId);
    await tx.store.put(existing);
  } else {
    await tx.store.put({ key, blob, size: blob.size, encoding, regions: [regionId], storedAt: Date.now() });
  }
  await tx.done;
}

// ---- compression (vector tiles compress ~2-3x; PNG/JPEG tiles are stored as-is) ----------
export const canCompress = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function compressBlob(blob) {
  if (!canCompress) return { blob, encoding: null };
  const gz = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  return { blob: gz, encoding: 'gzip' };
}

/** The tile's original bytes, decompressing if needed. */
export async function readTileBytes(rec) {
  if (rec.encoding === 'gzip') {
    return new Response(rec.blob.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return rec.blob.arrayBuffer();
}

/**
 * Remove regionId from every tile it references; delete tiles nobody references any more.
 * Returns bytes actually freed.
 */
export async function releaseRegion(regionId) {
  const db = await getDB();
  let freed = 0;
  const tx = db.transaction('tiles', 'readwrite');
  let cursor = await tx.store.index('regions').openCursor(IDBKeyRange.only(regionId));
  while (cursor) {
    const rec = cursor.value;
    rec.regions = rec.regions.filter((r) => r !== regionId);
    if (rec.regions.length === 0) {
      freed += rec.size || 0;
      await cursor.delete();
    } else {
      await cursor.update(rec);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return freed;
}

/**
 * Storage cleanup: drop references to regions that no longer exist and delete
 * tiles left without any region (e.g. after a crash mid-delete).
 */
export async function cleanupOrphanTiles(validRegionIds) {
  const valid = new Set(validRegionIds);
  const db = await getDB();
  let removed = 0;
  let freed = 0;
  const tx = db.transaction('tiles', 'readwrite');
  let cursor = await tx.store.openCursor();
  while (cursor) {
    const rec = cursor.value;
    const kept = rec.regions.filter((r) => valid.has(r));
    if (kept.length === 0) {
      removed += 1;
      freed += rec.size || 0;
      await cursor.delete();
    } else if (kept.length !== rec.regions.length) {
      rec.regions = kept;
      await cursor.update(rec);
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return { removed, freed };
}

export async function countStoredTiles() {
  const db = await getDB();
  return db.count('tiles');
}

export async function clearAllTiles() {
  const db = await getDB();
  await db.clear('tiles');
}
