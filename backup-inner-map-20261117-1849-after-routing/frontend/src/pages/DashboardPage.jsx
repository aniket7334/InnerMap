// Overview: the state of the app at a glance, as plain status rows (no big numbers).
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useRegions } from '../hooks/useRegions';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { useFeatureLayers } from '../hooks/useFeatureLayers';
import { useMapProvider } from '../hooks/ProviderContext';
import MapView from '../maps/MapView';
import LocationPanel from '../components/LocationPanel';
import ProgressBar from '../components/ProgressBar';
import { formatBytes, getStorageEstimate, isPersisted } from '../offline/storage';

const CONNECTION = {
  online: 'Online - map data and sync available',
  limited: 'Internet works, but the Inner Map server is not responding. Changes are kept on this device.',
  offline: 'Offline - using maps and data stored on this device',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const { status, pendingCount, syncNow, syncing } = useConnectivity();
  const { position, tracking } = useLocation();
  const { regions } = useRegions(user.id);
  const { locations } = useSavedLocations(user.id);
  const { layers } = useFeatureLayers(user.id);
  const { provider } = useMapProvider();
  const [storage, setStorage] = useState(null);
  const [persisted, setPersisted] = useState(false);

  useEffect(() => {
    getStorageEstimate().then(setStorage);
    isPersisted().then(setPersisted);
  }, [regions.length]);

  const ready = regions.filter((r) => r.status === 'completed' || r.status === 'partial');
  const active = regions.find((r) => r.status === 'downloading');
  const offlineBytes = regions.reduce((s, r) => s + (r.size || 0), 0);
  const featureCount = layers.reduce((s, l) => s + (l.featureCount || 0), 0);
  const fitTo = useMemo(() => (!position && ready[0] ? ready[0].bounds : null), [position, ready[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>Signed in as {user.name}</p>
        </div>
        <Link to="/map" className="btn btn-primary">
          Open map
        </Link>
      </div>

      <div className="overview">
        <div className="overview-main">
          <section className="section">
            <div className="section-head">
              <h2>Status</h2>
            </div>
            <div className="section-body">
              <dl className="kv">
                <div>
                  <dt>Connection</dt>
                  <dd>
                    <span className={`status-item conn conn-${status}`}>
                      <span className="dot" /> {CONNECTION[status]}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Base map</dt>
                  <dd>
                    {provider.label}{' '}
                    <span className="muted small">
                      ({provider.offlineAllowed ? 'downloadable' : 'online only'})
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Waiting to sync</dt>
                  <dd className="row">
                    {pendingCount ? `${pendingCount} change(s)` : 'Nothing - everything is saved to your account'}
                    {pendingCount > 0 && (
                      <button className="link-btn" onClick={syncNow} disabled={syncing || status !== 'online'}>
                        {syncing ? 'Syncing...' : 'Sync now'}
                      </button>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <h2>Offline data on this device</h2>
              <Link to="/my-maps" className="small">
                Manage
              </Link>
            </div>
            <div className="section-body">
              <dl className="kv">
                <div>
                  <dt>Offline maps</dt>
                  <dd>
                    {ready.length
                      ? `${ready.map((r) => r.name).join(', ')} (${formatBytes(offlineBytes)})`
                      : 'None yet'}{' '}
                    {!ready.length && <Link to="/download">Download an area</Link>}
                  </dd>
                </div>
                {active && (
                  <div>
                    <dt>Downloading</dt>
                    <dd>
                      {active.name}
                      <ProgressBar value={active.doneCount} max={active.tileCount} label="Download progress" />
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Browser storage</dt>
                  <dd>
                    {storage?.quota
                      ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)} used`
                      : 'Not reported by this browser'}
                    {' · '}
                    {persisted ? 'protected' : 'not protected'}
                  </dd>
                </div>
                <div>
                  <dt>Saved places</dt>
                  <dd>
                    <Link to="/saved">{locations.length}</Link>
                  </dd>
                </div>
                <div>
                  <dt>Layers</dt>
                  <dd>
                    <Link to="/layers">
                      {layers.length} layer{layers.length === 1 ? '' : 's'}, {featureCount} feature
                      {featureCount === 1 ? '' : 's'}
                    </Link>
                  </dd>
                </div>
              </dl>
            </div>
          </section>

          <section className="section">
            <div className="section-body overview-location">
              <LocationPanel compact />
            </div>
          </section>
        </div>

        <div className="overview-map section">
          <MapView
            className="map-fill"
            initialCenter={position ? [position.lat, position.lng] : undefined}
            initialZoom={position ? 14 : undefined}
            fitTo={fitTo}
            places={locations}
            regions={regions}
            follow={tracking}
            showCoordinates={false}
          />
        </div>
      </div>
    </div>
  );
}
