-- Attendance alert dedup columns: track when the last WhatsApp alert was sent
-- per student per school-day so re-syncing the same date doesn't re-alert.
SET @db = (SELECT DATABASE());

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attendance_logs' AND COLUMN_NAME = 'absence_alerted_at');
SET @sql = IF(@exists = 0, 'ALTER TABLE attendance_logs ADD COLUMN absence_alerted_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'attendance_logs' AND COLUMN_NAME = 'consecutive_alerted_at');
SET @sql = IF(@exists = 0, 'ALTER TABLE attendance_logs ADD COLUMN consecutive_alerted_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
