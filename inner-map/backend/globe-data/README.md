# Optional local data for the 3D globe

The 3D globe works without anything in this folder:

- **Detailed map:** your downloaded Inner Map Offline (OpenStreetMap) areas are drawn on the
  globe straight from the device.
- **Base imagery:** CesiumJS's built-in *Natural Earth II* image of the whole Earth. It is
  public domain but very low resolution (about 20 km per pixel at its sharpest), so it shows
  continents, deserts, forests and ice, not cities or streets.
- **Terrain:** a smooth ellipsoid (no mountains).

To add more, put **properly licensed** data here. Only use data whose licence allows you to
store and serve it, and fill in the attribution so the globe can credit it.

## Higher-resolution imagery: `imagery/`

XYZ (or TMS) raster tiles plus an `info.json`:

```
globe-data/imagery/info.json
globe-data/imagery/{z}/{x}/{y}.png   (or .jpg)
```

`info.json`:

```json
{
  "name": "Mumbai Sentinel-2 2026",
  "attribution": "Contains modified Copernicus Sentinel data 2026",
  "format": "jpg",
  "scheme": "xyz",
  "minZoom": 0,
  "maxZoom": 14,
  "bounds": { "west": 72.75, "south": 18.85, "east": 73.10, "north": 19.35 }
}
```

Ways to make the tiles:

- **QGIS:** load your licensed raster (for example a Copernicus Sentinel-2 scene you
  downloaded from the Copernicus Data Space, or public-domain NASA imagery), then run
  *Processing → Raster tools → Generate XYZ tiles (Directory)* into `globe-data/imagery`.
- **GDAL:** `gdal2tiles.py --xyz -z 0-14 input.tif globe-data/imagery`

Do **not** put Google, Bing or other imagery here unless your licence explicitly allows
offline storage and redistribution. Google's terms do not.

## Terrain (3D relief): `terrain/`

Cesium *quantized-mesh* tiles with a `layer.json`, for example made from a free elevation
model (SRTM or Copernicus DEM GLO-30) with
[cesium-terrain-builder](https://github.com/geo-data/cesium-terrain-builder):

```
ctb-tile -f Mesh -C -N -o globe-data/terrain dem.tif
ctb-tile -f Mesh -C -N -l -o globe-data/terrain dem.tif   # writes layer.json
```

Optionally add `terrain/info.json` with `{ "name": "...", "attribution": "..." }`.
Gzip-compressed `.terrain` files are detected and served with the right header.

Restart the backend after adding data. The **3D Globe** page lists what it found.
