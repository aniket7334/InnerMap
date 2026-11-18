import { useCallback, useEffect, useState } from 'react';
import * as locationService from '../services/locationService';
import { subscribe } from '../offline/connectivity';
import { errorMessage } from '../services/api';

export function useSavedLocations(userId) {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadCached = useCallback(async () => {
    if (!userId) return;
    setLocations(await locationService.getCachedLocations(userId));
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      setLocations(await locationService.refreshLocations(userId));
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not refresh saved places'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadCached().then(refresh);
    return subscribe((s) => s.apiReachable && refresh());
  }, [loadCached, refresh]);

  const add = useCallback(
    async (data) => {
      await locationService.addLocation(userId, data);
      await loadCached();
    },
    [userId, loadCached]
  );

  const rename = useCallback(
    async (localId, name) => {
      await locationService.renameLocation(userId, localId, name);
      await loadCached();
    },
    [userId, loadCached]
  );

  const remove = useCallback(
    async (localId) => {
      await locationService.deleteLocation(userId, localId);
      await loadCached();
    },
    [userId, loadCached]
  );

  return { locations, loading, error, add, rename, remove, refresh, reloadLocal: loadCached };
}
