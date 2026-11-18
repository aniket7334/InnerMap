/* Inner Map service worker
 *
 * Caches the APPLICATION SHELL (HTML, JS, CSS, icons) so the app opens with no
 * internet. Map tiles are NOT handled here - they live in IndexedDB and are read
 * by the OfflineTileLayer. API calls are never cached here either; the app keeps
 * its own offline copies of user data.
 *
 * Bump CACHE_VERSION when you change this file's caching rules.
 */
const CACHE_VERSION = 'v4'; // v4: precache bundled font files
const SHELL_CACHE = `inner-map-shell-${CACHE_VERSION}`;
const SHELL_URLS = ['/', '/index.html', '/manifest.json', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

// Find the hashed bundles Vite injected into index.html so they are cached at install time.
async function discoverBuildAssets() {
  try {
    const res = await fetch('/index.html', { cache: 'no-store' });
    const html = await res.text();
    const urls = new Set();
    const re = /(?:src|href)="(\/assets\/[^"]+)"/g;
    let m;
    while ((m = re.exec(html))) urls.add(m[1]);
    // Bundled fonts (typography settings) are referenced from the CSS; precache the
    // .woff2 files so any font can be selected later while offline.
    for (const css of [...urls].filter((u) => u.endsWith('.css'))) {
      try {
        const text = await (await fetch(css)).text();
        const fontRe = /url\((?:["']?)(\/assets\/[^)"']+\.woff2)(?:["']?)\)/g;
        while ((m = fontRe.exec(text))) urls.add(m[1]);
      } catch {
        /* fonts will still be cached on first use */
      }
    }
    return [...urls];
  } catch {
    return [];
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL_URLS);
      const assets = await discoverBuildAssets();
      await Promise.all(assets.map((u) => cache.add(u).catch(() => undefined)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('inner-map-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // tile servers, geocoder: not ours to cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/tiles/')) return;
  if (url.pathname.startsWith('/globe-data/')) return; // optional local globe datasets: network only

  // CesiumJS files: served from the "inner-map-cesium" cache that the 3D Globe page's
  // "Make 3D globe available offline" button fills. Not runtime-cached here, so the ~7 MB
  // is only stored when the user asks for it. The manifest is network-first so updates show.
  if (url.pathname.startsWith('/cesium/')) {
    event.respondWith(
      (async () => {
        if (url.pathname === '/cesium/manifest.json') {
          try {
            return await fetch(request);
          } catch {
            return (await caches.match(url.pathname)) || new Response('{}', { status: 504 });
          }
        }
        const cached = await caches.match(url.pathname);
        if (cached) return cached;
        try {
          return await fetch(request);
        } catch {
          return new Response('', { status: 504, statusText: 'Offline' });
        }
      })()
    );
    return;
  }

  // Page navigations (any client-side route): network first, cached shell as fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = (await caches.match('/index.html')) || (await caches.match('/'));
          return cached || new Response('Inner Map is offline and the app is not cached yet.', { status: 503 });
        }
      })()
    );
    return;
  }

  // Static files: cache first (Vite file names are content-hashed), then network + store.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        if (res.ok && res.type === 'basic') {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(request, res.clone());
        }
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
