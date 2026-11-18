// Browser storage quota helpers (StorageManager API).

export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return { usage: null, quota: null, available: null };
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota, available: Math.max(0, quota - usage) };
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function isPersisted() {
  return navigator.storage?.persisted ? navigator.storage.persisted() : false;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function isQuotaError(err) {
  return (
    err &&
    (err.name === 'QuotaExceededError' ||
      err.code === 22 ||
      err.code === 1014 ||
      /quota/i.test(err.message || ''))
  );
}
