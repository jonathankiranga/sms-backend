-- Create promotion_history table to record promotions and graduations (INSERT-only for graduations)
CREATE TABLE IF NOT EXISTS promotion_history (
  promotion_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  student_id CHAR(9) NOT NULL,
  from_class_id INT,
  to_class_id INT NULL,
  action ENUM('Promoted','Graduated') NOT NULL,
  performed_by CHAR(9) NULL,
  performed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  note TEXT NULL,
  INDEX (student_id),
  INDEX (performed_by),
  FOREIGN KEY (student_id) REFERENCES students(student_id),
  FOREIGN KEY (from_class_id) REFERENCES classes(class_id),
  FOREIGN KEY (to_class_id) REFERENCES classes(class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
