// Road graphs for offline directions, one per downloaded area, in IndexedDB.
// (Graphs can be a few MB; they never go to MySQL.)
import { getDB } from './db';

/** Metadata only (no graph), for lists and coverage checks. */
export async function listRoutingData(userId) {
  const db = await getDB();
  const all = await db.getAllFromIndex('routing', 'userId', userId);
  return all.map(({ graph, ...meta }) => meta);
}

export async function getRoutingData(regionId) {
  const db = await getDB();
  return db.get('routing', regionId);
}

export async function saveRoutingData(rec) {
  const db = await getDB();
  await db.put('routing', rec);
  window.dispatchEvent(new CustomEvent('innermap:routing-changed'));
}

export async function deleteRoutingData(regionId) {
  const db = await getDB();
  await db.delete('routing', regionId);
  window.dispatchEvent(new CustomEvent('innermap:routing-changed'));
}
