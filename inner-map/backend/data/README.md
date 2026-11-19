# Offline vector map data

`mumbai.pmtiles` is the map data the backend serves at `/tiles/vector/{z}/{x}/{y}.mvt`.
It is **not** committed to git (about 19 MB). Recreate it or add another area with the
official `pmtiles` command-line tool.

## Source and licence

- Data: the Protomaps Basemap, built daily from **OpenStreetMap** (plus Natural Earth at low zooms).
- Licence: OpenStreetMap data is © OpenStreetMap contributors, under the
  [Open Database License (ODbL)](https://www.openstreetmap.org/copyright). The map must show
  "© OpenStreetMap contributors"; Inner Map does this in the map's attribution.
- Protomaps asks people **not** to scrape its tile API, and recommends downloading a build or
  extracting a region with `pmtiles extract`, which is what we do. We never download from
  `tile.openstreetmap.org`.

## 1. Get the pmtiles tool (Windows)

Download `go-pmtiles_<version>_Windows_x86_64.zip` from
<https://github.com/protomaps/go-pmtiles/releases> and unzip it, e.g. to `D:\InnerMap\tools\pmtiles\`.

```bash
D:\InnerMap\tools\pmtiles\pmtiles.exe version
```

## 2. Extract an area

Daily builds are listed at <https://maps.protomaps.com/builds/> and named `YYYYMMDD.pmtiles`
(only the last few days are kept, so use a recent date).

Mumbai (the bundled demo area, west,south,east,north):

```bash
D:\InnerMap\tools\pmtiles\pmtiles.exe extract https://build.protomaps.com/20261117.pmtiles backend\data\mumbai.pmtiles --bbox=72.75,18.85,73.10,19.35
```

Check it:

```bash
D:\InnerMap\tools\pmtiles\pmtiles.exe show backend\data\mumbai.pmtiles
```

## 3. Road data for offline directions (`mumbai.routing.json.gz`)

Offline routing needs the **road network**, not just map tiles: which roads connect, one-way
streets, access rules (private, footways, motorways), speed limits and street names. PMTiles
vector tiles are simplified for drawing and do not contain that reliably, so Inner Map builds a
separate road graph from OpenStreetMap:

```bash
cd backend
node scripts/build-routing-graph.mjs --name=mumbai --bbox=72.75,18.85,73.10,19.35 --grid=6
```

- Downloads the roads (`highway=*`) in the box from public Overpass API servers, in `grid x grid`
  small cells, with retries. One-off and light (well under their 1 GB/day guidance); responses are
  cached in `data/.osm-cache/`, so a rebuild does not download again.
- Builds the graph with `shared/routing/graph.mjs` (junctions + road segments with length,
  one-way and access flags per travel mode, car speed, name and shape).
- Writes `data/mumbai.routing.json.gz` (not committed to git). The backend serves pieces of it at
  `/api/routing/graph`; the app stores them with downloaded areas ("Include road data").
- Public Overpass servers are often busy: the script waits and retries automatically. If one
  server keeps failing, pass `--overpass=URL[,URL]` to choose others.
- Data © OpenStreetMap contributors (ODbL). The app shows this attribution with each route.

To route in another city, build it with another `--name` and `--bbox` and set `ROUTING_GRAPH_FILE`
in `backend/.env`.

## Other areas (map tiles)

To serve a different area, extract it to another file and set `VECTOR_TILES_FILE` in
`backend/.env` (for example `VECTOR_TILES_FILE=data/pune.pmtiles`), then restart the backend.
Users can download, for offline use, any part of the area covered by this file.

## More cities (offline map areas)

Besides the main file, the server serves every extra area in `data/areas/*.pmtiles`
(listed in `data/areas/areas.json`; not committed to git). There are two ways to add one:

- **In the app:** on the Download page, select a city outside the existing areas and press
  **Prepare map data for this area**. The server copies that city's tiles out of the latest
  Protomaps daily build (the same as `pmtiles extract`, written in JavaScript in
  `services/areaExtractService.js`), then the area can be downloaded to devices like Mumbai.
  Limits: signed-in users, one area at a time, at most 1° (≈110 km) across.
- **From the command line:**

  ```bash
  node scripts/extract-area.js --name="Pune" --bbox=73.75,18.45,73.98,18.62
  ```

A city usually takes 10-60 seconds and 5-40 MB. New areas are picked up without a restart.
Offline **directions** still need a road graph per city (section 3 above).
