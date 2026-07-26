-- Migration: add password authentication and sessions for teachers and admin

-- 1) Add password_hash to teachers
ALTER TABLE teachers
  ADD COLUMN password_hash VARCHAR(255) NULL;

-- 2) Create admin_users table
CREATE TABLE IF NOT EXISTS admin_users (
  admin_id CHAR(9) PRIMARY KEY,
  email VARCHAR(120) UNIQUE NOT NULL,
  full_name VARCHAR(120),
  password_hash VARCHAR(255) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Sessions table (for admin and teacher sessions)
CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(64) PRIMARY KEY,
  user_type ENUM('admin','teacher') NOT NULL,
  user_id VARCHAR(120) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Password reset tokens
CREATE TABLE IF NOT EXISTS password_resets (
  token VARCHAR(128) PRIMARY KEY,
  user_type ENUM('admin','teacher') NOT NULL,
  user_id VARCHAR(120),
  email VARCHAR(120),
  expires_at DATETIME NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5) Optional: create an initial admin row if desired. NOTE: set a real password_hash later via password reset or by setting ADMIN_PASSWORD and hashing it.
-- INSERT INTO admin_users (admin_id, email, full_name) VALUES ('ADM000001', 'jonathankiranga@gmail.com', 'Default Admin');

-- Notes:
-- * Apply this migration file in your dev/staging/prod environments in that order.
-- * After applying, run the password reset flow to set an initial admin password safely.
