CREATE TABLE IF NOT EXISTS school_rubric_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  school_id CHAR(9) NOT NULL,
  level_code VARCHAR(10) NOT NULL,
  min_percent DECIMAL(5,1) NOT NULL,
  label VARCHAR(50) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#333333',
  UNIQUE KEY uq_school_level (school_id, level_code),
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default CBC rubric for existing schools that have no config
INSERT IGNORE INTO school_rubric_config (school_id, level_code, min_percent, label, color)
SELECT s.school_id, 'EE', 80.0, 'Exceeding Expectations', '#2E7D32'
FROM schools s
WHERE NOT EXISTS (SELECT 1 FROM school_rubric_config r WHERE r.school_id = s.school_id);

INSERT IGNORE INTO school_rubric_config (school_id, level_code, min_percent, label, color)
SELECT s.school_id, 'ME', 60.0, 'Meeting Expectations', '#1565C0'
FROM schools s
WHERE NOT EXISTS (SELECT 1 FROM school_rubric_config r WHERE r.school_id = s.school_id);

INSERT IGNORE INTO school_rubric_config (school_id, level_code, min_percent, label, color)
SELECT s.school_id, 'AE', 40.0, 'Approaching Expectations', '#E65100'
FROM schools s
WHERE NOT EXISTS (SELECT 1 FROM school_rubric_config r WHERE r.school_id = s.school_id);

INSERT IGNORE INTO school_rubric_config (school_id, level_code, min_percent, label, color)
SELECT s.school_id, 'BE', 0.0, 'Below Expectations', '#C62828'
FROM schools s
WHERE NOT EXISTS (SELECT 1 FROM school_rubric_config r WHERE r.school_id = s.school_id);
