// Photos of famous places on the 3D Earth (the "Photos" layer).
//
// Source: Wikidata (places with coordinates and a photo, CC0 data) and Wikimedia Commons (the
// photos themselves, each with its own author and free licence, shown in the photo viewer).
// "Famous" = how many Wikipedia language editions have an article about the place.
// Online only: nothing is stored on the device. Only the centre and radius of the current view
// are sent to Wikidata - no account or personal data.
import { Cartesian2, Cartesian3, Cartographic, Ellipsoid, EllipsoidalOccluder, Math as CesiumMath, SceneTransforms } from 'cesium';

const SPARQL = 'https://query.wikidata.org/sparql';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const FILE_PATH = 'https://commons.wikimedia.org/wiki/Special:FilePath/';
const CLIENT = 'InnerMap/1.0 (Earth photos layer)';

export const PHOTOS_MAX_HEIGHT = 900000; // metres of camera height: further out only the built-in world list is used
const WORLD_MAX = 160; // world-list places considered per view (the markers then declutter them)
const MAX_RADIUS_KM = 100;
const LIMIT = 60;

export const thumbUrl = (file, width = 330) => `${FILE_PATH}${encodeURIComponent(file)}?width=${width}`;
export const filePageUrl = (file) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, '_'))}`;

function fileNameFromUrl(url) {
  const last = url.split('/Special:FilePath/')[1] || '';
  return decodeURIComponent(last).replace(/_/g, ' ');
}

const cache = new Map(); // key -> Promise<photo[]>

// ------------------------------------------------------------ built-in world list
// /data/world-photos.json (scripts/build-world-photos.mjs): ~6000 famous places worldwide, so the
// whole-Earth view has photos without asking Wikidata about half the planet.
let worldPromise = null;
export function loadWorldPhotos() {
  if (!worldPromise) {
    worldPromise = fetch('/data/world-photos.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) =>
        d.places.map((p) => ({ id: p.id, title: p.t, description: p.d, lat: p.lat, lng: p.lng, file: p.f, fame: p.n, kind: p.k, article: null }))
      )
      .catch((err) => {
        worldPromise = null;
        throw err;
      });
  }
  return worldPromise;
}

/** The most famous world-list places inside the current view. */
export function worldPhotosInView(list, viewer) {
  if (!list?.length) return [];
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, viewer.camera.positionWC);
  const out = [];
  for (const p of list) {
    if (rect) {
      const lat = CesiumMath.toRadians(p.lat);
      const lng = CesiumMath.toRadians(p.lng);
      if (lat < rect.south || lat > rect.north) continue;
      const inLng = rect.west <= rect.east ? lng >= rect.west && lng <= rect.east : lng >= rect.west || lng <= rect.east;
      if (!inLng) continue;
    }
    if (!occluder.isPointVisible(Cartesian3.fromDegrees(p.lng, p.lat))) continue;
    out.push(p);
    if (out.length >= WORLD_MAX) break;
  }
  return out;
}

/** Joins lists of places (same place once), most famous first. */
export function mergePhotos(...lists) {
  const byId = new Map();
  for (const list of lists) for (const p of list || []) if (!byId.has(p.id)) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => b.fame - a.fame);
}

/** Search radius (km) that covers the current view. */
export function viewRadiusKm(viewer, center) {
  const h = viewer.camera.positionCartographic.height;
  let r = (h / 1000) * 0.7;
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (rect && center) {
    const corner = Cartesian3.fromRadians(rect.east, rect.north);
    const mid = Cartesian3.fromDegrees(center.lng, center.lat);
    r = Math.min(r * 1.5, Cartesian3.distance(corner, mid) / 1000);
  }
  return Math.max(1, Math.min(MAX_RADIUS_KM, r));
}

/** Rounds centre and radius so small camera moves reuse the same search. */
export function searchKey(lat, lng, radiusKm) {
  const r = Math.SQRT2 ** Math.round(Math.log(radiusKm) / Math.log(Math.SQRT2)); // ~1.4x steps
  const radius = Math.max(1, Math.min(MAX_RADIUS_KM, Math.round(r * 10) / 10));
  const stepDeg = Math.max(0.005, radius / 3 / 111);
  const la = Math.round(lat / stepDeg) * stepDeg;
  const ln = Math.round(lng / stepDeg) * stepDeg;
  return { key: `${la.toFixed(4)},${ln.toFixed(4)},${radius}`, lat: la, lng: ln, radius };
}

/**
 * Famous places with a photo within radiusKm of (lat, lng), most famous first.
 * photo: { id, title, description, lat, lng, file, fame, article }
 */
export function fetchPlacePhotos({ lat, lng, radius, key }, signal) {
  if (cache.has(key)) return cache.get(key);
  const query = `SELECT ?item ?itemLabel ?itemDescription ?coord ?image ?links ?article WHERE {
  SERVICE wikibase:around {
    ?item wdt:P625 ?coord .
    bd:serviceParam wikibase:center "Point(${lng.toFixed(5)} ${lat.toFixed(5)})"^^geo:wktLiteral .
    bd:serviceParam wikibase:radius "${radius}" .
  }
  ?item wdt:P18 ?image ; wikibase:sitelinks ?links .
  FILTER(?links >= 2)
  FILTER NOT EXISTS { ?item wdt:P585 [] }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
} ORDER BY DESC(?links) LIMIT ${LIMIT * 2}`;
  const p = fetch(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json', 'Api-User-Agent': CLIENT },
    signal,
  })
    .then((r) => {
      if (!r.ok) throw new Error(r.status === 429 ? 'Too many photo searches - wait a moment.' : `Wikidata answered ${r.status}`);
      return r.json();
    })
    .then((d) => {
      const seen = new Set();
      const out = [];
      for (const b of d.results.bindings) {
        const id = b.item.value.split('/').pop();
        if (seen.has(id)) continue;
        const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord.value);
        const title = b.itemLabel?.value;
        if (!m || !title || /^Q\d+$/.test(title)) continue;
        seen.add(id);
        out.push({
          id,
          title,
          description: b.itemDescription?.value || '',
          lng: Number(m[1]),
          lat: Number(m[2]),
          file: fileNameFromUrl(b.image.value),
          fame: Number(b.links.value),
          article: b.article?.value || null,
        });
        if (out.length >= LIMIT) break;
      }
      return out;
    })
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, p);
  return p;
}

function htmlToText(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------ gallery of one place
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const IMAGE_MIME = /^image\/(jpeg|png|webp|gif)$/;
const galleries = new Map();

async function getJson(url, params) {
  const r = await fetch(`${url}?${new URLSearchParams({ format: 'json', origin: '*', ...params })}`, { headers: { 'Api-User-Agent': CLIENT } });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

function toImage(page) {
  const info = page.imageinfo?.[0];
  if (!info || !IMAGE_MIME.test(info.mime || '')) return null;
  const meta = info.extmetadata || {};
  return {
    file: page.title.replace(/^File:/, ''),
    thumb: info.thumburl || info.url,
    width: info.width,
    height: info.height,
    author: htmlToText(meta.Artist?.value) || htmlToText(meta.Credit?.value) || 'Unknown author',
    licence: meta.LicenseShortName?.value || '',
    licenceUrl: meta.LicenseUrl?.value || '',
    date: htmlToText(meta.DateTimeOriginal?.value).slice(0, 10),
    page: info.descriptionurl,
  };
}

const IMAGE_PROPS = {
  prop: 'imageinfo',
  iiprop: 'url|size|mime|extmetadata',
  iiurlwidth: '500',
  iiextmetadatafilter: 'Artist|Credit|LicenseShortName|LicenseUrl|DateTimeOriginal',
};

/**
 * Photos of one place from Wikimedia Commons: its main photo, the files in its Commons category
 * and files marked as depicting it. -> { images, article, category }
 */
export function fetchPlaceGallery(place) {
  if (galleries.has(place.id)) return galleries.get(place.id);
  const p = (async () => {
    const [claims, entity] = await Promise.all([
      getJson(WIKIDATA_API, { action: 'wbgetclaims', entity: place.id, property: 'P373' }).catch(() => null),
      getJson(WIKIDATA_API, { action: 'wbgetentities', ids: place.id, props: 'sitelinks/urls', sitefilter: 'enwiki' }).catch(() => null),
    ]);
    const category = claims?.claims?.P373?.[0]?.mainsnak?.datavalue?.value || null;
    const article = place.article || entity?.entities?.[place.id]?.sitelinks?.enwiki?.url || null;
    const requests = [
      getJson(COMMONS_API, { action: 'query', formatversion: '2', titles: `File:${place.file}`, ...IMAGE_PROPS }),
      getJson(COMMONS_API, { action: 'query', formatversion: '2', generator: 'search', gsrsearch: `haswbstatement:P180=${place.id}`, gsrnamespace: '6', gsrlimit: '40', ...IMAGE_PROPS }),
    ];
    if (category) {
      requests.push(
        getJson(COMMONS_API, { action: 'query', formatversion: '2', generator: 'categorymembers', gcmtitle: `Category:${category}`, gcmtype: 'file', gcmlimit: '60', ...IMAGE_PROPS })
      );
    }
    const answers = await Promise.allSettled(requests);
    if (answers.every((a) => a.status === 'rejected')) throw answers[0].reason;
    const seen = new Set();
    const images = [];
    for (const a of answers) {
      if (a.status !== 'fulfilled') continue;
      const pages = [...(a.value.query?.pages || [])].sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
      for (const pg of pages) {
        const img = toImage(pg);
        if (img && !seen.has(img.file)) {
          seen.add(img.file);
          images.push(img);
        }
      }
    }
    return { images, article, category };
  })().catch((err) => {
    galleries.delete(place.id);
    throw err;
  });
  galleries.set(place.id, p);
  return p;
}

/**
 * Round photo thumbnails pinned to the globe (an HTML layer over the canvas).
 * Places on the far side of the Earth are hidden; overlapping ones give way to more famous ones.
 */
export function createPhotoMarkers(viewer, layerEl, onOpen) {
  const scene = viewer.scene;
  const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, Cartesian3.ZERO);
  let items = []; // { photo, pos, el }
  let selectedId = null;
  const scratch = new Cartesian2();
  const MIN_GAP = 58;

  const place = () => {
    if (!items.length) return;
    occluder.cameraPosition = viewer.camera.positionWC;
    const canvas = scene.canvas;
    const cRect = canvas.getBoundingClientRect();
    const lRect = layerEl.getBoundingClientRect();
    const dx = cRect.left - lRect.left;
    const dy = cRect.top - lRect.top;
    const shown = [];
    for (const it of items) {
      // items are most famous first
      let visible = occluder.isPointVisible(it.pos);
      let x = 0;
      let y = 0;
      if (visible) {
        const win = SceneTransforms.worldToWindowCoordinates(scene, it.pos, scratch);
        if (!win) visible = false;
        else {
          x = win.x;
          y = win.y;
          visible = x > 20 && y > 30 && x < canvas.clientWidth - 20 && y < canvas.clientHeight - 20;
          if (visible && it.photo.id !== selectedId) visible = !shown.some((s) => Math.abs(s.x - x) < MIN_GAP && Math.abs(s.y - y) < MIN_GAP);
        }
      }
      if (visible) {
        shown.push({ x, y });
        it.el.style.transform = `translate(${Math.round(dx + x)}px, ${Math.round(dy + y)}px)`;
      }
      it.el.hidden = !visible;
    }
  };
  const stopPost = scene.postRender.addEventListener(place);

  return {
    setPhotos(photos) {
      const keep = new Map(items.map((it) => [it.photo.id, it]));
      const next = [];
      for (const photo of photos) {
        let it = keep.get(photo.id);
        if (it) keep.delete(photo.id);
        else {
          const el = document.createElement('button');
          el.type = 'button';
          el.className = 'earth-photo-pin';
          el.title = photo.title;
          el.setAttribute('aria-label', `Photo: ${photo.title}`);
          el.hidden = true;
          const img = document.createElement('img');
          img.alt = '';
          img.loading = 'lazy';
          img.decoding = 'async';
          img.referrerPolicy = 'no-referrer';
          img.src = thumbUrl(photo.file, 120);
          img.onerror = () => el.classList.add('no-image');
          el.appendChild(img);
          el.addEventListener('click', () => onOpen(photo));
          layerEl.appendChild(el);
          it = { photo, el, pos: Cartesian3.fromDegrees(photo.lng, photo.lat, 0) };
        }
        next.push(it);
      }
      keep.forEach((it) => it.el.remove());
      items = next;
      // the most famous are drawn on top
      items.forEach((it, i) => (it.el.style.zIndex = String(items.length - i)));
      scene.requestRender();
    },
    setSelected(id) {
      selectedId = id;
      items.forEach((it) => it.el.classList.toggle('selected', it.photo.id === id));
      scene.requestRender();
    },
    destroy() {
      stopPost();
      items.forEach((it) => it.el.remove());
      items = [];
    },
  };
}

/** Centre of the view on the globe, or null when looking at space. */
export function viewCenter(viewer) {
  const canvas = viewer.scene.canvas;
  const ray = viewer.camera.getPickRay(new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
  const hit = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined;
  if (!hit) return null;
  const c = Cartographic.fromCartesian(hit);
  return { lat: CesiumMath.toDegrees(c.latitude), lng: CesiumMath.toDegrees(c.longitude) };
}
