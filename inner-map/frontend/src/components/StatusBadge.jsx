import { useConnectivity } from '../hooks/ConnectivityContext';
import Icon from './Icon';

const LABELS = {
  online: { text: 'Online', title: 'Connected to the internet and the Inner Map server' },
  limited: { text: 'Server unreachable', title: 'Network is up but the Inner Map server is not responding' },
  offline: { text: 'Offline', title: 'No internet connection - using downloaded maps and cached data' },
};

export default function StatusBadge({ compact = false }) {
  const { status, pendingCount } = useConnectivity();
  const { text, title } = LABELS[status];
  return (
    <span className={`status-badge status-${status}`} title={title} role="status">
      <Icon name={status === 'offline' ? 'wifiOff' : 'wifi'} size={15} />
      {!compact && <span>{text}</span>}
      {pendingCount > 0 && (
        <span className="status-pending" title={`${pendingCount} change(s) waiting to sync`}>
          {pendingCount}
        </span>
      )}
    </span>
  );
}
