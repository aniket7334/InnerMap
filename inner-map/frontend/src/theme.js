// Light / dark appearance. Default follows the device; the top-bar switch stores an explicit
// choice on this device (front-end only, nothing is sent to the server).
const KEY = 'innermap.theme';

export function storedTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme() {
  return storedTheme() || systemTheme();
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme) root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', (theme || systemTheme()) === 'dark' ? '#0b1220' : '#ffffff');
}

export function setTheme(theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  applyTheme(theme);
}

// Apply before the first render.
if (typeof document !== 'undefined') applyTheme(storedTheme());
