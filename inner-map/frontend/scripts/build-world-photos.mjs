// Builds frontend/public/data/world-photos.json - the famous places shown as photos on the
// 3D Earth when you look at a whole country or continent (closer in, the app asks Wikidata
// for the places in view instead).
//
//   node scripts/build-world-photos.mjs
//
// Source: Wikidata (CC0 - free for any use). Only the photo's file name on Wikimedia Commons is
// stored; the photos themselves are loaded from Commons when shown (online only) and each is
// credited there with its own author and licence.
// Places: UNESCO World Heritage Sites, plus well-known palaces, forts, temples, churches,
// mosques, museums, towers, bridges, beaches, waterfalls, lakes, mountains, national parks and
// big cities. "Famous" = number of Wikipedia language editions with an article (sitelinks).
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'data', 'world-photos.json');
const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'InnerMap-build/1.0 (world photos dataset; https://github.com/)';

// [kind, class QIDs, minimum sitelinks]
const GROUPS = [
  ['heritage', null, 0], // UNESCO World Heritage Sites (P1435 = Q9259)
  ['landmark', ['Q16560', 'Q23413', 'Q1785071', 'Q57821', 'Q57831'], 10], // palace, castle, fort, fortification, fortress
  ['landmark', ['Q44539', 'Q842402', 'Q32815', 'Q16970', 'Q2977', 'Q160742', 'Q44613', 'Q5393308'], 22], // temple, Hindu temple, mosque, church, cathedral, abbey, monastery, Buddhist temple
  ['landmark', ['Q33506', 'Q207694', 'Q4989906', 'Q575759', 'Q570116', 'Q2319498'], 20], // museum, art museum, monument, war memorial, tourist attraction, landmark
  ['landmark', ['Q143912', 'Q162875'], 10], // triumphal arch, mausoleum
  ['landmark', ['Q12518', 'Q11303', 'Q12280', 'Q158438', 'Q483453', 'Q1497364'], 22], // tower, skyscraper, bridge, arch bridge, fountain, building complex
  ['nature', ['Q40080', 'Q34038', 'Q23397', 'Q46169', 'Q8502', 'Q8072', 'Q39816', 'Q150784'], 25], // beach, waterfall, lake, national park, mountain, volcano, valley, canyon
  ['city', ['Q1637706', 'Q1549591', 'Q5119', 'Q515', 'Q200250'], 90], // million city, big city, capital, city, metropolis
];

async function sparql(query, attempt = 1) {
  const res = await fetch(SPARQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
    body: new URLSearchParams({ query }),
  });
  const text = await res.text();
  let rows = null;
  try {
    if (res.ok) rows = JSON.parse(text).results.bindings;
  } catch {
    rows = null; // the service timed out half-way and appended its error to the answer
  }
  if (!rows) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      return sparql(query, attempt + 1);
    }
    throw new Error(`Wikidata answered ${res.status}: ${text.slice(0, 120)}`);
  }
  return rows;
}

function queryFor([kind, classes, min]) {
  const match =
    kind === 'heritage'
      ? '?item wdt:P1435 wd:Q9259 .'
      : `VALUES ?class { ${classes.map((q) => `wd:${q}`).join(' ')} } ?item wdt:P31 ?class .`;
  return `SELECT ?item ?itemLabel ?itemDescription ?coord ?image ?links WHERE {
  ${match}
  ?item wdt:P625 ?coord ; wdt:P18 ?image ; wikibase:sitelinks ?links .
  FILTER(?links >= ${min})
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
}`;
}

const r4 = (v) => Math.round(v * 10000) / 10000;
const places = new Map();
const jobs = GROUPS.flatMap(([kind, classes, min]) => (classes ? classes.map((c) => [kind, [c], min]) : [[kind, null, min]]));
for (const group of jobs) {
  let rows;
  try {
    rows = await sparql(queryFor(group));
  } catch (err) {
    console.warn(`skipped ${group[1]?.join(',')}: ${err.message}`);
    continue;
  }
  let added = 0;
  for (const b of rows) {
    const id = b.item.value.split('/').pop();
    const title = b.itemLabel?.value;
    const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord.value);
    if (!m || !title || /^Q\d+$/.test(title) || places.has(id)) continue;
    const file = decodeURIComponent(b.image.value.split('/Special:FilePath/')[1] || '').replace(/_/g, ' ');
    if (!file) continue;
    places.set(id, {
      id,
      t: title,
      d: (b.itemDescription?.value || '').slice(0, 120),
      lat: r4(Number(m[2])),
      lng: r4(Number(m[1])),
      f: file,
      n: Number(b.links.value),
      k: group[0],
    });
    added++;
  }
  console.log(`${group[0]} (${group[1]?.join(',') || 'P1435=Q9259'}): ${rows.length} rows, ${added} new`);
  await new Promise((r) => setTimeout(r, 1500)); // be gentle with the public query service
}

// Many World Heritage entries are parts of one site (e.g. 20 churches): keep at most 3 places
// within ~2 km of each other, the most famous first.
const list = [...places.values()].sort((a, b) => b.n - a.n);
const kept = [];
const grid = new Map();
for (const p of list) {
  const key = `${Math.round(p.lat * 50)},${Math.round(p.lng * 50)}`;
  const n = grid.get(key) || 0;
  if (n >= 3) continue;
  grid.set(key, n + 1);
  kept.push(p);
}

writeFileSync(
  out,
  JSON.stringify({
    source: 'Wikidata (CC0); photos: Wikimedia Commons (credited per photo)',
    built: new Date().toISOString().slice(0, 10),
    places: kept,
  })
);
console.log(`wrote ${kept.length} places to ${out}`);
