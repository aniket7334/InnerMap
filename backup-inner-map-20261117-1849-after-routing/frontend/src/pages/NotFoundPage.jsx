import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="auth-page">
      <div className="auth-card center">
        <h1>Page not found</h1>
        <p className="muted">This place is not on the map.</p>
        <Link to="/" className="btn btn-primary">
          Back to start
        </Link>
      </div>
    </main>
  );
}
