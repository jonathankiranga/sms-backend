-- Add marked_at column to attendance_logs to capture the exact local time
-- the teacher tapped Present/Absent, independent of sync time.
ALTER TABLE attendance_logs
  ADD COLUMN marked_at DATETIME NULL AFTER status;
