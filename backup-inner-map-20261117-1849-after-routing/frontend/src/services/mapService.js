// Downloaded-map metadata stored on the server (useful to see areas you
// downloaded on other devices). Tiles themselves never go to the server.
import api from './api';
import { isApiReachable } from '../offline/connectivity';

export async function listServerMaps() {
  if (!isApiReachable()) return null; // unknown while offline
  const { data } = await api.get('/maps');
  return data.maps;
}

export async function deleteServerMap(id) {
  await api.delete(`/maps/${id}`);
}
