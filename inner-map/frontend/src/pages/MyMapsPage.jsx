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
import { boundsAreaKm2 } from '../maps/tileMath';
import { useMapProvider } from '../hooks/ProviderContext';
import { cancelDownload, deleteRegion, resumeDownload, downloadRoutingData, pauseDownload, addPacks, removePack, isDownloading, PACKS } from '../offline/downloadManager';
import { cleanupOrphanTiles, countStoredTiles } from '../offline/tileStore';
import { listAllRegionIds } from '../offline/regionStore';
import { formatBytes, getStorageEstimate, isPersisted, requestPersistentStorage } from '../offline/storage';
import { listServerMaps, deleteServerMap } from '../services/mapService';
import { errorMessage } from '../services/api';
import { confirmDialog } from '../components/ConfirmDialog';
import { subscribePending } from '../offline/syncService';

const STATUS_LABEL = {
  downloading: 'Downloading',
  completed: 'Ready offline',
  partial: 'Partly downloaded',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
  failed: 'Failed',
  paused: 'Paused',
  pending: 'Waiting',
};

const coverageText = (b) => {
  const lat = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'N' : 'S'}`;
  const lng = (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? 'E' : 'W'}`;
  return `${lat(b.south)}–${lat(b.north)}, ${lng(b.west)}–${lng(b.east)}`;
};

/** One small chip per kind of offline data an area holds. */
function dataChips(r, source) {
  const out = [];
  const state = (st) => (st === 'completed' ? 'ok' : st === 'downloading' || st === 'building' || st === 'pending' ? 'busy' : st ? 'bad' : '');
  out.push({ label: 'Map', cls: state(r.status) });
  if (source?.kind === 'vector') out.push({ label: r.search?.status === 'completed' ? `Search · ${r.search.count.toLocaleString()}` : 'Search', cls: state(r.search?.status) });
  out.push({ label: 'Road data', cls: state(r.routing?.status) });
  for (const id of Object.keys(PACKS)) out.push({ label: PACKS[id].label.replace(' (elevation)', ''), cls: state(r.packs?.[id]?.status) });
  return out;
}

const totalSize = (r) => (r.size || 0) + Object.values(r.packs || {}).reduce((n, p) => n + (p.size || 0), 0) + (r.routing?.bytes || 0);

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
  const [selected, setSelected] = useState(() => new Set());

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
  // Queued changes (e.g. a deletion) reach the server a moment later: refresh the account list then.
  useEffect(() => subscribePending(() => refreshServer()), [refreshServer]);

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

  const toggleSelected = (id) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onDeleteSelected = async () => {
    const list = regions.filter((r) => selected.has(r.id));
    if (!list.length) return;
    const ok = await confirmDialog({
      title: `Delete ${list.length} offline map${list.length > 1 ? 's' : ''}?`,
      message: `${list.map((r) => `“${r.name}”`).join(', ')} will be removed from this device, with their satellite, terrain, road and search data. Data shared with other downloaded areas is kept. You will need internet to download them again.`,
      confirmLabel: 'Delete selected',
      danger: true,
    });
    if (!ok) return;
    let freed = 0;
    for (const r of list) {
      setBusyId(r.id);
      try {
        freed += await deleteRegion(r.id);
      } catch (err) {
        setMessage({ tone: 'error', text: `${r.name}: ${err.message}` });
      }
    }
    setBusyId(null);
    setSelected(new Set());
    setMessage({ tone: 'success', text: `Deleted ${list.length} area(s). Freed ${formatBytes(freed)}.` });
    refreshStorage();
  };

  const onAddPack = async (r, packId) => {
    setMessage(null);
    try {
      await addPacks(r.id, [packId]);
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
    }
  };

  const onRemovePack = async (r, packId) => {
    const ok = await confirmDialog({
      title: `Remove ${PACKS[packId].label.toLowerCase()}?`,
      message: `The ${PACKS[packId].label.toLowerCase()} of “${r.name}” will be deleted from this device. The map itself stays.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      const freed = await removePack(r.id, packId);
      setMessage({ tone: 'success', text: `Removed. Freed ${formatBytes(freed)}.` });
      refreshStorage();
    } catch (err) {
      setMessage({ tone: 'error', text: err.message });
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
          <div className="row between list-head">
            <span className="section-label">On this device ({regions.length})</span>
            {regions.length > 1 && (
              <label className="check small">
                <input
                  type="checkbox"
                  checked={selected.size === regions.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(regions.map((r) => r.id)) : new Set())}
                />
                Select all
              </label>
            )}
          </div>
          {selected.size > 0 && (
            <div className="bulk-bar" role="region" aria-label="Selected maps">
              <span>{selected.size} selected</span>
              <button type="button" className="btn btn-sm btn-danger-soft" onClick={onDeleteSelected} disabled={Boolean(busyId)}>
                Delete selected
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </div>
          )}
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
                const running = isDownloading(r.id);
                const packEntries = Object.entries(r.packs || {});
                const packsUnfinished = packEntries.some(([, p]) => p.status !== 'completed');
                const canResume =
                  !running &&
                  Boolean(source?.offlineAllowed) &&
                  (['interrupted', 'cancelled', 'partial', 'failed', 'paused'].includes(r.status) || (r.status === 'completed' && packsUnfinished));
                const retry = r.status === 'failed' || r.status === 'partial' || packEntries.some(([, p]) => ['failed', 'partial'].includes(p.status));
                return (
                  <li key={r.id}>
                    <div className="region-card-head">
                      {regions.length > 1 && (
                        <input
                          type="checkbox"
                          className="item-check"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelected(r.id)}
                          aria-label={`Select ${r.name}`}
                        />
                      )}
                      <button className="item-main" onClick={() => setFitTo({ ...r.bounds })} title="Show this area on the map">
                        <span className="item-title">{r.name}</span>
                        <span className="region-card-meta">
                          <span>{coverageText(r.bounds)}</span>
                          <span>{Math.round(boundsAreaKm2(r.bounds)).toLocaleString()} km²</span>
                          <span>{formatBytes(totalSize(r))}</span>
                          <span>Downloaded {new Date(r.createdAt).toLocaleDateString()}</span>
                          <span>
                            zoom {r.zoomMin}–{r.zoomMax}
                          </span>
                          {!r.serverId && <span>not synced</span>}
                        </span>
                      </button>
                      <span className={`chip chip-${r.status} status-chip`}>{STATUS_LABEL[r.status] || r.status}</span>
                    </div>
                    <div className="region-chips" aria-label="Offline data in this area">
                      {dataChips(r, source).map((c) => (
                        <span key={c.label} className={`region-chip ${c.cls}`}>
                          {c.cls === 'ok' ? '✓ ' : ''}
                          {c.label}
                        </span>
                      ))}
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
                        ? `ready (${formatBytes(r.routing.bytes)}, ${r.routing.edges.toLocaleString()} road segments${(r.routing.profiles || []).includes('motorcycle') ? '' : '; no motorcycle routing - update it'})`
                        : r.routing?.status === 'downloading' || r.routing?.status === 'pending'
                          ? 'downloading...'
                          : r.routing?.status === 'failed'
                            ? `failed - ${r.routing.error}`
                            : 'not downloaded'}{' '}
                      {r.routing?.status === 'completed' && !(r.routing.profiles || []).includes('motorcycle') && status === 'online' && (
                        <button className="link-btn" onClick={() => onAddRouting(r)}>
                          Update
                        </button>
                      )}
                      {r.status !== 'downloading' &&
                        !['completed', 'downloading', 'pending'].includes(r.routing?.status) &&
                        status === 'online' && (
                          <button className="link-btn" onClick={() => onAddRouting(r)}>
                            {r.routing?.status === 'failed' ? 'Retry' : 'Add'}
                          </button>
                        )}
                    </p>
                    {source?.kind === 'vector' && (
                      <p className="item-meta">
                        Offline search:{' '}
                        {r.search?.status === 'completed'
                          ? `${r.search.count.toLocaleString()} places, streets and businesses`
                          : r.search?.status === 'building'
                            ? 'preparing…'
                            : r.search?.status === 'failed'
                              ? `failed - ${r.search.error}`
                              : r.status === 'completed' || r.status === 'partial'
                                ? 'waiting'
                                : 'after the map is downloaded'}
                      </p>
                    )}
                    {Object.keys(PACKS).map((packId) => {
                      const p = r.packs?.[packId];
                      const def = PACKS[packId];
                      return (
                        <div key={packId} className="pack-line">
                          <span className="item-meta">
                            {def.label}:{' '}
                            {!p
                              ? 'not downloaded'
                              : p.status === 'completed'
                                ? `ready (${formatBytes(p.size)}, zoom ${p.zoomMin}–${p.zoomMax}${p.missingCount ? `, ${p.missingCount} tiles without data` : ''})`
                                : p.status === 'downloading'
                                  ? `downloading ${p.doneCount.toLocaleString()} / ${p.tileCount.toLocaleString()}`
                                  : `${STATUS_LABEL[p.status] || p.status} (${p.doneCount.toLocaleString()} / ${p.tileCount.toLocaleString()})${p.error ? ` - ${p.error}` : ''}`}
                          </span>
                          {!running && !p && r.status === 'completed' && status === 'online' && def.source.offlineAllowed && (
                            <button className="link-btn" onClick={() => onAddPack(r, packId)}>
                              Add
                            </button>
                          )}
                          {!running && p && (
                            <button className="link-btn danger-text" onClick={() => onRemovePack(r, packId)}>
                              Remove
                            </button>
                          )}
                          {p?.status === 'downloading' && <ProgressBar value={p.doneCount} max={p.tileCount} label={`${r.name} ${def.label}`} />}
                        </div>
                      );
                    })}
                    <div className="item-actions">
                      <button className="link-btn" onClick={() => setFitTo({ ...r.bounds })}>
                        Show
                      </button>
                      {running && (
                        <>
                          <button className="link-btn" onClick={() => pauseDownload(r.id)}>
                            Pause
                          </button>
                          <button className="link-btn" onClick={() => cancelDownload(r.id)}>
                            Cancel
                          </button>
                        </>
                      )}
                      {canResume && (
                        <button className="link-btn" onClick={() => onResume(r)} disabled={status === 'offline'}>
                          {retry ? 'Retry' : 'Resume'}
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
