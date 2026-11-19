// World names on the 3D Earth: countries, states/provinces, cities and towns, oceans and seas.
// Data: /data/world-labels.json, built from Natural Earth (public domain) and GeoNames towns (CC BY 4.0) by
// scripts/build-world-labels.mjs. Served by the app, so it also works offline.
//
// Like a desktop Earth viewer:
//  - detail grows as you zoom in (each name has a camera-distance range from its importance);
//  - names on the far side of the planet, or squeezed at the horizon, are hidden;
//  - names never overlap: more important names win (countries, capitals and big cities first).
// Labels are created only when they first come into view, so start-up stays fast.
// Street-level names come from the OpenStreetMap layer instead.
import {
  LabelCollection,
  PointPrimitiveCollection,
  Cartesian2,
  Cartesian3,
  Color,
  Credit,
  EllipsoidalOccluder,
  Ellipsoid,
  HorizontalOrigin,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
} from 'cesium';

const KM = 1000;
const MAX_SHOWN = 600; // names on screen at once
const BOTTOM_BAR = 52; // px kept free for the map controls and credits
let dataPromise = null;

export function loadWorldLabels() {
  if (!dataPromise) {
    dataPromise = fetch('/data/world-labels.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .catch((err) => {
        dataPromise = null; // try again later (e.g. back online)
        throw err;
      });
  }
  return dataPromise;
}

// Camera-distance ranges (metres) per importance rank.
const countryFar = (rank) => (rank <= 2 ? 24000 : rank <= 3 ? 16000 : rank <= 4 ? 10000 : rank <= 5 ? 6500 : 4000) * KM;
const stateFar = (rank) => (rank <= 2 ? 4000 : rank <= 3 ? 3000 : rank <= 4 ? 2200 : rank <= 6 ? 1400 : rank <= 8 ? 800 : 450) * KM;
const CITY_FAR = { 0: 9000, 1: 7000, 2: 5000, 3: 3500, 4: 2500, 5: 2000, 6: 1400, 7: 850, 8: 550, 9: 400, 10: 300, 11: 180 };
const cityFar = (rank) => (CITY_FAR[rank] ?? 180) * KM;
const marineRange = (rank, kind) =>
  kind === 'ocean' ? [1800 * KM, 30000 * KM] : rank <= 1 ? [250 * KM, 9000 * KM] : rank <= 3 ? [60 * KM, 3500 * KM] : [15 * KM, 1500 * KM];

const WHITE = Color.WHITE;
const OUTLINE = Color.fromCssColorString('rgba(0,0,0,0.85)');
const STATE = Color.fromCssColorString('#e8e4dc');
const SEA = Color.fromCssColorString('#a9d6ff');
const CAPITAL = Color.fromCssColorString('#ffd54f');

const colorCache = new Map();
function toColor(css) {
  if (!colorCache.has(css)) colorCache.set(css, Color.fromCssColorString(css));
  return colorCache.get(css);
}

function inside(b, lat, lng) {
  return b && lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

/**
 * Adds the world names to a Cesium viewer.
 * @param opts { family, scalePlaces, scaleCities, bold, detailAreas, avoid }
 *   avoid: CSS selector of buttons/panels floating over the globe that names must not cover
 *   detailAreas: [bounds] where the OpenStreetMap layer shows its own names (cities there give way when close)
 * @returns { count, setVisible(bool), refresh(), shown(), destroy() }
 */
export function createWorldLabels(viewer, data, opts) {
  const scene = viewer.scene;
  const labels = scene.primitives.add(new LabelCollection({ scene }));
  const dots = scene.primitives.add(new PointPrimitiveCollection());
  const family = opts.family || 'sans-serif';
  const sp = opts.scalePlaces ?? 1;
  const sc = opts.scaleCities ?? 1;
  const font = (weight, px, italic = false) => `${italic ? 'italic ' : ''}${opts.bold ? Math.min(800, weight + 200) : weight} ${Math.round(px)}px ${family}`;
  const shrinkFar = new NearFarScalar(2000 * KM, 1, 20000 * KM, 0.8);

  const items = [];
  const push = (lng, lat, text, s) => items.push({ position: Cartesian3.fromDegrees(lng, lat, 0), text, ...s, label: null, dot: null });

  for (const [name, lng, lat, rank, kind] of data.marine) {
    const [near, far] = marineRange(rank, kind);
    const ocean = kind === 'ocean';
    const px = (ocean ? 15 : 13) * sp;
    push(lng, lat, ocean ? name.toUpperCase() : name, { near, far, px, font: font(ocean ? 500 : 400, px, true), color: SEA, prio: ocean ? 0 : 3 + rank, scale: shrinkFar });
  }
  for (const [name, lng, lat, rank] of data.countries) {
    const px = (rank <= 2 ? 17 : 15) * sp;
    push(lng, lat, name, { near: 500 * KM, far: countryFar(rank), px, font: font(600, px), color: WHITE, prio: 1 + rank * 0.5, scale: shrinkFar });
  }
  for (const [name, lng, lat, rank] of data.states) {
    const px = 14 * sp;
    push(lng, lat, name, { near: 40 * KM, far: stateFar(rank), px, font: font(400, px), color: STATE, prio: 6 + rank });
  }
  for (const [name, lng, lat, rank, kind] of data.cities) {
    const capital = kind === 2;
    const px = (capital || rank <= 2 ? 16 : 15) * sc;
    push(lng, lat, name, {
      // Where the OpenStreetMap layer has its own names, hand over to it when zoomed in.
      near: opts.detailAreas?.some((b) => inside(b, lat, lng)) ? 60 * KM : 0,
      far: cityFar(rank),
      px,
      font: font(capital || rank <= 1 ? 600 : 500, px),
      color: WHITE,
      dot: true,
      dotColor: capital ? CAPITAL : WHITE,
      dotSize: capital ? 6 : 5,
      prio: 2 + rank * 0.9 - (capital ? 1.5 : 0),
    });
  }
  // Most important first: they claim screen space before the others.
  items.sort((a, b) => a.prio - b.prio);

  const ensure = (it) => {
    if (it.label) return;
    it.label = labels.add({
      position: it.position,
      text: it.text,
      font: it.font,
      fillColor: it.color,
      outlineColor: OUTLINE,
      outlineWidth: 4,
      style: LabelStyle.FILL_AND_OUTLINE,
      horizontalOrigin: it.dot ? HorizontalOrigin.LEFT : HorizontalOrigin.CENTER,
      verticalOrigin: VerticalOrigin.CENTER,
      pixelOffset: it.dot ? new Cartesian2(Math.round((it.dotSize || 5) / 2) + 5, 0) : Cartesian2.ZERO,
      scaleByDistance: it.scale,
      show: false,
    });
    if (it.dot === true) {
      it.dot = dots.add({ position: it.position, pixelSize: it.dotSize, color: it.dotColor, outlineColor: OUTLINE, outlineWidth: 1.5, show: false });
    }
  };
  const setShown = (it, show) => {
    if (!it.label) return;
    it.label.show = show;
    if (it.dot && it.dot !== true) it.dot.show = show;
  };

  const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, Cartesian3.ZERO);
  const canvasPos = new Cartesian2();
  const toCam = new Cartesian3();
  const normal = new Cartesian3();
  let visible = true;
  let shownCount = 0;

  const update = () => {
    const cam = viewer.camera.positionWC;
    occluder.cameraPosition = cam;
    const placed = []; // screen boxes already taken
    const w = scene.canvas.clientWidth;
    const h = scene.canvas.clientHeight;
    if (opts.avoid) {
      // floating buttons and panels over the globe: names stay clear of them
      const c = scene.canvas.getBoundingClientRect();
      for (const el of document.querySelectorAll(opts.avoid)) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) placed.push([r.left - c.left - 4, r.top - c.top - 4, r.right - c.left + 4, r.bottom - c.top + 4]);
      }
    }
    shownCount = 0;
    const shownNames = new Map(); // text -> screen points already showing that name
    for (const it of items) {
      let show = false;
      if (visible && shownCount < MAX_SHOWN) {
        const dist = Cartesian3.distance(cam, it.position);
        if (dist >= it.near && dist <= it.far && occluder.isPointVisible(it.position)) {
          // skip names squeezed at the horizon (grazing view)
          Cartesian3.normalize(it.position, normal);
          Cartesian3.normalize(Cartesian3.subtract(cam, it.position, toCam), toCam);
          if (Cartesian3.dot(normal, toCam) > 0.22 && scene.cartesianToCanvasCoordinates(it.position, canvasPos)) {
            const s = it.scale ? it.scale.nearValue : 1;
            const bw = it.text.length * it.px * 0.58 * s + (it.dot ? (it.dotSize || 5) + 8 : 0);
            const bh = it.px * 1.35 * s;
            const x0 = it.dot ? canvasPos.x - 4 : canvasPos.x - bw / 2;
            const y0 = canvasPos.y - bh / 2;
            const box = [x0 - 3, y0 - 2, x0 + bw + 3, y0 + bh + 2];
            // whole name on screen, and clear of the controls / credits along the bottom
            const twins = shownNames.get(it.text);
            const repeated = twins && twins.some(([x, y]) => Math.abs(x - canvasPos.x) < 260 && Math.abs(y - canvasPos.y) < 160);
            if (!repeated && box[0] >= 0 && box[2] <= w && box[1] >= 0 && box[3] <= h - BOTTOM_BAR && !placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) {
              placed.push(box);
              if (twins) twins.push([canvasPos.x, canvasPos.y]);
              else shownNames.set(it.text, [[canvasPos.x, canvasPos.y]]);
              show = true;
            }
          }
        }
      }
      if (show) {
        if (!it.label) created = true;
        ensure(it);
        shownCount += 1;
      }
      setShown(it, show);
    }
    scene.requestRender();
    // New labels draw their letters asynchronously; the globe only redraws on demand, so ask
    // for a few more frames until they are ready.
    if (created) {
      created = false;
      for (const ms of [60, 200, 500, 1200]) timers.push(setTimeout(() => !viewer.isDestroyed() && scene.requestRender(), ms));
      if (timers.length > 40) timers.splice(0, timers.length - 40);
    }
  };
  let created = false;
  const timers = [];
  const groups = new Map(); // key -> items added with setGroup
  const removeGroup = (key) => {
    const group = groups.get(key);
    if (!group) return;
    for (const it of group) {
      if (it.label) labels.remove(it.label);
      if (it.dot && it.dot !== true) dots.remove(it.dot);
    }
    const gone = new Set(group);
    for (let i = items.length - 1; i >= 0; i--) if (gone.has(items[i])) items.splice(i, 1);
    groups.delete(key);
  };

  // Re-place names at most once per frame while the camera moves.
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      update();
    });
  };
  // GeoNames (CC BY 4.0) asks for attribution; Natural Earth is public domain.
  const credit = /GeoNames/.test(data.source || '') ? new Credit('Place names: Natural Earth, GeoNames (CC BY 4.0)', true) : null;
  if (credit) viewer.creditDisplay.addStaticCredit(credit);

  const stopChanged = viewer.camera.changed.addEventListener(schedule);
  const stopMoveEnd = viewer.camera.moveEnd.addEventListener(schedule);
  const onResize = () => schedule();
  window.addEventListener('resize', onResize);
  // The first frame needs the canvas size: place names once the scene has rendered.
  const stopPost = scene.postRender.addEventListener(() => {
    stopPost();
    schedule();
  });
  scene.requestRender();

  return {
    count: items.length,
    shown: () => shownCount,
    setVisible(v) {
      visible = v;
      schedule();
    },
    refresh: update,
    /**
     * Names that come and go with the view (towns, villages, buildings, streets), added as a group
     * per map tile. They take part in the same placement, so they never overlap the world names.
     * list: [{ lng, lat, text, px, weight, italic, color, dot, dotColor, dotSize, prio, near, far }]
     */
    setGroup(key, list) {
      removeGroup(key);
      const group = [];
      for (const d of list) {
        const px = d.px * sp;
        const it = {
          position: Cartesian3.fromDegrees(d.lng, d.lat, 0),
          text: d.text,
          px,
          font: font(d.weight || 400, px, d.italic),
          color: d.color ? toColor(d.color) : WHITE,
          near: d.near || 0,
          far: d.far,
          prio: d.prio,
          dot: d.dot ? true : undefined,
          dotColor: d.dotColor ? toColor(d.dotColor) : WHITE,
          dotSize: d.dotSize || 4,
          group: key,
          label: null,
        };
        group.push(it);
        items.push(it);
      }
      groups.set(key, group);
      items.sort((a, b) => a.prio - b.prio);
      schedule();
    },
    /** Keep only these groups (drops the names of tiles no longer in view). */
    keepGroups(keys) {
      for (const k of [...groups.keys()]) if (!keys.has(k)) removeGroup(k);
      schedule();
    },
    destroy() {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      stopChanged();
      stopMoveEnd();
      window.removeEventListener('resize', onResize);
      if (!viewer.isDestroyed()) {
        if (credit) viewer.creditDisplay.removeStaticCredit(credit);
        scene.primitives.remove(labels);
        scene.primitives.remove(dots);
        scene.requestRender();
      }
    },
  };
}
