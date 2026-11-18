# Inner Map – major upgrade plan (GPS, search, map views, offline data, measure, navigation)

Additive changes only. Each stage is built, tested and committed before the next starts.
Checkpoint before this upgrade: commit `88bc572`.

## What already exists (inspected)

| Area | Existing | Gap |
|---|---|---|
| GPS | `LocationContext`: watch/one-off fixes, high accuracy, live vs last-known, accuracy circle, error texts, resume after reload, works offline (device GPS) | No startup flow, no loading state, status only visible with a fix, no Retry |
| Search | `SearchBox`: saved places, KML layers, offline map names offline; Nominatim online on Enter | No place/POI index offline, no categories, no distance, small box |
| Map views | Providers: `local-vector` (Protomaps, offline), `osm-standard` (online), optional `custom-raster` | No satellite, terrain or transit view |
| Downloads | Region select, size estimate, zoom range, progress, resume, cancel, delete, road data | No visual preview modes, no pause button, no bulk delete, no search/POI data |
| Measure | Length/area text while drawing on Layers page | No Measure tool on the map |
| Routing | Online OSRM (car, bike, foot) via backend; offline in-browser router on an OSM road graph (car, bike, foot); turn-by-turn steps; Mumbai graph built | No motorcycle profile, no "start navigation" mode with remaining distance/time and re-routing |
| Navigation menu | Layers & KML in sidebar, bottom nav and map layer popover | To be hidden (data and API kept) |

## Stages

1. **GPS-first startup** (done) – permission check; one-time explanation before the browser prompt; auto-start when already granted; locating / live / last-known / denied / unavailable states with Retry; toolbar GPS indicator; map flies to the first live fix.
2. **Search** (done) – larger search box (clear button, keyboard navigation, responsive). Offline place index built from the downloaded vector tiles (places, roads, POIs with `kind`) into IndexedDB at download time; categories mapped from OSM/Protomaps `kind`; distance from GPS; coordinate search; "available offline" marker; online Nominatim with its 1 req/s policy and attribution.
3. **Map views** (done) – selector Default / Satellite / Terrain / Transit; base layer swapped without re-creating the map (center, zoom, GPS and route preserved). Candidate sources (licence to be confirmed per source before enabling): Esri World Imagery (online only, attribution, no bulk download); EOX Sentinel-2 cloudless (CC BY-NC-SA, ~10 m, offline-downloadable for non-commercial use); AWS/Mapzen Terrain Tiles (open elevation, offline-downloadable) rendered as hillshade; transit from OSM rail/station data in the vector tiles (offline) plus OpenRailwayMap overlay online. Views without coverage say so.
4. **Region preview + offline data packs** (done) – preview map in the download panel with Default/Satellite/Terrain modes, coverage outline, per-pack sizes, storage estimate; packs: vector map, search/POI index, road graph, terrain, licensed imagery. Pause/resume/cancel/retry, bulk delete; regional delete never touches other regions (tile refcounts already do this).
5. **Buildings and businesses** (done) – building footprints and names / POI labels with category filter from the vector data; only labels that exist in the data.
6. **Measure tool** (done) – distance (multi-point, segments, m/km), area (m², km², ha, acres), labelled “straight-line”; works offline.
7. **Navigation** – motorcycle profile (offline from OSM `motorcycle`/`motor_vehicle` access tags; online only if the configured service has one, otherwise clearly “car profile”); navigation mode: next instruction, remaining distance/time, ETA, off-route re-routing, GPS accuracy, online/offline badge. GraphHopper/Valhalla evaluated against the existing in-browser router.
8. **Hide Layers & KML** from navigation (sidebar, bottom nav, More sheet, map popover); routes, data and API kept.
9. **Responsive pass + full regression test.**
