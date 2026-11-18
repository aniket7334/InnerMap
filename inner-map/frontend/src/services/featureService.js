// Geographical feature layers (imported KML/KMZ/GeoJSON files and the user's drawings),
// offline-first like saved places:
//   - everything is written to IndexedDB first, so it works and shows offline
//   - changes are queued in the outbox and replayed to /api/layers and /api/features
//   - when online, layers created or changed on other devices are pulled in
import api from './api';
import { getDB, uuid } from '../offline/db';
import { isApiReachable } from '../offline/connectivity';
import { enqueue, flushOutbox, listOutbox, removeFromOutbox, registerSyncHandler } from '../offline/syncService';
import { featuresBounds } from '../features/kml';

const CHUNK = 1000; // server accepts up to 1000 features per request
const DRAWN_LAYER_NAME = 'My drawings';

function changed() {
  window.dispatchEvent(new CustomEvent('innermap:features-changed'));
}

const toApi = (f) => ({ name: f.name, description: f.description, geometry: f.geometry, style: f.style });

// ------------------------------------------------------------------ reads ---

export async function listLayers(userId) {
  const db = await getDB();
  const layers = await db.getAllFromIndex('layers', 'userId', userId);
  return layers.sort((a, b) => (a.source === b.source ? b.createdAt - a.createdAt : a.source === 'drawn' ? -1 : 1));
}

export async function getLayerFeatures(layerLocalId) {
  const db = await getDB();
  const list = await db.getAllFromIndex('features', 'layerLocalId', layerLocalId);
  return list.sort((a, b) => a.order - b.order);
}

/** Visible layers with their features, for drawing on the map. */
export async function getVisibleCollections(userId) {
  const layers = (await listLayers(userId)).filter((l) => l.visible);
  return Promise.all(layers.map(async (layer) => ({ layer, features: await getLayerFeatures(layer.localId) })));
}

// ----------------------------------------------------------------- writes ---

async function updateLayerStats(db, layerLocalId) {
  const layer = await db.get('layers', layerLocalId);
  if (!layer) return;
  const features = await db.getAllFromIndex('features', 'layerLocalId', layerLocalId);
  await db.put('layers', { ...layer, featureCount: features.length, bounds: featuresBounds(features) });
}

/** Store an imported file as a new layer. */
export async function importLayer(userId, { name, fileName, format, features }) {
  const db = await getDB();
  const layer = {
    localId: uuid(),
    serverId: null,
    userId,
    name: name.slice(0, 100),
    source: 'imported',
    fileName,
    format,
    visible: true,
    pending: true,
    featureCount: features.length,
    bounds: featuresBounds(features),
    createdAt: Date.now(),
  };
  const tx = db.transaction(['layers', 'features'], 'readwrite');
  await tx.objectStore('layers').put(layer);
  for (let i = 0; i < features.length; i += 1) {
    await tx.objectStore('features').put({
      ...features[i],
      localId: uuid(),
      serverId: null,
      userId,
      layerLocalId: layer.localId,
      order: i,
      pending: true,
    });
  }
  await tx.done;
  await enqueue(userId, 'layer:create', { localId: layer.localId });
  changed();
  return layer;
}

/** The user's single "My drawings" layer (created on first use). */
async function getDrawnLayer(userId) {
  const db = await getDB();
  const existing = (await db.getAllFromIndex('layers', 'userId', userId)).find((l) => l.source === 'drawn');
  if (existing) return existing;
  const layer = {
    localId: uuid(),
    serverId: null,
    userId,
    name: DRAWN_LAYER_NAME,
    source: 'drawn',
    fileName: null,
    visible: true,
    pending: true,
    featureCount: 0,
    bounds: null,
    createdAt: Date.now(),
  };
  await db.put('layers', layer);
  await enqueue(userId, 'layer:create', { localId: layer.localId });
  return layer;
}

/** Save a marker / path / polygon drawn on the map. */
export async function addDrawnFeature(userId, { name, description = null, geometry, style }) {
  const layer = await getDrawnLayer(userId);
  const db = await getDB();
  const existing = await db.getAllFromIndex('features', 'layerLocalId', layer.localId);
  const rec = {
    localId: uuid(),
    serverId: null,
    userId,
    layerLocalId: layer.localId,
    order: existing.reduce((m, f) => Math.max(m, f.order), -1) + 1,
    name: name.trim().slice(0, 255),
    description,
    geometry,
    style,
    pending: true,
  };
  await db.put('features', rec);
  await db.put('layers', { ...(await db.get('layers', layer.localId)), visible: true });
  await updateLayerStats(db, layer.localId);
  await enqueue(userId, 'feature:create', { localId: rec.localId });
  changed();
  return rec;
}

export async function renameFeature(userId, localId, name) {
  const db = await getDB();
  const rec = await db.get('features', localId);
  if (!rec) return;
  await db.put('features', { ...rec, name: name.trim().slice(0, 255), pending: true });
  if (rec.serverId) await enqueue(userId, 'feature:update', { localId });
  changed();
}

export async function deleteFeature(userId, localId) {
  const db = await getDB();
  const rec = await db.get('features', localId);
  if (!rec) return;
  await db.delete('features', localId);
  await updateLayerStats(db, rec.layerLocalId);
  if (rec.serverId) await enqueue(userId, 'feature:delete', { serverId: rec.serverId });
  else await removeFromOutbox(userId, (op) => op.payload?.localId === localId);
  changed();
}

export async function setLayerVisible(localId, visible) {
  const db = await getDB();
  const layer = await db.get('layers', localId);
  if (layer) await db.put('layers', { ...layer, visible });
  changed();
}

export async function renameLayer(userId, localId, name) {
  const db = await getDB();
  const layer = await db.get('layers', localId);
  if (!layer) return;
  await db.put('layers', { ...layer, name: name.trim().slice(0, 100) });
  if (layer.serverId) await enqueue(userId, 'layer:rename', { localId });
  changed();
}

export async function deleteLayer(userId, localId) {
  const db = await getDB();
  const layer = await db.get('layers', localId);
  if (!layer) return;
  const features = await db.getAllFromIndex('features', 'layerLocalId', localId);
  const tx = db.transaction(['layers', 'features'], 'readwrite');
  for (const f of features) await tx.objectStore('features').delete(f.localId);
  await tx.objectStore('layers').delete(localId);
  await tx.done;
  if (layer.serverId) {
    // Deleting the layer on the server deletes its features too (ON DELETE CASCADE).
    const featureIds = new Set(features.map((f) => f.localId));
    await removeFromOutbox(userId, (op) => featureIds.has(op.payload?.localId));
    await enqueue(userId, 'layer:delete', { serverId: layer.serverId });
  } else {
    const ids = new Set([localId, ...features.map((f) => f.localId)]);
    await removeFromOutbox(userId, (op) => ids.has(op.payload?.localId));
  }
  changed();
}

// ------------------------------------------------------------------- sync ---

async function uploadMissingFeatures(db, layer) {
  const features = (await db.getAllFromIndex('features', 'layerLocalId', layer.localId))
    .filter((f) => !f.serverId)
    .sort((a, b) => a.order - b.order);
  for (let i = 0; i < features.length; i += CHUNK) {
    const chunk = features.slice(i, i + CHUNK);
    const { data } = await api.post(`/layers/${layer.serverId}/features`, { features: chunk.map(toApi) });
    await saveServerIds(db, chunk, data.featureIds);
  }
}

async function saveServerIds(db, chunk, ids) {
  const tx = db.transaction('features', 'readwrite');
  for (let k = 0; k < chunk.length; k += 1) {
    const fresh = await tx.store.get(chunk[k].localId);
    if (fresh) await tx.store.put({ ...fresh, serverId: ids[k], pending: false });
  }
  await tx.done;
}

registerSyncHandler('layer:create', async ({ localId }, db) => {
  let layer = await db.get('layers', localId);
  if (!layer) return;
  if (!layer.serverId) {
    const features = (await db.getAllFromIndex('features', 'layerLocalId', localId)).sort((a, b) => a.order - b.order);
    const first = features.slice(0, CHUNK);
    const { data } = await api.post('/layers', {
      name: layer.name,
      source: layer.source,
      fileName: layer.fileName,
      features: first.map(toApi),
    });
    layer = { ...(await db.get('layers', localId)), serverId: data.layer.id, pending: false, serverUpdatedAt: data.layer.updatedAt };
    await db.put('layers', layer);
    await saveServerIds(db, first, data.featureIds);
  }
  // Any features beyond the first chunk (or added while the create was in flight).
  await uploadMissingFeatures(db, layer);
  changed();
});

registerSyncHandler('layer:rename', async ({ localId }, db) => {
  const layer = await db.get('layers', localId);
  if (!layer?.serverId) return;
  await api.put(`/layers/${layer.serverId}`, { name: layer.name });
});

registerSyncHandler('layer:delete', async ({ serverId }) => {
  await api.delete(`/layers/${serverId}`);
});

registerSyncHandler('feature:create', async ({ localId }, db) => {
  const rec = await db.get('features', localId);
  if (!rec || rec.serverId) return;
  const layer = await db.get('layers', rec.layerLocalId);
  if (!layer?.serverId) return; // the layer's own create op uploads it
  const { data } = await api.post(`/layers/${layer.serverId}/features`, { features: [toApi(rec)] });
  await saveServerIds(db, [rec], data.featureIds);
  changed();
});

registerSyncHandler('feature:update', async ({ localId }, db) => {
  const rec = await db.get('features', localId);
  if (!rec?.serverId) return;
  await api.put(`/features/${rec.serverId}`, toApi(rec));
  await db.put('features', { ...rec, pending: false });
});

registerSyncHandler('feature:delete', async ({ serverId }) => {
  await api.delete(`/features/${serverId}`);
});

async function replaceLayerFeatures(db, layerLocalId, userId, serverFeatures) {
  const tx = db.transaction('features', 'readwrite');
  const old = await tx.store.index('layerLocalId').getAllKeys(layerLocalId);
  for (const k of old) await tx.store.delete(k);
  for (let i = 0; i < serverFeatures.length; i += 1) {
    const f = serverFeatures[i];
    await tx.store.put({
      localId: uuid(),
      serverId: f.id,
      userId,
      layerLocalId,
      order: i,
      name: f.name,
      description: f.description,
      geometry: f.geometry,
      style: f.style,
      pending: false,
    });
  }
  await tx.done;
}

/**
 * Pull layers from the server: adds layers made on other devices, refreshes layers whose
 * server copy changed, and removes layers deleted elsewhere. Local unsynced work is kept.
 */
export async function refreshLayers(userId) {
  if (!isApiReachable()) return;
  await flushOutbox();
  const outbox = await listOutbox(userId);
  const pendingDeletes = new Set(outbox.filter((op) => op.type === 'layer:delete').map((op) => op.payload.serverId));
  const busyLayers = new Set(); // layers with unsynced local changes - do not overwrite them
  const db = await getDB();
  for (const op of outbox) {
    if (op.payload?.localId) {
      const f = await db.get('features', op.payload.localId);
      busyLayers.add(f ? f.layerLocalId : op.payload.localId);
    }
  }

  const { data } = await api.get('/layers');
  const local = await db.getAllFromIndex('layers', 'userId', userId);
  const byServerId = new Map(local.filter((l) => l.serverId).map((l) => [l.serverId, l]));
  const serverIds = new Set(data.layers.map((l) => l.id));
  let touched = false;

  for (const s of data.layers) {
    if (pendingDeletes.has(s.id)) continue;
    const mine = byServerId.get(s.id);
    if (mine && (mine.serverUpdatedAt === s.updatedAt || busyLayers.has(mine.localId))) continue;
    const { data: detail } = await api.get(`/layers/${s.id}/features`);
    const layer = mine || {
      localId: uuid(),
      serverId: s.id,
      userId,
      source: s.source,
      fileName: s.fileName,
      format: { kml: 'KML', kmz: 'KMZ', geojson: 'GeoJSON', json: 'GeoJSON' }[
        (s.fileName || '').split('.').pop().toLowerCase()
      ],
      visible: true,
      pending: false,
      createdAt: new Date(s.createdAt).getTime(),
    };
    await replaceLayerFeatures(db, layer.localId, userId, detail.features);
    await db.put('layers', {
      ...layer,
      name: s.name,
      serverUpdatedAt: s.updatedAt,
      featureCount: detail.features.length,
      bounds: featuresBounds(detail.features.filter((f) => f.geometry)),
    });
    touched = true;
  }

  // Deleted on the server (e.g. from another device) and not pending here -> remove locally.
  for (const l of local) {
    if (l.serverId && !serverIds.has(l.serverId) && !busyLayers.has(l.localId)) {
      const keys = await db.getAllKeysFromIndex('features', 'layerLocalId', l.localId);
      const tx = db.transaction(['layers', 'features'], 'readwrite');
      for (const k of keys) await tx.objectStore('features').delete(k);
      await tx.objectStore('layers').delete(l.localId);
      await tx.done;
      touched = true;
    }
  }
  if (touched) changed();
}
