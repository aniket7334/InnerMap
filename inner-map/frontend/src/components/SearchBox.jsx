// Toolbar search. Local results (saved places, offline maps, layer features) appear as you
// type and work offline. Online place search (OpenStreetMap Nominatim) runs only when you
// press Enter, as Nominatim's usage policy requires (no autocomplete).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { useRegions } from '../hooks/useRegions';
import { listLayers, getLayerFeatures } from '../services/featureService';
import { searchPlaces } from '../services/geocodeService';
import { featuresBounds } from '../features/kml';
import Icon from './Icon';

const MAX_LOCAL = 8;

export default function SearchBox({ onNavigate }) {
  const { user } = useAuth();
  const { status } = useConnectivity();
  const { locations } = useSavedLocations(user.id);
  const { regions } = useRegions(user.id);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [features, setFeatures] = useState([]);
  const [online, setOnline] = useState({ q: '', results: [], loading: false, error: null });
  const boxRef = useRef(null);

  // Index layer feature names once, and again when layers change.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const out = [];
      for (const layer of await listLayers(user.id)) {
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
  }, [user.id]);

  useEffect(() => {
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const q = query.trim().toLowerCase();
  const local = useMemo(() => {
    if (q.length < 2) return [];
    const match = (s) => (s || '').toLowerCase().includes(q);
    const out = [];
    locations.filter((l) => match(l.name)).forEach((l) =>
      out.push({
        kind: 'Saved place',
        label: l.name,
        focus: { type: 'point', lat: l.latitude, lng: l.longitude, label: l.name },
      })
    );
    regions.filter((r) => match(r.name)).forEach((r) =>
      out.push({ kind: 'Offline map', label: r.name, focus: { type: 'bounds', bounds: r.bounds, label: r.name } })
    );
    features.filter((f) => match(f.name)).forEach((f) =>
      out.push({
        kind: f.layer,
        label: f.name,
        focus:
          f.geometry.type === 'Point'
            ? { type: 'point', lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: f.name }
            : { type: 'bounds', bounds: featuresBounds([f]), label: f.name },
      })
    );
    return out.slice(0, MAX_LOCAL);
  }, [q, locations, regions, features]);

  const onlineRows = online.q === query.trim() ? online.results : [];
  const rows = [...local, ...onlineRows];

  const go = (row) => {
    setOpen(false);
    setQuery(row.label);
    navigate('/map', { state: { focus: { ...row.focus, at: Date.now() } } });
    onNavigate?.();
  };

  const searchOnline = async () => {
    const text = query.trim();
    if (!text || status === 'offline') return;
    setOnline({ q: text, results: [], loading: true, error: null });
    try {
      const found = await searchPlaces(text);
      setOnline({
        q: text,
        loading: false,
        error: found.length ? null : 'No places found',
        results: found.map((p) => ({
          kind: 'OpenStreetMap',
          label: p.name.split(',').slice(0, 2).join(','),
          detail: p.name,
          focus: { type: 'bounds', bounds: p.bounds, label: p.name.split(',')[0], point: { lat: p.lat, lng: p.lng } },
        })),
      });
    } catch (err) {
      setOnline({ q: text, results: [], loading: false, error: err.message });
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(rows.length, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) go(rows[active]);
      else searchOnline();
    } else if (e.key === 'Escape') {
      setOpen(false);
      e.currentTarget.blur();
    }
  };

  const showPanel = open && query.trim().length >= 2;

  return (
    <div className="search" ref={boxRef} role="search">
      <Icon name="search" size={16} className="search-icon" />
      <input
        type="search"
        value={query}
        placeholder="Search places, layers, offline maps"
        aria-label="Search"
        aria-expanded={showPanel}
        aria-controls="search-results"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showPanel && (
        <div className="search-results" id="search-results" role="listbox">
          {rows.map((r, i) => (
            <button
              type="button"
              key={`${r.kind}-${r.label}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`search-row ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r)}
            >
              <span className="search-row-label">{r.label}</span>
              <span className="search-row-kind">{r.kind}</span>
            </button>
          ))}
          {!rows.length && !online.loading && (
            <div className="search-empty">No saved places, layers or offline maps match.</div>
          )}
          <button
            type="button"
            className={`search-row search-online ${active === rows.length ? 'active' : ''}`}
            onMouseEnter={() => setActive(rows.length)}
            onClick={searchOnline}
            disabled={status === 'offline' || online.loading}
          >
            {status === 'offline'
              ? 'Place search needs a connection'
              : online.loading
                ? 'Searching OpenStreetMap...'
                : online.error && online.q === query.trim()
                  ? online.error
                  : `Search OpenStreetMap for “${query.trim()}”  ↵`}
          </button>
        </div>
      )}
    </div>
  );
}
