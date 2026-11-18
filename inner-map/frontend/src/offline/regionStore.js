// Downloaded-area records ("regions") kept on this device.
import { getDB } from './db';

export async function listRegions(userId) {
  const db = await getDB();
  const all = await db.getAllFromIndex('regions', 'userId', userId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listAllRegionIds() {
  const db = await getDB();
  return db.getAllKeys('regions');
}

export async function getRegion(id) {
  const db = await getDB();
  return db.get('regions', id);
}

export async function saveRegion(region) {
  const db = await getDB();
  await db.put('regions', { ...region, updatedAt: Date.now() });
  return region;
}

export async function patchRegion(id, patch) {
  const db = await getDB();
  const tx = db.transaction('regions', 'readwrite');
  const current = await tx.store.get(id);
  if (!current) {
    await tx.done;
    return null;
  }
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function deleteRegionRecord(id) {
  const db = await getDB();
  await db.delete('regions', id);
}
