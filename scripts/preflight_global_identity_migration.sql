-- Read-only preflight checks for scripts/20261127_global_identity_memberships.sql.
-- Run against a BACKUP/CLONE of the current database before applying the migration.
-- Any returned rows require review. This file does not modify data.

-- 1. Teacher duplicates that would collide with the new
--    (staff_account_id, school_id, role) membership uniqueness rule.
SELECT
  school_id,
  role,
  CASE
    WHEN NULLIF(TRIM(email), '') IS NOT NULL THEN CONCAT('email:', LOWER(TRIM(email)))
    WHEN NULLIF(TRIM(phone), '') IS NOT NULL
      THEN CONCAT('phone:', REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''))
    ELSE CONCAT('teacher:', teacher_id)
  END AS identity_key,
  COUNT(*) AS teacher_rows,
  GROUP_CONCAT(teacher_id ORDER BY teacher_id) AS teacher_ids
FROM teachers
GROUP BY school_id, role, identity_key
HAVING COUNT(*) > 1;

-- 2. Shared teacher emails associated with multiple phone numbers.
--    These may be legitimate shared office addresses, not one human identity.
SELECT
  LOWER(TRIM(email)) AS normalized_email,
  COUNT(DISTINCT teacher_id) AS teacher_count,
  COUNT(DISTINCT REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '')) AS phone_count,
  GROUP_CONCAT(DISTINCT school_id ORDER BY school_id) AS school_ids,
  GROUP_CONCAT(teacher_id ORDER BY teacher_id) AS teacher_ids
FROM teachers
WHERE NULLIF(TRIM(email), '') IS NOT NULL
GROUP BY LOWER(TRIM(email))
HAVING COUNT(DISTINCT REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '')) > 1;

-- 3. Blank or malformed staff contact records that need manual review.
SELECT teacher_id, school_id, full_name, phone, email, role
FROM teachers
WHERE NULLIF(TRIM(phone), '') IS NULL
   OR (email IS NOT NULL AND TRIM(email) <> '' AND LOWER(TRIM(email)) NOT REGEXP '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$');

-- 4. Parent records using different phone formats for the same Kenyan number.
--    They remain separate until the parent proves control of the number by OTP.
SELECT normalized_phone, COUNT(*) AS profile_count,
       GROUP_CONCAT(parent_phone ORDER BY parent_phone) AS stored_phones
FROM (
  SELECT parent_phone,
    CASE
      WHEN REPLACE(REPLACE(REPLACE(TRIM(parent_phone), ' ', ''), '-', ''), '+', '') REGEXP '^0[17][0-9]{8}$'
        THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(REPLACE(TRIM(parent_phone), ' ', ''), '-', ''), '+', ''), 2))
      WHEN REPLACE(REPLACE(REPLACE(TRIM(parent_phone), ' ', ''), '-', ''), '+', '') REGEXP '^[17][0-9]{8}$'
        THEN CONCAT('254', REPLACE(REPLACE(REPLACE(TRIM(parent_phone), ' ', ''), '-', ''), '+', ''))
      ELSE REPLACE(REPLACE(REPLACE(TRIM(parent_phone), ' ', ''), '-', ''), '+', '')
    END AS normalized_phone
  FROM parent_profiles
) normalized_parents
GROUP BY normalized_phone
HAVING COUNT(*) > 1;

-- 5. Shared parent emails. OTP proves control of the email, but multiple
--    records may represent a shared household mailbox and must be reviewed
--    before automatic account consolidation.
SELECT LOWER(TRIM(email)) AS normalized_email,
       COUNT(DISTINCT parent_phone) AS profile_count,
       GROUP_CONCAT(parent_phone ORDER BY parent_phone) AS parent_phones
FROM parent_profiles
WHERE NULLIF(TRIM(email), '') IS NOT NULL
GROUP BY LOWER(TRIM(email))
HAVING COUNT(DISTINCT parent_phone) > 1;

-- 6. Parent-child links that cannot be resolved to both a parent and a student.
SELECT m.student_id, m.parent_phone
FROM student_parent_map m
LEFT JOIN parent_profiles p ON p.parent_phone = m.parent_phone
LEFT JOIN students s ON s.student_id = m.student_id
WHERE p.parent_phone IS NULL OR s.student_id IS NULL;

-- 7. Parent-child records whose student has no valid school reference.
SELECT m.student_id, m.parent_phone, s.school_id
FROM student_parent_map m
JOIN students s ON s.student_id = m.student_id
LEFT JOIN schools sc ON sc.school_id = s.school_id
WHERE sc.school_id IS NULL;

-- 8. Shared teacher phone numbers associated with multiple email addresses.
--    These may be one teacher with changing work email, or a shared household
--    number. Review before relying on phone as a global identity key.
SELECT
  CASE
    WHEN REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '') REGEXP '^0[17][0-9]{8}$'
      THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''), 2))
    WHEN REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '') REGEXP '^[17][0-9]{8}$'
      THEN CONCAT('254', REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''))
    ELSE REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '')
  END AS normalized_phone,
  COUNT(DISTINCT teacher_id) AS teacher_count,
  COUNT(DISTINCT LOWER(TRIM(email))) AS email_count,
  GROUP_CONCAT(DISTINCT school_id ORDER BY school_id) AS school_ids,
  GROUP_CONCAT(teacher_id ORDER BY teacher_id) AS teacher_ids
FROM teachers
WHERE NULLIF(TRIM(phone), '') IS NOT NULL
GROUP BY normalized_phone
HAVING COUNT(DISTINCT LOWER(TRIM(email))) > 1;
