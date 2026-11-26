-- Extend the staff role model and ensure the active-account field exists.
-- This filename sorts after tidb_full_schema.sql in the migration runner.
ALTER TABLE teachers
  MODIFY COLUMN role ENUM('teacher','head','bursar','school_admin') DEFAULT 'teacher';

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS active TINYINT(1) NOT NULL DEFAULT 1;
