// KML / KMZ / GeoJSON import and KML / KMZ export.
//
// KML is the file format Google Earth (web, Pro and mobile) imports and exports.
// KMZ is a ZIP file containing doc.kml (and optionally images).
// Inside Inner Map every feature is GeoJSON: { name, description, geometry, style }.
import { kml as kmlToGeoJSON } from '@tmcw/togeojson';
import JSZip from 'jszip';

export const IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 50 * 1024 * 1024, // 50 MB file
  maxFeatures: 10000, // same per-import limit as Google Earth web
  maxVertices: 250000,
});

const SUPPORTED = new Set(['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon']);

// ---------------------------------------------------------------- helpers ---

/** KML descriptions often contain HTML. We keep plain text only (never render remote HTML). */
function plainText(value, max = 5000) {
  if (value === null || value === undefined) return null;
  let text = typeof value === 'object' && value.value !== undefined ? String(value.value) : String(value);
  if (/[<&]/.test(text)) {
    const doc = new DOMParser().parseFromString(text.replace(/<br\s*\/?>/gi, '\n'), 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());
    text = doc.body.textContent || '';
  }
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text ? text.slice(0, max) : null;
}

function hexColor(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined;
}

function num(v) {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Normalise style properties from togeojson / simplestyle-spec into our style object. */
function styleFrom(p = {}) {
  const style = {
    stroke: hexColor(p.stroke),
    strokeWidth: num(p['stroke-width']),
    strokeOpacity: num(p['stroke-opacity']),
    fill: hexColor(p.fill),
    fillOpacity: num(p['fill-opacity']),
    markerColor: hexColor(p['marker-color'] || p['icon-color']),
  };
  Object.keys(style).forEach((k) => style[k] === undefined && delete style[k]);
  return Object.keys(style).length ? style : null;
}

function validPosition(p) {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90
  );
}

/** Keep [lon, lat] or [lon, lat, alt]; drop extra values (e.g. timestamps). */
function cleanCoords(c, depth) {
  if (depth === 0) {
    if (!validPosition(c)) throw new Error('invalid coordinate');
    return c.length >= 3 && Number.isFinite(c[2]) ? [c[0], c[1], c[2]] : [c[0], c[1]];
  }
  return c.map((x) => cleanCoords(x, depth - 1));
}

const DEPTH = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 };

function countVertices(geometry) {
  const walk = (c, d) => (d === 0 ? 1 : c.reduce((s, x) => s + walk(x, d - 1), 0));
  return walk(geometry.coordinates, DEPTH[geometry.type]);
}

/** Make a geometry safe: valid coords, enough points, closed polygon rings. Returns null if unusable. */
function cleanGeometry(g) {
  if (!g || !SUPPORTED.has(g.type)) return null;
  try {
    const coordinates = cleanCoords(g.coordinates, DEPTH[g.type]);
    const closeRing = (ring) => {
      const [a, b] = [ring[0], ring[ring.length - 1]];
      return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
    };
    if (g.type === 'LineString' && coordinates.length < 2) return null;
    if (g.type === 'MultiLineString' && coordinates.some((l) => l.length < 2)) return null;
    if (g.type === 'Polygon') {
      const rings = coordinates.map(closeRing);
      return rings[0]?.length >= 4 ? { type: 'Polygon', coordinates: rings } : null;
    }
    if (g.type === 'MultiPolygon') {
      const polys = coordinates.map((p) => p.map(closeRing));
      return polys.every((p) => p[0]?.length >= 4) ? { type: 'MultiPolygon', coordinates: polys } : null;
    }
    return { type: g.type, coordinates };
  } catch {
    return null;
  }
}

/** Turn a GeoJSON FeatureCollection into Inner Map features + a report of what was skipped. */
function fromGeoJSON(collection) {
  const features = [];
  const report = { points: 0, lines: 0, polygons: 0, noGeometry: 0, invalid: 0, unsupported: 0 };
  let vertices = 0;

  const add = (props, geometry) => {
    const g = cleanGeometry(geometry);
    if (!g) {
      report[SUPPORTED.has(geometry?.type) ? 'invalid' : 'unsupported'] += 1;
      return;
    }
    vertices += countVertices(g);
    // KML GroundOverlay = an image draped on the map. We do not display the image, only its
    // footprint as a thin outline, and say so in the description (counted in groundOverlays).
    const isOverlay = props['@geometry-type'] === 'groundoverlay';
    if (isOverlay) report.overlayOutlines = (report.overlayOutlines || 0) + 1;
    else if (/Point/.test(g.type)) report.points += 1;
    else if (/LineString/.test(g.type)) report.lines += 1;
    else report.polygons += 1;
    const description = plainText(props.description);
    features.push({
      name: plainText(props.name, 255),
      description: isOverlay
        ? [description, 'Image overlay from KML: only its outline is shown in Inner Map.'].filter(Boolean).join('\n\n')
        : description,
      geometry: g,
      style: isOverlay ? { stroke: '#64748b', strokeWidth: 1, fillOpacity: 0 } : styleFrom(props),
    });
  };

  const list = collection.type === 'FeatureCollection' ? collection.features : [collection];
  for (const f of list) {
    const isFeature = f && f.type === 'Feature';
    const geometry = isFeature ? f.geometry : f;
    const props = (isFeature && f.properties) || {};
    if (!geometry) {
      report.noGeometry += 1;
    } else if (geometry.type === 'GeometryCollection') {
      // KML MultiGeometry with mixed types: one Inner Map feature per part, same name/style.
      (geometry.geometries || []).forEach((g) => add(props, g));
    } else {
      add(props, geometry);
    }
    if (features.length > IMPORT_LIMITS.maxFeatures) {
      throw new Error(`The file has more than ${IMPORT_LIMITS.maxFeatures.toLocaleString()} features. Split it into smaller files.`);
    }
    if (vertices > IMPORT_LIMITS.maxVertices) {
      throw new Error(`The file has more than ${IMPORT_LIMITS.maxVertices.toLocaleString()} points in its shapes. Simplify or split it.`);
    }
  }
  return { features, report };
}

function parseKmlText(text) {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The KML file is not valid XML.');
  if (!doc.getElementsByTagName('kml').length && !doc.getElementsByTagName('Placemark').length) {
    throw new Error('This file does not look like KML.');
  }
  const docName = doc.querySelector('Document > name, kml > Folder > name')?.textContent?.trim() || null;
  const { features, report } = fromGeoJSON(kmlToGeoJSON(doc));
  // Things KML can contain that Inner Map does not display - reported, never silently dropped.
  report.networkLinks = doc.getElementsByTagName('NetworkLink').length;
  report.groundOverlays = doc.getElementsByTagName('GroundOverlay').length;
  report.models = doc.getElementsByTagName('Model').length;
  return { docName, features, report };
}

async function kmlTextFromKmz(file) {
  const zip = await JSZip.loadAsync(file);
  const kmlFiles = Object.values(zip.files).filter((f) => !f.dir && /\.kml$/i.test(f.name));
  if (!kmlFiles.length) throw new Error('The KMZ file does not contain a KML document.');
  // Google Earth reads doc.kml, or else the first .kml at the top level.
  const main =
    kmlFiles.find((f) => f.name.toLowerCase() === 'doc.kml') ||
    kmlFiles.sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
  return main.async('string');
}

// ----------------------------------------------------------------- import ---

/**
 * Read a .kml, .kmz, .geojson or .json file.
 * Returns { name, format, features, report }.
 */
export async function readGeoFile(file) {
  if (file.size > IMPORT_LIMITS.maxFileBytes) {
    throw new Error(`The file is larger than ${IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB.`);
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const baseName = file.name.replace(/\.[^.]+$/, '');
  let result;
  let format;

  if (ext === 'kmz') {
    format = 'KMZ';
    result = parseKmlText(await kmlTextFromKmz(file));
  } else if (ext === 'kml') {
    format = 'KML';
    result = parseKmlText(await file.text());
  } else if (ext === 'geojson' || ext === 'json') {
    format = 'GeoJSON';
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error('The GeoJSON file is not valid JSON.');
    }
    if (!data || !['FeatureCollection', 'Feature', ...SUPPORTED, 'GeometryCollection'].includes(data.type)) {
      throw new Error('This JSON file is not GeoJSON.');
    }
    result = { docName: data.name || null, ...fromGeoJSON(data) };
  } else {
    throw new Error('Choose a .kml, .kmz or .geojson file.');
  }

  if (!result.features.length) throw new Error('No markers, paths or polygons were found in this file.');
  return {
    name: (result.docName || baseName).slice(0, 100),
    format,
    features: result.features,
    report: result.report,
  };
}

/** Human-readable summary of an import report. */
export function describeImport(report) {
  const parts = [];
  if (report.points) parts.push(`${report.points} marker${report.points === 1 ? '' : 's'}`);
  if (report.lines) parts.push(`${report.lines} path${report.lines === 1 ? '' : 's'}`);
  if (report.polygons) parts.push(`${report.polygons} polygon${report.polygons === 1 ? '' : 's'}`);
  const skipped = [];
  if (report.noGeometry) skipped.push(`${report.noGeometry} without a location`);
  if (report.invalid) skipped.push(`${report.invalid} with invalid coordinates`);
  if (report.unsupported) skipped.push(`${report.unsupported} unsupported shapes`);
  if (report.groundOverlays) skipped.push(`${report.groundOverlays} image overlays (outline only)`);
  if (report.networkLinks) skipped.push(`${report.networkLinks} network links (not followed)`);
  if (report.models) skipped.push(`${report.models} 3D models`);
  return { found: parts.join(', '), skipped: skipped.join(', ') };
}

// ----------------------------------------------------------------- export ---

function xml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** "#rrggbb" + opacity -> KML "aabbggrr". */
function kmlColor(hex, opacity = 1) {
  const h = (hex || '#2563eb').replace('#', '');
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toLowerCase();
}

const coord = (p) => (p.length >= 3 ? `${p[0]},${p[1]},${p[2]}` : `${p[0]},${p[1]}`);
const coordList = (list) => list.map(coord).join(' ');

function ringXml(ring) {
  return `<LinearRing><coordinates>${coordList(ring)}</coordinates></LinearRing>`;
}

function polygonXml(rings) {
  const [outer, ...holes] = rings;
  return (
    `<Polygon><tessellate>1</tessellate><outerBoundaryIs>${ringXml(outer)}</outerBoundaryIs>` +
    holes.map((h) => `<innerBoundaryIs>${ringXml(h)}</innerBoundaryIs>`).join('') +
    `</Polygon>`
  );
}

function geometryXml(g) {
  switch (g.type) {
    case 'Point':
      return `<Point><coordinates>${coord(g.coordinates)}</coordinates></Point>`;
    case 'LineString':
      return `<LineString><tessellate>1</tessellate><coordinates>${coordList(g.coordinates)}</coordinates></LineString>`;
    case 'Polygon':
      return polygonXml(g.coordinates);
    case 'MultiPoint':
      return `<MultiGeometry>${g.coordinates.map((c) => geometryXml({ type: 'Point', coordinates: c })).join('')}</MultiGeometry>`;
    case 'MultiLineString':
      return `<MultiGeometry>${g.coordinates.map((c) => geometryXml({ type: 'LineString', coordinates: c })).join('')}</MultiGeometry>`;
    case 'MultiPolygon':
      return `<MultiGeometry>${g.coordinates.map((c) => polygonXml(c)).join('')}</MultiGeometry>`;
    default:
      return '';
  }
}

function styleXml(style, type) {
  const s = style || {};
  if (/Point/.test(type)) {
    return `<Style><IconStyle><color>${kmlColor(s.markerColor || '#dc2626')}</color></IconStyle></Style>`;
  }
  const line = `<LineStyle><color>${kmlColor(s.stroke || '#2563eb', s.strokeOpacity ?? 1)}</color><width>${
    s.strokeWidth ?? 3
  }</width></LineStyle>`;
  if (/Polygon/.test(type)) {
    return `<Style>${line}<PolyStyle><color>${kmlColor(s.fill || s.stroke || '#2563eb', s.fillOpacity ?? 0.25)}</color></PolyStyle></Style>`;
  }
  return `<Style>${line}</Style>`;
}

function placemarkXml(f) {
  return (
    `<Placemark>` +
    (f.name ? `<name>${xml(f.name)}</name>` : '') +
    (f.description ? `<description>${xml(f.description)}</description>` : '') +
    styleXml(f.style, f.geometry.type) +
    geometryXml(f.geometry) +
    `</Placemark>`
  );
}

/**
 * Build a KML 2.2 document.
 * folders: [{ name, features: [{ name, description, geometry, style }] }]
 */
export function buildKml({ name, description, folders }) {
  const body = folders
    .filter((f) => f.features.length)
    .map((f) => `<Folder><name>${xml(f.name)}</name>${f.features.map(placemarkXml).join('\n')}</Folder>`)
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n` +
    `<name>${xml(name)}</name>\n` +
    (description ? `<description>${xml(description)}</description>\n` : '') +
    `${body}\n</Document>\n</kml>\n`
  );
}

/** Saved locations -> features for export. */
export function savedLocationsToFeatures(locations) {
  return locations.map((l) => ({
    name: l.name,
    description: `Saved in Inner Map · ${l.latitude.toFixed(6)}, ${l.longitude.toFixed(6)}`,
    geometry: { type: 'Point', coordinates: [l.longitude, l.latitude] },
    style: { markerColor: '#dc2626' },
  }));
}

export function kmlBlob(kmlText) {
  return new Blob([kmlText], { type: 'application/vnd.google-earth.kml+xml' });
}

/** KMZ = ZIP with the KML saved as doc.kml (what Google Earth expects). */
export async function kmzBlob(kmlText) {
  const zip = new JSZip();
  zip.file('doc.kml', kmlText);
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    mimeType: 'application/vnd.google-earth.kmz',
  });
}

export function safeFileName(name) {
  return (name || 'inner-map').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'inner-map';
}

/** Trigger a browser download of a Blob. */
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Bounds { south, west, north, east } of a list of features, or null. */
export function featuresBounds(features) {
  let south = 90;
  let north = -90;
  let west = 180;
  let east = -180;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      west = Math.min(west, c[0]);
      east = Math.max(east, c[0]);
      south = Math.min(south, c[1]);
      north = Math.max(north, c[1]);
    } else c.forEach(visit);
  };
  features.forEach((f) => visit(f.geometry.coordinates));
  if (south > north) return null;
  // Give single points / tiny shapes some size.
  const pad = 0.002;
  return {
    south: Math.max(-90, south - (north - south < pad ? pad : 0)),
    north: Math.min(90, north + (north - south < pad ? pad : 0)),
    west: Math.max(-180, west - (east - west < pad ? pad : 0)),
    east: Math.min(180, east + (east - west < pad ? pad : 0)),
  };
}
