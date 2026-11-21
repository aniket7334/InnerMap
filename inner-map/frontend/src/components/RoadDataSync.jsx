// Road data follows the map: whenever the app is online and the Inner Map server is reachable,
// every downloaded map that has no road data yet gets it in the background (one at a time),
// for the areas the server has road data for. Offline directions then simply work - no need to
// remember "Add road data". Renders nothing.
import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { useRegions } from '../hooks/useRegions';
import { fetchRoutingInfo } from '../services/routingApi';
import { downloadRoutingData } from '../offline/downloadManager';

const RETRY_AFTER_MS = 10 * 60 * 1000; // a map whose road data could not be fetched: try again later

const overlaps = (a, b) => a && b && a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;

export default function RoadDataSync() {
  const { user } = useAuth();
  const { status } = useConnectivity();
  const { regions } = useRegions(user?.id);
  const busy = useRef(false);
  const tried = useRef(new Map()); // region id -> time of the last failed try

  useEffect(() => {
    if (!user || status !== 'online' || busy.current) return;
    const missing = regions.filter(
      (r) =>
        (r.status === 'completed' || r.status === 'partial') &&
        r.routing?.status !== 'completed' &&
        r.routing?.status !== 'downloading' &&
        !(tried.current.get(r.id) > Date.now() - RETRY_AFTER_MS)
    );
    if (!missing.length) return;
    busy.current = true;
    (async () => {
      try {
        const info = await fetchRoutingInfo();
        const coverage = info?.offline?.coverage || (info?.offline?.available && info.offline.bounds ? [info.offline.bounds] : []);
        for (const r of missing) {
          if (!coverage.some((c) => overlaps(c, r.bounds))) continue; // no road data on the server for this map (yet)
          try {
            await downloadRoutingData(r.id);
          } catch (err) {
            tried.current.set(r.id, Date.now());
            console.warn('[roads]', r.name, err.message);
          }
        }
      } catch (err) {
        console.warn('[roads] routing info', err.message);
      } finally {
        busy.current = false;
      }
    })();
  }, [user, status, regions]);

  return null;
}
