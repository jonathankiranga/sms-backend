CREATE TABLE IF NOT EXISTS school_terms (
  id INT PRIMARY KEY AUTO_INCREMENT,
  school_id CHAR(9) NOT NULL,
  term_name VARCHAR(20) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  academic_year YEAR NOT NULL,
  UNIQUE KEY uq_school_term (school_id, term_name, academic_year),
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default Kenyan terms for existing schools that have no term config
INSERT IGNORE INTO school_terms (school_id, term_name, start_date, end_date, academic_year)
SELECT s.school_id, 'Term 1', DATE(CONCAT(YEAR(CURDATE()), '-01-01')), DATE(CONCAT(YEAR(CURDATE()), '-04-30')), YEAR(CURDATE())
FROM schools s
WHERE NOT EXISTS (SELECT 1 FROM school_terms t WHERE t.school_id = s.school_id AND t.academic_year = YEAR(CURDATE()));

INSERT IGNORE INTO school_terms (school_id, term_name, start_date, end_date, academic_year)
SELECT s.school_id, 'Term 2', DATE(CONCAT(YEAR(CURDATE()), '-05-01')), DATE(CONCAT(YEAR(CURDATE()), '-08-31')), YEAR(CURDATE())
FROM schools s
WHERE NOT EXISTS (SELECT 1 FROM school_terms t WHERE t.school_id = s.school_id AND t.academic_year = YEAR(CURDATE()));

INSERT IGNORE INTO school_terms (school_id, term_name, start_date, end_date, academic_year)
SELECT s.school_id, 'Term 3', DATE(CONCAT(YEAR(CURDATE()), '-09-01')), DATE(CONCAT(YEAR(CURDATE()), '-12-31')), YEAR(CURDATE())
FROM schools s
WHERE NOT EXISTS (SELECT 1 FROM school_terms t WHERE t.school_id = s.school_id AND t.academic_year = YEAR(CURDATE()));
