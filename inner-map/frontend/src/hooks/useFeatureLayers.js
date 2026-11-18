// Live list of the user's feature layers and the visible ones' features.
import { useCallback, useEffect, useState } from 'react';
import { getVisibleCollections, listLayers, refreshLayers } from '../services/featureService';
import { subscribe } from '../offline/connectivity';

export function useFeatureLayers(userId, { withServerRefresh = false } = {}) {
  const [layers, setLayers] = useState([]);
  const [collections, setCollections] = useState([]);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!userId) {
      setLayers([]);
      setCollections([]);
      return;
    }
    const [l, c] = await Promise.all([listLayers(userId), getVisibleCollections(userId)]);
    setLayers(l);
    setCollections(c);
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      await refreshLayers(userId);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not refresh layers from the server');
    }
    await reload();
  }, [userId, reload]);

  useEffect(() => {
    reload();
    const onChange = () => reload();
    window.addEventListener('innermap:features-changed', onChange);
    let unsub = () => {};
    if (withServerRefresh) {
      refresh();
      unsub = subscribe((s) => s.apiReachable && refresh());
    }
    return () => {
      window.removeEventListener('innermap:features-changed', onChange);
      unsub();
    };
  }, [reload, refresh, withServerRefresh]);

  return { layers, collections, reload, refresh, error };
}
