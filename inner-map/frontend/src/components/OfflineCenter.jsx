// Offline mode screen: what Inner Map can do right now without internet, the maps stored on
// this device (and which have newer data on the server), saved places waiting to sync, and
// storage. It opens by itself when the user switches offline mode on or the connection drops,
// and from the Online / Offline pill (event "innermap:offline-center").
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useRegions } from '../hooks/useRegions';
import { getCachedLocations } from '../services/locationService';
import { checkNow } from '../offline/connectivity';
import { formatBytes, getStorageEstimate } from '../offline/storage';
import { getCachedManifest, refreshManifest, regionsWithUpdates } from '../offline/offlineManifest';
import { OPEN_OFFLINE_CENTER, takeSkipModeOpen } from '../offline/offlineCenterEvents';
import Icon from './Icon';
import '../styles/offline.css';


function ago(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString();
}

const USABLE = new Set(['completed', 'partial']);
const NEEDS_INTERNET = [
  { icon: 'globe', label: 'Satellite imagery outside your downloads' },
  { icon: 'search', label: 'Searching places worldwide' },
  { icon: 'route', label: 'Directions outside your downloads' },
  { icon: 'cloudSun', label: 'Weather' },
  { icon: 'photo', label: 'Photos of places' },
  { icon: 'traffic', label: 'Live traffic' },
];

export default function OfflineCenter() {
  const { user } = useAuth();
  const { online, offlineMode, networkOnline, pendingCount, setOfflineMode } = useConnectivity();
  const { regions } = useRegions(user?.id);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(null); // 'mode' | 'nonet' | 'manual'
  const [places, setPlaces] = useState(null);
  const [storage, setStorage] = useState(null);
  const [manifest, setManifest] = useState(getCachedManifest);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(null); // result of "Try again": 'still' | null
  const prev = useRef({ offlineMode, networkOnline, first: true });

  const show = useCallback((why) => {
    setReason(why);
    setChecked(null);
    setOpen(true);
  }, []);

  // open when offline mode is switched on, or the connection drops (or is missing at start)
  useEffect(() => {
    const p = prev.current;
    prev.current = { offlineMode, networkOnline, first: false };
    if (p.first) {
      if (!networkOnline && !offlineMode) show('nonet');
      return;
    }
    if (offlineMode && !p.offlineMode) {
      if (!takeSkipModeOpen()) show('mode'); // the Offline button went to Offline maps instead
    }
    else if (!offlineMode && p.networkOnline && !networkOnline) show('nonet');
    else if (networkOnline && !p.networkOnline && reason === 'nonet') setOpen(false); // connection back
    else if (!offlineMode && p.offlineMode && reason === 'mode') setOpen(false); // went online
  }, [offlineMode, networkOnline]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onOpen = () => show('manual');
    window.addEventListener(OPEN_OFFLINE_CENTER, onOpen);
    return () => window.removeEventListener(OPEN_OFFLINE_CENTER, onOpen);
  }, [show]);

  // keep the server manifest fresh while online (remembered for offline use)
  useEffect(() => {
    if (online) refreshManifest().then((m) => m && setManifest(m));
  }, [online]);

  // what is on this device (read when the screen opens)
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    if (user?.id) getCachedLocations(user.id).then((l) => live && setPlaces(l.length)).catch(() => {});
    getStorageEstimate().then((s) => live && setStorage(s)).catch(() => {});
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      live = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, user?.id, regions.length]);

  if (!open) return null;

  const maps = regions.filter((r) => USABLE.has(r.status));
  const downloading = regions.filter((r) => r.status === 'downloading');
  const mapBytes = maps.reduce((n, r) => n + (r.size || 0) + (r.routing?.bytes || 0), 0);
  const withRoads = maps.filter((r) => r.routing?.status === 'completed').length;
  const withSearch = maps.filter((r) => r.search?.status === 'completed').length;
  const updates = regionsWithUpdates(maps, manifest);

  const mode = offlineMode ? 'mode' : !networkOnline ? 'nonet' : 'online';
  const hero = {
    mode: {
      title: 'Offline mode',
      text: 'Inner Map is using only what is stored on this device. Nothing is downloaded or sent until you go online.',
    },
    nonet: {
      title: 'You are offline',
      text: 'No internet connection. Inner Map switched to the maps, places and road data stored on this device.',
    },
    online: {
      title: 'Ready for offline?',
      text: 'Here is what works without internet. Switch offline mode on to use only data stored on this device.',
    },
  }[mode];

  const tryAgain = async () => {
    setChecking(true);
    setChecked(null);
    const s = await checkNow();
    setChecking(false);
    if (!s.networkOnline) setChecked('still');
  };
  const go = (to, state) => {
    setOpen(false);
    navigate(to, state ? { state } : undefined);
  };
  const viewRegion = (r) => go('/map', { focus: { type: 'bounds', bounds: r.bounds, label: r.name, at: Date.now() } });

  const ready = [
    {
      icon: 'layers',
      label: 'Offline maps',
      value: maps.length ? `${maps.length} area${maps.length === 1 ? '' : 's'}` : 'None yet',
      sub: maps.length ? formatBytes(mapBytes) : 'Download a map first',
      ok: maps.length > 0,
    },
    {
      icon: 'route',
      label: 'Directions',
      value: withRoads ? `${withRoads} area${withRoads === 1 ? '' : 's'}` : 'Not available',
      sub: withRoads ? 'Drive, cycle and walk' : 'Download with road data',
      ok: withRoads > 0,
    },
    {
      icon: 'search',
      label: 'Search',
      value: withSearch ? `${withSearch} area${withSearch === 1 ? '' : 's'}` : 'Not available',
      sub: withSearch ? 'Places in your downloads' : 'Built after a download',
      ok: withSearch > 0,
    },
    {
      icon: 'pin',
      label: 'Saved places',
      value: user ? (places == null ? '…' : `${places}`) : 'Sign in',
      sub: pendingCount ? `${pendingCount} change${pendingCount === 1 ? '' : 's'} to sync` : user ? 'All synced' : 'Saved on your account',
      ok: Boolean(user && places),
    },
  ];

  return (
    <div className="oc-root" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <aside className={`oc-sheet oc-${mode}`} role="dialog" aria-modal="true" aria-labelledby="oc-title">
        <header className="oc-hero">
          <button type="button" className="oc-close" onClick={() => setOpen(false)} aria-label="Close">
            <Icon name="close" size={18} />
          </button>
          <div className="oc-hero-icon" aria-hidden="true">
            <span className="oc-ring" />
            <span className="oc-ring r2" />
            <Icon name={mode === 'online' ? 'cloudDown' : 'wifiOff'} size={26} />
          </div>
          <h2 id="oc-title">{hero.title}</h2>
          <p>{hero.text}</p>
          <div className="oc-hero-actions">
            {mode === 'mode' && (
              <button type="button" className="oc-btn primary" onClick={() => setOfflineMode(false)} disabled={!networkOnline}>
                <Icon name="wifi" size={16} /> {networkOnline ? 'Go online' : 'No connection to go online'}
              </button>
            )}
            {mode === 'nonet' && (
              <button type="button" className="oc-btn primary" onClick={tryAgain} disabled={checking}>
                <Icon name="refresh" size={16} className={checking ? 'oc-spin' : ''} /> {checking ? 'Checking…' : 'Try again'}
              </button>
            )}
            {mode === 'online' && (
              <button type="button" className="oc-btn primary" onClick={() => setOfflineMode(true)}>
                <Icon name="wifiOff" size={16} /> Turn on offline mode
              </button>
            )}
            <button type="button" className="oc-btn ghost" onClick={() => setOpen(false)}>
              {maps.length ? 'Continue offline' : 'Close'}
            </button>
          </div>
          {checked === 'still' && <p className="oc-hint">Still no connection. Check Wi-Fi or mobile data - offline features keep working meanwhile.</p>}
        </header>

        <div className="oc-body">
          <section>
            <h3>Works offline</h3>
            <div className="oc-ready">
              {ready.map((r) => (
                <div key={r.label} className={`oc-tile ${r.ok ? 'ok' : ''}`}>
                  <span className="oc-tile-icon">
                    <Icon name={r.icon} size={18} />
                    {r.ok && (
                      <i className="oc-tick">
                        <Icon name="check" size={10} />
                      </i>
                    )}
                  </span>
                  <span className="oc-tile-label">{r.label}</span>
                  <strong>{r.value}</strong>
                  <small>{r.sub}</small>
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="oc-section-head">
              <h3>Your offline maps</h3>
              {user && maps.length > 0 && (
                <button type="button" className="oc-link" onClick={() => go('/my-maps')}>
                  Manage
                </button>
              )}
            </div>
            {!user ? (
              <div className="oc-empty">
                <Icon name="user" size={22} />
                <div>
                  <strong>Sign in to keep maps offline</strong>
                  <span>Downloaded maps belong to your account on this device. Signing in needs internet.</span>
                </div>
              </div>
            ) : maps.length === 0 ? (
              <div className="oc-empty">
                <Icon name="download" size={22} />
                <div>
                  <strong>No offline maps yet</strong>
                  <span>{online ? 'Download a city or area to use it with no internet.' : 'Connect to the internet to download a map.'}</span>
                </div>
                {online && (
                  <button type="button" className="oc-btn small" onClick={() => go('/download')}>
                    Download
                  </button>
                )}
              </div>
            ) : (
              <ul className="oc-maps">
                {maps.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="oc-map" onClick={() => viewRegion(r)} title={`Open ${r.name} on the map`}>
                      <span className="oc-map-thumb" aria-hidden="true">
                        <Icon name="map" size={18} />
                      </span>
                      <span className="oc-map-text">
                        <strong>{r.name}</strong>
                        <small>
                          {formatBytes(r.size || 0)} map{r.routing?.bytes ? ` + ${formatBytes(r.routing.bytes)} roads` : ''} · downloaded {ago(r.createdAt)}
                          {r.status === 'partial' ? ' · some tiles missing' : ''}
                        </small>
                        <span className="oc-chips">
                          <em className={r.routing?.status === 'completed' ? 'on' : ''}>Directions</em>
                          <em className={r.search?.status === 'completed' ? 'on' : ''}>Search</em>
                          {updates.has(r.id) && <em className="upd">Update available</em>}
                        </span>
                      </span>
                      <Icon name="arrowRight" size={16} className="oc-map-go" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {downloading.length > 0 && (
              <p className="oc-note">
                {downloading.length} download{downloading.length === 1 ? ' is' : 's are'} not finished. {online ? 'Open Offline maps to follow or resume them.' : 'Resume from Offline maps when you are back online.'}
              </p>
            )}
            {updates.size > 0 && (
              <p className="oc-note">
                Newer map data is on the server for {updates.size} area{updates.size === 1 ? '' : 's'}. {online ? 'Download it again from Offline maps to update.' : 'Update when you are back online.'}
              </p>
            )}
          </section>

          <section>
            <h3>Needs internet</h3>
            <ul className="oc-needs">
              {NEEDS_INTERNET.map((n) => (
                <li key={n.label}>
                  <Icon name={n.icon} size={15} />
                  {n.label}
                </li>
              ))}
            </ul>
          </section>

          {storage?.quota ? (
            <section className="oc-storage">
              <div className="oc-section-head">
                <h3>Storage on this device</h3>
                <span>
                  {formatBytes(storage.usage)} of {formatBytes(storage.quota)}
                </span>
              </div>
              <div className="oc-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(1.5, Math.min(100, (storage.usage / storage.quota) * 100))}%` }} />
              </div>
            </section>
          ) : null}

          <p className="oc-foot">
            {manifest?.at ? `Server map data checked ${ago(manifest.at)}.` : 'Server map data has not been checked yet.'} Offline mode is remembered on this device.
          </p>
        </div>
      </aside>
    </div>
  );
}
