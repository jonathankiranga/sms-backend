-- ============================================================
-- Commission Payment System
-- Tracks commission payment requests, approvals, and audit trail
-- ============================================================

CREATE TABLE IF NOT EXISTS commission_payments (
  payment_id    INT           AUTO_INCREMENT PRIMARY KEY,
  rep_id        VARCHAR(20)   NOT NULL,
  term          VARCHAR(10)   NOT NULL,
  year          YEAR          NOT NULL,
  commission_amount  DECIMAL(10,2) NOT NULL,
  revenue_base  DECIMAL(10,2) NOT NULL,
  payment_status ENUM('pending','approved','rejected','paid','failed') NOT NULL DEFAULT 'pending',
  request_notes TEXT          NULL,
  approved_by   VARCHAR(100)  NULL,
  approved_at   DATETIME      NULL,
  rejection_reason TEXT       NULL,
  payment_reference VARCHAR(50) NULL,
  paid_at       DATETIME      NULL,
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (rep_id) REFERENCES sales_reps(rep_id) ON DELETE CASCADE,
  UNIQUE KEY uq_rep_term_year (rep_id, term, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS commission_calculations (
  calculation_id INT          AUTO_INCREMENT PRIMARY KEY,
  rep_id        VARCHAR(20)   NOT NULL,
  school_id     CHAR(9)       NOT NULL,
  term          VARCHAR(10)   NOT NULL,
  year          YEAR          NOT NULL,
  revenue_amount DECIMAL(10,2) NOT NULL,
  commission_type ENUM('percent','flat') NOT NULL,
  commission_value DECIMAL(10,2) NOT NULL,
  calculated_commission DECIMAL(10,2) NOT NULL,
  calculated_at DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rep_id) REFERENCES sales_reps(rep_id) ON DELETE CASCADE,
  FOREIGN KEY (school_id) REFERENCES schools(school_id) ON DELETE CASCADE,
  INDEX idx_rep_term_year (rep_id, term, year),
  INDEX idx_school_term_year (school_id, term, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS commission_audit_log (
  log_id        INT           AUTO_INCREMENT PRIMARY KEY,
  action_type   ENUM('calculated','requested','approved','rejected','paid','failed') NOT NULL,
  payment_id    INT           NULL,
  rep_id        VARCHAR(20)   NOT NULL,
  term          VARCHAR(10)   NOT NULL,
  year          YEAR          NOT NULL,
  performed_by  VARCHAR(100)  NULL,
  details       JSON          NULL,
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rep (rep_id),
  INDEX idx_payment (payment_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
