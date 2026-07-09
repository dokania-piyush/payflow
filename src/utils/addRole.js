require('dotenv').config();
const { pool } = require('../config/database');
const logger = require('./logger');

const addRoleColumn = async () => {
  try {
    logger.info('Adding role column to merchants table...');
    await pool.query("ALTER TABLE merchants ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'merchant'");
    logger.info('Successfully added role column.');
  } catch (err) {
    logger.error('Failed to add role column', { error: err.message });
  } finally {
    await pool.end();
  }
};

addRoleColumn();
