// GPS status on the map (bottom-left): always visible, so the user can see at a glance
// whether the position is live, last known, being searched for, or unavailable - and why.
// Position comes from the device (navigator.geolocation), so this works without internet.
import { useState } from 'react';
import { useLocation } from '../hooks/LocationContext';
import { formatCoord, formatDistance } from '../maps/geo';

export function formatAge(ms) {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export const QUALITY_TEXT = {
  good: 'Good GPS accuracy',
  fair: 'Fair accuracy',
  poor: 'Weak signal: the position may come from Wi-Fi or mobile networks. Move to open sky for GPS.',
  unknown: 'Accuracy not reported',
};

const PROBLEM_TITLE = {
  denied: 'Location blocked',
  unavailable: 'Location unavailable',
  timeout: 'Still searching for GPS',
  insecure: 'Location needs https',
  unsupported: 'No location support',
};

const DENIED_HELP =
  'Location access is blocked for this site. Click the lock or location icon in the address bar (or your phone’s site settings), allow Location, then press Retry.';

/** The state the chip shows, in order of importance. */
export function gpsState({ position, fixStatus, locating, errorType, tracking }) {
  if (errorType && errorType !== 'timeout' && fixStatus !== 'live') return errorType;
  if (fixStatus === 'live') return 'live';
  if (locating || (tracking && errorType === 'timeout')) return 'locating';
  if (position) return 'last-known';
  return 'off';
}

export default function GpsStatus({ onLocate }) {
  const { position, fixStatus, quality, ageMs, tracking, locating, error, errorType } = useLocation();
  const [open, setOpen] = useState(false);
  const state = gpsState({ position, fixStatus, locating, errorType, tracking });
  const problem = ['denied', 'unavailable', 'insecure', 'unsupported'].includes(state);

  let label;
  if (state === 'live') label = 'Live GPS';
  else if (state === 'locating') label = errorType === 'timeout' ? PROBLEM_TITLE.timeout : 'Finding your location…';
  else if (state === 'last-known') label = 'Last known';
  else if (state === 'off') label = 'Location off';
  else label = PROBLEM_TITLE[state];

  return (
    <div className={`gps-readout gps-${state}`} aria-live="polite">
      <div className="gps-readout-row">
        <button type="button" className="gps-readout-main" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="GPS details">
          {state === 'locating' ? <span className="gps-spinner" aria-hidden="true" /> : <span className={`dot ${state === 'live' ? 'dot-gps' : problem ? 'dot-failed' : ''}`} />}
          <span className="gps-state">{label}</span>
          {position && state !== 'locating' && (
            <span className="mono gps-coords">
              {formatCoord(position.lat, 6)}, {formatCoord(position.lng, 6)}
            </span>
          )}
          {position?.accuracy && (state === 'live' || state === 'last-known') ? (
            <span className={`acc acc-${quality}`} title={QUALITY_TEXT[quality]}>
              ± {formatDistance(position.accuracy)}
            </span>
          ) : null}
        </button>
        {(problem || state === 'off' || state === 'last-known') && state !== 'insecure' && state !== 'unsupported' && (
          <button type="button" className="gps-action" onClick={onLocate}>
            {state === 'off' ? 'Show my location' : problem ? 'Retry' : 'Update'}
          </button>
        )}
      </div>
      {open && (
        <dl className="gps-details">
          {position && (
            <>
              <div>
                <dt>Latitude</dt>
                <dd className="mono">{position.lat.toFixed(6)}</dd>
              </div>
              <div>
                <dt>Longitude</dt>
                <dd className="mono">{position.lng.toFixed(6)}</dd>
              </div>
              <div>
                <dt>Accuracy</dt>
                <dd>{position.accuracy ? `± ${Math.round(position.accuracy)} m - ${QUALITY_TEXT[quality]}` : 'Not reported'}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>
                  {new Date(position.timestamp).toLocaleTimeString()} ({formatAge(ageMs)})
                </dd>
              </div>
              {typeof position.altitude === 'number' && (
                <div>
                  <dt>Altitude</dt>
                  <dd>
                    {Math.round(position.altitude)} m{position.altitudeAccuracy ? ` (± ${Math.round(position.altitudeAccuracy)} m)` : ''}
                  </dd>
                </div>
              )}
              {typeof position.speed === 'number' && position.speed > 0.5 && (
                <div>
                  <dt>Speed</dt>
                  <dd>{Math.round(position.speed * 3.6)} km/h</dd>
                </div>
              )}
            </>
          )}
          <div>
            <dt>Status</dt>
            <dd>
              {state === 'live' && 'Live position from this device. Works without internet.'}
              {state === 'locating' && (errorType === 'timeout' ? error : 'Waiting for the first fix from the device…')}
              {state === 'last-known' &&
                (tracking
                  ? 'No new fix for a while (signal lost?). Showing your last known position.'
                  : position?.restored
                    ? 'Saved from your last session. Press Update for your current position.'
                    : 'Live updates are off. Press Update or start tracking.')}
              {state === 'off' && 'Location has not been requested yet.'}
              {state === 'denied' && DENIED_HELP}
              {(state === 'unavailable' || state === 'insecure' || state === 'unsupported') && error}
            </dd>
          </div>
        </dl>
      )}
      {problem && !open && state !== 'denied' && error && <p className="gps-problem">{error}</p>}
      {state === 'denied' && !open && <p className="gps-problem">{DENIED_HELP}</p>}
    </div>
  );
}

/** One-time explanation shown before the browser's permission prompt. */
export function GpsStartupPrompt({ onAllow, onDismiss }) {
  return (
    <div className="gps-intro" role="dialog" aria-labelledby="gps-intro-title">
      <div className="gps-intro-text">
        <strong id="gps-intro-title">Show your location on the map?</strong>
        <span>
          Inner Map uses your device’s GPS to centre the map on you and for directions. It works without internet. Your browser will ask for
          permission.
        </span>
      </div>
      <div className="gps-intro-actions">
        <button type="button" className="btn btn-primary" onClick={onAllow}>
          Use my location
        </button>
        <button type="button" className="btn" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
