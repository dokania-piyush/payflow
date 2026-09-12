import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from './api';

export default function Login({ setAuth }) {
  const [email, setEmail] = useState('demo@acme.com');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('role', res.data.merchant.role);
      localStorage.setItem('name', res.data.merchant.name);
      setAuth(res.data.merchant);
      
      if (res.data.merchant.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/merchant');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded bg-white p-8 shadow-md">
        <h2 className="mb-6 text-center text-2xl font-bold text-gray-800">PayFlow Login</h2>
        {error && <div className="mb-4 text-red-500">{error}</div>}
        <form onSubmit={handleLogin}>
          <div className="mb-4">
            <label className="mb-2 block text-gray-700">Email</label>
            <input
              type="email"
              className="w-full rounded border px-3 py-2 focus:border-blue-500 focus:outline-none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="mb-6">
            <label className="mb-2 block text-gray-700">Password</label>
            <input
              type="password"
              className="w-full rounded border px-3 py-2 focus:border-blue-500 focus:outline-none"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          >
            Login
          </button>
        </form>
        <div className="mt-4 text-center text-sm text-gray-600">
          Don't have an account? <Link to="/register" className="text-blue-600 hover:underline">Register here</Link>
        </div>
      </div>
    </div>
  );
}
