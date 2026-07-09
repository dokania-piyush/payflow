import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, Send, ArrowLeft } from 'lucide-react';
import api from './api';

export default function Simulator() {
  const [myAccounts, setMyAccounts] = useState([]);
  const [targets, setTargets] = useState([]);
  const [senderId, setSenderId] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const [amount, setAmount] = useState('500');
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Fetch my accounts
    api.get('/accounts')
      .then(res => {
        setMyAccounts(res.data.accounts);
        if (res.data.accounts.length > 0) setSenderId(res.data.accounts[0].id);
      })
      .catch(console.error);
    
    // Fetch target accounts
    api.get('/analytics/simulator/targets')
      .then(res => {
        setTargets(res.data);
        if (res.data.length > 0) setReceiverId(res.data[0].id);
      })
      .catch(console.error);
  }, []);

  const handlePay = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await api.post('/payments', {
        sender_account_id: senderId,
        receiver_account_id: receiverId,
        amount: parseFloat(amount),
        description: 'Test purchase from Simulator',
      }, {
        headers: { 'idempotency-key': idempotencyKey }
      });
      
      setMessage({ type: 'success', text: `Payment successful! Transaction ID: ${res.data.transaction.id}` });
    } catch (err) {
      setMessage({ 
        type: 'error', 
        text: err.response?.data?.error || err.response?.data?.details || 'Payment failed due to risk score or error'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <header className="mb-8 flex items-center">
        <button onClick={() => navigate(-1)} className="mr-4 rounded-full bg-white p-2 text-gray-500 shadow-sm hover:text-gray-900">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-3xl font-bold text-gray-800 flex items-center">
          <CreditCard className="mr-3 h-8 w-8 text-blue-600" /> Payment Simulator
        </h1>
      </header>

      <div className="mx-auto max-w-2xl rounded-lg bg-white p-8 shadow-md">
        <p className="mb-6 text-gray-600">
          Simulate a customer making a payment to another business. Watch your Dashboard analytics update in real-time!
        </p>

        {message && (
          <div className={`mb-6 rounded-md p-4 ${message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {message.text}
          </div>
        )}

        <form onSubmit={handlePay}>
          <div className="mb-4">
            <label className="mb-2 block font-medium text-gray-700">Pay From (Your Account)</label>
            <select 
              className="w-full rounded border px-3 py-2 focus:border-blue-500 focus:outline-none"
              value={senderId}
              onChange={e => setSenderId(e.target.value)}
              required
            >
              {myAccounts.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.id} (Balance: ₹{acc.balance})
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="mb-2 block font-medium text-gray-700">Pay To (Destination Account)</label>
            <select 
              className="w-full rounded border px-3 py-2 focus:border-blue-500 focus:outline-none"
              value={receiverId}
              onChange={e => setReceiverId(e.target.value)}
              required
            >
              {targets.map(acc => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}'s Account ({acc.id})
                </option>
              ))}
            </select>
          </div>

          <div className="mb-6">
            <label className="mb-2 block font-medium text-gray-700">Amount (₹)</label>
            <input
              type="number"
              min="1"
              step="0.01"
              className="w-full rounded border px-3 py-2 text-xl font-bold text-gray-900 focus:border-blue-500 focus:outline-none"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded bg-blue-600 px-6 py-3 text-lg font-bold text-white shadow-lg transition hover:bg-blue-700 disabled:bg-blue-400"
          >
            <Send className="mr-2 h-5 w-5" /> 
            {loading ? 'Processing Payment...' : `Pay ₹${amount}`}
          </button>
        </form>
      </div>
    </div>
  );
}
