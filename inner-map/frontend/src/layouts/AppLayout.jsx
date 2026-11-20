// Signed-in shell.
//  Desktop: dark navigation sidebar (Workspace / Your library, offline card, settings, user menu)
//           + a light top bar (breadcrumb, search on non-map pages, GPS, sync, connection,
//           light/dark switch) + the page. On the map page the search floats on the map.
//  Mobile:  compact top bar, the page full-screen, bottom navigation + "More" sheet.
import { useEffect, useRef, useState } from 'react';
import { currentTheme, setTheme } from '../theme';
import { NavLink, Outlet, useNavigate, useLocation as useRouterLocation } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useLocation } from '../hooks/LocationContext';
import { useMapProvider } from '../hooks/ProviderContext';
import { useRegions } from '../hooks/useRegions';
import { useFeatureLayers } from '../hooks/useFeatureLayers';
import SearchBox from '../components/SearchBox';
import { warmUpRouting } from '../routing/routingManager';
import { ensureSearchIndexes } from '../offline/downloadManager';
import Icon from '../components/Icon';
import { OfflineModeToggle } from '../components/ConnectionNotice';
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

// Sidebar groups. "Route planner" opens the Directions panel on the map.
const WORKSPACE = [
  { to: '/map', label: 'Map explorer', icon: 'map', end: true },
  { to: '/map', label: 'Route planner', icon: 'route2', state: { openDirections: true }, route: true },
  { to: '/download', label: 'Download area', icon: 'download' },
  { to: '/', label: 'Earth', icon: 'globe', end: true },
];
const LIBRARY = [
  { to: '/saved', label: 'Saved places', icon: 'pin' },
  { to: '/my-maps', label: 'Offline maps', icon: 'layers' },
  { to: '/dashboard', label: 'Overview', icon: 'dashboard' },
  { to: '/profile', label: 'Account & history', icon: 'history' },
];
const NAV = [...WORKSPACE.filter((n) => !n.route), ...LIBRARY];
const SECONDARY = [{ to: '/settings', label: 'Settings', icon: 'settings' }];
const PAGE_TITLE = {
  '/map': ['Workspace', 'Map explorer'],
  '/download': ['Workspace', 'Download area'],
  '/saved': ['Your library', 'Saved places'],
  '/my-maps': ['Your library', 'Offline maps'],
  '/dashboard': ['Your library', 'Overview'],
  '/profile': ['Your library', 'Account & history'],
  '/settings': ['Account', 'Settings'],
  '/layers': ['Your library', 'Layers'],
};
// Bottom navigation on phones: the four most used places plus "More".
// (The Layers & KML page is no longer in the navigation; its data and the /layers address remain.)
const MOBILE = [
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/download', label: 'Download', icon: 'download' },
  { to: '/saved', label: 'Places', icon: 'pin' },
  { to: '/my-maps', label: 'Offline', icon: 'layers' },
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
  // Offline search: index downloaded areas that have no index yet (on the device, no network).
  useEffect(() => {
    ensureSearchIndexes(user.id).catch((e) => console.warn('[search]', e.message));
  }, [user.id, regions.length]);
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

  const [title0, title1] = PAGE_TITLE[routerLocation.pathname] || ['Workspace', 'Inner Map'];
  const totalSize = regions.reduce((n, r) => n + (r.size || 0), 0);
  const [theme, setThemeState] = useState(currentTheme);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };
  const [userMenu, setUserMenu] = useState(false);
  const userRef = useRef(null);
  useEffect(() => {
    if (!userMenu) return undefined;
    const close = (e) => userRef.current && !userRef.current.contains(e.target) && setUserMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [userMenu]);
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const navLink = (item) => (
    <NavLink
      key={item.label}
      to={item.to}
      end={item.end}
      state={item.state}
      title={item.label}
      className={({ isActive }) =>
        `nav-item ${
          isActive && (item.route ? Boolean(routerLocation.state?.openDirections) : !(item.end && routerLocation.state?.openDirections)) ? 'active' : ''
        }`
      }
    >
      <Icon name={item.icon} size={18} />
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <div className={`shell ${collapsed ? 'sidebar-collapsed' : ''} ${isMapPage ? 'shell-map' : ''}`}>
      <aside className="sidebar" aria-label="Navigation">
        <NavLink to="/" className="sidebar-brand" aria-label="InnerMap Earth">
          <img src="/icons/icon.svg" alt="" width="28" height="28" />
          <span>
            Inner<strong>Map</strong>
          </span>
        </NavLink>

        <nav className="nav" aria-label="Workspace">
          <span className="nav-group-label">Workspace</span>
          {WORKSPACE.map(navLink)}
          <span className="nav-group-label">Your library</span>
          {LIBRARY.map(navLink)}
        </nav>

        <section className="sidebar-offline">
          <span className="sidebar-offline-icon" aria-hidden="true">
            <Icon name="cloudDown" size={18} />
          </span>
          <strong>Explore offline</strong>
          <p>
            {regions.length
              ? `${regions.length} offline map${regions.length === 1 ? '' : 's'} · ${formatBytes(totalSize)}${storage?.usage ? ` (${formatBytes(storage.usage)} used)` : ''}`
              : 'Your maps, even without internet.'}
          </p>
          {regions.slice(0, 3).map((r) => (
            <button key={r.id} type="button" className="sidebar-region" onClick={() => openRegion(r)} title={`Show ${r.name} on the map`}>
              <span className={`dot dot-${r.status}`} />
              <span className="sidebar-region-name">{r.name}</span>
              <span className="sidebar-region-meta">
                {r.status === 'downloading'
                  ? `${Math.round((r.doneCount / Math.max(1, r.tileCount)) * 100)}%`
                  : r.status === 'completed'
                    ? formatBytes(r.size)
                    : REGION_STATUS[r.status]}
              </span>
            </button>
          ))}
          <NavLink to={regions.length > 3 ? '/my-maps' : '/download'} className="sidebar-offline-link">
            {regions.length > 3 ? 'All offline maps' : 'Download a map'} <Icon name="external" size={13} />
          </NavLink>
        </section>

        <div className="sidebar-foot">
          {SECONDARY.map(navLink)}
          <div className="sidebar-user" ref={userRef}>
            <button type="button" className="sidebar-user-btn" onClick={() => setUserMenu((o) => !o)} aria-expanded={userMenu} title={user.name}>
              <span className="avatar" aria-hidden="true">
                {initials}
              </span>
              <span className="sidebar-user-text">
                <span className="sidebar-user-name">{user.name}</span>
                <span className="sidebar-user-sub">Personal workspace</span>
              </span>
              <Icon name="chevronDown" size={16} />
            </button>
            {userMenu && (
              <div className="user-menu" role="menu">
                <NavLink to="/profile" role="menuitem" onClick={() => setUserMenu(false)}>
                  <Icon name="user" size={16} /> Account
                </NavLink>
                <button type="button" role="menuitem" onClick={handleLogout}>
                  <Icon name="logout" size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <header className="toolbar">
        <button
          type="button"
          className="icon-btn sidebar-toggle"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          <Icon name="sidebar" size={18} />
        </button>
        <NavLink to="/map" className="toolbar-brand" aria-label="Inner Map home">
          <img src="/icons/icon.svg" alt="" width="24" height="24" />
        </NavLink>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <span>{title0}</span>
          <Icon name="chevron" size={14} />
          <strong aria-current="page">{title1}</strong>
        </nav>
        {!isMapPage && <SearchBox />}
        <div className="toolbar-status">
          <ToolbarGps />
          {pendingCount > 0 && (
            <button
              type="button"
              className="status-item pending"
              onClick={syncNow}
              disabled={syncing || status !== 'online'}
              title="Changes saved on this device, waiting to be sent to the server"
            >
              {syncing ? 'Syncing…' : `${pendingCount} to sync`}
            </button>
          )}
          <OfflineModeToggle />
          <button type="button" className="icon-btn theme-toggle" onClick={toggleTheme} title={theme === 'dark' ? 'Light appearance' : 'Dark appearance'} aria-label={theme === 'dark' ? 'Switch to light appearance' : 'Switch to dark appearance'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
          </button>
        </div>
      </header>

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
            <span className="sheet-handle" aria-hidden="true" />
            {[WORKSPACE[1], ...NAV.filter((n) => !MOBILE.some((m) => m.to === n.to)), ...SECONDARY].map((item) => (
              <NavLink key={item.label} to={item.to} state={item.state} className="nav-item">
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </NavLink>
            ))}
            <div className="sheet-status">
              <span className={`status-pill conn-${status}`}>
                <span className="dot" /> {STATUS_TEXT[status]}
              </span>
              <span className="muted small">Map: {provider.label}</span>
              <button type="button" className="icon-btn theme-toggle" onClick={toggleTheme} aria-label="Switch appearance">
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
              </button>
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
