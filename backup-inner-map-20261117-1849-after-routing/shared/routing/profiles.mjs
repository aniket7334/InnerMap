// Which OpenStreetMap ways each travel mode may use, and how fast.
// Used when building the road graph (backend) and when routing (browser + backend).

// Road classes we keep, in a fixed order (their index is stored per edge).
export const CLASSES = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential',
  'living_street', 'service', 'road', 'track', 'pedestrian', 'footway', 'path', 'cycleway',
  'steps', 'bridleway',
];

// Typical urban speeds in India (km/h) when a way has no usable maxspeed tag.
// Durations are therefore estimates, labelled as such in the app.
export const CAR_SPEED = {
  motorway: 70, motorway_link: 40, trunk: 50, trunk_link: 35, primary: 40, primary_link: 30,
  secondary: 32, secondary_link: 25, tertiary: 28, tertiary_link: 22, unclassified: 22,
  residential: 18, living_street: 10, service: 12, road: 18, track: 10,
};
export const FOOT_SPEED = 4.8; // km/h
export const BIKE_SPEED = 14; // km/h
export const MAX_CAR_SPEED = 100;

// Edge flag bits.
export const CAR_FWD = 1;
export const CAR_BWD = 2;
export const BIKE_FWD = 4;
export const BIKE_BWD = 8;
export const FOOT = 16;

const NO = new Set(['no', 'private', 'agricultural', 'forestry', 'delivery']);

function denied(v) {
  return v !== undefined && NO.has(v);
}

/** Decide access flags for one OSM way from its tags. 0 = not routable. */
export function accessFlags(tags) {
  const hw = tags.highway;
  if (!CLASSES.includes(hw)) return 0;
  if (tags.area === 'yes') return 0;

  const general = denied(tags.access);
  let car = Object.prototype.hasOwnProperty.call(CAR_SPEED, hw) && hw !== 'track';
  let foot = !['motorway', 'motorway_link'].includes(hw);
  let bike = !['motorway', 'motorway_link', 'steps', 'footway', 'pedestrian'].includes(hw);

  if (general) {
    car = false;
    foot = foot && ['yes', 'designated', 'permissive'].includes(tags.foot);
    bike = bike && ['yes', 'designated', 'permissive'].includes(tags.bicycle);
  }
  if (denied(tags.motor_vehicle) || denied(tags.motorcar) || denied(tags.vehicle)) car = false;
  if (denied(tags.foot)) foot = false;
  if (denied(tags.bicycle) || denied(tags.vehicle)) bike = false;
  if (hw === 'footway' || hw === 'pedestrian') bike = ['yes', 'designated'].includes(tags.bicycle);
  if (hw === 'cycleway') foot = tags.foot !== 'no';
  if (['footway', 'pedestrian', 'path', 'cycleway', 'steps', 'bridleway'].includes(hw)) car = false;

  // One-way rules: car follows oneway / roundabouts / motorways; bikes too unless exempted; walking ignores them.
  const ow = tags.oneway;
  const implied = tags.junction === 'roundabout' || tags.junction === 'circular' || hw === 'motorway';
  let fwd = true;
  let bwd = true;
  if (ow === 'yes' || ow === 'true' || ow === '1' || (implied && ow !== 'no')) bwd = false;
  if (ow === '-1' || ow === 'reverse') fwd = false;
  const bikeExempt = tags['oneway:bicycle'] === 'no' || tags['cycleway'] === 'opposite';

  let f = 0;
  if (car) f |= (fwd ? CAR_FWD : 0) | (bwd ? CAR_BWD : 0);
  if (bike) f |= (fwd || bikeExempt ? BIKE_FWD : 0) | (bwd || bikeExempt ? BIKE_BWD : 0);
  if (foot) f |= FOOT;
  return f;
}

/** Car speed for a way (km/h): numeric maxspeed if sensible, else the class default. */
export function carSpeed(tags) {
  const hw = tags.highway;
  const base = CAR_SPEED[hw] || 15;
  const m = /^(\d{1,3})(\s*mph)?$/.exec(String(tags.maxspeed || '').trim());
  if (m) {
    const v = Number(m[1]) * (m[2] ? 1.609 : 1);
    // Posted limits are rarely reached in city traffic: take the lower of limit and 0.8 x limit vs class default.
    if (v >= 5 && v <= 140) return Math.min(v * 0.8, Math.max(base, v * 0.6));
  }
  return base;
}

export const PROFILES = {
  car: { label: 'Driving', fwd: CAR_FWD, bwd: CAR_BWD },
  bike: { label: 'Cycling', fwd: BIKE_FWD, bwd: BIKE_BWD },
  foot: { label: 'Walking', fwd: FOOT, bwd: FOOT },
};
