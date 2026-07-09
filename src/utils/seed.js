require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool } = require('../config/database');

const seed = async () => {
  console.log('🌱 Seeding PayFlow...\n');

  const adminHash = await bcrypt.hash('admin123', 12);
  const adminRes = await query(
    `INSERT INTO merchants (name, email, password_hash, role)
     VALUES ($1,$2,$3,'admin')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = 'admin'
     RETURNING id, email`,
    ['Admin', 'admin@payflow.com', adminHash]
  );
  const admin = adminRes.rows[0];

  const demoHash = await bcrypt.hash('demo1234', 12);
  const demoRes = await query(
    `INSERT INTO merchants (name, email, password_hash)
     VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, email`,
    ['Acme Corp', 'demo@acme.com', demoHash]
  );
  const demo = demoRes.rows[0];

  await query(
    `INSERT INTO accounts (merchant_id, currency, balance)
     VALUES ($1,'INR',100000)
     ON CONFLICT DO NOTHING`,
    [admin.id]
  );
  await query(
    `INSERT INTO accounts (merchant_id, currency, balance)
     VALUES ($1,'INR',50000)
     ON CONFLICT DO NOTHING`,
    [admin.id]
  );
  await query(
    `INSERT INTO accounts (merchant_id, currency, balance)
     VALUES ($1,'INR',25000)
     ON CONFLICT DO NOTHING`,
    [demo.id]
  );

  console.log('✓ admin@payflow.com / admin123  →  ₹1,00,000 + ₹50,000');
  console.log('✓ demo@acme.com / demo1234      →  ₹25,000');
  console.log('\nOpen http://localhost:3000 and log in!');

  await pool.end();
};

seed().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });