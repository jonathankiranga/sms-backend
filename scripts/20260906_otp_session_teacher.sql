-- Stamp the resolved teacher into OTP sessions so later calls resolve
-- deterministically even when one contact holds multiple roles.
-- '' means unknown (sessions created before this column); resolvers fall
-- back to the role-filtered phone/email lookup in that case.
ALTER TABLE otp_sessions ADD COLUMN teacher_id CHAR(9) NOT NULL DEFAULT '';
