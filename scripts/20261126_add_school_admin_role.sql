-- Add a separate school administrator role without changing existing staff roles.
ALTER TABLE teachers
  MODIFY COLUMN role ENUM('teacher','head','bursar','school_admin') DEFAULT 'teacher';
