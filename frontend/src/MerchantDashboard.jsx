import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from 'recharts';
import { AlertTriangle, TrendingUp, CheckCircle, CreditCard } from 'lucide-react';
import api from './api';

export default function MerchantDashboard({ auth }) {
  const [data, setData] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/analytics/merchant')
      .then(res => setData(res.data))
      .catch(console.error);
  }, []);

  if (!data) return <div className="p-8">Loading dashboard...</div>;

  const { metrics, chartData, recentTransactions } = data;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <header className="mb-8 flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">{auth.name || 'Organization'} Settlement Console</h1>
          <p className="text-gray-600">Track completed payouts, review exceptions, and manage daily settlement operations.</p>
        </div>
        <button 
          onClick={() => navigate('/settlements')}
          className="flex items-center rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700"
        >
          <CreditCard className="mr-2 h-5 w-5" /> Create Payout Batch
        </button>
      </header>

      {/* Metrics Cards */}
      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Payout Volume" value={`₹${metrics.totalRevenue}`} icon={<TrendingUp className="text-blue-500" />} />
        <MetricCard title="Payouts Today" value={metrics.transactionsToday} icon={<CheckCircle className="text-green-500" />} />
        <MetricCard title="Completion Rate" value={`${Math.round((metrics.successCount / (metrics.successCount + metrics.failedCount || 1)) * 100)}%`} icon={<CheckCircle className="text-green-500" />} />
        <MetricCard title="Review Alerts" value={metrics.fraudAlerts} icon={<AlertTriangle className="text-red-500" />} />
      </div>

      {/* Charts */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-800">Daily Payout Volume (7 Days)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="volume" stroke="#3b82f6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-gray-800">Payout Count (7 Days)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Transactions Table */}
      <div className="rounded-lg bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-gray-800">Recent Payouts</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b text-gray-600">
                <th className="pb-3">ID</th>
                <th className="pb-3">Amount</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Risk Score</th>
                <th className="pb-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map(tx => (
                <tr key={tx.id} className="border-b last:border-0">
                  <td className="py-3 text-sm text-gray-500">{tx.id.substring(0, 8)}...</td>
                  <td className="py-3 font-medium">₹{tx.amount}</td>
                  <td className="py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${tx.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {tx.status === 'pending' && tx.risk_score > 0.85 ? 'Fraud Alert (Blocked)' : tx.status}
                    </span>
                  </td>
                  <td className="py-3">
                    {tx.risk_score > 0.85 ? (
                      <span className="flex items-center text-red-600">
                        <AlertTriangle className="mr-1 h-4 w-4" /> {tx.risk_score}
                      </span>
                    ) : (
                      <span className="text-gray-600">{tx.risk_score}</span>
                    )}
                  </td>
                  <td className="py-3 text-sm text-gray-500">{new Date(tx.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon }) {
  return (
    <div className="flex items-center rounded-lg bg-white p-6 shadow-sm">
      <div className="mr-4 rounded-full bg-blue-50 p-3">{icon}</div>
      <div>
        <h4 className="text-sm font-medium text-gray-500">{title}</h4>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}
