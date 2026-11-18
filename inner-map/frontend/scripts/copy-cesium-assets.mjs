// Copies CesiumJS's static files (web workers, built-in imagery, widget CSS/images) from
// node_modules into public/cesium so they are served by our own app - never from a CDN or
// Cesium ion - and writes public/cesium/manifest.json listing every file, which the
// "Make 3D globe available offline" button uses to store them in the browser cache.
//
// Runs automatically before `npm run dev` and `npm run build` (see package.json).
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const dest = join(root, 'public', 'cesium');
const FOLDERS = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];

if (!existsSync(src)) {
  console.error('[cesium] node_modules/cesium is missing. Run `npm install` first.');
  process.exit(1);
}

// Bump COPY_RULES when the copy rules change, so existing copies are rebuilt.
const COPY_RULES = 2;
const version = `${JSON.parse(readFileSync(join(root, 'node_modules', 'cesium', 'package.json'), 'utf8')).version}+r${COPY_RULES}`;
const manifestPath = join(dest, 'manifest.json');
if (existsSync(manifestPath)) {
  try {
    if (JSON.parse(readFileSync(manifestPath, 'utf8')).version === version) process.exit(0); // up to date
  } catch {
    /* rebuild */
  }
}

// Files Inner Map never uses: Cesium's base-layer-picker icons and decoders for Google Earth
// Enterprise / Google imagery services. Left out so nothing Google-related is ever stored.
const EXCLUDE = /google/i;

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const f of FOLDERS) {
  cpSync(join(src, f), join(dest, f), { recursive: true, filter: (p) => !EXCLUDE.test(relative(src, p)) });
}

const files = [];
let bytes = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else {
      files.push(`/cesium/${relative(dest, p).split('\\').join('/')}`);
      bytes += st.size;
    }
  }
};
walk(dest);
writeFileSync(manifestPath, JSON.stringify({ version, bytes, files }, null, 0));
console.log(`[cesium] Copied Cesium ${version} assets: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
