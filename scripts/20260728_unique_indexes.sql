ALTER TABLE payment_ledger ADD UNIQUE INDEX IF NOT EXISTS uq_transaction_reference (transaction_reference);
