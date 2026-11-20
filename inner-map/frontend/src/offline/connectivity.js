// Connectivity detection.
//
// navigator.onLine only says "a network interface is up" (it is true on a Wi-Fi
// with no internet). So we also ping /api/health. Two flags come out of this:
//   online       - the device reports a network connection (tiles may be fetchable)
//   apiReachable - our backend answered; safe to call the API and sync
const PING_URL = `${import.meta.env.VITE_API_URL || '/api'}/health`;
const PING_INTERVAL = 30000;
const PING_TIMEOUT = 5000;

// Offline mode: the user can switch the app to offline on purpose (it then uses only data on
// this device and makes no network requests). Remembered on this device.
const OFFLINE_MODE_KEY = 'innermap.offline-mode';
function readOfflineMode() {
  try {
    return localStorage.getItem(OFFLINE_MODE_KEY) === 'on';
  } catch {
    return false;
  }
}

// real: what the network and the server actually do; state: what the app should act on
let real = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  apiReachable: false,
  lastChecked: null,
};
let offlineMode = readOfflineMode();
const derive = () => ({
  online: real.online && !offlineMode,
  apiReachable: real.apiReachable && !offlineMode,
  lastChecked: real.lastChecked,
  offlineMode,
  networkOnline: real.online, // the device's real connection (for "back online" notices)
});
let state = derive();
const listeners = new Set();
let timer = null;

function setState(patch) {
  const before = state;
  real = { ...real, ...patch };
  state = derive();
  const changed =
    state.online !== before.online ||
    state.apiReachable !== before.apiReachable ||
    state.offlineMode !== before.offlineMode ||
    state.networkOnline !== before.networkOnline ||
    (before.lastChecked === null && state.lastChecked !== null); // first result is always news
  if (changed) listeners.forEach((fn) => fn(state));
}

/** Switch offline mode on or off (off: check the connection again straight away). */
export function setOfflineMode(on) {
  offlineMode = Boolean(on);
  try {
    localStorage.setItem(OFFLINE_MODE_KEY, offlineMode ? 'on' : 'off');
  } catch {
    /* private window: lasts for this visit */
  }
  setState({});
  if (!offlineMode) checkNow();
}

export function isOfflineMode() {
  return offlineMode;
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
  if (offlineMode) {
    // offline mode: no network requests (not even the health check)
    setState({ online: navigator.onLine, lastChecked: Date.now() });
    return state;
  }
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
