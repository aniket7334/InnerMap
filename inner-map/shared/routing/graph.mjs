// Road graph: built from OpenStreetMap ways, stored compactly, cut to an area, merged.
//
// Format (plain JSON so it can be gzip-served, stored in IndexedDB and posted to a Worker):
// {
//   format: 'innermap-routing-1', bounds, source, license, builtAt,
//   names:   [street names],                       (index 0 = no name)
//   nodeId:  [OSM node id per junction],
//   nodeLat: [int, 1e-6 degrees], nodeLon: [...],
//   edgeA, edgeB:  [node index], edgeLen: [decimetres], edgeCls: [CLASSES index],
//   edgeFlags: [access bits], edgeSpeed: [car km/h], edgeName: [names index],
//   shapeOff: [edges+1 offsets into shape], shape: [lat,lon,lat,lon,... int 1e-6]  (points between A and B)
// }
import { accessFlags, carSpeed, CLASSES } from './profiles.mjs';

export const FORMAT = 'innermap-routing-1';
const E6 = 1e6;

export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371008.8;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Build a graph from Overpass "out body geom" ways: [{ id, nodes:[ids], geometry:[{lat,lon}], tags }].
 * Ways are split at junctions (nodes shared by 2+ routable ways, or way ends); the points in
 * between become the edge's shape.
 */
export function buildGraph(ways, meta = {}) {
  const kept = [];
  const use = new Map();
  for (const w of ways) {
    if (!w.tags || !w.nodes || !w.geometry || w.nodes.length < 2 || w.geometry.length !== w.nodes.length) continue;
    const flags = accessFlags(w.tags);
    if (!flags) continue;
    kept.push({ w, flags });
    w.nodes.forEach((id, i) => use.set(id, (use.get(id) || 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
  }

  const names = [''];
  const nameIdx = new Map([['', 0]]);
  const nameOf = (tags) => {
    const n = (tags.name || tags['name:en'] || tags.ref || '').trim().slice(0, 120);
    if (!nameIdx.has(n)) {
      nameIdx.set(n, names.length);
      names.push(n);
    }
    return nameIdx.get(n);
  };

  const nodeIndex = new Map();
  const g = {
    format: FORMAT, names, nodeId: [], nodeLat: [], nodeLon: [],
    edgeA: [], edgeB: [], edgeLen: [], edgeCls: [], edgeFlags: [], edgeSpeed: [], edgeName: [],
    shapeOff: [0], shape: [],
  };
  const junction = (id, p) => {
    let i = nodeIndex.get(id);
    if (i === undefined) {
      i = g.nodeId.length;
      nodeIndex.set(id, i);
      g.nodeId.push(id);
      g.nodeLat.push(Math.round(p.lat * E6));
      g.nodeLon.push(Math.round(p.lon * E6));
    }
    return i;
  };

  for (const { w, flags } of kept) {
    const cls = CLASSES.indexOf(w.tags.highway);
    const speed = Math.round(carSpeed(w.tags));
    const name = nameOf(w.tags);
    let start = 0;
    for (let i = 1; i < w.nodes.length; i += 1) {
      const isJunction = i === w.nodes.length - 1 || (use.get(w.nodes[i]) || 0) > 1;
      if (!isJunction) continue;
      let len = 0;
      for (let k = start + 1; k <= i; k += 1) {
        const p = w.geometry[k - 1];
        const q = w.geometry[k];
        len += haversine(p.lat, p.lon, q.lat, q.lon);
      }
      const a = junction(w.nodes[start], w.geometry[start]);
      const b = junction(w.nodes[i], w.geometry[i]);
      if (a !== b || len > 0) {
        g.edgeA.push(a);
        g.edgeB.push(b);
        g.edgeLen.push(Math.max(1, Math.round(len * 10)));
        g.edgeCls.push(cls);
        g.edgeFlags.push(flags);
        g.edgeSpeed.push(speed);
        g.edgeName.push(name);
        for (let k = start + 1; k < i; k += 1) {
          g.shape.push(Math.round(w.geometry[k].lat * E6), Math.round(w.geometry[k].lon * E6));
        }
        g.shapeOff.push(g.shape.length);
      }
      start = i;
    }
  }
  return { ...g, ...meta };
}

/** Keep the edges with at least one end inside bounds (so roads crossing the edge stay usable). */
export function subsetGraph(g, b) {
  const inside = (i) => {
    const lat = g.nodeLat[i] / E6;
    const lon = g.nodeLon[i] / E6;
    return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
  };
  const map = new Map();
  const out = {
    format: FORMAT, names: [], nodeId: [], nodeLat: [], nodeLon: [],
    edgeA: [], edgeB: [], edgeLen: [], edgeCls: [], edgeFlags: [], edgeSpeed: [], edgeName: [],
    shapeOff: [0], shape: [],
  };
  const nameMap = new Map();
  const node = (i) => {
    let j = map.get(i);
    if (j === undefined) {
      j = out.nodeId.length;
      map.set(i, j);
      out.nodeId.push(g.nodeId[i]);
      out.nodeLat.push(g.nodeLat[i]);
      out.nodeLon.push(g.nodeLon[i]);
    }
    return j;
  };
  const nameIdx = (n) => {
    let j = nameMap.get(n);
    if (j === undefined) {
      j = out.names.length;
      nameMap.set(n, j);
      out.names.push(g.names[n]);
    }
    return j;
  };
  nameIdx(0);
  for (let e = 0; e < g.edgeA.length; e += 1) {
    if (!inside(g.edgeA[e]) && !inside(g.edgeB[e])) continue;
    out.edgeA.push(node(g.edgeA[e]));
    out.edgeB.push(node(g.edgeB[e]));
    out.edgeLen.push(g.edgeLen[e]);
    out.edgeCls.push(g.edgeCls[e]);
    out.edgeFlags.push(g.edgeFlags[e]);
    out.edgeSpeed.push(g.edgeSpeed[e]);
    out.edgeName.push(nameIdx(g.edgeName[e]));
    for (let k = g.shapeOff[e]; k < g.shapeOff[e + 1]; k += 1) out.shape.push(g.shape[k]);
    out.shapeOff.push(out.shape.length);
  }
  return {
    ...out,
    bounds: b,
    source: g.source,
    license: g.license,
    builtAt: g.builtAt,
  };
}

/** Merge graphs (e.g. two downloaded areas) into one, joining shared OSM junctions. */
export function mergeGraphs(graphs) {
  if (graphs.length === 1) return graphs[0];
  const out = {
    format: FORMAT, names: [''], nodeId: [], nodeLat: [], nodeLon: [],
    edgeA: [], edgeB: [], edgeLen: [], edgeCls: [], edgeFlags: [], edgeSpeed: [], edgeName: [],
    shapeOff: [0], shape: [], bounds: null,
  };
  const nodeMap = new Map();
  const nameMap = new Map([['', 0]]);
  const seenEdge = new Set();
  for (const g of graphs) {
    const node = (i) => {
      const id = g.nodeId[i];
      let j = nodeMap.get(id);
      if (j === undefined) {
        j = out.nodeId.length;
        nodeMap.set(id, j);
        out.nodeId.push(id);
        out.nodeLat.push(g.nodeLat[i]);
        out.nodeLon.push(g.nodeLon[i]);
      }
      return j;
    };
    for (let e = 0; e < g.edgeA.length; e += 1) {
      const key = `${g.nodeId[g.edgeA[e]]}-${g.nodeId[g.edgeB[e]]}-${g.edgeLen[e]}`;
      if (seenEdge.has(key)) continue; // same road in both areas
      seenEdge.add(key);
      out.edgeA.push(node(g.edgeA[e]));
      out.edgeB.push(node(g.edgeB[e]));
      out.edgeLen.push(g.edgeLen[e]);
      out.edgeCls.push(g.edgeCls[e]);
      out.edgeFlags.push(g.edgeFlags[e]);
      out.edgeSpeed.push(g.edgeSpeed[e]);
      const n = g.names[g.edgeName[e]];
      if (!nameMap.has(n)) {
        nameMap.set(n, out.names.length);
        out.names.push(n);
      }
      out.edgeName.push(nameMap.get(n));
      for (let k = g.shapeOff[e]; k < g.shapeOff[e + 1]; k += 1) out.shape.push(g.shape[k]);
      out.shapeOff.push(out.shape.length);
    }
    const b = g.bounds;
    out.bounds = !out.bounds
      ? { ...b }
      : {
          south: Math.min(out.bounds.south, b.south),
          west: Math.min(out.bounds.west, b.west),
          north: Math.max(out.bounds.north, b.north),
          east: Math.max(out.bounds.east, b.east),
        };
  }
  out.coverage = graphs.map((g) => g.bounds);
  return out;
}
