import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useMapProvider } from '../hooks/ProviderContext';
import { useRegions } from '../hooks/useRegions';
import MapView from '../maps/MapView';
import Alert from '../components/Alert';
import ProgressBar from '../components/ProgressBar';
import Icon from '../components/Icon';
import { DOWNLOAD_LIMITS, attributionText } from '../maps/providers';
import { boundsAround, boundsAreaKm2, boundsIntersection, toBoundsObject } from '../maps/tileMath';
import { estimateDownload, startDownload, cancelDownload } from '../offline/downloadManager';
import { formatBytes } from '../offline/storage';
import { searchPlaces } from '../services/geocodeService';
import { fetchRoutingInfo } from '../services/routingApi';

const MODES = [
  { id: 'coverage', label: 'Data area', vectorOnly: true },
  { id: 'view', label: 'View' },
  { id: 'draw', label: 'Draw' },
  { id: 'search', label: 'Search' },
  { id: 'around', label: 'Near me' },
];

function boundsFromParams(params) {
  const keys = ['south', 'west', 'north', 'east'];
  const values = keys.map((k) => Number(params.get(k)));
  if (values.some((v) => !Number.isFinite(v))) return null;
  const [south, west, north, east] = values;
  return south < north && west < east ? { south, west, north, east } : null;
}

const sameBounds = (a, b) =>
  a && b && a.south === b.south && a.north === b.north && a.west === b.west && a.east === b.east;

export default function DownloadPage() {
  const { user } = useAuth();
  const { status } = useConnectivity();
  const { position, locateOnce } = useLocation();
  const { provider, providers, setProviderId, coverage } = useMapProvider();
  const { regions } = useRegions(user.id);
  const [params] = useSearchParams();

  const isVector = provider.kind === 'vector';
  const serverArea = isVector && coverage?.available ? coverage.bounds : null;
  const prefill = useMemo(() => boundsFromParams(params), []); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomOptions = useMemo(() => {
    const out = [];
    for (let z = provider.minZoom; z <= provider.maxZoom; z += 1) out.push(z);
    return out;
  }, [provider]);
  const clampZoom = (z) => Math.min(provider.maxZoom, Math.max(provider.minZoom, z));

  const [mode, setMode] = useState(prefill || !serverArea ? 'view' : 'coverage');
  const [selection, setSelection] = useState(prefill || serverArea);
  const [fitTo, setFitTo] = useState(prefill || serverArea);
  const [name, setName] = useState(params.get('name') || '');
  const [zoomMin, setZoomMin] = useState(() =>
    clampZoom(params.get('zmin') !== null ? Number(params.get('zmin')) || 0 : isVector ? 10 : 8)
  );
  const [zoomMax, setZoomMax] = useState(() =>
    clampZoom(params.get('zmax') !== null ? Number(params.get('zmax')) || 0 : 16)
  );
  const [firstCorner, setFirstCorner] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [radiusKm, setRadiusKm] = useState(5);
  const [error, setError] = useState(null);
  const [startedId, setStartedId] = useState(null);
  // Offline directions: does the server have road data covering the selection?
  const [routingInfo, setRoutingInfo] = useState(null);
  const [withRouting, setWithRouting] = useState(true);
  useEffect(() => {
    if (status !== 'online') return;
    fetchRoutingInfo()
      .then(setRoutingInfo)
      .catch(() => setRoutingInfo(null));
  }, [status]);
  const mapRef = useRef(null);

  // Server coverage can arrive after the first render (metadata request).
  useEffect(() => {
    if (!selection && !prefill && serverArea) {
      setSelection(serverArea);
      setFitTo({ ...serverArea });
      setMode('coverage');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverArea]);

  // Keep zooms valid when the provider changes.
  useEffect(() => {
    setZoomMin((z) => clampZoom(z));
    setZoomMax((z) => clampZoom(z));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.id]);

  const job = regions.find((r) => r.id === startedId) || regions.find((r) => r.status === 'downloading');
  const busy = job?.status === 'downloading';

  // Vector data only exists inside the server's PMTiles area: download just that overlap.
  const target = selection && serverArea ? boundsIntersection(selection, serverArea) : selection;
  const outsideServerArea = Boolean(selection && serverArea && !target);
  const clipped = Boolean(target && selection && !sameBounds(target, selection));
  const effectiveMax = isVector ? provider.maxZoom : zoomMax;

  const estimate = useMemo(
    () => (target ? estimateDownload(provider, target, zoomMin, effectiveMax) : { tiles: 0, bytes: 0 }),
    [provider, target, zoomMin, effectiveMax]
  );
  const tooBig = estimate.tiles > DOWNLOAD_LIMITS.maxTilesPerDownload;
  // Our own server's tiles need the API reachable; other providers just need internet.
  const sourceReachable = provider.servedByApp ? status === 'online' : status !== 'offline';

  const rb = routingInfo?.offline?.available ? routingInfo.offline.bounds : null;
  const routingAvailable = Boolean(
    rb && target && target.south < rb.north && target.north > rb.south && target.west < rb.east && target.east > rb.west
  );

  const canDownload =
    provider.offlineAllowed &&
    sourceReachable &&
    target &&
    name.trim() &&
    !tooBig &&
    !busy &&
    zoomMin <= effectiveMax;

  const useServerArea = () => {
    if (!serverArea) return;
    setSelection(serverArea);
    setFitTo({ ...serverArea });
  };

  const useCurrentView = () => {
    if (!mapRef.current) return;
    setSelection(toBoundsObject(mapRef.current.getBounds()));
  };

  const onMapClick = (latlng) => {
    if (mode !== 'draw') return;
    if (!firstCorner) {
      setFirstCorner(latlng);
      setSelection(null);
      return;
    }
    setSelection({
      south: Math.min(firstCorner.lat, latlng.lat),
      north: Math.max(firstCorner.lat, latlng.lat),
      west: Math.min(firstCorner.lng, latlng.lng),
      east: Math.max(firstCorner.lng, latlng.lng),
    });
    setFirstCorner(null);
  };

  const doSearch = async (e) => {
    e.preventDefault();
    setError(null);
    setSearching(true);
    try {
      const found = await searchPlaces(query);
      setResults(found);
      if (!found.length) setError('No places found. Try a different spelling.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  };

  const pickResult = (r) => {
    setSelection(r.bounds);
    setFitTo(r.bounds);
    if (!name) setName(r.name.split(',')[0]);
    setResults([]);
  };

  const useAroundMe = async () => {
    setError(null);
    try {
      const p = position || (await locateOnce());
      const b = boundsAround(p.lat, p.lng, radiusKm);
      setSelection(b);
      setFitTo(b);
      if (!name) setName(`Around me (${radiusKm} km)`);
    } catch {
      setError('Could not get your location. Check the location permission.');
    }
  };

  const start = async () => {
    setError(null);
    try {
      const region = await startDownload({
        userId: user.id,
        name,
        bounds: target,
        zoomMin,
        zoomMax: effectiveMax,
        providerId: provider.id,
        withRouting: routingAvailable && withRouting,
      });
      setStartedId(region.id);
    } catch (err) {
      setError(err.message);
    }
  };

  const mapPanel = (
    <div className="workspace-map">
      <MapView
        className="map-fill"
        initialCenter={position ? [position.lat, position.lng] : undefined}
        initialZoom={position ? 12 : undefined}
        selection={selection}
        regions={regions}
        fitTo={fitTo}
        onReady={(m) => (mapRef.current = m)}
        onClick={onMapClick}
      >
        {mode === 'draw' && (
          <div className="map-hint">{firstCorner ? 'Click the opposite corner' : 'Click the first corner of the area'}</div>
        )}
      </MapView>
    </div>
  );

  return (
    <div className="workspace">
      {mapPanel}
      <aside className="workspace-panel">
      <header className="panel-header">
        <h1>Download area</h1>
        <p>Choose an area to store on this device. It stays available without internet.</p>
      </header>

      {!provider.offlineAllowed && (
        <Alert tone="warning">
          <strong>{provider.label} cannot be downloaded.</strong> {provider.offlineBlockedReason}{' '}
          {providers.some((p) => p.id === 'local-vector') && (
            <button className="link-btn" onClick={() => setProviderId('local-vector')}>
              Switch to Inner Map Offline
            </button>
          )}
        </Alert>
      )}
      {status === 'offline' && <Alert tone="warning">You are offline. Connect to the internet to download maps.</Alert>}
      {status === 'limited' && provider.servedByApp && (
        <Alert tone="warning">The Inner Map server is not reachable, so its map data cannot be downloaded now.</Alert>
      )}
      {isVector && coverage?.available === false && (
        <Alert tone="warning">
          The server has no vector map file yet. Create one as described in <code>backend/data/README.md</code>.
        </Alert>
      )}
      <Alert tone="error" onClose={error ? () => setError(null) : undefined}>
        {error}
      </Alert>

        <section className="panel-section">
          <span className="section-label">Area</span>
          <div className="tabs" role="tablist">
            {MODES.filter((m) => !m.vectorOnly || serverArea).map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                className={`tab ${mode === m.id ? 'active' : ''}`}
                onClick={() => {
                  setMode(m.id);
                  setFirstCorner(null);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="tab-panel">
            {mode === 'coverage' && serverArea && (
              <>
                <p className="muted small">Everything your Inner Map server has map data for.</p>
                <button className="btn btn-ghost" onClick={useServerArea}>
                  Select the server area
                </button>
              </>
            )}
            {mode === 'view' && (
              <>
                <p className="muted small">Pan and zoom the map to the area you want, then:</p>
                <button className="btn btn-ghost" onClick={useCurrentView}>
                  Use current map view
                </button>
              </>
            )}
            {mode === 'draw' && <p className="muted small">Click two opposite corners on the map to draw the area.</p>}
            {mode === 'search' && (
              <>
                <form className="row" onSubmit={doSearch}>
                  <input
                    placeholder="e.g. Bandra, Colaba"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button className="btn btn-primary" disabled={!query.trim() || searching || status === 'offline'}>
                    <Icon name="search" size={14} /> {searching ? '...' : 'Search'}
                  </button>
                </form>
                {results.length > 0 && (
                  <ul className="result-list">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button onClick={() => pickResult(r)}>
                          <strong>{r.name.split(',')[0]}</strong>
                          <span className="muted small">{r.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="muted tiny">Search by OpenStreetMap Nominatim.</p>
              </>
            )}
            {mode === 'around' && (
              <div className="stack">
                <label className="field">
                  <span>Radius: {radiusKm} km</span>
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={radiusKm}
                    onChange={(e) => setRadiusKm(Number(e.target.value))}
                  />
                </label>
                <button className="btn btn-ghost" onClick={useAroundMe}>
                  <Icon name="crosshair" size={14} /> Select around my location
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="panel-section">
          <span className="section-label">Details</span>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mumbai" />
          </label>

          <div className="row two">
            <label className="field">
              <span>Min zoom</span>
              <select value={zoomMin} onChange={(e) => setZoomMin(Number(e.target.value))}>
                {zoomOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Max zoom</span>
              <select value={effectiveMax} disabled={isVector} onChange={(e) => setZoomMax(Number(e.target.value))}>
                {zoomOptions.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted tiny">
            {isVector
              ? 'Vector maps always include full street detail, so you can zoom all the way in offline. A lower minimum zoom adds overview levels.'
              : 'Zoom 10 ≈ region, 13 ≈ town, 16 ≈ streets, 18 ≈ buildings. Each extra level ≈ 4× more tiles.'}
          </p>
          {routingAvailable ? (
            <label className="check">
              <input type="checkbox" checked={withRouting} onChange={(e) => setWithRouting(e.target.checked)} />
              <span>
                Include road data for offline directions
                <small className="muted block">
                  OpenStreetMap road network (one-way streets, access rules) for routes without internet.
                </small>
              </span>
            </label>
          ) : (
            routingInfo && (
              <p className="muted tiny">
                {routingInfo.offline?.available
                  ? 'Road data for offline directions is not available for this area on the server.'
                  : 'The server has no road data for offline directions (see backend/data/README.md).'}
              </p>
            )
          )}
        </section>

        <section className="panel-section">
          <div className="estimate">
            {target ? (
              <>
                <div>
                  <span className="muted small">Area</span>
                  <strong>{Math.round(boundsAreaKm2(target)).toLocaleString()} km²</strong>
                </div>
                <div>
                  <span className="muted small">Tiles</span>
                  <strong className={tooBig ? 'error-text' : ''}>{estimate.tiles.toLocaleString()}</strong>
                </div>
                <div>
                  <span className="muted small">Est. size</span>
                  <strong>~{formatBytes(estimate.bytes)}</strong>
                </div>
              </>
            ) : (
              <span className="muted small">No area selected yet.</span>
            )}
          </div>
          {zoomMin > effectiveMax && <p className="error-text small">Min zoom must not exceed max zoom.</p>}
          {outsideServerArea && (
            <p className="error-text small">
              This area is outside what your Inner Map server has data for. Use “Data area” or select inside it.
            </p>
          )}
          {clipped && !outsideServerArea && (
            <p className="muted small">Only the part inside the server’s data area will be downloaded.</p>
          )}
          {tooBig && (
            <p className="error-text small">
              Too many tiles (limit {DOWNLOAD_LIMITS.maxTilesPerDownload.toLocaleString()}). Make the area smaller or
              raise the minimum zoom.
            </p>
          )}

          {busy ? (
            <div className="job">
              <div className="row between">
                <strong>Downloading “{job.name}”</strong>
                <button className="btn btn-danger-soft btn-sm" onClick={() => cancelDownload(job.id)}>
                  Cancel
                </button>
              </div>
              <ProgressBar value={job.doneCount} max={job.tileCount} label="Download progress" />
              <div className="muted small">
                {job.doneCount.toLocaleString()} / {job.tileCount.toLocaleString()} tiles · {formatBytes(job.size)}
                {job.failedCount > 0 && ` · ${job.failedCount} failed`}
              </div>
              <p className="muted tiny">You can keep using the app - the download continues in the background.</p>
            </div>
          ) : (
            <button className="btn btn-primary btn-block" disabled={!canDownload} onClick={start}>
              <Icon name="download" /> Download for offline use
            </button>
          )}

          {job && !busy && job.id === startedId && (
            <Alert tone={job.status === 'completed' ? 'success' : 'warning'}>
              {job.status === 'completed'
                ? `“${job.name}” is ready offline (${formatBytes(job.size)}).`
                : job.error || `Download ${job.status}.`}{' '}
              <Link to="/my-maps">Open offline maps</Link>
            </Alert>
          )}
        </section>
        <p className="panel-foot">
          Source: {provider.label}. Map data {attributionText(provider)}. Only the areas you download are available
          offline.
        </p>
      </aside>
    </div>
  );
}
