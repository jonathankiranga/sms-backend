-- Migration: sales representative tracking for school onboarding
CREATE TABLE IF NOT EXISTS sales_reps (
  rep_id VARCHAR(20) PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(20) NULL,
  email VARCHAR(120) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Link schools to a sales rep
ALTER TABLE schools ADD COLUMN IF NOT EXISTS sales_rep_id VARCHAR(20) NULL AFTER region;

-- Seed a default sales rep so school creation works out of the box
INSERT IGNORE INTO sales_reps (rep_id, full_name, phone, email)
VALUES ('REP000001', 'Jonathan Kiranga', '254725999521', 'jonathankiranga@gmail.com');