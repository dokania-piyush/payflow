require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const logger = require('./logger');

const setupDatabase = async () => {
  if (!process.env.DATABASE_URL) {
    logger.error('DATABASE_URL is not set in the environment variables.');
    process.exit(1);
  }

  logger.info('Connecting to the database to run schema setup...');
  
  try {
    const schemaPath = path.join(__dirname, '../../schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    logger.info('Executing schema.sql...');
    await pool.query(schemaSql);
    
    logger.info('Schema executed successfully!');
  } catch (err) {
    logger.error('Failed to setup database schema', { error: err.message });
  } finally {
    await pool.end();
  }
};

setupDatabase();
