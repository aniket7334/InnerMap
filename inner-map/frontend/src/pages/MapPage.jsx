// The main map workspace: the map fills the page; tools float over it like a GIS app.
//   top-left     add a place, directions (route panel)
//   top-right    zoom (Leaflet) + layers + full screen
//   bottom-right location: go to me, start/stop tracking, follow
//   bottom-left  GPS read-out (live / last known, accuracy, time) and coordinates
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation as useRouterLocation } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useRegions } from '../hooks/useRegions';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { useMapProvider } from '../hooks/ProviderContext';
import { useFeatureLayers } from '../hooks/useFeatureLayers';
import { useMapFullscreen } from '../hooks/useMapFullscreen';
import MapView from '../maps/MapView';
import RoutePanel from '../components/RoutePanel';
import Icon from '../components/Icon';
import GpsStatus, { GpsStartupPrompt } from '../components/GpsStatus';

function LayerControl({ open, setOpen, provider, providers, setProviderId, overlays, setOverlays, layerCount }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, setOpen]);
  return (
    <div className="ctrl-anchor" ref={ref}>
      <button
        type="button"
        className={`ctrl-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Layers"
        aria-label="Layers"
      >
        <Icon name="layers" size={18} />
      </button>
      {open && (
        <div className="ctrl-popover" role="dialog" aria-label="Map layers">
          <fieldset>
            <legend>Base map</legend>
            {providers.map((p) => (
              <label key={p.id} className="radio-row">
                <input type="radio" name="base" checked={provider.id === p.id} onChange={() => setProviderId(p.id)} />
                <span>
                  {p.label}
                  <small>{p.offlineAllowed ? 'Can be downloaded for offline use' : 'Online only'}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Show</legend>
            {[
              ['regions', 'Downloaded areas'],
              ['places', 'Saved places'],
              ['layers', `KML layers & drawings (${layerCount})`],
            ].map(([key, label]) => (
              <label key={key} className="check">
                <input
                  type="checkbox"
                  checked={overlays[key]}
                  onChange={(e) => setOverlays({ ...overlays, [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <Link to="/layers" className="ctrl-link">
            Manage layers and KML files
          </Link>
        </div>
      )}
    </div>
  );
}

export default function MapPage() {
  const { user } = useAuth();
  const { status } = useConnectivity();
  const {
    position,
    tracking,
    startTracking,
    stopTracking,
    locateOnce,
    startupPrompt,
    dismissStartupPrompt,
  } = useLocation();
  const { regions } = useRegions(user.id);
  const { locations, add } = useSavedLocations(user.id);
  const { provider, providers, setProviderId, coverage } = useMapProvider();
  const { collections } = useFeatureLayers(user.id);
  const routerLocation = useRouterLocation();

  const [overlays, setOverlays] = useState({ regions: true, places: true, layers: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const [follow, setFollow] = useState(false);
  const [addMenu, setAddMenu] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [draft, setDraft] = useState(null); // { lat, lng, name }
  const [fitTo, setFitTo] = useState(null);
  const [highlight, setHighlight] = useState(null);
  const [toast, setToast] = useState(null);
  // directions
  const [routeOpen, setRouteOpen] = useState(false);
  const [routePick, setRoutePick] = useState(null); // 'start' | 'end' | null
  const [routePicked, setRoutePicked] = useState(null);
  const [routeView, setRouteView] = useState({ route: null, endpoints: null });
  const mapRef = useRef(null);
  const workspaceRef = useRef(null);
  const fullscreen = useMapFullscreen(workspaceRef, mapRef);

  // Downloaded areas of the active base map that contain data.
  const usable = useMemo(
    () => regions.filter((r) => r.layerId === provider.layerId && r.doneCount > 0 && r.status !== 'downloading'),
    [regions, provider.layerId]
  );

  // Opening: a search/sidebar target, else the GPS fix, else the newest downloaded area,
  // else the server's data area.
  const focus = routerLocation.state?.focus;
  useEffect(() => {
    if (!focus) return;
    if (focus.type === 'point') {
      mapRef.current?.setView([focus.lat, focus.lng], Math.max(mapRef.current.getZoom(), 17));
      setHighlight({ lat: focus.lat, lng: focus.lng, label: focus.label });
    } else {
      setFitTo({ ...focus.bounds });
      setHighlight(focus.point ? { ...focus.point, label: focus.label } : null);
    }
  }, [focus?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS-first: when the first live fix of this visit arrives, centre the map on it
  // (unless the page was opened to show something else, e.g. a search result).
  const flyOnFirstFix = useRef(!focus);
  useEffect(() => {
    if (!flyOnFirstFix.current || !position || position.restored || !mapRef.current) return;
    flyOnFirstFix.current = false;
    mapRef.current.flyTo([position.lat, position.lng], Math.max(mapRef.current.getZoom(), 16));
  }, [position]);

  const autoFitted = useRef(false);
  const startArea = usable[0]?.bounds || (provider.kind === 'vector' && coverage?.available ? coverage.bounds : null);
  useEffect(() => {
    if (autoFitted.current || focus || (position && !position.restored) || !startArea) return;
    autoFitted.current = true;
    setFitTo({ ...startArea });
  }, [startArea, position, focus]);

  // Fit the map to a newly calculated route.
  useEffect(() => {
    const g = routeView.route?.geometry;
    if (!g?.length) return;
    let s = 90;
    let n = -90;
    let w = 180;
    let e = -180;
    g.forEach(([lat, lng]) => {
      s = Math.min(s, lat);
      n = Math.max(n, lat);
      w = Math.min(w, lng);
      e = Math.max(e, lng);
    });
    setFitTo({ south: s, north: n, west: w, east: e });
  }, [routeView.route]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const locate = async () => {
    const map = mapRef.current;
    flyOnFirstFix.current = false;
    try {
      const p = await locateOnce();
      map?.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 16));
    } catch {
      // Keep showing the last known position, if any; the error explains why.
      if (position && map) map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 16));
    }
  };

  const onMapClick = (latlng) => {
    if (routePick) {
      setRoutePicked({ field: routePick, lat: latlng.lat, lng: latlng.lng, at: Date.now() });
      setRoutePick(null);
      return;
    }
    if (!pickMode) return;
    setDraft({ lat: latlng.lat, lng: latlng.lng, name: '' });
    setPickMode(false);
  };

  const addAtMyLocation = async () => {
    setAddMenu(false);
    try {
      const p = await locateOnce();
      setDraft({ lat: p.lat, lng: p.lng, name: '' });
    } catch {
      setToast('No GPS position available. Allow location access or pick the place on the map.');
    }
  };

  const submitDraft = async (e) => {
    e.preventDefault();
    if (!draft?.name.trim()) return;
    await add({ name: draft.name, latitude: draft.lat, longitude: draft.lng });
    setDraft(null);
    setToast(status === 'online' ? 'Place saved' : 'Place saved on this device - it will sync when you are online');
  };

  const closeRoute = () => {
    setRouteOpen(false);
    setRoutePick(null);
    setRouteView({ route: null, endpoints: null });
  };

  return (
    <div
      className={`map-workspace ${fullscreen.active ? 'is-fullscreen' : ''} ${
        fullscreen.mode === 'pseudo' ? 'map-pseudo-fullscreen' : ''
      }`}
      ref={workspaceRef}
    >
      <MapView
        className="map-full"
        follow={follow && tracking}
        places={overlays.places ? locations : []}
        regions={overlays.regions ? regions : []}
        featureCollections={overlays.layers ? collections : []}
        fitTo={fitTo}
        highlight={highlight}
        route={routeView.route}
        endpoints={routeOpen ? routeView.endpoints : null}
        showLocateButton={false}
        onReady={(m) => (mapRef.current = m)}
        onClick={onMapClick}
      >
        {/* top-left: add a place, directions */}
        <div className="map-ctrl map-ctrl-tools">
          <div className="ctrl-group">
            <button
              type="button"
              className={`ctrl-btn ctrl-btn-text ${addMenu || pickMode || draft ? 'on' : ''}`}
              onClick={() => {
                setPickMode(false);
                setDraft(null);
                setAddMenu((o) => !o);
              }}
              aria-expanded={addMenu}
            >
              <Icon name="plus" size={16} /> <span className="ctrl-label">Add place</span>
            </button>
            <button
              type="button"
              className={`ctrl-btn ctrl-btn-text ${routeOpen ? 'on' : ''}`}
              onClick={() => (routeOpen ? closeRoute() : setRouteOpen(true))}
              aria-expanded={routeOpen}
            >
              <Icon name="route" size={16} /> <span className="ctrl-label">Directions</span>
            </button>
          </div>
          {addMenu && (
            <div className="ctrl-popover ctrl-menu">
              <button type="button" onClick={addAtMyLocation}>
                <Icon name="crosshair" size={16} /> At my current location
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddMenu(false);
                  setPickMode(true);
                }}
              >
                <Icon name="pin" size={16} /> Pick a point on the map
              </button>
            </div>
          )}
          {draft && (
            <form className="ctrl-popover place-form" onSubmit={submitDraft}>
              <label className="field">
                <span>Name</span>
                <input
                  autoFocus
                  maxLength={100}
                  placeholder="e.g. Home, Camp site"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <p className="mono small muted">
                {formatCoord(draft.lat, 5)}, {formatCoord(draft.lng, 5)}
              </p>
              <div className="row">
                <button className="btn btn-primary btn-sm" disabled={!draft.name.trim()}>
                  Save
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          {routeOpen && (
            <RoutePanel
              userId={user.id}
              pick={routePick}
              setPick={setRoutePick}
              picked={routePicked}
              onResult={setRouteView}
              onFocusPoint={(p) => mapRef.current?.setView([p.lat, p.lng], Math.max(mapRef.current.getZoom(), 17))}
              onClose={closeRoute}
            />
          )}
        </div>

        {(pickMode || routePick) && (
          <div className="map-hint">
            {routePick ? `Click the map to set the ${routePick === 'start' ? 'start' : 'destination'}` : 'Click the map to place it'}{' '}
            <button
              type="button"
              className="text-btn on-dark"
              onClick={() => {
                setPickMode(false);
                setRoutePick(null);
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* top-right: layers + full screen (under Leaflet's zoom buttons) */}
        <div className="map-ctrl map-ctrl-layers">
          <LayerControl
            open={layersOpen}
            setOpen={setLayersOpen}
            provider={provider}
            providers={providers}
            setProviderId={setProviderId}
            overlays={overlays}
            setOverlays={setOverlays}
            layerCount={collections.length}
          />
          <button
            type="button"
            className={`ctrl-btn ${fullscreen.active ? 'on' : ''}`}
            onClick={fullscreen.toggle}
            title={fullscreen.active ? 'Exit full screen' : 'Full screen'}
            aria-label={fullscreen.active ? 'Exit full screen' : 'Full screen'}
            aria-pressed={fullscreen.active}
          >
            <Icon name={fullscreen.active ? 'shrink' : 'expand'} size={17} />
          </button>
        </div>

        {/* bottom-right: location */}
        <div className="map-ctrl map-ctrl-location">
          <div className="ctrl-group vertical">
            <button type="button" className="ctrl-btn" onClick={locate} title="Locate me" aria-label="Locate me">
              <Icon name="crosshair" size={18} />
            </button>
            <button
              type="button"
              className={`ctrl-btn ${tracking ? 'on gps' : ''}`}
              onClick={tracking ? stopTracking : startTracking}
              title={tracking ? 'Stop tracking' : 'Start tracking'}
              aria-label={tracking ? 'Stop tracking' : 'Start tracking'}
              aria-pressed={tracking}
            >
              <Icon name={tracking ? 'stop' : 'play'} size={14} />
            </button>
            <button
              type="button"
              className={`ctrl-btn ${follow ? 'on' : ''}`}
              onClick={() => setFollow((f) => !f)}
              disabled={!tracking}
              title="Keep the map centred on me"
              aria-label="Follow my position"
              aria-pressed={follow}
            >
              <Icon name="navigation" size={16} />
            </button>
          </div>
        </div>

        {/* bottom-left: GPS read-out */}
        <GpsStatus onLocate={locate} />
        {startupPrompt && (
          <GpsStartupPrompt
            onAllow={() => {
              flyOnFirstFix.current = true;
              startTracking();
            }}
            onDismiss={dismissStartupPrompt}
          />
        )}

        {toast && (
          <div className="map-toast" role="status">
            {toast}
          </div>
        )}
      </MapView>
    </div>
  );
}
