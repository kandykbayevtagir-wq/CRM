DROP INDEX IF EXISTS idx_financial_transactions_payment;
CREATE INDEX IF NOT EXISTS idx_financial_transactions_payment ON financial_transactions(payment_id, kind, occurred_at);
