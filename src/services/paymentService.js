const { getClient } = require('../config/database');
const { scoreFraudRisk } = require('./fraudService');
const { enqueueWebhook } = require('./webhookService');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * processPayment — the core of PayFlow.
 *
 * Guarantees:
 *  1. Exactly-once execution (idempotency handled upstream by middleware)
 *  2. Atomicity — debit + credit + ledger entries in one ACID transaction
 *  3. Double-spend prevention — SELECT FOR UPDATE locks the sender row
 *  4. Double-entry bookkeeping — every payment = one debit + one credit entry
 *  5. ML risk scoring — advisory score attached to transaction record
 */
const processPayment = async ({ idempotencyKey, merchantId, senderAccountId, receiverAccountId, amount, currency, description, metadata }) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // ── Step 1: Lock sender account row (prevents concurrent double-spend) ──
    const senderRes = await client.query(
      'SELECT id, balance, version FROM accounts WHERE id = $1 FOR UPDATE',
      [senderAccountId]
    );

    if (!senderRes.rows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Sender account not found', statusCode: 404 };
    }

    const sender = senderRes.rows[0];

    // ── Step 2: Verify receiver account exists ──
    const receiverRes = await client.query(
      'SELECT id, balance, version FROM accounts WHERE id = $1 FOR UPDATE',
      [receiverAccountId]
    );

    if (!receiverRes.rows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Receiver account not found', statusCode: 404 };
    }

    const receiver = receiverRes.rows[0];

    // ── Step 3: Sufficient funds check ──
    if (parseFloat(sender.balance) < parseFloat(amount)) {
      await client.query('ROLLBACK');
      return {
        success: false,
        error: 'Insufficient funds',
        statusCode: 422,
        details: { available: sender.balance, requested: amount },
      };
    }

    // ── Step 4: Get 30-day stats for ML scoring (non-blocking) ──
    const statsRes = await client.query(
      `SELECT COUNT(*)::int AS count, COALESCE(AVG(amount), 0)::numeric AS avg_amount
       FROM transactions
       WHERE sender_account_id = $1
         AND created_at > NOW() - INTERVAL '30 days'
         AND status = 'completed'`,
      [senderAccountId]
    );

    const { count: senderTxnCount30d, avg_amount: senderAvgAmount30d } = statsRes.rows[0];

    // ── Step 5: ML fraud scoring (advisory — never blocks payment) ──
    const { score: riskScore, flags: riskFlags } = await scoreFraudRisk({
      amount,
      merchantId,
      currency,
      senderTxnCount30d,
      senderAvgAmount30d,
    });

    // High risk (>0.85) gets flagged but NOT auto-blocked — human review queue
    const status = riskScore > 0.85 ? 'pending' : 'processing';

    // ── Step 6: Create transaction record ──
    const txnId = uuidv4();
    const txnRes = await client.query(
      `INSERT INTO transactions
         (id, idempotency_key, merchant_id, sender_account_id, receiver_account_id,
          amount, currency, status, description, metadata, risk_score, risk_flags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [txnId, idempotencyKey, merchantId, senderAccountId, receiverAccountId,
       amount, currency, status, description, JSON.stringify(metadata || {}),
       riskScore, JSON.stringify(riskFlags)]
    );

    const transaction = txnRes.rows[0];

    if (status === 'pending') {
      // High-risk: hold without debiting — return for review
      await client.query('COMMIT');
      logger.warn('Transaction held for review — high ML risk score', { txnId, riskScore });
      return { success: true, transaction, held: true };
    }

    // ── Step 7: Debit sender ──
    const newSenderBalance = parseFloat(sender.balance) - parseFloat(amount);
    await client.query(
      `UPDATE accounts SET balance = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2 AND version = $3`,
      [newSenderBalance, senderAccountId, sender.version]
    );

    // ── Step 8: Credit receiver ──
    const newReceiverBalance = parseFloat(receiver.balance) + parseFloat(amount);
    await client.query(
      `UPDATE accounts SET balance = $1, version = version + 1, updated_at = NOW()
       WHERE id = $2 AND version = $3`,
      [newReceiverBalance, receiverAccountId, receiver.version]
    );

    // ── Step 9: Double-entry ledger entries ──
    // Debit entry (sender loses money)
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, running_balance)
       VALUES ($1, $2, 'debit', $3, $4)`,
      [txnId, senderAccountId, amount, newSenderBalance]
    );

    // Credit entry (receiver gains money)
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, running_balance)
       VALUES ($1, $2, 'credit', $3, $4)`,
      [txnId, receiverAccountId, amount, newReceiverBalance]
    );

    // ── Step 10: Update transaction status to completed ──
    await client.query(
      `UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [txnId]
    );

    transaction.status = 'completed';

    await client.query('COMMIT');
    logger.info('Payment committed successfully', { txnId, amount, riskScore });

    // ── Step 11: Enqueue async webhook notification (outside DB transaction) ──
    await enqueueWebhook({
      transactionId: txnId,
      merchantId,
      eventType: 'payment.completed',
      payload: { transactionId: txnId, amount, currency, status: 'completed', riskScore },
    });

    return { success: true, transaction };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Payment processing failed — rolled back', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
};

/**
 * reverseTransaction — reverses a completed payment (refund).
 * Creates two new ledger entries (opposite direction) and marks original as 'reversed'.
 */
const reverseTransaction = async ({ transactionId, merchantId, reason }) => {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const txnRes = await client.query(
      'SELECT * FROM transactions WHERE id = $1 AND merchant_id = $2 FOR UPDATE',
      [transactionId, merchantId]
    );

    if (!txnRes.rows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Transaction not found', statusCode: 404 };
    }

    const txn = txnRes.rows[0];

    if (txn.status !== 'completed') {
      await client.query('ROLLBACK');
      return { success: false, error: `Cannot reverse a ${txn.status} transaction`, statusCode: 400 };
    }

    // Lock both accounts
    const [senderRes, receiverRes] = await Promise.all([
      client.query('SELECT id, balance, version FROM accounts WHERE id = $1 FOR UPDATE', [txn.sender_account_id]),
      client.query('SELECT id, balance, version FROM accounts WHERE id = $1 FOR UPDATE', [txn.receiver_account_id]),
    ]);

    const sender = senderRes.rows[0];
    const receiver = receiverRes.rows[0];

    if (parseFloat(receiver.balance) < parseFloat(txn.amount)) {
      await client.query('ROLLBACK');
      return { success: false, error: 'Receiver has insufficient funds for reversal', statusCode: 422 };
    }

    // Reverse: debit receiver, credit sender
    const newReceiverBalance = parseFloat(receiver.balance) - parseFloat(txn.amount);
    const newSenderBalance = parseFloat(sender.balance) + parseFloat(txn.amount);

    await client.query(
      'UPDATE accounts SET balance = $1, version = version + 1 WHERE id = $2',
      [newReceiverBalance, txn.receiver_account_id]
    );
    await client.query(
      'UPDATE accounts SET balance = $1, version = version + 1 WHERE id = $2',
      [newSenderBalance, txn.sender_account_id]
    );

    const reversalId = uuidv4();
    await client.query(
      `INSERT INTO transactions
         (id, idempotency_key, merchant_id, sender_account_id, receiver_account_id,
          amount, currency, status, description, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',$8,$9)`,
      [reversalId, `reversal:${transactionId}`, merchantId,
       txn.receiver_account_id, txn.sender_account_id,
       txn.amount, txn.currency, `Reversal: ${reason}`,
       JSON.stringify({ original_transaction_id: transactionId })]
    );

    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, running_balance)
       VALUES ($1,$2,'debit',$3,$4), ($1,$5,'credit',$3,$6)`,
      [reversalId, txn.receiver_account_id, txn.amount, newReceiverBalance,
       txn.sender_account_id, newSenderBalance]
    );

    await client.query(
      `UPDATE transactions SET status = 'reversed', updated_at = NOW() WHERE id = $1`,
      [transactionId]
    );

    await client.query('COMMIT');

    await enqueueWebhook({
      transactionId,
      merchantId,
      eventType: 'payment.reversed',
      payload: { originalTransactionId: transactionId, reversalId, amount: txn.amount },
    });

    return { success: true, reversalId };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Reversal failed — rolled back', { error: err.message });
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { processPayment, reverseTransaction };
