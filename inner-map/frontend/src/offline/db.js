// IndexedDB schema for everything Inner Map keeps on the device.
//
//  tiles      key = "<layerId>/<z>/<x>/<y>"  { key, blob, size, regions: [regionId...], storedAt }
//             index "regions" (multiEntry) -> find every tile a region uses.
//             A tile shared by overlapping regions is stored ONCE and reference-counted.
//  regions    key = id (uuid)   downloaded-area metadata and download progress
//  locations  key = localId     saved places cached for offline use
//  outbox     auto-increment    API calls made while offline, replayed when back online
import { openDB } from 'idb';

const DB_NAME = 'inner-map';
// v2 (Stage B): adds `layers` and `features` for KML/KMZ/GeoJSON imports and drawings.
//  layers     key = localId   { localId, serverId, userId, name, source, fileName, visible, bounds, ... }
//  features   key = localId   { localId, serverId, userId, layerLocalId, order, name, description,
//                               geometry (GeoJSON), style, pending }
// v3 (routing): adds `routing` - the road graph of a downloaded area for offline directions.
//  routing    key = regionId  { regionId, userId, bounds, graph, bytes, edges, storedAt }
const DB_VERSION = 3;

let dbPromise;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('tiles')) {
          const tiles = db.createObjectStore('tiles', { keyPath: 'key' });
          tiles.createIndex('regions', 'regions', { multiEntry: true });
        }
        if (!db.objectStoreNames.contains('regions')) {
          const regions = db.createObjectStore('regions', { keyPath: 'id' });
          regions.createIndex('userId', 'userId');
        }
        if (!db.objectStoreNames.contains('locations')) {
          const locations = db.createObjectStore('locations', { keyPath: 'localId' });
          locations.createIndex('userId', 'userId');
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
          outbox.createIndex('userId', 'userId');
        }
        if (!db.objectStoreNames.contains('layers')) {
          const layers = db.createObjectStore('layers', { keyPath: 'localId' });
          layers.createIndex('userId', 'userId');
        }
        if (!db.objectStoreNames.contains('features')) {
          const features = db.createObjectStore('features', { keyPath: 'localId' });
          features.createIndex('layerLocalId', 'layerLocalId');
          features.createIndex('userId', 'userId');
        }
        if (!db.objectStoreNames.contains('routing')) {
          const routing = db.createObjectStore('routing', { keyPath: 'regionId' });
          routing.createIndex('userId', 'userId');
        }
      },
      blocked() {
        console.warn('[db] Close other Inner Map tabs to finish upgrading local storage.');
      },
      blocking() {
        // A newer version of the app opened in another tab: let it upgrade, then reload this one.
        dbPromise?.then((db) => db.close());
        dbPromise = null;
        window.location.reload();
      },
    });
  }
  return dbPromise;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
