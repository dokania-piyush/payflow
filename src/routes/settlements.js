const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { query, getClient } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { processPayment } = require('../services/paymentService');
const logger = require('../utils/logger');

const router = express.Router();

router.use(authenticate);

const getErrors = (req, res) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return null;
  res.status(400).json({ errors: errors.array() });
  return errors;
};

// Finance-operations summary for an organization's settlement desk.
router.get('/dashboard', async (req, res, next) => {
  try {
    const organizationId = req.merchant.id;
    const [fundsRes, payoutRes, batchRes] = await Promise.all([
      query(
        `SELECT COALESCE(SUM(balance), 0) AS available_balance
         FROM accounts
         WHERE merchant_id = $1 AND account_role = 'settlement'`,
        [organizationId]
      ),
      query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'completed' AND created_at >= CURRENT_DATE) AS completed_today,
           COUNT(*) FILTER (WHERE status = 'held_for_review') AS held_for_review,
           COUNT(*) FILTER (WHERE status IN ('ready', 'processing')) AS awaiting_processing,
           COUNT(*) FILTER (WHERE status = 'failed') AS failed
         FROM payouts WHERE organization_id = $1`,
        [organizationId]
      ),
      query(
        `SELECT id, status, total_payouts, total_amount, created_at
         FROM payout_batches
         WHERE organization_id = $1
         ORDER BY created_at DESC LIMIT 5`,
        [organizationId]
      ),
    ]);

    const metrics = payoutRes.rows[0];
    res.json({
      metrics: {
        availableBalance: parseFloat(fundsRes.rows[0].available_balance),
        completedToday: parseInt(metrics.completed_today),
        heldForReview: parseInt(metrics.held_for_review),
        awaitingProcessing: parseInt(metrics.awaiting_processing),
        failed: parseInt(metrics.failed),
      },
      recentBatches: batchRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// Beneficiaries are riders, vendors, or other partners. Their virtual wallet is
// still owned by the organization, so a beneficiary cannot issue payouts itself.
router.get('/beneficiaries', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT b.id, b.name, b.beneficiary_type, b.email, b.is_active, b.created_at,
              a.id AS payout_account_id, a.balance AS wallet_balance
       FROM beneficiaries b
       JOIN accounts a ON a.id = b.payout_account_id
       WHERE b.organization_id = $1
       ORDER BY b.created_at DESC`,
      [req.merchant.id]
    );
    res.json({ beneficiaries: result.rows });
  } catch (err) {
    next(err);
  }
});

router.post('/beneficiaries',
  body('name').trim().notEmpty().isLength({ max: 255 }),
  body('beneficiary_type').isIn(['rider', 'vendor', 'partner']),
  body('email').optional({ values: 'falsy' }).isEmail().normalizeEmail(),
  async (req, res, next) => {
    if (getErrors(req, res)) return;
    const client = await getClient();

    try {
      await client.query('BEGIN');
      const accountRes = await client.query(
        `INSERT INTO accounts (merchant_id, currency, balance, opening_balance, account_role)
         VALUES ($1, 'INR', 0, 0, 'beneficiary_wallet') RETURNING id, balance`,
        [req.merchant.id]
      );
      const account = accountRes.rows[0];
      const beneficiaryRes = await client.query(
        `INSERT INTO beneficiaries (organization_id, name, beneficiary_type, email, payout_account_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [req.merchant.id, req.body.name, req.body.beneficiary_type, req.body.email || null, account.id]
      );
      await client.query('COMMIT');
      res.status(201).json({ beneficiary: { ...beneficiaryRes.rows[0], wallet_balance: account.balance } });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

router.get('/batches', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT pb.id, pb.status, pb.total_payouts, pb.total_amount, pb.created_at,
              COUNT(p.id) FILTER (WHERE p.status = 'completed') AS completed_count,
              COUNT(p.id) FILTER (WHERE p.status = 'held_for_review') AS held_count,
              COUNT(p.id) FILTER (WHERE p.status = 'failed') AS failed_count
       FROM payout_batches pb
       LEFT JOIN payouts p ON p.batch_id = pb.id
       WHERE pb.organization_id = $1
       GROUP BY pb.id
       ORDER BY pb.created_at DESC LIMIT 25`,
      [req.merchant.id]
    );
    res.json({ batches: result.rows });
  } catch (err) {
    next(err);
  }
});

// A batch only records approved payout instructions. Processing is an explicit
// second step so the UI can demonstrate finance-ops review and exception handling.
router.post('/batches',
  body('source_account_id').isUUID(),
  body('payouts').isArray({ min: 1, max: 25 }),
  body('payouts.*.beneficiary_id').isUUID(),
  body('payouts.*.amount').isFloat({ gt: 0 }),
  body('payouts.*.description').optional().isString().isLength({ max: 512 }),
  async (req, res, next) => {
    if (getErrors(req, res)) return;
    const organizationId = req.merchant.id;
    const instructions = req.body.payouts;
    const beneficiaryIds = instructions.map((item) => item.beneficiary_id);

    if (new Set(beneficiaryIds).size !== beneficiaryIds.length) {
      return res.status(400).json({ error: 'A beneficiary may appear only once in a payout batch' });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      const sourceRes = await client.query(
        `SELECT id FROM accounts
         WHERE id = $1 AND merchant_id = $2 AND account_role = 'settlement' FOR UPDATE`,
        [req.body.source_account_id, organizationId]
      );
      if (!sourceRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Choose an organization-owned settlement account as the payout source' });
      }

      const beneficiariesRes = await client.query(
        `SELECT id FROM beneficiaries
         WHERE organization_id = $1 AND is_active = true AND id = ANY($2::uuid[])`,
        [organizationId, beneficiaryIds]
      );
      if (beneficiariesRes.rows.length !== beneficiaryIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'One or more beneficiaries are unavailable for this organization' });
      }

      const totalAmount = instructions.reduce((sum, item) => sum + Number(item.amount), 0);
      const batchId = uuidv4();
      await client.query(
        `INSERT INTO payout_batches
           (id, organization_id, source_account_id, status, total_payouts, total_amount)
         VALUES ($1,$2,$3,'draft',$4,$5)`,
        [batchId, organizationId, req.body.source_account_id, instructions.length, totalAmount]
      );

      for (let index = 0; index < instructions.length; index += 1) {
        const item = instructions[index];
        await client.query(
          `INSERT INTO payouts
             (id, batch_id, organization_id, beneficiary_id, payout_reference, amount, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [uuidv4(), batchId, organizationId, item.beneficiary_id,
           `PAYOUT-${batchId.slice(0, 8)}-${String(index + 1).padStart(2, '0')}`,
           Number(item.amount), item.description || null]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ batch: { id: batchId, totalPayouts: instructions.length, totalAmount, status: 'draft' } });
    } catch (err) {
      await client.query('ROLLBACK');
      next(err);
    } finally {
      client.release();
    }
  }
);

router.post('/batches/:id/process', param('id').isUUID(), async (req, res, next) => {
  if (getErrors(req, res)) return;

  try {
    const batchRes = await query(
      `SELECT id, source_account_id FROM payout_batches WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.merchant.id]
    );
    if (!batchRes.rows.length) return res.status(404).json({ error: 'Payout batch not found' });

    const batch = batchRes.rows[0];
    await query(`UPDATE payout_batches SET status = 'processing' WHERE id = $1`, [batch.id]);
    const payoutsRes = await query(
      `SELECT p.id, p.payout_reference, p.amount, p.description, b.payout_account_id
       FROM payouts p
       JOIN beneficiaries b ON b.id = p.beneficiary_id
       WHERE p.batch_id = $1 AND p.status = 'ready'
       ORDER BY p.created_at`,
      [batch.id]
    );

    const results = [];
    for (const payout of payoutsRes.rows) {
      // Claim the work item before executing it, which prevents a second worker
      // or accidental double-click from processing this payout concurrently.
      const claim = await query(
        `UPDATE payouts SET status = 'processing', updated_at = NOW()
         WHERE id = $1 AND status = 'ready' RETURNING id`,
        [payout.id]
      );
      if (!claim.rows.length) continue;

      try {
        const payment = await processPayment({
          idempotencyKey: `payout:${payout.id}`,
          merchantId: req.merchant.id,
          senderAccountId: batch.source_account_id,
          receiverAccountId: payout.payout_account_id,
          amount: Number(payout.amount),
          currency: 'INR',
          description: payout.description || `Settlement payout ${payout.payout_reference}`,
          metadata: { payout_id: payout.id, payout_batch_id: batch.id, payout_reference: payout.payout_reference },
        });

        if (!payment.success) {
          await query(
            `UPDATE payouts SET status = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1`,
            [payout.id, payment.error]
          );
          results.push({ payoutId: payout.id, status: 'failed', error: payment.error });
          continue;
        }

        const payoutStatus = payment.held ? 'held_for_review' : 'completed';
        await query(
          `UPDATE payouts
           SET transaction_id = $2, status = $3, risk_score = $4, risk_flags = $5, updated_at = NOW()
           WHERE id = $1`,
          [payout.id, payment.transaction.id, payoutStatus, payment.transaction.risk_score,
           JSON.stringify(payment.transaction.risk_flags || [])]
        );
        results.push({ payoutId: payout.id, transactionId: payment.transaction.id, status: payoutStatus });
      } catch (err) {
        logger.error('Settlement payout failed', { payoutId: payout.id, error: err.message });
        await query(
          `UPDATE payouts SET status = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1`,
          [payout.id, err.message]
        );
        results.push({ payoutId: payout.id, status: 'failed', error: err.message });
      }
    }

    const statusRes = await query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('ready', 'processing')) AS active,
              COUNT(*) FILTER (WHERE status IN ('held_for_review', 'failed')) AS exceptions
       FROM payouts WHERE batch_id = $1`,
      [batch.id]
    );
    const summary = statusRes.rows[0];
    const batchStatus = parseInt(summary.active) > 0
      ? 'processing'
      : parseInt(summary.exceptions) > 0 ? 'has_exceptions' : 'completed';
    await query(`UPDATE payout_batches SET status = $2, updated_at = NOW() WHERE id = $1`, [batch.id, batchStatus]);

    res.json({ batchId: batch.id, status: batchStatus, results });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
