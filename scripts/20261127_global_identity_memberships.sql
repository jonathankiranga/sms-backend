-- Global identity and school membership foundation.
-- Apply once after taking a full database backup.
-- Existing teachers and parent profiles remain intact; legacy IDs are preserved.

ALTER TABLE otp_sessions
  ADD COLUMN school_id CHAR(9) NULL AFTER teacher_id,
  ADD COLUMN login_role VARCHAR(30) NULL AFTER school_id,
  ADD KEY idx_otp_sessions_school (school_id),
  ADD KEY idx_otp_sessions_login_role (login_role);

-- A person has one staff identity and may hold memberships in multiple schools.
CREATE TABLE staff_accounts (
  staff_account_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  identity_key VARCHAR(160) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  primary_email VARCHAR(120) NULL,
  primary_phone VARCHAR(20) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (staff_account_id),
  UNIQUE KEY uq_staff_identity_key (identity_key),
  KEY idx_staff_accounts_email (primary_email),
  KEY idx_staff_accounts_phone (primary_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE teachers
  ADD COLUMN staff_account_id BIGINT UNSIGNED NULL AFTER teacher_id,
  DROP INDEX uq_phone_role,
  DROP INDEX uq_email_role,
  ADD KEY idx_teachers_school_phone_role (school_id, phone, role),
  ADD KEY idx_teachers_school_email_role (school_id, email, role),
  ADD KEY idx_teachers_staff_account (staff_account_id);

-- Group existing school-specific teacher records by their normalized email.
-- Phone is the fallback where an email is not recorded. This avoids changing
-- legacy teacher IDs and preserves each school's role and employment record.
INSERT INTO staff_accounts (identity_key, full_name, primary_email, primary_phone)
SELECT
  identity_key,
  MAX(full_name),
  MAX(NULLIF(LOWER(TRIM(email)), '')),
  MAX(NULLIF(TRIM(phone), ''))
FROM (
  SELECT
    teacher_id,
    full_name,
    email,
    phone,
    CASE
      WHEN NULLIF(TRIM(email), '') IS NOT NULL
        THEN CONCAT('email:', LOWER(TRIM(email)))
      WHEN NULLIF(TRIM(phone), '') IS NOT NULL
        THEN CONCAT('phone:', CASE
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '')) = 10
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''), 1) = '0'
            THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''), 2))
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '')) = 9
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''), 1) IN ('1', '7')
            THEN CONCAT('254', REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''))
          ELSE REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '')
        END)
      ELSE CONCAT('teacher:', teacher_id)
    END AS identity_key
  FROM teachers
) existing_teacher_identities
GROUP BY identity_key;

UPDATE teachers t
JOIN staff_accounts a
  ON a.identity_key = CASE
    WHEN NULLIF(TRIM(t.email), '') IS NOT NULL
      THEN CONCAT('email:', LOWER(TRIM(t.email)))
    WHEN NULLIF(TRIM(t.phone), '') IS NOT NULL
      THEN CONCAT('phone:', CASE
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(t.phone), ' ', ''), '-', ''), '+', '')) = 10
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(t.phone), ' ', ''), '-', ''), '+', ''), 1) = '0'
            THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(REPLACE(TRIM(t.phone), ' ', ''), '-', ''), '+', ''), 2))
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(t.phone), ' ', ''), '-', ''), '+', '')) = 9
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(t.phone), ' ', ''), '-', ''), '+', ''), 1) IN ('1', '7')
            THEN CONCAT('254', REPLACE(REPLACE(REPLACE(TRIM(t.phone), ' ', ''), '-', ''), '+', ''))
          ELSE REPLACE(REPLACE(REPLACE(TRIM(t.phone), ' ', ''), '-', ''), '+', '')
        END)
    ELSE CONCAT('teacher:', t.teacher_id)
  END
SET t.staff_account_id = a.staff_account_id;

ALTER TABLE teachers
  ADD CONSTRAINT fk_teacher_staff_account FOREIGN KEY (staff_account_id)
    REFERENCES staff_accounts(staff_account_id);

CREATE TABLE staff_account_contacts (
  contact_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_account_id BIGINT UNSIGNED NOT NULL,
  contact_type ENUM('email','phone') NOT NULL,
  contact_value VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contact_id),
  UNIQUE KEY uq_staff_contact_per_account (staff_account_id, contact_type, contact_value),
  KEY idx_staff_contact_lookup (contact_type, contact_value),
  CONSTRAINT fk_staff_contact_account FOREIGN KEY (staff_account_id)
    REFERENCES staff_accounts(staff_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO staff_account_contacts (staff_account_id, contact_type, contact_value)
SELECT staff_account_id, 'phone', TRIM(phone)
FROM teachers
WHERE NULLIF(TRIM(phone), '') IS NOT NULL;

INSERT IGNORE INTO staff_account_contacts (staff_account_id, contact_type, contact_value)
SELECT staff_account_id, 'phone', CASE
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '')) = 10
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''), 1) = '0'
            THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''), 2))
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '')) = 9
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''), 1) IN ('1', '7')
            THEN CONCAT('254', REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', ''))
          ELSE REPLACE(REPLACE(REPLACE(TRIM(phone), ' ', ''), '-', ''), '+', '')
        END
FROM teachers
WHERE NULLIF(TRIM(phone), '') IS NOT NULL;

INSERT IGNORE INTO staff_account_contacts (staff_account_id, contact_type, contact_value)
SELECT staff_account_id, 'email', LOWER(TRIM(email))
FROM teachers
WHERE NULLIF(TRIM(email), '') IS NOT NULL;

CREATE TABLE teacher_school_memberships (
  membership_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  staff_account_id BIGINT UNSIGNED NOT NULL,
  teacher_id CHAR(9) NOT NULL,
  school_id CHAR(9) NOT NULL,
  role ENUM('teacher','head','bursar','school_admin') NOT NULL DEFAULT 'teacher',
  status ENUM('active','inactive','suspended') NOT NULL DEFAULT 'active',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  PRIMARY KEY (membership_id),
  UNIQUE KEY uq_teacher_membership_teacher (teacher_id),
  UNIQUE KEY uq_teacher_membership_school_role (staff_account_id, school_id, role),
  KEY idx_teacher_membership_school_status (school_id, status),
  CONSTRAINT fk_teacher_membership_account FOREIGN KEY (staff_account_id)
    REFERENCES staff_accounts(staff_account_id),
  CONSTRAINT fk_teacher_membership_teacher FOREIGN KEY (teacher_id)
    REFERENCES teachers(teacher_id),
  CONSTRAINT fk_teacher_membership_school FOREIGN KEY (school_id)
    REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO teacher_school_memberships
  (staff_account_id, teacher_id, school_id, role, status)
SELECT staff_account_id, teacher_id, school_id, role,
       CASE WHEN active = 1 THEN 'active' ELSE 'inactive' END
FROM teachers
WHERE staff_account_id IS NOT NULL;

-- Parents have one global account. Existing profiles with the same normalized
-- email are grouped together; profiles without email remain phone-keyed.
-- This lets a parent registered in multiple schools see all linked children.
CREATE TABLE parent_accounts (
  parent_account_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  identity_key VARCHAR(160) NOT NULL,
  canonical_parent_phone VARCHAR(20) NOT NULL,
  full_name VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (parent_account_id),
  UNIQUE KEY uq_parent_account_identity (identity_key),
  UNIQUE KEY uq_parent_account_phone (canonical_parent_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Do not merge parent records merely because an unverified email matches.
-- Each existing phone profile starts as a separate account. The accounts are
-- consolidated only after the parent proves control of the shared email by OTP.
INSERT INTO parent_accounts (identity_key, canonical_parent_phone, full_name)
SELECT CONCAT('phone:', parent_phone), parent_phone, MAX(full_name)
FROM parent_profiles
GROUP BY parent_phone;

ALTER TABLE parent_profiles
  ADD COLUMN parent_account_id BIGINT UNSIGNED NULL AFTER parent_phone,
  ADD KEY idx_parent_profiles_account (parent_account_id);

UPDATE parent_profiles p
JOIN parent_accounts a
  ON a.identity_key = CONCAT('phone:', p.parent_phone)
SET p.parent_account_id = a.parent_account_id;

ALTER TABLE parent_profiles
  ADD CONSTRAINT fk_parent_profile_account FOREIGN KEY (parent_account_id)
    REFERENCES parent_accounts(parent_account_id);

CREATE TABLE parent_account_contacts (
  contact_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parent_account_id BIGINT UNSIGNED NOT NULL,
  contact_type ENUM('email','phone') NOT NULL,
  contact_value VARCHAR(120) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  verified_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (contact_id),
  UNIQUE KEY uq_parent_contact_per_account (parent_account_id, contact_type, contact_value),
  KEY idx_parent_contact_lookup (contact_type, contact_value),
  CONSTRAINT fk_parent_contact_account FOREIGN KEY (parent_account_id)
    REFERENCES parent_accounts(parent_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO parent_account_contacts
  (parent_account_id, contact_type, contact_value, is_primary, verified_at)
SELECT a.parent_account_id, 'phone', p.parent_phone, 1, NULL
FROM parent_profiles p
JOIN parent_accounts a ON a.parent_account_id = p.parent_account_id;

INSERT IGNORE INTO parent_account_contacts
  (parent_account_id, contact_type, contact_value, is_primary, verified_at)
SELECT a.parent_account_id, 'email', LOWER(TRIM(p.email)), 1, NULL
FROM parent_profiles p
JOIN parent_accounts a ON a.parent_account_id = p.parent_account_id
WHERE NULLIF(TRIM(p.email), '') IS NOT NULL;

CREATE TABLE parent_student_relationships (
  relationship_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  parent_account_id BIGINT UNSIGNED NOT NULL,
  student_id CHAR(9) NOT NULL,
  school_id CHAR(9) NOT NULL,
  relationship_type VARCHAR(30) NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  can_view_results TINYINT(1) NOT NULL DEFAULT 1,
  can_view_fees TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (relationship_id),
  UNIQUE KEY uq_parent_student_relationship (parent_account_id, student_id),
  KEY idx_parent_relationship_school (school_id, status),
  CONSTRAINT fk_parent_relationship_account FOREIGN KEY (parent_account_id)
    REFERENCES parent_accounts(parent_account_id),
  CONSTRAINT fk_parent_relationship_student FOREIGN KEY (student_id)
    REFERENCES students(student_id),
  CONSTRAINT fk_parent_relationship_school FOREIGN KEY (school_id)
    REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO parent_student_relationships
  (parent_account_id, student_id, school_id, relationship_type)
SELECT p.parent_account_id, m.student_id, s.school_id, m.relationship
FROM student_parent_map m
JOIN parent_profiles p ON p.parent_phone = m.parent_phone
JOIN students s ON s.student_id = m.student_id
WHERE p.parent_account_id IS NOT NULL
ON DUPLICATE KEY UPDATE
  school_id = VALUES(school_id),
  relationship_type = VALUES(relationship_type);

-- Review duplicate parent contact values before allowing a contact to resolve
-- to an account. This should return no rows after the email-based consolidation.
-- SELECT contact_type, contact_value, COUNT(DISTINCT parent_account_id) AS accounts
-- FROM parent_account_contacts
-- GROUP BY contact_type, contact_value
-- HAVING COUNT(DISTINCT parent_account_id) > 1;

ALTER TABLE otp_sessions
  ADD COLUMN parent_account_id BIGINT UNSIGNED NULL AFTER login_role,
  ADD KEY idx_otp_sessions_parent_account (parent_account_id);

ALTER TABLE otp_sessions
  ADD CONSTRAINT fk_otp_parent_account FOREIGN KEY (parent_account_id)
    REFERENCES parent_accounts(parent_account_id);


-- Keep the identity layer synchronized with legacy registration/payment code.
-- New parent_profiles rows automatically receive a global account and contacts.
DELIMITER $$

CREATE TRIGGER trg_parent_profile_before_insert
BEFORE INSERT ON parent_profiles
FOR EACH ROW
BEGIN
  INSERT INTO parent_accounts (identity_key, canonical_parent_phone, full_name)
  VALUES (CONCAT('phone:', NEW.parent_phone), NEW.parent_phone, NEW.full_name)
  ON DUPLICATE KEY UPDATE parent_account_id = LAST_INSERT_ID(parent_account_id);
  SET NEW.parent_account_id = LAST_INSERT_ID();
END$$

CREATE TRIGGER trg_parent_profile_after_insert
AFTER INSERT ON parent_profiles
FOR EACH ROW
BEGIN
  INSERT IGNORE INTO parent_account_contacts
    (parent_account_id, contact_type, contact_value, is_primary)
  VALUES (NEW.parent_account_id, 'phone', NEW.parent_phone, 1);

  IF NULLIF(TRIM(NEW.email), '') IS NOT NULL THEN
    INSERT IGNORE INTO parent_account_contacts
      (parent_account_id, contact_type, contact_value, is_primary)
    VALUES (NEW.parent_account_id, 'email', LOWER(TRIM(NEW.email)), 1);
  END IF;
END$$

-- If a school updates a parent's email, add it as an unverified contact alias.
-- It is not merged with other parent accounts until an OTP is verified.
CREATE TRIGGER trg_parent_profile_after_update
AFTER UPDATE ON parent_profiles
FOR EACH ROW
BEGIN
  IF COALESCE(LOWER(TRIM(NEW.email)), '') <> COALESCE(LOWER(TRIM(OLD.email)), '')
     AND NULLIF(TRIM(NEW.email), '') IS NOT NULL THEN
    INSERT IGNORE INTO parent_account_contacts
      (parent_account_id, contact_type, contact_value, is_primary)
    VALUES (NEW.parent_account_id, 'email', LOWER(TRIM(NEW.email)), 1);
  END IF;
END$$

-- All existing and new student-parent links feed the consolidated relationship
-- table, so older school registration endpoints remain compatible.
CREATE TRIGGER trg_student_parent_after_insert
AFTER INSERT ON student_parent_map
FOR EACH ROW
BEGIN
  INSERT INTO parent_student_relationships
    (parent_account_id, student_id, school_id, relationship_type)
  SELECT pp.parent_account_id, NEW.student_id, s.school_id, NEW.relationship
  FROM parent_profiles pp
  JOIN students s ON s.student_id = NEW.student_id
  WHERE pp.parent_phone = NEW.parent_phone
    AND pp.parent_account_id IS NOT NULL
  ON DUPLICATE KEY UPDATE
    school_id = VALUES(school_id),
    relationship_type = VALUES(relationship_type),
    status = 'active';
END$$


CREATE TRIGGER trg_student_parent_after_delete
AFTER DELETE ON student_parent_map
FOR EACH ROW
BEGIN
  UPDATE parent_student_relationships r
  JOIN parent_profiles pp ON pp.parent_account_id = r.parent_account_id
  SET r.status = 'inactive'
  WHERE pp.parent_phone = OLD.parent_phone
    AND r.student_id = OLD.student_id
    AND NOT EXISTS (
      SELECT 1
      FROM student_parent_map remaining_map
      JOIN parent_profiles remaining_parent
        ON remaining_parent.parent_phone = remaining_map.parent_phone
      WHERE remaining_map.student_id = OLD.student_id
        AND remaining_parent.parent_account_id = r.parent_account_id
    );
END$$


-- Future teacher registrations automatically create/reuse a global staff
-- identity and create the corresponding school membership.
CREATE TRIGGER trg_teacher_before_insert
BEFORE INSERT ON teachers
FOR EACH ROW
BEGIN
  DECLARE v_email_account BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_phone_account BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_account_id BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_identity_key VARCHAR(160);
  DECLARE v_email_count INT DEFAULT 0;
  DECLARE v_phone_count INT DEFAULT 0;
  DECLARE v_normalized_phone VARCHAR(20);

  SET v_normalized_phone = CASE
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', '')) = 10
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''), 1) = '0'
            THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''), 2))
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', '')) = 9
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''), 1) IN ('1', '7')
            THEN CONCAT('254', REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''))
          ELSE REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', '')
        END;

  IF NULLIF(TRIM(NEW.email), '') IS NOT NULL THEN
    SELECT COUNT(DISTINCT staff_account_id) INTO v_email_count
    FROM staff_account_contacts
    WHERE contact_type = 'email' AND contact_value = LOWER(TRIM(NEW.email));
    IF v_email_count > 1 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Teacher email is linked to multiple staff identities; reconcile contacts first';
    END IF;
    SELECT staff_account_id INTO v_email_account
    FROM staff_account_contacts
    WHERE contact_type = 'email' AND contact_value = LOWER(TRIM(NEW.email))
    ORDER BY staff_account_id LIMIT 1;
  END IF;

  IF NULLIF(TRIM(NEW.phone), '') IS NOT NULL THEN
    SELECT COUNT(DISTINCT staff_account_id) INTO v_phone_count
    FROM staff_account_contacts
    WHERE contact_type = 'phone' AND contact_value IN (v_normalized_phone, TRIM(NEW.phone));
    IF v_phone_count > 1 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Teacher phone is linked to multiple staff identities; reconcile contacts first';
    END IF;
    SELECT staff_account_id INTO v_phone_account
    FROM staff_account_contacts
    WHERE contact_type = 'phone' AND contact_value IN (v_normalized_phone, TRIM(NEW.phone))
    ORDER BY staff_account_id LIMIT 1;
  END IF;

  IF v_email_account IS NOT NULL AND v_phone_account IS NOT NULL
     AND v_email_account <> v_phone_account THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Teacher email and phone belong to different staff identities; reconcile contacts first';
  END IF;

  SET v_account_id = COALESCE(v_email_account, v_phone_account);
  IF v_account_id IS NULL THEN
    SET v_identity_key = CASE
      WHEN NULLIF(TRIM(NEW.email), '') IS NOT NULL THEN CONCAT('email:', LOWER(TRIM(NEW.email)))
      WHEN NULLIF(TRIM(NEW.phone), '') IS NOT NULL THEN CONCAT('phone:', v_normalized_phone)
      ELSE CONCAT('teacher:', NEW.teacher_id)
    END;

    INSERT INTO staff_accounts (identity_key, full_name, primary_email, primary_phone)
    VALUES (v_identity_key, NEW.full_name, NULLIF(LOWER(TRIM(NEW.email)), ''), NULLIF(TRIM(NEW.phone), ''))
    ON DUPLICATE KEY UPDATE staff_account_id = LAST_INSERT_ID(staff_account_id);
    SET v_account_id = LAST_INSERT_ID();
  END IF;

  SET NEW.staff_account_id = v_account_id;
END$$

CREATE TRIGGER trg_teacher_after_insert
AFTER INSERT ON teachers
FOR EACH ROW
BEGIN
  IF NULLIF(TRIM(NEW.email), '') IS NOT NULL THEN
    INSERT IGNORE INTO staff_account_contacts (staff_account_id, contact_type, contact_value)
    VALUES (NEW.staff_account_id, 'email', LOWER(TRIM(NEW.email)));
  END IF;
  IF NULLIF(TRIM(NEW.phone), '') IS NOT NULL THEN
    INSERT IGNORE INTO staff_account_contacts (staff_account_id, contact_type, contact_value)
    VALUES (NEW.staff_account_id, 'phone', TRIM(NEW.phone));
    INSERT IGNORE INTO staff_account_contacts (staff_account_id, contact_type, contact_value)
    VALUES (NEW.staff_account_id, 'phone', CASE
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', '')) = 10
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''), 1) = '0'
            THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''), 2))
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', '')) = 9
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''), 1) IN ('1', '7')
            THEN CONCAT('254', REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''))
          ELSE REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', '')
        END);
  END IF;

  INSERT INTO teacher_school_memberships
    (staff_account_id, teacher_id, school_id, role, status)
  VALUES (
    NEW.staff_account_id, NEW.teacher_id, NEW.school_id, NEW.role,
    CASE WHEN NEW.active = 1 THEN 'active' ELSE 'inactive' END
  );
END$$

CREATE TRIGGER trg_teacher_after_update
AFTER UPDATE ON teachers
FOR EACH ROW
BEGIN
  UPDATE teacher_school_memberships
  SET staff_account_id = NEW.staff_account_id,
      school_id = NEW.school_id,
      role = NEW.role,
      status = CASE WHEN NEW.active = 1 THEN 'active' ELSE 'inactive' END
  WHERE teacher_id = NEW.teacher_id;

  IF NULLIF(TRIM(NEW.email), '') IS NOT NULL THEN
    INSERT IGNORE INTO staff_account_contacts (staff_account_id, contact_type, contact_value)
    VALUES (NEW.staff_account_id, 'email', LOWER(TRIM(NEW.email)));
  END IF;
  IF NULLIF(TRIM(NEW.phone), '') IS NOT NULL THEN
    INSERT IGNORE INTO staff_account_contacts (staff_account_id, contact_type, contact_value)
    VALUES (NEW.staff_account_id, 'phone', TRIM(NEW.phone));
    INSERT IGNORE INTO staff_account_contacts (staff_account_id, contact_type, contact_value)
    VALUES (NEW.staff_account_id, 'phone', CASE
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', '')) = 10
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''), 1) = '0'
            THEN CONCAT('254', SUBSTRING(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''), 2))
          WHEN CHAR_LENGTH(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', '')) = 9
               AND LEFT(REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''), 1) IN ('1', '7')
            THEN CONCAT('254', REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', ''))
          ELSE REPLACE(REPLACE(REPLACE(TRIM(NEW.phone), ' ', ''), '-', ''), '+', '')
        END);
  END IF;
END$

DELIMITER ;
