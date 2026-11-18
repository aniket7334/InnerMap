// Offline outbox: changes made without a server connection are stored in
// IndexedDB and replayed, in order, once the API is reachable again.
import { getDB } from './db';
import api from '../services/api';
import { getSessionUser } from '../services/authStorage';
import { isApiReachable, subscribe as subscribeConnectivity } from './connectivity';

const listeners = new Set();
let flushing = null;

export function subscribePending(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function getPendingCount(userId) {
  if (!userId) return 0;
  const db = await getDB();
  return db.countFromIndex('outbox', 'userId', userId);
}

async function notify() {
  const user = getSessionUser();
  const count = await getPendingCount(user?.id);
  listeners.forEach((fn) => fn(count));
}

export async function enqueue(userId, type, payload) {
  const db = await getDB();
  await db.add('outbox', { userId, type, payload, createdAt: Date.now() });
  await notify();
  flushOutbox();
}

export async function listOutbox(userId) {
  const db = await getDB();
  const ops = await db.getAllFromIndex('outbox', 'userId', userId);
  return ops.sort((a, b) => a.id - b.id);
}

/** Remove queued operations matching a predicate (e.g. a create that is no longer needed). */
export async function removeFromOutbox(userId, predicate) {
  const db = await getDB();
  const ops = await listOutbox(userId);
  await Promise.all(ops.filter(predicate).map((op) => db.delete('outbox', op.id)));
  await notify();
}

// ---- handlers: one per operation type -----------------------------------
const handlers = {
  async 'location:create'({ localId }, db) {
    const rec = await db.get('locations', localId);
    if (!rec || rec.serverId) return;
    const { data } = await api.post('/locations', {
      name: rec.name,
      latitude: rec.latitude,
      longitude: rec.longitude,
    });
    const fresh = await db.get('locations', localId);
    if (!fresh) {
      // Deleted locally while the request was in flight -> delete on server too.
      await api.delete(`/locations/${data.location.id}`);
      return;
    }
    await db.put('locations', { ...fresh, serverId: data.location.id, pending: false });
  },

  async 'location:update'({ localId }, db) {
    const rec = await db.get('locations', localId);
    if (!rec || !rec.serverId) return;
    await api.put(`/locations/${rec.serverId}`, {
      name: rec.name,
      latitude: rec.latitude,
      longitude: rec.longitude,
    });
    await db.put('locations', { ...rec, pending: false });
  },

  async 'location:delete'({ serverId }) {
    await api.delete(`/locations/${serverId}`);
  },

  async 'map:create'({ regionId }, db) {
    const region = await db.get('regions', regionId);
    if (!region || region.serverId) return;
    const { data } = await api.post('/maps', {
      mapName: region.name,
      region: region.bounds,
      zoomMin: region.zoomMin,
      zoomMax: region.zoomMax,
      storageSize: Math.round(region.size || 0),
      downloadStatus: region.status === 'completed' ? 'completed' : 'partial',
    });
    const fresh = await db.get('regions', regionId);
    if (fresh) {
      await db.put('regions', { ...fresh, serverId: data.map.id });
      window.dispatchEvent(new CustomEvent('innermap:regions-changed')); // refresh "Synced" badges
    }
  },

  async 'map:delete'({ serverId }) {
    await api.delete(`/maps/${serverId}`);
  },

  async 'history:batch'({ points }) {
    await api.post('/location-history', { points });
  },

  async 'preferences:update'(fields) {
    await api.put('/preferences', fields);
  },
};

/** Let feature modules add their own operation types without a circular import. */
export function registerSyncHandler(type, fn) {
  handlers[type] = fn;
}

async function doFlush() {
  const user = getSessionUser();
  if (!user || !isApiReachable()) return 0;
  const db = await getDB();
  const ops = await listOutbox(user.id);
  let processed = 0;

  for (const op of ops) {
    const handler = handlers[op.type];
    // A handler registered by a module that has not loaded yet: keep the op and stop here so
    // later ops (which may depend on it) are not replayed out of order.
    if (!handler) break;
    try {
      await handler(op.payload, db);
      await db.delete('outbox', op.id);
      processed += 1;
    } catch (err) {
      const status = err.response?.status;
      // Network problem, server error or expired session: keep the op and retry later.
      if (!status || status >= 500 || status === 401 || status === 429) break;
      // Any other 4xx (validation, 404 already deleted, 403 history disabled) can never succeed.
      console.warn(`[sync] dropping ${op.type}:`, err.response?.data?.message || err.message);
      await db.delete('outbox', op.id);
    }
  }
  await notify();
  return processed;
}

export function flushOutbox() {
  if (!flushing) flushing = doFlush().finally(() => (flushing = null));
  return flushing;
}

// ---- helpers used by the download manager ----------------------------------
export async function queueMapCreate(region) {
  await enqueue(region.userId, 'map:create', { regionId: region.id });
}

export async function queueMapDelete(region) {
  if (region.serverId) {
    await enqueue(region.userId, 'map:delete', { serverId: region.serverId });
  } else {
    await removeFromOutbox(region.userId, (op) => op.type === 'map:create' && op.payload.regionId === region.id);
  }
}

let started = false;
export function startSync() {
  if (started) return;
  started = true;
  subscribeConnectivity((s) => {
    if (s.apiReachable) flushOutbox();
  });
  flushOutbox();
}
