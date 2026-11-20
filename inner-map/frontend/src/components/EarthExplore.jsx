// Explore panel of the Earth page: search card (place search, directions button, recent places),
// live weather for the city in view, "Search this area" by category (results pinned on the globe),
// and online directions drawn on the globe. All data is real: OpenStreetMap search, Open-Meteo
// weather, and the app's own online routing (signed-in users).
import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import SearchBox from './SearchBox';
import { PlaceField, formatDuration } from './RoutePanel';
import { useLocation } from '../hooks/LocationContext';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { calculateRoute, RouteError } from '../routing/routingManager';
import { formatDistance } from '../maps/geo';
import { AREA_CATEGORIES, MORE_CATEGORIES, describeWeather, fetchWeather, formatKm, nearestCity, searchArea } from '../globe/exploreSearch';
import '../styles/explore.css';

const MODES = [
  { id: 'car', label: 'Drive', icon: 'car' },
  { id: 'foot', label: 'Walk', icon: 'walk' },
  { id: 'bike', label: 'Cycle', icon: 'bike' },
  { id: 'motorcycle', label: 'Motorbike', icon: 'moto' },
];
const RECENT_KEY = 'innermap.earth.recent';
const RECENT_MAX = 4;

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(list) ? list.filter((r) => r?.name && Number.isFinite(r.lat) && Number.isFinite(r.lng)) : [];
  } catch {
    return [];
  }
}

const roundTemp = (v) => (Number.isFinite(v) ? Math.round(v) : '–');

function Weather({ online, center, worldNames }) {
  const [open, setOpen] = useState(true);
  const [more, setMore] = useState(false);
  const [data, setData] = useState(null); // { city, w } | { error }
  // zoomed out over a whole country: name a major city, not the nearest small town
  const far = center?.height > 400000;
  const city = useMemo(
    () => (center ? nearestCity(worldNames, center.lat, center.lng, far ? 900 : 400, far ? 2 : 99) : null),
    [worldNames, center?.lat, center?.lng, far] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const key = city ? `${city.name}|${city.lat}|${city.lng}` : center ? `${center.lat.toFixed(1)},${center.lng.toFixed(1)}` : '';
  useEffect(() => {
    if (!online || !center) return undefined;
    let live = true;
    const t = setTimeout(() => {
      const at = city || center;
      fetchWeather(at.lat, at.lng)
        .then((w) => live && setData({ city: city?.name || 'this area', w }))
        .catch((err) => live && setData({ error: err.message }));
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, online]); // eslint-disable-line react-hooks/exhaustive-deps

  const w = data?.w;
  const d = w ? describeWeather(w.code, w.isDay) : null;
  return (
    <section className={`ex-card ex-weather ${d ? `wx-${d.kind} ${w.isDay ? 'wx-day' : 'wx-night'}` : 'wx-none'}`} aria-label="Weather">
      <header className="ex-weather-head">
        <span>{online ? `Weather in ${data?.city || (city?.name ?? 'this area')}` : 'Weather'}</span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? 'Hide the weather' : 'Show the weather'}>
          <Icon name="chevronDown" size={18} className={open ? 'ex-flip' : ''} />
        </button>
      </header>
      {open && (
        <>
          {!online && <p className="ex-weather-msg">The weather needs an internet connection.</p>}
          {online && data?.error && <p className="ex-weather-msg">The weather could not be loaded ({data.error}).</p>}
          {online && !data && <div className="ex-skeleton light" aria-label="Loading the weather" />}
          {online && w && (
            <div className="ex-weather-main">
              <div className="ex-temp">
                {roundTemp(w.temp)}
                <sup>°</sup>
              </div>
              <Icon name={d.icon} size={40} className="ex-wx-icon" />
              <div className="ex-wx-text">
                <strong>{d.text}</strong>
                <span>Feels like {roundTemp(w.feels)}°</span>
              </div>
              <button type="button" className="ex-wx-more" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-label={more ? 'Less weather detail' : 'More weather detail'}>
                <Icon name="arrowRight" size={18} className={more ? 'ex-rot' : ''} />
              </button>
            </div>
          )}
          {online && w && more && (
            <dl className="ex-wx-detail">
              <div>
                <dt>High / low</dt>
                <dd>
                  {roundTemp(w.max)}° / {roundTemp(w.min)}°
                </dd>
              </div>
              <div>
                <dt>Humidity</dt>
                <dd>{Math.round(w.humidity)}%</dd>
              </div>
              <div>
                <dt>Wind</dt>
                <dd>
                  {Math.round(w.wind)} {w.units.wind}
                </dd>
              </div>
            </dl>
          )}
          <p className="ex-credit-light">
            <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
              Weather data by Open-Meteo.com
            </a>
          </p>
        </>
      )}
    </section>
  );
}

export default function EarthExplore({ uid, online, worldNames, center, getViewBox, onFly, results, onResults, selected, onSelect, onRoute, onNeedAccount, onOpenMap }) {
  const { position, locateOnce } = useLocation();
  const { locations } = useSavedLocations(uid);
  const [mode, setMode] = useState('explore'); // explore | directions
  const [areaOpen, setAreaOpen] = useState(true);
  const [moreCats, setMoreCats] = useState(false);
  const [area, setArea] = useState(null); // { cat, loading, error }
  const [recent, setRecent] = useState(readRecent);
  // directions
  const [start, setStart] = useState({ label: 'My location', kind: 'gps' });
  const [end, setEnd] = useState(null);
  const [profile, setProfile] = useState('car');
  const [route, setRoute] = useState(null);
  const [routeErr, setRouteErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [dirNearby, setDirNearby] = useState(null); // { cat, loading, items, error }
  const listRef = useRef(null);

  const remember = (p) => {
    if (!p || !Number.isFinite(p.lat)) return;
    const item = { name: p.name, sub: p.sub || '', lat: p.lat, lng: p.lng };
    const next = [item, ...recent.filter((r) => r.name !== item.name)].slice(0, RECENT_MAX);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* private window: recent places last for this visit only */
    }
  };

  // ---- search this area
  const runArea = async (cat) => {
    if (cat.id === 'more') {
      setMoreCats(true);
      return;
    }
    const box = getViewBox();
    if (!box) {
      setArea({ cat, loading: false, error: 'Zoom in to a city or town to search the area.' });
      onResults([]);
      return;
    }
    setArea({ cat, loading: true, error: null });
    onResults([]);
    try {
      const list = await searchArea(cat, box.rect, box.center);
      setArea({ cat, loading: false, error: list.length ? null : `No ${cat.label.toLowerCase()} found in this area. Zoom in to a city, or move the view.` });
      onResults(list.map((r, i) => ({ ...r, n: i + 1, color: cat.color, icon: cat.icon })));
      listRef.current?.scrollTo?.(0, 0);
    } catch (err) {
      setArea({ cat, loading: false, error: err.message });
    }
  };
  const closeArea = () => {
    setArea(null);
    onResults([]);
    onSelect(null);
  };

  // ---- directions
  const resolve = async (v) => {
    if (!v) return null;
    if (v.kind === 'gps') {
      if (position && !position.restored) return { lat: position.lat, lng: position.lng };
      const p = await locateOnce();
      return { lat: p.lat, lng: p.lng };
    }
    return v.lat != null ? { lat: v.lat, lng: v.lng } : null;
  };
  const findRoute = async (dest = end, prof = profile) => {
    setRouteErr(null);
    setBusy(true);
    try {
      let from;
      try {
        from = await resolve(start);
      } catch {
        throw new RouteError('Your location is not available. Type a starting point instead.');
      }
      const to = await resolve(dest);
      if (!from) throw new RouteError('Choose a starting point.');
      if (!to) throw new RouteError('Choose a destination.');
      const r = await calculateRoute({ userId: uid, profile: prof, from, to, preference: 'online' });
      const full = { ...r, profile: prof, calculatedAt: Date.now(), from, to };
      setRoute(full);
      setStepsOpen(false);
      onRoute(full);
      if (dest?.label) remember({ name: dest.label, lat: to.lat, lng: to.lng, sub: 'Destination' });
    } catch (err) {
      setRoute(null);
      onRoute(null);
      setRouteErr(err.message || 'No route found.');
    } finally {
      setBusy(false);
    }
  };
  const directionsTo = (p) => {
    const v = { label: p.name, lat: p.lat, lng: p.lng, kind: 'search' };
    setMode('directions');
    setEnd(v);
    setRoute(null);
    onRoute(null);
    findRoute(v);
  };
  // Find nearby (directions): places of a kind around the start point, nearest first
  const nearbyForRoute = async (cat) => {
    let origin = null;
    try {
      origin = start?.kind === 'gps' ? (position ? { lat: position.lat, lng: position.lng } : null) : start?.lat != null ? { lat: start.lat, lng: start.lng } : null;
    } catch {
      origin = null;
    }
    if (!origin && center) origin = { lat: center.lat, lng: center.lng };
    if (!origin) {
      setDirNearby({ cat, loading: false, items: [], error: 'Choose a starting point first.' });
      return;
    }
    setDirNearby({ cat, loading: true, items: [], error: null });
    try {
      const d = 0.12; // about 13 km around the start
      const items = await searchArea(cat, { west: origin.lng - d, east: origin.lng + d, south: origin.lat - d, north: origin.lat + d }, origin);
      setDirNearby({ cat, loading: false, items: items.slice(0, 8), error: items.length ? null : `No ${cat.label.toLowerCase()} found near the start.` });
    } catch (err) {
      setDirNearby({ cat, loading: false, items: [], error: err.message });
    }
  };
  const closeDirections = () => {
    setMode('explore');
    setRoute(null);
    setRouteErr(null);
    onRoute(null);
  };

  const pickSearch = (row) => {
    if (row?.lat != null) remember({ name: (row.name || row.label || 'Place').split(',')[0], sub: (row.name || '').split(',').slice(1, 3).join(',').trim(), lat: row.lat, lng: row.lng });
  };

  const modeInfo = MODES.find((m) => m.id === (route?.profile || profile)) || MODES[0];
  const arrive = route ? new Date(route.calculatedAt + route.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const cats = moreCats ? MORE_CATEGORIES : AREA_CATEGORIES;

  return (
    <div className="earth-explore" aria-label="Explore">
      {mode === 'explore' ? (
        <>
          {/* ---------- search card */}
          <section className="ex-card ex-search">
            <div className="ex-search-row">
              <div className="ex-search-box">
                <SearchBox variant="earth" searchButton placeholder="Search any city or place" onSelect={(row) => (pickSearch(row), onFly(row))} />
              </div>
              <button type="button" className="ex-dir-btn" onClick={() => setMode('directions')} title="Directions" aria-label="Directions">
                <Icon name="navigation" size={18} />
              </button>
            </div>
            {recent.length > 0 && (
              <ul className="ex-recent">
                {recent.map((r) => (
                  <li key={r.name}>
                    <button type="button" onClick={() => onFly({ lat: r.lat, lng: r.lng, zoom: 15, name: r.name })}>
                      <Icon name="clock" size={18} className="ex-muted" />
                      <span className="ex-recent-text">
                        <strong>{r.name}</strong>
                        {r.sub && <small>{r.sub}</small>}
                      </span>
                      <Icon name="arrowRight" size={16} className="ex-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ---------- weather */}
          <Weather online={online} center={center} worldNames={worldNames} />

          {/* ---------- search this area */}
          <section className="ex-card ex-area" aria-label="Search this area">
            {!area ? (
              <>
                <header className="ex-area-head">
                  {moreCats && (
                    <button type="button" className="ex-icon-btn" onClick={() => setMoreCats(false)} aria-label="Back to the main categories">
                      <Icon name="chevron" size={18} className="ex-back" />
                    </button>
                  )}
                  <h3>{moreCats ? 'All places' : 'Search this area'}</h3>
                  <button type="button" className="ex-icon-btn" onClick={() => setAreaOpen((o) => !o)} aria-expanded={areaOpen} aria-label={areaOpen ? 'Hide categories' : 'Show categories'}>
                    <Icon name="chevronDown" size={18} className={areaOpen ? 'ex-flip' : ''} />
                  </button>
                </header>
                {areaOpen && (
                  <div className="ex-grid">
                    {cats.map((c) => (
                      <button key={c.id} type="button" className="ex-cat" style={{ '--c': c.color }} onClick={() => runArea(c)} disabled={!online && c.id !== 'more'}>
                        <span className="ex-cat-badge">
                          <Icon name={c.icon} size={22} />
                        </span>
                        <span>{c.label}</span>
                      </button>
                    ))}
                  </div>
                )}
                {areaOpen && !online && <p className="ex-note">Searching the area needs an internet connection.</p>}
              </>
            ) : (
              <>
                <header className="ex-area-head">
                  <button type="button" className="ex-icon-btn" onClick={closeArea} aria-label="Back to categories">
                    <Icon name="chevron" size={18} className="ex-back" />
                  </button>
                  <span className="ex-cat-badge small" style={{ '--c': area.cat.color }}>
                    <Icon name={area.cat.icon} size={15} />
                  </span>
                  <h3>{area.cat.label} in this area</h3>
                  <button type="button" className="ex-icon-btn" onClick={closeArea} aria-label="Close results">
                    <Icon name="close" size={16} />
                  </button>
                </header>
                {area.loading && <div className="ex-skeleton" aria-label="Searching" />}
                {area.error && <p className="ex-note">{area.error}</p>}
                {selected && (
                  <div className="ex-place">
                    <div className="ex-place-head">
                      <span className="ex-num" style={{ '--c': selected.color }}>
                        {selected.n}
                      </span>
                      <div>
                        <strong>{selected.name}</strong>
                        <small>{[selected.type, selected.address].filter(Boolean).join(' · ')}</small>
                      </div>
                    </div>
                    <div className="ex-place-actions">
                      <button type="button" className="ex-pill primary" onClick={() => directionsTo(selected)}>
                        <Icon name="navigation" size={16} /> Directions
                      </button>
                      <button type="button" className="ex-pill" onClick={() => onFly({ lat: selected.lat, lng: selected.lng, zoom: 17, name: selected.name })}>
                        <Icon name="crosshair" size={16} /> Fly there
                      </button>
                    </div>
                  </div>
                )}
                <ol className="ex-results" ref={listRef}>
                  {results.map((r) => (
                    <li key={r.id}>
                      <button type="button" className={selected?.id === r.id ? 'on' : ''} onClick={() => (onSelect(r), remember({ name: r.name, sub: r.address, lat: r.lat, lng: r.lng }))}>
                        <span className="ex-num" style={{ '--c': r.color }}>
                          {r.n}
                        </span>
                        <span className="ex-recent-text">
                          <strong>{r.name}</strong>
                          <small>{[r.type, r.address].filter(Boolean).join(' · ')}</small>
                        </span>
                        <span className="ex-dist">{formatKm(r.km)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                {results.length > 0 && <p className="ex-credit">Places © OpenStreetMap contributors</p>}
              </>
            )}
          </section>
        </>
      ) : (
        <>
          {/* ---------- directions */}
          <section className="ex-card ex-directions">
            <header className="ex-area-head">
              <button type="button" className="ex-icon-btn" onClick={closeDirections} aria-label="Back to explore">
                <Icon name="chevron" size={18} className="ex-back" />
              </button>
              <h3>Directions</h3>
              <span className={`mode-badge mode-${online ? 'online' : 'offline'}`}>{online ? 'Online' : 'Offline'}</span>
            </header>
            {(
              <div className="ex-dir-body">
                <div className="rp-fields">
                  <div className="rp-line" aria-hidden="true" />
                  <PlaceField label="Start" marker="start" value={start} onChange={(v) => (setStart(v), setRoute(null), onRoute(null))} places={locations} position={position} online={online} />
                  <PlaceField label="Destination" marker="end" value={end} onChange={(v) => (setEnd(v), setRoute(null), onRoute(null))} places={locations} position={position} online={online} autoFocus={!end} />
                  <button
                    type="button"
                    className="rp-swap"
                    onClick={() => {
                      setStart(end || { label: 'My location', kind: 'gps' });
                      setEnd(start?.kind === 'gps' && !end ? null : start);
                      setRoute(null);
                      onRoute(null);
                    }}
                    aria-label="Swap start and destination"
                  >
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
                        if (route) findRoute(end, m.id);
                      }}
                    >
                      <Icon name={m.icon} size={20} />
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
                <button type="button" className="rp-find" onClick={() => findRoute()} disabled={busy || !end || !online}>
                  <Icon name="navigation" size={16} /> {busy ? 'Finding route…' : 'Find route'}
                </button>
                {!online && <p className="ex-note">Online directions need an internet connection. Offline routes are in the 2D map.</p>}
                {routeErr && (
                  <p className="ex-error" role="alert">
                    {routeErr}
                  </p>
                )}
              </div>
            )}
          </section>

          {!route && !busy && (
            <section className="ex-card ex-area ex-dir-explore">
              {dirNearby ? (
                <>
                  <header className="ex-area-head">
                    <button type="button" className="ex-icon-btn" onClick={() => setDirNearby(null)} aria-label="Back to categories">
                      <Icon name="chevron" size={18} className="ex-back" />
                    </button>
                    <span className="ex-cat-badge small" style={{ '--c': dirNearby.cat.color }}>
                      <Icon name={dirNearby.cat.icon} size={15} />
                    </span>
                    <h3>{dirNearby.cat.label} nearby</h3>
                  </header>
                  {dirNearby.loading && <div className="ex-skeleton" aria-label="Searching" />}
                  {dirNearby.error && <p className="ex-note">{dirNearby.error}</p>}
                  <ol className="ex-results">
                    {dirNearby.items.map((r, i) => (
                      <li key={r.id}>
                        <button
                          type="button"
                          onClick={() => {
                            const v = { label: r.name, lat: r.lat, lng: r.lng, kind: 'search' };
                            setEnd(v);
                            setDirNearby(null);
                            findRoute(v);
                          }}
                        >
                          <span className="ex-num" style={{ '--c': dirNearby.cat.color }}>
                            {i + 1}
                          </span>
                          <span className="ex-recent-text">
                            <strong>{r.name}</strong>
                            <small>{[r.type, r.address].filter(Boolean).join(' · ')}</small>
                          </span>
                          <span className="ex-dist">{formatKm(r.km)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <>
                  {recent.length > 0 && (
                    <>
                      <h3 className="ex-sub-h">Recent</h3>
                      <ul className="ex-recent flat">
                        {recent.map((r) => (
                          <li key={r.name}>
                            <button
                              type="button"
                              onClick={() => {
                                const v = { label: r.name, lat: r.lat, lng: r.lng, kind: 'search' };
                                setEnd(v);
                                findRoute(v);
                              }}
                            >
                              <Icon name="clock" size={18} className="ex-muted" />
                              <span className="ex-recent-text">
                                <strong>{r.name}</strong>
                                {r.sub && <small>{r.sub}</small>}
                              </span>
                              <Icon name="arrowRight" size={16} className="ex-muted" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <header className="ex-area-head">
                    <h3>Find nearby</h3>
                    <small className="ex-head-note">{start?.kind === 'gps' ? 'near your location' : 'near the start'}</small>
                  </header>
                  <div className="ex-grid">
                    {AREA_CATEGORIES.filter((c) => c.id !== 'more').concat(MORE_CATEGORIES.slice(0, 1)).map((c) => (
                      <button key={c.id} type="button" className="ex-cat" style={{ '--c': c.color }} onClick={() => nearbyForRoute(c)} disabled={!online}>
                        <span className="ex-cat-badge">
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

          {route && (
            <section className="ex-card ex-route">
              <div className="rp-result-top">
                <span className="rp-mode-icon">
                  <Icon name={modeInfo.icon} size={22} />
                </span>
                <div>
                  <div className="rp-time">{formatDuration(route.duration)}</div>
                  <div className="rp-sub">
                    {formatDistance(route.distance)} · arrive {arrive}
                  </div>
                </div>
              </div>
              <div className="rp-dest">
                <span className="rp-marker rp-marker-end" aria-hidden="true" />
                <span>{end?.label || 'Destination'}</span>
              </div>
              <p className="ex-note">Online · {route.providerLabel}</p>
              <div className="ex-place-actions">
                <button type="button" className="ex-pill primary" onClick={() => onOpenMap(route, end)}>
                  <Icon name="map" size={16} /> Navigate in 2D map
                </button>
                <button type="button" className="ex-pill" onClick={() => onRoute(route, true)}>
                  <Icon name="crosshair" size={16} /> Show route
                </button>
              </div>
              {route.steps?.length > 0 && (
                <>
                  <button type="button" className="rp-steps-toggle" onClick={() => setStepsOpen((o) => !o)} aria-expanded={stepsOpen}>
                    <span>{route.steps.length} steps</span>
                    <Icon name="chevronDown" size={16} className={stepsOpen ? 'rp-flip' : ''} />
                  </button>
                  {stepsOpen && (
                    <ol className="route-steps rp-steps">
                      {route.steps.map((s, i) => (
                        <li key={i}>
                          <button type="button" onClick={() => onFly({ lat: s.lat, lng: s.lng, zoom: 17 })}>
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
        </>
      )}
    </div>
  );
}
