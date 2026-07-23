-- CBC Assessment Module — replaces old subjects + grades tables
-- Run: mysql -h YOUR_HOST -P 19518 -u avnadmin -p defaultdb --ssl-mode=REQUIRED < migration_cbc.sql

DROP TABLE IF EXISTS assessment_results;
DROP TABLE IF EXISTS assessments;
DROP TABLE IF EXISTS sub_strands;
DROP TABLE IF EXISTS strands;
DROP TABLE IF EXISTS learning_areas;
DROP TABLE IF EXISTS grades;
DROP TABLE IF EXISTS subjects;

CREATE TABLE learning_areas (
  area_id INT PRIMARY KEY AUTO_INCREMENT,
  school_id CHAR(9) NOT NULL,
  level_name VARCHAR(20) NOT NULL,
  area_name VARCHAR(80) NOT NULL,
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE strands (
  strand_id INT PRIMARY KEY AUTO_INCREMENT,
  area_id INT NOT NULL,
  strand_name VARCHAR(100) NOT NULL,
  term ENUM('Term 1','Term 2','Term 3') NOT NULL,
  FOREIGN KEY (area_id) REFERENCES learning_areas(area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sub_strands (
  sub_strand_id INT PRIMARY KEY AUTO_INCREMENT,
  strand_id INT NOT NULL,
  sub_strand_name VARCHAR(100) NOT NULL,
  FOREIGN KEY (strand_id) REFERENCES strands(strand_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE assessments (
  assessment_id INT PRIMARY KEY AUTO_INCREMENT,
  sub_strand_id INT NOT NULL,
  assessment_name VARCHAR(120) NOT NULL,
  max_score DECIMAL(5,1) DEFAULT 100,
  date DATE,
  type ENUM('Formative','Summative','Practical') DEFAULT 'Formative',
  class_id INT NOT NULL,
  teacher_id CHAR(9) NOT NULL,
  FOREIGN KEY (sub_strand_id) REFERENCES sub_strands(sub_strand_id),
  FOREIGN KEY (class_id) REFERENCES classes(class_id),
  FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE assessment_results (
  result_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  assessment_id INT NOT NULL,
  student_id CHAR(9) NOT NULL,
  score DECIMAL(5,1),
  performance_level ENUM('EE','ME','AE','BE'),
  UNIQUE KEY uq_student_assessment (student_id, assessment_id),
  FOREIGN KEY (assessment_id) REFERENCES assessments(assessment_id),
  FOREIGN KEY (student_id) REFERENCES students(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed standard Grade 4 learning areas (use a placeholder school_id — assign per school later)
-- These are inserted per-school by the app or admin when setting up
