const fetch = require('node-fetch');
const logger = require('../utils/logger');

const ML_URL = process.env.ML_SERVICE_URL || 'http://localhost:5001';
const TIMEOUT_MS = parseInt(process.env.ML_TIMEOUT_MS) || 20;

/**
 * Calls the Python ML microservice for real-time fraud risk scoring.
 * Returns { score, flags, latency_ms } or a safe fallback on error/timeout.
 *
 * The payment processor ALWAYS proceeds — ML is advisory, never blocking.
 * Regulatory requirement: store score + flags in transaction for audit trail.
 */
const scoreFraudRisk = async (txnData) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const start = Date.now();
    const resp = await fetch(`${ML_URL}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: txnData.amount,
        merchant_id: txnData.merchantId,
        hour_of_day: new Date().getHours(),
        day_of_week: new Date().getDay(),
        currency: txnData.currency || 'INR',
        sender_txn_count_30d: txnData.senderTxnCount30d || 0,
        sender_avg_amount_30d: txnData.senderAvgAmount30d || 0,
      }),
      signal: controller.signal,
    });

    const latency = Date.now() - start;

    if (!resp.ok) throw new Error(`ML service responded ${resp.status}`);

    const data = await resp.json();
    logger.info('ML fraud score received', { score: data.score, latency_ms: latency });

    return {
      score: parseFloat(data.score.toFixed(3)),
      flags: data.flags || [],
      latency_ms: latency,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('ML service timeout — using fallback score 0.5', { timeout_ms: TIMEOUT_MS });
    } else {
      logger.warn('ML service error — using fallback score 0.5', { error: err.message });
    }
    // Safe fallback: neutral score, no flags — payment continues
    return { score: 0.5, flags: ['ml_unavailable'], latency_ms: TIMEOUT_MS };
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = { scoreFraudRisk };
