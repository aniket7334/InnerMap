// Toolbar search.
//  Offline (as you type): places, streets and businesses of your downloaded areas (on-device
//  index), saved places, offline map names, KML/drawn features, and coordinates.
//  Online (press Enter or the last row): OpenStreetMap Nominatim. Its usage policy forbids
//  autocomplete, so it never runs while typing; max 1 request per second.
//  Filters: category chips + "nearby" distance from your GPS position.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { useRegions } from '../hooks/useRegions';
import { listLayers, getLayerFeatures } from '../services/featureService';
import { featuresBounds } from '../features/kml';
import { parseCoordinates, searchOffline, searchOnline, searchSaved, SEARCH_CATEGORIES } from '../search/placeSearch';
import { categoryLabel } from '../search/categories';
import { formatDistance } from '../maps/geo';
import Icon from './Icon';

const RADII = [
  { value: 0, label: 'Any distance' },
  { value: 1000, label: 'Within 1 km' },
  { value: 5000, label: 'Within 5 km' },
  { value: 20000, label: 'Within 20 km' },
];

// Quick category chips under the map search (same categories as the filter chips).
const QUICK = [
  { id: 'restaurants', label: 'Restaurants', icon: 'food' },
  { id: 'hotels', label: 'Hotels', icon: 'bed' },
  { id: 'hospitals', label: 'Hospitals', icon: 'medical' },
  { id: 'fuel', label: 'Petrol', icon: 'fuel' },
  { id: 'shopping', label: 'Shopping', icon: 'bag' },
];

const SOURCE_BADGE = { offline: 'Offline', saved: 'Saved', online: 'Online', area: 'Offline map', layer: 'Layer', coords: 'Coordinates' };

export default function SearchBox({ onNavigate, onSelect, variant = 'bar', searchButton = false, placeholder }) {
  const { user } = useAuth();
  const uid = user?.id; // signed-out visitors (Earth start page) get online search only
  const { status } = useConnectivity();
  const { position } = useLocation();
  const { locations, add } = useSavedLocations(uid);
  const { regions } = useRegions(uid);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [category, setCategory] = useState('all');
  const [radius, setRadius] = useState(0);
  const [features, setFeatures] = useState([]);
  const [offline, setOffline] = useState({ results: [], indexSize: 0, loading: false });
  const [online, setOnline] = useState({ key: '', results: [], loading: false, error: null });
  const [savedIds, setSavedIds] = useState(() => new Set());
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  const origin = position ? { lat: position.lat, lng: position.lng } : null;
  const originIsLive = position && !position.restored;
  const searchKey = `${query.trim()}|${category}|${radius}`;
  const active2 = query.trim().length >= 2 || category !== 'all';

  // Areas with an offline search index.
  const indexedIds = useMemo(() => regions.filter((r) => r.search?.status === 'completed').map((r) => r.id), [regions]);
  const indexing = regions.some((r) => r.search?.status === 'building');
  const hasVectorAreas = regions.some((r) => r.status === 'completed' || r.status === 'partial');

  // Layer feature names (KML / drawings) - indexed once, refreshed when layers change.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const out = [];
      if (!uid) {
        if (alive) setFeatures([]);
        return;
      }
      for (const layer of await listLayers(uid)) {
        for (const f of await getLayerFeatures(layer.localId)) {
          if (f.name) out.push({ name: f.name, layer: layer.name, geometry: f.geometry });
        }
      }
      if (alive) setFeatures(out);
    };
    load();
    window.addEventListener('innermap:features-changed', load);
    return () => {
      alive = false;
      window.removeEventListener('innermap:features-changed', load);
    };
  }, [uid]);

  useEffect(() => {
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  // "/" focuses the search (when not typing somewhere else).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const pickQuick = (id) => {
    if (id) setCategory(id);
    setActive(-1);
    setOpen(true);
    inputRef.current?.focus();
  };

  // Offline index search while typing (debounced).
  useEffect(() => {
    if (!active2 || !indexedIds.length) {
      setOffline({ results: [], indexSize: 0, loading: false });
      return undefined;
    }
    let alive = true;
    setOffline((o) => ({ ...o, loading: true }));
    const t = setTimeout(async () => {
      try {
        const r = await searchOffline({ query, category, regionIds: indexedIds, origin, radiusM: radius || null, limit: 25 });
        if (alive) setOffline({ ...r, loading: false });
      } catch (err) {
        console.warn('[search]', err);
        if (alive) setOffline({ results: [], indexSize: 0, loading: false });
      }
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // origin changes every GPS fix; distances refresh on the next keystroke/filter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey, indexedIds.join(',')]);

  const q = query.trim();
  const coords = useMemo(() => parseCoordinates(q), [q]);

  const rows = useMemo(() => {
    const out = [];
    if (coords) {
      out.push({ id: 'coords', source: 'coords', name: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`, type: 'Go to coordinates', lat: coords.lat, lng: coords.lng, zoom: 16 });
    }
    if (category === 'all' || category === 'saved') {
      const saved = searchSaved(locations, q, origin).filter((r) => !radius || (r.distance != null && r.distance <= radius));
      out.push(...saved.slice(0, 5));
    }
    if (category === 'all' && q.length >= 2 && !radius) {
      const ql = q.toLowerCase();
      regions
        .filter((r) => (r.name || '').toLowerCase().includes(ql))
        .slice(0, 3)
        .forEach((r) => out.push({ id: `area-${r.id}`, source: 'area', name: r.name, type: 'Downloaded area', bounds: r.bounds }));
      features
        .filter((f) => f.name.toLowerCase().includes(ql))
        .slice(0, 3)
        .forEach((f, i) =>
          out.push(
            f.geometry.type === 'Point'
              ? { id: `layer-${i}-${f.name}`, source: 'layer', name: f.name, type: f.layer, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], zoom: 17 }
              : { id: `layer-${i}-${f.name}`, source: 'layer', name: f.name, type: f.layer, bounds: featuresBounds([f]) }
          )
        );
    }
    out.push(...offline.results);
    if (online.key === searchKey) out.push(...online.results);
    return out;
  }, [coords, category, locations, q, origin, radius, regions, features, offline.results, online, searchKey]);

  const go = (row) => {
    setOpen(false);
    setQuery(row.name);
    if (onSelect) {
      onSelect(row);
      return;
    }
    const focus = row.bounds
      ? { type: 'bounds', bounds: row.bounds, label: row.name, point: row.lat != null ? { lat: row.lat, lng: row.lng } : null }
      : { type: 'point', lat: row.lat, lng: row.lng, label: row.name, zoom: row.zoom };
    navigate('/map', { state: { focus: { ...focus, at: Date.now() } } });
    onNavigate?.();
  };

  const runOnline = async () => {
    if (status === 'offline' || (!q && category === 'all')) return;
    const key = searchKey;
    setOnline({ key, results: [], loading: true, error: null });
    try {
      const results = await searchOnline({ query: q, category, origin });
      const filtered = results.filter((r) => !radius || (r.distance != null && r.distance <= radius));
      setOnline({ key, results: filtered, loading: false, error: filtered.length ? null : 'Nothing found online.' });
    } catch (err) {
      setOnline({ key, results: [], loading: false, error: err.message });
    }
  };

  const save = async (row, e) => {
    e.stopPropagation();
    await add({ name: row.name.slice(0, 100), latitude: row.lat, longitude: row.lng });
    setSavedIds((s) => new Set(s).add(row.id));
  };

  const onKeyDown = (e) => {
    const last = rows.length; // the "search online" row
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(last, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && rows[active]) go(rows[active]);
      else runOnline();
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else {
        setOpen(false);
        e.currentTarget.blur();
      }
    }
  };

  const clear = () => {
    setQuery('');
    setActive(-1);
    setOnline({ key: '', results: [], loading: false, error: null });
    inputRef.current?.focus();
  };

  const showPanel = open && (active2 || q.length > 0);
  const onlineHere = online.key === searchKey;
  let emptyText = null;
  if (active2 && !rows.length && !offline.loading && !(onlineHere && online.loading)) {
    if (!hasVectorAreas) emptyText = 'No downloaded areas yet: offline search covers the areas you download.';
    else if (!indexedIds.length) emptyText = indexing ? 'Preparing offline search for your downloaded areas…' : 'Your downloaded areas have no search data yet.';
    else if (radius && !origin) emptyText = 'Nearby search needs your location. Turn on GPS, or choose “Any distance”.';
    else emptyText = `No match in your downloaded areas${category !== 'all' ? ` for ${categoryLabel(category)}` : ''}. Places outside the downloaded data are not available offline.`;
  }

  return (
    <div className={`search search-${variant} ${showPanel ? 'is-open' : ''}`} ref={boxRef} role="search">
      <Icon name="search" size={18} className="search-icon" />
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        value={query}
        placeholder={placeholder || (variant === 'earth' ? 'Search InnerMap Earth' : variant === 'map' ? 'Search places, streets or coordinates' : 'Search places, streets, businesses or coordinates')}
        aria-label="Search places"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="search-results"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `search-opt-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {query ? (
        <button type="button" className="search-clear" onClick={clear} aria-label="Clear search" title="Clear search">
          <Icon name="close" size={16} />
        </button>
      ) : (
        <kbd className="search-kbd" aria-hidden="true" title="Press / to search">
          /
        </kbd>
      )}
      {searchButton && (
        <button
          type="button"
          className="search-go"
          onClick={() => {
            // search button: any city, town, address or place worldwide (online), or the
            // downloaded maps when offline - the same as pressing Enter
            if (!q) {
              inputRef.current?.focus();
              setOpen(true);
              return;
            }
            setOpen(true);
            if (active >= 0 && rows[active]) go(rows[active]);
            else runOnline();
          }}
          aria-label="Search"
          title="Search for any city, town or place"
        >
          <Icon name="search" size={18} />
        </button>
      )}
      {variant === 'map' && !open && (
        <div className="search-quick" role="group" aria-label="Find nearby">
          {QUICK.map((c) => (
            <button type="button" key={c.id} className={`quick-chip ${category === c.id ? 'active' : ''}`} onClick={() => pickQuick(c.id)}>
              <Icon name={c.icon} size={15} />
              {c.label}
            </button>
          ))}
          <button type="button" className="quick-chip" onClick={() => pickQuick(null)} aria-label="More categories">
            <Icon name="dots" size={15} />
            More
          </button>
        </div>
      )}
      {open && (
        <div className="search-panel" id="search-results">
          <div className="search-filters" role="group" aria-label="Filter by category">
            {SEARCH_CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`search-chip ${category === c.id ? 'active' : ''}`}
                aria-pressed={category === c.id}
                title={c.hint}
                onClick={() => {
                  setCategory(c.id);
                  setActive(-1);
                  inputRef.current?.focus();
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="search-options">
            <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Distance">
              {RADII.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="search-origin">
              {origin ? (originIsLive ? 'Distances from your location' : 'Distances from your last known location') : 'Turn on GPS to see distances'}
            </span>
          </div>

          {showPanel && (
            <div className="search-list" role="listbox" aria-label="Search results">
              {rows.map((r, i) => (
                <div
                  key={r.id}
                  id={`search-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`search-row ${i === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(r)}
                >
                  <div className="search-row-text">
                    <span className="search-row-label">{r.name}</span>
                    <span className="search-row-meta">
                      {[r.type, r.address].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="search-row-side">
                    {r.distance != null && <span className="search-row-dist">{formatDistance(r.distance)}</span>}
                    <span className={`search-badge badge-${r.source}`}>{SOURCE_BADGE[r.source]}</span>
                  </div>
                  {uid && r.lat != null && r.source !== 'saved' && (
                    <button
                      type="button"
                      className="search-save"
                      onClick={(e) => save(r, e)}
                      disabled={savedIds.has(r.id)}
                      aria-label={savedIds.has(r.id) ? `${r.name} saved` : `Save ${r.name}`}
                      title={savedIds.has(r.id) ? 'Saved' : 'Save this place'}
                    >
                      <Icon name={savedIds.has(r.id) ? 'check' : 'pin'} size={15} />
                    </button>
                  )}
                </div>
              ))}
              {offline.loading && !rows.length && <div className="search-empty">Searching your downloaded areas…</div>}
              {emptyText && <div className="search-empty">{emptyText}</div>}
              {indexing && rows.length > 0 && <div className="search-note">Still preparing offline search for some areas…</div>}
            </div>
          )}

          {showPanel && (
            <button
              type="button"
              id={`search-opt-${rows.length}`}
              className={`search-row search-online ${active === rows.length ? 'active' : ''}`}
              onMouseEnter={() => setActive(rows.length)}
              onClick={runOnline}
              disabled={status === 'offline' || (onlineHere && online.loading)}
            >
              <Icon name="globe" size={16} />
              <span>
                {status === 'offline'
                  ? 'Online search needs a connection - showing results stored on this device'
                  : onlineHere && online.loading
                    ? 'Searching OpenStreetMap…'
                    : onlineHere && online.error
                      ? online.error
                      : `Search online${q ? ` for “${q}”` : ` for ${categoryLabel(category)}`}${category !== 'all' && origin ? ' near you' : ''}  ↵`}
              </span>
            </button>
          )}
          {showPanel && onlineHere && online.results.length > 0 && (
            <div className="search-attrib">
              Online results: © OpenStreetMap contributors, Nominatim
            </div>
          )}
        </div>
      )}
    </div>
  );
}
