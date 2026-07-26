-- Migration: add email column to teachers and otp_sessions to support email-based sign-in

ALTER TABLE teachers
  ADD COLUMN email VARCHAR(120) UNIQUE NULL;

ALTER TABLE otp_sessions
  ADD COLUMN email VARCHAR(120) NULL;

-- Optional: backfill teachers.email from a teachers_contact table if you have one
-- UPDATE teachers SET email = (SELECT contact_email FROM teachers_contact tc WHERE tc.teacher_id = teachers.teacher_id LIMIT 1) WHERE email IS NULL;

-- Notes:
-- 1) Apply this migration before enabling email-based OTP in production.
-- 2) Ensure appropriate indexes and constraints are added depending on your needs.
