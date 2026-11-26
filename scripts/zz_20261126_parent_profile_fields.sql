-- Add columns already consumed by the parent portal and subscription services.
-- TiDB supports ADD COLUMN IF NOT EXISTS; this is safe when fields already exist.
ALTER TABLE parent_profiles
  ADD COLUMN IF NOT EXISTS email VARCHAR(120) NULL;

ALTER TABLE parent_profiles
  ADD COLUMN IF NOT EXISTS prepaid_balance DECIMAL(10,2) NOT NULL DEFAULT 0.00;
