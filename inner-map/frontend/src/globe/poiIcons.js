// Map symbols for places on the 3D Earth, like a printed map or Google Maps: a coloured circle
// with a white symbol - ॐ for Hindu temples, ☪ for mosques, ✝ for churches, a cross for
// hospitals, and so on. Drawn on a canvas in the browser (works offline), cached per kind.
import { ICON_PATHS } from '../components/Icon';

// kind -> [colour, symbol]; symbol: { text } (a character) or { path } (an icon from Icon.jsx)
const KINDS = {
  hindu: ['#f57c00', { text: 'ॐ', font: '700 26px "Nirmala UI", "Noto Sans Devanagari", "Mangal", sans-serif', dy: 2 }],
  muslim: ['#2e7d32', { text: '☪', font: '26px "Segoe UI Symbol", "Noto Sans Symbols", sans-serif', dy: 1 }],
  christian: ['#5c6bc0', { text: '✝', font: '700 24px "Segoe UI Symbol", "Noto Sans Symbols", sans-serif', dy: 1 }],
  sikh: ['#ef6c00', { text: '☬', font: '26px "Segoe UI Symbol", "Noto Sans Symbols", sans-serif', dy: 1 }],
  buddhist: ['#c2185b', { text: '☸', font: '26px "Segoe UI Symbol", "Noto Sans Symbols", sans-serif', dy: 1 }],
  jewish: ['#1565c0', { text: '✡', font: '24px "Segoe UI Symbol", "Noto Sans Symbols", sans-serif', dy: 1 }],
  worship: ['#7e57c2', { path: 'landmark' }],
  hospital: ['#e53935', { path: 'medical', fill: true }],
  pharmacy: ['#d81b60', { path: 'medical', fill: true }],
  atm: ['#2e7d32', { text: 'ATM', font: '700 13px Arial, sans-serif', dy: 1 }],
  bank: ['#546e7a', { text: '₹', font: '700 22px Arial, sans-serif', dy: 1 }],
  food: ['#f4511e', { path: 'food' }],
  cafe: ['#8d6e63', { path: 'coffee' }],
  bar: ['#00897b', { path: 'glass' }],
  fuel: ['#00838f', { path: 'fuel' }],
  rail: ['#1a73e8', { path: 'train' }],
  bus: ['#0288d1', { path: 'car' }],
  school: ['#3949ab', { path: 'school' }],
  hotel: ['#8e24aa', { path: 'bed' }],
  park: ['#43a047', { path: 'tree' }],
  landmark: ['#f9a825', { path: 'landmark' }],
  shop: ['#ef6c00', { path: 'bag' }],
  police: ['#455a64', { path: 'shield' }],
};

/** The symbol kind for an OpenMapTiles point of interest (class / subclass). */
export function poiKind(cls, subclass) {
  if (cls === 'place_of_worship' || cls === 'religion') {
    return ['hindu', 'muslim', 'christian', 'sikh', 'buddhist', 'jewish'].includes(subclass) ? subclass : 'worship';
  }
  const map = {
    hospital: 'hospital', doctors: 'hospital', dentist: 'hospital', pharmacy: 'pharmacy', atm: 'atm', bank: 'bank',
    restaurant: 'food', fast_food: 'food', food_court: 'food', ice_cream: 'food', cafe: 'cafe', bar: 'bar', beer: 'bar', pub: 'bar',
    fuel: 'fuel', railway: 'rail', aerialway: 'rail', bus: 'bus', ferry_terminal: 'rail', college: 'school', school: 'school',
    library: 'school', kindergarten: 'school', lodging: 'hotel', park: 'park', garden: 'park', campsite: 'park', playground: 'park',
    attraction: 'landmark', museum: 'landmark', monument: 'landmark', castle: 'landmark', historic: 'landmark', art_gallery: 'landmark',
    zoo: 'park', stadium: 'park', shop: 'shop', mall: 'shop', department_store: 'shop', grocery: 'shop', clothing_store: 'shop',
    police: 'police', town_hall: 'landmark', theatre: 'landmark', cinema: 'landmark',
  };
  return map[cls] || map[subclass] || null;
}

export const kindColor = (kind) => KINDS[kind]?.[0] || '#9e9e9e';

const cache = new Map();
/** A data URL of the symbol (48 x 48 pixels, drawn at 2x for sharp screens). */
export function poiIcon(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const [color, sym] = KINDS[kind] || ['#9e9e9e', { path: 'pin' }];
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  const g = c.getContext('2d');
  // soft shadow, coloured disc, white ring
  g.beginPath();
  g.arc(24, 25, 21, 0, Math.PI * 2);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fill();
  g.beginPath();
  g.arc(24, 24, 20, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#ffffff';
  g.stroke();
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  if (sym.text) {
    g.font = sym.font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(sym.text, 24, 24 + (sym.dy || 0));
  } else {
    const d = ICON_PATHS[sym.path];
    if (d) {
      g.save();
      g.translate(12, 12);
      const p = new Path2D(d);
      if (sym.fill) g.fill(p);
      g.lineWidth = 2.2;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke(p);
      g.restore();
    }
  }
  const url = c.toDataURL('image/png');
  cache.set(kind, url);
  return url;
}
