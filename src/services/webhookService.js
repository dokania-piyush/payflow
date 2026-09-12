const { Queue } = require('bullmq');
const redis = require('../config/redis');
const logger = require('../utils/logger');

const webhookQueue = new Queue('webhooks', {
  connection: redis,
  defaultJobOptions: {
    attempts: parseInt(process.env.WEBHOOK_MAX_RETRIES) || 5,
    backoff: {
      type: 'exponential',
      delay: parseInt(process.env.WEBHOOK_BASE_DELAY_MS) || 1000,
      // Delays: 1s → 2s → 4s → 8s → 16s
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

const enqueueWebhook = async ({ transactionId, merchantId, eventType, payload }) => {
  try {
    const job = await webhookQueue.add(
      eventType,
      { transactionId, merchantId, eventType, payload, enqueuedAt: new Date().toISOString() },
      { jobId: `${transactionId}:${eventType}` }
    );
    logger.info('Webhook enqueued', { jobId: job.id, eventType, transactionId });
    return job.id;
  } catch (err) {
    // Webhook failure must not affect payment response
    logger.error('Failed to enqueue webhook — payment still successful', { error: err.message });
  }
};

const replayWebhook = async ({ transactionId, merchantId, eventType, payload, deliveryId }) => {
  const job = await webhookQueue.add(
    eventType,
    { transactionId, merchantId, eventType, payload, replayedFrom: deliveryId, enqueuedAt: new Date().toISOString() },
    { jobId: `replay:${deliveryId}:${Date.now()}` }
  );
  logger.info('Dead-letter webhook replay queued', { deliveryId, jobId: job.id, transactionId });
  return job.id;
};

module.exports = { enqueueWebhook, replayWebhook, webhookQueue };
