// Connection: the Online / Offline mode switch, and a short notice whenever the app changes
// between online and offline - by itself (the connection dropped or came back) or because the
// user switched offline mode.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import Icon from './Icon';
import { openOfflineCenter, skipNextModeOpen } from '../offline/offlineCenterEvents';
import '../styles/connection.css';

/** Pill that shows the connection and switches offline mode on and off. */
export function OfflineModeToggle({ className = '' }) {
  const { status, offlineMode, setOfflineMode } = useConnectivity();
  const { user } = useAuth();
  const navigate = useNavigate();
  const label = offlineMode ? 'Offline mode' : status === 'offline' ? 'Offline' : status === 'limited' ? 'Server unreachable' : 'Online';
  const title = offlineMode
    ? 'Offline mode is on: InnerMap uses only maps and places stored on this device. Click to see what works offline, or to go online.'
    : status === 'offline'
      ? 'No internet connection - InnerMap is using the maps and places stored on this device.'
      : 'Switch to offline mode (uses only data stored on this device).';
  // online: switch offline mode on (its screen opens by itself); offline: show the Offline mode screen
  const onClick = () => {
    if (offlineMode || status === 'offline') return openOfflineCenter();
    // going offline: signed in, show the maps on this device (Offline maps); otherwise the
    // Offline mode screen explains what works
    if (user) {
      skipNextModeOpen();
      setOfflineMode(true);
      return navigate('/my-maps');
    }
    return setOfflineMode(true);
  };
  return (
    <button
      type="button"
      className={`conn-toggle conn-${offlineMode ? 'forced' : status} ${className}`}
      onClick={onClick}
      aria-pressed={offlineMode}
      aria-haspopup="dialog"
      title={title}
    >
      <span className="conn-toggle-dot" aria-hidden="true" />
      <Icon name={offlineMode || status === 'offline' ? 'wifiOff' : 'wifi'} size={15} />
      <span className="conn-toggle-text">{label}</span>
    </button>
  );
}

export default function ConnectionNotice() {
  const { online, offlineMode, networkOnline, setOfflineMode } = useConnectivity();
  const prev = useRef({ online, offlineMode, networkOnline });
  const [notice, setNotice] = useState(null); // { tone, title, text, action }

  useEffect(() => {
    const p = prev.current;
    prev.current = { online, offlineMode, networkOnline };
    // offline now: the Offline mode screen says so - drop any earlier "back online" notice
    if (offlineMode || !networkOnline) {
      setNotice(null);
      return undefined;
    }
    let next = null;
    // going offline is shown by the Offline mode screen (OfflineCenter); this only says when we are back
    if (!offlineMode && p.offlineMode) {
      next = { tone: 'on', title: 'Back online', text: 'Online maps, search, weather and directions are available again.' };
    } else if (!offlineMode && !p.networkOnline && networkOnline) {
      next = { tone: 'on', title: 'Back online', text: 'The connection is back.' };
    }
    if (!next) return undefined;
    setNotice(next);
    const t = setTimeout(() => setNotice(null), 5500);
    return () => clearTimeout(t);
  }, [online, offlineMode, networkOnline]);

  if (!notice) return null;
  return (
    <div className={`conn-notice tone-${notice.tone}`} role="status" aria-live="polite">
      <span className="conn-notice-icon">
        <Icon name={notice.tone === 'off' ? 'wifiOff' : 'wifi'} size={18} />
      </span>
      <div className="conn-notice-text">
        <strong>{notice.title}</strong>
        <span>{notice.text}</span>
      </div>
      {notice.tone === 'off' && offlineMode && (
        <button type="button" onClick={() => setOfflineMode(false)}>
          Go online
        </button>
      )}
      <button type="button" className="conn-notice-close" onClick={() => setNotice(null)} aria-label="Dismiss">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
