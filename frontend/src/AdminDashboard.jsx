import { useEffect, useState } from 'react';
import { Activity, Users, ShieldAlert, RefreshCw, Server, AlertCircle } from 'lucide-react';
import api from './api';

export default function AdminDashboard({ auth }) {
  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);

  useEffect(() => {
    fetchHealth();
    fetchUsers();
    fetchTransactions();
  }, [flaggedOnly]);

  const fetchHealth = () => api.get('/admin/health').then(res => setHealth(res.data)).catch(console.error);
  const fetchUsers = (q = search) => api.get(`/admin/users?q=${q}`).then(res => setUsers(res.data)).catch(console.error);
  const fetchTransactions = () => api.get(`/admin/transactions?flagged_only=${flaggedOnly}`).then(res => setTransactions(res.data)).catch(console.error);

  const handleSearch = (e) => {
    setSearch(e.target.value);
    fetchUsers(e.target.value);
  };

  const toggleFreeze = async (id) => {
    await api.post(`/admin/users/${id}/toggle-freeze`);
    fetchUsers(); // refresh
  };

  if (!health) return <div className="p-8">Loading admin panel...</div>;

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <header className="mb-8 flex items-center justify-between border-b pb-4">
        <h1 className="flex items-center text-3xl font-bold text-gray-800">
          <ShieldAlert className="mr-3 h-8 w-8 text-indigo-600" />
          Admin Control Center
        </h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center rounded-full bg-white px-4 py-2 shadow-sm">
            <Server className={`mr-2 h-4 w-4 ${health.status === 'Operational' ? 'text-green-500' : 'text-red-500'}`} />
            <span className="text-sm font-medium">System: {health.status}</span>
          </div>
          <div className="text-gray-600">Admin: {auth.name}</div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        {/* User Management Section */}
        <div className="rounded-lg bg-white p-6 shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center text-xl font-bold text-gray-800">
              <Users className="mr-2 text-indigo-500" /> User Management
            </h2>
            <input 
              type="text" 
              placeholder="Search users..." 
              className="rounded-md border px-3 py-1 text-sm focus:border-indigo-500 focus:outline-none"
              value={search}
              onChange={handleSearch}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Email</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b">
                    <td className="p-3 font-medium">{u.name}</td>
                    <td className="p-3 text-gray-500">{u.email}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${u.role === 'admin' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100'}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {u.is_active ? 'Active' : 'Frozen'}
                      </span>
                    </td>
                    <td className="p-3">
                      <button 
                        onClick={() => toggleFreeze(u.id)}
                        disabled={u.role === 'admin'}
                        className={`rounded px-3 py-1 text-xs font-medium text-white transition-colors ${u.is_active ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} disabled:opacity-50`}
                      >
                        {u.is_active ? 'Freeze' : 'Unfreeze'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Global Transactions Section */}
        <div className="rounded-lg bg-white p-6 shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center text-xl font-bold text-gray-800">
              <Activity className="mr-2 text-indigo-500" /> Global Transactions
            </h2>
            <label className="flex items-center text-sm text-gray-600 cursor-pointer">
              <input 
                type="checkbox" 
                className="mr-2"
                checked={flaggedOnly}
                onChange={(e) => setFlaggedOnly(e.target.checked)}
              />
              Show Flagged Only
            </label>
          </div>
          <div className="h-[400px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-gray-50 text-gray-600 shadow-sm">
                <tr>
                  <th className="p-3">Merchant</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Risk</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-medium">{tx.merchant_name}</td>
                    <td className="p-3">₹{tx.amount}</td>
                    <td className="p-3">
                      <span className={`rounded-full px-2 py-1 text-xs ${tx.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="p-3">
                      {tx.risk_score > 0.85 ? (
                        <span className="flex items-center font-bold text-red-600">
                          <AlertCircle className="mr-1 h-3 w-3" /> {tx.risk_score}
                        </span>
                      ) : (
                        <span className="text-gray-500">{tx.risk_score}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {transactions.length === 0 && (
                  <tr><td colSpan="4" className="p-4 text-center text-gray-500">No transactions found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
