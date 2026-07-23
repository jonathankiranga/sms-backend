ALTER TABLE marketplace_campaigns ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP AFTER end_date;
ALTER TABLE marketplace_campaigns ADD COLUMN message TEXT AFTER merchant_name;
