// Navigation mode: follows the live GPS position along a calculated route - online or fully
// offline (downloaded road data + GPS, no internet). A blue instruction card at the top (turn
// arrow, distance, street), a card at the bottom (arrival, minutes and distance left, progress,
// close), your speed from GPS, the current street and optional spoken directions (the device's
// own voices). When you leave the route it calculates a new one from your position (same travel
// mode; online or offline as available). No simulated movement: everything follows real GPS fixes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from '../hooks/LocationContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { calculateRoute } from '../routing/routingManager';
import { prepareNav, progressAt, isOffRoute } from '../routing/navProgress';
import { formatDistance } from '../maps/geo';
import Icon from './Icon';

const MODE_LABEL = { car: 'Driving', motorcycle: 'Motorbike', foot: 'Walking', bike: 'Cycling' };
const OFF_ROUTE_FIXES = 3; // consecutive fixes off the route before re-routing
const REROUTE_GAP_MS = 15000;
const VOICE_KEY = 'innermap.nav-voice';

/** Turn kind from an instruction ("Turn left onto…", "Bear right…", "Make a sharp left…"). */
export function maneuverOf(text = '') {
  const t = text.toLowerCase();
  if (/arriv|destination/.test(t)) return 'arrive';
  if (/u-turn/.test(t)) return 'uturn';
  const side = /\bleft\b/.test(t) ? 'left' : /\bright\b/.test(t) ? 'right' : null;
  if (side && /sharp/.test(t)) return `sharp-${side}`;
  if (side && /(bear|slight|keep)/.test(t)) return `slight-${side}`;
  if (side) return side;
  return 'straight';
}

/** The street an instruction leads onto ("…onto Colaba Causeway" -> "Colaba Causeway"). */
export function roadOf(step) {
  if (!step) return '';
  const m = /\b(?:onto|on|into|towards)\s+(.+)$/i.exec(step.text || '');
  const name = step.road || (m ? m[1].trim() : '');
  // unnamed roads come as "the road", "a footpath"...: no street name to show
  return /^(the|a|an)\s/i.test(name) ? '' : name;
}

/** A big, clear turn arrow (white on the blue card). */
export function TurnArrow({ kind, size = 44 }) {
  const paths = {
    straight: 'M24 40V10M24 10l-9 9M24 10l9 9',
    left: 'M32 40V22a6 6 0 0 0-6-6H12M12 16l8-8M12 16l8 8',
    right: 'M16 40V22a6 6 0 0 1 6-6h14M36 16l-8-8M36 16l-8 8',
    'slight-left': 'M30 40V26L16 12M16 12v11M16 12h11',
    'slight-right': 'M18 40V26l14-14M32 12v11M32 12H21',
    'sharp-left': 'M32 8v18a6 6 0 0 1-6 6h-2L12 20M12 20v10M12 20h10',
    'sharp-right': 'M16 8v18a6 6 0 0 0 6 6h2l12-12M36 20v10M36 20H26',
    uturn: 'M30 40V18a8 8 0 0 0-16 0v12M14 30l-6-6M14 30l6-6',
  };
  if (kind === 'arrive') {
    return (
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
        <path d="M24 42s13-12.5 13-22a13 13 0 0 0-26 0c0 9.5 13 22 13 22z" fill="currentColor" opacity="0.95" />
        <circle cx="24" cy="20" r="5" fill="#1a73e8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
      <path d={paths[kind] || paths.straight} fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const fmtMin = (s) => Math.max(0, Math.round(s / 60));
const fmtLeft = (m) => (m >= 1000 ? { v: (m / 1000).toFixed(m >= 10000 ? 0 : 1), u: 'km' } : { v: String(Math.round(m / 10) * 10), u: 'm' });

function speak(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    window.speechSynthesis.speak(u);
  } catch {
    /* no voices on this device */
  }
}

export default function NavigationView({ userId, nav: navState, onRoute, onStop, onProgress, following = true, onRecenter }) {
  const { position, fixStatus, quality, tracking, startTracking, errorType, approximate } = useLocation();
  const { status } = useConnectivity();
  const [route, setRoute] = useState(navState.route);
  const [rerouting, setRerouting] = useState(false);
  const [rerouteError, setRerouteError] = useState(null);
  const [voice, setVoice] = useState(() => {
    try {
      return localStorage.getItem(VOICE_KEY) === 'on';
    } catch {
      return false;
    }
  });
  const offCount = useRef(0);
  // Routes start on the nearest road; until you reach the route line, being away from it is expected.
  const [joined, setJoined] = useState(false);
  const lastReroute = useRef(0);
  const nav = useMemo(() => prepareNav(route), [route]);
  const live = fixStatus === 'live';
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    if (!tracking) startTracking();
    // Keep the screen on while navigating (where the browser allows it).
    let lock = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock?.request('screen');
      } catch {
        /* not supported or not allowed */
      }
    };
    request();
    const onVisible = () => document.visibilityState === 'visible' && request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = live && position && !approximate ? progressAt(nav, position) : null;
  useEffect(() => {
    onProgress?.(progress ? progress.done : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.done, route]);

  const reroute = async (reason) => {
    if (!position) return;
    lastReroute.current = Date.now();
    setRerouting(reason);
    setRerouteError(null);
    try {
      const r = await calculateRoute({
        userId,
        profile: navState.profile,
        from: { lat: position.lat, lng: position.lng },
        to: navState.to,
        preference: 'auto',
      });
      const next = { ...r, profile: navState.profile, calculatedAt: Date.now() };
      setRoute(next);
      onRoute(next);
      offCount.current = 0;
      setJoined(false);
      if (voice) speak('Route recalculated.');
    } catch (err) {
      setRerouteError(err.message || 'Could not calculate a new route.');
    } finally {
      setRerouting(false);
    }
  };

  // Off-route detection on every live fix (only after you have joined the route).
  useEffect(() => {
    if (!progress || rerouting || progress.arrived) return;
    const off = isOffRoute(progress, position.accuracy);
    if (!joined) {
      if (!off) setJoined(true);
      return;
    }
    if (off && (position.accuracy || 0) < 100) {
      offCount.current += 1;
      if (offCount.current >= OFF_ROUTE_FIXES && Date.now() - lastReroute.current > REROUTE_GAP_MS) reroute('off-route');
    } else {
      offCount.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.timestamp]);

  // Spoken directions: once well before a turn and once just before it, and on arrival.
  const spoken = useRef(new Set());
  useEffect(() => {
    if (!voice || !progress) return;
    const n = progress.next;
    const key = (tag) => `${route.calculatedAt || ''}|${n ? n.at : 'end'}|${tag}`;
    if (progress.arrived) {
      if (!spoken.current.has(key('arrived'))) {
        spoken.current.add(key('arrived'));
        speak('You have arrived at your destination.');
      }
      return;
    }
    if (!n) return;
    const far = navState.profile === 'foot' ? 80 : 300;
    const near = navState.profile === 'foot' ? 20 : 60;
    if (progress.toNext <= near && !spoken.current.has(key('near'))) {
      spoken.current.add(key('near'));
      spoken.current.add(key('far'));
      speak(n.text);
    } else if (progress.toNext <= far && progress.toNext > near && !spoken.current.has(key('far'))) {
      spoken.current.add(key('far'));
      speak(`In ${formatDistance(Math.round(progress.toNext / 10) * 10)}, ${n.text}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, progress?.toNext, progress?.arrived]);

  const toggleVoice = () => {
    const v = !voice;
    setVoice(v);
    try {
      localStorage.setItem(VOICE_KEY, v ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    if (v) speak('Voice guidance on.');
    else window.speechSynthesis?.cancel();
  };

  // what to show
  const offStart = progress && !joined && isOffRoute(progress, position.accuracy);
  const next = progress?.next || null;
  const kind = progress?.arrived ? 'arrive' : offStart ? 'straight' : next ? maneuverOf(next.text) : 'arrive';
  const nextIndex = next ? nav.steps.indexOf(next) : -1;
  const after = nextIndex >= 0 ? nav.steps[nextIndex + 1] : null;
  const showThen = Boolean(progress && after && next && !progress.arrived && after.at - next.at < 250);
  const current = nextIndex > 0 ? nav.steps[nextIndex - 1] : nav.steps[0];
  const currentRoad = roadOf(current);
  const speedKmh = live && position?.speed != null && position.speed >= 0.5 ? Math.round(position.speed * 3.6) : null;
  const left = progress ? fmtLeft(progress.remaining) : null;
  const eta = progress ? new Date(Date.now() + progress.remainingTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–';
  const pct = progress ? Math.min(100, Math.max(0, (progress.done / (nav.total || 1)) * 100)) : 0;

  let title;
  let subtitle;
  if (progress?.arrived) {
    title = 'You have arrived';
    subtitle = navState.toLabel || 'Destination';
  } else if (rerouting) {
    title = rerouting === 'off-route' ? 'Off route' : 'Recalculating…';
    subtitle = 'Finding a new route from where you are';
  } else if (!live || approximate) {
    title = errorType === 'denied' ? 'Location is blocked' : approximate ? 'Waiting for GPS' : 'Waiting for GPS…';
    subtitle =
      errorType === 'denied'
        ? 'Allow location access to navigate.'
        : approximate
          ? `Only a rough position (±${formatDistance(position.accuracy)}) - not precise enough to guide you. Step outdoors with GPS on.`
          : 'Navigation follows your live GPS position - it works without internet. Move to open sky if this takes long.';
  } else if (offStart) {
    title = formatDistance(progress.offRoute);
    subtitle = 'Head to the route (shown in blue)';
  } else {
    title = formatDistance(Math.round(progress.toNext / 10) * 10);
    subtitle = next ? roadOf(next) || next.text : `Continue to ${navState.toLabel || 'the destination'}`;
  }
  const waiting = !progress || rerouting;

  return (
    <div className="nv">
      {/* top: next instruction */}
      <div className={`nv-banner ${progress?.arrived ? 'arrived' : ''} ${waiting ? 'waiting' : ''}`} role="status" aria-live="polite">
        <div className="nv-banner-main">
          <span className="nv-arrow">{waiting ? <Icon name={rerouting ? 'refresh' : 'crosshair'} size={30} /> : <TurnArrow kind={kind} />}</span>
          <div className="nv-text">
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
        </div>
        {showThen && (
          <div className="nv-then">
            Then <TurnArrow kind={maneuverOf(after.text)} size={18} /> <span>{roadOf(after) || after.text}</span>
          </div>
        )}
        {next && progress && !progress.arrived && !offStart && <div className="nv-full">{next.text}</div>}
      </div>

      {(rerouteError || (joined && progress && !progress.arrived && isOffRoute(progress, position.accuracy) && !rerouting)) && (
        <div className={`nv-warn ${rerouteError ? 'error' : ''}`}>
          {rerouteError ? (
            <>
              {rerouteError}{' '}
              <button type="button" onClick={() => reroute('manual')}>
                Try again
              </button>
            </>
          ) : (
            `Off route by ${formatDistance(progress.offRoute)}`
          )}
        </div>
      )}

      {/* floating: speed, current street, voice, re-centre */}
      <div className="nv-float">
        <div className="nv-speed" title="Your speed from GPS">
          <strong>{speedKmh ?? '–'}</strong>
          <span>km/h</span>
        </div>
        {currentRoad && progress && !progress.arrived && <div className="nv-road">{currentRoad}</div>}
        <div className="nv-float-right">
          {!following && onRecenter && (
            <button type="button" className="nv-round" onClick={onRecenter} title="Back to my position" aria-label="Back to my position">
              <Icon name="navigation" size={18} />
            </button>
          )}
          {canSpeak && (
            <button
              type="button"
              className={`nv-round ${voice ? 'on' : ''}`}
              onClick={toggleVoice}
              aria-pressed={voice}
              title={voice ? 'Voice guidance on' : 'Voice guidance off'}
              aria-label="Voice guidance"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
                {voice ? (
                  <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                ) : (
                  <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                )}
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* bottom: arrival, time and distance left, progress */}
      <div className="nv-card">
        <div className="nv-stats">
          <div>
            <strong>{eta}</strong>
            <span>arrival</span>
          </div>
          <div>
            <strong>{progress ? fmtMin(progress.remainingTime) : '–'}</strong>
            <span>min</span>
          </div>
          <div>
            <strong>{left ? left.v : '–'}</strong>
            <span>{left ? left.u : 'm'}</span>
          </div>
          <button type="button" className="nv-close" onClick={onStop} aria-label="End navigation" title="End navigation">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="nv-progress" aria-label={`${Math.round(pct)}% of the route done`}>
          <span className="nv-progress-start" />
          <span className="nv-progress-done" style={{ width: `${pct}%` }} />
          <span className="nv-progress-me" style={{ left: `${pct}%` }}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M12 3l7 17-7-4-7 4z" fill="currentColor" transform="rotate(90 12 12)" />
            </svg>
          </span>
          <span className="nv-progress-end" />
        </div>
        <div className="nv-meta">
          <span>{MODE_LABEL[navState.profile] || navState.profile}</span>
          <span className={`nv-chip ${route.mode === 'online' ? '' : 'offline'}`}>{route.mode === 'online' ? 'Online route' : 'Offline route'}</span>
          <span className={`nv-acc acc-${quality}`}>{position?.accuracy ? `GPS ±${formatDistance(position.accuracy)}` : 'GPS –'}</span>
          {status === 'offline' && <span>No internet needed</span>}
          <button type="button" className="nv-link" onClick={() => reroute('manual')} disabled={!live || Boolean(rerouting)}>
            Recalculate
          </button>
        </div>
      </div>
    </div>
  );
}
