-- Extend the staff role model and ensure the active-account field exists.
-- This filename sorts after tidb_full_schema.sql in the migration runner.
ALTER TABLE teachers
  MODIFY COLUMN role ENUM('teacher','head','bursar','school_admin') DEFAULT 'teacher';

SET @teachers_active_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'teachers'
    AND COLUMN_NAME = 'active'
);
SET @teachers_active_sql = IF(
  @teachers_active_exists = 0,
  'ALTER TABLE teachers ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1'
);
PREPARE teachers_active_stmt FROM @teachers_active_sql;
EXECUTE teachers_active_stmt;
DEALLOCATE PREPARE teachers_active_stmt;
