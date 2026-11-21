// For hosting without a permanent disk (e.g. Render's free plan, where the disk is wiped on every
// restart): the map and road files in data/ are not in git (too big for every developer), so at
// start-up any missing file is filled in from
//   1. backend/data-render/ - a copy of the hosted maps that IS in the repo (deployed with the code), or
//   2. DATA_BASE_URL - a download link, e.g. the assets of a GitHub Release
//      (a file "areas/x.pmtiles" is fetched as "<DATA_BASE_URL>/areas__x.pmtiles").
// DATA_FILES lists the files (e.g. mumbai.pmtiles,areas/areas.json,areas/pune-56f717.pmtiles);
// without it, every file in data-render/ is used. Files already in data/ are never replaced, so
// nothing changes on a computer that has its own data/.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('../config/env');

const dataDir = path.dirname(config.vectorTilesFile);
const bundledDir = path.join(__dirname, '..', 'data-render');

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

/** Every file in data-render/, as paths relative to it (areas/x.pmtiles). */
function bundledFiles(dir = bundledDir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? bundledFiles(path.join(dir, d.name), `${prefix}${d.name}/`) : [`${prefix}${d.name}`]
  );
}

async function ensureDataFiles() {
  const files = config.dataFiles.length ? config.dataFiles : bundledFiles();
  for (const rel of files) {
    const dest = path.join(dataDir, rel);
    if (fs.existsSync(dest)) continue;
    const bundled = path.join(bundledDir, rel);
    if (fs.existsSync(bundled)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(bundled, dest);
      console.log(`[data] ${rel}: ${(fs.statSync(dest).size / 1048576).toFixed(1)} MB (from data-render)`);
      continue;
    }
    if (!config.dataBaseUrl) {
      console.warn(`[data] ${rel}: missing (not in data-render/ and no DATA_BASE_URL)`);
      continue;
    }
    const t = Date.now();
    try {
      await download(`${config.dataBaseUrl}/${rel.replace(/\//g, '__')}`, dest);
      console.log(`[data] ${rel}: ${(fs.statSync(dest).size / 1048576).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(0)} s`);
    } catch (err) {
      console.warn(`[data] ${rel}: ${err.message}`); // keep going: the other files may still work
    }
  }
}

module.exports = { ensureDataFiles };
