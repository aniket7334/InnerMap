// Offline map download engine.
//
//  1. Work out every tile inside the chosen bounds for each zoom level of the provider.
//  2. Fetch them from that provider (only providers marked offlineAllowed) with a small
//     worker pool, retries and back-off.
//  3. Store each tile in IndexedDB (vector tiles gzip-compressed). Tiles already on the
//     device are re-used, not downloaded again (dedup between overlapping areas and on resume).
//  4. Persist progress so an interrupted download can be resumed later.
//
// The manager lives at module level, so a download keeps running while the user
// moves between pages of the app.
import { getProvider, providerForRegion, buildTileUrl, downloadZoomRange, DOWNLOAD_LIMITS, SATELLITE_SOURCE, TERRAIN_SOURCE } from '../maps/providers';
import { countTiles, iterateTiles, tileKey } from '../maps/tileMath';
import { uuid } from './db';
import { addRegionRef, putTile, releaseRegion, releaseRegionLayer, compressBlob } from './tileStore';
import { saveRegion, getRegion, patchRegion, listRegions, deleteRegionRecord } from './regionStore';
import { getStorageEstimate, requestPersistentStorage, isQuotaError } from './storage';
import { queueMapCreate, queueMapDelete } from './syncService';
import { saveRoutingData, deleteRoutingData } from './routingStore';
import { fetchRoadGraph } from '../services/routingApi';
import { getDB } from './db';

const MAX_RETRIES = 3;
const PERSIST_EVERY_MS = 1000;

const jobs = new Map(); // regionId -> AbortController
const listeners = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function subscribeDownloads(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Areas deleted in this session: a late progress/status update must not bring them back.
const deletedIds = new Set();

function emit(region) {
  if (!region) return;
  if (!region.deleted && deletedIds.has(region.id)) return;
  listeners.forEach((fn) => fn(region));
}

export function isDownloading(regionId) {
  return regionId ? jobs.has(regionId) : jobs.size > 0;
}

/** Tile count and size estimate for a selection. Zooms are display zooms. */
export function estimateDownload(provider, bounds, zoomMin, zoomMax) {
  if (!bounds || zoomMin > zoomMax) return { tiles: 0, bytes: 0 };
  const { dataZoomMin, dataZoomMax } = downloadZoomRange(provider, zoomMin, zoomMax);
  const tiles = countTiles(bounds, dataZoomMin, dataZoomMax);
  return { tiles, bytes: tiles * provider.averageTileBytes, dataZoomMin, dataZoomMax };
}

// ---- optional data packs of a downloaded area (Stage 4) ------------------------------------
// Stored like map tiles (same IndexedDB store, reference-counted per area), so deleting an area
// frees them and overlapping areas share them. Kept separate from the vector map data.
export const PACKS = {
  satellite: {
    source: SATELLITE_SOURCE,
    label: 'Satellite imagery',
    // Sentinel-2 is ~10 m/pixel: zoom 14 already shows all detail; deeper levels are drawn from it.
    defaultMaxZoom: Math.min(14, SATELLITE_SOURCE.maxDataZoom),
  },
  terrain: {
    source: TERRAIN_SOURCE,
    label: 'Terrain (elevation)',
    // SRTM is ~30 m: zoom 12 is enough for hill shading; deeper zooms are drawn from it.
    defaultMaxZoom: 12,
  },
};

/** Zoom range and tile count of a pack for an area. */
export function estimatePack(packId, bounds, zoomMin, zoomMax) {
  const pack = PACKS[packId];
  if (!pack || !bounds) return { tiles: 0, bytes: 0 };
  const zTo = Math.min(pack.source.maxDataZoom, zoomMax ?? pack.defaultMaxZoom);
  const zFrom = Math.min(zTo, Math.max(0, zoomMin));
  const tiles = countTiles(bounds, zFrom, zTo);
  return { tiles, bytes: tiles * pack.source.averageTileBytes, zFrom, zTo };
}

function newPack(packId, bounds, zoomMin, zoomMax) {
  const { tiles, zFrom, zTo } = estimatePack(packId, bounds, zoomMin, zoomMax);
  const source = PACKS[packId].source;
  return {
    sourceId: source.id,
    label: source.label,
    layerId: source.layerId,
    zoomMin: zFrom,
    zoomMax: zTo,
    tileCount: tiles,
    doneCount: 0,
    missingCount: 0,
    failedCount: 0,
    size: 0,
    status: 'pending',
    error: null,
  };
}

/** Throws a user-readable Error if a download cannot start. */
async function preflight(provider, tileCount) {
  if (!provider) throw new Error('Unknown map provider.');
  if (!provider.offlineAllowed) {
    throw new Error(provider.offlineBlockedReason || `${provider.label} cannot be downloaded for offline use.`);
  }
  if (!navigator.onLine) throw new Error('You are offline. Connect to the internet to download map areas.');
  if (jobs.size > 0) throw new Error('Another download is in progress. Wait for it to finish or cancel it.');
  if (tileCount === 0) throw new Error('The selected area contains no tiles.');
  if (tileCount > DOWNLOAD_LIMITS.maxTilesPerDownload) {
    throw new Error(
      `This selection needs ${tileCount.toLocaleString()} tiles; the limit is ` +
        `${DOWNLOAD_LIMITS.maxTilesPerDownload.toLocaleString()}. Choose a smaller area or a higher minimum zoom.`
    );
  }
  const { available } = await getStorageEstimate();
  const estimate = tileCount * provider.averageTileBytes;
  if (available !== null && estimate > available * 0.9) {
    throw new Error('Not enough browser storage for this area. Delete some downloaded maps or choose a smaller area.');
  }
  // Best effort: ask the browser to keep our data even under storage pressure.
  await requestPersistentStorage().catch(() => false);
}

/**
 * Download the road network of a downloaded area (for offline directions) and store it on the
 * device. Independent of the map tiles: it can be added or retried later.
 */
export async function downloadRoutingData(regionId) {
  const region = await getRegion(regionId);
  if (!region) throw new Error('Downloaded area not found.');
  if (!navigator.onLine) throw new Error('Connect to the internet to download road data.');
  emit(await patchRegion(regionId, { routing: { status: 'downloading' } }));
  try {
    const { graph, bytes } = await fetchRoadGraph(region.bounds);
    await saveRoutingData({
      regionId,
      userId: region.userId,
      name: region.name,
      bounds: graph.bounds || region.bounds,
      graph,
      bytes,
      edges: graph.edgeA.length,
      builtAt: graph.builtAt,
      storedAt: Date.now(),
    });
    emit(await patchRegion(regionId, { routing: { status: 'completed', bytes, edges: graph.edgeA.length, profiles: graph.profiles || ['car', 'bike', 'foot'] } }));
  } catch (err) {
    const message = err.response?.data?.message || err.message || 'Download failed';
    emit(await patchRegion(regionId, { routing: { status: 'failed', error: message } }));
    throw new Error(message);
  }
}

// ---- offline search index ---------------------------------------------------------------
// Built on the device from the area's stored vector tiles (no network needed), so areas that
// were downloaded before this feature existed get an index too.
const indexJobs = new Map(); // regionId -> Promise

export function buildSearchIndex(regionId) {
  if (indexJobs.has(regionId)) return indexJobs.get(regionId);
  const job = (async () => {
    const region = await getRegion(regionId);
    const provider = region && providerForRegion(region);
    if (!region || !provider || provider.kind !== 'vector') return null;
    emit(await patchRegion(regionId, { search: { status: 'building' } }));
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../search/placeIndex.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        if (e.data.type === 'done') {
          worker.terminate();
          resolve(e.data);
        } else if (e.data.type === 'error') {
          worker.terminate();
          reject(new Error(e.data.message));
        }
      };
      worker.onerror = (e) => {
        worker.terminate();
        reject(new Error(e.message || 'Search index worker failed'));
      };
      worker.postMessage({ regionId, layerId: region.layerId, maxDataZoom: provider.maxDataZoom });
    });
    const updated = await patchRegion(regionId, {
      search: { status: 'completed', count: result.count, counts: result.counts, builtAt: Date.now() },
    });
    emit(updated);
    window.dispatchEvent(new CustomEvent('innermap:search-index-changed'));
    return updated;
  })()
    .catch(async (err) => {
      console.warn('[search] index failed:', err.message);
      emit(await patchRegion(regionId, { search: { status: 'failed', error: err.message } }));
      return null;
    })
    .finally(() => indexJobs.delete(regionId));
  indexJobs.set(regionId, job);
  return job;
}

/** Index every finished vector area of this user that has no search index yet (one at a time). */
export async function ensureSearchIndexes(userId) {
  const regions = await listRegions(userId);
  for (const r of regions) {
    const provider = providerForRegion(r);
    if (provider?.kind !== 'vector' || !['completed', 'partial'].includes(r.status) || r.doneCount === 0) continue;
    if (r.search?.status === 'completed' || r.search?.status === 'building' || jobs.has(r.id)) continue;
    await buildSearchIndex(r.id);
  }
}

/** Remove a region from the search index; entries no other area uses are deleted. */
async function releaseSearchIndex(regionId) {
  const db = await getDB();
  const tx = db.transaction('places', 'readwrite');
  let cursor = await tx.store.index('regions').openCursor(regionId);
  while (cursor) {
    const rec = cursor.value;
    const left = rec.regions.filter((id) => id !== regionId);
    if (left.length) await cursor.update({ ...rec, regions: left });
    else await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
  window.dispatchEvent(new CustomEvent('innermap:search-index-changed'));
}

export async function startDownload({ userId, name, bounds, zoomMin, zoomMax, providerId, withRouting = false, packs = [] }) {
  const provider = getProvider(providerId);
  const zMin = Math.max(provider.minZoom, zoomMin);
  const zMax = provider.kind === 'vector' ? provider.maxZoom : Math.min(provider.maxZoom, zoomMax);
  if (zMin > zMax) throw new Error('Minimum zoom must not exceed maximum zoom.');
  const { tiles: tileCount, dataZoomMin, dataZoomMax } = estimateDownload(provider, bounds, zMin, zMax);
  await preflight(provider, tileCount);
  const packRecords = {};
  for (const id of packs) {
    if (!PACKS[id]) continue;
    if (!PACKS[id].source.offlineAllowed) throw new Error(`${PACKS[id].label} cannot be downloaded for offline use from this source.`);
    packRecords[id] = newPack(id, bounds, zMin, null);
  }

  const region = {
    id: uuid(),
    userId,
    name: name.trim(),
    bounds,
    zoomMin: zMin,
    zoomMax: zMax,
    dataZoomMin,
    dataZoomMax,
    providerId: provider.id,
    providerLabel: provider.label,
    kind: provider.kind,
    layerId: provider.layerId,
    tileCount,
    doneCount: 0,
    missingCount: 0,
    failedCount: 0,
    size: 0,
    status: 'downloading',
    error: null,
    serverId: null,
    createdAt: Date.now(),
    wantRouting: Boolean(withRouting),
    routing: withRouting ? { status: 'pending' } : null,
    packs: packRecords,
  };
  await saveRegion(region);
  emit(region);
  run(region, provider); // not awaited - progress arrives through subscribeDownloads()
  return region;
}

export async function resumeDownload(regionId) {
  const region = await getRegion(regionId);
  if (!region) throw new Error('Downloaded area not found.');
  const provider = providerForRegion(region);
  if (!provider) throw new Error('The map provider this area came from is no longer configured.');
  const mainDone = region.status === 'completed';
  if (mainDone) {
    // Only data packs are unfinished.
    if (jobs.size > 0) throw new Error('Another download is in progress. Wait for it to finish or pause it.');
    if (!navigator.onLine) throw new Error('You are offline. Connect to the internet to continue the download.');
    run(region, provider, { packsOnly: true });
    return region;
  }
  await preflight(provider, region.tileCount);
  const next = await patchRegion(regionId, { status: 'downloading', error: null });
  emit(next);
  run(next, provider);
  return next;
}

/** Add satellite imagery and/or terrain to an area that is already downloaded. */
export async function addPacks(regionId, packIds) {
  const region = await getRegion(regionId);
  if (!region) throw new Error('Downloaded area not found.');
  const provider = providerForRegion(region);
  if (!provider) throw new Error('The map provider this area came from is no longer configured.');
  if (jobs.size > 0) throw new Error('Another download is in progress. Wait for it to finish or pause it.');
  if (!navigator.onLine) throw new Error('You are offline. Connect to the internet to download data packs.');
  const packs = { ...(region.packs || {}) };
  for (const id of packIds) {
    if (!PACKS[id]) continue;
    if (!PACKS[id].source.offlineAllowed) throw new Error(`${PACKS[id].label} cannot be downloaded for offline use from this source.`);
    if (!packs[id] || packs[id].status !== 'completed') packs[id] = { ...newPack(id, region.bounds, region.zoomMin, null), ...(packs[id] ? { doneCount: 0 } : {}) };
  }
  const total = Object.values(packs).reduce((n, p) => n + (p.status === 'completed' ? 0 : p.tileCount), 0);
  if (total > DOWNLOAD_LIMITS.maxTilesPerDownload) {
    throw new Error(`These packs need ${total.toLocaleString()} tiles; the limit is ${DOWNLOAD_LIMITS.maxTilesPerDownload.toLocaleString()}.`);
  }
  const { available } = await getStorageEstimate();
  const bytes = packIds.reduce((n, id) => n + (packs[id] ? packs[id].tileCount * PACKS[id].source.averageTileBytes : 0), 0);
  if (available !== null && bytes > available * 0.9) throw new Error('Not enough browser storage for these packs.');
  const next = await patchRegion(regionId, { packs });
  emit(next);
  run(next, provider, { packsOnly: true });
  return next;
}

/** Remove one data pack from an area (frees its tiles unless another area uses them). */
export async function removePack(regionId, packId) {
  const region = await getRegion(regionId);
  if (!region?.packs?.[packId]) return 0;
  if (jobs.has(regionId)) throw new Error('Pause the download first.');
  const freed = await releaseRegionLayer(regionId, region.packs[packId].layerId);
  const packs = { ...region.packs };
  delete packs[packId];
  emit(await patchRegion(regionId, { packs }));
  return freed;
}

export function cancelDownload(regionId) {
  const ctrl = jobs.get(regionId);
  if (ctrl) ctrl.abort();
}

/** Pause: stop now, keep everything downloaded so far; Resume continues where it stopped. */
export function pauseDownload(regionId) {
  const ctrl = jobs.get(regionId);
  if (ctrl) {
    ctrl.paused = true;
    ctrl.abort();
  }
}

async function fetchTile(provider, z, x, y, signal) {
  const url = buildTileUrl(provider, z, x, y);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, { signal, credentials: 'omit', cache: 'no-store' });
      // 404/204: the server has no tile here (e.g. outside its coverage). Not an error.
      if (res.status === 404 || res.status === 204) return null;
      if (res.ok) {
        const blob = await res.blob();
        return blob.size > 0 ? blob : null;
      }
      const err = new Error(`Tile server answered HTTP ${res.status}`);
      err.retryable = res.status === 429 || res.status >= 500;
      throw err;
    } catch (err) {
      if (signal.aborted) throw err;
      const retryable = err.retryable !== false; // network errors (TypeError) are retryable
      if (!retryable || attempt >= MAX_RETRIES) throw err;
      await sleep(500 * 2 ** attempt);
    }
  }
}

/**
 * Download every tile of one layer inside bounds (zoom zFrom..zTo) into IndexedDB for regionId.
 * Tiles already on the device are only referenced (dedup / resume). Returns counters and, if it
 * had to stop early, { status, message }.
 */
async function downloadTileSet({ regionId, layerId, source, bounds, zFrom, zTo, compress, controller, onProgress }) {
  const counters = { doneCount: 0, missingCount: 0, failedCount: 0, size: 0 };
  let stopped = null;
  const tiles = iterateTiles(bounds, zFrom, zTo);
  const stop = (status, message) => {
    if (!stopped) stopped = { status, message };
    controller.abort();
  };

  async function worker() {
    while (!controller.signal.aborted) {
      const next = tiles.next(); // generators are synchronous, so workers never get the same tile
      if (next.done) return;
      const { z, x, y } = next.value;
      const key = tileKey(layerId, z, x, y);
      try {
        const existing = await addRegionRef(key, regionId);
        if (existing) {
          counters.size += existing.size || 0; // duplicate tile: already on the device
        } else {
          if (!navigator.onLine) {
            stop('interrupted', 'The internet connection was lost. Resume the download when you are back online.');
            return;
          }
          const blob = await fetchTile(source, z, x, y, controller.signal);
          if (blob) {
            const stored = compress ? await compressBlob(blob) : { blob, encoding: null };
            await putTile(key, stored.blob, regionId, stored.encoding);
            counters.size += stored.blob.size;
          } else {
            counters.missingCount += 1;
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        if (isQuotaError(err)) {
          stop('failed', 'Browser storage is full. Delete other downloaded maps and resume this download.');
          return;
        }
        if (!navigator.onLine) {
          stop('interrupted', 'The internet connection was lost. Resume the download when you are back online.');
          return;
        }
        counters.failedCount += 1;
        console.warn(`[download] tile ${z}/${x}/${y} failed:`, err.message);
      }
      counters.doneCount += 1;
      await onProgress(counters);
    }
  }

  await Promise.all(Array.from({ length: DOWNLOAD_LIMITS.concurrency }, worker));
  return { counters, stopped };
}

function finalStatus(controller, stopped, counters, noDataMessage) {
  if (stopped) return { status: stopped.status, error: stopped.message };
  if (controller.paused) return { status: 'paused', error: 'Paused. Resume to continue - tiles already downloaded are kept.' };
  if (controller.signal.aborted) return { status: 'cancelled', error: 'Download cancelled. You can resume it or delete it.' };
  if (counters.failedCount > 0) return { status: 'partial', error: `${counters.failedCount} tile(s) could not be downloaded. Retry to fetch them.` };
  if (counters.doneCount > 0 && counters.missingCount === counters.doneCount) return { status: 'failed', error: noDataMessage };
  return { status: 'completed', error: null };
}

async function run(region, provider, { packsOnly = false } = {}) {
  const controller = new AbortController();
  jobs.set(region.id, controller);
  let current = region;

  try {
    // 1. The map itself (vector or raster tiles of the chosen provider).
    if (!packsOnly) {
      let lastPersist = 0;
      const { counters, stopped } = await downloadTileSet({
        regionId: region.id,
        layerId: region.layerId,
        source: provider,
        bounds: region.bounds,
        // Older records (before data zooms existed) used the display zooms directly.
        zFrom: region.dataZoomMin ?? region.zoomMin,
        zTo: region.dataZoomMax ?? region.zoomMax,
        compress: provider.kind === 'vector',
        controller,
        onProgress: async (c) => {
          emit({ ...current, ...c, status: 'downloading' });
          const now = Date.now();
          if (now - lastPersist >= PERSIST_EVERY_MS) {
            lastPersist = now;
            await patchRegion(region.id, c);
          }
        },
      });
      const { status, error } = finalStatus(controller, stopped, counters, 'The map server had no data for this area. Choose an area inside the server’s coverage.');
      current = await patchRegion(region.id, { ...counters, status, error });
      if (!current) return; // deleted while downloading
      emit(current);

      if (status === 'completed' || status === 'partial') {
        queueMapCreate(current).catch((e) => console.warn('[download] could not queue sync', e));
        if (provider.kind === 'vector') buildSearchIndex(current.id);
        if (current.wantRouting && current.routing?.status !== 'completed') {
          downloadRoutingData(current.id).catch((e) => console.warn('[download] road data failed:', e.message));
        }
      }
      if (status !== 'completed' && status !== 'partial') return; // paused / cancelled / failed: packs wait
    }

    // 2. Optional data packs (satellite imagery, terrain), one after another.
    for (const [packId, pack] of Object.entries(current.packs || {})) {
      if (pack.status === 'completed' || controller.signal.aborted) continue;
      const def = PACKS[packId];
      if (!def) continue;
      let lastPersist = 0;
      const setPack = (patch) => ({ ...current, packs: { ...current.packs, [packId]: { ...current.packs[packId], ...patch } } });
      emit(setPack({ status: 'downloading', error: null }));
      const { counters, stopped } = await downloadTileSet({
        regionId: region.id,
        layerId: def.source.layerId,
        source: def.source,
        bounds: current.bounds,
        zFrom: pack.zoomMin,
        zTo: pack.zoomMax,
        compress: false, // JPEG / PNG are already compressed
        controller,
        onProgress: async (c) => {
          emit(setPack({ ...c, status: 'downloading' }));
          const now = Date.now();
          if (now - lastPersist >= PERSIST_EVERY_MS) {
            lastPersist = now;
            const fresh = await getRegion(region.id);
            if (fresh) await patchRegion(region.id, { packs: { ...fresh.packs, [packId]: { ...fresh.packs?.[packId], ...c, status: 'downloading' } } });
          }
        },
      });
      const { status, error } = finalStatus(controller, stopped, counters, `${def.label}: the source has no data for this area.`);
      const fresh = await getRegion(region.id);
      if (!fresh) return;
      current = await patchRegion(region.id, { packs: { ...fresh.packs, [packId]: { ...fresh.packs?.[packId], ...counters, status, error } } });
      emit(current);
      window.dispatchEvent(new CustomEvent('innermap:packs-changed'));
    }
  } finally {
    jobs.delete(region.id);
    // one more update so pages see the job has ended (Pause/Cancel buttons go away)
    getRegion(region.id).then((r) => r && emit(r)).catch(() => {});
  }
}

/** Called on start-up: a download that was running when the tab closed is now "interrupted". */
export async function recoverInterruptedDownloads(userId) {
  const regions = await listRegions(userId);
  await Promise.all(
    regions
      .filter((r) => (r.status === 'downloading' || Object.values(r.packs || {}).some((p) => p.status === 'downloading')) && !jobs.has(r.id))
      .map((r) =>
        patchRegion(r.id, {
          ...(r.status === 'downloading' ? { status: 'interrupted', error: 'The download was interrupted (the app was closed). Resume it to finish.' } : {}),
          packs: Object.fromEntries(
            Object.entries(r.packs || {}).map(([k, p]) => [k, p.status === 'downloading' ? { ...p, status: 'interrupted', error: 'Interrupted (the app was closed). Resume to finish.' } : p])
          ),
        })
      )
  );
}

/** Delete a downloaded area and free the tiles nobody else uses. */
export async function deleteRegion(regionId) {
  const ctrl = jobs.get(regionId);
  if (ctrl) {
    ctrl.abort();
    // Let in-flight workers settle before releasing tiles.
    while (jobs.has(regionId)) await sleep(50);
  }
  const region = await getRegion(regionId);
  deletedIds.add(regionId);
  const freed = await releaseRegion(regionId);
  await deleteRoutingData(regionId);
  await releaseSearchIndex(regionId).catch((e) => console.warn('[search] release failed:', e.message));
  await deleteRegionRecord(regionId);
  if (region) await queueMapDelete(region);
  emit({ id: regionId, deleted: true });
  return freed;
}
