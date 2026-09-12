-- PayFlow Database Schema
-- Run this file to initialise the database: psql -d payflow -f schema.sql

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Organizations (API clients). The historical table name is retained to avoid
-- breaking existing deployments; application screens call these organizations.
CREATE TABLE IF NOT EXISTS merchants (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20) DEFAULT 'merchant',
  webhook_url   VARCHAR(512),
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Accounts: an organization has a settlement account and virtual beneficiary wallets.
CREATE TABLE IF NOT EXISTS accounts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  currency    CHAR(3) NOT NULL DEFAULT 'INR',
  balance     NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  opening_balance NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  account_role VARCHAR(30) NOT NULL DEFAULT 'settlement'
               CHECK (account_role IN ('settlement', 'beneficiary_wallet', 'operating')),
  version     INTEGER NOT NULL DEFAULT 0,       -- optimistic lock version
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT balance_non_negative CHECK (balance >= 0)
);

-- Compatibility additions for databases created before settlement accounts existed.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(18, 2) NOT NULL DEFAULT 0.00;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_role VARCHAR(30) NOT NULL DEFAULT 'settlement';

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

-- A rider, vendor, or other partner that receives payouts. A beneficiary does
-- not need a login: its virtual wallet remains owned by the organization.
CREATE TABLE IF NOT EXISTS beneficiaries (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES merchants(id),
  name              VARCHAR(255) NOT NULL,
  beneficiary_type  VARCHAR(30) NOT NULL CHECK (beneficiary_type IN ('rider', 'vendor', 'partner')),
  email             VARCHAR(255),
  payout_account_id UUID NOT NULL UNIQUE REFERENCES accounts(id),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- A finance operator groups the payouts due for a settlement run.
CREATE TABLE IF NOT EXISTS payout_batches (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID NOT NULL REFERENCES merchants(id),
  source_account_id UUID NOT NULL REFERENCES accounts(id),
  status            VARCHAR(30) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'processing', 'completed', 'has_exceptions')),
  total_payouts     INTEGER NOT NULL DEFAULT 0,
  total_amount      NUMERIC(18, 2) NOT NULL DEFAULT 0.00,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- A payout item links the operational settlement view to its underlying ledger transaction.
CREATE TABLE IF NOT EXISTS payouts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id          UUID NOT NULL REFERENCES payout_batches(id),
  organization_id   UUID NOT NULL REFERENCES merchants(id),
  beneficiary_id    UUID NOT NULL REFERENCES beneficiaries(id),
  transaction_id    UUID UNIQUE REFERENCES transactions(id),
  payout_reference  VARCHAR(100) UNIQUE NOT NULL,
  amount            NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  currency          CHAR(3) NOT NULL DEFAULT 'INR',
  description       VARCHAR(512),
  status            VARCHAR(30) NOT NULL DEFAULT 'ready'
                    CHECK (status IN ('ready', 'processing', 'completed', 'held_for_review', 'failed')),
  risk_score        NUMERIC(4, 3),
  risk_flags        JSONB DEFAULT '[]',
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

-- Migrate pre-settlement demo accounts. Older versions stored funded balances
-- without recording an opening position. Derive that position once so ledger
-- reconciliation starts from the correct balance rather than reporting a false
-- discrepancy for every existing account.
UPDATE accounts a
SET opening_balance = a.balance - COALESCE((
  SELECT SUM(CASE WHEN le.entry_type = 'credit' THEN le.amount ELSE -le.amount END)
  FROM ledger_entries le
  WHERE le.account_id = a.id
), 0)
WHERE a.opening_balance = 0;

-- Webhook deliveries (audit trail for async events)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  merchant_id    UUID NOT NULL REFERENCES merchants(id),
  event_type     VARCHAR(50) NOT NULL,
  job_id         VARCHAR(255),
  payload        JSONB NOT NULL,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'delivered', 'failed', 'dead_lettered')),
  attempts       INTEGER DEFAULT 0,
  last_response  JSONB,
  next_retry_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS job_id VARCHAR(255);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_job_id     ON webhook_deliveries(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_beneficiaries_organization ON beneficiaries(organization_id);
CREATE INDEX IF NOT EXISTS idx_payout_batches_organization ON payout_batches(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payouts_batch              ON payouts(batch_id);
CREATE INDEX IF NOT EXISTS idx_payouts_organization_status ON payouts(organization_id, status);

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
CREATE OR REPLACE TRIGGER trg_beneficiaries_updated_at
  BEFORE UPDATE ON beneficiaries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_payout_batches_updated_at
  BEFORE UPDATE ON payout_batches FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_payouts_updated_at
  BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
