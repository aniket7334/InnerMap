// Axios instance shared by all API calls.
import axios from 'axios';
import { getToken } from './authStorage';
import { isApiReachable, checkNow } from '../offline/connectivity';

export class OfflineError extends Error {
  constructor(message = 'You are offline. This action needs a connection to the Inner Map server.') {
    super(message);
    this.name = 'OfflineError';
    this.offline = true;
  }
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  // Avoid pointless requests while offline - fail fast instead.
  if (!navigator.onLine) throw new OfflineError();
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error instanceof OfflineError) return Promise.reject(error);
    if (!error.response) {
      // Network failure: re-check connectivity so the UI indicator updates.
      checkNow();
      return Promise.reject(new OfflineError('Cannot reach the Inner Map server. Check your connection.'));
    }
    if (error.response.status === 401 && getToken()) {
      window.dispatchEvent(new CustomEvent('innermap:unauthorized'));
    }
    return Promise.reject(error);
  }
);

/** Turn any API error into a message suitable for the UI. */
export function errorMessage(err, fallback = 'Something went wrong') {
  if (!err) return fallback;
  if (err.offline) return err.message;
  const data = err.response?.data;
  if (data?.errors) return Object.values(data.errors).join('. ');
  return data?.message || err.message || fallback;
}

export function canUseApi() {
  return isApiReachable();
}

export default api;
