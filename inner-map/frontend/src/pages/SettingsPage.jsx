// Settings -> Text and fonts.
// Two independent groups, as recommended:
//   Interface typography - menus, buttons, panels and all app text (CSS variables)
//   Map typography       - labels drawn by the vector map + saved-place labels
// Every change applies immediately (live preview) and is saved automatically to this
// device and, when signed in, to the account (synced through the offline outbox).
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import MapView from '../maps/MapView';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import { useAuth } from '../hooks/AuthContext';
import { useTypography } from '../hooks/TypographyContext';
import { useMapProvider } from '../hooks/ProviderContext';
import { useSavedLocations } from '../hooks/useSavedLocations';
import { confirmDialog } from '../components/ConfirmDialog';
import {
  APPEARANCES,
  CUSTOM_SIZE_MAX,
  CUSTOM_SIZE_MIN,
  FONT_FAMILIES,
  FONT_WEIGHTS,
  LABEL_CATEGORIES,
  LABEL_MAX,
  LABEL_MIN,
  SECTIONS,
  SECTION_MAX,
  SECTION_MIN,
  SIZE_PRESETS,
  basePx,
  fontById,
} from '../typography/typographyConfig';

const MUMBAI = { lat: 18.9388, lng: 72.8354 };
const pct = (v) => `${Math.round(v * 100)}%`;

const SAVE_TEXT = {
  idle: '',
  pending: 'Saving…',
  saved: 'Saved',
  queued: 'Saved on this device - will sync when online',
  error: 'Could not save to your account; kept on this device',
};

function Segmented({ label, options, value, onChange, name }) {
  return (
    <fieldset className="segmented-field">
      <legend>{label}</legend>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <label key={o.id} className={`segmented-item ${value === o.id ? 'active' : ''}`}>
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ScaleSlider({ id, label, hint, value, min, max, step = 0.05, onChange }) {
  return (
    <div className="scale-row">
      <label htmlFor={id} className="scale-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </label>
      <div className="scale-control">
        <button type="button" className="icon-btn" aria-label={`Smaller ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, Math.round((value - 0.1) * 100) / 100))}>
          −
        </button>
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={pct(value)} />
        <button type="button" className="icon-btn" aria-label={`Larger ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, Math.round((value + 0.1) * 100) / 100))}>
          +
        </button>
        <output htmlFor={id} className="scale-value">{pct(value)}</output>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { settings: t, update, reset, saveState } = useTypography();
  const { provider } = useMapProvider();
  const { locations } = useSavedLocations(user?.id);
  const isVector = provider.kind === 'vector';
  const px = basePx(t);

  const setSection = (id, v) => update((p) => ({ ...p, sections: { ...p.sections, [id]: v } }));
  const setLabels = (patch) => update((p) => ({ ...p, mapLabels: { ...p.mapLabels, ...patch } }));
  const setLabelScale = (id, v) => update((p) => ({ ...p, mapLabels: { ...p.mapLabels, scale: { ...p.mapLabels.scale, [id]: v } } }));

  const onResetAll = async () => {
    const ok = await confirmDialog({
      title: 'Reset text and font settings?',
      message: 'Interface text and map labels go back to the default font and sizes. Your other settings are not changed.',
      confirmLabel: 'Reset to default',
    });
    if (ok) reset('all');
  };

  const previewPlaces = useMemo(() => locations.slice(0, 20), [locations]);

  return (
    <div className="page page-settings">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Text and fonts. Changes apply immediately and are saved automatically.</p>
        </div>
        <div className="settings-head-actions">
          <span className="save-state" role="status" aria-live="polite">
            {SAVE_TEXT[saveState]}
          </span>
          <button type="button" className="btn" onClick={onResetAll}>
            <Icon name="refresh" size={15} /> Reset to default
          </button>
        </div>
      </div>

      <div className="settings-grid">
        <div className="settings-controls">
          {/* ------------------------------------------------ interface typography */}
          <section className="section" aria-labelledby="ui-type-title">
            <div className="section-head">
              <h2 id="ui-type-title">Interface text</h2>
              <button type="button" className="btn btn-sm" onClick={() => reset('interface')}>
                Reset
              </button>
            </div>
            <div className="section-body settings-stack">
              <p className="muted small-print">Menus, buttons, panels, messages and all other app text. Icons and map controls keep their size.</p>

              <fieldset className="segmented-field">
                <legend>Font</legend>
                <div className="font-list" role="radiogroup" aria-label="Font">
                  {FONT_FAMILIES.map((f) => (
                    <label key={f.id} className={`font-option ${t.fontFamily === f.id ? 'active' : ''}`}>
                      <input type="radio" name="font-family" value={f.id} checked={t.fontFamily === f.id} onChange={() => update({ fontFamily: f.id })} />
                      <span className="font-option-name" style={{ fontFamily: f.stack }}>
                        {f.label}
                      </span>
                      <span className="font-option-sample" style={{ fontFamily: f.stack }}>
                        Gateway of India · 18.92° N
                      </span>
                      {f.note && <small>{f.note}</small>}
                    </label>
                  ))}
                </div>
              </fieldset>

              <Segmented label="Text size" name="size" options={SIZE_PRESETS} value={t.sizePreset} onChange={(id) => update({ sizePreset: id })} />
              {t.sizePreset === 'custom' && (
                <div className="scale-row">
                  <label htmlFor="custom-size" className="scale-label">
                    <span>Custom size</span>
                    <small>
                      {CUSTOM_SIZE_MIN}–{CUSTOM_SIZE_MAX} px
                    </small>
                  </label>
                  <div className="scale-control">
                    <button type="button" className="icon-btn" aria-label="Smaller text" disabled={t.customSize <= CUSTOM_SIZE_MIN} onClick={() => update({ customSize: t.customSize - 1 })}>
                      −
                    </button>
                    <input id="custom-size" type="range" min={CUSTOM_SIZE_MIN} max={CUSTOM_SIZE_MAX} step={1} value={t.customSize} onChange={(e) => update({ customSize: Number(e.target.value) })} aria-valuetext={`${t.customSize} pixels`} />
                    <button type="button" className="icon-btn" aria-label="Larger text" disabled={t.customSize >= CUSTOM_SIZE_MAX} onClick={() => update({ customSize: t.customSize + 1 })}>
                      +
                    </button>
                    <output htmlFor="custom-size" className="scale-value">{t.customSize} px</output>
                  </div>
                </div>
              )}
              <p className="muted small-print">Body text is {px} px. Headings and small print scale with it.</p>

              <Segmented label="Font weight" name="weight" options={FONT_WEIGHTS} value={t.fontWeight} onChange={(id) => update({ fontWeight: id })} />

              <fieldset className="segmented-field">
                <legend>Appearance</legend>
                {APPEARANCES.map((a) => (
                  <label key={a.id} className="radio-row">
                    <input type="radio" name="appearance" value={a.id} checked={t.appearance === a.id} onChange={() => update({ appearance: a.id })} />
                    <span>
                      {a.label}
                      {a.note && <small>{a.note}</small>}
                    </span>
                  </label>
                ))}
              </fieldset>
            </div>
          </section>

          {/* ------------------------------------------------ per-section scaling */}
          <section className="section" aria-labelledby="sections-title">
            <div className="section-head">
              <h2 id="sections-title">Interface sections</h2>
            </div>
            <div className="section-body settings-stack">
              <label className="check">
                <input type="checkbox" checked={t.advanced} onChange={(e) => update({ advanced: e.target.checked })} />
                <span>
                  Size parts of the interface separately
                  <small className="block">Off: everything follows the text size above.</small>
                </span>
              </label>
              {t.advanced && (
                <>
                  {SECTIONS.map((s) => (
                    <ScaleSlider key={s.id} id={`sec-${s.id}`} label={s.label} value={t.sections[s.id]} min={SECTION_MIN} max={SECTION_MAX} onChange={(v) => setSection(s.id, v)} />
                  ))}
                  <div>
                    <button type="button" className="btn btn-sm" onClick={() => update((p) => ({ ...p, sections: Object.fromEntries(SECTIONS.map((s) => [s.id, 1])) }))}>
                      Set all sections to 100%
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ------------------------------------------------ map typography */}
          <section className="section" aria-labelledby="map-type-title">
            <div className="section-head">
              <h2 id="map-type-title">Map labels</h2>
              <button type="button" className="btn btn-sm" onClick={() => reset('map')}>
                Reset
              </button>
            </div>
            <div className="section-body settings-stack">
              {isVector ? (
                <p className="muted small-print">
                  The offline vector map (“{provider.label}”) draws its labels on this device, so their size and font can be changed.
                </p>
              ) : (
                <Alert tone="info">
                  The current base map, “{provider.label}”, is made of pictures with the labels already printed in them, so place, road and landmark label
                  sizes cannot be changed for it. Only your saved-place labels change. Switch to the vector map on the <Link to="/map">Map</Link> page to
                  use all label settings.
                </Alert>
              )}

              <label className="field">
                Label font
                <select value={t.mapLabels.fontFamily} onChange={(e) => setLabels({ fontFamily: e.target.value })}>
                  <option value="interface">Same as interface ({fontById(t.fontFamily).label})</option>
                  {FONT_FAMILIES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <Segmented
                label="Label weight"
                name="label-weight"
                options={[
                  { id: 'normal', label: 'Normal' },
                  { id: 'bold', label: 'Bolder' },
                ]}
                value={t.mapLabels.weight}
                onChange={(id) => setLabels({ weight: id })}
              />
              {LABEL_CATEGORIES.map((c) => (
                <ScaleSlider
                  key={c.id}
                  id={`label-${c.id}`}
                  label={c.label}
                  hint={c.hint}
                  value={t.mapLabels.scale[c.id]}
                  min={LABEL_MIN}
                  max={LABEL_MAX}
                  step={0.1}
                  onChange={(v) => setLabelScale(c.id, v)}
                />
              ))}
              <label className="check">
                <input type="checkbox" checked={t.mapLabels.showSavedLabels} onChange={(e) => setLabels({ showSavedLabels: e.target.checked })} />
                <span>Show names next to saved places</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={t.mapLabels.showLandmarks} onChange={(e) => setLabels({ showLandmarks: e.target.checked })} />
                <span>
                  Show landmark labels on the vector map
                  <small className="block">Stations, parks, hospitals and other points of interest, from zoom 14.</small>
                </span>
              </label>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------ live preview */}
        <aside className="settings-preview" aria-label="Preview">
          <div className="section">
            <div className="section-head">
              <h2>Preview</h2>
            </div>
            <div className="section-body settings-stack">
              <div className="preview-ui">
                <div className="preview-sidebar">
                  <span className="nav-item active">
                    <Icon name="map" size={18} /> Map
                  </span>
                  <span className="nav-item">
                    <Icon name="layers" size={18} /> Offline maps
                  </span>
                </div>
                <div className="preview-body">
                  <div className="search preview-search">
                    <Icon name="search" size={16} className="search-icon" />
                    <input type="search" placeholder="Search places" aria-label="Search preview" tabIndex={-1} readOnly />
                  </div>
                  <p>
                    <strong>Colaba Causeway</strong>
                    <br />
                    <span className="muted">18.9067° N, 72.8147° E · saved 2 days ago</span>
                  </p>
                  <div className="preview-buttons">
                    <button type="button" className="btn btn-primary" tabIndex={-1}>
                      Directions
                    </button>
                    <button type="button" className="btn" tabIndex={-1}>
                      Save place
                    </button>
                  </div>
                  <div className="alert alert-info">
                    <div className="alert-body">Offline map ready: Mumbai (z10–15).</div>
                  </div>
                </div>
              </div>
              <div className="preview-map">
                <MapView initialCenter={MUMBAI} initialZoom={14} places={previewPlaces} showLocateButton={false} showCoordinates={false} className="map-fill" />
              </div>
              <p className="muted small-print">
                Map preview uses the current base map ({provider.label}){isVector ? '' : ' - its printed labels do not change'}.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
