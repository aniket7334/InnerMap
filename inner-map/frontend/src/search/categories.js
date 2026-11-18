// Search categories, mapped from the `kind` values in the OpenStreetMap-derived vector data
// (Protomaps basemap v4 "pois", "places" and "roads" layers). Kinds were checked against the
// Mumbai data; anything named but not listed falls into "Other businesses / places".

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'places', label: 'Places', hint: 'Countries, states, cities, towns, villages, neighbourhoods, landmarks' },
  { id: 'streets', label: 'Streets' },
  { id: 'restaurants', label: 'Restaurants', kinds: ['restaurant', 'cafe', 'fast_food', 'food_court', 'bar', 'pub', 'ice_cream', 'biergarten'] },
  { id: 'hotels', label: 'Hotels', kinds: ['hotel', 'hostel', 'guest_house', 'motel', 'apartment', 'resort'] },
  { id: 'hospitals', label: 'Hospitals', kinds: ['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy', 'veterinary'] },
  { id: 'fuel', label: 'Petrol pumps', kinds: ['fuel', 'charging_station'] },
  {
    id: 'shopping',
    label: 'Shopping',
    kinds: [
      'mall', 'department_store', 'marketplace', 'clothes', 'shoes', 'jewelry', 'books', 'electronics', 'mobile_phone',
      'computer', 'gift', 'optician', 'stationery', 'furniture', 'hardware', 'doityourself', 'kiosk', 'variety_store',
      'cosmetics', 'beauty', 'hairdresser', 'sports', 'toys', 'bag', 'boutique', 'fabric', 'tailor', 'interior_decoration',
      'handicraft', 'art', 'chemist', 'florist', 'garden_centre', 'houseware', 'photo', 'music', 'travel_agency', 'retail',
      'shop', 'watches', 'perfumery', 'tobacco', 'newsagent', 'copyshop', 'laundry', 'dry_cleaning', 'car', 'car_repair',
      'motorcycle', 'bicycle', 'tyres', 'electrical', 'paint', 'antiques', 'second_hand', 'pet',
    ],
  },
  { id: 'grocery', label: 'Grocery', kinds: ['supermarket', 'convenience', 'greengrocer', 'grocery', 'bakery', 'butcher', 'deli', 'dairy', 'beverages', 'confectionery', 'seafood', 'general'] },
  { id: 'atm', label: 'ATMs', kinds: ['atm'] },
  { id: 'banks', label: 'Banks', kinds: ['bank', 'bureau_de_change', 'money_transfer'] },
  { id: 'schools', label: 'Schools', kinds: ['school', 'kindergarten', 'childcare'] },
  { id: 'colleges', label: 'Colleges', kinds: ['college', 'university', 'education', 'research_institute'] },
  {
    id: 'government',
    label: 'Government',
    kinds: ['townhall', 'courthouse', 'police', 'post_office', 'fire_station', 'embassy', 'government', 'public_building', 'prison', 'customs', 'administrative', 'ranger_station'],
  },
  {
    id: 'transport',
    label: 'Transport',
    kinds: [
      'station', 'halt', 'bus_stop', 'bus_station', 'subway_entrance', 'tram_stop', 'ferry_terminal', 'aerodrome', 'airport',
      'helipad', 'platform', 'stop', 'stop_position', 'taxi', 'train_station', 'railway', 'parking', 'bicycle_parking', 'pier',
    ],
  },
  { id: 'other', label: 'Other' },
];

/** Landmark-type kinds: shown under "Places" (with cities, neighbourhoods, etc). */
const LANDMARK_KINDS = new Set([
  'attraction', 'museum', 'gallery', 'monument', 'memorial', 'artwork', 'viewpoint', 'heritage', 'fort', 'castle',
  'park', 'garden', 'zoo', 'theme_park', 'stadium', 'beach', 'peak', 'island', 'place_of_worship', 'theatre', 'cinema',
  'library', 'aquarium', 'golf_course', 'nature_reserve', 'national_park', 'recreation_ground', 'sports_centre',
  'pitch', 'playground', 'arts_centre', 'shoal', 'wood', 'forest', 'bay', 'cape', 'lake', 'river', 'naval_base', 'military',
]);

/** Kinds that are never useful search results even when named. */
export const IGNORED_KINDS = new Set(['tree', 'crossing', 'traffic_signals', 'bench', 'waste_basket', 'toilets', 'drinking_water', 'street_lamp', 'other']);

const KIND_TO_CATEGORY = new Map();
for (const c of CATEGORIES) for (const k of c.kinds || []) KIND_TO_CATEGORY.set(k, c.id);

/** Category of an index entry: { layer: 'places'|'roads'|'pois', kind } */
export function categoryOf(layer, kind) {
  if (layer === 'places') return 'places';
  if (layer === 'roads') return 'streets';
  if (layer === 'water') return 'places';
  if (KIND_TO_CATEGORY.has(kind)) return KIND_TO_CATEGORY.get(kind);
  if (LANDMARK_KINDS.has(kind)) return 'places';
  return 'other';
}

/** Readable type label, e.g. "fast_food" -> "Fast food". */
export function kindLabel(kind) {
  if (!kind) return '';
  const special = { locality: 'City / town', neighbourhood: 'Neighbourhood', macrohood: 'District', region: 'State / province', country: 'Country', major_road: 'Main road', minor_road: 'Street', highway: 'Highway', path: 'Path', atm: 'ATM', fuel: 'Petrol pump', subway_entrance: 'Metro entrance', place_of_worship: 'Place of worship' };
  if (special[kind]) return special[kind];
  const s = kind.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label || 'Other';
}

/** Map symbol colours per category (business / landmark labels on the vector map). */
export const CATEGORY_COLOURS = {
  places: { dot: '#2e7d32', text: '#1b5e20' }, // landmarks, parks, monuments
  restaurants: { dot: '#e8710a', text: '#a14b00' },
  hotels: { dot: '#c2185b', text: '#8a1243' },
  hospitals: { dot: '#d32f2f', text: '#9a1d1d' },
  fuel: { dot: '#455a64', text: '#263238' },
  shopping: { dot: '#1e88e5', text: '#0d5aa7' },
  grocery: { dot: '#43a047', text: '#2a6b2d' },
  atm: { dot: '#00897b', text: '#00594f' },
  banks: { dot: '#00897b', text: '#00594f' },
  schools: { dot: '#8d6e63', text: '#5d4037' },
  colleges: { dot: '#8d6e63', text: '#5d4037' },
  government: { dot: '#5e35b1', text: '#3e2385' },
  transport: { dot: '#3949ab', text: '#26307a' },
  other: { dot: '#757575', text: '#4a4a4a' },
};

/** Categories that can be switched on/off as map labels (order = label priority). */
export const LABEL_FILTER_CATEGORIES = ['places', 'transport', 'hospitals', 'hotels', 'restaurants', 'shopping', 'grocery', 'fuel', 'banks', 'atm', 'schools', 'colleges', 'government', 'other'];
