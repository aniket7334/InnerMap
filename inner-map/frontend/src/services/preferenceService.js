import api from './api';
import { isApiReachable } from '../offline/connectivity';
import { enqueue, removeFromOutbox } from '../offline/syncService';

export async function fetchPreferences() {
  if (!isApiReachable()) return null;
  const { data } = await api.get('/preferences');
  return data.preferences;
}

/** Save preference changes. Queued in the outbox, so it also works offline. */
export async function savePreferences(userId, fields) {
  // Only the latest pending change matters; drop older queued ones for the same fields.
  await removeFromOutbox(
    userId,
    (op) => op.type === 'preferences:update' && Object.keys(op.payload).every((k) => k in fields)
  );
  await enqueue(userId, 'preferences:update', fields);
}
