// Loads the 3D globe page on demand. CesiumJS is large (~4 MB), so it is a separate
// download that only happens when the user opens the globe. If that code is not on the
// device yet and there is no connection, explain instead of showing a blank page.
import { Component, Suspense, lazy } from 'react';
import { Link } from 'react-router-dom';

const GlobePage = lazy(() => import('../pages/GlobePage'));

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
  return (
    <GlobeErrorBoundary>
      <Suspense
        fallback={
          <div className="earth-fallback earth-loading">
            <img src="/icons/icon.svg" alt="" width="48" height="48" />
            <p>Loading InnerMap Earth…</p>
          </div>
        }
      >
        <GlobePage />
      </Suspense>
    </GlobeErrorBoundary>
  );
}
