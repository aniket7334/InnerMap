// Reusable interactive map: Leaflet + the active provider's base layer (vector or raster,
// both read downloaded tiles from IndexedDB first), live GPS marker, saved places,
// outlines of downloaded areas, a coordinate read-out and a "not downloaded" notice.
import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { createOfflineTileLayer } from './OfflineTileLayer';
import { createVectorTileLayer, tileStats } from './VectorTileLayer';
import { boundsIntersect, toBoundsObject } from './tileMath';
import { useLocation } from '../hooks/LocationContext';
import { useMapProvider } from '../hooks/ProviderContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useAuth } from '../hooks/AuthContext';
import { useTypography } from '../hooks/TypographyContext';
import { useRegions } from '../hooks/useRegions';
import { formatCoord, describeGeometry, WORLD_VIEW } from './geo';
import { SATELLITE_SOURCE, TERRAIN_SOURCE, HIRES_IMAGERY_SOURCE, getProvider } from './providers';
import { HillshadeLayer, elevationAt } from './HillshadeLayer';
import { createLabelsOverlay, createTransitOverlay, TRANSIT_LEGEND } from './viewOverlays';
import { formatLength, measureStats } from '../components/MeasurePanel';

const VECTOR = getProvider('local-vector');
const WORLD_FILL = getProvider('osm-standard');
const FILL_DETAIL_ZOOM = 9;

const DEFAULT_LINE = '#2563eb';
const DEFAULT_POINT = '#d97706';

// Popup for an imported/drawn feature. Built from DOM text nodes: KML descriptions are
// never rendered as HTML.
function featurePopup(f, layerName) {
  const el = document.createElement('div');
  el.className = 'place-popup';
  const title = document.createElement('strong');
  title.textContent = f.name || 'Unnamed feature';
  const meta = document.createElement('div');
  meta.className = 'muted small';
  meta.textContent = `${describeGeometry(f.geometry)} · ${layerName}`;
  el.append(title, meta);
  if (f.description) {
    const d = document.createElement('div');
    d.className = 'small popup-description';
    d.textContent = f.description;
    el.append(d);
  }
  return el;
}

function featureLayer(collection) {
  const { layer, features } = collection;
  const geojson = {
    type: 'FeatureCollection',
    features: features.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: { rec: f } })),
  };
  return L.geoJSON(geojson, {
    style: (feat) => {
      const s = feat.properties.rec.style || {};
      return {
        color: s.stroke || DEFAULT_LINE,
        weight: s.strokeWidth ?? 3,
        opacity: s.strokeOpacity ?? 0.9,
        fillColor: s.fill || s.stroke || DEFAULT_LINE,
        fillOpacity: s.fillOpacity ?? 0.2,
      };
    },
    pointToLayer: (feat, latlng) => {
      const s = feat.properties.rec.style || {};
      return L.circleMarker(latlng, {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: s.markerColor || DEFAULT_POINT,
        fillOpacity: 1,
      });
    },
    onEachFeature: (feat, lyr) => lyr.bindPopup(featurePopup(feat.properties.rec, layer.name)),
  });
}

function createBaseLayer(provider, typography, labelOptions) {
  return provider.kind === 'vector' ? createVectorTileLayer(provider, typography, labelOptions) : createOfflineTileLayer(provider);
}

function describeBounds(b) {
  const lat = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
  const lng = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;
  return `${lat(b.south)}–${lat(b.north)}, ${lng(b.west)}–${lng(b.east)}`;
}

const userIcon = L.divIcon({
  className: 'user-location-icon',
  html: '<span class="user-dot"></span><span class="user-pulse"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

// Last known position (no fresh fix): grey, no pulse - clearly not "live".
const userStaleIcon = L.divIcon({
  className: 'user-location-icon stale',
  html: '<span class="user-dot"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function endpointIcon(kind) {
  return L.divIcon({
    className: `route-endpoint route-${kind}`,
    html: `<span>${kind === 'start' ? 'A' : 'B'}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

const placeIcon = L.divIcon({
  className: 'place-icon',
  html: '<span class="place-pin"></span>',
  iconSize: [26, 34],
  iconAnchor: [13, 32],
  popupAnchor: [0, -28],
});

// Build popups with DOM nodes (never innerHTML) so place names cannot inject HTML.
function placePopup(place) {
  const el = document.createElement('div');
  el.className = 'place-popup';
  const title = document.createElement('strong');
  title.textContent = place.name;
  const coords = document.createElement('div');
  coords.className = 'muted small';
  coords.textContent = `${formatCoord(place.latitude, 5)}, ${formatCoord(place.longitude, 5)}`;
  el.append(title, coords);
  if (place.pending) {
    const p = document.createElement('div');
    p.className = 'small pending-text';
    p.textContent = 'Waiting to sync';
    el.append(p);
  }
  return el;
}

/** What the active map view shows, where its data comes from, and its limits. */
function ViewInfo({ view }) {
  const [open, setOpen] = useState(false);
  let title;
  let detail;
  if (view === 'satellite') {
    title = `Satellite · ${SATELLITE_SOURCE.label}`;
    detail = [
      SATELLITE_SOURCE.description,
      SATELLITE_SOURCE.imageryDate && `Imagery: ${SATELLITE_SOURCE.imageryDate}`,
      SATELLITE_SOURCE.resolution && `Resolution: ${SATELLITE_SOURCE.resolution}`,
      SATELLITE_SOURCE.licenceNote && `Licence: ${SATELLITE_SOURCE.licenceNote}`,
      HIRES_IMAGERY_SOURCE && `Close up (zoom ${HIRES_IMAGERY_SOURCE.minZoom}+), when online: ${HIRES_IMAGERY_SOURCE.label}, sharp enough to see single buildings. Online viewing only - it cannot be downloaded; offline the imagery above is shown.`,
      'Labels: OpenStreetMap (Inner Map vector data).',
    ].filter(Boolean);
  } else if (view === 'terrain') {
    title = 'Terrain · hill shading';
    detail = [TERRAIN_SOURCE.description, 'Relief is exaggerated at low zoom so hills stay visible. The elevation under the cursor is shown at the bottom.'];
  } else {
    title = 'Transit · OpenStreetMap';
    detail = [
      'Railway, metro, monorail and ferry lines with stations and stops from OpenStreetMap.',
      'Bus route lines are not in the map data, so only bus stops are shown. No timetable (GTFS) data is configured.',
    ];
  }
  return (
    <div className={`map-view-info ${open ? 'open' : ''}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {title} <span aria-hidden="true">{open ? '▴' : 'ⓘ'}</span>
      </button>
      {open && (
        <div className="map-view-detail">
          {detail.map((d) => (
            <p key={d}>{d}</p>
          ))}
          {view === 'transit' && (
            <ul className="transit-legend">
              {TRANSIT_LEGEND.map((l) => (
                <li key={l.label}>
                  <span className={`legend-line ${l.dashed ? 'dashed' : ''}`} style={{ borderColor: l.colour }} />
                  {l.label}
                </li>
              ))}
              <li>
                <span className="legend-dot station" /> Station
              </li>
              <li>
                <span className="legend-dot bus" /> Bus stop / station
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function MapView({
  initialCenter,
  initialZoom,
  className = '',
  showUser = true,
  follow = false,
  places = [],
  regions = [],
  selection = null,
  fitTo = null,
  featureCollections = [], // [{ layer, features }] from useFeatureLayers
  sketch = null, // { type: 'Point'|'LineString'|'Polygon', points: [[lat, lng], ...] } while drawing
  highlight = null, // { lat, lng, label } - e.g. a search result
  route = null, // { geometry: [[lat,lng]...], mode } - a calculated route
  endpoints = null, // { start: {lat,lng}, end: {lat,lng} } - route start/destination markers
  onReady,
  onClick,
  onDownloadArea = null, // "Download this area" in the online-only notice
  showCoordinates = true,
  showLocateButton = true,
  interactive = true,
  view = 'default', // 'default' | 'satellite' | 'terrain' | 'transit' (map view selector)
  measure = null, // { mode: 'distance'|'area', points: [[lat, lng]...], unit } - measure tool
  children,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const flyOnFix = useRef(false);
  const onClickRef = useRef(onClick);
  const { position, tracking, startTracking, fixStatus } = useLocation();
  const { provider, coverage, poiFilter } = useMapProvider();
  const poiFilterRef = useRef(poiFilter);
  poiFilterRef.current = poiFilter;
  const { status, lastChecked } = useConnectivity();
  const { user } = useAuth();
  const { settings: typography, mapLabelKey } = useTypography();
  const showSavedLabels = typography.mapLabels.showSavedLabels;
  const typographyRef = useRef(typography);
  typographyRef.current = typography;
  const { regions: deviceRegions } = useRegions(user?.id);
  const [center, setCenter] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [zoom, setZoom] = useState(initialZoom ?? WORLD_VIEW.zoom);
  const [viewBounds, setViewBounds] = useState(null);
  const [noticeDismissed, setNoticeDismissed] = useState(null);
  const [demStatus, setDemStatus] = useState(null); // terrain: { loaded, missing }
  const [elevation, setElevation] = useState(null);
  const baseLayerRef = useRef(null);
  const vectorLayerRef = useRef(null); // protomaps layer used to look up features at a click
  const fillLayerRef = useRef(null); // online OpenStreetMap map outside the server's data area

  onClickRef.current = onClick;

  // Can the active provider's tiles be fetched right now? Our own server's tiles need the
  // API to be reachable; external providers only need internet. Unknown until first check.
  const reachable =
    !lastChecked || status === 'online' || (status === 'limited' && !provider.servedByApp);

  // Downloaded areas of THIS provider that actually contain tiles.
  const storedRegions = useMemo(
    () => deviceRegions.filter((r) => r.layerId === provider.layerId && r.doneCount > 0),
    [deviceRegions, provider.layerId]
  );

  // Rebuild the base layer when connectivity flips or a download finishes, so tiles that
  // were empty before are fetched again (protomaps-leaflet caches tile data in memory).
  // Vector labels are drawn into the tiles, so label typography changes also rebuild the layer
  // (raster tiles have their labels baked in and ignore it).
  // Satellite view replaces the base layer; the other views add overlays on top of it.
  const satellite = view === 'satellite';
  // The Inner Map server's street data covers only the area in its PMTiles file (e.g. Mumbai).
  // With internet, the rest of the world is filled with the standard OpenStreetMap map
  // (online viewing only - never downloaded or stored). Offline nothing changes.
  const dataAreas = useMemo(
    () => (coverage?.areas?.length ? coverage.areas : coverage?.bounds ? [{ id: 'server', name: 'the server area', bounds: coverage.bounds }] : []),
    [coverage]
  );
  const worldFill = provider.kind === 'vector' && status !== 'offline' && dataAreas.length > 0;
  const coverageKey = dataAreas.map((a) => Object.values(a.bounds).join(',')).join(';');
  const hires = satellite && !!HIRES_IMAGERY_SOURCE && status !== 'offline';
  const refreshKey = `${satellite ? 'sat' : provider.id}|${hires}|${reachable}|${worldFill}|${coverageKey}|${poiFilter.join(',')}|${provider.kind === 'vector' ? mapLabelKey : ''}|${storedRegions
    .filter((r) => r.status !== 'downloading')
    .map((r) => `${r.id}:${r.status}`)
    .join(',')}`;

  // Create the Leaflet map once.
  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: initialCenter || WORLD_VIEW.center,
      zoom: initialZoom ?? WORLD_VIEW.zoom,
      zoomControl: false,
      worldCopyJump: true,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      touchZoom: interactive,
      keyboard: interactive,
    });
    if (interactive) L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);

    layersRef.current = {
      features: L.layerGroup().addTo(map),
      places: L.layerGroup().addTo(map),
      sketch: L.layerGroup().addTo(map),
      measure: L.layerGroup().addTo(map),
      highlight: L.layerGroup().addTo(map),
      route: L.layerGroup().addTo(map),
      regions: L.layerGroup().addTo(map),
      selection: L.layerGroup().addTo(map),
      user: L.layerGroup().addTo(map),
    };

    let raf = 0;
    const updateView = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const c = map.getCenter();
        setCenter({ lat: c.lat, lng: c.lng });
        setZoom(map.getZoom());
        setViewBounds(toBoundsObject(map.getBounds()));
      });
    };
    map.on('move zoom', updateView);
    map.on('mousemove', (e) => setCursor({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.on('mouseout', () => setCursor(null));
    // Named feature (business, landmark, place, street) under a click, from the vector data.
    const queryAt = (latlng) => {
      // the layer of the area under the click (one per city when the server has several)
      const candidates = [].concat(vectorLayerRef.current || []);
      const layer = candidates.find((l) => !l.options?.bounds || l.options.bounds.contains?.(latlng)) || candidates[0];
      if (!layer?.queryTileFeaturesDebug) return null;
      let found;
      try {
        found = layer.queryTileFeaturesDebug(latlng.lng, latlng.lat, 14);
      } catch {
        return null;
      }
      const hits = [];
      for (const list of found.values()) for (const h of list) hits.push(h);
      const named = (h) => h.feature?.props && (h.feature.props.name || h.feature.props['name:en']);
      const order = ['pois', 'places', 'water', 'roads'];
      const best = hits.filter(named).sort((a, b) => order.indexOf(a.layerName) - order.indexOf(b.layerName))[0];
      if (!best || order.indexOf(best.layerName) === -1) return null;
      const p = best.feature.props;
      return { name: p['name:en'] || p.name, kind: p.kind, layer: best.layerName, kindDetail: p.kind_detail || null };
    };
    map.on('click', (e) => onClickRef.current?.(e.latlng, map, queryAt));
    updateView();

    mapRef.current = map;
    // Diagnostics: inspect in the browser console (e.g. tile counts while offline).
    window.__innerMap = { map, tileStats };
    onReady?.(map);

    // Leaflet must re-measure when its container changes size (sidebar toggle, rotation).
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Base map: one layer for the active provider, never mixed with another provider's tiles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (satellite) {
      // Imagery + place/road labels from the vector data ("hybrid").
      const imagery = createOfflineTileLayer(SATELLITE_SOURCE).addTo(map);
      imagery.bringToBack();
      // Sharp close-up imagery on top when online (online viewing only, never stored).
      const sharp = hires
        ? L.tileLayer(HIRES_IMAGERY_SOURCE.url, {
            minZoom: HIRES_IMAGERY_SOURCE.minZoom,
            maxZoom: HIRES_IMAGERY_SOURCE.maxZoom,
            maxNativeZoom: HIRES_IMAGERY_SOURCE.maxDataZoom,
            attribution: HIRES_IMAGERY_SOURCE.attribution,
            crossOrigin: true,
          }).addTo(map)
        : null;
      sharp?.setZIndex(2);
      const labels = createLabelsOverlay(VECTOR, typographyRef.current, { poiFilter: poiFilterRef.current }).addTo(map);
      labels.setZIndex(5);
      baseLayerRef.current = imagery;
      vectorLayerRef.current = labels;
      return () => {
        map.removeLayer(imagery);
        if (sharp) map.removeLayer(sharp);
        map.removeLayer(labels);
        baseLayerRef.current = null;
        vectorLayerRef.current = null;
      };
    }
    let fill = null;
    let layer;
    if (worldFill) {
      fill = createOfflineTileLayer(WORLD_FILL).addTo(map);
      fill.setZIndex(0);
      // Our data on top, only inside each area the server has (one layer per city), and from
      // the zoom where its tiles are smaller than the area (so no patchwork at country level).
      layer = dataAreas.map(({ bounds: b }) => {
        const l = createVectorTileLayer(provider, typographyRef.current, { poiFilter: poiFilterRef.current }, {
          bounds: L.latLngBounds([b.south, b.west], [b.north, b.east]),
          minZoom: FILL_DETAIL_ZOOM,
        }).addTo(map);
        l.setZIndex(1);
        return l;
      });
    } else {
      layer = createBaseLayer(provider, typographyRef.current, { poiFilter: poiFilterRef.current }).addTo(map);
      layer.bringToBack();
    }
    const layers = [].concat(layer);
    baseLayerRef.current = layers.length === 1 ? layers[0] : { setOpacity: (o) => layers.forEach((l) => l.setOpacity?.(o)) };
    fillLayerRef.current = fill;
    vectorLayerRef.current = provider.kind === 'vector' ? layers : null;
    return () => {
      if (fill) map.removeLayer(fill);
      fillLayerRef.current = null;
      layers.forEach((l) => map.removeLayer(l));
      baseLayerRef.current = null;
      vectorLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Measure tool: straight line / polygon with point markers and segment lengths.
  useEffect(() => {
    const layer = layersRef.current.measure;
    if (!layer) return;
    layer.clearLayers();
    if (!measure || !measure.points.length) return;
    const pts = measure.points;
    const style = { color: '#b45309', weight: 3, dashArray: '6 5', interactive: false };
    if (measure.mode === 'area' && pts.length >= 3) {
      L.polygon(pts, { ...style, fillColor: '#f59e0b', fillOpacity: 0.15 }).addTo(layer);
    } else if (pts.length >= 2) {
      L.polyline(pts, style).addTo(layer);
    }
    const stats = measureStats(pts, measure.mode);
    const label = (latlng, text, cls = '') => {
      const el = document.createElement('span');
      el.textContent = text;
      L.tooltip({ permanent: true, direction: 'center', className: `measure-label ${cls}`, interactive: false })
        .setLatLng(latlng)
        .setContent(el)
        .addTo(layer);
    };
    if (measure.mode === 'distance') {
      stats.segments.forEach((d, i) => {
        if (stats.segments.length > 1) label([(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2], formatLength(d, measure.unit));
      });
    }
    pts.forEach((p, i) =>
      L.circleMarker(p, { radius: 5, color: '#ffffff', weight: 2, fillColor: '#b45309', fillOpacity: 1, interactive: false }).addTo(layer)
    );
    if (measure.mode === 'distance' && pts.length >= 2) label(pts[pts.length - 1], `Total ${formatLength(stats.length, measure.unit)}`, 'measure-total-label');
  }, [measure]);

  // Terrain view: hill shading from elevation data over the base map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || view !== 'terrain') return undefined;
    const layer = new HillshadeLayer({ source: TERRAIN_SOURCE, attribution: TERRAIN_SOURCE.attribution });
    layer.on('demstatus', (e) => setDemStatus({ loaded: e.loaded, missing: e.missing }));
    layer.addTo(map).setZIndex(3);
    return () => {
      map.removeLayer(layer);
      setDemStatus(null);
      setElevation(null);
    };
  }, [view, reachable]);

  // Terrain view: elevation under the cursor (or map centre).
  const elevPoint = cursor || center;
  useEffect(() => {
    if (view !== 'terrain' || !elevPoint) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      elevationAt(TERRAIN_SOURCE, elevPoint.lat, elevPoint.lng, Math.min(zoom, 14))
        .then((v) => alive && setElevation(v))
        .catch(() => alive && setElevation(null));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [view, elevPoint?.lat, elevPoint?.lng, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transit view: rail / metro lines and stops over a faded base map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || view !== 'transit') return undefined;
    const layer = createTransitOverlay(VECTOR, typographyRef.current).addTo(map);
    layer.setZIndex(4);
    return () => map.removeLayer(layer);
  }, [view, reachable, mapLabelKey]);
  useEffect(() => {
    baseLayerRef.current?.setOpacity?.(view === 'transit' ? 0.55 : 1);
    fillLayerRef.current?.setOpacity?.(view === 'transit' ? 0.55 : 1);
  }, [view, refreshKey]);

  // Messages about the active map view (coverage, offline limits).
  const viewNotice = useMemo(() => {
    if (view === 'satellite' && status !== 'online') {
      return { id: 'sat-offline', text: 'Satellite imagery needs internet unless it was downloaded for this area (otherwise shown as “Not downloaded”).' };
    }
    if (view === 'terrain' && demStatus && demStatus.loaded === 0 && demStatus.missing > 0) {
      return {
        id: 'dem-missing',
        text: navigator.onLine ? 'No elevation data could be loaded for this area.' : 'Terrain needs internet here: no elevation data is stored on this device for this area.',
      };
    }
    return null;
  }, [view, status, demStatus]);

  // Tell the user when the visible area has no map data available.
  const notice = useMemo(() => {
    if (!viewBounds) return null;
    if (!reachable && !worldFill) {
      if (!provider.offlineAllowed) {
        return {
          id: 'provider-offline',
          text: `${provider.label} needs a connection. Switch the base map to “Inner Map Offline” to see downloaded areas.`,
        };
      }
      if (!storedRegions.some((r) => boundsIntersect(r.bounds, viewBounds))) {
        return {
          id: 'not-downloaded',
          text: 'Not downloaded: this area is not saved on this device, so no map can be shown offline.',
          action: storedRegions[0] ? { label: 'Go to a downloaded area', bounds: storedRegions[0].bounds } : null,
        };
      }
      return null;
    }
    if (provider.kind === 'vector' && coverage) {
      if (coverage.available === false) {
        return { id: 'no-file', text: 'The server has no vector map file yet. See backend/data/README.md.' };
      }
      if (coverage.bounds && zoom >= 6 && !dataAreas.some((a) => boundsIntersect(a.bounds, viewBounds))) {
        if (worldFill) {
          return {
            id: 'online-fill',
            text: `Online map (OpenStreetMap): needs internet. To use this place offline, download it - the server first prepares its map data. Offline areas now: ${dataAreas.map((a) => a.name).join(', ')}.`,
            action: onDownloadArea ? { label: 'Download this area', download: true } : null,
          };
        }
        return {
          id: 'outside-coverage',
          text: `No map data here. The Inner Map server has data for ${describeBounds(coverage.bounds)}.`,
          action: { label: 'Show data area', bounds: coverage.bounds },
        };
      }
    }
    return null;
  }, [viewBounds, reachable, provider, storedRegions, coverage, zoom, worldFill, dataAreas]); // eslint-disable-line react-hooks/exhaustive-deps

  const fitBounds = (b) =>
    mapRef.current?.fitBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { padding: [24, 24] }
    );

  // Blue GPS marker + accuracy circle.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layersRef.current.user;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!showUser || !position) return;
    const latlng = [position.lat, position.lng];
    const live = fixStatus === 'live';
    if (position.accuracy) {
      // The circle is the accuracy radius reported by the device: the true position is
      // probably inside it. A dashed grey circle means it is an old (last known) fix.
      L.circle(latlng, {
        radius: position.accuracy,
        color: live ? '#2563eb' : '#6b717b',
        weight: 1,
        dashArray: live ? null : '4 4',
        fillColor: live ? '#3b82f6' : '#9ca3af',
        fillOpacity: live ? 0.12 : 0.08,
        interactive: false,
      }).addTo(layer);
    }
    L.marker(latlng, {
      icon: live ? userIcon : userStaleIcon,
      interactive: false,
      zIndexOffset: 1000,
      keyboard: false,
      title: live ? 'Your location' : 'Last known location',
    }).addTo(layer);

    if (flyOnFix.current && !position.restored) {
      flyOnFix.current = false;
      map.flyTo(latlng, Math.max(map.getZoom(), 16));
    } else if (follow && live) {
      map.panTo(latlng, { animate: true });
    }
  }, [position, showUser, follow, fixStatus]);

  // Route line (white casing + coloured line; dashed when calculated offline) and A/B markers.
  useEffect(() => {
    const layer = layersRef.current.route;
    if (!layer) return;
    layer.clearLayers();
    if (route?.geometry?.length) {
      L.polyline(route.geometry, { color: '#ffffff', weight: 9, opacity: 0.95, interactive: false }).addTo(layer);
      L.polyline(route.geometry, {
        color: route.mode === 'offline' ? '#0b6e64' : '#2563eb',
        weight: 5,
        opacity: 0.95,
        interactive: false,
      }).addTo(layer);
    }
    if (endpoints?.start) {
      L.marker([endpoints.start.lat, endpoints.start.lng], { icon: endpointIcon('start'), title: 'Start', keyboard: false }).addTo(layer);
    }
    if (endpoints?.end) {
      L.marker([endpoints.end.lat, endpoints.end.lng], { icon: endpointIcon('end'), title: 'Destination', keyboard: false }).addTo(layer);
    }
  }, [route, endpoints]);

  // Saved places.
  useEffect(() => {
    const layer = layersRef.current.places;
    if (!layer) return;
    layer.clearLayers();
    places.forEach((p) => {
      const marker = L.marker([p.latitude, p.longitude], { icon: placeIcon, title: p.name }).bindPopup(placePopup(p));
      // Name label next to the pin; size/font come from the map typography CSS variables.
      if (showSavedLabels && p.name) {
        const text = document.createElement('span');
        text.textContent = p.name; // DOM text, never HTML
        marker.bindTooltip(text, { permanent: true, direction: 'right', offset: [10, -20], className: 'place-label', opacity: 1 });
      }
      marker.addTo(layer);
    });
  }, [places, showSavedLabels]);

  // Imported (KML/KMZ/GeoJSON) and drawn markers, paths and polygons.
  useEffect(() => {
    const layer = layersRef.current.features;
    if (!layer) return;
    layer.clearLayers();
    featureCollections.forEach((c) => featureLayer(c).addTo(layer));
  }, [featureCollections]);

  // Highlighted point (search result): a ring and a label, until the next highlight.
  useEffect(() => {
    const layer = layersRef.current.highlight;
    if (!layer) return;
    layer.clearLayers();
    if (!highlight) return;
    L.circleMarker([highlight.lat, highlight.lng], {
      radius: 11,
      color: '#0b6e64',
      weight: 3,
      fillOpacity: 0,
      interactive: false,
    })
      .bindTooltip(highlight.label || '', { permanent: true, direction: 'top', offset: [0, -10], className: 'highlight-label' })
      .addTo(layer);
  }, [highlight]);

  // Shape being drawn (not yet saved).
  useEffect(() => {
    const layer = layersRef.current.sketch;
    if (!layer) return;
    layer.clearLayers();
    const map = mapRef.current;
    if (map && interactive) {
      // Quick clicks while drawing must add points, not zoom the map.
      if (sketch?.stage === 'drawing') {
        map.closePopup();
        map.doubleClickZoom.disable();
      } else {
        map.doubleClickZoom.enable();
      }
    }
    if (!sketch || !sketch.points.length) return;
    const style = { color: '#2563eb', weight: 3, dashArray: '6 6', interactive: false };
    if (sketch.type === 'Polygon' && sketch.points.length >= 3) {
      L.polygon(sketch.points, { ...style, fillOpacity: 0.15 }).addTo(layer);
    } else if (sketch.type !== 'Point' && sketch.points.length >= 2) {
      L.polyline(sketch.points, style).addTo(layer);
    }
    sketch.points.forEach((p, i) =>
      L.circleMarker(p, {
        radius: i === 0 ? 6 : 5,
        color: '#2563eb',
        weight: 2,
        fillColor: '#ffffff',
        fillOpacity: 1,
        interactive: false,
      }).addTo(layer)
    );
  }, [sketch]);

  // Outlines of downloaded areas, so the user can see exactly where offline coverage exists.
  useEffect(() => {
    const layer = layersRef.current.regions;
    if (!layer) return;
    layer.clearLayers();
    regions.forEach((r) => {
      const b = r.bounds;
      L.rectangle(
        [
          [b.south, b.west],
          [b.north, b.east],
        ],
        {
          color: r.status === 'completed' ? '#0f766e' : '#d97706',
          weight: 2,
          dashArray: '6 6',
          fill: false,
          interactive: false,
        }
      ).addTo(layer);
    });
  }, [regions]);

  // Highlighted selection (download page).
  useEffect(() => {
    const layer = layersRef.current.selection;
    if (!layer) return;
    layer.clearLayers();
    if (!selection) return;
    L.rectangle(
      [
        [selection.south, selection.west],
        [selection.north, selection.east],
      ],
      { color: '#2563eb', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.12, interactive: false }
    ).addTo(layer);
  }, [selection]);

  // Programmatic "fit to bounds" requests.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitTo) return;
    map.fitBounds(
      [
        [fitTo.south, fitTo.west],
        [fitTo.north, fitTo.east],
      ],
      { padding: [24, 24] }
    );
  }, [fitTo]);

  const locate = () => {
    const map = mapRef.current;
    if (position && !position.restored && map) {
      map.flyTo([position.lat, position.lng], Math.max(map.getZoom(), 16));
      return;
    }
    flyOnFix.current = true;
    if (!tracking) startTracking();
  };

  return (
    <div className={`map-view ${className} ${sketch?.stage === 'drawing' || measure ? 'is-drawing' : ''}`}>
      <div ref={containerRef} className="map-canvas" />
      {showLocateButton && (
        <button
          type="button"
          className="map-locate-btn"
          onClick={locate}
          title="Go to my current location"
          aria-label="Go to my current location"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            <path
              d="M12 2v3M12 19v3M2 12h3M19 12h3"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
          </svg>
        </button>
      )}
      {showCoordinates && center && (
        <div className="map-coords map-statusbar" aria-live="off">
          <span className={`statusbar-state conn-${status}`}>
            <span className="dot" />
            {status === 'offline' ? 'Offline - showing data stored on this device' : status === 'limited' ? 'Inner Map server unreachable' : 'Map ready'}
            <span className="statusbar-source"> · {view === 'satellite' ? SATELLITE_SOURCE.label : provider.label}</span>
          </span>
          <span className="statusbar-coords">
            <span>
              {cursor ? 'Cursor' : 'Center'} {formatCoord((cursor || center).lat, 5)}, {formatCoord((cursor || center).lng, 5)}
            </span>
            <span className="map-coords-zoom">z{zoom}</span>
            {view === 'terrain' && <span className="map-coords-elev">{elevation == null ? 'Elevation –' : `Elevation ${Math.round(elevation)} m`}</span>}
            <span className="statusbar-datum">WGS 84</span>
          </span>
        </div>
      )}
      {!notice && viewNotice && noticeDismissed !== viewNotice.id && (
        <div className="map-notice" role="status">
          <span>{viewNotice.text}</span>
          <button type="button" className="map-notice-close" onClick={() => setNoticeDismissed(viewNotice.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {view !== 'default' && <ViewInfo view={view} />}
      {notice && noticeDismissed !== notice.id && (
        <div className="map-notice" role="status">
          <span>{notice.text}</span>
          {notice.action && (
            <button type="button" className="link-btn" onClick={() => (notice.action.download ? onDownloadArea?.() : fitBounds(notice.action.bounds))}>
              {notice.action.label}
            </button>
          )}
          <button
            type="button"
            className="map-notice-close"
            onClick={() => setNoticeDismissed(notice.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
