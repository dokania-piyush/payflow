require('dotenv').config();
const { Worker } = require('bullmq');
const fetch = require('node-fetch');
const { query } = require('../config/database');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const worker = new Worker(
  'webhooks',
  async (job) => {
    const { transactionId, merchantId, eventType, payload } = job.data;

    // Get merchant webhook URL
    const merchantRes = await query(
      'SELECT webhook_url FROM merchants WHERE id = $1',
      [merchantId]
    );

    if (!merchantRes.rows.length || !merchantRes.rows[0].webhook_url) {
      logger.warn('No webhook URL configured for merchant — skipping', { merchantId });
      return { skipped: true };
    }

    const { webhook_url } = merchantRes.rows[0];

    const webhookPayload = {
      event: eventType,
      data: payload,
      timestamp: new Date().toISOString(),
      attempt: job.attemptsMade + 1,
    };

    // Record attempt
    await query(
      `INSERT INTO webhook_deliveries
         (transaction_id, merchant_id, event_type, job_id, payload, status, attempts)
       VALUES ($1,$2,$3,$4,$5,'pending',$6)
       ON CONFLICT DO NOTHING`,
      [transactionId, merchantId, eventType, String(job.id), JSON.stringify(webhookPayload), job.attemptsMade + 1]
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await fetch(webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-PayFlow-Event': eventType,
          'X-PayFlow-Delivery': job.id,
        },
        body: JSON.stringify(webhookPayload),
        signal: controller.signal,
      });

      const lastResponse = {
        status: response.status,
        ok: response.ok,
        body: await response.text().catch(() => ''),
      };

      await query(
        `UPDATE webhook_deliveries
         SET status = $1, last_response = $2, updated_at = NOW()
         WHERE job_id = $3`,
        [response.ok ? 'delivered' : 'failed', JSON.stringify(lastResponse), String(job.id)]
      );

      if (!response.ok) {
        throw new Error(`Merchant webhook returned ${response.status}`);
      }

      logger.info('Webhook delivered', { transactionId, eventType, status: response.status });
      return lastResponse;
    } finally {
      clearTimeout(timeout);
    }
  },
  {
    connection: redis,
    concurrency: 10,
  }
);

worker.on('failed', async (job, err) => {
  logger.warn('Webhook delivery failed', {
    jobId: job.id,
    attempt: job.attemptsMade,
    maxAttempts: job.opts.attempts,
    error: err.message,
  });

  // Move to dead-letter queue if max retries exhausted
  if (job.attemptsMade >= job.opts.attempts) {
    logger.error('Webhook dead-lettered — max retries exhausted', { jobId: job.id });
    await query(
      `UPDATE webhook_deliveries SET status = 'dead_lettered', updated_at = NOW()
       WHERE job_id = $1`,
      [String(job.id)]
    ).catch(() => {});
  }
});

worker.on('completed', (job) => {
  logger.debug('Webhook job completed', { jobId: job.id });
});

logger.info('Webhook worker started');

module.exports = worker;
