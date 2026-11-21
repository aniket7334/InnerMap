// Registers public/service-worker.js.
// Only in production builds (`npm run build` + `npm run preview`): in `npm run dev`
// Vite serves source modules with hot reload, which must not be cached.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Inside the Android app (Capacitor) the app files are part of the app itself: no worker needed.
  if (window.Capacitor?.isNativePlatform?.()) return;

  if (!import.meta.env.PROD) {
    // Remove a worker left over from a previous production test on the same origin.
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    return;
  }

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'activated') console.info('[sw] Inner Map is ready to work offline.');
        });
      });
    } catch (err) {
      console.error('[sw] registration failed', err);
    }
  });
}
