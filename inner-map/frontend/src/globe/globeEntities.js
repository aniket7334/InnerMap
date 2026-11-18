// Converts Inner Map data (saved places, KML/KMZ/GeoJSON layers, downloaded areas, GPS fix)
// into CesiumJS entities for the 3D globe.
import {
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  DistanceDisplayCondition,
  HeightReference,
  LabelStyle,
  PolygonHierarchy,
  VerticalOrigin,
} from 'cesium';
import { describeGeometry } from '../maps/geo';

const DEFAULT_LINE = '#2563eb';
const DEFAULT_POINT = '#d97706';
const LABEL_DISTANCE = new DistanceDisplayCondition(0, 60000); // hide labels when zoomed far out

function color(hex, alpha = 1) {
  return Color.fromCssColorString(hex || DEFAULT_LINE).withAlpha(alpha);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** InfoBox HTML built only from escaped plain text (KML HTML is never rendered). */
function infoHtml(lines) {
  return lines
    .filter(Boolean)
    .map((l) => `<p style="white-space:pre-wrap;margin:0 0 6px">${escapeHtml(l)}</p>`)
    .join('');
}

function label(text, fill = '#111827') {
  return {
    text,
    font: '600 13px system-ui, sans-serif',
    fillColor: Color.fromCssColorString(fill),
    outlineColor: Color.WHITE,
    outlineWidth: 3,
    style: LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: VerticalOrigin.BOTTOM,
    pixelOffset: new Cartesian2(0, -12),
    heightReference: HeightReference.CLAMP_TO_GROUND,
    distanceDisplayCondition: LABEL_DISTANCE,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

const toPositions = (coords) => Cartesian3.fromDegreesArray(coords.flatMap((c) => [c[0], c[1]]));

function addPoint(ds, [lon, lat], name, markerColor, description) {
  ds.entities.add({
    name: name || 'Marker',
    position: Cartesian3.fromDegrees(lon, lat),
    point: {
      pixelSize: 11,
      color: color(markerColor || DEFAULT_POINT),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: name ? label(name) : undefined,
    description,
  });
}

function addLine(ds, coords, name, style, description) {
  ds.entities.add({
    name: name || 'Path',
    polyline: {
      positions: toPositions(coords),
      width: style.strokeWidth ?? 3,
      material: color(style.stroke || DEFAULT_LINE, style.strokeOpacity ?? 0.95),
      clampToGround: true,
    },
    description,
  });
}

function addPolygon(ds, rings, name, style, description) {
  const [outer, ...holes] = rings;
  const stroke = style.stroke || style.fill || DEFAULT_LINE;
  ds.entities.add({
    name: name || 'Polygon',
    polygon: {
      hierarchy: new PolygonHierarchy(toPositions(outer), holes.map((h) => new PolygonHierarchy(toPositions(h)))),
      material: new ColorMaterialProperty(color(style.fill || stroke, style.fillOpacity ?? 0.2)),
    },
    description,
  });
  // Ground-clamped polygons cannot draw outlines, so outline each ring as a clamped line.
  rings.forEach((ring) => addLine(ds, ring, null, { stroke, strokeWidth: style.strokeWidth ?? 2 }, description));
}

/** One feature (any GeoJSON geometry type) -> entities. */
export function addFeature(ds, f, layerName) {
  const g = f.geometry;
  const style = f.style || {};
  const description = infoHtml([describeGeometry(g), f.description, `Layer: ${layerName}`]);
  switch (g.type) {
    case 'Point':
      return addPoint(ds, g.coordinates, f.name, style.markerColor, description);
    case 'MultiPoint':
      return g.coordinates.forEach((c) => addPoint(ds, c, f.name, style.markerColor, description));
    case 'LineString':
      return addLine(ds, g.coordinates, f.name, style, description);
    case 'MultiLineString':
      return g.coordinates.forEach((c) => addLine(ds, c, f.name, style, description));
    case 'Polygon':
      return addPolygon(ds, g.coordinates, f.name, style, description);
    case 'MultiPolygon':
      return g.coordinates.forEach((p) => addPolygon(ds, p, f.name, style, description));
    default:
      return undefined;
  }
}

export function fillFeatures(ds, collections) {
  ds.entities.suspendEvents();
  ds.entities.removeAll();
  collections.forEach(({ layer, features }) => features.forEach((f) => addFeature(ds, f, layer.name)));
  ds.entities.resumeEvents();
}

export function fillPlaces(ds, places) {
  ds.entities.suspendEvents();
  ds.entities.removeAll();
  places.forEach((p) =>
    addPoint(
      ds,
      [p.longitude, p.latitude],
      p.name,
      '#dc2626',
      infoHtml([`${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`, p.pending ? 'Waiting to sync' : 'Saved location'])
    )
  );
  ds.entities.resumeEvents();
}

/** Outlines of downloaded map areas (where the detailed map works offline). */
export function fillRegions(ds, regions) {
  ds.entities.suspendEvents();
  ds.entities.removeAll();
  regions.forEach((r) => {
    const b = r.bounds;
    ds.entities.add({
      name: r.name,
      polyline: {
        positions: Cartesian3.fromDegreesArray([b.west, b.south, b.east, b.south, b.east, b.north, b.west, b.north, b.west, b.south]),
        width: 2,
        material: color(r.status === 'completed' ? '#0f766e' : '#d97706', 0.9),
        clampToGround: true,
      },
      description: infoHtml([`Downloaded map area (${r.status})`, `Zoom ${r.zoomMin}-${r.zoomMax}`]),
    });
  });
  ds.entities.resumeEvents();
}

/** Blue GPS dot + accuracy circle; returns the entities so they can be moved. */
export function createUserEntities(ds) {
  const accuracy = ds.entities.add({
    show: false,
    ellipse: {
      semiMajorAxis: 10,
      semiMinorAxis: 10,
      material: color('#3b82f6', 0.18),
      heightReference: HeightReference.CLAMP_TO_GROUND,
    },
  });
  const dot = ds.entities.add({
    name: 'My location',
    show: false,
    point: {
      pixelSize: 14,
      color: color('#2563eb'),
      outlineColor: Color.WHITE,
      outlineWidth: 3,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  return { dot, accuracy };
}

export function updateUserEntities({ dot, accuracy }, position) {
  if (!position) {
    dot.show = false;
    accuracy.show = false;
    return;
  }
  const where = Cartesian3.fromDegrees(position.lng, position.lat);
  dot.position = where;
  dot.description = infoHtml([
    `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`,
    position.accuracy ? `Accuracy ± ${Math.round(position.accuracy)} m` : null,
  ]);
  dot.show = true;
  if (position.accuracy) {
    const r = Math.max(5, position.accuracy);
    accuracy.position = where;
    accuracy.ellipse.semiMajorAxis = r;
    accuracy.ellipse.semiMinorAxis = r;
    accuracy.show = true;
  } else {
    accuracy.show = false;
  }
}
