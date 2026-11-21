// For hosting without a permanent disk (e.g. Render's free plan, where the disk is wiped on every
// restart): the map and road files in data/ (not in git - too big) are downloaded at start-up
// from DATA_BASE_URL when they are missing, e.g. the assets of a GitHub Release:
//
//   DATA_BASE_URL=https://github.com/<user>/<repo>/releases/download/data-v1
//   DATA_FILES=mumbai.pmtiles,mumbai.routing.json.gz,areas/areas.json,areas/pune-56f717.pmtiles,...
//
// A file "areas/x.pmtiles" is fetched from "<DATA_BASE_URL>/areas__x.pmtiles" (release assets
// cannot contain "/"). Nothing happens when DATA_BASE_URL is not set (local use).
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const config = require('../config/env');

const dataDir = path.dirname(config.vectorTilesFile);

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
}

async function ensureDataFiles() {
  if (!config.dataBaseUrl || !config.dataFiles.length) return;
  for (const rel of config.dataFiles) {
    const dest = path.join(dataDir, rel);
    if (fs.existsSync(dest)) continue;
    const t = Date.now();
    await download(`${config.dataBaseUrl}/${rel.replace(/\//g, '__')}`, dest);
    console.log(`[data] ${rel}: ${(fs.statSync(dest).size / 1048576).toFixed(1)} MB in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }
}

module.exports = { ensureDataFiles };
