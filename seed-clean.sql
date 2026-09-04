-- ============================================================
-- FreeSchool DEMO SEED DATA - CLEAN RESEED
-- Run this manually against the freeschool database
-- School: DEM000001 (Greenfield Academy)
-- ============================================================

SET @SID = 'DEM000001';
SET @YEAR = 2026;
SET @EMAIL = 'jonathankiranga@gmail.com';
SET @PHONE = '254712345678';

-- ============================================================
-- STEP 1: CLEAN EXISTING DEMO DATA (delete in FK-safe order)
-- ============================================================

DELETE er FROM exam_results er
  JOIN exam_sessions es ON er.session_id = es.session_id
  WHERE es.school_id = @SID;

DELETE FROM sub_learning_areas
  WHERE area_id IN (SELECT area_id FROM learning_areas WHERE school_id = @SID);

DELETE FROM exam_sessions WHERE school_id = @SID;

DELETE FROM assessment_results
  WHERE student_id IN (SELECT student_id FROM students WHERE school_id = @SID);

DELETE FROM attendance_logs
  WHERE student_id IN (SELECT student_id FROM students WHERE school_id = @SID);

DELETE FROM fee_assignments
  WHERE fee_id IN (SELECT fee_id FROM fee_structures WHERE school_id = @SID);

DELETE FROM payment_ledger WHERE school_id = @SID;

DELETE FROM fee_structures WHERE school_id = @SID;

DELETE FROM student_parent_map
  WHERE student_id IN (SELECT student_id FROM students WHERE school_id = @SID);

DELETE FROM parent_profiles WHERE school_id = @SID;

DELETE FROM students WHERE school_id = @SID;

DELETE FROM classes WHERE school_id = @SID;

DELETE FROM learning_areas WHERE school_id = @SID;

DELETE FROM teachers WHERE school_id = @SID;

DELETE FROM school_terms WHERE school_id = @SID;

DELETE FROM school_rubric_config WHERE school_id = @SID;

DELETE FROM school_report_settings WHERE school_id = @SID;

DELETE FROM schools WHERE school_id = @SID;

-- ============================================================
-- STEP 2: ADD MISSING UNIQUE CONSTRAINTS
-- ============================================================

-- classes: no duplicate class name per school
ALTER TABLE classes ADD UNIQUE INDEX idx_school_class (school_id, class_name);

-- students: no duplicate student name per school
ALTER TABLE students ADD UNIQUE INDEX idx_student_name_per_school (school_id, full_name);

-- learning_areas: no duplicate area per school/grade
ALTER TABLE learning_areas ADD UNIQUE INDEX idx_school_area (school_id, level_name, area_name);

-- fee_structures: no duplicate fee per school/term
ALTER TABLE fee_structures ADD UNIQUE INDEX idx_school_fee (school_id, fee_name, term, academic_year);

-- ============================================================
-- STEP 3: RE-INSERT SEED DATA
-- ============================================================

-- -------------------------------------------------------
-- 3a. SCHOOL
-- -------------------------------------------------------
INSERT IGNORE INTO schools
  (school_id, school_name, region, contact_name, contact_phone, contact_email)
VALUES
  (@SID, 'Greenfield Academy', 'Nairobi', 'Jonathan Kiranga', @PHONE, @EMAIL);

-- -------------------------------------------------------
-- 3b. TEACHERS
--    Note: teachers.email has global UNIQUE constraint
--    TCHWX001 (head) uses jonathankiranga@gmail.com
--    TCHWX002 (teacher) uses a different email
-- -------------------------------------------------------
INSERT IGNORE INTO teachers
  (teacher_id, full_name, phone, email, role, school_id, active)
VALUES
  ('TCHWX001', 'Jonathan Kiranga', '', @EMAIL, 'head', @SID, 1);

INSERT IGNORE INTO teachers
  (teacher_id, full_name, phone, email, role, school_id, active)
VALUES
  ('TCHWX002', 'Mary Wanjiku', '', 'mary.wanjiku@demo.com', 'teacher', @SID, 1);

-- -------------------------------------------------------
-- 3c. CLASSES (Grade 1-6)
-- -------------------------------------------------------
INSERT IGNORE INTO classes (school_id, class_name, level_name, academic_year, class_rank)
VALUES
  (@SID, 'Grade 1', 'Grade 1', @YEAR, 1),
  (@SID, 'Grade 2', 'Grade 2', @YEAR, 2),
  (@SID, 'Grade 3', 'Grade 3', @YEAR, 3),
  (@SID, 'Grade 4', 'Grade 4', @YEAR, 4),
  (@SID, 'Grade 5', 'Grade 5', @YEAR, 5),
  (@SID, 'Grade 6', 'Grade 6', @YEAR, 6);

-- -------------------------------------------------------
-- 3d. STUDENTS (2 per grade, male/female mix)
-- -------------------------------------------------------
INSERT IGNORE INTO students (student_id, full_name, class_id, school_id, gender, enrollment_status)
SELECT 'STU000001', 'Amina Hassan',    c.class_id, @SID, 'Female', 'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 1'
UNION ALL SELECT 'STU000002', 'Brian Ochieng',   c.class_id, @SID, 'Male',   'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 1'
UNION ALL SELECT 'STU000003', 'Cynthia Mwangi',  c.class_id, @SID, 'Female', 'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 2'
UNION ALL SELECT 'STU000004', 'David Kamau',     c.class_id, @SID, 'Male',   'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 2'
UNION ALL SELECT 'STU000005', 'Esther Njeri',    c.class_id, @SID, 'Female', 'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 3'
UNION ALL SELECT 'STU000006', 'Francis Otieno',  c.class_id, @SID, 'Male',   'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 3'
UNION ALL SELECT 'STU000007', 'Grace Akinyi',    c.class_id, @SID, 'Female', 'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 4'
UNION ALL SELECT 'STU000008', 'Hassan Abdi',     c.class_id, @SID, 'Male',   'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 4'
UNION ALL SELECT 'STU000009', 'Irene Waithera',  c.class_id, @SID, 'Female', 'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 5'
UNION ALL SELECT 'STU000010', 'James Kariuki',   c.class_id, @SID, 'Male',   'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 5'
UNION ALL SELECT 'STU000011', 'Kevin Mwangi',    c.class_id, @SID, 'Male',   'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 6'
UNION ALL SELECT 'STU000012', 'Lydia Wanjiru',   c.class_id, @SID, 'Female', 'Active' FROM classes c WHERE c.school_id=@SID AND c.class_name='Grade 6';

-- -------------------------------------------------------
-- 3e. PARENT PROFILE (OTP via SMS/WhatsApp, not email)
-- -------------------------------------------------------
INSERT IGNORE INTO parent_profiles
  (parent_phone, full_name, is_premium, premium_expires_at)
VALUES
  (@PHONE, 'Jonathan Kiranga', 1, DATE_ADD(NOW(), INTERVAL 6 MONTH));

INSERT IGNORE INTO student_parent_map
  (student_id, parent_phone, relationship)
VALUES
  ('STU000001', @PHONE, 'Parent');

-- -------------------------------------------------------
-- 3f. LEARNING AREAS (6 areas x 6 grades = 36 rows)
-- -------------------------------------------------------
INSERT IGNORE INTO learning_areas (school_id, level_name, area_name)
SELECT @SID, g.grade, a.area FROM
  (SELECT 'Grade 1' AS grade UNION SELECT 'Grade 2' UNION SELECT 'Grade 3'
   UNION SELECT 'Grade 4' UNION SELECT 'Grade 5' UNION SELECT 'Grade 6') g
  CROSS JOIN
  (SELECT 'English' AS area UNION SELECT 'Mathematics' UNION SELECT 'Science'
   UNION SELECT 'Social Studies' UNION SELECT 'Kiswahili' UNION SELECT 'Creative Arts') a;

-- -------------------------------------------------------
-- 3g. SUB-LEARNING AREAS (CBC sub-strands per learning area)
--     Uses sub_learning_areas.area_id FK to learning_areas
-- -------------------------------------------------------
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name)
SELECT la.area_id, sub.name FROM learning_areas la
  JOIN (
    SELECT 'English' AS area_name, 'Language Use' AS name UNION
    SELECT 'English', 'Composition Writing' UNION
    SELECT 'English', 'Reading' UNION
    SELECT 'English', 'Literary Appreciation' UNION
    SELECT 'Mathematics', 'Numbers' UNION
    SELECT 'Mathematics', 'Algebra' UNION
    SELECT 'Mathematics', 'Geometry' UNION
    SELECT 'Mathematics', 'Measurement' UNION
    SELECT 'Mathematics', 'Data Handling' UNION
    SELECT 'Science', 'Scientific Investigation' UNION
    SELECT 'Science', 'Living Things' UNION
    SELECT 'Science', 'Matter & Energy' UNION
    SELECT 'Science', 'Earth & Beyond' UNION
    SELECT 'Social Studies', 'Historical' UNION
    SELECT 'Social Studies', 'Geographical' UNION
    SELECT 'Social Studies', 'Civic' UNION
    SELECT 'Social Studies', 'Moral' UNION
    SELECT 'Kiswahili', 'Kusoma' UNION
    SELECT 'Kiswahili', 'Kuandika' UNION
    SELECT 'Kiswahili', 'Kusikiliza' UNION
    SELECT 'Kiswahili', 'Kuzungumza' UNION
    SELECT 'Creative Arts', 'Music' UNION
    SELECT 'Creative Arts', 'Visual Arts' UNION
    SELECT 'Creative Arts', 'Drama' UNION
    SELECT 'Creative Arts', 'Physical Education'
  ) sub ON la.area_name = sub.area_name
WHERE la.school_id = @SID;

-- -------------------------------------------------------
-- 3h. EXAM SESSION (End Term 1 2026 - Grade 6, Closed)
-- -------------------------------------------------------
INSERT IGNORE INTO exam_sessions
  (school_id, class_id, term, academic_year, exam_name, exam_type, status, created_by)
SELECT @SID, c.class_id, 'Term 1', @YEAR, 'End Term 1 2026', 'End Term', 'Closed', 'TCHWX001'
FROM classes c WHERE c.school_id = @SID AND c.class_name = 'Grade 6';

-- -------------------------------------------------------
-- 3i. EXAM RESULTS (CBC raw scores for Grade 6 students)
--     Uses exam_results.sub_area_id FK to sub_learning_areas
--     Scores are raw per sub-strand, NOT averaged, NOT out of 100
-- -------------------------------------------------------
-- Kevin Mwangi (STU000011) scores
INSERT IGNORE INTO exam_results (session_id, student_id, sub_area_id, score, out_of, performance_level, entered_by)
SELECT es.session_id, 'STU000011', sla.sub_area_id,
  CASE sla.sub_area_name
    WHEN 'Language Use' THEN 16 WHEN 'Composition Writing' THEN 14 WHEN 'Reading' THEN 17
    WHEN 'Numbers' THEN 22 WHEN 'Algebra' THEN 18 WHEN 'Geometry' THEN 23 WHEN 'Measurement' THEN 20
    WHEN 'Scientific Investigation' THEN 15 WHEN 'Living Things' THEN 16 WHEN 'Matter & Energy' THEN 14
    ELSE 15 END AS score,
  CASE sla.sub_area_name
    WHEN 'Language Use' THEN 20 WHEN 'Composition Writing' THEN 20 WHEN 'Reading' THEN 20
    WHEN 'Numbers' THEN 25 WHEN 'Algebra' THEN 25 WHEN 'Geometry' THEN 25 WHEN 'Measurement' THEN 25
    WHEN 'Scientific Investigation' THEN 20 WHEN 'Living Things' THEN 20 WHEN 'Matter & Energy' THEN 20
    ELSE 20 END AS out_of,
  CASE sla.sub_area_name
    WHEN 'Language Use' THEN 'EE' WHEN 'Composition Writing' THEN 'ME' WHEN 'Reading' THEN 'EE'
    WHEN 'Numbers' THEN 'EE' WHEN 'Algebra' THEN 'ME' WHEN 'Geometry' THEN 'EE' WHEN 'Measurement' THEN 'EE'
    WHEN 'Scientific Investigation' THEN 'ME' WHEN 'Living Things' THEN 'EE' WHEN 'Matter & Energy' THEN 'ME'
    ELSE 'ME' END AS level,
  'TCHWX002'
FROM exam_sessions es
  JOIN sub_learning_areas sla ON sla.area_id IN (
    SELECT area_id FROM learning_areas WHERE school_id = @SID AND area_name IN ('English','Mathematics','Science')
  )
WHERE es.school_id = @SID AND es.exam_name = 'End Term 1 2026'
  AND sla.sub_area_name IN ('Language Use','Composition Writing','Reading',
    'Numbers','Algebra','Geometry','Measurement',
    'Scientific Investigation','Living Things','Matter & Energy');

-- Lydia Wanjiru (STU000012) scores
INSERT IGNORE INTO exam_results (session_id, student_id, sub_area_id, score, out_of, performance_level, entered_by)
SELECT es.session_id, 'STU000012', sla.sub_area_id,
  CASE sla.sub_area_name
    WHEN 'Language Use' THEN 18 WHEN 'Composition Writing' THEN 17 WHEN 'Reading' THEN 19
    WHEN 'Numbers' THEN 24 WHEN 'Algebra' THEN 22 WHEN 'Geometry' THEN 24 WHEN 'Measurement' THEN 23
    WHEN 'Scientific Investigation' THEN 18 WHEN 'Living Things' THEN 17 WHEN 'Matter & Energy' THEN 18
    ELSE 18 END AS score,
  CASE sla.sub_area_name
    WHEN 'Language Use' THEN 20 WHEN 'Composition Writing' THEN 20 WHEN 'Reading' THEN 20
    WHEN 'Numbers' THEN 25 WHEN 'Algebra' THEN 25 WHEN 'Geometry' THEN 25 WHEN 'Measurement' THEN 25
    WHEN 'Scientific Investigation' THEN 20 WHEN 'Living Things' THEN 20 WHEN 'Matter & Energy' THEN 20
    ELSE 20 END AS out_of,
  CASE sla.sub_area_name
    WHEN 'Language Use' THEN 'EE' WHEN 'Composition Writing' THEN 'EE' WHEN 'Reading' THEN 'EE'
    WHEN 'Numbers' THEN 'EE' WHEN 'Algebra' THEN 'EE' WHEN 'Geometry' THEN 'EE' WHEN 'Measurement' THEN 'EE'
    WHEN 'Scientific Investigation' THEN 'EE' WHEN 'Living Things' THEN 'EE' WHEN 'Matter & Energy' THEN 'EE'
    ELSE 'EE' END AS level,
  'TCHWX002'
FROM exam_sessions es
  JOIN sub_learning_areas sla ON sla.area_id IN (
    SELECT area_id FROM learning_areas WHERE school_id = @SID AND area_name IN ('English','Mathematics','Science')
  )
WHERE es.school_id = @SID AND es.exam_name = 'End Term 1 2026'
  AND sla.sub_area_name IN ('Language Use','Composition Writing','Reading',
    'Numbers','Algebra','Geometry','Measurement',
    'Scientific Investigation','Living Things','Matter & Energy');

-- -------------------------------------------------------
-- 3j. ATTENDANCE (last 5 school days for Grade 6)
--     Uses hardcoded dates relative to a known week
-- -------------------------------------------------------
INSERT IGNORE INTO attendance_logs (student_id, teacher_id, attendance_date, status, marked_at, synced_at)
SELECT sub.student_id, 'TCHWX002', sub.att_date, sub.status,
  CONCAT(sub.att_date, ' ', sub.mtime) AS marked_at, NOW()
FROM (
  SELECT 'STU000011' AS student_id, '2026-09-01' AS att_date, 'Present' AS status, '07:35:00' AS mtime
  UNION ALL SELECT 'STU000011', '2026-09-02', 'Present', '07:42:00'
  UNION ALL SELECT 'STU000011', '2026-09-03', 'Absent',  NULL
  UNION ALL SELECT 'STU000012', '2026-09-01', 'Present', '07:38:00'
  UNION ALL SELECT 'STU000012', '2026-09-02', 'Present', '07:40:00'
  UNION ALL SELECT 'STU000012', '2026-09-03', 'Present', '07:32:00'
) sub;

-- -------------------------------------------------------
-- 3k. FEE STRUCTURES
-- -------------------------------------------------------
INSERT IGNORE INTO fee_structures (school_id, fee_name, amount, term, academic_year)
VALUES
  (@SID, 'Tuition Fee',  5000, 'Term 1', @YEAR),
  (@SID, 'Activity Fee', 500,  'Term 1', @YEAR),
  (@SID, 'Lunch Fee',    1500, 'Term 1', @YEAR);

-- -------------------------------------------------------
-- 3l. DEMO PAYMENT
-- -------------------------------------------------------
INSERT IGNORE INTO payment_ledger
  (transaction_reference, amount, parent_phone, student_reference, payment_method, school_id, term, academic_year, logged_at)
VALUES
  ('DEMO-PAY-001', 5000, @PHONE, 'STU000001', 'M-Pesa', @SID, 'Term 1', @YEAR, DATE_SUB(NOW(), INTERVAL 3 DAY));

-- -------------------------------------------------------
-- 3m. SCHOOL TERMS (Term 1-3 for 2026)
-- -------------------------------------------------------
INSERT IGNORE INTO school_terms (school_id, term_name, start_date, end_date, academic_year)
VALUES
  (@SID, 'Term 1', '2026-01-06', '2026-04-04', @YEAR),
  (@SID, 'Term 2', '2026-05-04', '2026-08-07', @YEAR),
  (@SID, 'Term 3', '2026-09-07', '2026-11-20', @YEAR);

-- -------------------------------------------------------
-- 3n. RUBRIC CONFIG (CBC levels)
-- -------------------------------------------------------
INSERT IGNORE INTO school_rubric_config (school_id, level_code, min_percent, label, color)
VALUES
  (@SID, 'EE', 80, 'Exceeding Expectations',      '#2E7D32'),
  (@SID, 'ME', 60, 'Meeting Expectations',        '#1565C0'),
  (@SID, 'AE', 40, 'Approaching Expectations',    '#E65100'),
  (@SID, 'BE', 0,  'Below Expectations',          '#C62828');

-- ============================================================
-- DONE
-- ============================================================
SELECT 'Seed complete. School DEM000001 (Greenfield Academy) ready.' AS status;
SELECT teacher_id, full_name, email, role FROM teachers WHERE school_id = @SID;
SELECT COUNT(*) AS student_count FROM students WHERE school_id = @SID;
SELECT COUNT(*) AS class_count FROM classes WHERE school_id = @SID;
SELECT COUNT(*) AS area_count FROM learning_areas WHERE school_id = @SID;
SELECT COUNT(*) AS exam_score_count FROM exam_results er JOIN exam_sessions es ON er.session_id=es.session_id WHERE es.school_id = @SID;
