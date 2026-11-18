// Offline routing worker: loads the stored road graphs from IndexedDB, prepares them for the
// travel mode and runs the A* router - entirely on the device, no network needed.
// Running in a worker keeps the map responsive while large graphs are prepared.
import { getDB } from '../offline/db';
import { mergeGraphs } from '../../../shared/routing/graph.mjs';
import { prepare, route } from '../../../shared/routing/router.mjs';

let cache = { key: '', graph: null, prepared: {} };

async function loadGraph(regionIds) {
  const key = [...regionIds].sort().join('|');
  if (cache.key === key && cache.graph) return cache;
  const db = await getDB();
  const recs = (await Promise.all(regionIds.map((id) => db.get('routing', id)))).filter(Boolean);
  if (!recs.length) throw new Error('No offline road data is stored for this area.');
  const graph = mergeGraphs(recs.map((r) => r.graph));
  cache = { key, graph, prepared: {} };
  return cache;
}

self.onmessage = async (ev) => {
  const { id, regionIds, profile, from, to } = ev.data;
  try {
    const t0 = performance.now();
    const c = await loadGraph(regionIds);
    if (!c.prepared[profile]) c.prepared[profile] = prepare(c.graph, profile);
    const r = route(c.prepared[profile], from, to);
    self.postMessage({ id, result: { ...r, ms: Math.round(performance.now() - t0), edges: c.graph.edgeA.length } });
  } catch (err) {
    self.postMessage({ id, error: err.message || String(err) });
  }
};
