-- Migration: add merchant contact to marketplace_campaigns
ALTER TABLE marketplace_campaigns
  ADD COLUMN merchant_phone VARCHAR(20) NULL AFTER merchant_name;

-- Optional: ensure end_date is set to start_date + INTERVAL 2 MONTH when creating campaigns (enforced in API).