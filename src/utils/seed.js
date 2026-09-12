require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool } = require('../config/database');

const ensureSettlementAccount = async (organizationId, openingBalance) => {
  const existing = await query(
    `SELECT id, balance, opening_balance FROM accounts
     WHERE merchant_id = $1 AND account_role = 'settlement'
     ORDER BY created_at LIMIT 1`,
    [organizationId]
  );
  if (existing.rows.length) {
    const account = existing.rows[0];
    if (parseFloat(account.opening_balance) === 0 && parseFloat(account.balance) !== 0) {
      await query('UPDATE accounts SET opening_balance = balance WHERE id = $1', [account.id]);
    }
    return account.id;
  }

  const created = await query(
    `INSERT INTO accounts (merchant_id, currency, balance, opening_balance, account_role)
     VALUES ($1, 'INR', $2, $2, 'settlement') RETURNING id`,
    [organizationId, openingBalance]
  );
  return created.rows[0].id;
};

const ensureBeneficiary = async (organizationId, name, beneficiaryType, email) => {
  const existing = await query(
    `SELECT id FROM beneficiaries WHERE organization_id = $1 AND name = $2`,
    [organizationId, name]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const account = await query(
    `INSERT INTO accounts (merchant_id, currency, balance, opening_balance, account_role)
     VALUES ($1, 'INR', 0, 0, 'beneficiary_wallet') RETURNING id`,
    [organizationId]
  );
  const beneficiary = await query(
    `INSERT INTO beneficiaries (organization_id, name, beneficiary_type, email, payout_account_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [organizationId, name, beneficiaryType, email, account.rows[0].id]
  );
  return beneficiary.rows[0].id;
};

const seed = async () => {
  console.log('🌱 Seeding PayFlow settlement demo...\n');

  const adminHash = await bcrypt.hash('admin123', 12);
  const adminRes = await query(
    `INSERT INTO merchants (name, email, password_hash, role)
     VALUES ($1,$2,$3,'admin')
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = 'admin'
     RETURNING id, email`,
    ['Admin', 'admin@payflow.com', adminHash]
  );

  const orgHash = await bcrypt.hash('demo1234', 12);
  const organizationRes = await query(
    `INSERT INTO merchants (name, email, password_hash)
     VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, email`,
    ['SwiftEats Operations', 'demo@acme.com', orgHash]
  );

  const adminAccount = await ensureSettlementAccount(adminRes.rows[0].id, 100000);
  const settlementAccount = await ensureSettlementAccount(organizationRes.rows[0].id, 500000);
  await Promise.all([
    ensureBeneficiary(organizationRes.rows[0].id, 'Rahul Kumar', 'rider', 'rahul.rider@example.test'),
    ensureBeneficiary(organizationRes.rows[0].id, 'Fresh Farms', 'vendor', 'finance@fresh-farms.example.test'),
    ensureBeneficiary(organizationRes.rows[0].id, 'ABC Wholesale', 'vendor', 'accounts@abc-wholesale.example.test'),
  ]);

  console.log('✓ admin@payflow.com / admin123  →  Admin review queue');
  console.log('✓ demo@acme.com / demo1234      →  SwiftEats settlement operations');
  console.log(`✓ Settlement account ${settlementAccount} funded with ₹500,000 demo balance`);
  console.log(`✓ Admin settlement account ${adminAccount} ready`);
  console.log('✓ Added rider and vendor beneficiaries for payout batches');

  await pool.end();
};

seed().catch((err) => { console.error('Seed failed:', err.message); process.exit(1); });
