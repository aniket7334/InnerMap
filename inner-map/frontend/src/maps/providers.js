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
