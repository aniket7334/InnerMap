// Full-screen map mode.
//  - Uses the Fullscreen API on the map's container (same Leaflet map, not a copy).
//  - Where the API is missing (e.g. Safari on iPhone), refused, or never answers (some embedded
//    browsers), falls back to a CSS mode: the page adds the class `map-pseudo-fullscreen` when
//    `mode === 'pseudo'`, which makes the container cover the whole viewport (respecting notches).
//  - Locks page scrolling while active; Esc or the exit button restores the normal layout.
import { useCallback, useEffect, useRef, useState } from 'react';

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export function useMapFullscreen(containerRef, mapRef) {
  const [mode, setModeState] = useState(null); // null | 'native' | 'pseudo'
  const modeRef = useRef(null);

  const refreshMap = useCallback(() => {
    // Leaflet must re-measure after the container size changes.
    setTimeout(() => mapRef.current?.invalidateSize(), 60);
    setTimeout(() => mapRef.current?.invalidateSize(), 400);
  }, [mapRef]);

  const setMode = useCallback(
    (m) => {
      modeRef.current = m;
      setModeState(m);
      document.documentElement.classList.toggle('no-scroll', m !== null);
      refreshMap();
    },
    [refreshMap]
  );

  const enter = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (request && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
      try {
        // Some embedded browsers / WebViews never answer the request: give it 1.5 s.
        await Promise.race([
          request.call(el, { navigationUI: 'hide' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
        ]);
        if (fullscreenElement() === el) return; // mode follows the fullscreenchange event
      } catch {
        /* refused, unsupported or no answer: fall back */
      }
    }
    if (fullscreenElement() !== el) setMode('pseudo');
  }, [containerRef, setMode]);

  const exit = useCallback(async () => {
    if (fullscreenElement()) {
      const leave = document.exitFullscreen || document.webkitExitFullscreen;
      try {
        await leave.call(document);
      } catch {
        /* already left */
      }
    }
    if (modeRef.current === 'pseudo') setMode(null);
  }, [setMode]);

  useEffect(() => {
    const onChange = () => {
      const active = fullscreenElement() === containerRef.current;
      if (active) setMode('native');
      else if (modeRef.current === 'native') setMode(null);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && modeRef.current === 'pseudo') setMode(null);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    document.addEventListener('keydown', onKey);
    window.addEventListener('orientationchange', refreshMap);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('orientationchange', refreshMap);
      // Leaving the page while in full screen: restore everything.
      document.documentElement.classList.remove('no-scroll');
      if (fullscreenElement()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
    };
  }, [containerRef, refreshMap, setMode]);

  return { active: mode !== null, mode, enter, exit, toggle: mode ? exit : enter };
}
