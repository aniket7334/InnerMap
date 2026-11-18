import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import * as authService from '../services/authService';
import { listHistory, clearHistory } from '../services/historyService';
import { errorMessage } from '../services/api';
import Alert from '../components/Alert';
import { formatCoord, formatDistance } from '../maps/geo';

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const { status } = useConnectivity();
  const online = status === 'online';

  const [profile, setProfile] = useState({ name: user.name, email: user.email });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [msg, setMsg] = useState(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [history, setHistory] = useState(null);

  useEffect(() => setProfile({ name: user.name, email: user.email }), [user.name, user.email]);

  const loadHistory = useCallback(async () => {
    if (!online || !user.locationHistoryEnabled) return;
    try {
      setHistory(await listHistory(50));
    } catch {
      setHistory(null);
    }
  }, [online, user.locationHistoryEnabled]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const run = async (fn, success) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: 'success', text: success });
    } catch (err) {
      setMsg({ tone: 'error', text: errorMessage(err) });
    }
  };

  const saveProfile = (e) => {
    e.preventDefault();
    run(async () => {
      updateUser(await authService.updateProfile({ name: profile.name.trim(), email: profile.email.trim() }));
    }, 'Profile updated.');
  };

  const changePassword = (e) => {
    e.preventDefault();
    if (pw.newPassword.length < 8) return setMsg({ tone: 'error', text: 'New password must be at least 8 characters.' });
    if (pw.newPassword !== pw.confirm) return setMsg({ tone: 'error', text: 'New passwords do not match.' });
    return run(async () => {
      await authService.updateProfile({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
    }, 'Password changed.');
  };

  const setHistoryEnabled = (enabled) =>
    run(async () => {
      updateUser(await authService.updateProfile({ locationHistoryEnabled: enabled }));
      setConsentOpen(false);
      setConsentChecked(false);
      if (!enabled) setHistory(null);
    }, enabled ? 'Location history is on. Points are recorded only while tracking is running.' : 'Location history is off.');

  const deleteHistory = () => {
    if (!window.confirm('Delete your whole location history from the server? This cannot be undone.')) return;
    run(async () => {
      const n = await clearHistory();
      setHistory([]);
      return n;
    }, 'Location history deleted.');
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>Account</h1>
          <p className="muted">Member since {new Date(user.createdAt).toLocaleDateString()}</p>
        </div>
      </div>
      {!online && <Alert tone="warning">Profile changes need a connection to the Inner Map server.</Alert>}
      {msg && (
        <Alert tone={msg.tone} onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      <section className="card">
        <h3>Account details</h3>
        <form className="stack" onSubmit={saveProfile}>
          <label className="field">
            <span>Name</span>
            <input value={profile.name} maxLength={100} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
          </label>
          <button className="btn btn-primary" disabled={!online}>
            Save changes
          </button>
        </form>
      </section>

      <section className="card">
        <h3>Change password</h3>
        <form className="stack" onSubmit={changePassword}>
          <label className="field">
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={pw.currentPassword}
              onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            />
          </label>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={pw.newPassword}
              onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            />
          </label>
          <button className="btn btn-primary" disabled={!online || !pw.currentPassword || !pw.newPassword}>
            Change password
          </button>
        </form>
      </section>

      <section className="card">
        <h3>Location history</h3>
        <p className="small">
          Status: <strong>{user.locationHistoryEnabled ? 'On' : 'Off'}</strong>
        </p>
        <p className="muted small">
          Off by default. Live tracking on the map works without it - your position stays on this device.
        </p>

        {!user.locationHistoryEnabled && !consentOpen && (
          <button className="btn btn-ghost" onClick={() => setConsentOpen(true)} disabled={!online}>
            Turn on location history...
          </button>
        )}

        {consentOpen && (
          <div className="consent">
            <h4>Before you turn this on</h4>
            <ul>
              <li>
                While GPS tracking is running, Inner Map will store your coordinates, their accuracy and the time on the
                Inner Map server, roughly every 20 m moved or once a minute.
              </li>
              <li>Location history reveals where you live, work and travel. Anyone with access to your account can see it.</li>
              <li>Points recorded offline are kept on this device and uploaded when you reconnect.</li>
              <li>You can turn this off at any time and delete all stored history below.</li>
            </ul>
            <label className="check">
              <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} />I
              understand and want Inner Map to store my location history.
            </label>
            <div className="row">
              <button className="btn btn-primary" disabled={!consentChecked || !online} onClick={() => setHistoryEnabled(true)}>
                Turn on
              </button>
              <button className="btn btn-ghost" onClick={() => setConsentOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {user.locationHistoryEnabled && (
          <div className="row wrap">
            <button className="btn btn-ghost" onClick={() => setHistoryEnabled(false)} disabled={!online}>
              Turn off
            </button>
            <button className="btn btn-danger-soft" onClick={deleteHistory} disabled={!online}>
              Delete all history
            </button>
          </div>
        )}

        {history && history.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Latitude</th>
                  <th>Longitude</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.recordedAt).toLocaleString()}</td>
                    <td>{formatCoord(h.latitude, 5)}</td>
                    <td>{formatCoord(h.longitude, 5)}</td>
                    <td>{h.accuracy ? `± ${formatDistance(h.accuracy)}` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted tiny">Showing the latest {history.length} points.</p>
          </div>
        )}
        {history && history.length === 0 && user.locationHistoryEnabled && (
          <p className="muted small">No history recorded yet. Start tracking on the map to record points.</p>
        )}
      </section>
    </div>
  );
}
