-- Add checkout_request_id to premium_bulk_payments so payment-status polling
-- can resolve bazar bulk/selected STK pushes back to the parent portal.
ALTER TABLE premium_bulk_payments
  ADD COLUMN IF NOT EXISTS checkout_request_id VARCHAR(100) NULL AFTER transaction_reference;

CREATE INDEX IF NOT EXISTS idx_pbp_checkout ON premium_bulk_payments (checkout_request_id);
