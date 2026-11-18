// GPS location tracking with the HTML5 Geolocation API.
// Works without internet: the browser gets the fix from the device's GPS /
// location services, which do not need our server or the tile server.
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { distanceMeters } from '../maps/geo';
import { enqueue } from '../offline/syncService';

const LocationContext = createContext(null);

// maximumAge 0 = never reuse a cached fix while tracking; timeout = how long to wait for a fix.
const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };
const LOCATE_OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
const HISTORY_MIN_DISTANCE_M = 20;
const HISTORY_MIN_INTERVAL_MS = 60000;
const HISTORY_FLUSH_MS = 60000;
const TRACKING_FLAG = 'innermap.tracking';
const LAST_FIX_KEY = 'innermap.lastFix';
// A fix older than this while tracking is shown as "last known" (signal probably lost).
export const STALE_AFTER_MS = 30000;

/** How trustworthy the reported accuracy radius is. */
export function fixQuality(accuracy) {
  if (typeof accuracy !== 'number') return 'unknown';
  if (accuracy <= 20) return 'good';
  if (accuracy <= 100) return 'fair';
  return 'poor';
}

function describeError(err) {
  if (!window.isSecureContext) {
    return 'Location needs a secure connection (https:// or http://localhost).';
  }
  switch (err?.code) {
    case 1:
      return 'Location permission was denied. Allow location access for this site in your browser settings, then try again.';
    case 2:
      return navigator.onLine
        ? 'Your position is unavailable. Turn on location services (GPS) on the device. Indoors, GPS may need a moment or a window with a view of the sky.'
        : 'No position fix. Turn on location services (GPS). Note: computers without a GPS receiver locate themselves through Wi-Fi networks, which usually needs internet - phones with GPS work offline.';
    case 3:
      return 'Waiting for a GPS fix is taking longer than usual (weak signal). Still trying...';
    default:
      return err?.message || 'Could not get your location.';
  }
}

function readLastFix() {
  try {
    const p = JSON.parse(localStorage.getItem(LAST_FIX_KEY));
    return p && typeof p.lat === 'number' && typeof p.lng === 'number' ? { ...p, restored: true } : null;
  } catch {
    return null;
  }
}

function toPosition(pos) {
  const c = pos.coords;
  return {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: c.accuracy,
    altitude: c.altitude,
    altitudeAccuracy: c.altitudeAccuracy,
    heading: c.heading,
    speed: c.speed,
    timestamp: pos.timestamp,
  };
}

export function LocationProvider({ children }) {
  const { user } = useAuth();
  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  // The last known fix is kept on this device only, so the map can show where you were last
  // located even before a new fix arrives (clearly labelled as "last known").
  const [position, setPosition] = useState(() => (user ? readLastFix() : null));
  const [error, setError] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [permission, setPermission] = useState('unknown');
  const [now, setNow] = useState(Date.now());

  // Re-evaluate "live" vs "last known" every few seconds.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const watchId = useRef(null);
  const userRef = useRef(user);
  const historyBuffer = useRef([]);
  const lastRecorded = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Show the current permission state (granted / prompt / denied) where supported.
  useEffect(() => {
    let status;
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((s) => {
        status = s;
        setPermission(s.state);
        s.onchange = () => setPermission(s.state);
      })
      .catch(() => {});
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  const flushHistory = useCallback(async () => {
    const u = userRef.current;
    if (!u || historyBuffer.current.length === 0) return;
    const points = historyBuffer.current.splice(0);
    await enqueue(u.id, 'history:batch', { points });
  }, []);

  const recordHistory = useCallback(
    (p) => {
      const u = userRef.current;
      if (!u?.locationHistoryEnabled) return; // only with explicit opt-in
      const last = lastRecorded.current;
      if (
        last &&
        distanceMeters(last.lat, last.lng, p.lat, p.lng) < HISTORY_MIN_DISTANCE_M &&
        p.timestamp - last.timestamp < HISTORY_MIN_INTERVAL_MS
      ) {
        return;
      }
      lastRecorded.current = p;
      historyBuffer.current.push({
        latitude: p.lat,
        longitude: p.lng,
        accuracy: p.accuracy,
        recordedAt: new Date(p.timestamp).toISOString(),
      });
      if (historyBuffer.current.length >= 20) flushHistory();
    },
    [flushHistory]
  );

  const onPosition = useCallback(
    (pos) => {
      const p = toPosition(pos);
      setPosition(p);
      setNow(Date.now());
      setError(null);
      recordHistory(p);
      try {
        localStorage.setItem(LAST_FIX_KEY, JSON.stringify({ lat: p.lat, lng: p.lng, accuracy: p.accuracy, timestamp: p.timestamp }));
      } catch {
        /* storage unavailable */
      }
    },
    [recordHistory]
  );

  const onError = useCallback((err) => {
    setError(describeError(err));
    if (err.code === 1) {
      // Permission denied: stop watching, nothing will arrive.
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setTracking(false);
      sessionStorage.removeItem(TRACKING_FLAG);
    }
  }, []);

  const startTracking = useCallback(() => {
    if (!supported) {
      setError('This browser does not support location services.');
      return;
    }
    if (watchId.current !== null) return;
    setError(null);
    watchId.current = navigator.geolocation.watchPosition(onPosition, onError, WATCH_OPTIONS);
    setTracking(true);
    try {
      sessionStorage.setItem(TRACKING_FLAG, '1');
    } catch {
      /* ignore */
    }
  }, [supported, onPosition, onError]);

  const stopTracking = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setTracking(false);
    flushHistory();
    try {
      sessionStorage.removeItem(TRACKING_FLAG);
    } catch {
      /* ignore */
    }
  }, [flushHistory]);

  /** One-off fix (does not start continuous tracking). Resolves with the position. */
  const locateOnce = useCallback(
    () =>
      new Promise((resolve, reject) => {
        if (!supported) {
          const msg = 'This browser does not support location services.';
          setError(msg);
          reject(new Error(msg));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            onPosition(pos);
            resolve(toPosition(pos));
          },
          (err) => {
            setError(describeError(err));
            reject(err);
          },
          LOCATE_OPTIONS
        );
      }),
    [supported, onPosition]
  );

  // Browsers pause location updates while the app is in the background; ask for a fresh fix
  // as soon as it is visible again (background tracking after closing is not possible on the web).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && watchId.current !== null) {
        navigator.geolocation.getCurrentPosition(onPosition, () => {}, LOCATE_OPTIONS);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [onPosition]);

  // Resume tracking after a reload if it was on; stop it on logout.
  useEffect(() => {
    if (!user) {
      if (watchId.current !== null) stopTracking();
      setPosition(null);
      try {
        localStorage.removeItem(LAST_FIX_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    setPosition((p) => p || readLastFix());
    try {
      if (sessionStorage.getItem(TRACKING_FLAG) === '1') startTracking();
    } catch {
      /* ignore */
    }
  }, [user, startTracking, stopTracking]);

  // Periodically queue recorded history points for upload.
  useEffect(() => {
    const t = setInterval(flushHistory, HISTORY_FLUSH_MS);
    return () => clearInterval(t);
  }, [flushHistory]);

  useEffect(
    () => () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    },
    []
  );

  // live: a fresh fix from the active watch; last-known: an older or restored fix; none: no fix yet.
  const ageMs = position ? Math.max(0, now - position.timestamp) : null;
  const fixStatus = !position ? 'none' : tracking && !position.restored && ageMs < STALE_AFTER_MS ? 'live' : 'last-known';
  const quality = position ? fixQuality(position.accuracy) : 'unknown';

  return (
    <LocationContext.Provider
      value={{
        supported,
        position,
        error,
        tracking,
        permission,
        startTracking,
        stopTracking,
        locateOnce,
        fixStatus,
        quality,
        ageMs,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside LocationProvider');
  return ctx;
}
