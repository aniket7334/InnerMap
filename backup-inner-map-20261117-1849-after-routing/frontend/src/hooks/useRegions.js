// Live list of this user's downloaded areas, including progress of a running download.
import { useCallback, useEffect, useState } from 'react';
import { listRegions } from '../offline/regionStore';
import { subscribeDownloads, recoverInterruptedDownloads } from '../offline/downloadManager';

export function useRegions(userId) {
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!userId) {
      setRegions([]);
      setLoading(false);
      return;
    }
    await recoverInterruptedDownloads(userId);
    setRegions(await listRegions(userId));
    setLoading(false);
  }, [userId]);

  // Reload when a record changes outside a download (e.g. sync stored its server id).
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener('innermap:regions-changed', onChanged);
    return () => window.removeEventListener('innermap:regions-changed', onChanged);
  }, [reload]);

  useEffect(() => {
    reload();
    return subscribeDownloads((r) => {
      if (r.deleted) {
        setRegions((rs) => rs.filter((x) => x.id !== r.id));
        return;
      }
      if (r.userId !== userId) return;
      setRegions((rs) => {
        const i = rs.findIndex((x) => x.id === r.id);
        if (i === -1) return [r, ...rs];
        const copy = [...rs];
        copy[i] = { ...copy[i], ...r };
        return copy;
      });
    });
  }, [reload, userId]);

  return { regions, loading, reload };
}
