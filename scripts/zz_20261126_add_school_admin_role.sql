-- Add a separate school administrator role without changing existing staff roles.
-- This filename sorts after tidb_full_schema.sql in the migration runner.
ALTER TABLE teachers
  MODIFY COLUMN role ENUM('teacher','head','bursar','school_admin') DEFAULT 'teacher';
