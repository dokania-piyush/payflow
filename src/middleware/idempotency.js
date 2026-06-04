const redis = require('../config/redis');
const logger = require('../utils/logger');

const TTL = parseInt(process.env.IDEMPOTENCY_TTL_SECONDS) || 86400;

/**
 * Idempotency middleware for mutating endpoints.
 *
 * Flow:
 *  1. Require Idempotency-Key header
 *  2. Check Redis for an existing result keyed by merchant_id:idem_key
 *  3. If found → return cached response immediately (no DB hit)
 *  4. If not found → attach storeIdempotencyResult() to res so the route
 *     can store the response after a successful commit
 */
const idempotency = async (req, res, next) => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'Idempotency-Key header is required for this endpoint',
    });
  }

  if (idempotencyKey.length > 255) {
    return res.status(400).json({ error: 'Idempotency-Key must be ≤255 characters' });
  }

  // Namespace by merchant so different merchants can reuse the same key
  const redisKey = `idem:${req.merchant.id}:${idempotencyKey}`;

  try {
    const cached = await redis.get(redisKey);

    if (cached) {
      const parsed = JSON.parse(cached);
      logger.info('Idempotency cache hit — returning cached response', { redisKey });
      return res
        .status(parsed.statusCode)
        .set('X-Idempotency-Hit', 'true')
        .json(parsed.body);
    }

    // Attach helper so route handlers can persist the result
    res.storeIdempotencyResult = async (statusCode, body) => {
      await redis.set(
        redisKey,
        JSON.stringify({ statusCode, body }),
        'EX',
        TTL
      );
    };

    next();
  } catch (err) {
    // Redis failure must not block payments — log and continue
    logger.error('Idempotency Redis error — proceeding without cache', { error: err.message });
    res.storeIdempotencyResult = async () => {}; // no-op fallback
    next();
  }
};

module.exports = { idempotency };
