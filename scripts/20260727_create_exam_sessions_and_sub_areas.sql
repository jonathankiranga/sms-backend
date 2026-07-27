CREATE TABLE IF NOT EXISTS exam_sessions (
  session_id INT AUTO_INCREMENT PRIMARY KEY,
  school_id CHAR(9) NOT NULL,
  class_id INT NOT NULL,
  term ENUM('Term 1','Term 2','Term 3') NOT NULL,
  academic_year YEAR NOT NULL,
  exam_name VARCHAR(100) NOT NULL,
  exam_type ENUM('CAT 1','CAT 2','CAT 3','Mid Term','End Term','Other') NOT NULL DEFAULT 'CAT 1',
  open_date DATE,
  close_date DATE,
  status ENUM('Scheduled','Open','Closed') NOT NULL DEFAULT 'Scheduled',
  created_by VARCHAR(50),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE,
  FOREIGN KEY (class_id) REFERENCES classes(class_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sub_learning_areas (
  sub_area_id INT AUTO_INCREMENT PRIMARY KEY,
  area_id INT NOT NULL,
  sub_area_name VARCHAR(100) NOT NULL,
  display_order INT DEFAULT 0,
  FOREIGN KEY (area_id) REFERENCES learning_areas(area_id) ON DELETE CASCADE,
  UNIQUE KEY uq_area_sub (area_id, sub_area_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS exam_results (
  result_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id CHAR(9) NOT NULL,
  sub_area_id INT NOT NULL,
  score DECIMAL(5,1) NOT NULL DEFAULT 0,
  out_of DECIMAL(5,1) NOT NULL DEFAULT 100,
  performance_level ENUM('EE','ME','AE','BE'),
  entered_by VARCHAR(50),
  entered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES exam_sessions(session_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE,
  FOREIGN KEY (sub_area_id) REFERENCES sub_learning_areas(sub_area_id) ON DELETE CASCADE,
  UNIQUE KEY uq_session_student_sub (session_id, student_id, sub_area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default sub-learning areas for common subjects (ignore if already exist)
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Language', 1 FROM learning_areas WHERE area_name = 'English';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Composition', 2 FROM learning_areas WHERE area_name = 'English';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Reading', 3 FROM learning_areas WHERE area_name = 'English';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Numbers', 1 FROM learning_areas WHERE area_name = 'Mathematics';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Algebra', 2 FROM learning_areas WHERE area_name = 'Mathematics';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Geometry', 3 FROM learning_areas WHERE area_name = 'Mathematics';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Measurement', 4 FROM learning_areas WHERE area_name = 'Mathematics';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Data', 5 FROM learning_areas WHERE area_name = 'Mathematics';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Scientific Investigation', 1 FROM learning_areas WHERE area_name = 'Science';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Living Things', 2 FROM learning_areas WHERE area_name = 'Science';
INSERT IGNORE INTO sub_learning_areas (area_id, sub_area_name, display_order)
SELECT area_id, 'Matter & Energy', 3 FROM learning_areas WHERE area_name = 'Science';
