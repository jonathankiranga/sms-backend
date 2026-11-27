-- Read-only post-migration validation for scripts/20261127_global_identity_memberships.sql.
-- Run against the migrated test database. Every row returned by the exception
-- queries below requires review; this script does not modify application data.

-- 1. Every legacy teacher must have a global staff account.
SELECT teacher_id, school_id, role
FROM teachers
WHERE staff_account_id IS NULL;

-- 2. Every teacher must have exactly the matching school membership.
SELECT t.teacher_id, t.staff_account_id, t.school_id, t.role
FROM teachers t
LEFT JOIN teacher_school_memberships m
  ON m.teacher_id = t.teacher_id
 AND m.staff_account_id = t.staff_account_id
 AND m.school_id = t.school_id
 AND m.role = t.role
WHERE m.membership_id IS NULL;

-- 3. Duplicate global staff membership keys must not exist.
SELECT staff_account_id, school_id, role, COUNT(*) AS duplicate_count,
       GROUP_CONCAT(teacher_id ORDER BY teacher_id) AS teacher_ids
FROM teacher_school_memberships
GROUP BY staff_account_id, school_id, role
HAVING COUNT(*) > 1;

-- 4. Every legacy parent profile must be attached to a global parent account.
SELECT parent_phone
FROM parent_profiles
WHERE parent_account_id IS NULL;

-- 5. Every legacy student-parent link must have a matching consolidated
--    relationship for the same parent account, learner and school.
SELECT m.student_id, m.parent_phone, p.parent_account_id, s.school_id
FROM student_parent_map m
JOIN parent_profiles p ON p.parent_phone = m.parent_phone
JOIN students s ON s.student_id = m.student_id
LEFT JOIN parent_student_relationships r
  ON r.parent_account_id = p.parent_account_id
 AND r.student_id = m.student_id
 AND r.school_id = s.school_id
WHERE r.relationship_id IS NULL;

-- 6. Parent-child relationships must never point at a different school
--    from the learner's actual school.
SELECT r.relationship_id, r.parent_account_id, r.student_id,
       r.school_id AS relationship_school_id,
       s.school_id AS student_school_id
FROM parent_student_relationships r
JOIN students s ON s.student_id = r.student_id
WHERE r.school_id <> s.school_id;

-- 7. Every parent account must retain its canonical profile.
SELECT a.parent_account_id, a.canonical_parent_phone
FROM parent_accounts a
LEFT JOIN parent_profiles p
  ON p.parent_account_id = a.parent_account_id
 AND p.parent_phone = a.canonical_parent_phone
WHERE p.parent_phone IS NULL;

-- 8. Migration inventory totals for comparison with the pre-migration backup.
SELECT 'teachers' AS table_name, COUNT(*) AS row_count FROM teachers
UNION ALL
SELECT 'teacher_school_memberships', COUNT(*) FROM teacher_school_memberships
UNION ALL
SELECT 'staff_accounts', COUNT(*) FROM staff_accounts
UNION ALL
SELECT 'parent_profiles', COUNT(*) FROM parent_profiles
UNION ALL
SELECT 'parent_accounts', COUNT(*) FROM parent_accounts
UNION ALL
SELECT 'student_parent_map', COUNT(*) FROM student_parent_map
UNION ALL
SELECT 'parent_student_relationships', COUNT(*) FROM parent_student_relationships
UNION ALL
SELECT 'premium_subscriptions', COUNT(*) FROM premium_subscriptions;
