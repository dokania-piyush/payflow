import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, CircleAlert, Landmark, Plus, Send, Users } from 'lucide-react';
import api from './api';

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function PayoutBatch() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [batches, setBatches] = useState([]);
  const [selected, setSelected] = useState({});
  const [amounts, setAmounts] = useState({});
  const [creating, setCreating] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [newBeneficiary, setNewBeneficiary] = useState({ name: '', beneficiary_type: 'rider', email: '' });
  const [addingBeneficiary, setAddingBeneficiary] = useState(false);

  const load = async () => {
    const [accountsRes, beneficiariesRes, batchesRes] = await Promise.all([
      api.get('/accounts'),
      api.get('/settlements/beneficiaries'),
      api.get('/settlements/batches'),
    ]);
    setAccounts(accountsRes.data.accounts.filter((account) => account.account_role === 'settlement'));
    setBeneficiaries(beneficiariesRes.data.beneficiaries);
    setBatches(batchesRes.data.batches);
  };

  useEffect(() => { load().catch((error) => setNotice({ type: 'error', text: error.response?.data?.error || 'Unable to load settlement data' })); }, []);

  const selectedItems = useMemo(
    () => beneficiaries.filter((beneficiary) => selected[beneficiary.id]).map((beneficiary) => ({
      beneficiary_id: beneficiary.id,
      amount: Number(amounts[beneficiary.id] || 0),
      description: `${beneficiary.beneficiary_type === 'rider' ? 'Delivery' : 'Vendor'} settlement for completed work`,
    })),
    [beneficiaries, selected, amounts]
  );
  const total = selectedItems.reduce((sum, item) => sum + item.amount, 0);
  const sourceAccount = accounts[0];

  const toggleBeneficiary = (id) => {
    setSelected((current) => ({ ...current, [id]: !current[id] }));
    setAmounts((current) => ({ ...current, [id]: current[id] || 500 }));
  };

  const createBatch = async () => {
    if (!sourceAccount || selectedItems.length === 0 || selectedItems.some((item) => item.amount <= 0)) {
      setNotice({ type: 'error', text: 'Select at least one beneficiary and enter a positive payout amount.' });
      return;
    }
    setCreating(true);
    try {
      const response = await api.post('/settlements/batches', {
        source_account_id: sourceAccount.id,
        payouts: selectedItems,
      });
      setSelected({});
      setAmounts({});
      setNotice({ type: 'success', text: `Payout batch created: ${response.data.batch.id.slice(0, 8)}.` });
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.error || 'Could not create payout batch.' });
    } finally {
      setCreating(false);
    }
  };

  const processBatch = async (batchId) => {
    setProcessingId(batchId);
    try {
      const response = await api.post(`/settlements/batches/${batchId}/process`);
      const held = response.data.results.filter((result) => result.status === 'held_for_review').length;
      setNotice({
        type: held ? 'warning' : 'success',
        text: held ? `${held} payout(s) were held for admin review.` : 'Payout batch processed successfully.',
      });
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.error || 'Could not process payout batch.' });
    } finally {
      setProcessingId(null);
    }
  };

  const addBeneficiary = async (event) => {
    event.preventDefault();
    setAddingBeneficiary(true);
    try {
      await api.post('/settlements/beneficiaries', newBeneficiary);
      setNewBeneficiary({ name: '', beneficiary_type: 'rider', email: '' });
      setNotice({ type: 'success', text: 'Beneficiary wallet created.' });
      await load();
    } catch (error) {
      setNotice({ type: 'error', text: error.response?.data?.error || 'Could not add beneficiary.' });
    } finally {
      setAddingBeneficiary(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-8">
      <header className="mx-auto mb-8 flex max-w-6xl items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/merchant')} className="rounded-full bg-white p-2 text-slate-600 shadow-sm hover:text-slate-950"><ArrowLeft className="h-5 w-5" /></button>
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-blue-600">Finance operations</p>
            <h1 className="text-3xl font-bold text-slate-900">Create payout batch</h1>
          </div>
        </div>
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2 text-right">
          <div className="text-xs font-medium text-emerald-700">Settlement balance</div>
          <div className="font-bold text-emerald-900">{money(sourceAccount?.balance)}</div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="rounded-xl bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Users className="h-5 w-5 text-blue-600" /> Beneficiaries due for payout</h2>
              <p className="mt-1 text-sm text-slate-500">Select riders or vendors, then enter the amount due from completed orders or deliveries.</p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">{selectedItems.length} selected</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-slate-500"><tr><th className="pb-3"></th><th className="pb-3">Beneficiary</th><th className="pb-3">Type</th><th className="pb-3">Wallet balance</th><th className="pb-3 text-right">Payout due</th></tr></thead>
              <tbody>
                {beneficiaries.map((beneficiary) => (
                  <tr key={beneficiary.id} className="border-b last:border-0">
                    <td className="py-4"><input aria-label={`Select ${beneficiary.name}`} type="checkbox" checked={Boolean(selected[beneficiary.id])} onChange={() => toggleBeneficiary(beneficiary.id)} /></td>
                    <td className="py-4"><div className="font-semibold text-slate-900">{beneficiary.name}</div><div className="text-xs text-slate-500">{beneficiary.email || 'No notification email'}</div></td>
                    <td className="py-4 capitalize"><span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{beneficiary.beneficiary_type}</span></td>
                    <td className="py-4 text-slate-600">{money(beneficiary.wallet_balance)}</td>
                    <td className="py-4 text-right"><input disabled={!selected[beneficiary.id]} min="1" step="0.01" type="number" value={amounts[beneficiary.id] || ''} onChange={(event) => setAmounts((current) => ({ ...current, [beneficiary.id]: event.target.value }))} className="w-28 rounded border px-2 py-1 text-right disabled:bg-slate-100" placeholder="₹0" /></td>
                  </tr>
                ))}
                {!beneficiaries.length && <tr><td colSpan="5" className="py-8 text-center text-slate-500">Add a beneficiary below to create your first payout batch.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-slate-900 p-4 text-white">
            <div><div className="text-sm text-slate-300">Batch total</div><div className="text-2xl font-bold">{money(total)}</div></div>
            <button onClick={createBatch} disabled={creating || !sourceAccount} className="flex items-center gap-2 rounded bg-blue-500 px-4 py-2 font-bold hover:bg-blue-400 disabled:bg-slate-500"><Send className="h-4 w-4" /> {creating ? 'Creating…' : 'Create payout batch'}</button>
          </div>
        </section>

        <aside className="space-y-6">
          {notice && <div className={`rounded-lg border p-4 text-sm ${notice.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : notice.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>{notice.text}</div>}
          <section className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-bold text-slate-900"><Plus className="h-5 w-5 text-blue-600" /> Add beneficiary</h2>
            <form onSubmit={addBeneficiary} className="mt-4 space-y-3">
              <input required value={newBeneficiary.name} onChange={(event) => setNewBeneficiary({ ...newBeneficiary, name: event.target.value })} className="w-full rounded border px-3 py-2" placeholder="Name, e.g. Priya Sharma" />
              <select value={newBeneficiary.beneficiary_type} onChange={(event) => setNewBeneficiary({ ...newBeneficiary, beneficiary_type: event.target.value })} className="w-full rounded border px-3 py-2"><option value="rider">Rider</option><option value="vendor">Vendor</option><option value="partner">Partner</option></select>
              <input type="email" value={newBeneficiary.email} onChange={(event) => setNewBeneficiary({ ...newBeneficiary, email: event.target.value })} className="w-full rounded border px-3 py-2" placeholder="Email (optional)" />
              <button disabled={addingBeneficiary} className="w-full rounded border border-blue-200 py-2 font-semibold text-blue-700 hover:bg-blue-50">{addingBeneficiary ? 'Adding…' : 'Create beneficiary wallet'}</button>
            </form>
          </section>

          <section className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 font-bold text-slate-900"><Landmark className="h-5 w-5 text-blue-600" /> Recent batches</h2>
            <div className="mt-3 space-y-3">
              {batches.map((batch) => <div key={batch.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{money(batch.total_amount)} · {batch.total_payouts} payouts</div><div className="mt-1 text-xs text-slate-500">{new Date(batch.created_at).toLocaleString()}</div></div><Status status={batch.status} /></div>{batch.status === 'draft' && <button onClick={() => processBatch(batch.id)} disabled={processingId === batch.id} className="mt-3 w-full rounded bg-slate-900 py-2 text-sm font-semibold text-white hover:bg-slate-700">{processingId === batch.id ? 'Processing…' : 'Process batch'}</button>}</div>)}
              {!batches.length && <p className="text-sm text-slate-500">No payout batches yet.</p>}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function Status({ status }) {
  const styles = {
    completed: 'bg-emerald-100 text-emerald-800',
    has_exceptions: 'bg-amber-100 text-amber-800',
    processing: 'bg-blue-100 text-blue-800',
    draft: 'bg-slate-100 text-slate-700',
  };
  const Icon = status === 'completed' ? CheckCircle2 : status === 'has_exceptions' ? CircleAlert : Landmark;
  return <span className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ${styles[status] || styles.draft}`}><Icon className="h-3 w-3" /> {status.replaceAll('_', ' ')}</span>;
}
