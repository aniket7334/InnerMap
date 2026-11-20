// InnerMap Earth - the start screen: a CesiumJS globe in space, in the style of a desktop
// Earth viewer (menu bar, search + tool bar, map-style thumbnail, camera controls).
//  - Imagery: built-in Natural Earth II (bundled, public domain, offline) under the licensed
//    satellite source (SATELLITE_SOURCE; stored satellite packs are used offline), or local /
//    OpenStreetMap imagery when chosen.
//  - Detail: Inner Map's OpenStreetMap vector data - roads and names over the imagery, or the
//    full map - from downloaded tiles when offline.
//  - Overlays: saved places, imported layers, downloaded areas, live GPS.
//  - Works for signed-out visitors too (online search; saving needs an account).
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
  Color,
  Rectangle,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Matrix4,
  Transforms,
  Math as CesiumMath,
  ArcType,
  CallbackProperty,
  Ellipsoid,
  EllipsoidalOccluder,
  HorizontalOrigin,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
  buildModuleUrl,
} from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import '../styles/earth.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useMapProvider } from '../hooks/ProviderContext';
import { useTypography } from '../hooks/TypographyContext';
import { useRegions } from '../hooks/useRegions';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { useFeatureLayers } from '../hooks/useFeatureLayers';
import { PROVIDERS, SATELLITE_SOURCE, HIRES_IMAGERY_SOURCE } from '../maps/providers';
import { loadWorldLabels, createWorldLabels } from '../globe/worldLabels';
import { createLocalLabels } from '../globe/localLabels';
import { createPhotoMarkers, fetchPlacePhotos, loadWorldPhotos, mergePhotos, searchKey, viewRadiusKm, worldPhotosInView, PHOTOS_MAX_HEIGHT } from '../globe/placePhotos';
import PhotoGallery, { PhotoStrip } from '../components/EarthPhotos';
import EarthSettings, { detailPreset } from '../components/EarthSettings';
import { labelFont } from '../typography/typographyConfig';
import { VectorImageryProvider } from '../globe/VectorImageryProvider';
import { SatelliteImageryProvider } from '../globe/SatelliteImageryProvider';
import { fillFeatures, fillPlaces, fillRegions, createUserEntities, updateUserEntities } from '../globe/globeEntities';
import { getGlobeOfflineStatus, makeGlobeAvailableOffline, removeGlobeOffline } from '../globe/globeOffline';
import SearchBox from '../components/SearchBox';
import { splashState, MIN_SHOW_MS } from '../components/splashState';
import Icon from '../components/Icon';
import { formatBytes } from '../offline/storage';
import { confirmDialog } from '../components/ConfirmDialog';

const VECTOR = PROVIDERS.find((p) => p.kind === 'vector');
const IMAGERY = {
  satellite: `Satellite - ${SATELLITE_SOURCE.label}`,
  naturalEarth: 'Natural Earth (built-in, offline)',
  local: 'Local imagery (Inner Map server)',
  osm: 'OpenStreetMap (online only)',
};
const STYLES = [
  { id: 'labels', label: 'Satellite with labels', note: 'Names of countries, cities and places, plus streets where map data exists' },
  { id: 'clean', label: 'Satellite only', note: 'Imagery without names' },
  { id: 'map', label: 'Map', note: 'The Inner Map street map' },
];
// Map settings remembered on this device (type, details, visuals).
const BASEMAP_KEY = 'innermap.earth.basemap';
function readBasemap() {
  try {
    return JSON.parse(localStorage.getItem(BASEMAP_KEY)) || {};
  } catch {
    return {};
  }
}
const PHOTOS_KEY = 'innermap.earth.photos';
function readPhotosSetting() {
  try {
    return localStorage.getItem(PHOTOS_KEY) === 'on';
  } catch {
    return false;
  }
}
const START = { lng: 78.9, lat: 21 }; // whole-Earth view over South Asia when no GPS position is known

function rect(b) {
  return Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
}

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

/**
 * Camera height that shows the whole Earth with a margin on this screen: on a tall, narrow phone
 * the width is the limit, so the camera has to be further out than on a wide desktop.
 */
function wholeEarthHeight(viewer) {
  const R = 6371000;
  const f = viewer?.camera.frustum;
  if (!f?.fovy || !f.aspectRatio) return 14500000;
  const fovx = 2 * Math.atan(Math.tan(f.fovy / 2) * f.aspectRatio);
  const half = (Math.min(fovx, f.fovy) / 2) * 0.82;
  return Math.max(14500000, R / Math.sin(half) - R);
}

function formatAltitude(m) {
  if (m == null) return '–';
  if (m >= 10000) return `${Math.round(m / 1000).toLocaleString()} km`;
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/** Menu bar entry with a drop-down list. items: { label, onClick, href, checked, disabled, sep, hint } */
function MenuButton({ id, label, items, openId, setOpenId }) {
  const open = openId === id;
  return (
    <div className="earth-menu">
      <button
        type="button"
        className={open ? 'open' : ''}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpenId(open ? null : id)}
        onMouseEnter={() => openId && setOpenId(id)}
      >
        {label}
      </button>
      {open && (
        <div className="earth-menu-list" role="menu">
          {items.map((it, i) =>
            it.sep ? (
              <hr key={`sep-${i}`} />
            ) : (
              <button
                key={it.label}
                type="button"
                role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
                aria-checked={it.checked}
                disabled={it.disabled}
                onClick={() => {
                  setOpenId(null);
                  it.onClick?.();
                }}
              >
                <span className="earth-menu-check" aria-hidden="true">
                  {it.checked ? '✓' : ''}
                </span>
                <span className="earth-menu-label">{it.label}</span>
                {it.hint && <span className="earth-menu-hint">{it.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ToolButton({ icon, label, onClick, active, disabled, ...rest }) {
  return (
    <button type="button" className={`earth-tool ${active ? 'on' : ''}`} onClick={onClick} title={label} aria-label={label} aria-pressed={active} disabled={disabled} {...rest}>
      <Icon name={icon} size={20} />
    </button>
  );
}

export default function GlobePage() {
  const { user, logout } = useAuth();
  const uid = user?.id;
  const navigate = useNavigate();
  const { status } = useConnectivity();
  const { position, tracking, startTracking, stopTracking, locateOnce } = useLocation();
  const { coverage } = useMapProvider();
  const { settings: typography, mapLabelKey } = useTypography();
  const typographyRef = useRef(typography);
  typographyRef.current = typography;
  const { regions } = useRegions(uid);
  const { locations, add } = useSavedLocations(uid);
  const { collections } = useFeatureLayers(uid);

  const pageRef = useRef(null);
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const sourcesRef = useRef({});
  const userEntitiesRef = useRef(null);
  const baseLayerRef = useRef(null);
  const introDone = useRef(false);
  // Loading screen: 'show' until the first imagery is on screen, then 'leaving' (fade + fly-in), then 'gone'.
  const [splash, setSplash] = useState('show');

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [globeData, setGlobeData] = useState({ imagery: { available: false }, terrain: { available: false } });
  const [base, setBase] = useState(() => (SATELLITE_SOURCE ? 'satellite' : 'naturalEarth'));
  const savedBasemap = useRef(null);
  if (!savedBasemap.current) savedBasemap.current = readBasemap();
  const sb = savedBasemap.current;
  const [mapStyle, setMapStyle] = useState(['labels', 'clean', 'map'].includes(sb.style) ? sb.style : 'labels');
  const [detail, setDetail] = useState(['clean', 'exploration', 'everything', 'custom'].includes(sb.detail) ? sb.detail : 'everything');
  const [namesPref, setNamesPref] = useState(sb.names ?? true); // names on satellite (kept while the map type shows)
  const [showPlaces, setShowPlaces] = useState(sb.places ?? true);
  const [showLayers, setShowLayers] = useState(sb.layers ?? true);
  const [showRegions, setShowRegions] = useState(sb.regions ?? true);
  const [showGrid, setShowGrid] = useState(sb.grid ?? false);
  const [showSky, setShowSky] = useState(sb.sky ?? true);
  const [terrainOn, setTerrainOn] = useState(sb.terrain ?? true);
  const [follow, setFollow] = useState(false);
  const [offline, setOffline] = useState({ supported: true, ready: false });
  const [caching, setCaching] = useState(null); // { done, total }
  const [menu, setMenu] = useState(null); // open menu id
  const [styleOpen, setStyleOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // 'help' | 'about' | { type: 'placemark', lat, lng }
  const [placeName, setPlaceName] = useState('');
  const [camera, setCamera] = useState({ lat: null, lng: null, height: null, heading: 0, pitch: -90 });
  const [mobileMenu, setMobileMenu] = useState(false);
  // Photos layer: famous places with photos (Wikidata + Wikimedia Commons, online only).
  const [showPhotos, setShowPhotos] = useState(readPhotosSetting);
  const [photos, setPhotos] = useState([]);
  const [photosState, setPhotosState] = useState({ status: 'idle' }); // idle | far | loading | ready | error | offline
  const [viewing, setViewing] = useState(null); // photo open in the viewer
  const [photoRetry, setPhotoRetry] = useState(0);
  const photoLayerRef = useRef(null);
  const photoMarkersRef = useRef(null);

  const online = status !== 'offline';
  const serverReachable = status === 'online';

  const vectorRegions = useMemo(() => regions.filter((r) => r.layerId === VECTOR?.layerId && r.doneCount > 0), [regions]);
  // Every area with street data: the server's cities, else this device's downloads.
  const detailAreas = useMemo(
    () =>
      coverage?.available
        ? (coverage.areas?.length ? coverage.areas.map((a) => a.bounds) : [coverage.bounds])
        : vectorRegions.map((r) => r.bounds),
    [coverage, vectorRegions]
  );
  const detailBounds = useMemo(() => (detailAreas.length ? unionBounds(detailAreas) : null), [detailAreas]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Close menus with Escape / outside click.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMenu(null);
        setStyleOpen(false);
        setAccountOpen(false);
        setMobileMenu(false);
      }
    };
    const onDown = (e) => {
      if (!e.target.closest?.('.earth-menu, .earth-account, .earth-style, .earth-settings, [data-settings-toggle], .earth-mobile-menu, .earth-hamburger')) {
        setMenu(null);
        setAccountOpen(false);
        setStyleOpen(false);
        setMobileMenu(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  // ------------------------------------------------------------ viewer setup
  useEffect(() => {
    let viewer;
    try {
      viewer = new Viewer(containerRef.current, {
        baseLayer: false, // we add our own layers; the default (Bing via Cesium ion) is never used
        baseLayerPicker: false,
        geocoder: false, // the default geocoder is a Cesium ion service
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: true,
        selectionIndicator: true,
        terrainProvider: new EllipsoidTerrainProvider(),
        showRenderLoopErrors: false, // we show our own, clearer message (below)
        requestRenderMode: true, // only redraw when something changes (saves battery)
        // No 4x multisampling: it multiplies the graphics memory of every frame. On laptops with
        // shared (integrated) graphics and little free memory the browser then cannot create, or
        // later takes away, the 3D surface - and the globe stays blank.
        msaaSamples: 1,
        maximumRenderTimeChange: Infinity,
      });
    } catch (err) {
      setError({
        text: `The 3D Earth could not start: ${err.message}. The graphics memory may be full - close other tabs or windows showing 3D maps, games or videos (and other copies of InnerMap), then reload. If it keeps happening, check that hardware acceleration is on in the browser settings.`,
        reload: true,
      });
      return undefined;
    }
    const scene = viewer.scene;
    // Phones and tablets: many mobile graphics chips lack full-precision maths in pixel shaders,
    // which Cesium's logarithmic depth buffer needs - the Earth's surface then disappears when
    // zoomed out (only the names stay). Use the standard depth buffer there, and skip the
    // high-dynamic-range pass (less graphics memory, fewer driver problems).
    try {
      const gl = scene.context._gl;
      const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const touch = window.matchMedia?.('(pointer: coarse)').matches;
      if (touch || !hp || hp.precision < 23) {
        scene.logarithmicDepthBuffer = false;
        scene.highDynamicRange = false;
      }
    } catch {
      /* keep Cesium's defaults */
    }
    // The browser can take the graphics memory back at any time (low memory, driver reset): the
    // canvas then goes blank. Say so and offer a reload, instead of leaving an empty screen.
    let contextLost = false;
    const LOST = {
      text: 'The 3D Earth lost its graphics memory (the computer is low on memory, or the graphics driver restarted), so it cannot be drawn. Close other tabs with 3D maps, games or videos, then reload.',
      reload: true,
    };
    const onContextLost = (e) => {
      e.preventDefault();
      contextLost = true;
      setError(LOST);
    };
    scene.canvas.addEventListener('webglcontextlost', onContextLost);
    // Cesium builds the globe surface in web workers served from /cesium. If a deployment lacks
    // those files, rendering stops with an unhelpful "[object Object]": say what is wrong instead.
    let filesMissing = false;
    const MISSING = 'The 3D Earth files (/cesium) are missing from this website, so the globe cannot be drawn. The site needs to be rebuilt with the Cesium files included.';
    const stopRenderError = scene.renderError.addEventListener((_s, err) => {
      // after a lost graphics context Cesium fails in odd ways: keep the clear message
      if (contextLost || scene.context?._gl?.isContextLost?.()) return setError(LOST);
      setError(filesMissing ? MISSING : { text: `The 3D Earth stopped drawing: ${err?.message || 'a background task failed'}. Reload the page to try again.`, reload: true });
    });
    fetch(buildModuleUrl('Workers/createVerticesFromHeightmap.js'), { method: 'HEAD', cache: 'no-store' })
      .then((r) => {
        const type = r.headers.get('content-type') || '';
        if (!r.ok || type.includes('text/html')) {
          filesMissing = true;
          setError(MISSING);
        }
      })
      .catch(() => {}); // offline: the cached copy (if any) is used
    // Space look: stars, atmosphere glow, no day/night shading (whole Earth evenly lit).
    scene.globe.enableLighting = false;
    scene.globe.showGroundAtmosphere = true;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    if (scene.skyBox) scene.skyBox.show = true;
    scene.backgroundColor = Color.BLACK;
    scene.globe.baseColor = Color.fromCssColorString('#0b1a2e');
    scene.screenSpaceCameraController.enableCollisionDetection = true;
    const stopTileListener = scene.globe.tileLoadProgressEvent.addEventListener(() => scene.requestRender());

    // Natural Earth is always there underneath: the whole planet works offline.
    viewer.imageryLayers.add(
      ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'))),
      0
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

    // Camera read-out (centre, altitude) and the compass heading.
    viewer.camera.percentageChanged = 0.01;
    const update = () => {
      const c = viewer.camera;
      const canvas = scene.canvas;
      const ray = c.getPickRay(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
      const hit = ray ? scene.globe.pick(ray, scene) : undefined;
      const carto = hit ? Cartographic.fromCartesian(hit) : null;
      setCamera({
        lat: carto ? CesiumMath.toDegrees(carto.latitude) : null,
        lng: carto ? CesiumMath.toDegrees(carto.longitude) : null,
        height: c.positionCartographic.height,
        heading: CesiumMath.toDegrees(c.heading),
        pitch: CesiumMath.toDegrees(c.pitch),
      });
    };
    const stopChanged = viewer.camera.changed.addEventListener(update);
    const stopMoveEnd = viewer.camera.moveEnd.addEventListener(update);

    viewerRef.current = viewer;
    window.__innerMapGlobe = viewer; // diagnostics in the browser console
    setReady(true);
    return () => {
      viewerRef.current = null;
      setReady(false);
      stopTileListener();
      stopRenderError();
      scene.canvas.removeEventListener('webglcontextlost', onContextLost);
      stopChanged();
      stopMoveEnd();
      if (!viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  // Opening view: start far out over your area (GPS) or South Asia, so the first imagery loaded
  // behind the loading screen is the right one.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || introDone.current) return;
    introDone.current = true;
    const target = position || START;
    // With the 3D loading screen the globe starts at its final view (the loading screen flies
    // there itself and hands over); with the light one it starts far out and flies in.
    const height = splashState.get().mode === '3d' ? wholeEarthHeight(viewer) : Math.max(36000000, wholeEarthHeight(viewer) * 2);
    viewer.camera.setView({ destination: Cartesian3.fromDegrees(target.lng, target.lat, height) });
    splashState.set({ progress: 0.35, step: 'Loading satellite imagery' });
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the loading screen how far loading is (real steps: 3D engine, imagery, names).
  useEffect(() => {
    if (splash === 'gone') splashState.set({ phase: 'gone' });
  }, [splash]);

  // Hide the loading screen once the first imagery has loaded (at most 10 s; at least ~1 s so it
  // does not flash). If the 3D view cannot start, hide it at once so the error is visible.
  useEffect(() => {
    if (error) setSplash('gone');
  }, [error]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return undefined;
    let done = false;
    let sawLoading = false;
    const timers = [];
    const finish = () => {
      if (done) return;
      done = true;
      // the loading screen plays its animation in full, even when everything loads at once
      const s = splashState.get();
      const wait = Math.max(0, (MIN_SHOW_MS[s.mode] || 1000) - (performance.now() - s.startedAt));
      timers.push(setTimeout(() => setSplash((s) => (s === 'show' ? 'leaving' : s)), wait));
    };
    const check = () => {
      if (viewer.isDestroyed()) return;
      viewer.scene.requestRender();
      if (sawLoading && viewer.scene.globe.tilesLoaded) finish();
    };
    let mostQueued = 0;
    const stop = viewer.scene.globe.tileLoadProgressEvent.addEventListener((queued) => {
      if (queued > 0) sawLoading = true;
      else timers.push(setTimeout(check, 80));
      mostQueued = Math.max(mostQueued, queued);
      if (!done && mostQueued > 0) {
        const imagery = 1 - queued / mostQueued;
        const progress = Math.max(splashState.get().progress, 0.35 + imagery * 0.5);
        splashState.set({ progress, step: progress < 0.8 ? 'Loading satellite imagery' : 'Placing country and city names' });
      }
    });
    const poll = setInterval(check, 400);
    timers.push(setTimeout(finish, 10000));
    return () => {
      stop();
      clearInterval(poll);
      timers.forEach(clearTimeout);
    };
  }, [ready]);

  // As the loading screen leaves: the 3D one flies to the globe's exact view and fades over it;
  // with the light one the globe flies in towards the Earth.
  useEffect(() => {
    if (splash !== 'leaving') return undefined;
    const viewer = viewerRef.current;
    if (viewer && !viewer.isDestroyed()) {
      if (splashState.get().mode === '3d') {
        const c = viewer.camera.positionCartographic;
        const r = viewer.scene.canvas.getBoundingClientRect();
        splashState.set({
          phase: 'leaving',
          progress: 1,
          handover: {
            lng: CesiumMath.toDegrees(c.longitude),
            lat: CesiumMath.toDegrees(c.latitude),
            height: c.height,
            fovy: viewer.camera.frustum.fovy,
            rect: { left: r.left, top: r.top, width: r.width, height: r.height },
          },
        });
        return undefined; // the loading screen removes itself when its fade ends
      }
      const target = position || START;
      viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(target.lng, target.lat, wholeEarthHeight(viewer)), duration: 2.4 });
    }
    splashState.set({ phase: 'leaving', progress: 1 });
    const t = setTimeout(() => setSplash('gone'), 650);
    return () => clearTimeout(t);
  }, [splash]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ local datasets
  useEffect(() => {
    if (!serverReachable) return;
    fetch('/globe-data/metadata', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setGlobeData(d))
      .catch(() => {});
  }, [serverReachable]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return undefined;
    let cancelled = false;
    if (globeData.terrain.available && serverReachable && terrainOn) {
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
  }, [ready, globeData.terrain.available, serverReachable, terrainOn]);

  // ------------------------------------------------------------ imagery over Natural Earth
  const effectiveBase = base === 'osm' && !online ? 'naturalEarth' : base === 'local' && !serverReachable ? 'naturalEarth' : base;

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return undefined;
    let layer = null;
    if (effectiveBase === 'satellite') {
      layer = new ImageryLayer(new SatelliteImageryProvider());
    } else if (effectiveBase === 'osm') {
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
    }
    if (layer) viewer.imageryLayers.add(layer, 1);
    // Close up and online: sharp imagery over Sentinel-2 (online viewing only, never stored).
    let sharp = null;
    if (effectiveBase === 'satellite' && online && HIRES_IMAGERY_SOURCE) {
      const h = HIRES_IMAGERY_SOURCE;
      sharp = new ImageryLayer(
        new UrlTemplateImageryProvider({
          url: h.url,
          maximumLevel: h.maxDataZoom,
          credit: new Credit(h.attribution, true),
        }),
        { minimumTerrainLevel: h.minZoom - 1 }
      );
      viewer.imageryLayers.add(sharp, 2);
    }
    baseLayerRef.current = layer;
    viewer.scene.requestRender();
    return () => {
      if (sharp && !viewer.isDestroyed()) viewer.imageryLayers.remove(sharp, true);
      if (layer && !viewer.isDestroyed()) viewer.imageryLayers.remove(layer, true);
      baseLayerRef.current = null;
    };
  }, [ready, effectiveBase, globeData.imagery, status, online]);

  // ------------------------------------------------------------ street map for the whole world
  // "Map" style: the server's street data covers only its own area (e.g. Mumbai), so with
  // internet the standard OpenStreetMap map is shown everywhere under it (online only).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || mapStyle !== 'map' || !online) return undefined;
    const layer = new ImageryLayer(new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' }));
    const layers = viewer.imageryLayers;
    layers.add(layer);
    // keep it under the server's own street data
    while (layers.indexOf(layer) > 1 && layers.get(layers.indexOf(layer) - 1).imageryProvider instanceof VectorImageryProvider) {
      layers.raise(layers.get(layers.indexOf(layer) - 1));
    }
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) viewer.imageryLayers.remove(layer, true);
    };
  }, [ready, mapStyle, online]);

  // ------------------------------------------------------------ roads + names / street map
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !VECTOR || !detailBounds || mapStyle === 'clean') return undefined;
    const layer = new ImageryLayer(new VectorImageryProvider(VECTOR, detailBounds, typographyRef.current, mapStyle === 'map' ? 'map' : 'labels'));
    viewer.imageryLayers.add(layer);
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) viewer.imageryLayers.remove(layer, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mapStyle, detailBounds, status, mapLabelKey, vectorRegions.map((r) => `${r.id}:${r.status}`).join()]);

  // ------------------------------------------------------------ world names
  // Countries, states, cities, seas (Natural Earth, served by the app - works offline).
  const [worldNames, setWorldNames] = useState(null);
  const worldLabelsRef = useRef(null);
  const localLabelsRef = useRef(null);
  // read by the local-names loader without re-creating it
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const serverNamesRef = useRef(false); // the server's street-data layer draws its own local names
  serverNamesRef.current = !!VECTOR && mapStyle !== 'clean';
  // Hidden in "Clean", and in "Map" while the online OpenStreetMap map (which has its own names) shows.
  const showWorldNames = mapStyle === 'labels' || (mapStyle === 'map' && !online);
  useEffect(() => {
    if (worldNames) return;
    loadWorldLabels()
      .then(setWorldNames)
      .catch(() => {});
  }, [worldNames, status]);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !worldNames) return undefined;
    const t = typographyRef.current;
    const layer = createWorldLabels(viewer, worldNames, {
      family: labelFont(t).stack,
      scalePlaces: t.mapLabels.scale.places,
      scaleCities: t.mapLabels.scale.cities,
      bold: t.mapLabels.weight === 'bold',
      detailAreas,
      avoid: '.earth-controls, .earth-style, .earth-status, .earth-settings',
    });
    layer.setVisible(showWorldNames);
    worldLabelsRef.current = layer;
    window.__innerMapWorldLabels = layer; // diagnostics
    // Towns, villages, neighbourhoods, buildings and streets as you zoom in.
    const local = createLocalLabels(viewer, layer, {
      isOnline: () => onlineRef.current,
      skip: (lat, lng) => serverNamesRef.current && detailAreas.some((b) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east),
    });
    local.setEnabled(showWorldNames);
    localLabelsRef.current = local;
    return () => {
      local.destroy();
      localLabelsRef.current = null;
      layer.destroy();
      worldLabelsRef.current = null;
    };
  }, [ready, worldNames, mapLabelKey, detailAreas]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    worldLabelsRef.current?.setVisible(showWorldNames);
    localLabelsRef.current?.setEnabled(showWorldNames);
  }, [showWorldNames]);
  useEffect(() => {
    localLabelsRef.current?.refresh(); // switch between online (OpenStreetMap) and offline (GeoNames) names
  }, [online]);

  // ------------------------------------------------------------ photos of famous places
  // A satellite-view layer (hidden in the "Map" style). Online only; nothing is stored.
  const photosActive = showPhotos && mapStyle !== 'map';
  const togglePhotos = (on = !showPhotos) => {
    setShowPhotos(on);
    if (on && mapStyle === 'map') setMapStyle('labels');
    try {
      localStorage.setItem(PHOTOS_KEY, on ? 'on' : 'off');
    } catch {
      /* private window: the choice lasts for this visit only */
    }
  };
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !photosActive || !photoLayerRef.current) return undefined;
    const markers = createPhotoMarkers(viewer, photoLayerRef.current, (p) => setViewing(p));
    photoMarkersRef.current = markers;
    return () => {
      markers.destroy();
      photoMarkersRef.current = null;
    };
  }, [ready, photosActive]);
  useEffect(() => {
    photoMarkersRef.current?.setPhotos(photosActive ? photos : []);
  }, [photos, photosActive, ready]);
  useEffect(() => {
    photoMarkersRef.current?.setSelected(viewing?.id ?? null);
  }, [viewing]);

  // Which places to show: from the built-in world list everywhere (whole-Earth view), plus - closer
  // in - the places Wikidata knows around the centre of the view. Debounced after camera moves.
  const [worldPhotos, setWorldPhotos] = useState(null);
  useEffect(() => {
    if (!photosActive || worldPhotos) return;
    loadWorldPhotos()
      .then(setWorldPhotos)
      .catch(() => {});
  }, [photosActive, worldPhotos, status]);

  const photoSearch = useRef(0);
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !photosActive) return undefined;
    if (!online) {
      setPhotos([]);
      setPhotosState({ status: 'offline' });
      return undefined;
    }
    const t = setTimeout(() => {
      if (viewer.isDestroyed()) return;
      const id = ++photoSearch.current;
      const world = worldPhotosInView(worldPhotos, viewer);
      if (camera.lat == null || camera.height > PHOTOS_MAX_HEIGHT) {
        setPhotos(world);
        setPhotosState({ status: worldPhotos ? 'ready' : 'loading' });
        return;
      }
      const center = { lat: camera.lat, lng: camera.lng };
      const q = searchKey(center.lat, center.lng, viewRadiusKm(viewer, center));
      // (the previous places stay until the new search answers - cached searches answer at once)
      setPhotosState((s) => (s.key === q.key && s.status === 'ready' ? s : { status: 'loading', key: q.key }));
      fetchPlacePhotos(q)
        .then((list) => {
          if (id !== photoSearch.current) return;
          setPhotos(mergePhotos(list, world));
          setPhotosState({ status: 'ready', key: q.key });
        })
        .catch((err) => {
          if (id !== photoSearch.current) return;
          setPhotosState(world.length ? { status: 'ready' } : { status: 'error', message: err.message || 'Photos could not be loaded.' });
        });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, photosActive, online, worldPhotos, camera.lat, camera.lng, Math.round(camera.height / 1000), camera.heading, photoRetry]);

  const openPhoto = (p) => setViewing(p);
  useEffect(() => {
    window.__innerMapPhotos = { open: setViewing }; // diagnostics in the browser console
    return () => delete window.__innerMapPhotos;
  }, []);

  // ------------------------------------------------------------ map settings
  // Type (satellite / map) x details (clean, exploration, everything, custom) -> the map style and
  // which overlays show. Everything is remembered on this device.
  const mapType = mapStyle === 'map' ? 'map' : 'satellite';
  const chooseType = (t) => {
    if (t === 'map') setMapStyle('map');
    else setMapStyle(namesPref ? 'labels' : 'clean');
  };
  const chooseDetail = (d) => {
    setDetail(d);
    const p = detailPreset(d);
    if (!p) return; // custom: keep what is shown now
    setNamesPref(p.names);
    setShowPlaces(p.places);
    setShowRegions(p.regions);
    setShowLayers(p.layers);
    if (mapStyle !== 'map') setMapStyle(p.names ? 'labels' : 'clean');
  };
  const changeShown = (patch) => {
    setDetail('custom');
    if ('names' in patch) {
      setNamesPref(patch.names);
      if (mapStyle !== 'map') setMapStyle(patch.names ? 'labels' : 'clean');
    }
    if ('places' in patch) setShowPlaces(patch.places);
    if ('regions' in patch) setShowRegions(patch.regions);
    if ('layers' in patch) setShowLayers(patch.layers);
  };
  // View menu styles: "Satellite with labels" / "Satellite only" / "Map"
  const chooseStyle = (id) => {
    if (id === 'map') return chooseType('map');
    if (id === 'clean') return chooseDetail('clean');
    if (detail === 'clean') return chooseDetail('exploration');
    setNamesPref(true);
    return setMapStyle('labels');
  };
  const changeVisual = (key, on) => {
    if (key === 'photos') togglePhotos(on);
    else if (key === 'grid') setShowGrid(on);
    else if (key === 'sky') setShowSky(on);
    else if (key === 'terrain') setTerrainOn(on);
  };
  useEffect(() => {
    try {
      localStorage.setItem(
        BASEMAP_KEY,
        JSON.stringify({ style: mapStyle, detail, names: namesPref, places: showPlaces, regions: showRegions, layers: showLayers, grid: showGrid, sky: showSky, terrain: terrainOn })
      );
    } catch {
      /* private window: settings last for this visit only */
    }
  }, [mapStyle, detail, namesPref, showPlaces, showRegions, showLayers, showGrid, showSky, terrainOn]);

  // Sky and atmosphere: stars, the glow at the Earth's edge and the haze over the ground.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer) return;
    const { scene } = viewer;
    if (scene.skyBox) scene.skyBox.show = showSky;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = showSky;
    scene.globe.showGroundAtmosphere = showSky;
    scene.requestRender();
  }, [ready, showSky]);

  // Gridlines: latitude/longitude lines every 10° (equator, tropics and polar circles highlighted).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!ready || !viewer || !showGrid) return undefined;
    const ds = new CustomDataSource('gridlines');
    const line = Color.WHITE.withAlpha(0.35);
    const special = Color.fromCssColorString('#fbbc04').withAlpha(0.8);
    const add = (positions, color, width) =>
      ds.entities.add({ polyline: { positions: Cartesian3.fromDegreesArray(positions), width, material: color, arcType: ArcType.RHUMB } });
    for (let lng = -180; lng < 180; lng += 10) {
      const pts = [];
      for (let lat = -80; lat <= 80; lat += 5) pts.push(lng, lat);
      add(pts, lng === 0 ? special : line, lng === 0 ? 1.6 : 1);
    }
    const parallel = (lat, color, width) => {
      const pts = [];
      for (let lng = -180; lng <= 180; lng += 5) pts.push(lng, lat);
      add(pts, color, width);
    };
    for (let lat = -80; lat <= 80; lat += 10) parallel(lat, lat === 0 ? special : line, lat === 0 ? 1.6 : 1);
    [23.44, -23.44, 66.56, -66.56].forEach((lat) => parallel(lat, special.withAlpha(0.45), 1));
    // labels on the far side of the Earth would show through it: hide them there
    const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, viewer.camera.positionWC);
    const label = (text, lng, lat) => {
      const position = Cartesian3.fromDegrees(lng, lat);
      return ds.entities.add({
        position,
        label: {
          show: new CallbackProperty(() => {
            occluder.cameraPosition = viewer.camera.positionWC;
            return occluder.isPointVisible(position);
          }, false),
          text,
          font: '12px sans-serif',
          fillColor: Color.WHITE.withAlpha(0.85),
          outlineColor: Color.BLACK,
          outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(4, -4),
          horizontalOrigin: HorizontalOrigin.LEFT,
          verticalOrigin: VerticalOrigin.BOTTOM,
          translucencyByDistance: new NearFarScalar(2.0e6, 1, 3.0e7, 0.6),
        },
      });
    };
    for (let lat = -80; lat <= 80; lat += 10) for (let lng = -180; lng < 180; lng += 60) label(`${Math.abs(lat)}°${lat > 0 ? 'N' : lat < 0 ? 'S' : ''}`, lng, lat);
    for (let lng = -170; lng <= 180; lng += 10) label(`${Math.abs(lng)}°${lng > 0 && lng < 180 ? 'E' : lng < 0 ? 'W' : ''}`, lng, 0);
    viewer.dataSources.add(ds);
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true);
    };
  }, [ready, showGrid]);

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

  // ------------------------------------------------------------ camera helpers
  const flyToBounds = useCallback((b, duration = 1.6) => {
    const viewer = viewerRef.current;
    if (viewer && b) viewer.camera.flyTo({ destination: rect(b), duration });
  }, []);

  const flyToPoint = useCallback((lat, lng, height = 1500, duration = 2) => {
    viewerRef.current?.camera.flyTo({ destination: Cartesian3.fromDegrees(lng, lat, height), duration });
  }, []);

  const screenCenter = () => {
    const viewer = viewerRef.current;
    const canvas = viewer.scene.canvas;
    const ray = viewer.camera.getPickRay(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    return ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
  };

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

  /** Tilt to a pitch (degrees, -90 = straight down) around the point in the middle of the view. */
  const tiltTo = (deg) =>
    orbit((camera) => {
      camera.rotateUp(CesiumMath.toRadians(deg) - camera.pitch);
    });
  const northUp = () => orbit((camera) => camera.rotateRight(camera.heading));
  const resetView = () => {
    northUp();
    tiltTo(-90);
  };
  const tilted = camera.pitch > -80;
  const toggle3d = () => tiltTo(tilted ? -90 : -45);

  const locate = async () => {
    try {
      const p = position && !position.restored ? position : await locateOnce();
      flyToPoint(p.lat, p.lng, 1500);
    } catch {
      setToast('Your location is not available. Allow location access in the browser, then try again.');
    }
  };
  const wholeEarth = () => {
    const c = camera.lat != null ? camera : position || START;
    flyToPoint(c.lat, c.lng, wholeEarthHeight(viewerRef.current), 1.8);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else pageRef.current?.requestFullscreen?.().catch(() => setToast('Full screen is not available in this browser.'));
  };

  // Search result -> fly there.
  const onSearchSelect = (row) => {
    if (row.bounds) flyToBounds(row.bounds);
    else if (row.lat != null) {
      const height = row.zoom ? Math.max(400, 40000000 / 2 ** row.zoom) : 1500;
      flyToPoint(row.lat, row.lng, height);
    }
  };

  const openMap = (state) => navigate('/map', state ? { state } : undefined);
  const openMapHere = () => {
    if (camera.lat == null) return openMap();
    const z = Math.max(3, Math.min(18, Math.round(Math.log2(40000000 / Math.max(camera.height, 1)))));
    return openMap({ focus: { type: 'point', lat: camera.lat, lng: camera.lng, zoom: z, label: 'Earth view', at: Date.now() } });
  };
  const needAccount = (fn) => () => (uid ? fn() : navigate('/login', { state: { from: '/' } }));

  // ------------------------------------------------------------ placemarks
  const startPlacemark = (where) => {
    if (where === 'gps') {
      locateOnce()
        .then((p) => setDialog({ type: 'placemark', lat: p.lat, lng: p.lng }))
        .catch(() => setToast('Your location is not available.'));
      return;
    }
    if (camera.lat == null) {
      setToast('Point the centre of the view at the Earth first.');
      return;
    }
    setDialog({ type: 'placemark', lat: camera.lat, lng: camera.lng });
  };
  const savePlacemark = async (e) => {
    e.preventDefault();
    if (!placeName.trim() || !dialog) return;
    await add({ name: placeName.trim().slice(0, 100), latitude: dialog.lat, longitude: dialog.lng });
    setToast(status === 'online' ? `Saved “${placeName.trim()}”` : `Saved “${placeName.trim()}” on this device - it will sync when you are online`);
    setPlaceName('');
    setDialog(null);
  };

  // ------------------------------------------------------------ offline files
  const refreshOffline = useCallback(() => getGlobeOfflineStatus().then(setOffline).catch(() => {}), []);
  useEffect(() => {
    refreshOffline();
  }, [refreshOffline, status]);

  const cacheGlobe = useCallback(
    async (quiet = false) => {
      try {
        await makeGlobeAvailableOffline((done, total) => setCaching({ done, total }));
        if (!quiet) setToast('Earth is now available offline.');
      } catch (err) {
        if (!quiet) setError(err.message);
      } finally {
        setCaching(null);
        refreshOffline();
      }
    },
    [refreshOffline]
  );
  // The Earth is the start screen: keep its program files on the device so it opens offline.
  const autoCached = useRef(false);
  useEffect(() => {
    if (autoCached.current || !online || !offline.supported || offline.ready || caching) return;
    autoCached.current = true;
    cacheGlobe(true);
  }, [online, offline, caching, cacheGlobe]);

  const uncacheGlobe = async () => {
    if (!(await confirmDialog({ title: 'Remove offline Earth files?', message: 'The Earth view will then need a connection to open.', confirmLabel: 'Remove', danger: true }))) return;
    await removeGlobeOffline();
    refreshOffline();
  };

  // ------------------------------------------------------------ menus (real actions only)
  const styleItems = STYLES.map((s) => ({ label: s.label, checked: mapStyle === s.id, onClick: () => chooseStyle(s.id) }));
  const MENUS = [
    {
      id: 'file',
      label: 'File',
      items: [
        { label: 'Download an area for offline use…', onClick: needAccount(() => navigate('/download')) },
        { label: 'Offline maps', onClick: needAccount(() => navigate('/my-maps')) },
        { sep: true },
        offline.ready
          ? offline.upToDate === false
            ? { label: 'Update offline Earth files', onClick: () => cacheGlobe(false), disabled: !online || !!caching }
            : { label: `Remove offline Earth files (${formatBytes(offline.bytes || 0)})`, onClick: uncacheGlobe }
          : { label: 'Make Earth available offline', onClick: () => cacheGlobe(false), disabled: !online || !!caching || !offline.supported },
        { sep: true },
        { label: 'Export saved places (KML / KMZ)…', onClick: needAccount(() => navigate('/saved')) },
        ...(uid ? [{ sep: true }, { label: 'Log out', onClick: () => { logout(); navigate('/login'); } }] : []),
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { label: 'Saved places…', onClick: needAccount(() => navigate('/saved')) },
        { label: 'Settings (text, fonts, map labels)…', onClick: needAccount(() => navigate('/settings')) },
        { label: 'Account…', onClick: needAccount(() => navigate('/profile')) },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { label: 'Whole Earth', onClick: wholeEarth },
        { label: 'My location', onClick: locate },
        ...(detailBounds ? [{ label: 'Map data area', onClick: () => flyToBounds(detailBounds) }] : []),
        { sep: true },
        ...styleItems,
        { sep: true },
        { label: 'Photos of places (online)', checked: photosActive, onClick: () => togglePhotos(!photosActive) },
        { label: 'Saved places', checked: showPlaces, onClick: () => changeShown({ places: !showPlaces }) },
        { label: 'Downloaded area outlines', checked: showRegions, onClick: () => changeShown({ regions: !showRegions }) },
        ...(collections.length ? [{ label: `Imported layers (${collections.length})`, checked: showLayers, onClick: () => changeShown({ layers: !showLayers }) }] : []),
        { label: 'Gridlines', checked: showGrid, onClick: () => setShowGrid((v) => !v) },
        { label: 'Map settings…', onClick: () => setStyleOpen(true) },
        { sep: true },
        { label: 'North up', onClick: northUp },
        { label: tilted ? 'Look straight down' : 'Tilt view (3D)', onClick: toggle3d },
        { label: 'Open the 2D map here', onClick: openMapHere },
        { label: 'Full screen', onClick: toggleFullscreen },
      ],
    },
    {
      id: 'add',
      label: 'Add',
      items: [
        { label: 'Placemark at the centre of the view', onClick: needAccount(() => startPlacemark('center')) },
        { label: 'Placemark at my location', onClick: needAccount(() => startPlacemark('gps')) },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        { label: 'Directions…', onClick: needAccount(() => openMap({ openDirections: true })) },
        { label: 'Measure distance and area…', onClick: needAccount(() => openMap({ openMeasure: true })) },
        { sep: true },
        { label: tracking ? 'Stop GPS tracking' : 'Start GPS tracking', onClick: tracking ? stopTracking : startTracking },
        { label: 'Follow my position', checked: follow, disabled: !tracking, onClick: () => setFollow((v) => !v) },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { label: 'Mouse and keyboard controls', onClick: () => setDialog('help') },
        { label: 'About InnerMap Earth and data sources', onClick: () => setDialog('about') },
        { label: 'Welcome page', onClick: () => navigate('/welcome') },
      ],
    },
  ];

  const initials = user ? user.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() : '';
  const cachingPct = caching?.total ? Math.round((caching.done / caching.total) * 100) : null;

  return (
    <div className="earth" ref={pageRef}>
      <header className="earth-header">
        <div className="earth-menubar">
          <Link to="/" className="earth-logo" aria-label="InnerMap Earth">
            <img src="/icons/icon.svg" alt="" width="30" height="30" />
          </Link>
          <button type="button" className="earth-hamburger" aria-label="Menu" aria-expanded={mobileMenu} onClick={() => setMobileMenu((o) => !o)}>
            <Icon name="menu" size={22} />
          </button>
          <nav className="earth-menus" aria-label="Menu">
            {MENUS.map((m) => (
              <MenuButton key={m.id} id={m.id} label={m.label} items={m.items} openId={menu} setOpenId={setMenu} />
            ))}
          </nav>
        </div>

        <div className="earth-toolbar">
          <div className="earth-search">
            <SearchBox variant="earth" onSelect={onSearchSelect} />
          </div>
          <div className="earth-tools" role="toolbar" aria-label="Tools">
            <ToolButton icon="crosshair" label="Fly to my location" onClick={locate} />
            <span className="earth-sep" />
            <ToolButton icon="pin" label="Add placemark" onClick={needAccount(() => startPlacemark('center'))} />
            <ToolButton icon="route2" label="Directions" onClick={needAccount(() => openMap({ openDirections: true }))} />
            <ToolButton icon="layers" label="Map settings" onClick={() => setStyleOpen((o) => !o)} active={styleOpen} data-settings-toggle="" />
            <span className="earth-sep" />
            <ToolButton icon="ruler" label="Measure distance and area" onClick={needAccount(() => openMap({ openMeasure: true }))} />
            <ToolButton icon="cloudDown" label="Download an area for offline use" onClick={needAccount(() => navigate('/download'))} />
            <ToolButton icon="map" label="Open the 2D map here" onClick={openMapHere} />
          </div>
        </div>

        <div className="earth-account">
          <button type="button" className="earth-icon-btn" onClick={needAccount(() => navigate('/settings'))} title="Settings" aria-label="Settings">
            <Icon name="settings" size={22} />
          </button>
          {user ? (
            <>
              <div className="earth-account-text">
                <span>{user.name}</span>
                <Link to="/my-maps">{regions.length ? `${regions.length} offline map${regions.length === 1 ? '' : 's'}` : 'Go offline'}</Link>
              </div>
              <button type="button" className="earth-avatar" onClick={() => setAccountOpen((o) => !o)} aria-expanded={accountOpen} aria-label="Account menu">
                {initials}
              </button>
              {accountOpen && (
                <div className="earth-menu-list earth-account-menu" role="menu">
                  <div className="earth-account-head">
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                  </div>
                  {[
                    ['/map', 'Map explorer'],
                    ['/saved', 'Saved places'],
                    ['/my-maps', 'Offline maps'],
                    ['/dashboard', 'Overview'],
                    ['/settings', 'Settings'],
                    ['/profile', 'Account & history'],
                  ].map(([to, label]) => (
                    <button key={to} type="button" role="menuitem" onClick={() => navigate(to)}>
                      <span className="earth-menu-check" />
                      <span className="earth-menu-label">{label}</span>
                    </button>
                  ))}
                  <hr />
                  <button type="button" role="menuitem" onClick={() => { logout(); navigate('/login'); }}>
                    <span className="earth-menu-check" />
                    <span className="earth-menu-label">Log out</span>
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="earth-signin">
              <Link to="/login" className="btn btn-primary btn-sm">
                Sign in
              </Link>
              <Link to="/register" className="earth-register">
                Create account
              </Link>
            </div>
          )}
        </div>
      </header>

      {mobileMenu && (
        <div className="earth-mobile-menu" role="menu">
          {MENUS.map((m) => (
            <section key={m.id}>
              <h3>{m.label}</h3>
              {m.items
                .filter((it) => !it.sep)
                .map((it) => (
                  <button
                    key={it.label}
                    type="button"
                    disabled={it.disabled}
                    onClick={() => {
                      setMobileMenu(false);
                      it.onClick?.();
                    }}
                  >
                    {it.checked !== undefined && <span className="earth-menu-check">{it.checked ? '✓' : ''}</span>}
                    {it.label}
                  </button>
                ))}
            </section>
          ))}
        </div>
      )}

      <div ref={containerRef} className="earth-canvas" />
      <div ref={photoLayerRef} className="earth-photo-layer" aria-label="Photos on the globe" />

      {mapStyle !== 'map' && (
        <button
          type="button"
          className={`earth-photos-toggle ${photosActive ? 'on' : ''}`}
          onClick={() => togglePhotos(!photosActive)}
          aria-pressed={photosActive}
          title={photosActive ? 'Hide photos' : 'Show photos of famous places (online)'}
        >
          <Icon name="photo" size={18} />
          <span>Photos</span>
          <span className="earth-switch" aria-hidden="true" />
        </button>
      )}
      {photosActive && (
        <PhotoStrip
          photos={photos}
          state={photosState}
          selectedId={viewing?.id}
          onOpen={openPhoto}
          onRetry={() => setPhotoRetry((n) => n + 1)}
          onClose={() => togglePhotos(false)}
        />
      )}
      {viewing && (
        <PhotoGallery place={viewing} onClose={() => setViewing(null)} onFly={(p) => { setViewing(null); flyToPoint(p.lat, p.lng, 2500, 2); }} />
      )}

      {error && (
        <div className="earth-error" role="alert">
          <span>{typeof error === 'string' ? error : error.text}</span>
          {error.reload && (
            <button type="button" className="earth-error-reload" onClick={() => window.location.reload()}>
              Reload
            </button>
          )}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
          <Link to="/map">Open the 2D map</Link>
        </div>
      )}
      {toast && (
        <div className="earth-toast" role="status">
          {toast}
        </div>
      )}

      {/* bottom-left: map style */}
      <div className="earth-style">
        <button type="button" className={`earth-style-thumb view-${mapStyle === 'map' ? 'default' : 'satellite'}`} onClick={() => setStyleOpen((o) => !o)} aria-expanded={styleOpen} title="Map settings" aria-label="Map settings" data-settings-toggle="">
          <span className="view-swatch" />
        </button>
      </div>

      {styleOpen && (
        <EarthSettings
          onClose={() => setStyleOpen(false)}
          type={mapType}
          onType={chooseType}
          detail={detail}
          onDetail={chooseDetail}
          shown={{ names: namesPref, places: showPlaces, regions: showRegions, layers: showLayers }}
          onShown={changeShown}
          counts={{ places: locations.length, layers: collections.length }}
          imagery={{
            value: base,
            onChange: setBase,
            options: [
              { value: 'satellite', label: IMAGERY.satellite },
              { value: 'naturalEarth', label: IMAGERY.naturalEarth },
              ...(globeData.imagery.available ? [{ value: 'local', label: globeData.imagery.name }] : []),
              { value: 'osm', label: IMAGERY.osm, disabled: !online },
            ],
            notes: [
              base !== effectiveBase ? 'Not available offline - showing Natural Earth instead.' : null,
              effectiveBase === 'satellite'
                ? `${SATELLITE_SOURCE.resolution ? `${SATELLITE_SOURCE.resolution}. ` : ''}${online ? 'Downloaded satellite packs are used first.' : 'Offline: only areas with a downloaded satellite pack; elsewhere Natural Earth.'}${online && HIRES_IMAGERY_SOURCE ? ` Close up: sharp ${HIRES_IMAGERY_SOURCE.label} (online only).` : ''} ${SATELLITE_SOURCE.licenceNote || ''}`
                : null,
            ],
          }}
          visuals={{ photos: photosActive, grid: showGrid, sky: showSky, terrain: terrainOn, terrainAvailable: globeData.terrain.available && serverReachable }}
          onVisual={changeVisual}
          online={online}
          hint={!detailBounds && mapStyle !== 'clean' && mapStyle !== 'map' ? 'Street names appear where map data is available (server area or your downloads).' : null}
        />
      )}

      {/* bottom-right: camera controls */}
      <div className="earth-controls" role="toolbar" aria-label="Camera">
        <button type="button" className="earth-round" onClick={locate} title="Fly to my location" aria-label="Fly to my location">
          <Icon name="crosshair" size={20} />
        </button>
        <button type="button" className="earth-round" onClick={resetView} title="Reset view: north up, looking straight down" aria-label="Reset view">
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
            <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 19 19 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className={`earth-round earth-3d ${tilted ? 'on' : ''}`} onClick={toggle3d} title={tilted ? 'Look straight down (2D)' : 'Tilt the view (3D)'} aria-pressed={tilted} aria-label="3D view">
          3D
        </button>
        <button type="button" className="earth-round earth-compass" onClick={northUp} title="North up" aria-label={`Compass, heading ${Math.round((camera.heading + 360) % 360)} degrees. Click for north up`}>
          <svg viewBox="0 0 24 24" width="24" height="24" style={{ transform: `rotate(${-camera.heading}deg)` }} aria-hidden="true">
            <path d="M12 2.5 15 12H9z" fill="#e5484d" />
            <path d="M12 21.5 9 12h6z" fill="#cfd5dd" />
          </svg>
        </button>
        <div className="earth-zoom">
          <button type="button" onClick={() => zoom(-1)} title="Zoom out" aria-label="Zoom out">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" onClick={() => zoom(0.5)} title="Zoom in" aria-label="Zoom in">
            <Icon name="plus" size={20} />
          </button>
        </div>
      </div>

      {/* bottom status: camera position */}
      <div className="earth-status" aria-live="off">
        {cachingPct != null && <span>Saving Earth for offline use… {cachingPct}%</span>}
        {status === 'offline' && <span>Offline - showing data stored on this device</span>}
        <span className="mono">
          {camera.lat != null ? `${Math.abs(camera.lat).toFixed(4)}°${camera.lat >= 0 ? 'N' : 'S'} ${Math.abs(camera.lng).toFixed(4)}°${camera.lng >= 0 ? 'E' : 'W'}` : 'Space'}
        </span>
        <span>Camera {formatAltitude(camera.height)}</span>
      </div>

      {dialog === 'help' && (
        <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <div className="confirm-dialog earth-dialog" role="dialog" aria-labelledby="earth-help-title">
            <h2 id="earth-help-title">Mouse and keyboard controls</h2>
            <dl className="earth-keys">
              <dt>Drag</dt>
              <dd>Spin the Earth / pan</dd>
              <dt>Scroll or + / −</dt>
              <dd>Zoom in and out</dd>
              <dt>Right-drag or Ctrl + drag</dt>
              <dd>Tilt and rotate the view</dd>
              <dt>Middle-drag</dt>
              <dd>Rotate around the centre</dd>
              <dt>/</dt>
              <dd>Search</dd>
              <dt>Compass</dt>
              <dd>Click to turn north up</dd>
              <dt>3D</dt>
              <dd>Tilt the view, or look straight down again</dd>
            </dl>
            <div className="confirm-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDialog(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog === 'about' && (
        <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <div className="confirm-dialog earth-dialog" role="dialog" aria-labelledby="earth-about-title">
            <h2 id="earth-about-title">About InnerMap Earth</h2>
            <p>A 3D globe built with CesiumJS. No Cesium ion and no Google services are used.</p>
            <ul className="earth-about-list">
              <li>
                <strong>Whole Earth:</strong> Natural Earth II imagery (public domain), stored with the app - works offline. About 20 km per pixel.
              </li>
              <li>
                <strong>Satellite:</strong> {SATELLITE_SOURCE.label} ({SATELLITE_SOURCE.resolution || 'imagery'}). {SATELLITE_SOURCE.licenceNote}
                {HIRES_IMAGERY_SOURCE && ` Close up and online: ${HIRES_IMAGERY_SOURCE.label} (about 0.3-1 m per pixel in cities; online viewing only, never stored).`}
              </li>
              <li>
                <strong>Roads and names:</strong> © OpenStreetMap contributors · Protomaps, from the Inner Map server or your downloaded areas.
              </li>
              <li>
                <strong>Towns, villages, buildings and streets:</strong> OpenStreetMap names (© OpenMapTiles © OpenStreetMap contributors, via OpenFreeMap) as you zoom in, online. Offline: towns and villages from GeoNames (CC BY 4.0) for the areas you have viewed.
              </li>
              <li>
                <strong>Photos:</strong> famous places from Wikidata, photos from Wikimedia Commons (each credited with its author and licence). Online only - only the centre of your view is sent to Wikidata to find them.
              </li>
              <li>
                <strong>Offline files:</strong>{' '}
                {offline.ready ? `stored on this device (${formatBytes(offline.bytes || 0)}).` : offline.supported ? 'not stored yet - kept automatically while online.' : 'this browser cannot store them.'}
              </li>
            </ul>
            <div className="confirm-actions">
              <button type="button" className="btn btn-primary" onClick={() => setDialog(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog?.type === 'placemark' && (
        <div className="confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}>
          <form className="confirm-dialog earth-dialog" onSubmit={savePlacemark} aria-labelledby="earth-pm-title">
            <h2 id="earth-pm-title">New placemark</h2>
            <p className="mono small">
              {dialog.lat.toFixed(6)}, {dialog.lng.toFixed(6)}
            </p>
            <label className="field">
              <span>Name</span>
              <input autoFocus maxLength={100} value={placeName} onChange={(e) => setPlaceName(e.target.value)} placeholder="e.g. Home, Camp site" />
            </label>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={!placeName.trim()}>
                Save placemark
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
