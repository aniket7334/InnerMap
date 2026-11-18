// Current GPS position read-out with start/stop tracking controls.
import { useLocation } from '../hooks/LocationContext';
import { formatCoord, formatDistance } from '../maps/geo';
import Icon from './Icon';

export default function LocationPanel({ compact = false, actions = null }) {
  const { supported, position, error, tracking, permission, startTracking, stopTracking } = useLocation();

  return (
    <div className={`location-panel ${compact ? 'compact' : ''}`}>
      <div className="location-panel-head">
        <div>
          <h3>Current location</h3>
          <span className={`tracking-state ${tracking ? 'on' : ''}`}>
            {tracking ? 'Tracking live' : 'Tracking stopped'}
          </span>
        </div>
        {supported && (
          <button
            type="button"
            className={`btn ${tracking ? 'btn-danger-soft' : 'btn-primary'} btn-sm`}
            onClick={tracking ? stopTracking : startTracking}
          >
            <Icon name={tracking ? 'stop' : 'play'} size={14} />
            {tracking ? 'Stop' : 'Start tracking'}
          </button>
        )}
      </div>

      {!supported && <p className="error-text">This browser does not support location services.</p>}
      {error && <p className={tracking ? 'warn-text' : 'error-text'}>{error}</p>}
      {permission === 'denied' && !error && (
        <p className="error-text">Location access is blocked for this site. Allow it in your browser settings.</p>
      )}
      {permission === 'prompt' && !position && !error && (
        <p className="muted small">
          Your browser will ask for permission to use your location. Inner Map uses it only to show you on the map
          {` `}and never uploads it unless you turn on location history in your profile.
        </p>
      )}

      <dl className="coord-grid">
        <div>
          <dt>Latitude</dt>
          <dd>{position ? formatCoord(position.lat) : '-'}</dd>
        </div>
        <div>
          <dt>Longitude</dt>
          <dd>{position ? formatCoord(position.lng) : '-'}</dd>
        </div>
        <div>
          <dt>Accuracy</dt>
          <dd>{position?.accuracy ? `± ${formatDistance(position.accuracy)}` : '-'}</dd>
        </div>
        {!compact && (
          <>
            <div>
              <dt>Altitude</dt>
              <dd>{typeof position?.altitude === 'number' ? `${Math.round(position.altitude)} m` : '-'}</dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>{typeof position?.speed === 'number' ? `${(position.speed * 3.6).toFixed(1)} km/h` : '-'}</dd>
            </div>
            <div>
              <dt>Last fix</dt>
              <dd>{position ? new Date(position.timestamp).toLocaleTimeString() : '-'}</dd>
            </div>
          </>
        )}
      </dl>
      {actions}
    </div>
  );
}
