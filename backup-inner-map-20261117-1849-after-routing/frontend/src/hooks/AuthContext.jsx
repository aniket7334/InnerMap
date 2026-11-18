import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as authService from '../services/authService';
import { getToken, getSessionUser, saveSession, clearSession } from '../services/authStorage';
import { isApiReachable, subscribe } from '../offline/connectivity';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Start from the cached session so the app opens offline.
  const [user, setUser] = useState(() => (getToken() ? getSessionUser() : null));

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const applySession = useCallback(({ token, user: u }) => {
    saveSession(token, u);
    setUser(u);
    return u;
  }, []);

  const login = useCallback(async (creds) => applySession(await authService.login(creds)), [applySession]);
  const register = useCallback(async (data) => applySession(await authService.register(data)), [applySession]);

  const updateUser = useCallback((u) => {
    saveSession(null, u);
    setUser(u);
  }, []);

  // Refresh the profile whenever the server becomes reachable.
  const refreshProfile = useCallback(async () => {
    if (!getToken() || !isApiReachable()) return;
    try {
      updateUser(await authService.fetchProfile());
    } catch {
      /* 401 is handled by the unauthorized listener below */
    }
  }, [updateUser]);

  useEffect(() => {
    refreshProfile();
    const unsub = subscribe((s) => s.apiReachable && refreshProfile());
    const onUnauthorized = () => logout();
    window.addEventListener('innermap:unauthorized', onUnauthorized);
    return () => {
      unsub();
      window.removeEventListener('innermap:unauthorized', onUnauthorized);
    };
  }, [refreshProfile, logout]);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: Boolean(user), login, register, logout, updateUser, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
