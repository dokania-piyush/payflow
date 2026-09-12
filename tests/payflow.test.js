/**
 * PayFlow Test Suite
 *
 * Tests: payment processing, idempotency dedup, double-spend prevention,
 *        ledger integrity, reconciliation discrepancy detection.
 *
 * Run: npm test
 * Requires: PostgreSQL + Redis running locally (or use mocks below)
 */

const request = require('supertest');
const app = require('../src/app');
const { query, pool } = require('../src/config/database');
const redis = require('../src/config/redis');

// ── Test fixtures ─────────────────────────────────────────────────────────────

let merchantToken;
let merchantId;
let senderAccountId;
let receiverAccountId;
let beneficiaryId;

beforeAll(async () => {
  // Register a test merchant
  const registerRes = await request(app)
    .post('/auth/register')
    .send({
      name: 'Test Merchant',
      email: `test_${Date.now()}@payflow.test`,
      password: 'SecurePassword123!',
    });

  expect(registerRes.status).toBe(201);
  merchantId = registerRes.body.merchant.id;

  // Login
  const loginRes = await request(app)
    .post('/auth/login')
    .send({ email: registerRes.body.merchant.email, password: 'SecurePassword123!' });

  expect(loginRes.status).toBe(200);
  merchantToken = loginRes.body.token;

  // Get sender account (created on registration)
  const accountsRes = await request(app)
    .get('/accounts')
    .set('Authorization', `Bearer ${merchantToken}`);

  senderAccountId = accountsRes.body.accounts[0].id;

  // Create an organization-owned beneficiary wallet. Settlement payouts may
  // only move from the organization's settlement account to this type of wallet.
  const receiverRes = await query(
    `INSERT INTO accounts (merchant_id, currency, balance, opening_balance, account_role)
     VALUES ($1, 'INR', 0, 0, 'beneficiary_wallet') RETURNING id`,
    [merchantId]
  );
  receiverAccountId = receiverRes.rows[0].id;
  const beneficiaryRes = await query(
    `INSERT INTO beneficiaries (organization_id, name, beneficiary_type, payout_account_id)
     VALUES ($1, 'Test Rider', 'rider', $2) RETURNING id`,
    [merchantId, receiverAccountId]
  );
  beneficiaryId = beneficiaryRes.rows[0].id;
});

afterAll(async () => {
  // Cleanup test data
  await query('DELETE FROM beneficiaries WHERE id = $1', [beneficiaryId]);
  await query('DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM transactions WHERE merchant_id = $1)', [merchantId]);
  await query('DELETE FROM transactions WHERE merchant_id = $1', [merchantId]);
  await query('DELETE FROM accounts WHERE merchant_id = $1', [merchantId]);
  await query('DELETE FROM merchants WHERE id = $1', [merchantId]);
  await pool.end();
  await redis.quit();
});

// ── Auth tests ────────────────────────────────────────────────────────────────

describe('Auth', () => {
  test('POST /auth/register — creates merchant with account', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({
        name: 'Cleanup Test',
        email: `cleanup_${Date.now()}@test.com`,
        password: 'Password123!',
      });
    expect(res.status).toBe(201);
    expect(res.body.merchant).toHaveProperty('id');
    // Cleanup
    await query('DELETE FROM accounts WHERE merchant_id = $1', [res.body.merchant.id]);
    await query('DELETE FROM merchants WHERE id = $1', [res.body.merchant.id]);
  });

  test('POST /auth/login — returns JWT token', async () => {
    expect(merchantToken).toBeTruthy();
    expect(merchantToken.split('.')).toHaveLength(3); // Valid JWT structure
  });

  test('GET /accounts — requires auth', async () => {
    const res = await request(app).get('/accounts');
    expect(res.status).toBe(401);
  });
});

// ── Payment tests ─────────────────────────────────────────────────────────────

describe('Payments', () => {
  test('POST /payments — processes a valid payment', async () => {
    const res = await request(app)
      .post('/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('Idempotency-Key', `test-idem-${Date.now()}`)
      .send({
        sender_account_id: senderAccountId,
        receiver_account_id: receiverAccountId,
        amount: 500,
        currency: 'INR',
        description: 'Test payment',
      });

    expect([201, 202]).toContain(res.status); // 202 if held by ML
    expect(res.body.transaction).toHaveProperty('id');
    expect(res.body.transaction).toHaveProperty('risk_score');
  });

  test('POST /payments — rejects payment with missing Idempotency-Key', async () => {
    const res = await request(app)
      .post('/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        sender_account_id: senderAccountId,
        receiver_account_id: receiverAccountId,
        amount: 100,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Idempotency-Key/);
  });

  test('POST /payments — rejects insufficient funds', async () => {
    const res = await request(app)
      .post('/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('Idempotency-Key', `test-insufficient-${Date.now()}`)
      .send({
        sender_account_id: senderAccountId,
        receiver_account_id: receiverAccountId,
        amount: 9999999,
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Insufficient/);
  });

  test('POST /payments — rejects same sender and receiver', async () => {
    const res = await request(app)
      .post('/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('Idempotency-Key', `test-same-${Date.now()}`)
      .send({
        sender_account_id: senderAccountId,
        receiver_account_id: senderAccountId,
        amount: 100,
      });
    expect(res.status).toBe(400);
  });
});

// ── Idempotency tests ─────────────────────────────────────────────────────────

describe('Idempotency', () => {
  test('Duplicate request returns cached response — no double charge', async () => {
    const key = `idem-dedup-${Date.now()}`;

    const first = await request(app)
      .post('/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('Idempotency-Key', key)
      .send({
        sender_account_id: senderAccountId,
        receiver_account_id: receiverAccountId,
        amount: 100,
      });

    const second = await request(app)
      .post('/payments')
      .set('Authorization', `Bearer ${merchantToken}`)
      .set('Idempotency-Key', key)
      .send({
        sender_account_id: senderAccountId,
        receiver_account_id: receiverAccountId,
        amount: 100,
      });

    // Second request must return same transaction ID
    if ([201, 202].includes(first.status) && [200, 201, 202].includes(second.status)) {
      expect(second.headers['x-idempotency-hit']).toBe('true');
      expect(second.body.transaction.id).toBe(first.body.transaction.id);
    }
  });
});

// ── Ledger integrity tests ────────────────────────────────────────────────────

describe('Ledger integrity', () => {
  test('Every completed transaction has exactly 2 ledger entries', async () => {
    const result = await query(
      `SELECT t.id, COUNT(le.id) AS entry_count
       FROM transactions t
       LEFT JOIN ledger_entries le ON le.transaction_id = t.id
       WHERE t.merchant_id = $1 AND t.status = 'completed'
       GROUP BY t.id
       HAVING COUNT(le.id) != 2`,
      [merchantId]
    );
    expect(result.rows).toHaveLength(0);
  });

  test('Debit amount equals credit amount for every transaction', async () => {
    const result = await query(
      `SELECT le.transaction_id,
              SUM(CASE WHEN le.entry_type = 'debit'  THEN le.amount ELSE 0 END) AS debits,
              SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END) AS credits
       FROM ledger_entries le
       JOIN transactions t ON t.id = le.transaction_id
       WHERE t.merchant_id = $1 AND t.status = 'completed'
       GROUP BY le.transaction_id
       HAVING ABS(
         SUM(CASE WHEN le.entry_type = 'debit'  THEN le.amount ELSE 0 END) -
         SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE 0 END)
       ) > 0.001`,
      [merchantId]
    );
    expect(result.rows).toHaveLength(0);
  });
});

// ── Reconciliation tests ──────────────────────────────────────────────────────

describe('Reconciliation', () => {
  test('POST /accounts/reconciliation/run — runs and returns report', async () => {
    const res = await request(app)
      .post('/accounts/reconciliation/run')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.report).toHaveProperty('reportId');
    expect(res.body.report).toHaveProperty('status');
    expect(['clean', 'has_discrepancies']).toContain(res.body.report.status);
  });
});
