const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'payflow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: parseInt(process.env.DB_POOL_MAX) || 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error('Unexpected DB pool error', { error: err.message });
});

// Run a query with automatic connection management
const query = async (text, params) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  logger.debug('Query executed', { text: text.slice(0, 80), duration, rows: res.rowCount });
  return res;
};

// Get a client for explicit transactions (BEGIN/COMMIT/ROLLBACK)
const getClient = () => pool.connect();

module.exports = { query, getClient, pool };
