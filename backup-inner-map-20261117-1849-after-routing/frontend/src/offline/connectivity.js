// Connectivity detection.
//
// navigator.onLine only says "a network interface is up" (it is true on a Wi-Fi
// with no internet). So we also ping /api/health. Two flags come out of this:
//   online       - the device reports a network connection (tiles may be fetchable)
//   apiReachable - our backend answered; safe to call the API and sync
const PING_URL = `${import.meta.env.VITE_API_URL || '/api'}/health`;
const PING_INTERVAL = 30000;
const PING_TIMEOUT = 5000;

let state = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  apiReachable: false,
  lastChecked: null,
};
const listeners = new Set();
let timer = null;

function setState(patch) {
  const next = { ...state, ...patch };
  const changed =
    next.online !== state.online ||
    next.apiReachable !== state.apiReachable ||
    (state.lastChecked === null && next.lastChecked !== null); // first result is always news
  state = next;
  if (changed) listeners.forEach((fn) => fn(state));
}

export function getConnectivity() {
  return state;
}

export function isOnline() {
  return state.online;
}

export function isApiReachable() {
  return state.online && state.apiReachable;
}

export async function checkNow() {
  if (!navigator.onLine) {
    setState({ online: false, apiReachable: false, lastChecked: Date.now() });
    return state;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PING_TIMEOUT);
  try {
    const res = await fetch(PING_URL, { cache: 'no-store', signal: ctrl.signal });
    setState({ online: true, apiReachable: res.ok, lastChecked: Date.now() });
  } catch {
    // The network interface is up but our server is not reachable.
    setState({ online: navigator.onLine, apiReachable: false, lastChecked: Date.now() });
  } finally {
    clearTimeout(t);
  }
  return state;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function startConnectivityMonitor() {
  if (timer) return;
  window.addEventListener('online', checkNow);
  window.addEventListener('offline', () => setState({ online: false, apiReachable: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkNow();
  });
  timer = setInterval(checkNow, PING_INTERVAL);
  checkNow();
}
