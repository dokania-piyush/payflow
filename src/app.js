require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const paymentRoutes = require('./routes/payments');
const accountRoutes = require('./routes/accounts');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// Request logging
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.path === '/health',
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));

// Global rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 500,
  standardHeaders: true,
  message: { error: 'Too many requests — please try again later' },
}));

// Stricter rate limit for payment endpoint
app.use('/payments', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Payment rate limit exceeded (60/min)' },
}));

// Serve frontend dashboard
app.use(express.static(require('path').join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'payflow',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Routes
app.use('/auth', authRoutes);
app.use('/payments', paymentRoutes);
app.use('/accounts', accountRoutes);
app.use('/analytics', analyticsRoutes);
app.use('/admin', adminRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Central error handler
app.use(errorHandler);

const PORT = parseInt(process.env.PORT) || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`PayFlow API running on port ${PORT}`, { env: process.env.NODE_ENV });
  });
}

module.exports = app;
