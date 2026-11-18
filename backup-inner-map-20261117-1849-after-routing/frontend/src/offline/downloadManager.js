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
import { getProvider, providerForRegion, buildTileUrl, downloadZoomRange, DOWNLOAD_LIMITS } from '../maps/providers';
import { countTiles, iterateTiles, tileKey } from '../maps/tileMath';
import { uuid } from './db';
import { addRegionRef, putTile, releaseRegion, compressBlob } from './tileStore';
import { saveRegion, getRegion, patchRegion, listRegions, deleteRegionRecord } from './regionStore';
import { getStorageEstimate, requestPersistentStorage, isQuotaError } from './storage';
import { queueMapCreate, queueMapDelete } from './syncService';
import { saveRoutingData, deleteRoutingData } from './routingStore';
import { fetchRoadGraph } from '../services/routingApi';

const MAX_RETRIES = 3;
const PERSIST_EVERY_MS = 1000;

const jobs = new Map(); // regionId -> AbortController
const listeners = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function subscribeDownloads(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(region) {
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
    emit(await patchRegion(regionId, { routing: { status: 'completed', bytes, edges: graph.edgeA.length } }));
  } catch (err) {
    const message = err.response?.data?.message || err.message || 'Download failed';
    emit(await patchRegion(regionId, { routing: { status: 'failed', error: message } }));
    throw new Error(message);
  }
}

export async function startDownload({ userId, name, bounds, zoomMin, zoomMax, providerId, withRouting = false }) {
  const provider = getProvider(providerId);
  const zMin = Math.max(provider.minZoom, zoomMin);
  const zMax = provider.kind === 'vector' ? provider.maxZoom : Math.min(provider.maxZoom, zoomMax);
  if (zMin > zMax) throw new Error('Minimum zoom must not exceed maximum zoom.');
  const { tiles: tileCount, dataZoomMin, dataZoomMax } = estimateDownload(provider, bounds, zMin, zMax);
  await preflight(provider, tileCount);

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
  await preflight(provider, region.tileCount);
  const next = await patchRegion(regionId, { status: 'downloading', error: null });
  emit(next);
  run(next, provider);
  return next;
}

export function cancelDownload(regionId) {
  const ctrl = jobs.get(regionId);
  if (ctrl) ctrl.abort();
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

async function run(region, provider) {
  const controller = new AbortController();
  jobs.set(region.id, controller);

  const counters = { doneCount: 0, missingCount: 0, failedCount: 0, size: 0 };
  let stopStatus = null; // 'failed' | 'interrupted' when the job must stop early
  let stopMessage = null;
  let lastPersist = 0;
  // Older records (before data zooms existed) used the display zooms directly.
  const zFrom = region.dataZoomMin ?? region.zoomMin;
  const zTo = region.dataZoomMax ?? region.zoomMax;
  const tiles = iterateTiles(region.bounds, zFrom, zTo);
  const compress = provider.kind === 'vector';

  const progress = async (force = false) => {
    emit({ ...region, ...counters, status: 'downloading' });
    const now = Date.now();
    if (force || now - lastPersist >= PERSIST_EVERY_MS) {
      lastPersist = now;
      await patchRegion(region.id, counters);
    }
  };

  const stop = (status, message) => {
    if (!stopStatus) {
      stopStatus = status;
      stopMessage = message;
    }
    controller.abort();
  };

  async function worker() {
    while (!controller.signal.aborted) {
      const next = tiles.next(); // generators are synchronous, so workers never get the same tile
      if (next.done) return;
      const { z, x, y } = next.value;
      const key = tileKey(region.layerId, z, x, y);
      try {
        const existing = await addRegionRef(key, region.id);
        if (existing) {
          counters.size += existing.size || 0; // duplicate tile: already on the device
        } else {
          if (!navigator.onLine) {
            stop('interrupted', 'The internet connection was lost. Resume the download when you are back online.');
            return;
          }
          const blob = await fetchTile(provider, z, x, y, controller.signal);
          if (blob) {
            const stored = compress ? await compressBlob(blob) : { blob, encoding: null };
            await putTile(key, stored.blob, region.id, stored.encoding);
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
      await progress();
    }
  }

  try {
    await Promise.all(Array.from({ length: DOWNLOAD_LIMITS.concurrency }, worker));
  } finally {
    jobs.delete(region.id);
  }

  let status;
  let error = null;
  if (stopStatus) {
    status = stopStatus;
    error = stopMessage;
  } else if (controller.signal.aborted) {
    status = 'cancelled';
    error = 'Download cancelled. You can resume it or delete it.';
  } else if (counters.failedCount > 0) {
    status = 'partial';
    error = `${counters.failedCount} tile(s) could not be downloaded. Resume to retry them.`;
  } else if (counters.missingCount === counters.doneCount) {
    status = 'failed';
    error = 'The map server had no data for this area. Choose an area inside the server’s coverage.';
  } else {
    status = 'completed';
  }

  const finalRegion = await patchRegion(region.id, { ...counters, status, error });
  if (!finalRegion) return; // deleted while downloading
  emit(finalRegion);

  if (status === 'completed' || status === 'partial') {
    queueMapCreate(finalRegion).catch((e) => console.warn('[download] could not queue sync', e));
    if (finalRegion.wantRouting && finalRegion.routing?.status !== 'completed') {
      downloadRoutingData(finalRegion.id).catch((e) => console.warn('[download] road data failed:', e.message));
    }
  }
}

/** Called on start-up: a download that was running when the tab closed is now "interrupted". */
export async function recoverInterruptedDownloads(userId) {
  const regions = await listRegions(userId);
  await Promise.all(
    regions
      .filter((r) => r.status === 'downloading' && !jobs.has(r.id))
      .map((r) =>
        patchRegion(r.id, {
          status: 'interrupted',
          error: 'The download was interrupted (the app was closed). Resume it to finish.',
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
  const freed = await releaseRegion(regionId);
  await deleteRoutingData(regionId);
  await deleteRegionRecord(regionId);
  if (region) await queueMapDelete(region);
  emit({ id: regionId, deleted: true });
  return freed;
}
