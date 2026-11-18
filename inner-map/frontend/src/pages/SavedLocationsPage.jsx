import { useState } from 'react';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useSavedLocations } from '../hooks/useSavedLocations';
import MapView from '../maps/MapView';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import { distanceMeters, formatCoord, formatDistance } from '../maps/geo';
import { buildKml, kmlBlob, kmzBlob, downloadBlob, savedLocationsToFeatures, featuresBounds } from '../features/kml';
import { useInitialFit } from '../hooks/useInitialFit';

/** Download the saved places as a Google Earth compatible KML or KMZ file. */
async function exportLocations(locations, format) {
  const kml = buildKml({
    name: 'Inner Map saved locations',
    description: 'Exported from Inner Map',
    folders: [{ name: 'Saved locations', features: savedLocationsToFeatures(locations) }],
  });
  if (format === 'kmz') downloadBlob(await kmzBlob(kml), 'inner-map-saved-locations.kmz');
  else downloadBlob(kmlBlob(kml), 'inner-map-saved-locations.kml');
}

const emptyForm = { name: '', latitude: '', longitude: '' };

export default function SavedLocationsPage() {
  const { user } = useAuth();
  const { status } = useConnectivity();
  const { position, locateOnce } = useLocation();
  const { locations, add, rename, remove, error } = useSavedLocations(user.id);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState(null);
  const [editing, setEditing] = useState(null); // { localId, name }
  const [fitTo, setFitTo] = useState(null);
  useInitialFit(locations.length ? featuresBounds(savedLocationsToFeatures(locations)) : null, setFitTo);
  const [notice, setNotice] = useState(null);

  const fillFromGps = async () => {
    setFormError(null);
    try {
      const p = position || (await locateOnce());
      setForm((f) => ({ ...f, latitude: p.lat.toFixed(6), longitude: p.lng.toFixed(6) }));
    } catch {
      setFormError('Could not get your GPS position. Check the location permission.');
    }
  };

  const onMapClick = (latlng) =>
    setForm((f) => ({ ...f, latitude: latlng.lat.toFixed(6), longitude: latlng.lng.toFixed(6) }));

  const submit = async (e) => {
    e.preventDefault();
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!form.name.trim()) return setFormError('Give the place a name.');
    if (form.latitude === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return setFormError('Latitude must be between -90 and 90.');
    }
    if (form.longitude === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return setFormError('Longitude must be between -180 and 180.');
    }
    setFormError(null);
    await add({ name: form.name, latitude: lat, longitude: lng });
    setForm(emptyForm);
    setNotice(status === 'online' ? 'Place saved.' : 'Saved on this device - it will sync when you are online.');
  };

  const saveRename = async (e) => {
    e.preventDefault();
    if (!editing.name.trim()) return;
    await rename(editing.localId, editing.name);
    setEditing(null);
  };

  const onDelete = async (loc) => {
    if (!window.confirm(`Delete “${loc.name}”?`)) return;
    await remove(loc.localId);
  };

  const focus = (loc) => {
    const d = 0.004;
    setFitTo({ south: loc.latitude - d, north: loc.latitude + d, west: loc.longitude - d, east: loc.longitude + d });
  };

  const draftPlace =
    form.latitude !== '' && form.longitude !== '' && Number.isFinite(Number(form.latitude)) && Number.isFinite(Number(form.longitude))
      ? [{ localId: 'draft', name: form.name || 'New place', latitude: Number(form.latitude), longitude: Number(form.longitude), pending: true }]
      : [];

  return (
    <div className="workspace">
      <div className="workspace-map">
        <MapView className="map-fill" places={[...locations, ...draftPlace]} fitTo={fitTo} onClick={onMapClick} />
      </div>

      <aside className="workspace-panel">
        <header className="panel-header">
          <h1>Saved places</h1>
          <p>Stored on this device and in your account. Changes made offline sync later.</p>
        </header>
        {error && status === 'online' && <Alert tone="error">{error}</Alert>}
        {notice && (
          <Alert tone="success" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}

        <section className="panel-section">
          <span className="section-label">Add a place</span>
          <form className="stack" onSubmit={submit} noValidate>
            <label className="field">
              <span>Name</span>
              <input
                maxLength={100}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Trailhead parking"
              />
            </label>
            <div className="row two">
              <label className="field">
                <span>Latitude</span>
                <input
                  className="mono"
                  inputMode="decimal"
                  value={form.latitude}
                  onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Longitude</span>
                <input
                  className="mono"
                  inputMode="decimal"
                  value={form.longitude}
                  onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                />
              </label>
            </div>
            <p className="muted small">Click the map to fill in the coordinates, or use your GPS position.</p>
            {formError && <p className="error-text small">{formError}</p>}
            <div className="row wrap">
              <button className="btn btn-primary btn-sm">Save place</button>
              <button type="button" className="btn btn-sm" onClick={fillFromGps}>
                <Icon name="crosshair" size={14} /> Use my location
              </button>
            </div>
          </form>
        </section>

        <section className="panel-section">
          <div className="row between">
            <span className="section-label">Places ({locations.length})</span>
            {locations.length > 0 && (
              <span className="row small">
                Export
                <button className="link-btn" onClick={() => exportLocations(locations, 'kml')}>
                  KML
                </button>
                <button className="link-btn" onClick={() => exportLocations(locations, 'kmz')}>
                  KMZ
                </button>
              </span>
            )}
          </div>
          {locations.length === 0 ? (
            <p className="muted small">No saved places yet.</p>
          ) : (
            <ul className="item-list">
              {locations.map((loc) => (
                <li key={loc.localId}>
                  {editing?.localId === loc.localId ? (
                    <form className="row" onSubmit={saveRename}>
                      <input
                        autoFocus
                        maxLength={100}
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      />
                      <button className="btn btn-primary btn-sm">Save</button>
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <div className="item-row">
                      <button className="item-main" onClick={() => focus(loc)} title="Show on the map">
                        <span className="item-title">{loc.name}</span>
                        <span className="item-meta">
                          <span className="mono">
                            {formatCoord(loc.latitude, 5)}, {formatCoord(loc.longitude, 5)}
                          </span>
                          {position &&
                            ` · ${formatDistance(distanceMeters(position.lat, position.lng, loc.latitude, loc.longitude))} away`}
                          {loc.pending && ' · waiting to sync'}
                        </span>
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => setEditing({ localId: loc.localId, name: loc.name })}
                        aria-label={`Rename ${loc.name}`}
                        title="Rename"
                      >
                        <Icon name="edit" size={15} />
                      </button>
                      <button
                        className="icon-btn danger"
                        onClick={() => onDelete(loc)}
                        aria-label={`Delete ${loc.name}`}
                        title="Delete"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
