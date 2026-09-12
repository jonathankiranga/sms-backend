-- ============================================================================
-- Reset exam results (KICD reseed).
-- Used after the sub_strand migration to wipe old sub-area-keyed rows and let
-- the seed scripts populate clean Strand → Sub-strand results.
-- Safe to re-run.
-- ============================================================================

DELETE FROM exam_results;

ALTER TABLE exam_results AUTO_INCREMENT = 1;