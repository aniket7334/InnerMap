// Signed-in shell, GIS-style.
//  Desktop: compact toolbar (brand, search, map source, connection) + left sidebar
//           (navigation and the offline maps on this device) + the page, usually a map.
//  Mobile:  toolbar with search on top, the page full-screen, bottom navigation.
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation as useRouterLocation } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useMapProvider } from '../hooks/ProviderContext';
import { useRegions } from '../hooks/useRegions';
import { useFeatureLayers } from '../hooks/useFeatureLayers';
import SearchBox from '../components/SearchBox';
import { warmUpRouting } from '../routing/routingManager';
import Icon from '../components/Icon';
import { gpsState } from '../components/GpsStatus';
import { formatDistance } from '../maps/geo';

const GPS_TEXT = {
  live: 'GPS',
  locating: 'GPS…',
  'last-known': 'GPS last known',
  off: 'GPS off',
  denied: 'GPS blocked',
  unavailable: 'No GPS',
  insecure: 'No GPS',
  unsupported: 'No GPS',
};

/** Compact GPS indicator for the toolbar (details are on the map). */
function ToolbarGps() {
  const { position, fixStatus, locating, errorType, tracking } = useLocation();
  const state = gpsState({ position, fixStatus, locating, errorType, tracking });
  const acc = state === 'live' && position?.accuracy ? ` ±${formatDistance(position.accuracy)}` : '';
  return (
    <span className={`status-item gps gps-${state}`} title={`Location: ${GPS_TEXT[state]}${acc}`} aria-label={`Location: ${GPS_TEXT[state]}${acc}`} role="status">
      <span className={`dot ${state === 'live' ? 'dot-gps' : ['denied', 'unavailable', 'insecure', 'unsupported'].includes(state) ? 'dot-failed' : ''}`} />
      <span className="gps-text">
        {GPS_TEXT[state]}
        {acc}
      </span>
    </span>
  );
}
import { formatBytes, getStorageEstimate } from '../offline/storage';

const NAV = [
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/download', label: 'Download area', icon: 'download' },
  { to: '/my-maps', label: 'Offline maps', icon: 'layers' },
  { to: '/saved', label: 'Saved places', icon: 'pin' },
  { to: '/layers', label: 'Layers & KML', icon: 'path' },
  { to: '/globe', label: '3D globe', icon: 'globe' },
];
const SECONDARY = [
  { to: '/dashboard', label: 'Overview', icon: 'dashboard' },
  { to: '/profile', label: 'Account', icon: 'user' },
  { to: '/settings', label: 'Settings', icon: 'text' },
];
// Bottom navigation on phones: the four most used places plus "More".
const MOBILE = [
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/download', label: 'Download', icon: 'download' },
  { to: '/saved', label: 'Places', icon: 'pin' },
  { to: '/layers', label: 'Layers', icon: 'path' },
];

const STATUS_TEXT = { online: 'Online', limited: 'Server unreachable', offline: 'Offline' };
const REGION_STATUS = {
  completed: 'Ready',
  partial: 'Partial',
  downloading: 'Downloading',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { status, pendingCount, syncNow, syncing } = useConnectivity();
  const { provider } = useMapProvider();
  const { regions } = useRegions(user.id);
  // Pull KML layers and drawings from the account (e.g. made on another device) whenever the
  // server is reachable, so every map in the app shows them - not only the Layers page.
  useFeatureLayers(user.id, { withServerRefresh: true });
  const navigate = useNavigate();
  const routerLocation = useRouterLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [storage, setStorage] = useState(null);
  // Collapsed sidebar = a slim icon rail, giving the map more room (remembered per browser).
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('innermap.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggleSidebar = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('innermap.sidebar', c ? 'expanded' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });

  useEffect(() => setMoreOpen(false), [routerLocation.pathname]);
  // Fetch (and let the service worker cache) the offline routing engine while online.
  useEffect(() => {
    if (navigator.onLine) warmUpRouting();
  }, []);
  useEffect(() => {
    getStorageEstimate().then(setStorage).catch(() => {});
  }, [regions.length]);

  const openRegion = (r) =>
    navigate('/map', { state: { focus: { type: 'bounds', bounds: r.bounds, label: r.name, at: Date.now() } } });

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isMapPage = ['/map', '/globe'].includes(routerLocation.pathname);

  return (
    <div className={`shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <header className="toolbar">
        <button
          type="button"
          className="icon-btn sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          <Icon name="menu" size={18} />
        </button>
        <NavLink to="/map" className="toolbar-brand" aria-label="Inner Map home">
          <img src="/icons/icon.svg" alt="" width="22" height="22" />
          <span>Inner Map</span>
        </NavLink>
        <SearchBox />
        <div className="toolbar-status">
          <ToolbarGps />
          <span className="status-item source" title={provider.description}>
            {provider.label}
          </span>
          <span className={`status-item conn conn-${status}`} title={STATUS_TEXT[status]} role="status">
            <span className="dot" /> <span className="conn-text">{STATUS_TEXT[status]}</span>
          </span>
          {pendingCount > 0 && (
            <button
              type="button"
              className="status-item pending"
              onClick={syncNow}
              disabled={syncing || status !== 'online'}
              title="Changes saved on this device, waiting to be sent to the server"
            >
              {syncing ? 'Syncing...' : `${pendingCount} to sync`}
            </button>
          )}
        </div>
      </header>

      <aside className="sidebar" aria-label="Navigation">
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} title={item.label} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <section className="sidebar-section">
          <div className="sidebar-heading">
            <span>On this device</span>
            {storage?.usage ? <span className="muted">{formatBytes(storage.usage)}</span> : null}
          </div>
          {regions.length === 0 ? (
            <p className="sidebar-empty">
              No offline maps yet. <NavLink to="/download">Download an area</NavLink> to use the map without internet.
            </p>
          ) : (
            <ul className="region-nav">
              {regions.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => openRegion(r)} title={`Show ${r.name} on the map`}>
                    <span className={`dot dot-${r.status}`} />
                    <span className="region-nav-name">{r.name}</span>
                    <span className="region-nav-meta">
                      {r.status === 'downloading'
                        ? `${Math.round((r.doneCount / Math.max(1, r.tileCount)) * 100)}%`
                        : r.status === 'completed'
                          ? formatBytes(r.size)
                          : REGION_STATUS[r.status]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="sidebar-foot">
          {SECONDARY.map((item) => (
            <NavLink key={item.to} to={item.to} title={item.label} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </NavLink>
          ))}
          <div className="sidebar-user">
            <span className="sidebar-user-name">{user.name}</span>
            <button type="button" className="text-btn" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main className={`main ${isMapPage ? 'main-map' : ''}`}>
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="Main">
        {MOBILE.map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) => `bottom-item ${isActive ? 'active' : ''}`}>
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`bottom-item ${moreOpen ? 'active' : ''}`}
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
        >
          <Icon name="menu" size={20} />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
          <div className="more-sheet" role="dialog" aria-label="More">
            {[NAV[2], NAV[5], ...SECONDARY].map((item) => (
              <NavLink key={item.to} to={item.to} className="nav-item">
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </NavLink>
            ))}
            <div className="sheet-status">
              <span className={`status-item conn conn-${status}`}>
                <span className="dot" /> {STATUS_TEXT[status]}
              </span>
              <span className="muted small">Map: {provider.label}</span>
            </div>
            <button type="button" className="nav-item" onClick={handleLogout}>
              <Icon name="logout" size={18} />
              <span>Log out ({user.name})</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
