-- Premium subscription per-term: school-pays vs parent-pays
-- Add settings columns to schools table
SET @db = (SELECT DATABASE());

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'premium_payment_model');
SET @sql = IF(@exists = 0, "ALTER TABLE schools ADD COLUMN premium_payment_model ENUM('school','parent') NOT NULL DEFAULT 'parent'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'premium_fee_per_term');
SET @sql = IF(@exists = 0, 'ALTER TABLE schools ADD COLUMN premium_fee_per_term DECIMAL(10,2) NULL DEFAULT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'premium_payment_model_locked');
SET @sql = IF(@exists = 0, "ALTER TABLE schools ADD COLUMN premium_payment_model_locked TINYINT(1) NOT NULL DEFAULT 0", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- School-level bulk premium payments (school pays for all students)
CREATE TABLE IF NOT EXISTS premium_bulk_payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  school_id CHAR(9) NOT NULL,
  term VARCHAR(10) NOT NULL,
  year YEAR NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  total_students INT NOT NULL DEFAULT 0,
  transaction_reference VARCHAR(50) NULL,
  payment_status ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  initiated_by_phone VARCHAR(20) NULL,
  paid_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-term premium subscriptions
CREATE TABLE IF NOT EXISTS premium_subscriptions (
  subscription_id INT AUTO_INCREMENT PRIMARY KEY,
  school_id CHAR(9) NOT NULL,
  parent_phone VARCHAR(20) NOT NULL,
  term VARCHAR(10) NOT NULL COMMENT 'Term 1, Term 2, or Term 3',
  year YEAR NOT NULL,
  payment_model ENUM('school','parent') NOT NULL DEFAULT 'parent',
  payment_status ENUM('paid','pending','free') NOT NULL DEFAULT 'pending',
  amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  activated_at DATETIME NULL,
  expires_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE,
  UNIQUE KEY uq_school_parent_term (school_id, parent_phone, term, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
