// Google Earth interoperability.
//
// Google Earth has no embeddable SDK and no official "open this KML from a link" API.
// What Google officially supports is importing KML/KMZ files:
//   - Google Earth on the web: Projects -> New project -> Import KML file from computer
//     (or "Open local KML editor" -> Open KML from device, which needs no sign-in)
//   - Google Earth Pro (desktop): File -> Open, or double-click the .kmz file
//   - Google Earth mobile: Projects -> New -> Import KML file
// So "Open in Google Earth" downloads a KMZ and opens Google Earth on the web at the
// area's location; the user then imports the downloaded file.
// https://developers.google.com/maps/documentation/earth/import-data
import { kmzBlob, downloadBlob, safeFileName } from './kml';

export const GOOGLE_EARTH_WEB = 'https://earth.google.com/web/';

/**
 * Google Earth web URL centred on the bounds. The "@lat,lng,alt a,range d,..." view syntax
 * is what Google Earth itself puts in its address bar; it is not a documented API, so if
 * Google changes it, Earth simply opens at its default view.
 */
export function earthViewUrl(bounds) {
  if (!bounds) return GOOGLE_EARTH_WEB;
  const lat = (bounds.south + bounds.north) / 2;
  const lng = (bounds.west + bounds.east) / 2;
  const spanM = Math.max(
    (bounds.north - bounds.south) * 111000,
    (bounds.east - bounds.west) * 111000 * Math.cos((lat * Math.PI) / 180)
  );
  const range = Math.max(800, Math.min(5e6, spanM * 1.6));
  return `${GOOGLE_EARTH_WEB}@${lat.toFixed(6)},${lng.toFixed(6)},0a,${Math.round(range)}d,35y,0h,0t,0r`;
}

/** Download the KMZ for Google Earth and return what the UI needs to show next steps. */
export async function prepareForGoogleEarth(kmlText, name, bounds) {
  const fileName = `${safeFileName(name)}.kmz`;
  downloadBlob(await kmzBlob(kmlText), fileName);
  return { fileName, url: earthViewUrl(bounds), name };
}
