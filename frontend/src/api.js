import axios from 'axios';

const api = axios.create({
  // Vite runs separately in development; the Docker image serves this build
  // from the same Express origin in deployment.
  baseURL: import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin),
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
