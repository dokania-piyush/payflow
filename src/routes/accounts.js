const express = require('express');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');
const { runReconciliation } = require('../services/reconciliationService');
const logger = require('../utils/logger');

const router = express.Router();

// GET /accounts — list merchant accounts
router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT a.id, a.currency, a.balance, a.opening_balance, a.account_role, a.version, a.created_at,
              a.opening_balance + COALESCE(SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE -le.amount END), 0) AS ledger_balance
       FROM accounts a
       LEFT JOIN ledger_entries le ON le.account_id = a.id
       WHERE a.merchant_id = $1
       GROUP BY a.id`,
      [req.merchant.id]
    );
    res.json({ accounts: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /accounts/:id/ledger — full ledger history for an account
router.get('/:id/ledger', authenticate, async (req, res, next) => {
  try {
    const ownerCheck = await query(
      'SELECT id FROM accounts WHERE id = $1 AND merchant_id = $2',
      [req.params.id, req.merchant.id]
    );
    if (!ownerCheck.rows.length) return res.status(404).json({ error: 'Account not found' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);

    const result = await query(
      `SELECT le.*, t.description, t.status AS txn_status
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       WHERE le.account_id = $1
       ORDER BY le.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, limit, (page - 1) * limit]
    );

    res.json({ ledger: result.rows, page, limit });
  } catch (err) {
    next(err);
  }
});

// POST /reconciliation/run — trigger manual reconciliation (admin use)
router.post('/reconciliation/run', authenticate, async (req, res, next) => {
  try {
    const periodEnd = new Date();
    const periodStart = new Date(periodEnd - 24 * 60 * 60 * 1000); // last 24 hours

    const report = await runReconciliation(periodStart.toISOString(), periodEnd.toISOString());
    res.json({ report });
  } catch (err) {
    next(err);
  }
});

// GET /reconciliation/reports — list reconciliation reports
router.get('/reconciliation/reports', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, period_start, period_end, total_txns, matched, mismatches,
              discrepancy_amt, status, created_at
       FROM reconciliation_reports ORDER BY created_at DESC LIMIT 30`
    );
    res.json({ reports: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
