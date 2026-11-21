// Loads and validates environment variables once, so the rest of the app
// can import plain values instead of reading process.env everywhere.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Hosted MySQL usually gives one connection URL: DATABASE_URL=mysql://user:pass@host:port/dbname
// (then DB_HOST/DB_USER/DB_NAME are not needed). DB_SSL=true for providers that require TLS.
const dbUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const required = dbUrl ? ['JWT_SECRET'] : ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
const missing = required.filter((k) => process.env[k] === undefined || process.env[k] === '');
if (missing.length) {
  console.error(`[config] Missing required environment variables: ${missing.join(', ')}`);
  console.error('[config] Copy backend/.env.example to backend/.env and fill it in.');
  process.exit(1);
}

if (process.env.JWT_SECRET === 'change-me-to-a-long-random-string') {
  console.warn('[config] WARNING: JWT_SECRET is still the example value. Change it before deploying.');
}

module.exports = {
  port: Number(process.env.PORT) || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  db: {
    host: dbUrl ? dbUrl.hostname : process.env.DB_HOST,
    port: Number(dbUrl?.port || process.env.DB_PORT) || 3306,
    user: dbUrl ? decodeURIComponent(dbUrl.username) : process.env.DB_USER,
    password: dbUrl ? decodeURIComponent(dbUrl.password) : process.env.DB_PASSWORD || '',
    database: dbUrl ? dbUrl.pathname.replace(/^\//, '') : process.env.DB_NAME,
    // TLS for hosted MySQL: DB_SSL=true (or ?ssl=true / ssl-mode=REQUIRED in DATABASE_URL);
    // DB_SSL_CA = the provider's CA certificate (PEM text) when it gives one.
    ssl:
      String(process.env.DB_SSL || '').toLowerCase() === 'true' || /ssl(-mode)?=(true|required)/i.test(dbUrl?.search || '')
        ? process.env.DB_SSL_CA
          ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') }
          : { rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || 'true') !== 'false' }
        : undefined,
  },
  // Hosting without a permanent disk (e.g. Render free): map/road files are downloaded at start
  // from DATA_BASE_URL (e.g. a GitHub Release) when missing - see services/dataFetchService.js.
  dataBaseUrl: (process.env.DATA_BASE_URL || '').replace(/\/+$/, ''),
  dataFiles: (process.env.DATA_FILES || '').split(',').map((s) => s.trim()).filter(Boolean),
  tilesDir: path.resolve(__dirname, '..', process.env.TILES_DIR || 'tiles'),
  // Local PMTiles archive with OpenStreetMap vector data (see backend/data/README.md).
  vectorTilesFile: path.resolve(__dirname, '..', process.env.VECTOR_TILES_FILE || 'data/mumbai.pmtiles'),
  // Extra areas (other cities) extracted on request; one .pmtiles file each.
  vectorAreasDir: path.resolve(__dirname, '..', process.env.VECTOR_AREAS_DIR || 'data/areas'),
  // Optional local imagery/terrain for the 3D globe (see backend/globe-data/README.md).
  globeDataDir: path.resolve(__dirname, '..', process.env.GLOBE_DATA_DIR || 'globe-data'),
  // Road graph for offline + local routing (built by scripts/build-routing-graph.mjs).
  routingGraphFile: path.resolve(__dirname, '..', process.env.ROUTING_GRAPH_FILE || 'data/mumbai.routing.json.gz'),
  routing: {
    provider: (process.env.ROUTING_PROVIDER || 'osrm').toLowerCase(), // osrm | graphhopper | local
    osrm: {
      car: process.env.OSRM_CAR_URL || '',
      bike: process.env.OSRM_BIKE_URL || '',
      foot: process.env.OSRM_FOOT_URL || '',
      // Only if you run an OSRM server built with a motorcycle profile (the public ones have none).
      motorcycle: process.env.OSRM_MOTORCYCLE_URL || '',
    },
    graphhopperKey: process.env.GRAPHHOPPER_API_KEY || '',
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
};
