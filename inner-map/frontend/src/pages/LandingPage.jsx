import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useMapProvider } from '../hooks/ProviderContext';
import MapView from '../maps/MapView';

const FEATURES = [
  {
    title: 'Offline maps',
    text: 'Download an area while connected. Streets, names and buildings then load from your device.',
  },
  {
    title: 'GPS on the map',
    text: 'Your position, accuracy and movement. GPS works without a data connection.',
  },
  {
    title: 'KML and Google Earth',
    text: 'Import KML, KMZ and GeoJSON, draw paths and areas, and export them for Google Earth.',
  },
  {
    title: '3D globe',
    text: 'See your places and layers on a 3D Earth, also offline.',
  },
];

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const { coverage } = useMapProvider();
  // Signed-in users (also when the installed app is opened offline) go straight to the map.
  if (isAuthenticated) return <Navigate to="/map" replace />;
  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-text">
          <span className="eyebrow">Offline-first mapping</span>
          <h1>A map that keeps working when the signal does not.</h1>
          <p>
            Download the areas you need while you are online. Inner Map then opens them without internet and shows
            your GPS position on them.
          </p>
          <div className="hero-actions">
            <Link to="/register" className="btn btn-primary btn-lg">
              Create an account
            </Link>
            <Link to="/login" className="btn btn-lg">
              Log in
            </Link>
          </div>
        </div>
        <div className="hero-map">
          <MapView className="map-fill" fitTo={coverage?.available ? coverage.bounds : null} showLocateButton={false} />
        </div>
      </section>

      <section className="features">
        {FEATURES.map((f) => (
          <article key={f.title} className="feature">
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </article>
        ))}
      </section>

      <section className="how">
        <h2>How it works</h2>
        <ol className="steps">
          <li>Select an area on the map while you are online.</li>
          <li>Download it. The map data is stored in your browser.</li>
          <li>Go offline. Inner Map loads the stored map from your device.</li>
          <li>Start GPS tracking to follow your position on the offline map.</li>
        </ol>
        <p className="muted small">
          Only downloaded areas are available offline. Elsewhere the map says “Not downloaded”.
        </p>
      </section>
    </main>
  );
}
