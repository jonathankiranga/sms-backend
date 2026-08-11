SET @db = DATABASE();

SET @exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'schools'
    AND COLUMN_NAME = 'mpesa_callback_key'
);
SET @sql = IF(@exists = 0,
  'ALTER TABLE schools ADD COLUMN mpesa_callback_key VARCHAR(64) NULL AFTER mpesa_environment',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @exists = (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'schools'
    AND INDEX_NAME = 'uq_mpesa_callback_key'
);
SET @sql = IF(@exists = 0,
  'ALTER TABLE schools ADD UNIQUE INDEX uq_mpesa_callback_key (mpesa_callback_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
