// Measure tool: straight-line distance (two or more points) and area (polygon).
// Pure geometry on the device - works offline. This is NOT road distance: for distance and
// time along roads use Directions (the panel says so, and shows a calculated route if any).
import Icon from './Icon';
import { distanceMeters, formatDistance, ringAreaM2 } from '../maps/geo';

const UNITS = [
  { id: 'auto', label: 'Auto' },
  { id: 'm', label: 'm' },
  { id: 'km', label: 'km' },
];

export function formatLength(m, unit = 'auto') {
  if (unit === 'm') return `${Math.round(m).toLocaleString()} m`;
  if (unit === 'km') return `${(m / 1000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} km`;
  return formatDistance(m);
}

/** Segment lengths, total length and (for area mode) area of the measured points. */
export function measureStats(points, mode) {
  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    segments.push(distanceMeters(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]));
  }
  let closing = 0;
  if (mode === 'area' && points.length >= 3) {
    const a = points[points.length - 1];
    const b = points[0];
    closing = distanceMeters(a[0], a[1], b[0], b[1]);
  }
  const length = segments.reduce((s, d) => s + d, 0);
  let area = null;
  if (mode === 'area' && points.length >= 3) {
    const ring = [...points, points[0]].map(([lat, lng]) => [lng, lat]);
    area = ringAreaM2(ring);
  }
  return { segments, length, perimeter: length + closing, closing, area };
}

const fmt = (v, digits) => v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits > 2 ? 2 : 0 });

export default function MeasurePanel({ state, setState, route, onClose }) {
  const { mode, points, unit } = state;
  const stats = measureStats(points, mode);
  const set = (patch) => setState((s) => ({ ...s, ...patch }));

  return (
    <div className="measure-panel" role="dialog" aria-label="Measure">
      <div className="measure-head">
        <strong>Measure</strong>
        <div className="measure-modes" role="radiogroup" aria-label="What to measure">
          {[
            ['distance', 'Distance'],
            ['area', 'Area'],
          ].map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} className={mode === id ? 'active' : ''} onClick={() => set({ mode: id })}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close measure tool" title="Close">
          <Icon name="close" size={16} />
        </button>
      </div>

      <p className="muted tiny measure-hint">
        {points.length === 0
          ? mode === 'distance'
            ? 'Click the map to add points. Add more points to follow a path.'
            : 'Click the map to outline the area (at least 3 points).'
          : mode === 'area' && points.length < 3
            ? `Add ${3 - points.length} more point${points.length === 2 ? '' : 's'} to get an area.`
            : 'Keep clicking to add points.'}
      </p>

      {mode === 'distance' && points.length >= 2 && (
        <div className="measure-result">
          <div className="measure-total">
            <span className="muted small">Straight-line distance</span>
            <strong>{formatLength(stats.length, unit)}</strong>
          </div>
          {stats.segments.length > 1 && (
            <ol className="measure-segments">
              {stats.segments.map((d, i) => (
                <li key={i}>
                  <span>
                    Point {i + 1} → {i + 2}
                  </span>
                  <span>{formatLength(d, unit)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {mode === 'area' && stats.area != null && (
        <div className="measure-result">
          <dl className="measure-area">
            <div>
              <dt>Square metres</dt>
              <dd>{fmt(stats.area, 0)} m²</dd>
            </div>
            <div>
              <dt>Square kilometres</dt>
              <dd>{fmt(stats.area / 1e6, 4)} km²</dd>
            </div>
            <div>
              <dt>Hectares</dt>
              <dd>{fmt(stats.area / 1e4, 2)} ha</dd>
            </div>
            <div>
              <dt>Acres</dt>
              <dd>{fmt(stats.area / 4046.8564224, 2)} acres</dd>
            </div>
            <div>
              <dt>Perimeter</dt>
              <dd>{formatLength(stats.perimeter, unit)}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="measure-actions">
        <label className="measure-unit">
          <span className="muted small">Units</span>
          <select value={unit} onChange={(e) => set({ unit: e.target.value })}>
            {UNITS.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-sm" disabled={!points.length} onClick={() => set({ points: points.slice(0, -1) })}>
          Undo point
        </button>
        <button type="button" className="btn btn-sm" disabled={!points.length} onClick={() => set({ points: [] })}>
          Clear
        </button>
      </div>

      <p className="muted tiny">
        Measured in a straight line over the earth’s surface (as the crow flies) - not along roads.
        {route
          ? ` Calculated route in Directions: ${formatDistance(route.distance)} by road (${route.mode === 'online' ? 'online' : 'offline road data'}).`
          : ' For distance and time by road, use Directions.'}
      </p>
    </div>
  );
}
