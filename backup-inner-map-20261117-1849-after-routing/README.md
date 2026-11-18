# Inner Map

Inner Map is an offline map and GPS tracking web app (PWA). While you are online you download map areas. Later, with no internet, you can open the app, see those areas, and follow your live GPS position on them.

**Stack:** React 18 + Vite, React Router, Axios, Leaflet + protomaps-leaflet (vector maps) · Node.js + Express, JWT, bcrypt, PMTiles · MySQL (XAMPP / phpMyAdmin) · IndexedDB, Service Worker, Cache Storage, Geolocation API.

---

## 1. System architecture

```
┌──────────────────────────── Browser (PWA) ────────────────────────────┐
│  React UI (pages, layouts, components)                                 │
│     │                                                                  │
│     ├─ AuthContext ─────────── JWT + profile cached in localStorage    │
│     ├─ ConnectivityContext ─── navigator.onLine + /api/health ping     │
│     ├─ LocationContext ─────── Geolocation API (watchPosition)         │
│     │                                                                  │
│     ├─ MapView (Leaflet) ── OfflineTileLayer ──► IndexedDB "tiles"     │
│     │                                   └──────► tile server (online)  │
│     ├─ downloadManager ── tile maths → fetch → IndexedDB "tiles"       │
│     ├─ locationService ── IndexedDB "locations" (offline-first)        │
│     └─ syncService ────── IndexedDB "outbox" → replays to REST API     │
│                                                                        │
│  service-worker.js ── Cache Storage: app shell (HTML/JS/CSS/icons)     │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ /api (JSON + Bearer JWT)    /tiles (optional)
┌──────────────────────────────▼─────────────────────────────────────────┐
│  Express API (backend/server.js)                                       │
│  routes → middleware (auth, validate) → controllers → models (mysql2)  │
│  helmet · CORS whitelist · rate-limited login · central error handler  │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │
                    MySQL  inner_map_db  (XAMPP)
        users · saved_locations · downloaded_maps · location_history
```

Responsibilities:

| Data | Where it lives | Why |
|---|---|---|
| Map tiles (images) | Browser IndexedDB | Too large for MySQL; must be on the device to work offline |
| Downloaded-area metadata | IndexedDB, plus a copy in MySQL `downloaded_maps` | Shows what you downloaded on other devices |
| Saved places | IndexedDB cache, plus MySQL `saved_locations` | Usable offline and synced to your account |
| Location history | MySQL `location_history`, only after you opt in | Privacy: off by default |
| App code | Service-worker Cache Storage | So the app opens with no network |

## 2. How offline maps work

The default base map, **Inner Map Offline**, is OpenStreetMap **vector** data: roads, place names, water, parks and buildings, drawn in the browser. It comes from a PMTiles file on your own server (section 3). It is never scraped from public tile servers.

1. **Select an area.** Choose the whole server area (Mumbai), the current view, a drawn box, a searched city or region, or a radius around your GPS position. For vector data, the selection is clipped to the area the server has data for.
2. **Calculate tiles.** `src/maps/tileMath.js` converts the bounds to Web-Mercator tile ranges for each zoom level. Vector tiles are drawn one level below the display zoom and are complete at z15, so a vector download always includes full street detail (you can zoom to 19 offline). `providers.js → downloadZoomRange()` works out the exact levels.
3. **Pre-flight checks.** The provider must allow offline use, the device must be online, the area must be under the tile limit, and there must be enough free quota (`navigator.storage.estimate()`). The app then asks for persistent storage.
4. **Download.** `src/offline/downloadManager.js` fetches tiles with a worker pool (default 4), with retry and back-off on 5xx/429 and network errors. Progress is saved every second.
5. **Store.** Each tile goes into IndexedDB under the key `layerId/z/x/y`. Vector tiles are gzip-compressed first (about 2–3× smaller; Mumbai is 17.5 MB). Each tile keeps a list of the regions that use it, so overlapping areas share one copy and deleting an area removes only the tiles no other area uses.
6. **App shell.** `public/service-worker.js` caches `index.html`, the JS/CSS bundles and the icons, and answers page loads from that cache when the network is down.
7. **Display.** One base layer is shown at a time, for the active provider, so tiles from different providers are never mixed.
   - **Vector** (`src/maps/VectorTileLayer.js`, using protomaps-leaflet): it uses the tile from IndexedDB if present, otherwise fetches it from the server if online. If neither is possible, MapView shows a **"Not downloaded"** notice with a button that jumps to a downloaded area.
   - **Raster** (`src/maps/OfflineTileLayer.js`): it uses IndexedDB first, then the network. Offline, it enlarges a lower-zoom tile if one was downloaded, otherwise it shows a grey "Not downloaded" tile.
   - Downloaded areas are outlined on the map, and the app never claims coverage it does not have.
8. **GPS.** `LocationContext` uses `navigator.geolocation.watchPosition`. The position comes from the device's GPS or location services, so it keeps working without internet.

Edge cases handled:

- **Failed tiles:** the area is marked *partial* and **Resume** retries it.
- **Interrupted downloads** (tab closed, connection lost): the area is marked *interrupted* and can be resumed. Tiles already stored are skipped.
- **Duplicate tiles:** stored once and reference-counted.
- **Storage full:** the download stops with a clear message.
- **Cancellation:** stops the download; the area can then be resumed or deleted.
- **Cleanup:** **My Downloaded Maps → Clean up storage** removes orphaned tiles.

## 3. Map data and providers

### Providers (`frontend/src/maps/providers.js`)
| Provider | What it is | Offline download |
|---|---|---|
| **Inner Map Offline** (`local-vector`, default) | OpenStreetMap vector data served by your backend from `backend/data/mumbai.pmtiles` | Yes |
| **OpenStreetMap (online only)** (`osm-standard`) | The standard openstreetmap.org map | **No**: its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) forbids bulk/offline downloading, so the app blocks it |
| **Custom raster** (`custom-raster`, optional) | Your own raster tiles set in `frontend/.env` (see below) | Only if `VITE_TILE_OFFLINE_ALLOWED=true` |

Switch providers with **Base map** on the Interactive Map page. The top bar always shows the active provider and the online/offline status. The choice is saved on the device and in the MySQL `user_preferences` table. Hosts that forbid bulk downloads (openstreetmap.org, Google) are refused for downloading even if misconfigured.

### The vector data file (Mumbai)
`backend/data/mumbai.pmtiles` (19 MB, zoom 0–15, bounds 72.75–73.10°E, 18.85–19.35°N) is an extract of the free daily **Protomaps basemap**, which is built from OpenStreetMap. It was made with the official `pmtiles extract` tool, which Protomaps recommends instead of scraping its API. The data is © OpenStreetMap contributors under the ODbL, and the map shows that attribution. To recreate it or add another city, see [`backend/data/README.md`](backend/data/README.md).

The backend serves it from disk with no internet needed:
- `GET /tiles/vector/metadata`: area, zoom levels and attribution
- `GET /tiles/vector/{z}/{x}/{y}.mvt`: one vector tile (204 if the file has no data there)

### Optional: your own raster tiles
**Option A: self-host your own tiles (free)**

1. Get OpenStreetMap data for your area. For example, download a `.osm.pbf` from <https://download.geofabrik.de> (ODbL licence, attribution required).
2. In **QGIS** (free), load the data, style it, then run *Processing → Toolbox → Raster tools → Generate XYZ tiles (Directory)*. Set min/max zoom (for example 0–16) and use the output folder `backend/tiles`. You will get `backend/tiles/{z}/{x}/{y}.png`.
3. Set in `frontend/.env` (this adds a "Custom raster tiles" provider):
   ```
   VITE_TILE_URL=/tiles/{z}/{x}/{y}.png
   VITE_TILE_LABEL=My QGIS map
   VITE_TILE_OFFLINE_ALLOWED=true
   VITE_TILE_MAX_ZOOM=16
   VITE_TILE_ATTRIBUTION=&copy; OpenStreetMap contributors
   ```
   The Express server serves that folder at `/tiles`, and Vite proxies it.

**Option B: a commercial provider that permits offline caching.** Check the provider's terms and your plan first. Many providers forbid offline storage or allow it only on paid plans. Then set its URL template (with your API key) and `VITE_TILE_OFFLINE_ALLOWED=true`.

Restart `npm run dev` (or rebuild) after changing `.env`.

## 3b. KML / KMZ and Google Earth

**Layers & KML** (sidebar) is where geographical features live:

| Feature | How |
|---|---|
| **Import** KML, KMZ, GeoJSON | **Choose file...** Markers, paths and polygons are shown with their KML colours. Folders are flattened into one layer per file, and MultiGeometry is split into separate shapes. Limit: 10,000 features or 250,000 vertices per file (the same per-import limit as Google Earth web). Works offline. |
| What is **not** shown | Reported after import, never dropped silently: placemarks without a location, network links (they would need internet), 3D models, and image overlays (only their outline is drawn). |
| **Draw** | **Marker**, **Path** or **Polygon**: click the map to add points, see the length or area as you go, use **Undo point** and **Finish**, then name it and pick a colour. Drawings go into the **My drawings** layer. |
| **Display** | Visible layers appear on the Layers map and the Interactive Map. Click a shape for its name, description (plain text only, since KML HTML is never rendered), coordinates, length or area. |
| **Export** | Per layer: **KML** or **KMZ**. **Export everything**: saved locations plus all layers, one folder each. **Saved Locations → Export KML/KMZ**: just your places. Files are KML 2.2 (`http://www.opengis.net/kml/2.2`), and a KMZ is a ZIP containing `doc.kml`. |
| **Open in Google Earth** | Downloads a KMZ and shows how to open it. In **Google Earth on the web**: *Projects → New project → Import KML file from computer* (or *Open local KML editor → Open KML from device*, no sign-in). In **Google Earth Pro**: double-click the file. The **Open Google Earth on the web** link opens Earth centred on the layer. |

What Google officially supports, and why it works this way: Google Earth has no embeddable SDK, and there is no official way to make it open a file from a link. Its documented interface is **importing KML/KMZ files** ([Google: Import data into Google Earth](https://developers.google.com/maps/documentation/earth/import-data)). Inner Map therefore creates standard files and you import them. The `earth.google.com/web/@lat,lng,…` view link is the format Earth shows in its own address bar; it is not a documented API, so if Google changes it, Earth just opens at its default view.

Inner Map never loads, caches or stores Google imagery or tiles. Offline map data comes only from your own Protomaps/OpenStreetMap file.

Features are stored offline-first: in IndexedDB on the device, synced to the MySQL tables `map_layers` and `map_features` (GeoJSON geometry), and pulled down on your other devices.

## 3c. 3D Globe (CesiumJS)

**3D Globe** (sidebar) is an Earth-style 3D view built with [CesiumJS](https://cesium.com/platform/cesiumjs/) (Apache 2.0). It does not use Cesium ion, Google or any CDN: all of Cesium's files are served by Inner Map from `/cesium`.

| What | Details |
|---|---|
| Camera | Drag to rotate the Earth, scroll to zoom, right-drag or Ctrl+drag to tilt. On-screen buttons: zoom ±, tilt towards the horizon or straight down, rotate left/right, north up, go to my location. Cesium's switcher (top right) changes between 3D, 2D and Columbus view. |
| Base imagery | **Natural Earth II**, bundled with Cesium. It's public domain and works offline, but it's very low resolution (about 20 km per pixel), so it shows continents and land cover only. **Local imagery** if you install licensed tiles in `backend/globe-data/imagery`. **OpenStreetMap** when online (live, never stored). |
| Detail | Your **Inner Map Offline** vector map is drawn on the globe, with the same style as the 2D map. Downloaded areas come from IndexedDB, so you get streets, names and buildings offline. Elsewhere you see only the base imagery. |
| Terrain | A smooth Earth by default. If you add licensed quantized-mesh terrain to `backend/globe-data/terrain`, you get real 3D relief (see [`backend/globe-data/README.md`](backend/globe-data/README.md)). |
| Overlays | Saved places, KML/KMZ/GeoJSON layers and drawings, downloaded-area outlines, and your live GPS position with an accuracy circle. Click any of them for details (shown as plain text). |
| Offline | Open the globe once while online, then press **Make 3D globe available offline**. This stores Cesium's 334 files (6.3 MB) in the browser cache, and the service worker serves them with no connection. **Remove offline files** frees the space. After a Cesium update the page offers **Update offline files**. |

Coverage limits are shown on the page itself, under "What you can see offline". The globe never claims street detail where you have not downloaded it.

Cesium is a separate 4 MB part of the app that loads only when you open the globe, so the 2D map stays fast. `npm run dev` and `npm run build` copy Cesium's files from `node_modules/cesium` into `public/cesium` automatically (`scripts/copy-cesium-assets.mjs`). Cesium's unused Google-related icons and decoders are left out.

## 3d. Interface

The interface follows a map-first GIS layout. All styles live in `frontend/src/styles/global.css`, which starts with the design tokens (colours, type scale, spacing, radii).

**Desktop**
- **Toolbar (48 px):** app name, **search**, the active map source, and the connection status (green Online, orange Server unreachable, red Offline). When there are unsynced changes, a "N to sync" button appears.
- **Left sidebar:** navigation, then **On this device**, the list of your offline maps with their status and size (click one to open it on the map). Overview, Account and Log out are at the bottom.
- **Map page:** the map fills the screen, with tools floating over it:
  - **Add place** (top-left);
  - zoom and **Layers** (top-right) - base map choice plus downloaded areas, saved places and KML layers;
  - location buttons (bottom-right) - go to me, start/stop tracking, follow;
  - coordinates and the GPS read-out (bottom-left).
- **Work pages** (Download, Offline maps, Saved places, Layers & KML): the map on the left and a 360 px side panel split into titled sections.
- **Overview and Account:** simple status lists, with no large statistic tiles.

**Search** shows matching saved places, offline maps and KML/drawn features as you type, and works offline. Pressing **Enter** (or the last row) searches OpenStreetMap places; that needs a connection, and Nominatim's policy does not allow search-as-you-type. Choosing a result opens it on the map.

**Phones (≤ 820 px wide):** a full-screen map, the search bar at the top, and bottom navigation (Map, Download, Places, Layers, More). Map buttons grow to 40 px for touch. On the work pages the map sits on top with the panel scrolling underneath.

The styling is deliberately plain: neutral surfaces, 1 px borders, one teal accent, a 4–6 px corner radius, and shadows only on controls that float over the map. It follows the system's dark mode.

## 3e. GPS, full screen and directions

### GPS (works offline)
- **Locate me** asks for a fresh fix (`getCurrentPosition`: high accuracy, 20 s timeout). **Start/Stop tracking** uses `watchPosition` (high accuracy, `maximumAge: 0`, 30 s timeout).
- The **blue** dot with a solid circle is a **live** fix. The circle is the accuracy radius the device reports; the true position is probably inside it. If no new fix arrives for 30 s (signal lost), or the fix comes from your last session, the dot turns **grey** with a dashed circle and is labelled **Last known**, with its time.
- The read-out (bottom-left; tap it for details) shows latitude, longitude, ± accuracy in metres, the time of the last update, and the accuracy quality: good (≤ 20 m), fair (≤ 100 m), or weak (> 100 m). Weak usually means Wi-Fi or mobile-network positioning instead of GPS.
- GPS needs no internet: the phone's GPS chip works offline. **Computers without a GPS receiver locate themselves through Wi-Fi, which usually needs internet**, so test offline GPS on a phone.
- Errors are explained: permission denied, location services off, timeout or weak signal, and secure-connection required.
- Browsers pause location updates in the background and stop them when the app is closed. The app asks for a fresh fix when you return. Continuous tracking in the background is not possible for a web app.
- The last fix is stored only on this device (`localStorage`) and removed when you log out. Location history is still only sent to the server if you opt in (Account page).

### Bigger map and full screen
- **☰** in the toolbar collapses the sidebar to an icon rail, so the map takes about 90% of a 1366 × 800 screen. The choice is remembered.
- The **⤢** button (under Layers) switches the map to full screen:
  - It uses the browser's Fullscreen API on the existing map, not a second copy.
  - Where that isn't available or doesn't respond within 1.5 s (iPhone Safari, some in-app browsers), a CSS mode covers the whole screen instead, respects notches (safe-area insets), and locks page scrolling.
  - Zoom, layers, Locate me, tracking and directions stay available.
  - **Esc** or the same button exits. Rotation (portrait or landscape) is handled.

### Directions (online and offline)
Click **Directions** on the map.
- **Start and destination:**
  - "My location" (GPS);
  - the pin button, then click the map;
  - a saved place;
  - typed coordinates such as `18.92, 72.83`;
  - an address search (online only; press Enter).
- **Controls:** **⇅** swaps start and destination; **Drive / Walk / Cycle** sets the travel mode; **Auto / Online / Offline** sets where the route is calculated.
- **Result:** the route line, A and B markers, distance, time and step-by-step directions (click a step to zoom to it). The map fits the whole route.
- **The badge always shows the mode:**
  - **Online route** (blue line) comes from the routing service through your backend.
  - **Offline route** (teal line) is calculated on the device.

| | Online | Offline |
|---|---|---|
| Engine | OSRM (default: FOSSGIS servers at routing.openstreetmap.de; car, bike, foot), GraphHopper (with a key) or Inner Map's own router. Set with `ROUTING_PROVIDER` in `backend/.env` | Inner Map's router (A* search, `shared/routing/router.mjs`) in a Web Worker on the device |
| Data | The provider's worldwide OpenStreetMap road network | The **road graph** downloaded with an area (Download area → *Include road data for offline directions*, or *Add* on Offline maps) |
| Coverage | Worldwide | Only inside downloaded areas. Outside them you get a clear "outside the downloaded road data" message |
| Time | The provider's estimate | Estimated from road types and speed limits, without traffic (marked ≈) |

- **Auto** uses online routing when the Inner Map server is reachable, and offline road data otherwise. If online routing fails, the error says so and offers **Use offline road data instead**; it never switches silently.
- Offline routes follow real roads, one-way streets and access rules. If two points aren't connected in the downloaded data, or a point is more than 400 m from a road, you get an explanation, **never a straight line**. Online, a point more than 500 m from a road is refused too.
- **Rate limits:** the FOSSGIS servers allow 1 request per second and light use only. The backend queues requests to respect that, and limits each user to 30 route requests per minute. For production, run your own OSRM and set `OSRM_CAR_URL`, `OSRM_BIKE_URL` and `OSRM_FOOT_URL`.
- Road data is stored in the browser (IndexedDB `routing` store), not in MySQL. **No database changes were needed** for these features.

## 4. Project structure

```
inner-map/
├── database/
│   ├── inner_map_db.sql             MySQL schema (database + 7 tables)
│   └── migrations/
│       ├── 002_user_preferences.sql       adds user_preferences to an existing DB
│       └── 003_map_layers_features.sql    adds map_layers + map_features
├── backend/
│   ├── config/        env.js (loads .env), db.js (mysql2 pool)
│   ├── controllers/   auth, location, map, history, preference, layer
│   ├── data/          mumbai.pmtiles (vector map data) + README.md (how to make it)
│   ├── middleware/    auth.js (JWT), validate.js, errorHandler.js
│   ├── models/        SQL queries per table
│   ├── routes/        /api/auth, /api/locations, /api/maps, /api/location-history,
│   │                  /api/preferences, /api/layers, /api/features, /tiles/vector
│   ├── services/      tokenService.js, initDatabase.js, pmtilesService.js, geojson.js (validation)
│   ├── tiles/         optional self-hosted XYZ raster tiles
│   ├── globe-data/    optional licensed imagery/terrain for the 3D globe + README.md
│   ├── uploads/       (reserved)
│   ├── server.js
│   └── .env           (.env.example is the template)
└── frontend/
    ├── public/        manifest.json, service-worker.js, icons/,
    │                  cesium/ (generated: Cesium workers + assets, not in git)
    ├── scripts/       copy-cesium-assets.mjs
    ├── src/
    │   ├── components/  Icon, SearchBox, StatusBadge, LocationPanel, ProgressBar, Alert,
    │   │                ProtectedRoute, GlobeLoader
    │   ├── features/    kml.js (KML/KMZ/GeoJSON import + KML/KMZ export), googleEarth.js
    │   ├── globe/       cesiumBase, VectorImageryProvider (vector map on the globe),
    │   │                globeEntities, globeOffline
    │   ├── hooks/       AuthContext, ConnectivityContext, LocationContext, ProviderContext,
    │   │                useRegions, useSavedLocations, useFeatureLayers, useInitialFit
    │   ├── layouts/     AppLayout (toolbar, sidebar, bottom navigation), PublicLayout
    │   ├── maps/        MapView, providers, VectorTileLayer, OfflineTileLayer, tileMath, geo
    │   ├── offline/     db (IndexedDB), tileStore, regionStore, downloadManager,
    │   │                syncService, connectivity, storage, registerServiceWorker
    │   ├── pages/       Landing, Register, Login, Dashboard, Map, Download,
    │   │                MyMaps, SavedLocations, Layers, Globe, Profile (Account),
    │   │                Dashboard (Overview), NotFound
    │   ├── services/    api (axios), authService, locationService, mapService,
    │   │                historyService, geocodeService, preferenceService,
    │   │                featureService, authStorage
    │   ├── styles/global.css
    │   ├── App.jsx
    │   └── main.jsx
    ├── index.html
    ├── vite.config.js
    └── .env           (.env.example is the template)
```

## 5. Installation

### Prerequisites
- **Node.js 18+** (`node -v`)
- **XAMPP** (<https://www.apachefriends.org>) with MySQL

### Step 1: Start MySQL
Open the **XAMPP Control Panel** and click **Start** next to **MySQL**. Apache is only needed for phpMyAdmin.

### Step 2: Create the database
Choose one:
- **phpMyAdmin:** open <http://localhost/phpmyadmin>, go to **Import**, choose `database/inner_map_db.sql`, then click **Go**.
- **Command line:**
  ```bash
  C:\xampp\mysql\bin\mysql.exe -u root < database\inner_map_db.sql
  ```
- **npm helper** (after Step 3): `npm run db:init` inside `backend/`.

You should see `inner_map_db` with tables `users`, `saved_locations`, `downloaded_maps`, `location_history`, `user_preferences`, `map_layers` and `map_features`.

**Already have the database from an earlier version?** Import only the new tables. Each migration is safe to run more than once:
```bash
C:\xampp\mysql\bin\mysql.exe -u root inner_map_db < database\migrations\002_user_preferences.sql
```
```bash
C:\xampp\mysql\bin\mysql.exe -u root inner_map_db < database\migrations\003_map_layers_features.sql
```

### Step 3: Backend
```bash
cd backend
npm install
```
Check `backend/.env`. It was generated with a random `JWT_SECRET`, and the XAMPP defaults are `DB_USER=root` with an empty password. Then run:
```bash
npm run dev
```
You should see `Inner Map API listening on http://localhost:5000`, `Connected to MySQL` and `Vector basemap ready: Protomaps Basemap, z0-15`. As a quick check, open <http://localhost:5000/api/health> and <http://localhost:5000/tiles/vector/metadata>.

If it says `No vector basemap`, the `backend/data/mumbai.pmtiles` file is missing. It isn't committed to git; recreate it with [`backend/data/README.md`](backend/data/README.md).

npm packages: `express mysql2 bcryptjs jsonwebtoken cors dotenv helmet express-rate-limit pmtiles` (+ dev: `nodemon`).

### Step 4: Frontend (second terminal)
```bash
cd frontend
npm install
npm run dev
```
Open <http://localhost:5173>.

npm packages: `react react-dom react-router-dom axios leaflet protomaps-leaflet @protomaps/basemaps idb @tmcw/togeojson jszip cesium` (+ dev: `vite @vitejs/plugin-react`).

`frontend/.env` is optional; the defaults match `.env.example`. Copy it if you want to change providers or limits: `copy .env.example .env`.

> If npm reports that the `esbuild` install script was blocked, run `npm install-scripts approve esbuild` and then `npm install` again.

## 6. REST API

All endpoints except register, login and health need `Authorization: Bearer <token>`. Users can only read or change their own rows; another user's id returns 404.

| Method | Endpoint | Body / notes |
|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` → `{ token, user }` |
| POST | `/api/auth/login` | `{ email, password }` → `{ token, user }` (rate limited) |
| GET | `/api/auth/profile` | current user |
| PUT | `/api/auth/profile` | any of `{ name, email, currentPassword+newPassword, locationHistoryEnabled }` |
| GET | `/api/locations` | list saved places |
| POST | `/api/locations` | `{ name, latitude, longitude }` |
| PUT | `/api/locations/:id` | any of `{ name, latitude, longitude }` |
| DELETE | `/api/locations/:id` | |
| GET | `/api/maps` | downloaded-area metadata |
| POST | `/api/maps` | `{ mapName, region:{south,west,north,east}, zoomMin, zoomMax, storageSize, downloadStatus }` |
| DELETE | `/api/maps/:id` | |
| GET | `/api/location-history?limit=&from=&to=` | |
| POST | `/api/location-history` | `{ latitude, longitude, accuracy?, recordedAt? }` or `{ points:[...] }`. Returns 403 unless opted in |
| DELETE | `/api/location-history` | delete all of your history |
| GET | `/api/preferences` | map provider and default view (defaults if never saved) |
| PUT | `/api/preferences` | any of `{ mapProvider, defaultLat+defaultLng+defaultZoom, showDownloadedAreas }` |
| GET | `/api/layers` | your feature layers with feature counts |
| POST | `/api/layers` | `{ name, source: imported\|drawn, fileName?, features?: [≤1000] }` → `{ layer, featureIds }` |
| PUT | `/api/layers/:id` | `{ name }` |
| DELETE | `/api/layers/:id` | deletes the layer and its features |
| GET | `/api/layers/:id/features` | `{ layer, features }` |
| POST | `/api/layers/:id/features` | `{ features: [≤1000] }` → `{ featureIds }` (append) |
| PUT | `/api/features/:id` | any of `{ name, description, geometry, style }` |
| DELETE | `/api/features/:id` | |
| GET | `/api/health` | connectivity ping |
| GET | `/tiles/vector/metadata` | public: vector data area, zooms, attribution |
| GET | `/tiles/vector/{z}/{x}/{y}.mvt` | public: one vector tile (204 = no data) |
| GET | `/globe-data/metadata` | public: which optional globe imagery/terrain is installed |
| GET | `/api/routing/info` | online provider in use + offline road data available on the server |
| GET | `/api/routing/route?profile=car\|foot\|bike&from=lat,lng&to=lat,lng` | online route (distance, duration, geometry, steps); 422 if no route or a point is far from roads |
| GET | `/api/routing/graph?south=&west=&north=&east=` | road graph of an area for offline routing (gzip JSON) |
| GET | `/globe-data/imagery/…`, `/globe-data/terrain/…` | public: those datasets' tiles (404 if not installed) |

## 7. Testing

### A. Online features (dev mode)
1. **Register** at `/register`. Check that phpMyAdmin → `users` shows a bcrypt hash (`$2a$12$…`), not your password.
2. **Dashboard**: the status badge reads **Online**.
3. **Map**: click **Start tracking** and allow location. A blue dot with an accuracy circle appears, and latitude, longitude and accuracy update as you move. **Stop** ends tracking. The ⌖ button flies to your position.
4. **Saved Locations**: add a place by GPS, by clicking the map, or by typing coordinates. It appears in `saved_locations`. Rename it and delete it.
5. **Profile**: change your name or password. Turning on location history shows a privacy notice that needs explicit consent.

### B. The main offline scenario (production build + service worker)
The service worker is active only in a production build:
```bash
cd frontend
npm run build
npm run preview
```
Open <http://localhost:4173> and keep the backend running.

1. Log in. The top bar should show **Map: Inner Map Offline**.
2. **Download Map**: the **Server area** tab preselects all of Mumbai (about 2,000 km², 2,214 tiles at min zoom 10). Type a name such as `Mumbai` and press **Download for offline use**. It takes about 20 seconds from a local server. **My Downloaded Maps** then shows *Ready offline*, about 17 MB, and *Synced*, and the row appears in MySQL `downloaded_maps`.
3. **Go offline.** Turn off Wi-Fi or unplug the network cable, or use DevTools (F12) → **Network → Throttling → Offline**. Optionally also stop the backend and `npm run preview`.
4. **Reload or reopen** <http://localhost:4173/map>. The app still loads from the service worker, you stay signed in, the badge shows **Offline** (or **Server unreachable**), and Mumbai is drawn from IndexedDB with roads and names. Zoom in to street level (up to 19) and drag around. Outside the downloaded area a **"Not downloaded"** notice appears.
   - Check in the console: `window.__innerMap.tileStats` should show `fromDevice` rising and `fromNetwork` staying at 0.
5. Click **Start tracking**. GPS still works offline. On a laptop the position comes from OS location services. Use a phone with GPS for real satellite tracking (see below).
6. Add a saved place while offline. It shows *Waiting to sync* and a pending counter on the badge. Go back online and it syncs automatically to MySQL.
7. You can inspect the stored data in DevTools → **Application → IndexedDB → inner-map** (`tiles`, `regions`, `locations`, `outbox`) and **Cache Storage**.

### B2. KML/KMZ and Google Earth (tests 8–10)
1. **Get a real KML/KMZ.** Options:
   - In Google Earth (web or Pro), right-click a place or project and choose *Export as KML/KMZ*.
   - In Google My Maps, use *⋮ → Export to KML/KMZ*.
   - Use a GPS app's track export.
2. **Import (test 8).** **Layers & KML → Choose file...** The message lists how many markers, paths and polygons were imported and anything not shown. Click a shape to see its popup. The layer also appears on the Interactive Map, and in MySQL `map_layers` / `map_features`.
3. **Draw.** Choose **Path**, click 3–4 points, press **Finish**, give it a name, and **Save**. Try a **Polygon** and a **Marker** too.
4. **Export (test 9).** **Export everything → Download KML / KMZ**, or a single layer's **KML / KMZ** links, or **Saved Locations → Export KML**. Re-import the exported file into Inner Map; you should get the same number of features back.
5. **Google Earth.** Click **Open in Google Earth**. A `.kmz` downloads. Open Google Earth on the web from the link and import the file with *Projects → New project → Import KML file from computer*, or double-click the file if Google Earth Pro is installed.
6. **Offline.** With the network off, open **Layers & KML**. Your layers still show, importing still works (marked *not synced yet*), and exports still download. When you reconnect, they sync.
7. **No Google tiles (test 10).** In DevTools → **Application → IndexedDB → inner-map → tiles**, every key starts with the Inner Map Offline layer id. In **Network**, filter by `google`: nothing is requested unless you click the Google Earth link yourself.

### B3. 3D globe
1. Open **3D Globe**. The camera starts over your map data area. Drag, scroll and right-drag, and try the on-screen buttons and Cesium's 2D/3D switcher.
2. **Go to → (a layer name)** zooms in: you see the detailed Mumbai map with your places, layers and drawings on it. Tilt with the ⤒ button for a perspective view.
3. Press **Make 3D globe available offline** and wait for "Ready offline: 334 files, 6.3 MB".
4. Go offline (Wi-Fi off) and reload **3D Globe**. It opens, the downloaded area still shows streets, and **Whole Earth** shows the Natural Earth globe.
5. In DevTools → Network you will see only `localhost` requests. OpenStreetMap tiles are requested only if you choose that base imagery while online, and they are never stored.

### B4. GPS, full screen and directions
1. **Bigger map:** click ☰ in the toolbar; the sidebar shrinks to icons and the map widens.
2. **Full screen (phone):** tap ⤢. The map fills the screen, with zoom, layers and location still visible. Tap ⤢ again (or press Esc) and the normal layout returns.
3. **Online route:** Directions → Start "My location" or a saved place → pick a destination → **Find route**. The badge says *Online route*, and you get distance, time and steps.
4. **Offline route:**
   - On **Download area**, keep *Include road data for offline directions* ticked and download Mumbai. Offline maps should show "Road data: ready".
   - Turn off Wi-Fi, then use Directions between two places inside the area. The badge says *Offline route*, and the line follows the streets.
5. **Outside coverage:** offline, choose a destination outside the downloaded area. You get a warning, not a route.
6. **GPS offline (phone):** with Wi-Fi and mobile data off and GPS on, tap ◎. The blue dot appears on the downloaded map, and moves as you walk while tracking is on.

### C. Testing on a phone (real GPS)
Geolocation only works on **https** or **localhost**. To use a phone:
- Deploy the built `dist/` and the API behind HTTPS, or
- Use an HTTPS tunnel (for example `cloudflared tunnel --url http://localhost:4173`) and add that origin to `CORS_ORIGINS` in `backend/.env`. Requests go through the Vite proxy, so it is usually not needed.

Then open the URL on the phone, log in, download an area, and choose **Add to Home Screen**. Switch to flight mode with GPS on: the map and your position keep working.

## 8. Security and privacy notes
- Passwords are hashed with bcrypt (12 rounds). Login errors do not reveal whether an email exists. Login and register are rate-limited.
- JWTs are signed with `JWT_SECRET` from `.env`. Every user-scoped query filters by `user_id` from the token.
- All input is validated server-side. SQL uses parameterised queries only.
- Helmet sets security headers, and CORS allows only the origins listed in `CORS_ORIGINS`.
- Location is used on the device for display. It is sent to the server **only** when you turn on location history after reading the privacy notice, and you can delete all history at any time.
- Map tiles are never stored in MySQL.

## 9. Troubleshooting
| Problem | Fix |
|---|---|
| `Database is unavailable` | Start MySQL in XAMPP and import `database/inner_map_db.sql` |
| `ER_ACCESS_DENIED_ERROR` | Set `DB_USER`/`DB_PASSWORD` in `backend/.env` to match your MySQL user |
| Download button disabled | The active base map isn't downloadable (switch to Inner Map Offline), you are offline, the server is unreachable, or no map name was entered |
| Map is empty / "The server has no vector map file" | `backend/data/mumbai.pmtiles` is missing; see `backend/data/README.md` |
| "No map data here" | You are outside the area in the server's PMTiles file; use **Show data area** |
| KML import says "not valid XML" | The file is damaged or isn't KML. Re-export it from Google Earth or My Maps |
| Imported layer stays "not synced yet" | Run migration `003_map_layers_features.sql`, check the backend is running, then reconnect |
| "The 3D globe could not start ... WebGL" | Enable hardware acceleration in the browser settings, or update the graphics driver |
| "3D globe unavailable" offline | Open the globe once online and press **Make 3D globe available offline** |
| Globe page is blank after `npm install` | Run `npm run cesium:assets` in `frontend` (or `npm run dev` / `npm run build`, which run it automatically) |
| "Location permission was denied" | Browser site settings → Location → Allow, then reload |
| App does not open offline | Use `npm run build && npm run preview`, and load it once online first |
| Old version keeps showing | DevTools → Application → Service Workers → *Unregister*, then reload |
