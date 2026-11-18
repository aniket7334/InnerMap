// Layers & KML: import KML/KMZ/GeoJSON, draw markers/paths/polygons, export KML/KMZ
// and hand files over to Google Earth.
import { useMemo, useRef, useState } from 'react';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useFeatureLayers } from '../hooks/useFeatureLayers';
import { useInitialFit, unionBounds } from '../hooks/useInitialFit';
import { useSavedLocations } from '../hooks/useSavedLocations';
import MapView from '../maps/MapView';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import {
  readGeoFile,
  describeImport,
  buildKml,
  kmlBlob,
  kmzBlob,
  downloadBlob,
  safeFileName,
  savedLocationsToFeatures,
  featuresBounds,
  IMPORT_LIMITS,
} from '../features/kml';
import { prepareForGoogleEarth, GOOGLE_EARTH_WEB } from '../features/googleEarth';
import * as featureService from '../services/featureService';
import { describeGeometry, lineLengthMeters, polygonAreaM2, formatDistance, formatArea } from '../maps/geo';

const COLORS = [
  { value: '#2563eb', label: 'Blue' },
  { value: '#dc2626', label: 'Red' },
  { value: '#15803d', label: 'Green' },
  { value: '#d97706', label: 'Amber' },
  { value: '#7c3aed', label: 'Purple' },
];

const TOOLS = [
  { type: 'Point', label: 'Marker' },
  { type: 'LineString', label: 'Path' },
  { type: 'Polygon', label: 'Polygon' },
];

// 7 decimal places is about 1 cm: more than any click or GPS fix can resolve.
const round7 = (v) => Math.round(v * 1e7) / 1e7;

function sketchGeometry(sketch) {
  const pts = sketch.points.map(([lat, lng]) => [round7(lng), round7(lat)]);
  if (sketch.type === 'Point') return { type: 'Point', coordinates: pts[0] };
  if (sketch.type === 'LineString') return { type: 'LineString', coordinates: pts };
  return { type: 'Polygon', coordinates: [[...pts, pts[0]]] };
}

function sketchMeasure(sketch) {
  const pts = sketch.points.map(([lat, lng]) => [lng, lat]);
  if (sketch.type === 'LineString' && pts.length >= 2) return `Length ${formatDistance(lineLengthMeters(pts))}`;
  if (sketch.type === 'Polygon' && pts.length >= 3) return `Area ${formatArea(polygonAreaM2([[...pts, pts[0]]]))}`;
  return null;
}

function styleFor(type, color) {
  if (type === 'Point') return { markerColor: color };
  if (type === 'LineString') return { stroke: color, strokeWidth: 3 };
  return { stroke: color, strokeWidth: 2, fill: color, fillOpacity: 0.2 };
}

export default function LayersPage() {
  const { user } = useAuth();
  const { status } = useConnectivity();
  const { layers, collections, error: syncError } = useFeatureLayers(user.id, { withServerRefresh: true });
  const { locations } = useSavedLocations(user.id);
  const fileInput = useRef(null);

  const [message, setMessage] = useState(null);
  const [importing, setImporting] = useState(false);
  const [sketch, setSketch] = useState(null); // { type, points, stage: 'drawing'|'naming' }
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState(COLORS[0].value);
  const [fitTo, setFitTo] = useState(null);
  useInitialFit(unionBounds(layers.filter((l) => l.visible).map((l) => l.bounds)), setFitTo);
  const [expanded, setExpanded] = useState(null);
  const [expandedFeatures, setExpandedFeatures] = useState([]);
  const [renaming, setRenaming] = useState(null); // { kind: 'layer'|'feature', localId, name }
  const [earth, setEarth] = useState(null); // { fileName, url, name }

  const online = status !== 'offline';
  const totals = useMemo(
    () => layers.reduce((s, l) => s + (l.featureCount || 0), 0),
    [layers]
  );

  // ---------------------------------------------------------------- import
  const onImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMessage(null);
    setImporting(true);
    try {
      const parsed = await readGeoFile(file);
      const layer = await featureService.importLayer(user.id, {
        name: parsed.name,
        fileName: file.name,
        format: parsed.format,
        features: parsed.features,
      });
      const { found, skipped } = describeImport(parsed.report);
      setMessage({
        tone: 'success',
        text:
          `Imported ${parsed.format} “${layer.name}”: ${found}.` +
          (skipped ? ` Not shown: ${skipped}.` : '') +
          (status === 'online' ? '' : ' Saved on this device; it will sync when you are online.'),
      });
      if (layer.bounds) setFitTo({ ...layer.bounds });
    } catch (err) {
      setMessage({ tone: 'error', text: `${file.name}: ${err.message}` });
    } finally {
      setImporting(false);
    }
  };

  // ---------------------------------------------------------------- drawing
  const startTool = (type) => {
    setSketch({ type, points: [], stage: 'drawing' });
    setDraftName('');
  };

  const onMapClick = (latlng) => {
    if (!sketch || sketch.stage !== 'drawing') return;
    const points = [...sketch.points, [latlng.lat, latlng.lng]];
    setSketch({ ...sketch, points, stage: sketch.type === 'Point' ? 'naming' : 'drawing' });
  };

  const canFinish =
    sketch &&
    ((sketch.type === 'LineString' && sketch.points.length >= 2) || (sketch.type === 'Polygon' && sketch.points.length >= 3));

  const saveSketch = async (e) => {
    e.preventDefault();
    if (!draftName.trim()) return;
    await featureService.addDrawnFeature(user.id, {
      name: draftName,
      geometry: sketchGeometry(sketch),
      style: styleFor(sketch.type, draftColor),
    });
    setSketch(null);
    setMessage({
      tone: 'success',
      text: `Saved “${draftName.trim()}” to My drawings.${status === 'online' ? '' : ' It will sync when you are online.'}`,
    });
  };

  // ---------------------------------------------------------------- layers
  const toggleExpanded = async (layer) => {
    if (expanded === layer.localId) {
      setExpanded(null);
      return;
    }
    setExpanded(layer.localId);
    setExpandedFeatures(await featureService.getLayerFeatures(layer.localId));
  };

  const refreshExpanded = async () => {
    if (expanded) setExpandedFeatures(await featureService.getLayerFeatures(expanded));
  };

  const onDeleteLayer = async (layer) => {
    if (!window.confirm(`Delete the layer “${layer.name}” and its ${layer.featureCount} features?`)) return;
    await featureService.deleteLayer(user.id, layer.localId);
    if (expanded === layer.localId) setExpanded(null);
  };

  const onDeleteFeature = async (f) => {
    if (!window.confirm(`Delete “${f.name || 'this feature'}”?`)) return;
    await featureService.deleteFeature(user.id, f.localId);
    await refreshExpanded();
  };

  const saveRename = async (e) => {
    e.preventDefault();
    if (!renaming.name.trim()) return;
    if (renaming.kind === 'layer') await featureService.renameLayer(user.id, renaming.localId, renaming.name);
    else {
      await featureService.renameFeature(user.id, renaming.localId, renaming.name);
      await refreshExpanded();
    }
    setRenaming(null);
  };

  // ---------------------------------------------------------------- export
  const layerKml = async (layer) =>
    buildKml({
      name: layer.name,
      description: 'Exported from Inner Map',
      folders: [{ name: layer.name, features: await featureService.getLayerFeatures(layer.localId) }],
    });

  const allKml = async () => {
    const folders = [{ name: 'Saved locations', features: savedLocationsToFeatures(locations) }];
    for (const l of layers) folders.push({ name: l.name, features: await featureService.getLayerFeatures(l.localId) });
    return buildKml({ name: 'Inner Map export', description: 'Saved locations and layers from Inner Map', folders });
  };

  const allBounds = async () => {
    const features = [...savedLocationsToFeatures(locations)];
    for (const l of layers) features.push(...(await featureService.getLayerFeatures(l.localId)));
    return featuresBounds(features);
  };

  const download = async (kmlText, name, format) => {
    const base = safeFileName(name);
    if (format === 'kmz') downloadBlob(await kmzBlob(kmlText), `${base}.kmz`);
    else downloadBlob(kmlBlob(kmlText), `${base}.kml`);
  };

  const sendToEarth = async (kmlText, name, bounds) => {
    setEarth(await prepareForGoogleEarth(kmlText, name, bounds));
  };

  const nothingToExport = locations.length === 0 && totals === 0;

  return (
    <div className="workspace">
      <div className="workspace-map">
        <MapView
          className="map-fill"
          featureCollections={collections}
          places={locations}
          sketch={sketch}
          fitTo={fitTo}
          onClick={onMapClick}
        >
          {sketch?.stage === 'drawing' && (
            <div className="map-hint">
              {sketch.type === 'Point'
                ? 'Click the map to place the marker'
                : `Click to add points (${sketch.points.length})${sketchMeasure(sketch) ? ` · ${sketchMeasure(sketch)}` : ''}`}
            </div>
          )}
        </MapView>
      </div>

      <aside className="workspace-panel">
        <header className="panel-header">
          <h1>Layers &amp; KML</h1>
          <p>Import KML, KMZ or GeoJSON, draw markers, paths and polygons, and export them for Google Earth.</p>
        </header>

        {message && (
          <Alert tone={message.tone} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}
        {syncError && status === 'online' && <Alert tone="warning">{syncError}</Alert>}

        {earth && (
          <div className="earth-steps">
            <div className="row between">
              <h3>Open in Google Earth</h3>
              <button className="alert-close" onClick={() => setEarth(null)} aria-label="Close">
                ×
              </button>
            </div>
            <p className="small">
              <strong>{earth.fileName}</strong> was downloaded. Google Earth imports files you choose; it cannot open
              them from Inner Map directly.
            </p>
            <ol className="small">
              <li>
                <strong>Google Earth on the web:</strong> open it below, then <em>Projects → New project → Import KML
                file from computer</em> and choose {earth.fileName}. Without signing in, use <em>Open local KML editor
                → Open KML from device</em>.
              </li>
              <li>
                <strong>Google Earth Pro (desktop):</strong> double-click {earth.fileName}, or use <em>File → Open</em>.
              </li>
            </ol>
            {online ? (
              <a className="btn btn-primary btn-sm" href={earth.url} target="_blank" rel="noopener noreferrer">
                Open Google Earth on the web
              </a>
            ) : (
              <p className="warn-text small">Google Earth on the web needs an internet connection.</p>
            )}
          </div>
        )}

          <div className="panel-section">
            <h3>Import</h3>
            <p className="muted small">
              KML or KMZ (from Google Earth, My Maps or GPS apps) or GeoJSON. Up to{' '}
              {IMPORT_LIMITS.maxFeatures.toLocaleString()} features per file. Works offline.
            </p>
            <input
              ref={fileInput}
              type="file"
              accept=".kml,.kmz,.geojson,.json,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
              onChange={onImport}
              hidden
            />
            <button className="btn btn-ghost" onClick={() => fileInput.current?.click()} disabled={importing}>
              <Icon name="plus" size={14} /> {importing ? 'Reading file...' : 'Choose file...'}
            </button>
          </div>

          <div className="panel-section">
            <h3>Draw</h3>
            {!sketch && (
              <div className="row wrap">
                {TOOLS.map((t) => (
                  <button key={t.type} className="btn btn-ghost btn-sm" onClick={() => startTool(t.type)}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {sketch?.stage === 'drawing' && (
              <div className="stack">
                <p className="small">
                  Drawing a {TOOLS.find((t) => t.type === sketch.type).label.toLowerCase()}.{' '}
                  {sketchMeasure(sketch)}
                </p>
                <div className="row wrap">
                  {sketch.type !== 'Point' && (
                    <>
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!canFinish}
                        onClick={() => setSketch({ ...sketch, stage: 'naming' })}
                      >
                        Finish
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={!sketch.points.length}
                        onClick={() => setSketch({ ...sketch, points: sketch.points.slice(0, -1) })}
                      >
                        Undo point
                      </button>
                    </>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setSketch(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {sketch?.stage === 'naming' && (
              <form className="stack" onSubmit={saveSketch}>
                <p className="muted small">{describeGeometry(sketchGeometry(sketch))}</p>
                <input
                  autoFocus
                  maxLength={255}
                  placeholder="Name"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                />
                <div className="color-row" role="radiogroup" aria-label="Colour">
                  {COLORS.map((c) => (
                    <button
                      type="button"
                      key={c.value}
                      role="radio"
                      aria-checked={draftColor === c.value}
                      aria-label={c.label}
                      className={`swatch ${draftColor === c.value ? 'selected' : ''}`}
                      style={{ background: c.value }}
                      onClick={() => setDraftColor(c.value)}
                    />
                  ))}
                </div>
                <div className="row">
                  <button className="btn btn-primary btn-sm" disabled={!draftName.trim()}>
                    Save
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSketch(null)}>
                    Discard
                  </button>
                </div>
              </form>
            )}
          </div>

          <div className="panel-section">
            <div className="row between">
              <h3>Layers</h3>
              <span className="muted small">{totals.toLocaleString()} features</span>
            </div>
            {layers.length === 0 && <p className="muted small">No layers yet. Import a file or draw something.</p>}
            <ul className="layer-list">
              {layers.map((layer) => (
                <li key={layer.localId}>
                  <div className="layer-row">
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      onChange={(e) => featureService.setLayerVisible(layer.localId, e.target.checked)}
                      aria-label={`Show ${layer.name}`}
                    />
                    {renaming?.kind === 'layer' && renaming.localId === layer.localId ? (
                      <form className="row grow" onSubmit={saveRename}>
                        <input
                          autoFocus
                          maxLength={100}
                          value={renaming.name}
                          onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                        />
                        <button className="btn btn-primary btn-sm">Save</button>
                      </form>
                    ) : (
                      <button className="layer-name" onClick={() => toggleExpanded(layer)}>
                        <strong>{layer.name}</strong>
                        <span className="muted tiny">
                          {layer.featureCount} features · {layer.source === 'drawn' ? 'drawn' : layer.format || 'imported'}
                          {layer.pending || !layer.serverId ? ' · not synced yet' : ''}
                        </span>
                      </button>
                    )}
                  </div>
                  <div className="layer-actions">
                    <button
                      className="link-btn small"
                      disabled={!layer.bounds}
                      onClick={() => layer.bounds && setFitTo({ ...layer.bounds })}
                    >
                      Zoom
                    </button>
                    <button className="link-btn small" onClick={async () => download(await layerKml(layer), layer.name, 'kml')}>
                      KML
                    </button>
                    <button className="link-btn small" onClick={async () => download(await layerKml(layer), layer.name, 'kmz')}>
                      KMZ
                    </button>
                    <button
                      className="link-btn small"
                      disabled={!layer.featureCount}
                      onClick={async () => sendToEarth(await layerKml(layer), layer.name, layer.bounds)}
                    >
                      Google Earth
                    </button>
                    <button
                      className="link-btn small"
                      onClick={() => setRenaming({ kind: 'layer', localId: layer.localId, name: layer.name })}
                    >
                      Rename
                    </button>
                    <button className="link-btn small danger-text" onClick={() => onDeleteLayer(layer)}>
                      Delete
                    </button>
                  </div>
                  {expanded === layer.localId && (
                    <ul className="feature-list">
                      {expandedFeatures.slice(0, 200).map((f) => (
                        <li key={f.localId}>
                          {renaming?.kind === 'feature' && renaming.localId === f.localId ? (
                            <form className="row grow" onSubmit={saveRename}>
                              <input
                                autoFocus
                                maxLength={255}
                                value={renaming.name}
                                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                              />
                              <button className="btn btn-primary btn-sm">Save</button>
                            </form>
                          ) : (
                            <>
                              <button className="feature-name" onClick={() => setFitTo(featuresBounds([f]))}>
                                <span>{f.name || 'Unnamed'}</span>
                                <span className="muted tiny">{describeGeometry(f.geometry)}</span>
                              </button>
                              <span className="row">
                                <button
                                  className="icon-btn"
                                  aria-label={`Rename ${f.name || 'feature'}`}
                                  onClick={() => setRenaming({ kind: 'feature', localId: f.localId, name: f.name || '' })}
                                >
                                  <Icon name="edit" size={14} />
                                </button>
                                <button
                                  className="icon-btn danger"
                                  aria-label={`Delete ${f.name || 'feature'}`}
                                  onClick={() => onDeleteFeature(f)}
                                >
                                  <Icon name="trash" size={14} />
                                </button>
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                      {expandedFeatures.length > 200 && (
                        <li className="muted tiny">Showing 200 of {expandedFeatures.length.toLocaleString()}.</li>
                      )}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="panel-section">
            <h3>Export everything</h3>
            <p className="muted small">
              Saved locations ({locations.length}) and all layers, one folder each. Opens in Google Earth, QGIS and
              most GPS apps.
            </p>
            <div className="row wrap">
              <button className="btn btn-ghost btn-sm" disabled={nothingToExport} onClick={async () => download(await allKml(), 'inner-map-export', 'kml')}>
                Download KML
              </button>
              <button className="btn btn-ghost btn-sm" disabled={nothingToExport} onClick={async () => download(await allKml(), 'inner-map-export', 'kmz')}>
                Download KMZ
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={nothingToExport}
                onClick={async () => sendToEarth(await allKml(), 'inner-map-export', await allBounds())}
              >
                Open in Google Earth
              </button>
            </div>
            <p className="muted tiny">
              Google Earth is a separate app: <a href={GOOGLE_EARTH_WEB} target="_blank" rel="noopener noreferrer">earth.google.com</a>.
              Inner Map never downloads Google imagery.
            </p>
          </div>
      </aside>
    </div>
  );
}
