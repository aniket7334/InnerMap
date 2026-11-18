// Stores CesiumJS's files (web workers, built-in Natural Earth imagery, widget images,
// Earth orientation data) in the browser's Cache Storage so the 3D globe opens without
// internet. The service worker answers /cesium/* requests from this cache.
const CACHE = 'inner-map-cesium';
const MANIFEST = '/cesium/manifest.json';
const CONCURRENCY = 6;

async function cachedManifest(cache) {
  const res = await cache.match(MANIFEST);
  return res ? res.json() : null;
}

/** { ready, version, bytes, files, upToDate } */
export async function getGlobeOfflineStatus() {
  if (!('caches' in window)) return { supported: false, ready: false };
  const cache = await caches.open(CACHE);
  const manifest = await cachedManifest(cache);
  if (!manifest) return { supported: true, ready: false };
  const keys = await cache.keys();
  const ready = keys.length >= manifest.files.length; // manifest itself is +1
  let upToDate = true;
  if (navigator.onLine) {
    try {
      const live = await (await fetch(MANIFEST, { cache: 'no-store' })).json();
      upToDate = live.version === manifest.version;
    } catch {
      /* offline or server down: assume current */
    }
  }
  return { supported: true, ready, upToDate, version: manifest.version, bytes: manifest.bytes, files: manifest.files.length };
}

/** Download every Cesium file into the cache. onProgress(done, total). */
export async function makeGlobeAvailableOffline(onProgress = () => {}) {
  if (!navigator.onLine) throw new Error('Connect to the internet (or your Inner Map server) first.');
  const res = await fetch(MANIFEST, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not read the list of 3D globe files from the server.');
  const manifest = await res.clone().json();

  // A new Cesium version: start from a clean cache.
  const old = await cachedManifest(await caches.open(CACHE));
  if (old && old.version !== manifest.version) await caches.delete(CACHE);
  const cache = await caches.open(CACHE);

  const queue = [...manifest.files];
  let done = 0;
  const total = queue.length;
  onProgress(done, total);
  const worker = async () => {
    while (queue.length) {
      const url = queue.shift();
      if (!(await cache.match(url))) {
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error(`Could not download ${url} (HTTP ${r.status}).`);
        await cache.put(url, r);
      }
      done += 1;
      onProgress(done, total);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await cache.put(MANIFEST, res); // written last: its presence means "complete"
  return getGlobeOfflineStatus();
}

export async function removeGlobeOffline() {
  await caches.delete(CACHE);
}
