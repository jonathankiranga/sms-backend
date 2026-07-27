-- School streams: pre-defined stream names per school
CREATE TABLE IF NOT EXISTS school_streams (
  stream_id INT AUTO_INCREMENT PRIMARY KEY,
  school_id CHAR(9) NOT NULL,
  stream_name VARCHAR(50) NOT NULL,
  display_order INT DEFAULT 0,
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE,
  UNIQUE KEY uq_school_stream (school_id, stream_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Student ID auto-generation sequence
CREATE TABLE IF NOT EXISTS student_id_sequences (
  school_id CHAR(9) PRIMARY KEY,
  next_id INT NOT NULL DEFAULT 1,
  prefix VARCHAR(10) NOT NULL DEFAULT 'STU',
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add columns to classes table
SET @db = (SELECT DATABASE());

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'classes' AND COLUMN_NAME = 'stream');
SET @sql = IF(@exists = 0, 'ALTER TABLE classes ADD COLUMN stream VARCHAR(50) NULL AFTER class_name', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'classes' AND COLUMN_NAME = 'level_name');
SET @sql = IF(@exists = 0, 'ALTER TABLE classes ADD COLUMN level_name VARCHAR(20) NULL AFTER stream', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add columns to students table
SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'date_of_birth');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN date_of_birth DATE NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'gender');
SET @sql = IF(@exists = 0, "ALTER TABLE students ADD COLUMN gender ENUM('Male','Female') NULL", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'admission_number');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN admission_number VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'admission_date');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN admission_date DATE NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'guardian_name');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN guardian_name VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'guardian_phone');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN guardian_phone VARCHAR(20) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'guardian_relationship');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN guardian_relationship VARCHAR(30) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'address');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN address VARCHAR(200) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'religion');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN religion VARCHAR(50) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'nationality');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN nationality VARCHAR(50) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'medical_notes');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN medical_notes TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'special_needs');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN special_needs TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'students' AND COLUMN_NAME = 'previous_school');
SET @sql = IF(@exists = 0, 'ALTER TABLE students ADD COLUMN previous_school VARCHAR(100) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seed default streams for existing schools
INSERT IGNORE INTO school_streams (school_id, stream_name, display_order)
SELECT school_id, 'East', 1 FROM schools;
INSERT IGNORE INTO school_streams (school_id, stream_name, display_order)
SELECT school_id, 'West', 2 FROM schools;
INSERT IGNORE INTO school_streams (school_id, stream_name, display_order)
SELECT school_id, 'North', 3 FROM schools;
INSERT IGNORE INTO school_streams (school_id, stream_name, display_order)
SELECT school_id, 'South', 4 FROM schools;

-- Initialize student ID sequences for existing schools
INSERT IGNORE INTO student_id_sequences (school_id, next_id, prefix)
SELECT school_id, 1, 'STU' FROM schools;
