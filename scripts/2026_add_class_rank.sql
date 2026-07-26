-- Add class_rank column so classes can be ordered for promotion
ALTER TABLE classes ADD COLUMN IF NOT EXISTS class_rank INT NULL;

-- Note: Populate class_rank per-school using a mapping appropriate to your school.
-- Example:
-- UPDATE classes
-- SET class_rank = CASE
--   WHEN class_name = 'Kindergarten' THEN 0
--   WHEN class_name = 'Grade 1' THEN 1
--   WHEN class_name = 'Grade 2' THEN 2
--   WHEN class_name = 'Grade 3' THEN 3
--   WHEN class_name = 'Grade 4' THEN 4
--   ELSE NULL
-- END
-- WHERE school_id = 'SCHOOL123';

-- You should run per-school mappings to ensure ranks are correct before running promotions.
