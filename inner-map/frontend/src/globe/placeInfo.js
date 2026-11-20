// Facts for the place card shown when a place or city is searched on the Earth page (online):
//  - OpenStreetMap (Nominatim lookup / reverse): names (also in the local language), region,
//    country, kind, and the Wikidata id
//  - Wikipedia (REST summary, via the Wikidata id): a short description ("quick facts") and the
//    article's lead photo
// Nothing is invented: what a source does not have is simply not shown.
import { isOnline } from '../offline/connectivity';
import { nominatim } from './exploreSearch';

const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const cache = new Map();

const KIND = {
  city: 'City', town: 'Town', village: 'Village', hamlet: 'Hamlet', suburb: 'Neighbourhood', neighbourhood: 'Neighbourhood',
  state: 'State', country: 'Country', county: 'District', administrative: 'Area', island: 'Island',
};

// the local language of a place (for its name in the local script)
const IN_STATE_LANG = {
  Maharashtra: 'mr', Goa: 'kok', Gujarat: 'gu', 'Tamil Nadu': 'ta', Puducherry: 'ta', Kerala: 'ml', Karnataka: 'kn',
  Telangana: 'te', 'Andhra Pradesh': 'te', 'West Bengal': 'bn', Tripura: 'bn', Punjab: 'pa', Odisha: 'or', Assam: 'as',
  Manipur: 'mni', 'Jammu and Kashmir': 'ur',
};
const COUNTRY_LANG = {
  cn: 'zh', tw: 'zh', hk: 'zh', jp: 'ja', kr: 'ko', ru: 'ru', ua: 'uk', by: 'be', bg: 'bg', rs: 'sr', gr: 'el', il: 'he',
  sa: 'ar', ae: 'ar', eg: 'ar', iq: 'ar', jo: 'ar', ma: 'ar', dz: 'ar', ir: 'fa', af: 'ps', pk: 'ur', bd: 'bn', np: 'ne',
  lk: 'si', th: 'th', la: 'lo', kh: 'km', mm: 'my', ge: 'ka', am: 'hy', et: 'am', mn: 'mn', kz: 'kk',
};

function osmIdOf(row) {
  const m = /^osm-(node|way|relation)-(\d+)$/.exec(row?.id || '');
  return m ? `${m[1][0].toUpperCase()}${m[2]}` : null;
}

async function wikipediaFor(qid, lang = 'en') {
  const params = new URLSearchParams({ action: 'wbgetentities', ids: qid, props: 'sitelinks/urls', sitefilter: `${lang}wiki`, format: 'json', origin: '*' });
  const d = await fetch(`${WIKIDATA_API}?${params}`).then((r) => (r.ok ? r.json() : null));
  const link = d?.entities?.[qid]?.sitelinks?.[`${lang}wiki`];
  if (!link?.title) return null;
  const s = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(link.title.replace(/ /g, '_'))}`).then((r) => (r.ok ? r.json() : null));
  if (!s || s.type === 'disambiguation') return null;
  return {
    extract: s.extract || '',
    description: s.description || '',
    photo: s.originalimage?.source || s.thumbnail?.source || null,
    thumb: s.thumbnail?.source || null,
    url: s.content_urls?.desktop?.page || link.url || null,
    title: s.title,
  };
}

/** -> { name, localName, region, country, kind, lat, lng, wikidata, wiki: {extract, photo, url} } */
export function fetchPlaceInfo(row) {
  const key = row.id || `${row.lat?.toFixed(4)},${row.lng?.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const base = { name: (row.name || '').split(',')[0], lat: row.lat, lng: row.lng, kind: row.type || '', region: '', country: '', localName: '' };
    if (!isOnline() || row.lat == null) return base;
    const osmId = osmIdOf(row);
    const params = { extratags: '1', namedetails: '1', addressdetails: '1', 'accept-language': 'en' };
    let r = null;
    try {
      if (osmId) r = (await nominatim('lookup', { ...params, osm_ids: osmId }))?.[0] || null;
      if (!r) r = await nominatim('reverse', { ...params, lat: row.lat.toFixed(6), lon: row.lng.toFixed(6), zoom: row.bounds ? '10' : '16' });
    } catch {
      return base;
    }
    if (!r || r.error) return base;
    const a = r.address || {};
    const nd = r.namedetails || {};
    const name = nd['name:en'] || r.name || base.name;
    // the name in the local script (e.g. नागपूर), like a local sign would show it
    const nonLatin = (v) => typeof v === 'string' && /[^\u0000-ɏḀ-ỿ\s\-.,'’()&]/.test(v);
    const lang = (a.country_code === 'in' ? IN_STATE_LANG[a.state] || 'hi' : COUNTRY_LANG[a.country_code]) || null;
    const local = nonLatin(nd.name) ? nd.name : lang && nonLatin(nd[`name:${lang}`]) ? nd[`name:${lang}`] : '';
    const info = {
      ...base,
      name: name || base.name,
      localName: local,
      region: [a.state_district && a.state_district !== name ? a.state_district : null, a.state && a.state !== name ? a.state : null].filter(Boolean)[0] || '',
      country: a.country && a.country !== name ? a.country : '',
      kind: KIND[r.addresstype] || KIND[r.type] || (r.type || '').replace(/_/g, ' '),
      wikidata: r.extratags?.wikidata || null,
      wiki: null,
    };
    if (info.wikidata) {
      try {
        info.wiki = await wikipediaFor(info.wikidata);
      } catch {
        info.wiki = null;
      }
    }
    return info;
  })().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, p);
  return p;
}

/** The place's local time from a UTC offset in seconds, e.g. "1:49 PM". */
export function localTime(utcOffset) {
  if (utcOffset == null) return '';
  const d = new Date(Date.now() + utcOffset * 1000);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

// ---------------------------------------------------------------- fast path: Wikipedia by name
function km(a, b) {
  const r = Math.PI / 180;
  const s = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(s));
}
const wikiCache = new Map();
/**
 * Wikipedia summary found straight from the place's name - only accepted when the article's
 * coordinates are near the place (so a different place with the same name is never shown).
 */
export function fetchWikiByName(row) {
  const name = (row.name || '').split(',')[0].trim();
  const key = `${name}|${row.lat?.toFixed(2)},${row.lng?.toFixed(2)}`;
  if (!name || row.lat == null || !isOnline()) return Promise.resolve(null);
  if (wikiCache.has(key)) return wikiCache.get(key);
  const maxKm = row.bounds ? Math.max(30, (row.bounds.north - row.bounds.south) * 111) : 15;
  const p = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name.replace(/ /g, '_'))}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((s) => {
      if (!s || s.type === 'disambiguation' || !s.coordinates) return null;
      if (km({ lat: s.coordinates.lat, lng: s.coordinates.lon }, { lat: row.lat, lng: row.lng }) > maxKm) return null;
      return {
        extract: s.extract || '',
        description: s.description || '',
        photo: s.originalimage?.source || s.thumbnail?.source || null,
        thumb: s.thumbnail?.source || null,
        url: s.content_urls?.desktop?.page || null,
        title: s.title,
      };
    })
    .catch(() => null);
  wikiCache.set(key, p);
  return p;
}
