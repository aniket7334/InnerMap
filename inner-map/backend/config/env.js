// Loads and validates environment variables once, so the rest of the app
// can import plain values instead of reading process.env everywhere.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const required = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];
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
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME,
  },
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
