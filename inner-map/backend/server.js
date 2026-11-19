// Inner Map API server
const config = require('./config/env'); // must be first: loads .env
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { testConnection } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
// Allow tile images to be used by a front-end on another origin/port.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / curl requests (no Origin header) and whitelisted front-ends.
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      // Development: any local dev server port (Vite moves to 5174, 5175... when 5173 is busy).
      if (config.nodeEnv !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(origin)) {
        return cb(null, true);
      }
      const err = new Error(`Origin ${origin} is not allowed. Add it to CORS_ORIGINS in backend/.env.`);
      err.status = 403; // a clear client error instead of "Internal server error"
      return cb(err);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
// Feature uploads (imported KML/KMZ layers) can be large; everything else stays small.
const smallJson = express.json({ limit: '200kb' });
const largeJson = express.json({ limit: '15mb' });
app.use((req, res, next) =>
  (req.path.startsWith('/api/layers') || req.path.startsWith('/api/features') ? largeJson : smallJson)(req, res, next)
);

// Lightweight endpoint the front-end pings to confirm real connectivity.
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Offline vector basemap served from a local PMTiles archive (must come before /tiles below).
app.use('/tiles/vector', require('./routes/vectorTileRoutes'));
// Optional local imagery/terrain for the 3D globe.
app.use('/globe-data', require('./routes/globeDataRoutes'));

// Optional self-hosted map tiles: put an XYZ tile folder at backend/tiles/{z}/{x}/{y}.png
// (e.g. exported with QGIS "Generate XYZ tiles"). Missing tiles return 404, which the
// front-end treats as "no data here".
app.use(
  '/tiles',
  express.static(config.tilesDir, { maxAge: '30d', fallthrough: false, index: false, dotfiles: 'deny' }),
  (err, _req, res, next) => (err.status === 404 ? res.status(404).end() : next(err))
);

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/locations', require('./routes/locationRoutes'));
app.use('/api/maps', require('./routes/mapRoutes'));
app.use('/api/location-history', require('./routes/historyRoutes'));
app.use('/api/preferences', require('./routes/preferenceRoutes'));
app.use('/api/layers', require('./routes/layerRoutes'));
app.use('/api/features', require('./routes/featureRoutes'));
app.use('/api/routing', require('./routes/routingRoutes'));
app.use('/api/map-areas', require('./routes/mapAreaRoutes'));

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, async () => {
  console.log(`[server] Inner Map API listening on http://localhost:${config.port}`);
  try {
    await testConnection();
    console.log('[db] Connected to MySQL database', config.db.database);
    const info = await require('./services/pmtilesService').getInfo(config.vectorTilesFile);
    console.log(
      info.available
        ? `[tiles] Vector basemap ready: ${info.name}, z${info.minZoom}-${info.maxZoom}`
        : `[tiles] No vector basemap at ${config.vectorTilesFile} (see backend/data/README.md)`
    );
  } catch (err) {
    console.error(`[db] Could not connect to MySQL (${err.code || err.message}).`);
    console.error('[db] Start MySQL from the XAMPP Control Panel and import database/inner_map_db.sql.');
  }
});
