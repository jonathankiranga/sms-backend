-- Terms acceptance tracking for headteachers.
-- Records which version of the Terms & Conditions each headteacher has accepted
-- and when. Login to the Headteacher Portal is blocked until the current
-- version has been accepted.

CREATE TABLE IF NOT EXISTS terms_acceptance (
  teacher_id   VARCHAR(40)  NOT NULL,
  version      VARCHAR(20)  NOT NULL,
  accepted_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip_address   VARCHAR(45)  NULL,
  PRIMARY KEY (teacher_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;