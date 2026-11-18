// Writes typography settings to CSS custom properties on <html>. Everything in
// styles/global.css reads these variables, so a change applies instantly everywhere.
import { BASE_PX, FONT_WEIGHTS, SECTIONS, basePx, effectiveSections, fontById, labelFont } from './typographyConfig';
import { ensureFontLoaded } from './fonts';

const LS_KEY = 'innermap.typography';

export function applyTypography(t, root = document.documentElement) {
  const font = fontById(t.fontFamily);
  const px = basePx(t);
  const ladder = (FONT_WEIGHTS.find((w) => w.id === t.fontWeight) || FONT_WEIGHTS[0]).ladder;
  const set = (k, v) => root.style.setProperty(k, String(v));

  set('--app-font-family', font.stack);
  set('--app-font-size', `${px}px`);
  set('--app-scale', px / BASE_PX);
  set('--fw-regular', ladder[0]);
  set('--fw-medium', ladder[1]);
  set('--fw-semibold', ladder[2]);
  set('--fw-bold', ladder[3]);
  const sections = effectiveSections(t);
  for (const s of SECTIONS) set(s.cssVar, sections[s.id]);
  // Map labels drawn by Leaflet (saved places) use CSS; vector labels use the same values in JS.
  set('--map-label-family', labelFont(t).stack);
  set('--map-label-saved-size', `${Math.round(12 * t.mapLabels.scale.saved * 10) / 10}px`);
  set('--map-label-saved-weight', t.mapLabels.weight === 'bold' ? ladder[3] : ladder[2]);

  if (t.appearance === 'normal') root.removeAttribute('data-contrast');
  else root.setAttribute('data-contrast', t.appearance);
  // Large text: allow wrapping in buttons/status bar instead of clipping.
  const maxScale = (px / BASE_PX) * Math.max(...Object.values(sections));
  if (maxScale >= 1.15) root.setAttribute('data-type-large', '');
  else root.removeAttribute('data-type-large');

  ensureFontLoaded(font, [400, 500, 600, 700]);
}

export function loadLocalTypography() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveLocalTypography(t) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...t, savedAt: Date.now() }));
  } catch {
    /* storage full or blocked: settings still apply for this session */
  }
}
