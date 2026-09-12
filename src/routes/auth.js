const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const router = express.Router();

// POST /auth/register
router.post('/register',
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be ≥8 characters'),
  body('webhook_url').optional().isURL(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { name, email, password, webhook_url } = req.body;

      const existing = await query('SELECT id FROM merchants WHERE email = $1', [email]);
      if (existing.rows.length) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 12);

      const merchantRes = await query(
        `INSERT INTO merchants (name, email, password_hash, role, webhook_url)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, webhook_url, created_at`,
        [name, email, passwordHash, 'merchant', webhook_url || null]
      );

      const merchant = merchantRes.rows[0];

      // Create the organization's funded settlement account for the demo.
      // opening_balance lets reconciliation distinguish starting funds from
      // movements recorded later in the ledger.
      await query(
        `INSERT INTO accounts (merchant_id, currency, balance, opening_balance, account_role)
         VALUES ($1, $2, $3, $3, 'settlement')`,
        [merchant.id, 'INR', 10000.00]
      );

      logger.info('Merchant registered', { merchantId: merchant.id });

      res.status(201).json({ message: 'Merchant registered', merchant });
    } catch (err) {
      next(err);
    }
  }
);

// POST /auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

      const { email, password } = req.body;

      const result = await query(
        'SELECT id, name, email, password_hash, role, is_active FROM merchants WHERE email = $1',
        [email]
      );

      if (!result.rows.length) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const merchant = result.rows[0];

      if (!merchant.is_active) {
        return res.status(403).json({ error: 'Account is deactivated' });
      }

      const valid = await bcrypt.compare(password, merchant.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { merchantId: merchant.id, email: merchant.email, role: merchant.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
      );

      logger.info('Merchant logged in', { merchantId: merchant.id });

      res.json({
        token,
        merchant: { id: merchant.id, name: merchant.name, email: merchant.email, role: merchant.role },
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
