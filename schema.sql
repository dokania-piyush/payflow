-- PayFlow Database Schema
-- Run this file to initialise the database: psql -d payflow -f schema.sql

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Merchants (API clients)
CREATE TABLE IF NOT EXISTS merchants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  webhook_url   VARCHAR(512),
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Accounts (each merchant has a float account)
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  currency    CHAR(3) NOT NULL DEFAULT 'INR',
  balance     NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  version     INTEGER NOT NULL DEFAULT 0,       -- optimistic lock version
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT balance_non_negative CHECK (balance >= 0)
);

-- Transactions (the heart of the system)
CREATE TABLE IF NOT EXISTS transactions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idempotency_key   VARCHAR(255) UNIQUE NOT NULL,
  merchant_id       UUID NOT NULL REFERENCES merchants(id),
  sender_account_id UUID NOT NULL REFERENCES accounts(id),
  receiver_account_id UUID NOT NULL REFERENCES accounts(id),
  amount            NUMERIC(18, 2) NOT NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'INR',
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'reversed')),
  description       VARCHAR(512),
  metadata          JSONB DEFAULT '{}',
  risk_score        NUMERIC(4, 3),              -- 0.000 to 1.000 from ML service
  risk_flags        JSONB DEFAULT '[]',          -- ML-flagged reasons
  failure_reason    VARCHAR(255),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Ledger (double-entry bookkeeping)
-- Every transaction creates EXACTLY two ledger entries: one debit, one credit
-- Sum of all amounts in ledger must always equal 0
CREATE TABLE IF NOT EXISTS ledger_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  account_id     UUID NOT NULL REFERENCES accounts(id),
  entry_type     VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount         NUMERIC(18, 2) NOT NULL,        -- always positive
  running_balance NUMERIC(18, 2) NOT NULL,       -- account balance after this entry
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Webhook deliveries (audit trail for async events)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  merchant_id    UUID NOT NULL REFERENCES merchants(id),
  event_type     VARCHAR(50) NOT NULL,
  payload        JSONB NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'delivered', 'failed', 'dead_lettered')),
  attempts       INTEGER DEFAULT 0,
  last_response  JSONB,
  next_retry_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Reconciliation reports
CREATE TABLE IF NOT EXISTS reconciliation_reports (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  total_txns      INTEGER NOT NULL,
  matched         INTEGER NOT NULL,
  mismatches      INTEGER NOT NULL,
  discrepancy_amt NUMERIC(18, 2) NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'clean'
                  CHECK (status IN ('clean', 'has_discrepancies')),
  details         JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Audit discrepancies (populated by reconciliation engine)
CREATE TABLE IF NOT EXISTS audit_discrepancies (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id      UUID REFERENCES reconciliation_reports(id),
  transaction_id UUID REFERENCES transactions(id),
  discrepancy_type VARCHAR(50) NOT NULL,
  expected_amount  NUMERIC(18, 2),
  actual_amount    NUMERIC(18, 2),
  description    TEXT,
  resolved       BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_merchant    ON transactions(merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status      ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at  ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_account           ON ledger_entries(account_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction       ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_webhook_status           ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_next_retry       ON webhook_deliveries(next_retry_at);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_merchants_updated_at
  BEFORE UPDATE ON merchants FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
