const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (err.code === '23505') {
    return res.status(409).json({ error: 'Duplicate entry — resource already exists' });
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'Constraint violation: ' + err.detail });
  }

  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
};

module.exports = { errorHandler };
