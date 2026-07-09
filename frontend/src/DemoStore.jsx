import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, CheckCircle, ShieldCheck, X } from 'lucide-react';
import api from './api';

export default function DemoStore() {
  const [showModal, setShowModal] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, processing, success, error
  const [errorMessage, setErrorMessage] = useState('');
  
  // Simulation accounts (from Simulator)
  const [senderId, setSenderId] = useState('');
  const [receiverId, setReceiverId] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    // In this B2C simulation, the Merchant is RECEIVING the money.
    // So the Merchant's account is the receiverId.
    api.get('/accounts')
      .then(res => {
        if (res.data.accounts.length > 0) setReceiverId(res.data.accounts[0].id);
      }).catch(console.error);
    
    // The "Customer" paying is simulated by picking a random target account to be the sender.
    api.get('/analytics/simulator/targets')
      .then(res => {
        if (res.data.length > 0) setSenderId(res.data[0].id);
      }).catch(console.error);
  }, []);

  const handlePay = async (e) => {
    e.preventDefault();
    setStatus('processing');

    try {
      const idempotencyKey = crypto.randomUUID();
      // Simulate API call from Merchant Server to PayFlow API
      await api.post('/payments', {
        sender_account_id: senderId,
        receiver_account_id: receiverId,
        amount: 299.99,
        description: 'Order #10293 - Noise Cancelling Headphones',
      }, {
        headers: { 'idempotency-key': idempotencyKey }
      });
      
      setStatus('success');
    } catch (err) {
      setErrorMessage(err.response?.data?.error || 'Payment failed');
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 font-sans">
      {/* Dummy Store Navbar */}
      <nav className="bg-gray-900 p-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="text-xl font-bold tracking-wider">TECHSTORE</div>
          <div className="flex items-center gap-6 text-sm">
            <span>Categories</span>
            <span>Deals</span>
            <span className="flex items-center"><ShoppingCart className="mr-2 h-4 w-4"/> Cart (1)</span>
          </div>
        </div>
      </nav>

      {/* Product Page */}
      <main className="mx-auto mt-12 max-w-6xl p-4">
        <div className="flex flex-col gap-12 md:flex-row">
          {/* Product Image */}
          <div className="flex flex-1 items-center justify-center rounded-xl bg-white p-12 shadow-sm">
            <div className="h-64 w-64 rounded-full bg-gray-200 shadow-inner flex items-center justify-center text-gray-400">
              [Product Image]
            </div>
          </div>
          
          {/* Product Details */}
          <div className="flex-1">
            <div className="mb-2 text-sm font-semibold text-blue-600">AUDIO & HEADPHONES</div>
            <h1 className="mb-4 text-4xl font-extrabold text-gray-900">
              Noise Cancelling Headphones Pro
            </h1>
            <p className="mb-6 text-lg text-gray-600">
              Industry-leading noise cancellation, 30-hour battery life, and crystal clear calls.
            </p>
            <div className="mb-8 text-3xl font-bold text-gray-900">₹299.99</div>

            <button 
              onClick={() => setShowModal(true)}
              className="w-full rounded-lg bg-yellow-500 py-4 font-bold text-gray-900 shadow-md transition hover:bg-yellow-400 md:w-2/3"
            >
              Buy Now
            </button>
            <div className="mt-4 flex items-center text-sm text-gray-500">
              <ShieldCheck className="mr-2 h-5 w-5 text-green-500" /> Secure Payments by PayFlow
            </div>
          </div>
        </div>
      </main>

      {/* PayFlow Checkout Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl overflow-hidden relative">
            <button onClick={() => setShowModal(false)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
            
            <div className="mb-6 flex flex-col items-center border-b pb-6 text-center">
              <div className="mb-2 text-xl font-extrabold text-blue-600">PayFlow Checkout</div>
              <div className="text-sm text-gray-500">TECHSTORE is requesting a payment</div>
              <div className="mt-4 text-3xl font-bold">₹299.99</div>
            </div>

            {status === 'idle' && (
              <form onSubmit={handlePay}>
                <div className="mb-4">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Card Number</label>
                  <input type="text" placeholder="4111 1111 1111 1111" className="w-full rounded-md border p-3 font-mono focus:border-blue-500 focus:outline-none" required />
                </div>
                <div className="mb-6 flex gap-4">
                  <div className="flex-1">
                    <label className="mb-1 block text-sm font-medium text-gray-700">Expiry</label>
                    <input type="text" placeholder="MM/YY" className="w-full rounded-md border p-3 focus:border-blue-500 focus:outline-none" required />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-sm font-medium text-gray-700">CVV</label>
                    <input type="password" placeholder="123" className="w-full rounded-md border p-3 focus:border-blue-500 focus:outline-none" required />
                  </div>
                </div>
                <button type="submit" className="w-full rounded-md bg-blue-600 py-3 font-bold text-white transition hover:bg-blue-700">
                  Pay Securely
                </button>
              </form>
            )}

            {status === 'processing' && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600 mb-4"></div>
                <div className="text-gray-600 font-medium">Processing payment...</div>
              </div>
            )}

            {status === 'success' && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
                <h3 className="text-xl font-bold text-gray-900 mb-2">Payment Successful!</h3>
                <p className="text-gray-500 mb-6">Your order has been placed.</p>
                <button onClick={() => navigate('/merchant')} className="w-full rounded-md bg-gray-100 py-2 font-medium text-gray-700 hover:bg-gray-200">
                  Return to Merchant Dashboard
                </button>
              </div>
            )}

            {status === 'error' && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="mb-4 h-16 w-16 rounded-full bg-red-100 p-3 text-red-600">
                  <X className="h-full w-full" />
                </div>
                <h3 className="mb-2 text-xl font-bold text-gray-900">Payment Failed</h3>
                <p className="mb-6 text-red-500">{errorMessage}</p>
                <button onClick={() => setStatus('idle')} className="w-full rounded-md bg-gray-100 py-2 font-medium text-gray-700 hover:bg-gray-200">
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
