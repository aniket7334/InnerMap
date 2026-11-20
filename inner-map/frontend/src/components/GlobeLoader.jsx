// Loads the 3D globe page on demand. CesiumJS is large (~4 MB), so it is a separate
// download that only happens when the user opens the globe. If that code is not on the
// device yet and there is no connection, explain instead of showing a blank page.
import { Component, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import OrbitSplashLite from './OrbitSplashLite';
import { splashState, useSplashState } from './splashState';

const GlobePage = lazy(() => import('../pages/GlobePage'));
// The 3D "Orbit" loading screen (three.js, a small download beside the globe's own code).
const OrbitSplash = lazy(() => import('./OrbitSplash'));

/** 3D loading screen only where it runs well: WebGL, enough memory, no reduced-motion wish
 *  (elsewhere the light version of the same design is shown). */
function canShow3d() {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // free the test context at once
    return true;
  } catch {
    return false;
  }
}

/** The loading screen, kept outside the page so its animation never restarts. */
function LoadingScreen() {
  const s = useSplashState();
  const [hidden, setHidden] = useState(false);
  const fallback = useCallback(() => splashState.set({ mode: '2d' }), []);
  const done = useCallback(() => setHidden(true), []);
  // the light loading screen fades with CSS, then goes
  useEffect(() => {
    if (s.mode !== '2d' || s.phase === 'loading') return undefined;
    const t = setTimeout(() => setHidden(true), s.phase === 'gone' ? 0 : 650);
    return () => clearTimeout(t);
  }, [s.mode, s.phase]);
  if (hidden) return null;
  if (s.mode === '3d') {
    return (
      <Suspense fallback={<OrbitSplashLite />}>
        <OrbitSplash onDone={done} onFail={fallback} />
      </Suspense>
    );
  }
  return <OrbitSplashLite />;
}

class GlobeErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    const offline = !navigator.onLine || /fetch|import|load/i.test(this.state.error.message || '');
    return (
      <div className="earth-fallback">
        <div className="card">
          <h1>Earth view unavailable</h1>
          {offline ? (
            <p>
              The Earth view's files are not stored on this device yet. Open it once while connected - they are kept
              automatically. The 2D map works offline already.
            </p>
          ) : (
            <p>The Earth view failed to load: {this.state.error.message}</p>
          )}
          <div className="row">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Try again
            </button>
            <Link className="btn btn-ghost" to="/map">
              Open the 2D map
            </Link>
          </div>
        </div>
      </div>
    );
  }
}

export default function GlobeLoader() {
  // a fresh loading screen each time the Earth page opens
  const [ready] = useState(() => {
    splashState.reset(canShow3d() ? '3d' : '2d');
    return true;
  });
  useEffect(() => () => splashState.reset(), []);
  return (
    <GlobeErrorBoundary>
      {ready && <LoadingScreen />}
      <Suspense fallback={null}>
        <GlobePage />
      </Suspense>
    </GlobeErrorBoundary>
  );
}
