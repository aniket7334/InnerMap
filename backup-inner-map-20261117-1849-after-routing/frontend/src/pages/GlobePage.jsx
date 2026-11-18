// 3D Earth: a CesiumJS globe that works offline.
//  - Base imagery: Cesium's built-in Natural Earth II (bundled, public domain), optional
//    local licensed imagery from the Inner Map server, or OpenStreetMap when online.
//  - Detail: Inner Map's OpenStreetMap vector map, drawn from downloaded tiles (offline).
//  - Overlays: saved places, KML/KMZ/GeoJSON layers and drawings, downloaded areas, live GPS.
// No Cesium ion, no Google services, no CDN.
import '../globe/cesiumBase';
import {
  Viewer,
  ImageryLayer,
  TileMapServiceImageryProvider,
  OpenStreetMapImageryProvider,
  UrlTemplateImageryProvider,
  EllipsoidTerrainProvider,
  CesiumTerrainProvider,
  CustomDataSource,
  Credit,
  Rectangle,
  Cartesian2,
  Cartesian3,
  Matrix4,
  Transforms,
  Math as CesiumMath,
  buildModuleUrl,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useMapProvider } from '../hooks/ProviderContext';
import { useRegions } from '../hooks/useRegions';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { useFeatureLayers } from '../hooks/useFeatureLayers';
import { PROVIDERS } from '../maps/providers';
import { VectorImageryProvider } from '../globe/VectorImageryProvider';
import { fillFeatures, fillPlaces, fillRegions, createUserEntities, updateUserEntities } from '../globe/globeEntities';
import { getGlobeOfflineStatus, makeGlobeAvailableOffline, removeGlobeOffline } from '../globe/globeOffline';
import LocationPanel from '../components/LocationPanel';
import ProgressBar from '../components/ProgressBar';
import Alert from '../components/Alert';
import { formatBytes } from '../offline/storage';

const VECTOR = PROVIDERS.find((p) => p.kind === 'vector');
const BASES = {
  naturalEarth: 'Natural Earth II (built-in, offline)',
  local: 'Local imagery (Inner Map server)',
  osm: 'OpenStreetMap (online only)',
};

function rect(b) {
  return Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
}

/** Union of bounds objects. */
function unionBounds(list) {
  const valid = list.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((a, b) => ({
    west: Math.min(a.west, b.west),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    north: Math.max(a.north, b.north),
  }));
}

export default function GlobePage() {
  const { user } = useAuth();
  const { status } = useConnectivity();
  const { position, tracking } = useLocation();
  const { coverage } = useMapProvider();
  const { regions } = useRegions(user.id);
  const { locations } = useSavedLocations(user.id);
  const { collections } = useFeatureLayers(user.id);

  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const sourcesRef = useRef({});
  const userEntitiesRef = useRef(null);
  const baseLayerRef = useRef(null);
  const detailLayerRef = useRef(null);
  const flewToStart = useRef(false);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [globeData, setGlobeData] = useState({ imagery: { available: false }, terrain: { available: false } });
  const [base, setBase] = useState('naturalEarth');
  const [showDetail, setShowDetail] = useState(true);
  const [showPlaces, setShowPlaces] = useState(true);
  const [showLayers, setShowLayers] = useState(true);
  const [showRegions, setShowRegions] = useState(true);
  const [follow, setFollow] = useState(false);
  const [offline, setOffline] = useState({ supported: true, ready: false });
  const [caching, setCaching] = useState(null); // { done, total }
  const [panelOpen, setPanelOpen] = useState(true);

  const online = status !== 'offline';
  const serverReachable = status === 'online';

  // Downloaded vector areas (what the detailed map can show offline).
  const vectorRegions = useMemo(
    () => regions.filter((r) => r.layerId === VECTOR?.layerId && r.doneCount > 0),
    [regions]
  );
  const detailBounds = useMemo(
    () => (coverage?.available ? coverage.bounds : unionBounds(vectorRegions.map((r) => r.bounds))),
    [coverage, vectorRegions]
  );

  // ------------------------------------------------------------ viewer setup
  useEffect(() => {
    let viewer;
    try {
      viewer = new Viewer(containerRef.current, {
        baseLayer: false, // we add our own layers; the default (Bing via Cesium ion) is never used
        baseLayerPicker: false,
        geocoder: false, // the default geocoder is a Cesium ion service
        homeButton: false,
        sceneModePicker: true, // 3D / 2D / Columbus view
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: true,
        selectionIndicator: true,
        terrainProvider: new EllipsoidTerrainProvider(),
        requestRenderMode: true, // only redraw when something changes (saves battery)
        maximumRenderTimeChange: Infinity,
      });
    } catch (err) {
      setError(`The 3D globe could not start: ${err.message}. Your browser or graphics driver may not support WebGL.`);
      return undefined;
    }
    viewer.scene.globe.enableLighting = false;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    // Render-on-demand only redraws when asked. Keep drawing while imagery/terrain tiles are
    // loading (and once more when the queue empties) so new tiles appear without the user
    // having to move the camera.
    const stopTileListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener(() =>
      viewer.scene.requestRender()
    );

    const sources = {
      regions: new CustomDataSource('downloaded-areas'),
      layers: new CustomDataSource('layers'),
      places: new CustomDataSource('places'),
      user: new CustomDataSource('my-location'),
    };
    Object.values(sources).forEach((ds) => viewer.dataSources.add(ds));
    sourcesRef.current = sources;
    userEntitiesRef.current = createUserEntities(sources.user);

    viewerRef.current = viewer;
    window.__innerMapGlobe = viewer; // diagnostics in the browser console
    setReady(true);
    return () => {
      viewerRef.current = null;
      setReady(false);
      stopTileListener();
      if (!viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  // ------------------------------------------------------------ local datasets
  useEffect(() => {
    if (!serverReachable) return;
    fetch('/globe-data/metadata', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setGlobeData(d))
      .catch(() => {});
  }, [serverReachable]);

  // Terrain: local quantized-mesh if the server has it, else a smooth ellipsoid.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    let cancelled = false;
    if (globeData.terrain.available && serverReachable) {
      CesiumTerrainProvider.fromUrl('/globe-data/terrain')
        .then((tp) => {
          if (!cancelled && !viewer.isDestroyed()) viewer.terrainProvider = tp;
        })
        .catch(() => {});
    } else {
      viewer.terrainProvider = new EllipsoidTerrainProvider();
    }
    return () => {
      cancelled = true;
    };
  }, [ready, globeData.terrain.available, serverReachable]);

  // ------------------------------------------------------------ base imagery
  const effectiveBase = base === 'osm' && !online ? 'naturalEarth' : base === 'local' && !serverReachable ? 'naturalEarth' : base;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    let layer;
    if (effectiveBase === 'osm') {
      layer = new ImageryLayer(new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }));
    } else if (effectiveBase === 'local' && globeData.imagery.available) {
      const im = globeData.imagery;
      const y = im.scheme === 'tms' ? '{reverseY}' : '{y}';
      layer = new ImageryLayer(
        new UrlTemplateImageryProvider({
          url: `/globe-data/imagery/{z}/{x}/${y}.${im.format}`,
          minimumLevel: im.minZoom,
          maximumLevel: im.maxZoom,
          rectangle: im.bounds ? rect(im.bounds) : undefined,
          credit: new Credit(im.attribution || im.name),
        })
      );
    } else {
      layer = ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'))
      );
    }
    viewer.imageryLayers.add(layer, 0);
    if (baseLayerRef.current) viewer.imageryLayers.remove(baseLayerRef.current, true);
    baseLayerRef.current = layer;
    viewer.scene.requestRender();
  }, [ready, effectiveBase, globeData.imagery]);

  // ------------------------------------------------------------ detailed vector map
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !VECTOR) return undefined;
    if (!showDetail || !detailBounds) return undefined;
    const layer = new ImageryLayer(new VectorImageryProvider(VECTOR, detailBounds));
    viewer.imageryLayers.add(layer);
    detailLayerRef.current = layer;
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) viewer.imageryLayers.remove(layer, true);
      detailLayerRef.current = null;
    };
    // Rebuild when connectivity changes or a download finishes, so empty tiles are refetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, showDetail, detailBounds, status, vectorRegions.map((r) => `${r.id}:${r.status}`).join()]);

  // ------------------------------------------------------------ overlays
  useEffect(() => {
    if (!ready) return;
    fillPlaces(sourcesRef.current.places, showPlaces ? locations : []);
    viewerRef.current?.scene.requestRender();
  }, [ready, locations, showPlaces]);

  useEffect(() => {
    if (!ready) return;
    fillFeatures(sourcesRef.current.layers, showLayers ? collections : []);
    viewerRef.current?.scene.requestRender();
  }, [ready, collections, showLayers]);

  useEffect(() => {
    if (!ready) return;
    fillRegions(sourcesRef.current.regions, showRegions ? vectorRegions : []);
    viewerRef.current?.scene.requestRender();
  }, [ready, vectorRegions, showRegions]);

  // Live GPS position.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    updateUserEntities(userEntitiesRef.current, position);
    if (position && follow) {
      const h = viewer.camera.positionCartographic.height;
      viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(position.lng, position.lat, Math.min(h, 3000)), duration: 1 });
    }
    viewer.scene.requestRender();
  }, [ready, position, follow]);

  // ------------------------------------------------------------ camera
  const flyToBounds = useCallback((b, duration = 1.5) => {
    const viewer = viewerRef.current;
    if (viewer && b) viewer.camera.flyTo({ destination: rect(b), duration });
  }, []);

  // First view: the downloaded/data area if there is one, else the whole Earth.
  useEffect(() => {
    if (!ready || flewToStart.current || !detailBounds) return;
    flewToStart.current = true;
    flyToBounds(detailBounds, 0);
  }, [ready, detailBounds, flyToBounds]);

  /** Point on the globe at the centre of the screen. */
  const screenCenter = () => {
    const viewer = viewerRef.current;
    const canvas = viewer.scene.canvas;
    const ray = viewer.camera.getPickRay(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    return ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
  };

  /** Orbit the camera around the point in the centre of the screen. */
  const orbit = (fn) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const center = screenCenter();
    if (center) {
      viewer.camera.lookAtTransform(Transforms.eastNorthUpToFixedFrame(center));
      fn(viewer.camera);
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    } else {
      fn(viewer.camera);
    }
    viewer.scene.requestRender();
  };

  const zoom = (factor) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const h = viewer.camera.positionCartographic.height;
    if (factor > 0) viewer.camera.zoomIn(h * factor);
    else viewer.camera.zoomOut(h * -factor);
    viewer.scene.requestRender();
  };

  const STEP = CesiumMath.toRadians(15);
  const tilt = (dir) =>
    orbit((camera) => {
      // Keep the pitch between looking straight down (-90°) and nearly horizontal (-10°).
      const next = camera.pitch + dir * STEP;
      if (next > CesiumMath.toRadians(-10) || next < CesiumMath.toRadians(-90)) return;
      camera.rotateUp(dir * STEP);
    });
  // In the local east-north-up frame, orbiting the camera "left" turns the view clockwise
  // (heading increases), which is what a user expects from "rotate right".
  const rotate = (dir) => orbit((camera) => (dir > 0 ? camera.rotateLeft(STEP) : camera.rotateRight(STEP)));
  const northUp = () =>
    orbit((camera) => {
      camera.rotateRight(camera.heading);
    });
  const locate = () => {
    if (position) {
      viewerRef.current?.camera.flyTo({ destination: Cartesian3.fromDegrees(position.lng, position.lat, 1500), duration: 1.5 });
    }
  };
  const wholeEarth = () =>
    viewerRef.current?.camera.flyTo({ destination: Cartesian3.fromDegrees(78, 20, 18000000), duration: 1.5 });

  // ------------------------------------------------------------ offline cache
  const refreshOffline = useCallback(() => getGlobeOfflineStatus().then(setOffline).catch(() => {}), []);
  useEffect(() => {
    refreshOffline();
  }, [refreshOffline, status]);

  const cacheGlobe = async () => {
    setError(null);
    try {
      await makeGlobeAvailableOffline((done, total) => setCaching({ done, total }));
    } catch (err) {
      setError(err.message);
    } finally {
      setCaching(null);
      refreshOffline();
    }
  };

  const uncacheGlobe = async () => {
    if (!window.confirm('Remove the 3D globe files from this device? The globe will then need a connection to open.')) return;
    await removeGlobeOffline();
    refreshOffline();
  };

  const downloadedDetail = vectorRegions.length > 0;

  return (
    <div className="page page-map globe-page">
      <div ref={containerRef} className="globe-canvas" />

      <div className="globe-controls" role="toolbar" aria-label="Camera">
        <button type="button" onClick={() => zoom(0.5)} title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" onClick={() => zoom(-1)} title="Zoom out" aria-label="Zoom out">−</button>
        <span className="sep" />
        <button type="button" onClick={() => tilt(1)} title="Tilt (look towards the horizon)" aria-label="Tilt towards horizon">⤒</button>
        <button type="button" onClick={() => tilt(-1)} title="Tilt back (look straight down)" aria-label="Look straight down">⤓</button>
        <span className="sep" />
        <button type="button" onClick={() => rotate(-1)} title="Rotate left" aria-label="Rotate left">⟲</button>
        <button type="button" onClick={() => rotate(1)} title="Rotate right" aria-label="Rotate right">⟳</button>
        <button type="button" onClick={northUp} title="North up" aria-label="North up">N</button>
        <span className="sep" />
        <button type="button" onClick={locate} disabled={!position} title="Go to my location" aria-label="Go to my location">◎</button>
      </div>

      <button className="panel-toggle btn btn-sm" onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
        {panelOpen ? 'Hide panel' : 'Show panel'}
      </button>

      {panelOpen && (
        <aside className="map-panel globe-panel">
          <h3>3D Earth</h3>
          <p className="muted tiny">
            Drag to rotate · scroll to zoom · right-drag or Ctrl+drag to tilt. Use the switcher (top right) for 2D and
            Columbus views.
          </p>
          {error && (
            <Alert tone="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <div className="panel-section">
            <h4>What you can see offline</h4>
            <ul className="coverage-list small">
              <li>
                <strong>Whole Earth:</strong> built-in Natural Earth imagery. It's low resolution (about 20 km per pixel),
                showing continents and land cover only.
              </li>
              <li>
                <strong>Detailed map:</strong>{' '}
                {downloadedDetail
                  ? `streets, names and buildings in your downloaded areas (${vectorRegions.map((r) => r.name).join(', ')}).`
                  : 'none yet - download an area to see streets on the globe offline.'}{' '}
                {!downloadedDetail && <Link to="/download">Download an area</Link>}
              </li>
              <li>
                <strong>Terrain:</strong>{' '}
                {globeData.terrain.available ? `${globeData.terrain.name} (3D relief).` : 'smooth Earth (no relief data installed).'}
              </li>
            </ul>
          </div>

          <div className="panel-section">
            <label className="field">
              <span>Base imagery</span>
              <select value={base} onChange={(e) => setBase(e.target.value)}>
                <option value="naturalEarth">{BASES.naturalEarth}</option>
                {globeData.imagery.available && <option value="local">{globeData.imagery.name}</option>}
                <option value="osm" disabled={!online}>
                  {BASES.osm}
                </option>
              </select>
            </label>
            {base !== effectiveBase && (
              <p className="warn-text tiny">Not available offline - showing Natural Earth instead.</p>
            )}
            <label className="check">
              <input type="checkbox" checked={showDetail} onChange={(e) => setShowDetail(e.target.checked)} />
              Detailed map (Inner Map Offline)
            </label>
            <label className="check">
              <input type="checkbox" checked={showPlaces} onChange={(e) => setShowPlaces(e.target.checked)} />
              Saved places ({locations.length})
            </label>
            <label className="check">
              <input type="checkbox" checked={showLayers} onChange={(e) => setShowLayers(e.target.checked)} />
              KML layers &amp; drawings ({collections.length})
            </label>
            <label className="check">
              <input type="checkbox" checked={showRegions} onChange={(e) => setShowRegions(e.target.checked)} />
              Downloaded area outlines
            </label>
          </div>

          <div className="panel-section">
            <h4>Go to</h4>
            <div className="row wrap">
              {detailBounds && (
                <button className="btn btn-ghost btn-sm" onClick={() => flyToBounds(detailBounds)}>
                  Map data area
                </button>
              )}
              {collections
                .filter((c) => c.layer.bounds)
                .slice(0, 6)
                .map((c) => (
                  <button key={c.layer.localId} className="btn btn-ghost btn-sm" onClick={() => flyToBounds(c.layer.bounds)}>
                    {c.layer.name}
                  </button>
                ))}
              <button className="btn btn-ghost btn-sm" onClick={wholeEarth}>
                Whole Earth
              </button>
            </div>
          </div>

          <div className="panel-section">
            <LocationPanel compact />
            <label className="check">
              <input type="checkbox" checked={follow} disabled={!tracking} onChange={(e) => setFollow(e.target.checked)} />
              Follow my position
            </label>
          </div>

          <div className="panel-section">
            <h4>Use the globe offline</h4>
            {!offline.supported && <p className="muted small">This browser cannot store the globe for offline use.</p>}
            {offline.supported && offline.ready && (
              <p className="small">
                Ready offline: {offline.files} files, {formatBytes(offline.bytes)} (CesiumJS {offline.version}).
                {offline.upToDate === false && ' A newer version is available - update it below.'}
              </p>
            )}
            {offline.supported && !offline.ready && !caching && (
              <p className="muted small">
                Stores the globe's program files and built-in imagery (about 7 MB) on this device so the 3D view opens
                without a connection.
              </p>
            )}
            {caching && <ProgressBar value={caching.done} max={caching.total} label="Storing 3D globe files" />}
            {offline.supported && (
              <div className="row wrap">
                {(!offline.ready || offline.upToDate === false) && (
                  <button className="btn btn-primary btn-sm" onClick={cacheGlobe} disabled={!!caching || !online}>
                    {offline.ready ? 'Update offline files' : 'Make 3D globe available offline'}
                  </button>
                )}
                {offline.ready && (
                  <button className="btn btn-ghost btn-sm" onClick={uncacheGlobe}>
                    Remove offline files
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="muted tiny">
            Built with CesiumJS. No Cesium ion or Google services are used. Imagery: Natural Earth (public domain)
            {globeData.imagery.available ? `, ${globeData.imagery.attribution || globeData.imagery.name}` : ''}. Map data ©
            OpenStreetMap contributors · Protomaps.
          </p>
        </aside>
      )}
    </div>
  );
}
