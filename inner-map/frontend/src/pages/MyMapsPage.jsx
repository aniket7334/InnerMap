import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useRegions } from '../hooks/useRegions';
import MapView from '../maps/MapView';
import Alert from '../components/Alert';
import ProgressBar from '../components/ProgressBar';
import { useInitialFit, unionBounds } from '../hooks/useInitialFit';
import { providerForRegion } from '../maps/providers';
import { useMapProvider } from '../hooks/ProviderContext';
import { cancelDownload, deleteRegion, resumeDownload, downloadRoutingData } from '../offline/downloadManager';
import { cleanupOrphanTiles, countStoredTiles } from '../offline/tileStore';
import { listAllRegionIds } from '../offline/regionStore';
import { formatBytes, getStorageEstimate, isPersisted, requestPersistentStorage } from '../offline/storage';
import { listServerMaps, deleteServerMap } from '../services/mapService';
import { errorMessage } from '../services/api';
import { confirmDialog } from '../components/ConfirmDialog';

const STATUS_LABEL = {
  downloading: 'Downloading',
  completed: 'Ready offline',
  partial: 'Partly downloaded',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export default function MyMapsPage() {
  const { user } = useAuth();
  const { status } = useConnectivity();
  const { regions } = useRegions(user.id);
  const { provider: activeProvider, setProviderId } = useMapProvider();
  const [storage, setStorage] = useState(null);
  const [persisted, setPersisted] = useState(false);
  const [tileTotal, setTileTotal] = useState(0);
  const [serverMaps, setServerMaps] = useState(null);
  const [fitTo, setFitTo] = useState(null);
  useInitialFit(unionBounds(regions.map((r) => r.bounds)), setFitTo);
  const [message, setMessage] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const refreshStorage = useCallback(async () => {
    setStorage(await getStorageEstimate());
    setPersisted(await isPersisted());
    setTileTotal(await countStoredTiles());
  }, []);

  const refreshServer = useCallback(async () => {
    try {
      setServerMaps(await listServerMaps());
    } catch {
      setServerMaps(null);
    }
  }, []);

  useEffect(() => {
    refreshStorage();
  }, [refreshStorage, regions.length]);

  useEffect(() => {
    refreshServer();
  }, [refreshServer, status, regions.length]);

  const onDelete = async (r) => {
    if (!(await confirmDialog({ title: 'Delete offline map?', message: `Delete “${r.name}” from this device? You will need internet to download it again.`, confirmLabel: 'Delete', danger: true }))) return;
    setBusyId(r.id);
    try {
      const freed = await deleteRegion(r.id);
      setMessage({ tone: 'success', text: `Deleted “${r.name}”. Freed ${formatBytes(freed)}.` });
      refreshStorage();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    } finally {
      setBusyId(null);
    }
  };

  const onAddRouting = async (r) => {
    setMessage(null);
    try {
      await downloadRoutingData(r.id);
      setMessage({ tone: 'success', text: `Road data for “${r.name}” is ready for offline directions.` });
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    }
  };

  const onResume = async (r) => {
    setMessage(null);
    try {
      await resumeDownload(r.id);
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    }
  };

  const onCleanup = async () => {
    const ids = await listAllRegionIds();
    const { removed, freed } = await cleanupOrphanTiles(ids);
    setMessage({
      tone: 'success',
      text: removed ? `Removed ${removed} unused tile(s), freed ${formatBytes(freed)}.` : 'Storage is already clean.',
    });
    refreshStorage();
  };

  const onPersist = async () => {
    const ok = await requestPersistentStorage();
    setPersisted(ok);
    setMessage({
      tone: ok ? 'success' : 'warning',
      text: ok
        ? 'The browser will keep your offline maps even when storage runs low.'
        : 'The browser declined persistent storage. Installing Inner Map as an app usually allows it.',
    });
  };

  const onForgetServer = async (m) => {
    try {
      await deleteServerMap(m.id);
      refreshServer();
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    }
  };

  const localServerIds = new Set(regions.map((r) => r.serverId).filter(Boolean));
  const elsewhere = (serverMaps || []).filter((m) => !localServerIds.has(m.id));
  const usedPct = storage?.quota ? Math.round((storage.usage / storage.quota) * 100) : null;

  return (
    <div className="workspace page-offline-maps">
      <div className="workspace-map">
        <MapView className="map-fill" regions={regions} fitTo={fitTo} showLocateButton={false} />
      </div>

      <aside className="workspace-panel">
        <header className="panel-header row between">
          <div>
            <h1>Offline maps</h1>
            <p>Areas stored on this device and usable without internet.</p>
          </div>
          <Link to="/download" className="btn btn-primary btn-sm">
            Download area
          </Link>
        </header>

        {message && (
          <Alert tone={message.tone} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        <section className="panel-section">
          <span className="section-label">On this device ({regions.length})</span>
          {regions.length === 0 ? (
            <div className="empty">
              <p>No offline maps yet.</p>
              <p className="small">Download an area while you are online to use it without internet.</p>
              <Link to="/download" className="btn btn-primary btn-sm">
                Download an area
              </Link>
            </div>
          ) : (
            <ul className="item-list">
              {regions.map((r) => {
                const source = providerForRegion(r);
                const canResume =
                  ['interrupted', 'cancelled', 'partial', 'failed'].includes(r.status) && Boolean(source?.offlineAllowed);
                return (
                  <li key={r.id}>
                    <div className="item-row">
                      <span className={`dot dot-${r.status}`} />
                      <button className="item-main" onClick={() => setFitTo({ ...r.bounds })} title="Show on the map">
                        <span className="item-title">{r.name}</span>
                        <span className="item-meta">
                          {STATUS_LABEL[r.status] || r.status} · {formatBytes(r.size)} · zoom {r.zoomMin}–{r.zoomMax}
                          {r.serverId ? '' : ' · not synced'}
                        </span>
                      </button>
                    </div>
                    {r.status !== 'completed' && (
                      <ProgressBar
                        value={r.doneCount}
                        max={r.tileCount}
                        tone={r.status === 'downloading' ? 'primary' : 'warn'}
                        label={`${r.name} progress`}
                      />
                    )}
                    {r.status !== 'completed' && (
                      <p className="item-meta">
                        {r.doneCount.toLocaleString()} of {r.tileCount.toLocaleString()} tiles
                        {r.error ? ` · ${r.error}` : ''}
                      </p>
                    )}
                    {r.missingCount > 0 && (
                      <p className="item-meta">{r.missingCount} tiles have no data on the server (e.g. open sea).</p>
                    )}
                    {source && r.layerId !== activeProvider.layerId && (
                      <p className="warn-text small">
                        Shown when “{source.label}” is the base map.{' '}
                        <button className="link-btn" onClick={() => setProviderId(source.id)}>
                          Switch
                        </button>
                      </p>
                    )}
                    {!source && <p className="warn-text small">Its map source is no longer configured.</p>}
                    <p className="item-meta">
                      Road data for offline directions:{' '}
                      {r.routing?.status === 'completed'
                        ? `ready (${formatBytes(r.routing.bytes)}, ${r.routing.edges.toLocaleString()} road segments)`
                        : r.routing?.status === 'downloading' || r.routing?.status === 'pending'
                          ? 'downloading...'
                          : r.routing?.status === 'failed'
                            ? `failed - ${r.routing.error}`
                            : 'not downloaded'}{' '}
                      {r.status !== 'downloading' &&
                        !['completed', 'downloading', 'pending'].includes(r.routing?.status) &&
                        status === 'online' && (
                          <button className="link-btn" onClick={() => onAddRouting(r)}>
                            {r.routing?.status === 'failed' ? 'Retry' : 'Add'}
                          </button>
                        )}
                    </p>
                    <div className="item-actions">
                      <button className="link-btn" onClick={() => setFitTo({ ...r.bounds })}>
                        Show
                      </button>
                      {r.status === 'downloading' && (
                        <button className="link-btn" onClick={() => cancelDownload(r.id)}>
                          Cancel
                        </button>
                      )}
                      {canResume && (
                        <button className="link-btn" onClick={() => onResume(r)} disabled={status === 'offline'}>
                          Resume
                        </button>
                      )}
                      <button
                        className="link-btn danger-text"
                        onClick={() => onDelete(r)}
                        disabled={busyId === r.id}
                        aria-label={`Delete ${r.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel-section">
          <span className="section-label">Storage</span>
          {storage?.quota ? (
            <>
              <ProgressBar
                value={storage.usage}
                max={storage.quota}
                tone={usedPct > 85 ? 'danger' : 'primary'}
                label="Storage used"
              />
              <p className="small">
                {formatBytes(storage.usage)} used of {formatBytes(storage.quota)} available to Inner Map
              </p>
            </>
          ) : (
            <p className="muted small">This browser does not report storage usage.</p>
          )}
          <dl className="kv small">
            <div>
              <dt>Map tiles</dt>
              <dd>{tileTotal.toLocaleString()} (shared tiles stored once)</dd>
            </div>
            <div>
              <dt>Protected storage</dt>
              <dd>{persisted ? 'On - the browser keeps these maps' : 'Off - the browser may clear them when space is low'}</dd>
            </div>
          </dl>
          <div className="row wrap">
            {!persisted && (
              <button className="btn btn-sm" onClick={onPersist}>
                Protect offline maps
              </button>
            )}
            <button className="btn btn-sm" onClick={onCleanup}>
              Clean up storage
            </button>
          </div>
        </section>

        {elsewhere.length > 0 && (
          <section className="panel-section">
            <span className="section-label">On your other devices</span>
            <p className="muted small">In your account, but not stored on this device.</p>
            <ul className="item-list">
              {elsewhere.map((m) => {
                const q = new URLSearchParams({
                  ...Object.fromEntries(Object.entries(m.region || {}).map(([k, v]) => [k, String(v)])),
                  name: m.mapName,
                  zmin: String(m.zoomMin),
                  zmax: String(m.zoomMax),
                });
                return (
                  <li key={m.id}>
                    <span className="item-title">{m.mapName}</span>
                    <span className="item-meta">
                      {' '}
                      · zoom {m.zoomMin}–{m.zoomMax} · {formatBytes(m.storageSize)}
                    </span>
                    <div className="item-actions">
                      <Link to={`/download?${q}`}>Download here</Link>
                      <button className="link-btn danger-text" onClick={() => onForgetServer(m)}>
                        Remove from account
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
