import api from './api';

export async function listHistory(limit = 100) {
  const { data } = await api.get('/location-history', { params: { limit } });
  return data.history;
}

export async function clearHistory() {
  const { data } = await api.delete('/location-history');
  return data.deleted;
}
