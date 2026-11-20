// Map provider registry.
//
// Every base map the app can show is described here. Rules:
//   * Each provider has its own `layerId`. Downloaded tiles are stored under that id, so
//     tiles from different providers are never mixed.
//   * Only providers with `offlineAllowed: true` can be downloaded. That flag is true only
//     for sources whose licence permits offline storage (our own server's data).
//   * Public servers that forbid bulk downloading are blocked even if misconfigured.
const env = import.meta.env;

const OSM_STANDARD_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Hosts whose usage policies forbid bulk / offline downloading.
const BULK_FORBIDDEN_HOSTS = [
  'tile.openstreetmap.org',
  'tile.osm.org',
  'openstreetmap.fr',
  'tile.opentopomap.org',
  'arcgisonline.com',
  'arcgis.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
];

function hostOf(template) {
  try {
    return new URL(template.replace(/\{[a-z]\}/g, 'a'), window.location.origin).hostname;
  } catch {
    return '';
  }
}

function isBulkForbidden(template) {
  const host = hostOf(template);
  return BULK_FORBIDDEN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i += 1) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Same id scheme as earlier versions, so already-downloaded raster areas stay valid.
function layerIdFor(kind, url) {
  const clean = url.replace(/[?&](key|api_key|apikey|access_token)=[^&]*/gi, '');
  return `${kind === 'vector' ? 'V' : 'L'}${hashString(clean)}`;
}

function define(p) {
  return Object.freeze({
    subdomains: [],
    minZoom: 0,
    maxZoom: 19,
    maxDataZoom: p.maxZoom ?? 19,
    averageTileBytes: 18 * 1024,
    ...p,
    layerId: layerIdFor(p.kind, p.url),
  });
}

const list = [];

// 1. Offline-capable vector basemap: OpenStreetMap data (Protomaps build) served by our own
//    backend from a local PMTiles file. Shows place names, roads and points of interest.
const vectorUrl = env.VITE_VECTOR_TILE_URL || '/tiles/vector/{z}/{x}/{y}.mvt';
list.push(
  define({
    id: 'local-vector',
    label: 'Inner Map Offline',
    description: 'OpenStreetMap data from your Inner Map server. Can be downloaded for offline use.',
    kind: 'vector',
    url: vectorUrl,
    metadataUrl: env.VITE_VECTOR_METADATA_URL || '/tiles/vector/metadata',
    servedByApp: !/^https?:\/\//.test(vectorUrl),
    offlineAllowed: true,
    maxZoom: 19,
    maxDataZoom: 15, // vector data is complete at z15; deeper zooms are drawn from it
    attribution: `${OSM_ATTRIBUTION} &middot; <a href="https://protomaps.com">Protomaps</a>`,
    averageTileBytes: 12 * 1024, // stored gzip-compressed
  })
);

// 2. Standard OpenStreetMap raster tiles: online browsing only (policy forbids offline use).
list.push(
  define({
    id: 'osm-standard',
    label: 'OpenStreetMap (online only)',
    description: 'The standard openstreetmap.org map. Needs internet; cannot be downloaded.',
    kind: 'raster',
    url: OSM_STANDARD_URL,
    servedByApp: false,
    offlineAllowed: false,
    offlineBlockedReason: 'The OpenStreetMap tile servers do not permit offline or bulk downloading.',
    attribution: OSM_ATTRIBUTION,
  })
);

// 3. Optional self-hosted / licensed raster tiles configured in .env.
const customUrl = (env.VITE_TILE_URL || '').trim();
if (customUrl && !isBulkForbidden(customUrl)) {
  const allowed = env.VITE_TILE_OFFLINE_ALLOWED === 'true';
  list.push(
    define({
      id: 'custom-raster',
      label: env.VITE_TILE_LABEL || 'Custom raster tiles',
      description: 'Raster tiles configured in frontend/.env.',
      kind: 'raster',
      url: customUrl,
      servedByApp: customUrl.startsWith('/'),
      subdomains: (env.VITE_TILE_SUBDOMAINS || '').split('').filter(Boolean),
      minZoom: Number(env.VITE_TILE_MIN_ZOOM ?? 0),
      maxZoom: Number(env.VITE_TILE_MAX_ZOOM ?? 19),
      maxDataZoom: Number(env.VITE_TILE_MAX_ZOOM ?? 19),
      offlineAllowed: allowed,
      offlineBlockedReason: allowed
        ? null
        : 'Offline downloads are off for this source (VITE_TILE_OFFLINE_ALLOWED is not "true").',
      attribution: env.VITE_TILE_ATTRIBUTION || OSM_ATTRIBUTION,
    })
  );
}

export const PROVIDERS = Object.freeze(list);

// ---- map view sources (Stage 3) --------------------------------------------------------
// Not base-map choices of their own: the map-view selector (Default / Satellite / Terrain /
// Transit) puts them on top of, or in place of, the chosen base map.

// Satellite imagery. Default: EOX Sentinel-2 cloudless (Copernicus Sentinel-2, ~10 m per pixel,
// one cloud-free mosaic per year). Licence: CC BY-NC-SA 4.0 - free for NON-COMMERCIAL use,
// copies (offline storage) allowed with attribution; commercial use needs an EOX licence.
// Set VITE_SATELLITE_URL (+ _LABEL, _ATTRIBUTION, _MAX_ZOOM, _OFFLINE_ALLOWED) to use another
// properly licensed imagery service instead. Google imagery is never allowed (see BULK_FORBIDDEN_HOSTS).
const SAT_YEAR = env.VITE_SATELLITE_YEAR || '2025';
const satUrl = (env.VITE_SATELLITE_URL || '').trim();
const satCustom = satUrl && !isBulkForbidden(satUrl);
export const SATELLITE_SOURCE = define({
  id: 'satellite',
  label: satCustom ? env.VITE_SATELLITE_LABEL || 'Satellite imagery' : `Sentinel-2 cloudless ${SAT_YEAR}`,
  description: satCustom
    ? env.VITE_SATELLITE_DESCRIPTION || 'Satellite imagery configured in frontend/.env.'
    : `Cloud-free satellite mosaic of ${SAT_YEAR} (Copernicus Sentinel-2, processed by EOX). About 10 m per pixel: cities, coastlines, forests and fields are visible; single buildings are not.`,
  kind: 'raster',
  url: satCustom ? satUrl : `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${SAT_YEAR}_3857/default/g/{z}/{y}/{x}.jpg`,
  servedByApp: false,
  maxZoom: 19,
  maxDataZoom: Number(env.VITE_SATELLITE_MAX_ZOOM || (satCustom ? 19 : 15)),
  resolution: satCustom ? env.VITE_SATELLITE_RESOLUTION || null : '≈10 m per pixel',
  imageryDate: satCustom ? env.VITE_SATELLITE_DATE || null : `${SAT_YEAR} (annual mosaic)`,
  offlineAllowed: satCustom ? env.VITE_SATELLITE_OFFLINE_ALLOWED === 'true' : true,
  licenceNote: satCustom ? env.VITE_SATELLITE_LICENCE || '' : 'CC BY-NC-SA 4.0: non-commercial use only',
  attribution: satCustom
    ? env.VITE_SATELLITE_ATTRIBUTION || 'Satellite imagery'
    : `<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${SAT_YEAR})`,
  averageTileBytes: 14 * 1024,
});

// High-resolution imagery for close-up views (about 0.3-1 m per pixel in cities: single
// buildings, cars and trees). Default: Esri World Imagery (Maxar, Earthstar Geographics and
// others). ONLINE VIEWING ONLY - Esri's terms do not allow storing its tiles for offline use, so
// it is never downloaded; offline the Sentinel-2 imagery (or a downloaded satellite pack) shows.
// Set VITE_HIRES_IMAGERY_URL to another licensed service, or to "off" to disable.
const hiresEnv = (env.VITE_HIRES_IMAGERY_URL || '').trim();
export const HIRES_IMAGERY_SOURCE =
  hiresEnv === 'off'
    ? null
    : define({
        id: 'hires-imagery',
        label: env.VITE_HIRES_IMAGERY_LABEL || 'Esri World Imagery',
        kind: 'raster',
        url: hiresEnv || 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        servedByApp: false,
        minZoom: Number(env.VITE_HIRES_IMAGERY_MIN_ZOOM || 11), // Sentinel-2 below this zoom
        maxZoom: 21,
        maxDataZoom: Number(env.VITE_HIRES_IMAGERY_MAX_ZOOM || 19),
        offlineAllowed: false,
        offlineBlockedReason: 'High-resolution imagery may only be viewed online.',
        attribution:
          env.VITE_HIRES_IMAGERY_ATTRIBUTION ||
          'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      });

// Elevation for the Terrain view: AWS / Mapzen Terrain Tiles ("terrarium" PNG encoding,
// elevation = R*256 + G + B/256 - 32768 m). Open data (SRTM, GMTED, ETOPO1, ...), may be stored
// offline; attribution required. Drawn as hill shading on the device.
export const TERRAIN_SOURCE = define({
  id: 'terrain-dem',
  label: 'Terrain Tiles (elevation)',
  description: 'Elevation model from AWS Terrain Tiles (Mapzen / Tilezen): SRTM, GMTED2010, ETOPO1 and national datasets.',
  kind: 'raster',
  url: env.VITE_TERRAIN_URL || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  servedByApp: false,
  maxZoom: 19,
  maxDataZoom: 15,
  offlineAllowed: true,
  attribution:
    'Elevation: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles</a> (SRTM, GMTED2010 courtesy of the U.S. Geological Survey, ETOPO1)',
  averageTileBytes: 40 * 1024,
});

export const DEFAULT_PROVIDER_ID = PROVIDERS.some((p) => p.id === env.VITE_DEFAULT_PROVIDER)
  ? env.VITE_DEFAULT_PROVIDER
  : 'local-vector';

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS.find((p) => p.id === DEFAULT_PROVIDER_ID);
}

/** The provider a downloaded region came from (by id, or by layer id for older records). */
export function providerForRegion(region) {
  return (
    PROVIDERS.find((p) => p.id === region.providerId) || PROVIDERS.find((p) => p.layerId === region.layerId) || null
  );
}

export const DOWNLOAD_LIMITS = Object.freeze({
  maxTilesPerDownload: Number(env.VITE_MAX_TILES_PER_DOWNLOAD || 30000),
  concurrency: Math.min(8, Math.max(1, Number(env.VITE_DOWNLOAD_CONCURRENCY || 4))),
});

/** Concrete URL for one tile of a provider. */
export function buildTileUrl(provider, z, x, y) {
  const subs = provider.subdomains;
  const s = subs.length ? subs[Math.abs(x + y) % subs.length] : '';
  return provider.url
    .replace('{s}', s)
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', '');
}

/**
 * Tile zoom levels to download so the map works offline between display zooms
 * zoomMin and zoomMax. Vector tiles are drawn one level lower than the display zoom
 * and stop at maxDataZoom (deeper zooms reuse that data), so a vector download always
 * includes full detail.
 */
export function downloadZoomRange(provider, zoomMin, zoomMax) {
  if (provider.kind === 'vector') {
    return { dataZoomMin: Math.max(0, Math.min(zoomMin - 1, provider.maxDataZoom)), dataZoomMax: provider.maxDataZoom };
  }
  return { dataZoomMin: zoomMin, dataZoomMax: Math.min(zoomMax, provider.maxDataZoom) };
}

/** Plain-text attribution (for places that cannot render HTML). */
export function attributionText(provider) {
  return provider.attribution
    .replace(/<[^>]+>/g, '')
    .replace(/&copy;/g, '©')
    .replace(/&middot;/g, '·');
}

/**
 * Live traffic for the Earth page: there is no free, key-less source of live traffic, so this is
 * off until a provider's traffic tiles are configured, e.g. TomTom (free tier with your own key):
 * VITE_TRAFFIC_TILE_URL=https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=YOUR_KEY
 * (optionally VITE_TRAFFIC_ATTRIBUTION for the credit line).
 */
export const TRAFFIC_SOURCE = env.VITE_TRAFFIC_TILE_URL
  ? { url: env.VITE_TRAFFIC_TILE_URL, attribution: env.VITE_TRAFFIC_ATTRIBUTION || 'Traffic: © TomTom', minZoom: 8, maxZoom: 18 }
  : null;

/** Relief shading for the Earth page's Terrain view (Esri World Hillshade; online viewing only). */
export const HILLSHADE_SOURCE = {
  url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Hillshade: Esri',
  maxZoom: 16,
};
