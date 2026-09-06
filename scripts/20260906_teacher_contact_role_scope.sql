-- Allow the same contact (phone/email) to hold different roles.
-- Uniqueness moves from the contact alone to (contact, role), so one
-- person can be e.g. a teacher in one school and a head/bursar in another
-- without needing multiple phone numbers or emails. Same phone + same role
-- is still rejected (409) at the API layer and by these keys.
-- Existing rows are unaffected (current phones are distinct).
ALTER TABLE teachers DROP INDEX `phone`;
ALTER TABLE teachers DROP INDEX `email`;
ALTER TABLE teachers ADD UNIQUE KEY `uq_phone_role` (`phone`, `role`);
ALTER TABLE teachers ADD UNIQUE KEY `uq_email_role` (`email`, `role`);
