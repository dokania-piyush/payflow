const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { query } = require('../config/database');
const { webhookQueue, replayWebhook } = require('../services/webhookService');
const { resolvePendingTransaction } = require('../services/paymentService');

const router = express.Router();

// Apply middlewares to all admin routes
router.use(authenticate);
router.use(requireAdmin);

// 1. Search Users
router.get('/users', async (req, res, next) => {
  try {
    const search = req.query.q || '';
    const usersRes = await query(
      `SELECT id, name, email, role, is_active, created_at 
       FROM merchants 
       WHERE name ILIKE $1 OR email ILIKE $1
       ORDER BY created_at DESC 
       LIMIT 50`,
      [`%${search}%`]
    );
    res.json(usersRes.rows);
  } catch (err) {
    next(err);
  }
});

// 2. Freeze/Unfreeze Account
router.post('/users/:id/toggle-freeze', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Get current state
    const current = await query('SELECT is_active FROM merchants WHERE id = $1', [id]);
    if (!current.rows.length) return res.status(404).json({ error: 'User not found' });
    
    const newState = !current.rows[0].is_active;
    
    await query('UPDATE merchants SET is_active = $1, updated_at = NOW() WHERE id = $2', [newState, id]);
    
    res.json({ message: `User ${newState ? 'unfrozen' : 'frozen'} successfully`, is_active: newState });
  } catch (err) {
    next(err);
  }
});

// 3. View Transactions (with filters)
router.get('/transactions', async (req, res, next) => {
  try {
    const { flagged_only } = req.query;
    
    let sql = `SELECT t.id, t.amount, t.currency, t.status, t.risk_score, t.risk_flags, t.created_at, m.name as merchant_name
               FROM transactions t
               JOIN merchants m ON t.merchant_id = m.id`;
               
    if (flagged_only === 'true') {
      sql += ` WHERE t.risk_score > 0.85`;
    }
    
    sql += ` ORDER BY t.created_at DESC LIMIT 100`;
    
    const txnsRes = await query(sql);
    res.json(txnsRes.rows);
  } catch (err) {
    next(err);
  }
});

// 4. Resolve Pending Transaction
router.post('/transactions/:id/resolve',
  param('id').isUUID(),
  body('action').isIn(['approve', 'reject']),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { id } = req.params;
      const { action } = req.body;

      const result = await resolvePendingTransaction({
        transactionId: id,
        adminId: req.merchant.id, // Assuming admin is using the merchant context for auth
        action
      });

      if (!result.success) {
        return res.status(result.statusCode || 400).json({ error: result.error });
      }

      res.json({ message: `Transaction successfully ${action}d.`, status: result.status });
    } catch (err) {
      next(err);
    }
  }
);

// 5. Replay a failed/dead-lettered webhook from its persisted delivery payload.
router.post('/webhooks/:id/retry', param('id').isUUID(), async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const deliveryRes = await query(
      `SELECT id, transaction_id, merchant_id, event_type, payload, status
       FROM webhook_deliveries
       WHERE id = $1 AND status IN ('failed', 'dead_lettered')`,
      [req.params.id]
    );
    if (!deliveryRes.rows.length) return res.status(404).json({ error: 'Failed webhook delivery not found' });

    const delivery = deliveryRes.rows[0];
    const persistedPayload = typeof delivery.payload === 'string' ? JSON.parse(delivery.payload) : delivery.payload;
    const jobId = await replayWebhook({
      transactionId: delivery.transaction_id,
      merchantId: delivery.merchant_id,
      eventType: delivery.event_type,
      payload: persistedPayload.data || persistedPayload,
      deliveryId: delivery.id,
    });
    res.status(202).json({ message: 'Webhook replay queued', jobId, replayedDeliveryId: delivery.id });
  } catch (err) {
    next(err);
  }
});

// 5. System Health Page
router.get('/health', async (req, res, next) => {
  try {
    const dbHealth = await query('SELECT 1').then(() => 'Healthy').catch(() => 'Unhealthy');
    const queueWaitingCount = await webhookQueue.getWaitingCount();
    const queueFailedCount = await webhookQueue.getFailedCount();

    res.json({
      database: dbHealth,
      webhookQueue: {
        waiting: queueWaitingCount,
        failed: queueFailedCount
      },
      status: dbHealth === 'Healthy' ? 'Operational' : 'Degraded'
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
