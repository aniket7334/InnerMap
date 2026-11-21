import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useRegions } from '../hooks/useRegions';
import MapView from '../maps/MapView';
import SearchBox from '../components/SearchBox';
import RoutePanel from '../components/RoutePanel';
import NavigationView from '../components/NavigationView';
import { useLocation } from '../hooks/LocationContext';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import ProgressBar from '../components/ProgressBar';
import { useInitialFit, unionBounds } from '../hooks/useInitialFit';
import { providerForRegion } from '../maps/providers';
import { cancelDownload, deleteRegion, resumeDownload, pauseDownload, isDownloading } from '../offline/downloadManager';
import { cleanupOrphanTiles } from '../offline/tileStore';
import { listAllRegionIds } from '../offline/regionStore';
import { formatBytes, getStorageEstimate } from '../offline/storage';
import { listServerMaps, deleteServerMap } from '../services/mapService';
import { errorMessage } from '../services/api';
import { confirmDialog } from '../components/ConfirmDialog';
import { subscribePending } from '../offline/syncService';

// what a map that is not ready shows in place of its size
const STATUS_LABEL = {
  downloading: 'Downloading',
  partial: 'Partly downloaded',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
  failed: 'Failed',
  paused: 'Paused',
  pending: 'Waiting',
};

/** The three-dot menu of one map. */
function RowMenu({ name, items }) {
  const [open, setOpen] = useState(null); // { top, right } of the menu on screen, or null
  const ref = useRef(null);
  // the menu floats above the scrolling list (fixed position), opening upwards near the bottom
  const toggle = (e) => {
    if (open) return setOpen(null);
    const b = e.currentTarget.getBoundingClientRect();
    const below = window.innerHeight - b.bottom > 170;
    return setOpen({ right: window.innerWidth - b.right, ...(below ? { top: b.bottom + 4 } : { bottom: window.innerHeight - b.top + 4 }) });
  };
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(null);
    const esc = (e) => e.key === 'Escape' && setOpen(null);
    const gone = () => setOpen(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', gone, true);
    window.addEventListener('resize', gone);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', gone, true);
      window.removeEventListener('resize', gone);
    };
  }, [open]);
  return (
    <div className="om-menu" ref={ref}>
      <button type="button" className="om-dots" onClick={toggle} aria-haspopup="menu" aria-expanded={Boolean(open)} aria-label={`More actions for ${name}`}>
        <Icon name="dots" size={18} />
      </button>
      {open && (
        <div className="om-pop" role="menu" style={open}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className={it.danger ? 'danger' : ''}
              disabled={it.disabled}
              onClick={() => {
                setOpen(null);
                it.onClick();
              }}
            >
              <Icon name={it.icon} size={16} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const totalSize = (r) => (r.size || 0) + Object.values(r.packs || {}).reduce((n, p) => n + (p.size || 0), 0) + (r.routing?.bytes || 0);

export default function MyMapsPage() {
  const { user } = useAuth();
  const { status } = useConnectivity();
  const { regions } = useRegions(user.id);
  const [storage, setStorage] = useState(null);
  const [serverMaps, setServerMaps] = useState(null);
  const [fitTo, setFitTo] = useState(null);
  useInitialFit(unionBounds(regions.map((r) => r.bounds)), setFitTo);
  const [message, setMessage] = useState(null);
  // search + directions over the map (like the Earth page)
  const { position, tracking } = useLocation();
  const mapRef = useRef(null);
  const [place, setPlace] = useState(null); // the picked search result { lat, lng, label }
  const [routeOpen, setRouteOpen] = useState(false);
  const [routePick, setRoutePick] = useState(null); // 'start' | 'end' | null
  const [routePicked, setRoutePicked] = useState(null);
  const [routeView, setRouteView] = useState({ route: null, endpoints: null });
  const [nav, setNav] = useState(null); // turn-by-turn navigation in progress
  const [navDone, setNavDone] = useState(0); // metres of the route already driven
  const navRef = useRef(null);
  navRef.current = nav;
  const [navFollow, setNavFollow] = useState(true); // the map follows you (paused when you move it)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !nav) return undefined;
    const pause = () => setNavFollow(false);
    map.on('dragstart', pause);
    return () => map.off('dragstart', pause);
  }, [nav]);
  const recenter = () => {
    setNavFollow(true);
    if (position && mapRef.current) mapRef.current.setView([position.lat, position.lng], Math.max(mapRef.current.getZoom(), 17));
  };
  const offline = status === 'offline';

  const pickSearch = (row) => {
    if (!row || row.lat == null) return;
    const label = row.name || row.label || row.title;
    setPlace({ lat: row.lat, lng: row.lng, label });
    if (row.bounds) setFitTo({ ...row.bounds });
    else mapRef.current?.setView([row.lat, row.lng], Math.max(mapRef.current.getZoom(), 16));
  };
  const onMapClick = (latlng) => {
    if (!routePick) return;
    setRoutePicked({ field: routePick, lat: latlng.lat, lng: latlng.lng, at: Date.now() });
    setRoutePick(null);
  };
  // a new route: show all of it beside the Directions card (above it on phones)
  const showRoute = (v) => {
    if (navRef.current) return; // navigating: the navigation screen owns the route and the map view
    setRouteView(v);
    const g = v?.route?.geometry;
    const map = mapRef.current;
    if (!g?.length || !map) return;
    const phone = map.getContainer().clientWidth < 600;
    map.fitBounds(g, phone ? { paddingTopLeft: [24, 24], paddingBottomRight: [24, 24], maxZoom: 17 } : { paddingTopLeft: [420, 40], paddingBottomRight: [40, 40], maxZoom: 17 });
  };

  const closeRoute = () => {
    setRouteOpen(false);
    setRoutePick(null);
    setRouteView({ route: null, endpoints: null });
  };
  const [busyId, setBusyId] = useState(null);

  const refreshStorage = useCallback(async () => {
    setStorage(await getStorageEstimate());
  }, []);

  const refreshServer = useCallback(async () => {
    try {
      setServerMaps(await listServerMaps());
    } catch {
      setServerMaps(null);
    }
  }, []);

  useEffect(() => {
    refreshStorage();
  }, [refreshStorage, regions.length]);

  useEffect(() => {
    refreshServer();
  }, [refreshServer, status, regions.length]);
  // Queued changes (e.g. a deletion) reach the server a moment later: refresh the account list then.
  useEffect(() => subscribePending(() => refreshServer()), [refreshServer]);

  const onDelete = async (r) => {
    if (!(await confirmDialog({ title: 'Delete offline map?', message: `Delete “${r.name}” from this device? You will need internet to download it again.`, confirmLabel: 'Delete', danger: true }))) return;
    setBusyId(r.id);
    try {
      const freed = await deleteRegion(r.id);
      setMessage({ tone: 'success', text: `Deleted “${r.name}”. Freed ${formatBytes(freed)}.` });
      refreshStorage();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const onResume = async (r) => {
    setMessage(null);
    try {
      await resumeDownload(r.id);
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    }
  };

  const onCleanup = async () => {
    const ids = await listAllRegionIds();
    const { removed, freed } = await cleanupOrphanTiles(ids);
    setMessage({
      tone: 'success',
      text: removed ? `Removed ${removed} unused tile(s), freed ${formatBytes(freed)}.` : 'Storage is already clean.',
    });
    refreshStorage();
  };

  const onForgetServer = async (m) => {
    try {
      await deleteServerMap(m.id);
      refreshServer();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  };

  const localServerIds = new Set(regions.map((r) => r.serverId).filter(Boolean));
  const elsewhere = (serverMaps || []).filter((m) => !localServerIds.has(m.id));
  const usedPct = storage?.quota ? Math.round((storage.usage / storage.quota) * 100) : null;

  return (
    <div className="workspace page-offline-maps">
      <div className="workspace-map">
        <MapView
          className="map-fill"
          regions={regions}
          fitTo={fitTo}
          highlight={routeOpen ? null : place}
          route={routeView.route}
          routeDone={nav ? navDone : 0}
          navigating={Boolean(nav)}
          endpoints={routeOpen && !nav ? routeView.endpoints : nav ? { end: routeView.endpoints?.end || nav.to } : null}
          follow={Boolean(nav) && tracking && navFollow}
          showLocateButton={!nav}
          onReady={(m) => (mapRef.current = m)}
          onClick={onMapClick}
        >
          {nav && (
            <NavigationView
              userId={user.id}
              nav={nav}
              onRoute={(r) => setRouteView((v) => ({ ...v, route: r }))}
              onProgress={setNavDone}
              following={navFollow}
              onRecenter={recenter}
              onStop={() => {
                setRouteView((v) => ({ ...v, route: nav.route }));
                setNav(null);
                setNavDone(0);
                setRouteOpen(true);
              }}
            />
          )}
          {/* top-left: search and directions, like the Earth page */}
          <div className={`omx ${nav ? 'hidden-while-nav' : ''}`}>
            {!routeOpen ? (
              <section className="omx-card">
                <div className="omx-search-row">
                  <div className="omx-search-box">
                    <SearchBox
                      variant="offline"
                      searchButton
                      autoPick
                      placeholder={offline ? 'Search your offline maps' : 'Search any city or place'}
                      onSelect={pickSearch}
                    />
                  </div>
                  <button type="button" className="omx-dir-btn" onClick={() => setRouteOpen(true)} title="Directions" aria-label="Directions">
                    <Icon name="navigation" size={18} />
                  </button>
                </div>
                {place && (
                  <div className="omx-place">
                    <span className="omx-place-pin" aria-hidden="true">
                      <Icon name="pin" size={16} />
                    </span>
                    <span className="omx-place-name">{place.label}</span>
                    <button type="button" className="omx-chip primary" onClick={() => setRouteOpen(true)}>
                      <Icon name="navigation" size={14} /> Directions
                    </button>
                    <button type="button" className="omx-x" onClick={() => setPlace(null)} aria-label="Clear the picked place">
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                )}
                <p className="omx-note">
                  <Icon name={offline ? 'wifiOff' : 'wifi'} size={13} />
                  {offline ? 'Offline: searching places and routing inside your downloaded maps.' : 'Online: search anywhere; directions also work offline in your downloads.'}
                </p>
              </section>
            ) : (
              <RoutePanel
                initialEnd={place ? { lat: place.lat, lng: place.lng, label: place.label } : null}
                userId={user.id}
                pick={routePick}
                setPick={setRoutePick}
                picked={routePicked}
                onResult={showRoute}
                onFocusPoint={(p) => mapRef.current?.setView([p.lat, p.lng], Math.max(mapRef.current.getZoom(), 16))}
                onStartNavigation={(n) => {
                  setNav(n);
                  setNavFollow(true);
                  setNavDone(0);
                  setRouteView((v) => ({ ...v, route: n.route }));
                  if (position && mapRef.current) mapRef.current.setView([position.lat, position.lng], Math.max(mapRef.current.getZoom(), 17));
                }}
                onClose={closeRoute}
              />
            )}
          </div>
          {routePick && (
            <div className="map-hint">
              Click the map to set the {routePick === 'start' ? 'start' : 'destination'}{' '}
              <button type="button" className="text-btn on-dark" onClick={() => setRoutePick(null)}>
                Cancel
              </button>
            </div>
          )}
        </MapView>
      </div>

      <aside className="workspace-panel">
        <header className="panel-header row between">
          <div>
            <h1>Offline maps</h1>
            <p>Areas stored on this device and usable without internet.</p>
          </div>
          {/* downloading needs internet: the button is shown online only */}
          {status !== 'offline' && (
            <Link to="/download" className="btn btn-primary btn-sm">
              Download area
            </Link>
          )}
        </header>

        {message && (
          <Alert tone={message.tone} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        <section className="panel-section">
          <span className="section-label">On this device ({regions.length})</span>
          {regions.length === 0 ? (
            <div className="empty">
              <p>No offline maps yet.</p>
              <p className="small">Download an area while you are online to use it without internet.</p>
              {status !== 'offline' && (
                <Link to="/download" className="btn btn-primary btn-sm">
                  Download an area
                </Link>
              )}
            </div>
          ) : (
            <ul className="om-list">
              {regions.map((r) => {
                const source = providerForRegion(r);
                const running = isDownloading(r.id);
                const packsUnfinished = Object.values(r.packs || {}).some((p) => p.status !== 'completed');
                const canResume =
                  !running &&
                  Boolean(source?.offlineAllowed) &&
                  (['interrupted', 'cancelled', 'partial', 'failed', 'paused'].includes(r.status) || (r.status === 'completed' && packsUnfinished));
                const pct = r.tileCount ? Math.round((r.doneCount / r.tileCount) * 100) : 0;
                const side = r.status === 'completed' ? formatBytes(totalSize(r)) : r.status === 'downloading' ? `${pct}%` : STATUS_LABEL[r.status] || r.status;
                const items = [
                  { label: 'Show on map', icon: 'map', onClick: () => setFitTo({ ...r.bounds }) },
                  ...(running
                    ? [
                        { label: 'Pause', icon: 'stop', onClick: () => pauseDownload(r.id) },
                        { label: 'Cancel download', icon: 'close', onClick: () => cancelDownload(r.id) },
                      ]
                    : []),
                  ...(canResume ? [{ label: 'Resume download', icon: 'refresh', onClick: () => onResume(r), disabled: status === 'offline' }] : []),
                  { label: 'Delete', icon: 'trash', danger: true, onClick: () => onDelete(r), disabled: busyId === r.id },
                ];
                return (
                  <li key={r.id} className={`om-row st-${r.status}`}>
                    <button type="button" className="om-main" onClick={() => setFitTo({ ...r.bounds })} title={`Show ${r.name} on the map`}>
                      <span className="om-icon" aria-hidden="true">
                        <Icon name="map" size={16} />
                      </span>
                      <span className="om-name">{r.name}</span>
                      <span className="om-size">{side}</span>
                    </button>
                    <RowMenu name={r.name} items={items} />
                    {r.status === 'downloading' && <span className="om-progress" style={{ width: `${pct}%` }} aria-hidden="true" />}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel-section om-storage">
          <div className="row between">
            <span className="section-label">Storage</span>
            {storage?.quota ? (
              <span className="small muted">
                {formatBytes(storage.usage)} of {formatBytes(storage.quota)}
              </span>
            ) : null}
          </div>
          {storage?.quota ? (
            <ProgressBar value={storage.usage} max={storage.quota} tone={usedPct > 85 ? 'danger' : 'primary'} label="Storage used" />
          ) : (
            <p className="muted small">This browser does not report storage usage.</p>
          )}
          <button className="btn btn-sm om-clean" onClick={onCleanup}>
            <Icon name="trash" size={14} /> Clean up storage
          </button>
        </section>

        {elsewhere.length > 0 && (
          <section className="panel-section">
            <span className="section-label">On your other devices</span>
            <p className="muted small">In your account, but not stored on this device.</p>
            <ul className="item-list">
              {elsewhere.map((m) => {
                const q = new URLSearchParams({
                  ...Object.fromEntries(Object.entries(m.region || {}).map(([k, v]) => [k, String(v)])),
                  name: m.mapName,
                  zmin: String(m.zoomMin),
                  zmax: String(m.zoomMax),
                });
                return (
                  <li key={m.id}>
                    <span className="item-title">{m.mapName}</span>
                    <span className="item-meta">
                      {' '}
                      · zoom {m.zoomMin}–{m.zoomMax} · {formatBytes(m.storageSize)}
                    </span>
                    <div className="item-actions">
                      <Link to={`/download?${q}`}>Download here</Link>
                      <button className="link-btn danger-text" onClick={() => onForgetServer(m)}>
                        Remove from account
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
