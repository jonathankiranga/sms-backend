-- Add 'bursar' to teachers.role enum (headteacher creates their bursar; bursar uses Bazar Pay portal)
ALTER TABLE teachers
  MODIFY COLUMN role ENUM('teacher', 'head', 'bursar') NOT NULL DEFAULT 'teacher';