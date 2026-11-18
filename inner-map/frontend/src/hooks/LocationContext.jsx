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
// Startup: remember that we already explained/asked, so the request is not repeated.
const STARTUP_KEY = 'innermap.gpsStartup'; // 'asked' | 'dismissed'
// A fix older than this while tracking is shown as "last known" (signal probably lost).
export const STALE_AFTER_MS = 30000;

/** How trustworthy the reported accuracy radius is. */
export function fixQuality(accuracy) {
  if (typeof accuracy !== 'number') return 'unknown';
  if (accuracy <= 20) return 'good';
  if (accuracy <= 100) return 'fair';
  return 'poor';
}

/** Machine-readable reason, so the UI can offer the right action. */
function errorKind(err) {
  if (!window.isSecureContext) return 'insecure';
  return { 1: 'denied', 2: 'unavailable', 3: 'timeout' }[err?.code] || 'unavailable';
}

function readStartup() {
  try {
    return localStorage.getItem(STARTUP_KEY);
  } catch {
    return null;
  }
}

function writeStartup(v) {
  try {
    localStorage.setItem(STARTUP_KEY, v);
  } catch {
    /* ignore */
  }
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
  const [errorType, setErrorType] = useState(supported ? null : 'unsupported'); // denied | unavailable | timeout | insecure | unsupported
  const [locating, setLocating] = useState(false); // waiting for a fix
  // 'ask' = show the explanation + "Use my location" button (browser has not been asked yet).
  const [startupPrompt, setStartupPrompt] = useState(false);
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
      setErrorType(null);
      setLocating(false);
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
    setErrorType(errorKind(err));
    // A timeout while watching keeps trying; anything else ends the "locating" state.
    if (err.code !== 3) setLocating(false);
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
    setErrorType(null);
    setLocating(true);
    setStartupPrompt(false);
    writeStartup('asked');
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
    setLocating(false);
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
          setErrorType('unsupported');
          reject(new Error(msg));
          return;
        }
        setLocating(true);
        setStartupPrompt(false);
        writeStartup('asked');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            onPosition(pos);
            resolve(toPosition(pos));
          },
          (err) => {
            setError(describeError(err));
            setErrorType(errorKind(err));
            setLocating(false);
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
      startupDone.current = false; // run the startup flow again for the next sign-in
      setStartupPrompt(false);
      setError(null);
      setErrorType(supported ? null : 'unsupported');
      setLocating(false);
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

  // GPS-first startup (once per sign-in / page load):
  //  - permission already granted  -> start live updates straight away (works offline)
  //  - not decided yet             -> show a short explanation with one "Use my location" button;
  //                                   the browser's own permission prompt opens from that click
  //  - denied                      -> no prompt; the status explains how to allow it
  // The explanation is shown only until the user has answered once (stored on this device).
  const startupDone = useRef(false);
  useEffect(() => {
    if (!user || !supported || startupDone.current) return;
    startupDone.current = true;
    if (!window.isSecureContext) {
      setErrorType('insecure');
      setError(describeError(null));
      return;
    }
    const decide = (state) => {
      if (state === 'granted') startTracking();
      else if (state === 'denied') {
        setErrorType('denied');
        setError(describeError({ code: 1 }));
      } else if (readStartup() === 'asked' && state === 'unknown') {
        // No Permissions API (older Safari): the user already allowed once - ask the browser directly.
        startTracking();
      } else if (readStartup() !== 'dismissed') setStartupPrompt(true);
    };
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((s) => decide(s.state), () => decide('unknown'));
    } else decide('unknown');
  }, [user, supported, startTracking]);

  const dismissStartupPrompt = useCallback(() => {
    setStartupPrompt(false);
    writeStartup('dismissed');
  }, []);

  // Permission changed in the browser settings while the app is open.
  useEffect(() => {
    if (permission === 'granted' && errorType === 'denied') {
      setError(null);
      setErrorType(null);
    } else if (permission === 'denied' && watchId.current === null && user) {
      setErrorType('denied');
      setError(describeError({ code: 1 }));
    }
  }, [permission]); // eslint-disable-line react-hooks/exhaustive-deps

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
        errorType,
        locating,
        startupPrompt,
        dismissStartupPrompt,
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
