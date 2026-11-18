// Saved places, offline-first:
//  - the UI always reads from IndexedDB (instant, works offline)
//  - changes are written locally first, then queued for the server
//  - when the API is reachable, the server list is merged into the local cache
import api from './api';
import { getDB, uuid } from '../offline/db';
import { isApiReachable } from '../offline/connectivity';
import { enqueue, flushOutbox, listOutbox, removeFromOutbox } from '../offline/syncService';

export async function getCachedLocations(userId) {
  const db = await getDB();
  const all = await db.getAllFromIndex('locations', 'userId', userId);
  return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

/** Pull the server list and merge it into the local cache. Returns the merged list. */
export async function refreshLocations(userId) {
  if (!isApiReachable()) return getCachedLocations(userId);
  await flushOutbox(); // push local changes first

  const { data } = await api.get('/locations');
  const server = data.locations;
  const db = await getDB();
  const pendingDeletes = new Set(
    (await listOutbox(userId)).filter((op) => op.type === 'location:delete').map((op) => op.payload.serverId)
  );

  const tx = db.transaction('locations', 'readwrite');
  const local = await tx.store.index('userId').getAll(userId);
  const byServerId = new Map(local.filter((l) => l.serverId).map((l) => [l.serverId, l]));
  const serverIds = new Set(server.map((s) => s.id));

  for (const s of server) {
    if (pendingDeletes.has(s.id)) continue;
    const existing = byServerId.get(s.id);
    if (existing) {
      if (!existing.pending) {
        await tx.store.put({ ...existing, name: s.name, latitude: s.latitude, longitude: s.longitude });
      }
    } else {
      await tx.store.put({
        localId: uuid(),
        serverId: s.id,
        userId,
        name: s.name,
        latitude: s.latitude,
        longitude: s.longitude,
        createdAt: s.createdAt,
        pending: false,
      });
    }
  }
  // Deleted on the server (e.g. from another device) and not changed here -> drop locally.
  for (const l of local) {
    if (l.serverId && !serverIds.has(l.serverId) && !l.pending) await tx.store.delete(l.localId);
  }
  await tx.done;
  return getCachedLocations(userId);
}

export async function addLocation(userId, { name, latitude, longitude }) {
  const rec = {
    localId: uuid(),
    serverId: null,
    userId,
    name: name.trim(),
    latitude,
    longitude,
    createdAt: new Date().toISOString(),
    pending: true,
  };
  const db = await getDB();
  await db.put('locations', rec);
  await enqueue(userId, 'location:create', { localId: rec.localId });
  return rec;
}

export async function renameLocation(userId, localId, name) {
  const db = await getDB();
  const rec = await db.get('locations', localId);
  if (!rec) return null;
  const next = { ...rec, name: name.trim(), pending: true };
  await db.put('locations', next);
  // If not yet created on the server, the queued create will send the new name.
  if (rec.serverId) await enqueue(userId, 'location:update', { localId });
  return next;
}

export async function deleteLocation(userId, localId) {
  const db = await getDB();
  const rec = await db.get('locations', localId);
  if (!rec) return;
  await db.delete('locations', localId);
  if (rec.serverId) {
    await enqueue(userId, 'location:delete', { serverId: rec.serverId });
  } else {
    await removeFromOutbox(userId, (op) => op.payload?.localId === localId);
  }
}
