// Directions panel: start + destination, travel mode, online/offline routing, results.
// Laid out as floating cards: the route card (where from / where to / how), an explore card before
// a route is found (recent destinations, find nearby by category - real search, offline first),
// and the result card (time, distance, arrival, start navigation, steps).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { useRegions } from '../hooks/useRegions';
import { calculateRoute, offlineCoverage, RouteError } from '../routing/routingManager';
import { searchPlaces } from '../services/geocodeService';
import { searchOffline, searchOnline } from '../search/placeSearch';
import { formatCoord, formatDistance } from '../maps/geo';
import Icon from './Icon';
import '../styles/directions.css';

const MODES = [
  { id: 'car', label: 'Drive', icon: 'car' },
  { id: 'foot', label: 'Walk', icon: 'walk' },
  { id: 'bike', label: 'Cycle', icon: 'bike' },
  { id: 'motorcycle', label: 'Motorbike', icon: 'moto' },
];

// "Find nearby": search categories (search/categories.js) with an icon and a colour each.
const NEARBY = [
  { id: 'restaurants', label: 'Food', icon: 'food', color: '#e8453c' },
  { id: 'hotels', label: 'Hotels', icon: 'bed', color: '#8e5cf7' },
  { id: 'hospitals', label: 'Hospitals', icon: 'medical', color: '#d81b60' },
  { id: 'fuel', label: 'Petrol', icon: 'fuel', color: '#00897b' },
  { id: 'shopping', label: 'Shopping', icon: 'bag', color: '#ef6c00' },
  { id: 'atm', label: 'ATMs', icon: 'atm', color: '#2e7d32' },
  { id: 'transport', label: 'Transport', icon: 'train', color: '#1a73e8' },
  { id: 'grocery', label: 'Grocery', icon: 'cart', color: '#7cb342' },
];

const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const RECENT_MAX = 5;
const recentKey = (userId) => `innermap.recent-destinations.${userId || 'guest'}`;

function readRecent(userId) {
  try {
    const list = JSON.parse(localStorage.getItem(recentKey(userId)));
    return Array.isArray(list) ? list.filter((r) => r && r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng)) : [];
  } catch {
    return [];
  }
}

export function formatDuration(s) {
  if (!Number.isFinite(s)) return '-';
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** One location field: free text with a suggestion list (also used by the Earth page). */
export function PlaceField({ label, value, onChange, onPick, picking, places, position, online, autoFocus, marker }) {
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
    <div className="place-field rp-field" ref={ref}>
      <span className={`rp-marker rp-marker-${marker}`} aria-hidden="true" />
      <label className="sr-only">{label}</label>
      <div className="place-field-row">
        <input
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          placeholder={marker === 'start' ? 'Choose a starting point' : 'Where to?'}
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
        {onPick && (
          <button
            type="button"
            className={`icon-btn rp-pick ${picking ? 'active' : ''}`}
            onClick={onPick}
            title="Choose on the map"
            aria-label={`Choose ${label.toLowerCase()} on the map`}
            aria-pressed={picking}
          >
            <Icon name="pin" size={16} />
          </button>
        )}
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

export default function RoutePanel({ userId, pick, setPick, picked, onResult, onFocusPoint, onClose, onStartNavigation, initialEnd = null }) {
  const { status } = useConnectivity();
  const { position, locateOnce } = useLocation();
  const { locations } = useSavedLocations(userId);
  const { regions } = useRegions(userId);
  const [start, setStart] = useState({ label: 'My location', kind: 'gps' });
  const [end, setEnd] = useState(() => (initialEnd?.lat != null ? { ...initialEnd, kind: 'search' } : null));
  const [profile, setProfile] = useState('car');
  const [preference, setPreference] = useState('auto');
  const [route, setRoute] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [coverage, setCoverage] = useState([]);
  const [collapsed, setCollapsed] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [recent, setRecent] = useState(() => readRecent(userId));
  const [nearby, setNearby] = useState(null); // { cat, loading, items, error }

  const online = status !== 'offline';
  const plannedMode = preference === 'auto' ? (online ? 'online' : 'offline') : preference;
  const indexedIds = useMemo(() => regions.filter((r) => r.search?.status === 'completed').map((r) => r.id), [regions]);

  useEffect(() => {
    const load = () => offlineCoverage(userId).then(setCoverage).catch(() => setCoverage([]));
    load();
    window.addEventListener('innermap:routing-changed', load);
    return () => window.removeEventListener('innermap:routing-changed', load);
  }, [userId]);

  // A point chosen by clicking the map.
  useEffect(() => {
    if (!picked) return;
    const v = { label: picked.label || `${formatCoord(picked.lat, 5)}, ${formatCoord(picked.lng, 5)}`, lat: picked.lat, lng: picked.lng, kind: 'map' };
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

  const remember = (dest) => {
    if (!dest || dest.lat == null || dest.kind === 'gps') return;
    const item = { label: dest.label, lat: dest.lat, lng: dest.lng };
    const next = [item, ...recent.filter((r) => r.label !== item.label)].slice(0, RECENT_MAX);
    setRecent(next);
    try {
      localStorage.setItem(recentKey(userId), JSON.stringify(next));
    } catch {
      /* private window: recent destinations last for this visit only */
    }
  };

  const find = async (pref = preference, dest = end) => {
    setError(null);
    setBusy(true);
    try {
      let from;
      try {
        from = await resolve(start);
      } catch {
        throw new RouteError('Your GPS position is not available. Choose a starting point on the map, a saved place or coordinates.');
      }
      const to = await resolve(dest);
      if (!from) throw new RouteError('Choose a starting point.');
      if (!to) throw new RouteError('Choose a destination.');
      const r = await calculateRoute({ userId, profile, from, to, preference: pref });
      setRoute({ ...r, profile, calculatedAt: Date.now() });
      setCollapsed(false);
      setStepsOpen(false);
      remember(dest);
    } catch (err) {
      setRoute(null);
      setError(err instanceof RouteError ? err : new RouteError(err.message || 'Routing failed.'));
    } finally {
      setBusy(false);
    }
  };

  /** Destination chosen from Recent or Find nearby: set it and find the route straight away. */
  const goTo = (v) => {
    setEnd(v);
    setRoute(null);
    setNearby(null);
    find(preference, v);
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

  // Nearby places of a category around the start point (downloaded areas first, then online).
  const searchNearby = async (cat) => {
    const origin = endpoints.start || (position ? { lat: position.lat, lng: position.lng } : null);
    if (!origin) {
      setNearby({ cat, loading: false, items: [], error: 'Choose a starting point first (or allow location access) to find places near it.' });
      return;
    }
    setNearby({ cat, loading: true, items: [], error: null });
    let items = [];
    let error = null;
    try {
      if (indexedIds.length) {
        const r = await searchOffline({ category: cat.id, regionIds: indexedIds, origin, radiusM: 15000, limit: 8 });
        items = r.results;
      }
      if (items.length < 3 && online) {
        try {
          const more = await searchOnline({ category: cat.id, origin });
          const seen = new Set(items.map((i) => i.name.toLowerCase()));
          items = [...items, ...more.filter((m) => !seen.has(m.name.toLowerCase()))];
        } catch (err) {
          if (!items.length) error = err.message;
        }
      }
      items.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
      if (!items.length && !error) {
        error = online
          ? `No ${cat.label.toLowerCase()} found within about 10 km.`
          : `No ${cat.label.toLowerCase()} in your downloaded areas near here. Online search needs internet.`;
      }
    } catch (err) {
      error = err.message || 'Search failed.';
    }
    setNearby({ cat, loading: false, items: items.slice(0, 8), error });
  };

  const mode = MODES.find((m) => m.id === (route?.profile || profile)) || MODES[0];
  const arrive = route ? new Date((route.calculatedAt || Date.now()) + route.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className={`route-panel rp ${collapsed ? 'collapsed' : ''}`} role="dialog" aria-label="Directions">
      {/* ---------------- route card: where from, where to, how */}
      <section className="rp-card rp-plan">
        <div className="rp-head">
          <button type="button" className="rp-title" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
            <Icon name="route2" size={18} />
            <strong>Directions</strong>
            {route && collapsed && (
              <span className="rp-title-sum">
                {formatDuration(route.duration)} · {formatDistance(route.distance)}
              </span>
            )}
          </button>
          <span className={`mode-badge mode-${route ? route.mode : plannedMode}`}>
            {route ? (route.mode === 'online' ? 'Online route' : 'Offline route') : plannedMode === 'online' ? 'Online' : 'Offline'}
          </span>
          <button type="button" className="icon-btn" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand directions' : 'Collapse directions'}>
            <Icon name="chevronDown" size={16} className={collapsed ? '' : 'rp-flip'} />
          </button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close directions">
            <Icon name="close" size={16} />
          </button>
        </div>

        {!collapsed && (
          <div className="rp-body">
            <div className="rp-fields">
              <div className="rp-line" aria-hidden="true" />
              <PlaceField
                label="Start"
                marker="start"
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
              <PlaceField
                label="Destination"
                marker="end"
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
              <button type="button" className="rp-swap" onClick={swap} title="Swap start and destination" aria-label="Swap start and destination">
                <Icon name="swap" size={18} />
              </button>
            </div>

            <div className="rp-modes" role="tablist" aria-label="Travel mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={profile === m.id}
                  className={profile === m.id ? 'on' : ''}
                  onClick={() => {
                    setProfile(m.id);
                    setRoute(null);
                  }}
                  title={m.label}
                >
                  <Icon name={m.icon} size={20} />
                  <span>{m.label}</span>
                </button>
              ))}
            </div>

            <div className="rp-actions">
              <button type="button" className="rp-find" onClick={() => find()} disabled={busy || !end}>
                <Icon name="navigation" size={16} /> {busy ? 'Finding route…' : 'Find route'}
              </button>
              <button type="button" className="rp-clear" onClick={clear} disabled={busy || (!route && !end)}>
                Clear
              </button>
              <select
                className="rp-pref"
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

            <p className="rp-note">
              {plannedMode === 'online'
                ? 'Calculated online from OpenStreetMap road data by the routing service.'
                : coverage.length
                  ? `Calculated on this device from downloaded road data: ${coverage.map((c) => c.name).join(', ')}.`
                  : 'No road data downloaded yet - offline directions need it (Download area → include road data).'}
            </p>

            {pick && <p className="rp-hint">Click the map to choose the {pick === 'start' ? 'start' : 'destination'}.</p>}

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
          </div>
        )}
      </section>

      {/* ---------------- explore card: recent + find nearby (before a route) */}
      {!collapsed && !route && !busy && (
        <section className="rp-card rp-explore">
          {nearby ? (
            <>
              <div className="rp-section-head">
                <button type="button" className="icon-btn" onClick={() => setNearby(null)} aria-label="Back to categories">
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path d="M20 12H5m6-7-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <span className="rp-cat-badge" style={{ '--c': nearby.cat.color }}>
                  <Icon name={nearby.cat.icon} size={16} />
                </span>
                <h3>{nearby.cat.label} nearby</h3>
              </div>
              {nearby.loading && <p className="rp-empty">Searching near {start?.kind === 'gps' ? 'your location' : 'the start'}…</p>}
              {nearby.error && <p className="rp-empty">{nearby.error}</p>}
              <ul className="rp-list">
                {nearby.items.map((it) => (
                  <li key={it.id}>
                    <button type="button" onClick={() => goTo({ label: it.name, lat: it.lat, lng: it.lng, kind: 'search' })}>
                      <span className="rp-cat-badge small" style={{ '--c': nearby.cat.color }}>
                        <Icon name={nearby.cat.icon} size={14} />
                      </span>
                      <span className="rp-list-text">
                        <strong>{it.name}</strong>
                        <small>
                          {[it.type, it.address].filter(Boolean).join(' · ') || (it.source === 'offline' ? 'Downloaded map data' : 'OpenStreetMap')}
                        </small>
                      </span>
                      {it.distance != null && <span className="rp-dist">{formatDistance(it.distance)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              {recent.length > 0 && (
                <>
                  <h3 className="rp-h3">Recent</h3>
                  <ul className="rp-list rp-recent">
                    {recent.map((r) => (
                      <li key={r.label}>
                        <button type="button" onClick={() => goTo({ ...r, kind: 'search' })}>
                          <Icon name="clock" size={18} className="rp-muted-icon" />
                          <span className="rp-list-text">
                            <strong>{r.label}</strong>
                          </span>
                          <Icon name="arrowRight" size={16} className="rp-muted-icon" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="rp-section-head rp-nearby-head">
                <h3>Find nearby</h3>
                <small>{start?.kind === 'gps' ? 'near your location' : 'near the start'}</small>
              </div>
              <div className="rp-grid">
                {NEARBY.map((c) => (
                  <button key={c.id} type="button" className="rp-cat" style={{ '--c': c.color }} onClick={() => searchNearby(c)}>
                    <span className="rp-cat-badge">
                      <Icon name={c.icon} size={22} />
                    </span>
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ---------------- result card */}
      {!collapsed && route && (
        <section className="rp-card rp-result">
          <div className="rp-result-top">
            <span className="rp-mode-icon">
              <Icon name={mode.icon} size={22} />
            </span>
            <div className="rp-result-main">
              <div className="rp-time">
                {route.durationIsEstimate ? '≈ ' : ''}
                {formatDuration(route.duration)}
              </div>
              <div className="rp-sub">
                {formatDistance(route.distance)} · arrive {route.durationIsEstimate ? '≈ ' : ''}
                {arrive}
              </div>
            </div>
          </div>
          <div className="rp-dest">
            <span className="rp-marker rp-marker-end" aria-hidden="true" />
            <span>{end?.label || 'Destination'}</span>
          </div>
          <p className="rp-note">
            {route.mode === 'online' ? 'Online' : 'Offline'} · {route.providerLabel}
            {route.durationIsEstimate ? ' · time estimated from road types, without live traffic' : ''}
            {route.snapped && (route.snapped.start.offset > 30 || route.snapped.end.offset > 30)
              ? ` · joined the nearest road ${Math.max(route.snapped.start.offset, route.snapped.end.offset)} m away`
              : ''}
          </p>
          {route.profileNote && <p className={`route-note ${route.profileFallback ? 'warn' : ''}`}>{route.profileNote}</p>}
          {onStartNavigation && (
            <button
              type="button"
              className="rp-start"
              onClick={() => {
                const last = route.geometry[route.geometry.length - 1];
                onStartNavigation({
                  route,
                  profile: route.profile || profile, // the mode this route was calculated for
                  to: end?.lat != null ? { lat: end.lat, lng: end.lng } : { lat: last[0], lng: last[1] },
                  toLabel: end?.label || 'Destination',
                });
              }}
            >
              <Icon name="navigation" size={18} /> Start navigation
            </button>
          )}
          {route.steps?.length > 0 && (
            <>
              <button type="button" className="rp-steps-toggle" onClick={() => setStepsOpen((o) => !o)} aria-expanded={stepsOpen}>
                <span>
                  {route.steps.length} step{route.steps.length === 1 ? '' : 's'}
                </span>
                <Icon name="chevronDown" size={16} className={stepsOpen ? 'rp-flip' : ''} />
              </button>
              {stepsOpen && (
                <ol className="route-steps rp-steps">
                  {route.steps.map((s, i) => (
                    <li key={i}>
                      <button type="button" onClick={() => onFocusPoint({ lat: s.lat, lng: s.lng })}>
                        <span>{s.text}</span>
                        {s.distance > 0 && <span className="muted small">{formatDistance(s.distance)}</span>}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          <p className="rp-attr">{route.attribution}</p>
        </section>
      )}
    </div>
  );
}
