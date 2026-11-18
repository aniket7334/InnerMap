// Directions panel: start + destination, travel mode, online/offline routing, results.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { calculateRoute, offlineCoverage, RouteError } from '../routing/routingManager';
import { searchPlaces } from '../services/geocodeService';
import { formatCoord, formatDistance } from '../maps/geo';
import Icon from './Icon';

const MODES = [
  { id: 'car', label: 'Drive' },
  { id: 'foot', label: 'Walk' },
  { id: 'bike', label: 'Cycle' },
];

const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export function formatDuration(s) {
  if (!Number.isFinite(s)) return '-';
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** One location field: free text with a suggestion list. */
function PlaceField({ label, value, onChange, onPick, picking, places, position, online, autoFocus }) {
  const [text, setText] = useState(value?.label || '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState({ q: '', items: [], loading: false, error: null });
  const ref = useRef(null);

  useEffect(() => setText(value?.label || ''), [value]);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const q = text.trim().toLowerCase();
  const coord = COORD_RE.exec(text);
  const coordOk = coord && Math.abs(Number(coord[1])) <= 90 && Math.abs(Number(coord[2])) <= 180;
  const matches = places.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 6);

  const choose = (v) => {
    onChange(v);
    setText(v.label);
    setOpen(false);
  };

  const search = async () => {
    if (!q || !online) return;
    setResults({ q: text, items: [], loading: true, error: null });
    try {
      const found = await searchPlaces(text);
      setResults({ q: text, items: found, loading: false, error: found.length ? null : 'No places found' });
    } catch (err) {
      setResults({ q: text, items: [], loading: false, error: err.message });
    }
  };

  return (
    <div className="place-field" ref={ref}>
      <label className="place-field-label">{label}</label>
      <div className="place-field-row">
        <input
          value={text}
          autoFocus={autoFocus}
          placeholder="Place, address or lat, lng"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (coordOk) choose({ label: `${coord[1]}, ${coord[2]}`, lat: Number(coord[1]), lng: Number(coord[2]), kind: 'coords' });
              else search();
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        <button
          type="button"
          className={`icon-btn ${picking ? 'active' : ''}`}
          onClick={onPick}
          title="Choose on the map"
          aria-label={`Choose ${label.toLowerCase()} on the map`}
          aria-pressed={picking}
        >
          <Icon name="pin" size={15} />
        </button>
      </div>
      {open && (
        <div className="suggest" role="listbox">
          <button
            type="button"
            onClick={() =>
              position
                ? choose({ label: 'My location', lat: position.lat, lng: position.lng, kind: 'gps' })
                : choose({ label: 'My location', kind: 'gps' })
            }
          >
            <Icon name="crosshair" size={14} /> My location
            {position ? <span className="suggest-meta">± {formatDistance(position.accuracy)}</span> : null}
          </button>
          {coordOk && (
            <button
              type="button"
              onClick={() => choose({ label: `${coord[1]}, ${coord[2]}`, lat: Number(coord[1]), lng: Number(coord[2]), kind: 'coords' })}
            >
              Coordinates {coord[1]}, {coord[2]}
            </button>
          )}
          {matches.map((p) => (
            <button
              type="button"
              key={p.localId}
              onClick={() => choose({ label: p.name, lat: p.latitude, lng: p.longitude, kind: 'saved' })}
            >
              <Icon name="pin" size={14} /> {p.name}
              <span className="suggest-meta">Saved place</span>
            </button>
          ))}
          {results.q === text &&
            results.items.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => choose({ label: r.name.split(',').slice(0, 2).join(','), lat: r.lat, lng: r.lng, kind: 'search' })}
              >
                {r.name.split(',').slice(0, 3).join(',')}
              </button>
            ))}
          {q && !coordOk && (
            <button type="button" className="suggest-search" onClick={search} disabled={!online || results.loading}>
              {!online
                ? 'Address search needs internet - use a saved place, the map or coordinates'
                : results.loading
                  ? 'Searching...'
                  : results.error && results.q === text
                    ? results.error
                    : `Search “${text.trim()}” (OpenStreetMap)  ↵`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function RoutePanel({ userId, pick, setPick, picked, onResult, onFocusPoint, onClose }) {
  const { status } = useConnectivity();
  const { position, locateOnce } = useLocation();
  const { locations } = useSavedLocations(userId);
  const [start, setStart] = useState({ label: 'My location', kind: 'gps' });
  const [end, setEnd] = useState(null);
  const [profile, setProfile] = useState('car');
  const [preference, setPreference] = useState('auto');
  const [route, setRoute] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [coverage, setCoverage] = useState([]);
  const [collapsed, setCollapsed] = useState(false);

  const online = status !== 'offline';
  const serverReachable = status === 'online';
  const plannedMode = preference === 'auto' ? (serverReachable ? 'online' : 'offline') : preference;

  useEffect(() => {
    const load = () => offlineCoverage(userId).then(setCoverage).catch(() => setCoverage([]));
    load();
    window.addEventListener('innermap:routing-changed', load);
    return () => window.removeEventListener('innermap:routing-changed', load);
  }, [userId]);

  // A point chosen by clicking the map.
  useEffect(() => {
    if (!picked) return;
    const v = { label: `${formatCoord(picked.lat, 5)}, ${formatCoord(picked.lng, 5)}`, lat: picked.lat, lng: picked.lng, kind: 'map' };
    if (picked.field === 'start') setStart(v);
    else setEnd(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.at]);

  // Show the chosen endpoints even before a route is calculated.
  const endpoints = useMemo(() => {
    const s = start?.kind === 'gps' ? (position ? { lat: position.lat, lng: position.lng } : null) : start?.lat != null ? start : null;
    const e = end?.lat != null ? end : null;
    return { start: s, end: e };
  }, [start, end, position]);

  useEffect(() => {
    onResult({ route, endpoints });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, endpoints]);

  const resolve = async (v) => {
    if (!v) return null;
    if (v.kind === 'gps') {
      if (position && !position.restored) return { lat: position.lat, lng: position.lng };
      const p = await locateOnce();
      return { lat: p.lat, lng: p.lng };
    }
    return v.lat != null ? { lat: v.lat, lng: v.lng } : null;
  };

  const find = async (pref = preference) => {
    setError(null);
    setBusy(true);
    try {
      let from;
      try {
        from = await resolve(start);
      } catch {
        throw new RouteError('Your GPS position is not available. Choose a starting point on the map, a saved place or coordinates.');
      }
      const to = await resolve(end);
      if (!from) throw new RouteError('Choose a starting point.');
      if (!to) throw new RouteError('Choose a destination.');
      const r = await calculateRoute({ userId, profile, from, to, preference: pref });
      setRoute(r);
      setCollapsed(false);
    } catch (err) {
      setRoute(null);
      setError(err instanceof RouteError ? err : new RouteError(err.message || 'Routing failed.'));
    } finally {
      setBusy(false);
    }
  };

  const swap = () => {
    setStart(end || null);
    setEnd(start);
    setRoute(null);
  };

  const clear = () => {
    setRoute(null);
    setError(null);
    setEnd(null);
    setPick(null);
  };

  return (
    <div className={`route-panel ${collapsed ? 'collapsed' : ''}`} role="dialog" aria-label="Directions">
      <div className="route-head">
        <button type="button" className="route-title" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
          <strong>Directions</strong>
          {route && collapsed && (
            <span className="muted small">
              {' '}
              · {formatDistance(route.distance)} · {formatDuration(route.duration)}
            </span>
          )}
        </button>
        <span className={`mode-badge mode-${route ? route.mode : plannedMode}`}>
          {route ? (route.mode === 'online' ? 'Online route' : 'Offline route') : plannedMode === 'online' ? 'Online' : 'Offline'}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close directions">
          <Icon name="close" size={15} />
        </button>
      </div>

      {!collapsed && (
        <div className="route-body">
          <div className="route-fields">
            <PlaceField
              label="Start"
              value={start}
              onChange={(v) => {
                setStart(v);
                setRoute(null);
              }}
              onPick={() => setPick(pick === 'start' ? null : 'start')}
              picking={pick === 'start'}
              places={locations}
              position={position}
              online={online}
            />
            <button type="button" className="icon-btn swap-btn" onClick={swap} title="Swap start and destination" aria-label="Swap start and destination">
              ⇅
            </button>
            <PlaceField
              label="Destination"
              value={end}
              onChange={(v) => {
                setEnd(v);
                setRoute(null);
              }}
              onPick={() => setPick(pick === 'end' ? null : 'end')}
              picking={pick === 'end'}
              places={locations}
              position={position}
              online={online}
              autoFocus
            />
          </div>

          <div className="row between">
            <div className="tabs route-modes" role="tablist" aria-label="Travel mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={profile === m.id}
                  className={`tab ${profile === m.id ? 'active' : ''}`}
                  onClick={() => {
                    setProfile(m.id);
                    setRoute(null);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <select
              className="route-pref"
              value={preference}
              onChange={(e) => {
                setPreference(e.target.value);
                setRoute(null);
              }}
              aria-label="Routing source"
              title="Where the route is calculated"
            >
              <option value="auto">Auto</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
            </select>
          </div>

          <p className="route-source muted small">
            {plannedMode === 'online'
              ? 'Calculated online from OpenStreetMap road data by the routing service.'
              : coverage.length
                ? `Calculated on this device from downloaded road data: ${coverage.map((c) => c.name).join(', ')}.`
                : 'No road data downloaded yet - offline directions need it (Download area → include road data).'}
          </p>

          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => find()} disabled={busy || !end}>
              {busy ? 'Finding route...' : 'Find route'}
            </button>
            <button type="button" className="btn btn-sm" onClick={clear} disabled={busy || (!route && !end)}>
              Clear
            </button>
          </div>

          {pick && <p className="small route-hint">Click the map to choose the {pick === 'start' ? 'start' : 'destination'}.</p>}

          {error && (
            <div className="route-error" role="alert">
              <p>{error.message}</p>
              <div className="row wrap">
                {error.canTryOffline && (
                  <button type="button" className="btn btn-sm" onClick={() => find('offline')}>
                    Use offline road data instead
                  </button>
                )}
                {error.canTryOnline && (
                  <button type="button" className="btn btn-sm" onClick={() => find('online')}>
                    Try online routing
                  </button>
                )}
              </div>
            </div>
          )}

          {route && (
            <div className="route-result">
              <div className="route-summary">
                <span className="route-distance">{formatDistance(route.distance)}</span>
                <span className="route-duration">
                  {route.durationIsEstimate ? '≈ ' : ''}
                  {formatDuration(route.duration)}
                </span>
              </div>
              <p className="muted tiny">
                {route.mode === 'online' ? 'Online' : 'Offline'} · {route.providerLabel}
                {route.durationIsEstimate ? ' · time estimated from road types, without live traffic' : ''}
                {route.snapped && (route.snapped.start.offset > 30 || route.snapped.end.offset > 30)
                  ? ` · joined the nearest road ${Math.max(route.snapped.start.offset, route.snapped.end.offset)} m away`
                  : ''}
              </p>
              <ol className="route-steps">
                {route.steps.map((s, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => onFocusPoint({ lat: s.lat, lng: s.lng })}>
                      <span>{s.text}</span>
                      {s.distance > 0 && <span className="muted small">{formatDistance(s.distance)}</span>}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="muted tiny">{route.attribution}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
