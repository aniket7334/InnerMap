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
import { directAlternatives, straightKm } from '../routing/directOsrm';
import EarthPlaceCard from './EarthPlaceCard';
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

/** A category symbol: a map glyph (ॐ, ☪, ✝) where the category has one, else an icon. */
function CatIcon({ item, size }) {
  if (item.glyph) return <span className="ex-glyph" style={{ fontSize: Math.round(size * 0.95) }} aria-hidden="true">{item.glyph}</span>;
  return <Icon name={item.icon} size={size} />;
}

export default function EarthExplore({ uid, online, worldNames, center, getViewBox, onFly, results, onResults, selected, onSelect, onRoute, onNeedAccount, onOpenMap, onOpenPhoto }) {
  const { position, locateOnce } = useLocation();
  const { locations, add: addSaved } = useSavedLocations(uid);
  const [place, setPlace] = useState(null); // searched place shown as a card
  const [alts, setAlts] = useState([]); // alternative routes (fastest first)
  const [altIndex, setAltIndex] = useState(0);
  const [ways, setWays] = useState(null); // { kind, loading, from, to, error } - train / bus / flight
  const routeSeq = useRef(0);
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
    // the area in view; zoomed out too far to mean a place: near you (GPS) or the centre of the view
    let box = getViewBox();
    let where = 'in this area';
    if (!box) {
      const at = position ? { lat: position.lat, lng: position.lng } : center ? { lat: center.lat, lng: center.lng } : null;
      if (!at) {
        setArea({ cat, loading: false, error: 'Point the view at a city, or allow location access, to find places nearby.' });
        onResults([]);
        return;
      }
      const d = 0.06; // about 6 km around
      box = { rect: { west: at.lng - d, east: at.lng + d, south: at.lat - d, north: at.lat + d }, center: at };
      where = position ? 'near you' : 'near the centre of the view';
      onFly({ lat: at.lat, lng: at.lng, zoom: 13 });
    }
    setArea({ cat, loading: true, error: null, where });
    onResults([]);
    try {
      const list = await searchArea(cat, box.rect, box.center);
      setArea({ cat, loading: false, where, error: list.length ? null : `No ${cat.label.toLowerCase()} found ${where}. Zoom in to a city, or move the view.` });
      onResults(list.map((r, i) => ({ ...r, n: i + 1, color: cat.color, icon: cat.icon, glyph: cat.glyph })));
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
      setAlts([]);
      setAltIndex(0);
      setWays(null);
      onRoute(full, true, []);
      if (dest?.label) remember({ name: dest.label, lat: to.lat, lng: to.lng, sub: 'Destination' });
      // other roads to the same place (expressways, highways...) - online, as they arrive
      const seq = ++routeSeq.current;
      if (online && full.mode === 'online') {
        directAlternatives(prof, from, to, (list) => {
          if (seq !== routeSeq.current || list.length < 2) return;
          setAlts(list);
          // keep showing the route on screen; draw the others in grey
          onRoute(full, false, list.slice(1));
        }).catch(() => {});
      }
    } catch (err) {
      setRoute(null);
      onRoute(null);
      setRouteErr(err.message || 'No route found.');
    } finally {
      setBusy(false);
    }
  };
  const chooseAlt = (i) => {
    const a = alts[i];
    if (!a || !route) return;
    setAltIndex(i);
    const next = { ...a, mode: 'online', profile: route.profile, calculatedAt: Date.now(), from: route.from, to: route.to };
    setRoute(next);
    onRoute(next, false, alts.filter((_, j) => j !== i));
  };
  // train / bus / flight: the nearest stations at both ends (no timetables - none are available)
  const loadWays = async (kind) => {
    if (!route) return;
    const q = { train: { q: 'railway station', label: 'Railway stations' }, bus: { q: 'bus station', label: 'Bus stations' }, flight: { q: 'airport', label: 'Airports' } }[kind];
    const d = kind === 'flight' ? 0.6 : 0.25;
    setWays({ kind, loading: true });
    try {
      const near = async (p) => (await searchArea(q, { west: p.lng - d, east: p.lng + d, south: p.lat - d, north: p.lat + d }, p))[0] || null;
      const a = await near(route.from);
      const b = await near(route.to);
      setWays({ kind, loading: false, from: a, to: b, error: !a || !b ? `No ${q.label.toLowerCase()} found near ${!a ? 'the start' : 'the destination'}.` : null });
    } catch (err) {
      setWays({ kind, loading: false, error: err.message });
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
    routeSeq.current++;
    setAlts([]);
    setWays(null);
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
                <SearchBox variant="earth" searchButton autoPick placeholder="Search any city or place" onSelect={(row) => (pickSearch(row), setPlace(row?.lat != null ? row : null), onFly(row))} />
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

          {/* ---------- the searched place */}
          {place && (
            <EarthPlaceCard
              row={place}
              online={online}
              uid={uid}
              onClose={() => setPlace(null)}
              onDirections={(p) => {
                setPlace(null);
                directionsTo(p);
              }}
              onSave={async (p) => {
                if (!uid) {
                  onNeedAccount();
                  return false;
                }
                await addSaved({ name: p.name.slice(0, 100), latitude: p.lat, longitude: p.lng });
                return true;
              }}
              onNearby={(p) => {
                setPlace(null);
                setArea(null);
                setAreaOpen(true);
                onFly({ lat: p.lat, lng: p.lng, zoom: 14 });
              }}
              onOpenPhoto={onOpenPhoto}
            />
          )}

          {/* ---------- weather */}
          {!place && <Weather online={online} center={center} worldNames={worldNames} />}

          {/* ---------- search this area */}
          <section className={`ex-card ex-area ${place ? 'ex-hidden' : ''}`} aria-label="Search this area">
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
                          <CatIcon item={c} size={22} />
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
                    <CatIcon item={area.cat} size={15} />
                  </span>
                  <h3>
                    {area.cat.label} {area.where || 'in this area'}
                  </h3>
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
                <ol className="ex-results ex-result-cards" ref={listRef}>
                  {results.map((r) => (
                    <li key={r.id} className={selected?.id === r.id ? 'on' : ''}>
                      <button type="button" className="ex-rc-main" onClick={() => (onSelect(r), remember({ name: r.name, sub: r.address, lat: r.lat, lng: r.lng }))}>
                        <span className="ex-rc-icon" style={{ '--c': r.color }}>
                          <CatIcon item={r} size={18} />
                          <b>{r.n}</b>
                        </span>
                        <span className="ex-recent-text">
                          <strong>{r.name}</strong>
                          <small>{[r.type, r.address].filter(Boolean).join(' · ')}</small>
                          <small className="ex-rc-dist">{formatKm(r.km)} away</small>
                        </span>
                      </button>
                      <button type="button" className="ex-rc-go" onClick={() => directionsTo(r)} aria-label={`Directions to ${r.name}`} title="Directions">
                        <Icon name="navigation" size={16} />
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
                      <CatIcon item={dirNearby.cat} size={15} />
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
                          <CatIcon item={c} size={22} />
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
              <p className="ex-note">
                {route.mode === 'online' ? 'Online' : 'Offline'} · {route.providerLabel}
              </p>
              {route.profileNote && <p className="ex-note ex-warn">{route.profileNote}</p>}

              {alts.length > 1 && (
                <div className="ex-alts" role="radiogroup" aria-label="Routes">
                  {alts.map((a, i) => (
                    <button key={i} type="button" role="radio" aria-checked={altIndex === i} className={altIndex === i ? 'on' : ''} onClick={() => chooseAlt(i)}>
                      <span className="ex-alt-main">
                        <strong>{formatDuration(a.duration)}</strong>
                        <span>{formatDistance(a.distance)}</span>
                      </span>
                      <span className="ex-alt-via">
                        {i === 0 ? 'Fastest' : `+${formatDuration(a.duration - alts[0].duration)}`}
                        {a.via ? ` · via ${a.via}` : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {route.from && route.to && straightKm(route.from, route.to) > 60 && (
                <div className="ex-ways">
                  <h4>Other ways to get there</h4>
                  <div className="ex-ways-row">
                    {[
                      ['train', 'Train', 'train'],
                      ['bus', 'Bus', 'car'],
                      ...(straightKm(route.from, route.to) > 300 ? [['flight', 'Flight', 'navigation']] : []),
                    ].map(([k, label, icon]) => (
                      <button key={k} type="button" className={ways?.kind === k ? 'on' : ''} onClick={() => loadWays(k)} disabled={!online}>
                        <Icon name={icon} size={16} /> {label}
                      </button>
                    ))}
                  </div>
                  {ways?.loading && <div className="ex-skeleton" />}
                  {ways && !ways.loading && (
                    <div className="ex-ways-result">
                      {ways.error && <p className="ex-note">{ways.error}</p>}
                      {ways.from && ways.to && (
                        <>
                          <div className="ex-ways-leg">
                            <span className="ex-ways-dot" />
                            <div>
                              <strong>{ways.from.name}</strong>
                              <small>{ways.from.km.toFixed(1)} km from the start</small>
                            </div>
                            <button type="button" className="ex-pill" onClick={() => directionsTo({ name: ways.from.name, lat: ways.from.lat, lng: ways.from.lng })}>
                              Route there
                            </button>
                          </div>
                          <div className="ex-ways-leg">
                            <span className="ex-ways-dot end" />
                            <div>
                              <strong>{ways.to.name}</strong>
                              <small>{ways.to.km.toFixed(1)} km from the destination</small>
                            </div>
                          </div>
                          <p className="ex-note">
                            About {Math.round(straightKm(ways.from, ways.to))} km apart in a straight line. Timetables, fares and tickets are not available in InnerMap - check the operator.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="ex-place-actions">
                <button type="button" className="ex-pill primary" onClick={() => onOpenMap(route, end)}>
                  <Icon name="map" size={16} /> Navigate in 2D map
                </button>
                <button type="button" className="ex-pill" onClick={() => onRoute(route, true, alts.filter((_, j) => j !== altIndex))}>
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
