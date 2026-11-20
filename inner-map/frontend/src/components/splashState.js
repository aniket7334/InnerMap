// Shared state of the Earth loading screen. The loading screen is drawn by GlobeLoader (so one
// animation runs without restarting while the 3D code downloads and while the globe loads), and
// the Earth page reports its real progress here.
//   phase:    'loading' -> 'leaving' (globe ready: the loading screen hands over) -> 'gone'
//   progress: 0..1 of the real loading steps
//   handover: where the real globe's camera is when it takes over (so the 3D loading screen
//             can end on exactly the same view): { lng, lat, height, fovy, rect }
//   mode:     '3d' (the orbit loading screen) or '2d' (the light one)
import { useSyncExternalStore } from 'react';

const initial = () => ({ phase: 'loading', progress: 0, step: 'Starting the 3D engine', handover: null, mode: '2d', startedAt: performance.now() });

/** Shortest time the loading screen shows, so its animation plays in full even when the globe
 *  loads at once (from the cache): 3D orbit / light version. Slower loading simply takes longer. */
export const MIN_SHOW_MS = { '3d': 5200, '2d': 2500 };

/** Loading step shown for a progress value (the bar and the text always agree). */
export function stepFor(p) {
  if (p < 0.35) return 'Starting the 3D engine';
  if (p < 0.8) return 'Loading satellite imagery';
  if (p < 0.995) return 'Placing country and city names';
  return 'Ready';
}
let state = initial();
const listeners = new Set();

export const splashState = {
  get: () => state,
  set(patch) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  reset(mode = '2d') {
    state = { ...initial(), mode };
    listeners.forEach((l) => l());
  },
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

if (typeof window !== 'undefined') window.__innerMapSplash = splashState; // diagnostics in the browser console

export function useSplashState() {
  return useSyncExternalStore(splashState.subscribe, splashState.get);
}
