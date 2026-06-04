const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { idempotency } = require('../middleware/idempotency');
const { processPayment, reverseTransaction } = require('../services/paymentService');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

// POST /payments — initiate a payment
router.post('/',
  authenticate,
  idempotency,
  body('sender_account_id').isUUID().withMessage('Valid sender_account_id required'),
  body('receiver_account_id').isUUID().withMessage('Valid receiver_account_id required'),
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be positive'),
  body('currency').optional().isIn(['INR', 'USD', 'EUR']),
  body('description').optional().isString().isLength({ max: 512 }),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { sender_account_id, receiver_account_id, amount, currency, description, metadata } = req.body;

      if (sender_account_id === receiver_account_id) {
        return res.status(400).json({ error: 'Sender and receiver cannot be the same account' });
      }

      // Verify the sender account belongs to this merchant
      const accountCheck = await query(
        'SELECT id FROM accounts WHERE id = $1 AND merchant_id = $2',
        [sender_account_id, req.merchant.id]
      );

      if (!accountCheck.rows.length) {
        return res.status(403).json({ error: 'Sender account does not belong to this merchant' });
      }

      const result = await processPayment({
        idempotencyKey: req.headers['idempotency-key'],
        merchantId: req.merchant.id,
        senderAccountId: sender_account_id,
        receiverAccountId: receiver_account_id,
        amount: parseFloat(amount),
        currency: currency || 'INR',
        description,
        metadata,
      });

      if (!result.success) {
        return res.status(result.statusCode || 400).json({ error: result.error, details: result.details });
      }

      const statusCode = result.held ? 202 : 201;
      const responseBody = {
        transaction: result.transaction,
        held_for_review: result.held || false,
        message: result.held
          ? 'Transaction held for manual review due to elevated risk score'
          : 'Payment processed successfully',
      };

      // Store in idempotency cache so retries return this exact response
      if (res.storeIdempotencyResult) {
        await res.storeIdempotencyResult(statusCode, responseBody);
      }

      res.status(statusCode).json(responseBody);
    } catch (err) {
      next(err);
    }
  }
);

// GET /payments/:id — get transaction status
router.get('/:id',
  authenticate,
  param('id').isUUID(),
  async (req, res, next) => {
    try {
      const result = await query(
        `SELECT t.*,
                json_agg(json_build_object(
                  'entry_type', le.entry_type,
                  'amount', le.amount,
                  'account_id', le.account_id,
                  'running_balance', le.running_balance,
                  'created_at', le.created_at
                ) ORDER BY le.created_at) AS ledger_entries
         FROM transactions t
         LEFT JOIN ledger_entries le ON le.transaction_id = t.id
         WHERE t.id = $1 AND t.merchant_id = $2
         GROUP BY t.id`,
        [req.params.id, req.merchant.id]
      );

      if (!result.rows.length) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      res.json({ transaction: result.rows[0] });
    } catch (err) {
      next(err);
    }
  }
);

// GET /payments — list transactions with pagination
router.get('/',
  authenticate,
  async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, parseInt(req.query.limit) || 20);
      const offset = (page - 1) * limit;
      const status = req.query.status;

      const conditions = ['t.merchant_id = $1'];
      const params = [req.merchant.id];

      if (status) {
        conditions.push(`t.status = $${params.length + 1}`);
        params.push(status);
      }

      const where = conditions.join(' AND ');

      const [txnsRes, countRes] = await Promise.all([
        query(
          `SELECT id, amount, currency, status, description, risk_score, risk_flags, created_at, updated_at
           FROM transactions t WHERE ${where}
           ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        ),
        query(`SELECT COUNT(*) FROM transactions t WHERE ${where}`, params),
      ]);

      res.json({
        transactions: txnsRes.rows,
        pagination: {
          total: parseInt(countRes.rows[0].count),
          page,
          limit,
          pages: Math.ceil(parseInt(countRes.rows[0].count) / limit),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /payments/:id/reverse — reverse a completed transaction
router.post('/:id/reverse',
  authenticate,
  param('id').isUUID(),
  body('reason').notEmpty().withMessage('Reason for reversal is required'),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const result = await reverseTransaction({
        transactionId: req.params.id,
        merchantId: req.merchant.id,
        reason: req.body.reason,
      });

      if (!result.success) {
        return res.status(result.statusCode || 400).json({ error: result.error });
      }

      res.json({ message: 'Transaction reversed', reversalId: result.reversalId });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
