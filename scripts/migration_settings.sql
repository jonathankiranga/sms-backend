CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(50) PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES
  ('premium_price', '100'),
  ('merchant_7_day', '200'),
  ('merchant_14_day', '350'),
  ('merchant_30_day', '500'),
  ('merchant_90_day', '1200');
