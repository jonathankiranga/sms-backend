-- Fee Structure Module
-- Run after CBC migration

CREATE TABLE IF NOT EXISTS fee_structures (
  fee_id INT PRIMARY KEY AUTO_INCREMENT,
  school_id CHAR(9) NOT NULL,
  fee_name VARCHAR(100) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  term ENUM('Term 1','Term 2','Term 3') NOT NULL,
  academic_year YEAR NOT NULL,
  is_optional BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_assignments (
  assignment_id INT PRIMARY KEY AUTO_INCREMENT,
  fee_id INT NOT NULL,
  class_id INT,
  student_id CHAR(9),
  adjusted_amount DECIMAL(10,2),
  waived BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (fee_id) REFERENCES fee_structures(fee_id),
  FOREIGN KEY (class_id) REFERENCES classes(class_id),
  FOREIGN KEY (student_id) REFERENCES students(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
