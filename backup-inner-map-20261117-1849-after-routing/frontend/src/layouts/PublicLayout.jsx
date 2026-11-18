import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import StatusBadge from '../components/StatusBadge';

export default function PublicLayout() {
  const { isAuthenticated } = useAuth();
  return (
    <div className="public-shell">
      <header className="public-header">
        <Link to="/" className="brand">
          <img src="/icons/icon.svg" alt="" width="32" height="32" />
          <span>Inner Map</span>
        </Link>
        <nav className="public-nav">
          <StatusBadge />
          {isAuthenticated ? (
            <Link to="/dashboard" className="btn btn-primary btn-sm">
              Open app
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">
                Log in
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm">
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
