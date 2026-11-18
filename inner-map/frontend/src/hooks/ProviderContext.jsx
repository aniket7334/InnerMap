// Active map provider + what area the vector server has data for.
//
// The choice is kept in localStorage (so it applies offline straight away) and in the
// user_preferences table (so it follows the user to other devices).
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { PROVIDERS, DEFAULT_PROVIDER_ID, getProvider } from '../maps/providers';
import { useAuth } from './AuthContext';
import { subscribe } from '../offline/connectivity';
import { fetchPreferences, savePreferences } from '../services/preferenceService';

const ProviderContext = createContext(null);
const PROVIDER_KEY = 'innermap.provider';
const COVERAGE_KEY = 'innermap.vectorCoverage';
const VIEW_KEY = 'innermap.mapView';
export const MAP_VIEWS = ['default', 'satellite', 'terrain', 'transit'];

function readLocal(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function ProviderProvider({ children }) {
  const { user } = useAuth();
  const [providerId, setProviderIdState] = useState(() => getProvider(readLocal(PROVIDER_KEY) || DEFAULT_PROVIDER_ID).id);
  // Coverage of the server's vector data, cached so it is known offline too.
  const [coverage, setCoverage] = useState(() => {
    try {
      return JSON.parse(readLocal(COVERAGE_KEY)) || null;
    } catch {
      return null;
    }
  });

  // Map view (Default / Satellite / Terrain / Transit), kept on this device.
  const [mapView, setMapViewState] = useState(() => (MAP_VIEWS.includes(readLocal(VIEW_KEY)) ? readLocal(VIEW_KEY) : 'default'));
  const setMapView = useCallback((v) => {
    const next = MAP_VIEWS.includes(v) ? v : 'default';
    setMapViewState(next);
    writeLocal(VIEW_KEY, next);
  }, []);

  const provider = getProvider(providerId);

  const loadCoverage = useCallback(async () => {
    const vector = PROVIDERS.find((p) => p.kind === 'vector' && p.metadataUrl);
    if (!vector || !navigator.onLine) return;
    try {
      const res = await fetch(vector.metadataUrl, { cache: 'no-store' });
      if (!res.ok) return;
      const info = await res.json();
      setCoverage(info);
      writeLocal(COVERAGE_KEY, JSON.stringify(info));
    } catch {
      /* server unreachable: keep the cached copy */
    }
  }, []);

  // Pull the saved choice from the server when signed in and reachable.
  const loadServerPreference = useCallback(async () => {
    if (!user) return;
    try {
      const prefs = await fetchPreferences();
      if (prefs?.updatedAt && PROVIDERS.some((p) => p.id === prefs.mapProvider)) {
        setProviderIdState(prefs.mapProvider);
        writeLocal(PROVIDER_KEY, prefs.mapProvider);
      }
    } catch {
      /* keep local choice */
    }
  }, [user]);

  useEffect(() => {
    loadCoverage();
    loadServerPreference();
    return subscribe((s) => {
      if (s.apiReachable) {
        loadCoverage();
        loadServerPreference();
      }
    });
  }, [loadCoverage, loadServerPreference]);

  const setProviderId = useCallback(
    (id) => {
      const next = getProvider(id).id;
      setProviderIdState(next);
      writeLocal(PROVIDER_KEY, next);
      if (user) savePreferences(user.id, { mapProvider: next }).catch(() => {});
    },
    [user]
  );

  return (
    <ProviderContext.Provider value={{ provider, providers: PROVIDERS, setProviderId, coverage, mapView, setMapView }}>
      {children}
    </ProviderContext.Provider>
  );
}

export function useMapProvider() {
  const ctx = useContext(ProviderContext);
  if (!ctx) throw new Error('useMapProvider must be used inside ProviderProvider');
  return ctx;
}
