// Typography settings (interface + map labels).
//
// Same pattern as the map provider choice: the settings are kept in localStorage so they
// apply instantly on start-up (also offline, and on the login page), and in the
// user_preferences table (column "typography", migration 004) so they follow the user
// to other devices. Changes are queued in the sync outbox, so saving works offline.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { subscribe } from '../offline/connectivity';
import { listOutbox } from '../offline/syncService';
import { fetchPreferences, savePreferences } from '../services/preferenceService';
import { DEFAULT_TYPOGRAPHY, labelFont, mapLabelKey, normalizeTypography } from '../typography/typographyConfig';
import { applyTypography, loadLocalTypography, saveLocalTypography } from '../typography/applyTypography';
import { ensureFontLoaded } from '../typography/fonts';

const TypographyContext = createContext(null);
const SAVE_DELAY = 700;

// Apply before React renders anything, so there is no flash of the default size.
const initial = normalizeTypography(loadLocalTypography());
if (typeof document !== 'undefined') applyTypography(initial);

export function TypographyProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(initial);
  // Map labels are drawn into canvas tiles: only re-render once the label font is loaded.
  const [mapKey, setMapKey] = useState(() => mapLabelKey(initial));
  const [saveState, setSaveState] = useState('idle'); // idle | pending | saved | queued | error
  const timer = useRef(null);
  const latest = useRef(initial);

  useEffect(() => {
    applyTypography(settings);
    latest.current = settings;
    let cancelled = false;
    const key = mapLabelKey(settings);
    ensureFontLoaded(labelFont(settings), [400, 600, 700]).then(() => {
      if (!cancelled) setMapKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // Server copy wins when it exists and nothing from this device is still waiting to sync.
  const loadServer = useCallback(async () => {
    if (!user) return;
    try {
      const pending = await listOutbox(user.id);
      if (pending.some((op) => op.type === 'preferences:update' && 'typography' in op.payload)) return;
      const prefs = await fetchPreferences();
      if (prefs && prefs.typography) {
        const next = normalizeTypography(prefs.typography);
        setSettings(next);
        saveLocalTypography(next);
      }
    } catch {
      /* offline or server error: keep the local copy */
    }
  }, [user]);

  useEffect(() => {
    loadServer();
    return subscribe((s) => {
      if (s.apiReachable) loadServer();
    });
  }, [loadServer]);

  const persist = useCallback(
    (next) => {
      saveLocalTypography(next);
      if (!user) {
        setSaveState('saved');
        return;
      }
      setSaveState('pending');
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try {
          await savePreferences(user.id, { typography: latest.current });
          setSaveState(navigator.onLine ? 'saved' : 'queued');
        } catch {
          setSaveState('error');
        }
      }, SAVE_DELAY);
    },
    [user]
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Update with a partial object or a function; applies immediately and auto-saves. */
  const update = useCallback(
    (patch) => {
      setSettings((prev) => {
        const raw = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        const next = normalizeTypography(raw);
        latest.current = next;
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const reset = useCallback(
    (part) => {
      update((prev) => {
        if (part === 'interface') return { ...DEFAULT_TYPOGRAPHY, mapLabels: prev.mapLabels };
        if (part === 'map') return { ...prev, mapLabels: DEFAULT_TYPOGRAPHY.mapLabels };
        return DEFAULT_TYPOGRAPHY;
      });
    },
    [update]
  );

  const value = useMemo(
    () => ({ settings, update, reset, saveState, mapLabelKey: mapKey }),
    [settings, update, reset, saveState, mapKey]
  );
  return <TypographyContext.Provider value={value}>{children}</TypographyContext.Provider>;
}

export function useTypography() {
  const ctx = useContext(TypographyContext);
  if (!ctx) throw new Error('useTypography must be used inside TypographyProvider');
  return ctx;
}
