// Locally bundled web fonts (no external font service). Only the Latin subset and the
// weights the interface uses are included. Vite copies the .woff2 files into the build;
// the browser downloads a font file only when that font is selected, and the service
// worker keeps it for offline use.
import '@fontsource/roboto/latin-400.css';
import '@fontsource/roboto/latin-500.css';
import '@fontsource/roboto/latin-600.css';
import '@fontsource/roboto/latin-700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/open-sans/latin-500.css';
import '@fontsource/open-sans/latin-600.css';
import '@fontsource/open-sans/latin-700.css';
import '@fontsource/lato/latin-400.css';
import '@fontsource/lato/latin-700.css';

/**
 * Make sure a bundled font is loaded before something draws with it on a canvas
 * (the vector map renders labels into canvas tiles, which do not re-render when a
 * font finishes loading later). Resolves even if loading fails (fallback font is used).
 */
export async function ensureFontLoaded(font, weights = [400, 700]) {
  if (!font?.bundled || typeof document === 'undefined' || !document.fonts?.load) return;
  try {
    await Promise.race([
      Promise.all(weights.map((w) => document.fonts.load(`${w} 16px '${font.family}'`))),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {
    /* fall back silently */
  }
}
