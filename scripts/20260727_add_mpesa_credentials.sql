-- Add M-Pesa columns to schools (with existence checks for MySQL compat)
SET @db = (SELECT DATABASE());

-- schools columns
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'mpesa_consumer_key');
SET @sql = IF(@exists = 0, 'ALTER TABLE schools ADD COLUMN mpesa_consumer_key VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'mpesa_consumer_secret');
SET @sql = IF(@exists = 0, 'ALTER TABLE schools ADD COLUMN mpesa_consumer_secret VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'mpesa_paybill');
SET @sql = IF(@exists = 0, 'ALTER TABLE schools ADD COLUMN mpesa_paybill VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'mpesa_passkey');
SET @sql = IF(@exists = 0, 'ALTER TABLE schools ADD COLUMN mpesa_passkey VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'mpesa_environment');
SET @sql = IF(@exists = 0, 'ALTER TABLE schools ADD COLUMN mpesa_environment VARCHAR(20) DEFAULT ''sandbox''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- payment_ledger columns
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_ledger' AND COLUMN_NAME = 'school_id');
SET @sql = IF(@exists = 0, 'ALTER TABLE payment_ledger ADD COLUMN school_id CHAR(9) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_ledger' AND COLUMN_NAME = 'term');
SET @sql = IF(@exists = 0, 'ALTER TABLE payment_ledger ADD COLUMN term VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_ledger' AND COLUMN_NAME = 'academic_year');
SET @sql = IF(@exists = 0, 'ALTER TABLE payment_ledger ADD COLUMN academic_year YEAR NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_ledger' AND COLUMN_NAME = 'recorded_by');
SET @sql = IF(@exists = 0, 'ALTER TABLE payment_ledger ADD COLUMN recorded_by VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_ledger' AND COLUMN_NAME = 'notes');
SET @sql = IF(@exists = 0, 'ALTER TABLE payment_ledger ADD COLUMN notes TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_ledger' AND COLUMN_NAME = 'reversed_at');
SET @sql = IF(@exists = 0, 'ALTER TABLE payment_ledger ADD COLUMN reversed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'payment_ledger' AND COLUMN_NAME = 'reversed_by');
SET @sql = IF(@exists = 0, 'ALTER TABLE payment_ledger ADD COLUMN reversed_by VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
