-- Add NEMIS number to students table
ALTER TABLE students ADD COLUMN nemis_number VARCHAR(20) NULL AFTER admission_number;
