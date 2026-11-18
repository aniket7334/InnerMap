// Navigation mode: follows the live GPS position along a calculated route.
// Shows the next instruction, distance and time remaining, arrival time, travel mode, GPS
// accuracy and online/offline route source. When you leave the route it calculates a new one
// from your position (same travel mode; online or offline as available). No simulated movement:
// everything is driven by real GPS fixes.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from '../hooks/LocationContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { calculateRoute } from '../routing/routingManager';
import { prepareNav, progressAt, isOffRoute } from '../routing/navProgress';
import { formatDistance } from '../maps/geo';
import { formatDuration } from './RoutePanel';
import Icon from './Icon';

const MODE_LABEL = { car: 'Driving', motorcycle: 'Motorcycle', foot: 'Walking', bike: 'Cycling' };
const OFF_ROUTE_FIXES = 3; // consecutive fixes off the route before re-routing
const REROUTE_GAP_MS = 15000;

function turnIcon(text = '') {
  if (/u-turn/i.test(text)) return '↶';
  if (/sharp left|left/i.test(text)) return '↰';
  if (/sharp right|right/i.test(text)) return '↱';
  if (/arriv|destination/i.test(text)) return '◎';
  return '↑';
}

export default function NavigationView({ userId, nav: navState, onRoute, onStop }) {
  const { position, fixStatus, quality, tracking, startTracking, errorType } = useLocation();
  const { status } = useConnectivity();
  const [route, setRoute] = useState(navState.route);
  const [rerouting, setRerouting] = useState(false);
  const [rerouteError, setRerouteError] = useState(null);
  const offCount = useRef(0);
  // Routes start on the nearest road; until you reach the route line, being away from it is expected.
  const [joined, setJoined] = useState(false);
  const lastReroute = useRef(0);
  const nav = useMemo(() => prepareNav(route), [route]);
  const live = fixStatus === 'live';

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const progress = live && position ? progressAt(nav, position) : null;

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

  const eta = progress ? new Date(Date.now() + progress.remainingTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const est = route.durationIsEstimate ? '≈ ' : '';

  let banner;
  if (progress?.arrived) {
    banner = (
      <>
        <span className="nav-turn">◎</span>
        <div className="nav-instruction">
          <strong>You have arrived</strong>
          <span>{navState.toLabel || 'Destination'}</span>
        </div>
      </>
    );
  } else if (rerouting) {
    banner = (
      <div className="nav-instruction">
        <strong>{rerouting === 'off-route' ? 'Off route - finding a new route…' : 'Recalculating…'}</strong>
      </div>
    );
  } else if (!live) {
    banner = (
      <div className="nav-instruction">
        <strong>{errorType === 'denied' ? 'Location is blocked' : 'Waiting for GPS…'}</strong>
        <span>{errorType === 'denied' ? 'Allow location access to navigate.' : 'Navigation follows your live position. Move to open sky if this takes long.'}</span>
      </div>
    );
  } else if (!joined && isOffRoute(progress, position.accuracy)) {
    banner = (
      <>
        <span className="nav-turn" aria-hidden="true">
          ↑
        </span>
        <div className="nav-instruction">
          <strong className="nav-distance">{formatDistance(progress.offRoute)}</strong>
          <span>Head to the route on the nearest road (shown in blue)</span>
        </div>
      </>
    );
  } else {
    const text = progress.next ? progress.next.text : `Continue to ${navState.toLabel || 'the destination'}`;
    banner = (
      <>
        <span className="nav-turn" aria-hidden="true">
          {turnIcon(text)}
        </span>
        <div className="nav-instruction">
          <strong className="nav-distance">{formatDistance(progress.toNext)}</strong>
          <span>{text}</span>
        </div>
      </>
    );
  }

  return (
    <div className="nav-view">
      <div className="nav-banner" role="status" aria-live="polite">
        {banner}
      </div>
      {joined && progress && !progress.arrived && isOffRoute(progress, position.accuracy) && !rerouting && (
        <div className="nav-warning">Off route by {formatDistance(progress.offRoute)}</div>
      )}
      {rerouteError && (
        <div className="nav-warning error">
          {rerouteError}{' '}
          <button type="button" className="link-btn" onClick={() => reroute('manual')}>
            Try again
          </button>
        </div>
      )}
      <div className="nav-bar">
        <div className="nav-stats">
          <div>
            <strong>{progress ? `${est}${formatDuration(progress.remainingTime)}` : '–'}</strong>
            <span>{progress ? `${formatDistance(progress.remaining)} left` : 'time left'}</span>
          </div>
          <div>
            <strong>{eta ? `${est}${eta}` : '–'}</strong>
            <span>arrival</span>
          </div>
          <div className="nav-meta">
            <span>{MODE_LABEL[navState.profile] || navState.profile}</span>
            <span className={`mode-badge mode-${route.mode}`}>{route.mode === 'online' ? 'Online route' : 'Offline route'}</span>
            <span className={`acc acc-${quality}`}>{position?.accuracy ? `GPS ± ${formatDistance(position.accuracy)}` : 'GPS –'}</span>
            {status === 'offline' && <span className="muted">No internet</span>}
          </div>
        </div>
        <div className="nav-actions">
          <button type="button" className="btn btn-sm" onClick={() => reroute('manual')} disabled={!live || Boolean(rerouting)} title="Calculate the route again from your position">
            <Icon name="refresh" size={14} /> Recalculate
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={onStop}>
            <Icon name="stop" size={12} /> Stop
          </button>
        </div>
      </div>
    </div>
  );
}
