CREATE TABLE IF NOT EXISTS core_competencies (
  competency_id INT PRIMARY KEY AUTO_INCREMENT,
  competency_name VARCHAR(100) NOT NULL,
  category ENUM('competency','value') NOT NULL,
  description TEXT NULL
);

INSERT IGNORE INTO core_competencies (competency_id, competency_name, category, description) VALUES
(1, 'Communication and Collaboration', 'competency', 'Ability to express ideas and work with others'),
(2, 'Critical Thinking and Problem Solving', 'competency', 'Ability to analyze situations and find solutions'),
(3, 'Creativity and Imagination', 'competency', 'Ability to generate new ideas and innovate'),
(4, 'Citizenship', 'competency', 'Understanding of rights, responsibilities and community'),
(5, 'Digital Literacy', 'competency', 'Ability to use technology effectively and responsibly'),
(6, 'Learning to Learn', 'competency', 'Ability to reflect on and manage own learning'),
(7, 'Self-efficacy', 'competency', 'Belief in own ability to succeed and persevere'),
(8, 'Love', 'value', 'Showing care and affection towards others'),
(9, 'Responsibility', 'value', 'Being accountable for own actions and duties'),
(10, 'Respect', 'value', 'Showing regard for others, self and property'),
(11, 'Unity', 'value', 'Working together harmoniously'),
(12, 'Peace', 'value', 'Promoting harmony and resolving conflicts'),
(13, 'Patriotism', 'value', 'Love and loyalty to one''s country'),
(14, 'Integrity', 'value', 'Being honest and upholding moral principles');

CREATE TABLE IF NOT EXISTS student_competency_ratings (
  rating_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  student_id CHAR(9) NOT NULL,
  term VARCHAR(20) NOT NULL,
  competency_id INT NOT NULL,
  rating ENUM('EE','ME','AE','BE') NOT NULL,
  teacher_id CHAR(9) NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_term_competency (student_id, term, competency_id),
  FOREIGN KEY (student_id) REFERENCES students(student_id),
  FOREIGN KEY (competency_id) REFERENCES core_competencies(competency_id)
);
