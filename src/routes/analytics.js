const express = require('express');
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');

const router = express.Router();

// Get merchant dashboard analytics
router.get('/merchant', authenticate, async (req, res, next) => {
  try {
    const merchantId = req.merchant.id;

    // 1. Total Revenue (sum of all completed received payments)
    const revenueRes = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total_revenue 
       FROM transactions 
       WHERE receiver_account_id IN (SELECT id FROM accounts WHERE merchant_id = $1)
       AND status = 'completed'`,
      [merchantId]
    );

    // 2. Transactions Today
    const todayRes = await query(
      `SELECT COUNT(*) AS txns_today 
       FROM transactions 
       WHERE merchant_id = $1 
       AND created_at >= current_date`,
      [merchantId]
    );

    // 3. Success vs Failure & Fraud (last 30 days)
    const statsRes = await query(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'completed') as success_count,
         COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
         COUNT(*) FILTER (WHERE risk_score > 0.85) as fraud_alerts
       FROM transactions 
       WHERE merchant_id = $1 
       AND created_at >= NOW() - INTERVAL '30 days'`,
      [merchantId]
    );

    // 4. Daily Chart Data (last 7 days)
    const chartRes = await query(
      `SELECT 
         DATE(created_at) as date, 
         COUNT(*) as count, 
         COALESCE(SUM(amount), 0) as volume 
       FROM transactions 
       WHERE merchant_id = $1 
       AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      [merchantId]
    );

    // 5. Recent Transactions (last 5)
    const recentRes = await query(
      `SELECT id, amount, status, risk_score, created_at 
       FROM transactions 
       WHERE merchant_id = $1 
       ORDER BY created_at DESC 
       LIMIT 5`,
      [merchantId]
    );

    res.json({
      metrics: {
        totalRevenue: parseFloat(revenueRes.rows[0].total_revenue),
        transactionsToday: parseInt(todayRes.rows[0].txns_today),
        successCount: parseInt(statsRes.rows[0].success_count),
        failedCount: parseInt(statsRes.rows[0].failed_count),
        fraudAlerts: parseInt(statsRes.rows[0].fraud_alerts),
        // Mock average latency for demo purposes
        avgLatencyMs: Math.floor(Math.random() * 50) + 120,
      },
      chartData: chartRes.rows,
      recentTransactions: recentRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// Get random accounts for simulator (excluding self)
router.get('/simulator/targets', authenticate, async (req, res, next) => {
  try {
    const targetsRes = await query(
      `SELECT a.id, m.name 
       FROM accounts a 
       JOIN merchants m ON a.merchant_id = m.id 
       WHERE m.id != $1 
       LIMIT 5`,
      [req.merchant.id]
    );
    res.json(targetsRes.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
