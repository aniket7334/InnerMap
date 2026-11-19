// Map settings side panel for the Earth view: map type (satellite / map), level of detail, the
// satellite imagery source and extra visuals (photos, gridlines, sky, 3D terrain).
// Only real, working options are listed; ones that need internet say so and are disabled offline.
import Icon from './Icon';

export const DETAILS = [
  { id: 'clean', label: 'Clean', note: 'Imagery only: no names, roads, places or outlines.' },
  { id: 'exploration', label: 'Exploration', note: 'Names of countries, cities and places, roads, and your saved places.' },
  { id: 'everything', label: 'Everything', note: 'Exploration plus downloaded area outlines and imported layers.' },
  { id: 'custom', label: 'Custom', note: 'Choose exactly what is shown.' },
];

/** What each detail level shows. */
export function detailPreset(id) {
  if (id === 'clean') return { names: false, places: false, regions: false, layers: false };
  if (id === 'exploration') return { names: true, places: true, regions: false, layers: false };
  if (id === 'everything') return { names: true, places: true, regions: true, layers: true };
  return null;
}

function Switch({ label, note, checked, onChange, disabled }) {
  return (
    <label className={`earth-set-row ${disabled ? 'disabled' : ''}`}>
      <span className="earth-set-text">
        <strong>{label}</strong>
        {note && <small>{note}</small>}
      </span>
      <input type="checkbox" role="switch" className="earth-set-switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default function EarthSettings({
  onClose,
  type,
  onType,
  detail,
  onDetail,
  shown, // { names, places, regions, layers }
  onShown,
  counts, // { places, layers }
  imagery, // { value, options: [{ value, label, disabled }], onChange, notes: [] }
  visuals, // { photos, grid, sky, terrain, terrainAvailable }
  onVisual,
  online,
  hint,
}) {
  return (
    <aside className="earth-settings" role="dialog" aria-labelledby="earth-settings-title">
      <header>
        <h2 id="earth-settings-title">Map settings</h2>
        <button type="button" onClick={onClose} aria-label="Close map settings">
          <Icon name="close" size={20} />
        </button>
      </header>
      <div className="earth-settings-body">
        <section>
          <h3>Type</h3>
          <div className="earth-set-types" role="radiogroup" aria-label="Map type">
            {[
              { id: 'satellite', label: 'Satellite', note: 'Imagery of the Earth from space', swatch: 'satellite' },
              { id: 'map', label: 'Map', note: 'Street map with names (OpenStreetMap; whole world when online)', swatch: 'default' },
            ].map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={type === t.id} className={type === t.id ? 'on' : ''} onClick={() => onType(t.id)} title={t.note}>
                <span className={`earth-set-thumb view-${t.swatch}`}>
                  <span className="view-swatch" />
                </span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Details</h3>
          <div role="radiogroup" aria-label="Map details">
            {DETAILS.map((d) => (
              <label key={d.id} className="earth-set-row">
                <span className="earth-set-text">
                  <strong>{d.label}</strong>
                  <small>{d.note}</small>
                </span>
                <input type="radio" name="earth-detail" className="earth-set-radio" checked={detail === d.id} onChange={() => onDetail(d.id)} />
              </label>
            ))}
          </div>
          {detail === 'custom' && (
            <div className="earth-set-custom">
              <Switch
                label="Names and roads"
                note={type === 'map' ? 'Part of the street map itself' : 'Countries, cities, places, and streets where map data exists'}
                checked={type === 'map' || shown.names}
                disabled={type === 'map'}
                onChange={(v) => onShown({ names: v })}
              />
              <Switch label={`Saved places (${counts.places})`} checked={shown.places} onChange={(v) => onShown({ places: v })} />
              <Switch label="Downloaded area outlines" checked={shown.regions} onChange={(v) => onShown({ regions: v })} />
              {counts.layers > 0 && <Switch label={`Imported layers (${counts.layers})`} checked={shown.layers} onChange={(v) => onShown({ layers: v })} />}
            </div>
          )}
          {type === 'map' && detail === 'clean' && <p className="earth-set-note">The street map keeps its own names; Clean hides your places and outlines.</p>}
          {hint && <p className="earth-set-note">{hint}</p>}
        </section>

        {type === 'satellite' && (
          <section>
            <h3>Satellite imagery</h3>
            <label className="earth-set-select">
              <span className="sr-only">Imagery source</span>
              <select value={imagery.value} onChange={(e) => imagery.onChange(e.target.value)}>
                {imagery.options.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {imagery.notes.filter(Boolean).map((n) => (
              <p key={n} className="earth-set-note">
                {n}
              </p>
            ))}
          </section>
        )}

        <section>
          <h3>More visuals</h3>
          <Switch
            label="Photos"
            note={online ? 'Photos of famous places around the world (online only).' : 'Photos need an internet connection.'}
            checked={visuals.photos}
            disabled={!online}
            onChange={(v) => onVisual('photos', v)}
          />
          <Switch label="Gridlines" note="Show latitude and longitude lines." checked={visuals.grid} onChange={(v) => onVisual('grid', v)} />
          <Switch label="Sky and atmosphere" note="Stars, and the blue glow around the Earth." checked={visuals.sky} onChange={(v) => onVisual('sky', v)} />
          {visuals.terrainAvailable && (
            <Switch label="3D terrain" note="Mountains and valleys in 3D (tilt the view to see them)." checked={visuals.terrain} onChange={(v) => onVisual('terrain', v)} />
          )}
        </section>
      </div>
    </aside>
  );
}
