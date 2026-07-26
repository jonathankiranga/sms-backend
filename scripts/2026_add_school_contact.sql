-- Migration: add contact fields to schools
ALTER TABLE schools
  ADD COLUMN contact_name VARCHAR(120) NULL AFTER region,
  ADD COLUMN contact_phone VARCHAR(20) NULL AFTER contact_name,
  ADD COLUMN contact_email VARCHAR(120) NULL AFTER contact_phone,
  ADD COLUMN contact_address TEXT NULL AFTER contact_email,
  ADD COLUMN contact_website VARCHAR(255) NULL AFTER contact_address;

-- Note: populate these fields when creating schools via the admin API or via manual update.