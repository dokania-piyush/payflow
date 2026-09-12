import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import Register from './Register';
import PayoutBatch from './PayoutBatch';
import MerchantDashboard from './MerchantDashboard';
import AdminDashboard from './AdminDashboard';
import { LogOut } from 'lucide-react';

function App() {
  const [auth, setAuth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const role = localStorage.getItem('role');
    const name = localStorage.getItem('name');
    if (token) {
      setAuth({ role, name });
    }
    setLoading(false);
  }, []);

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('name');
    setAuth(null);
  };

  if (loading) return null;

  return (
    <BrowserRouter>
      {auth && (
        <nav className="flex items-center justify-between bg-white px-8 py-4 shadow-sm">
          <div className="text-xl font-extrabold text-blue-600">PayFlow</div>
          <button onClick={logout} className="flex items-center text-sm font-medium text-gray-600 hover:text-gray-900">
            <LogOut className="mr-2 h-4 w-4" /> Logout
          </button>
        </nav>
      )}
      <Routes>
        <Route path="/login" element={!auth ? <Login setAuth={setAuth} /> : <Navigate to={auth.role === 'admin' ? '/admin' : '/merchant'} />} />
        <Route path="/register" element={!auth ? <Register setAuth={setAuth} /> : <Navigate to={auth.role === 'admin' ? '/admin' : '/merchant'} />} />
        
        <Route path="/merchant" element={
          auth && auth.role === 'merchant' ? <MerchantDashboard auth={auth} /> : <Navigate to="/login" />
        } />
        
        <Route path="/admin" element={
          auth && auth.role === 'admin' ? <AdminDashboard auth={auth} /> : <Navigate to="/login" />
        } />
        
        <Route path="/settlements" element={
          auth && auth.role === 'merchant' ? <PayoutBatch /> : <Navigate to="/login" />
        } />
        
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
