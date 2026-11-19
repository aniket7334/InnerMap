import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/AuthContext';
import { useConnectivity } from '../hooks/ConnectivityContext';
import { errorMessage } from '../services/api';
import Alert from '../components/Alert';

function validate(form) {
  const errors = {};
  if (form.name.trim().length < 2) errors.name = 'Enter at least 2 characters.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) errors.email = 'Enter a valid email address.';
  if (form.password.length < 8) errors.password = 'Use at least 8 characters.';
  if (form.password.length > 72) errors.password = 'Use at most 72 characters.';
  if (form.confirm !== form.password) errors.confirm = 'Passwords do not match.';
  return errors;
}

export default function RegisterPage() {
  const { register, isAuthenticated } = useAuth();
  const { status } = useConnectivity();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [touched, setTouched] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  const errors = validate(form);
  const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  const onBlur = (e) => setTouched((t) => ({ ...t, [e.target.name]: true }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true, confirm: true });
    if (Object.keys(errors).length) return;
    setError(null);
    setBusy(true);
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Registration failed'));
    } finally {
      setBusy(false);
    }
  };

  const field = (name, label, type, autoComplete) => (
    <label className="field">
      <span>{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        value={form[name]}
        onChange={onChange}
        onBlur={onBlur}
        aria-invalid={Boolean(touched[name] && errors[name])}
      />
      {touched[name] && errors[name] && <small className="field-error">{errors[name]}</small>}
    </label>
  );

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h1>Create your account</h1>
        <p className="muted">Your saved places and downloaded-map list follow you across devices.</p>
        {status === 'offline' && <Alert tone="warning">You are offline. Creating an account needs a connection.</Alert>}
        <Alert tone="error">{error}</Alert>
        {field('name', 'Name', 'text', 'name')}
        {field('email', 'Email', 'email', 'email')}
        {field('password', 'Password', 'password', 'new-password')}
        {field('confirm', 'Confirm password', 'password', 'new-password')}
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account...' : 'Create account'}
        </button>
        <p className="auth-switch">
          Already registered? <Link to="/login">Log in</Link>
        </p>
      </form>
    </main>
  );
}
