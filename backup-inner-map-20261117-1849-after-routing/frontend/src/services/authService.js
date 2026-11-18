import api from './api';

export async function register({ name, email, password }) {
  const { data } = await api.post('/auth/register', { name, email, password });
  return data; // { token, user }
}

export async function login({ email, password }) {
  const { data } = await api.post('/auth/login', { email, password });
  return data; // { token, user }
}

export async function fetchProfile() {
  const { data } = await api.get('/auth/profile');
  return data.user;
}

export async function updateProfile(fields) {
  const { data } = await api.put('/auth/profile', fields);
  return data.user;
}
