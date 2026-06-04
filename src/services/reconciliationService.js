const { query, getClient } = require('../config/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * runReconciliation — nightly double-entry integrity check.
 *
 * Checks:
 *  1. Every completed transaction has exactly 2 ledger entries (1 debit + 1 credit)
 *  2. Debit amount == Credit amount for every transaction
 *  3. Net sum of ALL ledger entries == 0 (the golden rule of double-entry bookkeeping)
 *  4. Account running balances match computed balances from ledger history
 *
 * Discrepancies are written to audit_discrepancies for human review.
 */
const runReconciliation = async (periodStart, periodEnd) => {
  const reportId = uuidv4();
  const discrepancies = [];
  const client = await getClient();

  logger.info('Reconciliation started', { periodStart, periodEnd });

  try {
    // ── Check 1: Transactions with missing ledger entries ──
    const orphanRes = await query(
      `SELECT t.id, t.amount, COUNT(le.id) AS entry_count
       FROM transactions t
       LEFT JOIN ledger_entries le ON le.transaction_id = t.id
       WHERE t.status = 'completed'
         AND t.created_at BETWEEN $1 AND $2
       GROUP BY t.id, t.amount
       HAVING COUNT(le.id) != 2`,
      [periodStart, periodEnd]
    );

    for (const row of orphanRes.rows) {
      discrepancies.push({
        transaction_id: row.id,
        discrepancy_type: 'missing_ledger_entries',
        description: `Expected 2 ledger entries, found ${row.entry_count}`,
        expected_amount: row.amount,
        actual_amount: null,
      });
    }

    // ── Check 2: Debit/Credit amount mismatch per transaction ──
    const mismatchRes = await query(
      `SELECT
         le.transaction_id,
         SUM(CASE WHEN le.entry_type = 'debit'  THEN le.amount ELSE 0 END) AS debit_total,
         SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END) AS credit_total
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       WHERE t.created_at BETWEEN $1 AND $2
         AND t.status = 'completed'
       GROUP BY le.transaction_id
       HAVING SUM(CASE WHEN le.entry_type = 'debit'  THEN le.amount ELSE 0 END)
           != SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END)`,
      [periodStart, periodEnd]
    );

    for (const row of mismatchRes.rows) {
      discrepancies.push({
        transaction_id: row.transaction_id,
        discrepancy_type: 'debit_credit_mismatch',
        description: `Debit ${row.debit_total} != Credit ${row.credit_total}`,
        expected_amount: row.debit_total,
        actual_amount: row.credit_total,
      });
    }

    // ── Check 3: Global net balance (must be exactly 0) ──
    const netRes = await query(
      `SELECT
         SUM(CASE WHEN le.entry_type = 'debit'  THEN -le.amount ELSE le.amount END) AS net
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       WHERE t.created_at BETWEEN $1 AND $2
         AND t.status = 'completed'`,
      [periodStart, periodEnd]
    );

    const net = parseFloat(netRes.rows[0]?.net || 0);
    if (Math.abs(net) > 0.001) {
      discrepancies.push({
        transaction_id: null,
        discrepancy_type: 'global_net_nonzero',
        description: `Global ledger net = ${net}, expected 0. Possible data corruption.`,
        expected_amount: 0,
        actual_amount: net,
      });
    }

    // ── Check 4: Account balance vs ledger recomputation ──
    const balanceCheckRes = await query(
      `SELECT
         a.id,
         a.balance AS stored_balance,
         COALESCE(
           SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount
                    WHEN le.entry_type = 'debit'  THEN -le.amount END),
           0
         ) AS computed_balance
       FROM accounts a
       LEFT JOIN ledger_entries le ON le.account_id = a.id
       GROUP BY a.id, a.balance
       HAVING ABS(
         a.balance - COALESCE(
           SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount
                    WHEN le.entry_type = 'debit'  THEN -le.amount END),
           0
         )
       ) > 0.001`,
      []
    );

    for (const row of balanceCheckRes.rows) {
      discrepancies.push({
        transaction_id: null,
        discrepancy_type: 'balance_mismatch',
        description: `Account ${row.id}: stored ${row.stored_balance} vs computed ${row.computed_balance}`,
        expected_amount: row.computed_balance,
        actual_amount: row.stored_balance,
      });
    }

    // ── Count total transactions in period ──
    const totalRes = await query(
      `SELECT COUNT(*) AS total FROM transactions
       WHERE created_at BETWEEN $1 AND $2 AND status = 'completed'`,
      [periodStart, periodEnd]
    );

    const totalTxns = parseInt(totalRes.rows[0].total);
    const discrepancyAmt = discrepancies.reduce((sum, d) => {
      if (d.expected_amount && d.actual_amount) {
        return sum + Math.abs(parseFloat(d.expected_amount) - parseFloat(d.actual_amount));
      }
      return sum;
    }, 0);

    // ── Persist report ──
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO reconciliation_reports
         (id, period_start, period_end, total_txns, matched, mismatches, discrepancy_amt, status, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [reportId, periodStart, periodEnd, totalTxns,
       totalTxns - discrepancies.length, discrepancies.length,
       discrepancyAmt,
       discrepancies.length > 0 ? 'has_discrepancies' : 'clean',
       JSON.stringify(discrepancies)]
    );

    for (const d of discrepancies) {
      await client.query(
        `INSERT INTO audit_discrepancies
           (report_id, transaction_id, discrepancy_type, expected_amount, actual_amount, description)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [reportId, d.transaction_id, d.discrepancy_type, d.expected_amount, d.actual_amount, d.description]
      );
    }

    await client.query('COMMIT');

    const result = {
      reportId,
      periodStart,
      periodEnd,
      totalTxns,
      matched: totalTxns - discrepancies.length,
      mismatches: discrepancies.length,
      discrepancyAmt,
      status: discrepancies.length > 0 ? 'has_discrepancies' : 'clean',
      discrepancies,
    };

    logger.info('Reconciliation completed', {
      reportId,
      totalTxns,
      mismatches: discrepancies.length,
      status: result.status,
    });

    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Reconciliation failed', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { runReconciliation };
