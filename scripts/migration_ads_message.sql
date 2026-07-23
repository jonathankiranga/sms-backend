-- Add message column to marketplace_campaigns
ALTER TABLE marketplace_campaigns ADD COLUMN message TEXT AFTER merchant_name;
