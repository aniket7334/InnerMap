// Calls to the backend's /api/routing endpoints.
import api from './api';

export async function fetchRoutingInfo() {
  const { data } = await api.get('/routing/info');
  return data; // { online: {provider,label,profiles}, offline: {available,bounds,...} }
}

/** Online route through the configured provider (OSRM / GraphHopper / local), proxied by the backend. */
export async function fetchOnlineRoute(profile, from, to) {
  const { data } = await api.get('/routing/route', {
    params: { profile, from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}` },
    timeout: 30000,
  });
  return data.route;
}

/** The road graph for an area (the browser stores it for offline routing). */
export async function fetchRoadGraph(bounds, signal) {
  const { data, headers } = await api.get('/routing/graph', {
    params: bounds,
    timeout: 120000,
    signal,
    responseType: 'text',
    transformResponse: (r) => r,
  });
  return { graph: JSON.parse(data), bytes: data.length, edges: Number(headers['x-road-segments']) || null };
}
