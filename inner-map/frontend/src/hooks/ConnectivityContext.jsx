import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getConnectivity, subscribe, startConnectivityMonitor, checkNow, setOfflineMode } from '../offline/connectivity';
import { subscribePending, getPendingCount, flushOutbox, startSync } from '../offline/syncService';
import { useAuth } from './AuthContext';

const ConnectivityContext = createContext(null);

export function ConnectivityProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState(getConnectivity());
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    startConnectivityMonitor();
    startSync();
    const unsub = subscribe((s) => setState({ ...s }));
    const unsubPending = subscribePending(setPendingCount);
    return () => {
      unsub();
      unsubPending();
    };
  }, []);

  useEffect(() => {
    getPendingCount(user?.id).then(setPendingCount);
  }, [user?.id]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      await checkNow();
      await flushOutbox();
    } finally {
      setSyncing(false);
    }
  }, []);

  const status = !state.online ? 'offline' : state.apiReachable ? 'online' : 'limited';

  return (
    <ConnectivityContext.Provider value={{ ...state, status, pendingCount, syncing, syncNow, setOfflineMode }}>
      {children}
    </ConnectivityContext.Provider>
  );
}

export function useConnectivity() {
  const ctx = useContext(ConnectivityContext);
  if (!ctx) throw new Error('useConnectivity must be used inside ConnectivityProvider');
  return ctx;
}
