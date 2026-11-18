// Must be imported BEFORE 'cesium': tells CesiumJS to load its workers, built-in imagery
// and widget assets from our own server (/cesium, copied by scripts/copy-cesium-assets.mjs)
// instead of a CDN. Nothing is fetched from Cesium ion.
window.CESIUM_BASE_URL = '/cesium/';
