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
import { useRegions } from '../hooks/useRegions';
import { formatCoord, describeGeometry, WORLD_VIEW } from './geo';

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

function createBaseLayer(provider) {
  return provider.kind === 'vector' ? createVectorTileLayer(provider) : createOfflineTileLayer(provider);
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
  showCoordinates = true,
  showLocateButton = true,
  interactive = true,
  children,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const flyOnFix = useRef(false);
  const onClickRef = useRef(onClick);
  const { position, tracking, startTracking, fixStatus } = useLocation();
  const { provider, coverage } = useMapProvider();
  const { status, lastChecked } = useConnectivity();
  const { user } = useAuth();
  const { regions: deviceRegions } = useRegions(user?.id);
  const [center, setCenter] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [zoom, setZoom] = useState(initialZoom ?? WORLD_VIEW.zoom);
  const [viewBounds, setViewBounds] = useState(null);
  const [noticeDismissed, setNoticeDismissed] = useState(null);

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
  const refreshKey = `${provider.id}|${reachable}|${storedRegions
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
    map.on('click', (e) => onClickRef.current?.(e.latlng, map));
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
    const layer = createBaseLayer(provider).addTo(map);
    layer.bringToBack();
    return () => {
      map.removeLayer(layer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Tell the user when the visible area has no map data available.
  const notice = useMemo(() => {
    if (!viewBounds) return null;
    if (!reachable) {
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
      if (coverage.bounds && zoom >= 6 && !boundsIntersect(coverage.bounds, viewBounds)) {
        return {
          id: 'outside-coverage',
          text: `No map data here. The Inner Map server has data for ${describeBounds(coverage.bounds)}.`,
          action: { label: 'Show data area', bounds: coverage.bounds },
        };
      }
    }
    return null;
  }, [viewBounds, reachable, provider, storedRegions, coverage, zoom]);

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
      L.marker([p.latitude, p.longitude], { icon: placeIcon, title: p.name })
        .bindPopup(placePopup(p))
        .addTo(layer);
    });
  }, [places]);

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
    <div className={`map-view ${className} ${sketch?.stage === 'drawing' ? 'is-drawing' : ''}`}>
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
        <div className="map-coords" aria-live="off">
          <span>
            {cursor ? 'Cursor' : 'Center'}: {formatCoord((cursor || center).lat, 5)},{' '}
            {formatCoord((cursor || center).lng, 5)}
          </span>
          <span className="map-coords-zoom">z{zoom}</span>
        </div>
      )}
      {notice && noticeDismissed !== notice.id && (
        <div className="map-notice" role="status">
          <span>{notice.text}</span>
          {notice.action && (
            <button type="button" className="link-btn" onClick={() => fitBounds(notice.action.bounds)}>
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
