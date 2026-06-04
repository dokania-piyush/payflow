const API = "https://payflow-production-c2d6.up.railway.app";
let TOKEN = localStorage.getItem('pf_token') || '';
let MERCHANT = JSON.parse(localStorage.getItem('pf_merchant') || 'null');
let currentLedgerAcct = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Auth tabs
  document.getElementById('tab-login-btn').addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('tab-register-btn').addEventListener('click', () => switchAuthTab('register'));

  // Auth buttons
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('register-btn').addEventListener('click', doRegister);
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Enter key on password
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('reg-password').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

  // Nav items
  document.getElementById('nav-dashboard').addEventListener('click', () => showView('dashboard'));
  document.getElementById('nav-send').addEventListener('click', () => showView('send'));
  document.getElementById('nav-transactions').addEventListener('click', () => showView('transactions'));
  document.getElementById('nav-accounts').addEventListener('click', () => showView('accounts'));
  document.getElementById('nav-reconciliation').addEventListener('click', () => showView('reconciliation'));

  // Dashboard
  document.getElementById('dash-view-all').addEventListener('click', () => showView('transactions'));

  // Send payment
  document.getElementById('gen-idem-btn').addEventListener('click', genIdem);
  document.getElementById('pay-btn').addEventListener('click', sendPayment);

  // Transactions
  document.getElementById('refresh-txns').addEventListener('click', loadTransactions);
  document.getElementById('txn-filter').addEventListener('change', loadTransactions);

  // Reconciliation
  document.getElementById('recon-btn').addEventListener('click', runRecon);
  document.getElementById('refresh-reports').addEventListener('click', loadReconReports);
  document.getElementById('refresh-ledger').addEventListener('click', () => { if (currentLedgerAcct) loadLedger(currentLedgerAcct); });

  if (TOKEN && MERCHANT) {
    showApp();
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────
function switchAuthTab(t) {
  document.getElementById('tab-login-btn').classList.toggle('active', t === 'login');
  document.getElementById('tab-register-btn').classList.toggle('active', t === 'register');
  document.getElementById('tab-login').style.display = t === 'login' ? '' : 'none';
  document.getElementById('tab-register').style.display = t === 'register' ? '' : 'none';
  document.getElementById('auth-error').style.display = 'none';
}

async function doRegister() {
  const btn = document.getElementById('register-btn');
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  setLoading(btn, true);
  hideAuthError();
  try {
    await api('/auth/register', 'POST', { name, email, password });
    showToast('Account created — please sign in', 'success');
    switchAuthTab('login');
    document.getElementById('login-email').value = email;
  } catch(e) { showAuthError(e.message); }
  finally { setLoading(btn, false, 'Create Account'); }
}

async function doLogin() {
  const btn = document.getElementById('login-btn');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  setLoading(btn, true);
  hideAuthError();
  try {
    const r = await api('/auth/login', 'POST', { email, password });
    TOKEN = r.token;
    MERCHANT = r.merchant;
    localStorage.setItem('pf_token', TOKEN);
    localStorage.setItem('pf_merchant', JSON.stringify(MERCHANT));
    showApp();
  } catch(e) { showAuthError(e.message); }
  finally { setLoading(btn, false, 'Sign In'); }
}

function logout() {
  TOKEN = ''; MERCHANT = null;
  localStorage.removeItem('pf_token');
  localStorage.removeItem('pf_merchant');
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg; el.style.display = 'block';
}
function hideAuthError() {
  document.getElementById('auth-error').style.display = 'none';
}

// ── App ───────────────────────────────────────────────────────────────────────
function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'flex';
  document.getElementById('sidebar-name').textContent = MERCHANT.name;
  showView('dashboard');
}

const viewTitles = { dashboard: 'Dashboard', send: 'Send Payment', transactions: 'Transactions', accounts: 'Accounts', reconciliation: 'Reconciliation' };

function showView(v) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-' + v).classList.add('active');
  document.getElementById('page-title').textContent = viewTitles[v] || v;
  if (v === 'dashboard')      loadDashboard();
  if (v === 'transactions')   loadTransactions();
  if (v === 'accounts')       loadAccounts();
  if (v === 'reconciliation') loadReconReports();
  if (v === 'send')           loadSendForm();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [txnsR, acctR] = await Promise.all([api('/payments?limit=100'), api('/accounts')]);
    const txns = txnsR.transactions || [];
    const completed = txns.filter(t => t.status === 'completed');
    const pending   = txns.filter(t => t.status === 'pending');
    const volume    = completed.reduce((s, t) => s + parseFloat(t.amount), 0);

    document.getElementById('stat-total').textContent     = txns.length;
    document.getElementById('stat-completed').textContent = completed.length;
    document.getElementById('stat-pending').textContent   = pending.length;
    document.getElementById('stat-volume').textContent    = '₹' + volume.toLocaleString('en-IN', { maximumFractionDigits: 0 });

    const recent = txns.slice(0, 5);
    const tbody = document.getElementById('recent-txns');
    tbody.innerHTML = recent.length ? recent.map(t => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-bottom:1px solid var(--border)">
        <div><div style="font-size:13px;font-weight:600">${t.description || '—'}</div><div class="txn-id">${t.id.slice(0, 16)}…</div></div>
        <div style="text-align:right"><div class="amount-cell" style="color:var(--green)">₹${parseFloat(t.amount).toLocaleString('en-IN')}</div><div style="margin-top:4px">${statusBadge(t.status)}</div></div>
      </div>`).join('') : '<div class="empty"><div class="icon">📭</div>No transactions yet</div>';

    const accounts = acctR.accounts || [];
    document.getElementById('dash-accounts').innerHTML = accounts.map(a => `
      <div class="account-card">
        <div><div style="font-size:13px;font-weight:700">${a.currency} Account</div><div class="acct-id">${a.id.slice(0, 20)}…</div></div>
        <div class="acct-balance">₹${parseFloat(a.balance).toLocaleString('en-IN')}</div>
      </div>`).join('') || '<div class="empty">No accounts found</div>';
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Transactions ──────────────────────────────────────────────────────────────
async function loadTransactions() {
  const status = document.getElementById('txn-filter').value;
  const tbody = document.getElementById('txn-tbody');
  tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><span class="spinner"></span></div></td></tr>';
  try {
    const r = await api('/payments?limit=50' + (status ? '&status=' + status : ''));
    const txns = r.transactions || [];
    if (!txns.length) { tbody.innerHTML = '<tr><td colspan="7"><div class="empty"><div class="icon">📭</div>No transactions</div></td></tr>'; return; }
    tbody.innerHTML = txns.map(t => {
      const score = parseFloat(t.risk_score) || 0;
      const scoreColor = score < 0.3 ? 'var(--green)' : score < 0.7 ? 'var(--yellow)' : 'var(--red)';
      return `<tr>
        <td><div class="txn-id">${t.id.slice(0, 12)}…</div></td>
        <td><div class="amount-cell">₹${parseFloat(t.amount).toLocaleString('en-IN')}</div></td>
        <td>${statusBadge(t.status)}</td>
        <td><div class="risk-wrap"><div class="risk-bar"><div class="risk-fill" style="width:${(score * 100).toFixed(0)}%;background:${scoreColor}"></div></div><div class="risk-val" style="color:${scoreColor}">${score.toFixed(3)}</div></div></td>
        <td style="color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.description || '—'}</td>
        <td style="color:var(--muted);font-size:12px">${fmtDate(t.created_at)}</td>
        <td>${t.status === 'completed' ? `<button class="copy-btn" data-txn-id="${t.id}">Reverse</button>` : ''}</td>
      </tr>`;
    }).join('');

    // Attach reverse button listeners
    tbody.querySelectorAll('[data-txn-id]').forEach(btn => {
      btn.addEventListener('click', () => openReverse(btn.dataset.txnId));
    });
  } catch(e) { tbody.innerHTML = `<tr><td colspan="7"><div class="empty">${e.message}</div></td></tr>`; }
}

// ── Accounts ──────────────────────────────────────────────────────────────────
async function loadAccounts() {
  try {
    const r = await api('/accounts');
    const accounts = r.accounts || [];

    const select = document.getElementById('pay-sender');
    select.innerHTML = '<option value="">Select account...</option>' +
      accounts.map(a => `<option value="${a.id}">${a.currency} — ₹${parseFloat(a.balance).toLocaleString('en-IN')} (${a.id.slice(0, 8)}…)</option>`).join('');

    document.getElementById('accounts-list').innerHTML = accounts.map(a => `
      <div class="account-card" data-acct-id="${a.id}" data-acct-label="${a.id.slice(0,16)}…">
        <div>
          <div style="font-size:14px;font-weight:700">${a.currency} Account</div>
          <div class="acct-id">${a.id}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">Tap to view ledger →</div>
        </div>
        <div>
          <div class="acct-balance">₹${parseFloat(a.balance).toLocaleString('en-IN')}</div>
          <button class="copy-btn" data-copy="${a.id}" style="margin-top:6px;float:right">Copy ID</button>
        </div>
      </div>`).join('') || '<div class="empty">No accounts</div>';

    document.getElementById('accounts-list').querySelectorAll('.account-card').forEach(card => {
      card.addEventListener('click', () => loadLedger(card.dataset.acctId, card.dataset.acctLabel));
    });
    document.getElementById('accounts-list').querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); copyText(btn.dataset.copy); });
    });
  } catch(e) { showToast(e.message, 'error'); }
}

async function loadLedger(acctId, label) {
  currentLedgerAcct = acctId;
  document.getElementById('ledger-acct-label').textContent = label || acctId.slice(0, 20) + '…';
  document.getElementById('ledger-entries').innerHTML = '<div class="empty"><span class="spinner"></span></div>';
  try {
    const r = await api('/accounts/' + acctId + '/ledger');
    const entries = r.ledger || [];
    document.getElementById('ledger-entries').innerHTML = entries.length ? entries.map(e => `
      <div class="ledger-entry">
        <div><span class="ledger-type ${e.entry_type}">${e.entry_type.toUpperCase()}</span><span style="color:var(--muted);font-size:12px;margin-left:8px">${e.description || '—'}</span></div>
        <div style="text-align:right">
          <div style="font-weight:700;color:${e.entry_type === 'credit' ? 'var(--green)' : 'var(--red)'}">
            ${e.entry_type === 'credit' ? '+' : '−'}₹${parseFloat(e.amount).toLocaleString('en-IN')}
          </div>
          <div style="font-size:11px;color:var(--muted)">Bal: ₹${parseFloat(e.running_balance).toLocaleString('en-IN')}</div>
        </div>
      </div>`).join('') : '<div class="empty">No ledger entries yet</div>';
  } catch(e) { document.getElementById('ledger-entries').innerHTML = `<div class="empty">${e.message}</div>`; }
}

// ── Send payment ──────────────────────────────────────────────────────────────
async function loadSendForm() {
  await loadAccounts();
  genIdem();
}

function genIdem() {
  document.getElementById('pay-idem').value = 'pay-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

async function sendPayment() {
  const btn = document.getElementById('pay-btn');
  const sender   = document.getElementById('pay-sender').value;
  const receiver = document.getElementById('pay-receiver').value.trim();
  const amount   = document.getElementById('pay-amount').value;
  const idem     = document.getElementById('pay-idem').value.trim();
  const desc     = document.getElementById('pay-desc').value.trim();

  document.getElementById('pay-error').style.display = 'none';
  document.getElementById('pay-result').style.display = 'none';

  if (!sender || !receiver || !amount || !idem) {
    document.getElementById('pay-error').textContent = 'Please fill in all required fields';
    document.getElementById('pay-error').style.display = 'block';
    return;
  }

  setLoading(btn, true);
  try {
    const r = await fetch(API + '/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN, 'Idempotency-Key': idem },
      body: JSON.stringify({ sender_account_id: sender, receiver_account_id: receiver, amount: parseFloat(amount), currency: 'INR', description: desc || 'Payment from dashboard' })
    });
    const data = await r.json();
    document.getElementById('pay-result').style.display = 'block';
    document.getElementById('pay-result-body').textContent = JSON.stringify(data, null, 2);
    if (r.ok) {
      showToast(data.held_for_review ? '⚠ Held for review (high risk)' : '✓ Payment successful', data.held_for_review ? 'error' : 'success');
      genIdem();
    } else { throw new Error(data.error || 'Payment failed'); }
  } catch(e) {
    document.getElementById('pay-error').textContent = e.message;
    document.getElementById('pay-error').style.display = 'block';
    showToast(e.message, 'error');
  }
  setLoading(btn, false, 'Process Payment →');
}

// ── Reverse ───────────────────────────────────────────────────────────────────
async function openReverse(txnId) {
  const reason = prompt('Reason for reversal:');
  if (!reason) return;
  try {
    await api('/payments/' + txnId + '/reverse', 'POST', { reason });
    showToast('Transaction reversed', 'success');
    loadTransactions();
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Reconciliation ────────────────────────────────────────────────────────────
async function runRecon() {
  const btn = document.getElementById('recon-btn');
  setLoading(btn, true);
  document.getElementById('recon-result').style.display = 'none';
  try {
    const r = await api('/accounts/reconciliation/run', 'POST');
    const report = r.report;
    const isClean = report.status === 'clean';
    document.getElementById('recon-result').style.display = 'block';
    document.getElementById('recon-result').innerHTML = `
      <div style="background:var(--bg2);border:1px solid ${isClean ? 'rgba(0,229,160,.2)' : 'rgba(255,77,106,.2)'};border-radius:10px;padding:16px">
        <div style="font-weight:700;font-size:15px;color:${isClean ? 'var(--green)' : 'var(--red)'};margin-bottom:12px">${isClean ? '✓ Ledger is clean' : '⚠ Discrepancies found'}</div>
        <div class="recon-stat"><span>Total transactions</span><span class="val">${report.totalTxns}</span></div>
        <div class="recon-stat"><span>Matched</span><span class="val" style="color:var(--green)">${report.matched}</span></div>
        <div class="recon-stat"><span>Mismatches</span><span class="val" style="color:${report.mismatches > 0 ? 'var(--red)' : 'var(--text)'}">${report.mismatches}</span></div>
        <div class="recon-stat"><span>Discrepancy amount</span><span class="val">₹${parseFloat(report.discrepancyAmt || 0).toFixed(2)}</span></div>
      </div>`;
    showToast(isClean ? '✓ Reconciliation clean' : '⚠ Discrepancies detected', isClean ? 'success' : 'error');
    loadReconReports();
  } catch(e) { showToast(e.message, 'error'); }
  setLoading(btn, false, 'Run Now →');
}

async function loadReconReports() {
  try {
    const r = await api('/accounts/reconciliation/reports');
    const reports = r.reports || [];
    document.getElementById('recon-reports').innerHTML = reports.length ? reports.slice(0, 10).map(r => `
      <div class="ledger-entry">
        <div><div style="font-size:13px;font-weight:600">${fmtDate(r.created_at)}</div><div style="font-size:11px;color:var(--muted)">${r.total_txns} transactions · ${r.mismatches} mismatches</div></div>
        <span class="badge ${r.status === 'clean' ? 'badge-green' : 'badge-red'}">${r.status === 'clean' ? 'Clean' : 'Issues'}</span>
      </div>`).join('') : '<div class="empty">No reports yet</div>';
  } catch(e) { /* silent */ }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {}) } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(API + path, opts);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || data.errors?.[0]?.msg || 'Request failed');
  return data;
}

function statusBadge(s) {
  const map = { completed: 'green', pending: 'yellow', failed: 'red', reversed: 'blue', processing: 'blue' };
  return `<span class="badge badge-${map[s] || 'blue'}">${s}</span>`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard', 'success'));
}

function setLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.innerHTML = loading ? '<span class="spinner"></span>' : (label || btn.textContent);
}

let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}
