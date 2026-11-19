// Prepares offline map data for one more city from the command line (the app's Download page
// does the same through POST /api/map-areas).
//
//   node scripts/extract-area.js --name="Pune" --bbox=73.70,18.40,74.05,18.70
//
// bbox = west,south,east,north (at most 1° across). Writes data/areas/<id>.pmtiles and adds it to
// data/areas/areas.json; restart is not needed - the server picks new files up automatically.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config/env');
const { extractArea } = require('../services/areaExtractService');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const [west, south, east, north] = String(args.bbox || '').split(',').map(Number);
if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
  console.error('Usage: node scripts/extract-area.js --name="City" --bbox=west,south,east,north');
  process.exit(1);
}
if (east - west > 1 || north - south > 1) {
  console.error('Area too large: at most 1 degree across (one city at a time).');
  process.exit(1);
}
const name = args.name || 'Map area';
const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'area'}-${crypto.randomBytes(3).toString('hex')}`;
const outFile = path.join(config.vectorAreasDir, `${id}.pmtiles`);
let shown = '';

extractArea({
  bounds: { west, south, east, north },
  outFile,
  name,
  onProgress: (p) => {
    const line = `${p.phase} ${Math.round((p.total ? p.done / p.total : 0) * 100)}%`;
    if (line !== shown) process.stdout.write(`\r${line}   `);
    shown = line;
  },
})
  .then((r) => {
    const regFile = path.join(config.vectorAreasDir, 'areas.json');
    let reg = { areas: [] };
    try {
      reg = JSON.parse(fs.readFileSync(regFile, 'utf8'));
    } catch {
      /* new registry */
    }
    reg.areas.push({ id, name, bounds: { west, south, east, north }, build: r.build, tiles: r.tiles, bytes: r.bytes, createdAt: new Date().toISOString() });
    fs.writeFileSync(regFile, JSON.stringify(reg, null, 2));
    console.log(`\n${name}: ${r.tiles} tiles, ${(r.bytes / 1048576).toFixed(1)} MB -> ${outFile}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nFailed:', err.message);
    process.exit(1);
  });
