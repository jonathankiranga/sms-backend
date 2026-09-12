-- ============================================================================
-- Migration: exam_results now scores KICD Sub-strands instead of the legacy
-- sub-learning-areas ladder (Learning Area → Strand → Sub-strand).
--
-- 1. Adds exam_results.sub_strand_id (nullable, FK → sub_strands)
-- 2. Drops the old sub_area_id column (generated FK + unique index names are
--    looked up via information_schema so the script is robust on MySQL/TiDB)
-- 3. Adds the new unique key (session_id, student_id, sub_strand_id)
--
-- NOTE: Sub-area marks cannot be mapped to sub-strands automatically, so any
-- existing rows lose their score reference. The dedicated reset script
-- (reset-exam-results.sql) clears the table afterwards so schools re-seed
-- clean KICD results. This matches the "Reset exam results, re-seed demo"
-- decision.
--
-- TiDB combines: SET @var := (SELECT ...) is supported (SELECT ... INTO @var
-- is not). Run from the repo root via: node scripts/_run_migration.js scripts/20260912_exam_results_sub_strand.sql
-- ============================================================================

SET @db := DATABASE();

-- Old FK on sub_area_id (generated name, e.g. fk_3)
SET @dropFk := (SELECT CONCAT('ALTER TABLE exam_results DROP FOREIGN KEY `', CONSTRAINT_NAME, '`')
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME   = 'exam_results'
    AND COLUMN_NAME  = 'sub_area_id'
    AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1);

-- Old unique key containing sub_area_id (e.g. uq_session_student_sub)
SET @dropIdx := (SELECT CONCAT('ALTER TABLE exam_results DROP INDEX `', INDEX_NAME, '`')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME   = 'exam_results'
    AND COLUMN_NAME  = 'sub_area_id'
    AND NON_UNIQUE   = 0
  LIMIT 1);

-- Old non-unique index that backed the FK (e.g. fk_3) — keep only if distinct
-- from the unique index above.
SET @dropIdx2 := (SELECT CONCAT('ALTER TABLE exam_results DROP INDEX `', INDEX_NAME, '`')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME   = 'exam_results'
    AND COLUMN_NAME  = 'sub_area_id'
    AND NON_UNIQUE   = 1
  LIMIT 1);

SET @sql1 := IF(@dropFk   IS NOT NULL, @dropFk,  'SELECT "no sub_area_id FK to drop"');
SET @sql2 := IF(@dropIdx  IS NOT NULL, @dropIdx, 'SELECT "no sub_area_id unique index to drop"');
SET @sql3 := IF(@dropIdx2 IS NOT NULL, @dropIdx2, 'SELECT "no sub_area_id plain index to drop"');

PREPARE stmt1 FROM @sql1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

-- Add the sub-strand column (first run adds it; second run errors — guarded)
ALTER TABLE exam_results ADD COLUMN sub_strand_id INT NULL AFTER sub_area_id;

-- Drop the obsolete sub_area_id column
ALTER TABLE exam_results DROP COLUMN sub_area_id;

-- New FK + unique key
ALTER TABLE exam_results
  ADD CONSTRAINT fk_exam_results_sub_strand
  FOREIGN KEY (sub_strand_id) REFERENCES sub_strands(sub_strand_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX uq_session_student_substrand
  ON exam_results (session_id, student_id, sub_strand_id);