// Offline map areas for more cities: the server prepares a city's map data once
// (extracted from the OpenStreetMap / Protomaps build), then it can be downloaded like Mumbai.
import api from './api';

/** Ask the server to prepare map data for an area. -> { job } | { existing } */
export async function requestMapArea(name, bounds) {
  const { data } = await api.post('/map-areas', { name, bounds });
  return data;
}

/** Progress of a preparation. -> job { status, phase, progress, error } */
export async function fetchMapAreaJob(id) {
  const { data } = await api.get(`/map-areas/jobs/${encodeURIComponent(id)}`);
  return data.job;
}

/** Most an area may span (degrees), matching the server's limit. */
export const MAX_AREA_SPAN_DEG = 1;
