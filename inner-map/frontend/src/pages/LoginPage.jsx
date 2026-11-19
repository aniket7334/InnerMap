import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { errorMessage } from '../services/api';
import Alert from '../components/Alert';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const { status } = useConnectivity();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(form);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Login failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h1>Welcome back</h1>
        <p className="muted">Log in to use your maps and saved places.</p>
        {status === 'offline' && (
          <Alert tone="warning">
            You are offline. Logging in needs a connection once; after that Inner Map opens offline.
          </Alert>
        )}
        <Alert tone="error">{error}</Alert>
        <label className="field">
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" value={form.email} onChange={onChange} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={onChange}
            required
          />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy || !form.email || !form.password}>
          {busy ? 'Logging in...' : 'Log in'}
        </button>
        <p className="auth-switch">
          New to Inner Map? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </main>
  );
}
