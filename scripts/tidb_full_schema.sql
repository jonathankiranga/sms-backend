-- ============================================================
-- FreeSchool — Full TiDB Cloud Schema
-- Run once against a fresh database:
--   mysql -u 'sdDXWmBQaen2i6n.root' \
--         -h gateway01.ap-southeast-1.prod.aws.tidbcloud.com \
--         -P 4000 -D 'freeschool' \
--         --ssl-mode=VERIFY_IDENTITY --ssl-ca=<CA_PATH> \
--         -p'lpw5un07fubKcMuC' < tidb_full_schema.sql
--
-- TiDB notes:
--   • Foreign keys are parsed but not enforced (Vitess-based)
--   • No PREPARE/EXECUTE conditional DDL — all columns included upfront
--   • No ADD COLUMN IF NOT EXISTS — handled by full CREATE TABLE
--   • No FROM DUAL — removed from INSERT...SELECT
-- ============================================================

-- ── CORE TABLES ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schools (
  school_id            CHAR(9)       PRIMARY KEY,
  school_name          VARCHAR(120)  NOT NULL,
  region               VARCHAR(100)  NULL,
  contact_name         VARCHAR(120)  NULL,
  contact_phone        VARCHAR(20)   NULL,
  contact_email        VARCHAR(120)  NULL,
  contact_address      TEXT          NULL,
  contact_website      VARCHAR(255)  NULL,
  mpesa_consumer_key   VARCHAR(100)  NULL,
  mpesa_consumer_secret VARCHAR(255) NULL,
  mpesa_paybill        VARCHAR(20)   NULL,
  mpesa_passkey        VARCHAR(255)  NULL,
  mpesa_environment    VARCHAR(20)   DEFAULT 'sandbox',
  premium_payment_model        ENUM('school','parent') NOT NULL DEFAULT 'parent',
  premium_fee_per_term         DECIMAL(10,2)           NULL,
  premium_payment_model_locked TINYINT(1)              NOT NULL DEFAULT 0,
  created_at           DATETIME      DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS school_report_settings (
  school_id              CHAR(9)      PRIMARY KEY,
  template_name          VARCHAR(80)  NOT NULL DEFAULT 'Default Report',
  show_teacher_name      BOOLEAN      NOT NULL DEFAULT TRUE,
  show_teacher_signature BOOLEAN      NOT NULL DEFAULT TRUE,
  show_final_remarks     BOOLEAN      NOT NULL DEFAULT TRUE,
  show_recommendation    BOOLEAN      NOT NULL DEFAULT TRUE,
  teacher_name           VARCHAR(120) NULL,
  teacher_signature      VARCHAR(255) NULL,
  final_remarks          TEXT         NULL,
  recommendation_text    TEXT         NULL,
  layout_json            JSON         NULL,
  created_at             DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS classes (
  class_id       INT          PRIMARY KEY AUTO_INCREMENT,
  school_id      CHAR(9)      NOT NULL,
  class_name     VARCHAR(50)  NOT NULL,
  stream         VARCHAR(50)  NULL,
  level_name     VARCHAR(20)  NULL,
  academic_year  YEAR         NOT NULL,
  class_rank     INT          NULL,
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS teachers (
  teacher_id      CHAR(9)      PRIMARY KEY,
  full_name       VARCHAR(100) NOT NULL,
  phone           VARCHAR(20)  UNIQUE NOT NULL,
  email           VARCHAR(120) UNIQUE NULL,
  role            ENUM('teacher','head') DEFAULT 'teacher',
  school_id       CHAR(9)      NOT NULL,
  subjects_taught JSON         NULL,
  push_subscription JSON       NULL,
  password_hash   VARCHAR(255) NULL,
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS students (
  student_id           CHAR(9)      PRIMARY KEY,
  full_name            VARCHAR(100) NOT NULL,
  class_id             INT          NOT NULL,
  school_id            CHAR(9)      NOT NULL,
  enrollment_status    ENUM('Active','Graduated','Transferred') DEFAULT 'Active',
  date_of_birth        DATE         NULL,
  gender               ENUM('Male','Female') NULL,
  admission_number     VARCHAR(20)  NULL,
  admission_date       DATE         NULL,
  guardian_name        VARCHAR(100) NULL,
  guardian_phone       VARCHAR(20)  NULL,
  guardian_relationship VARCHAR(30) NULL,
  address              VARCHAR(200) NULL,
  religion             VARCHAR(50)  NULL,
  nationality          VARCHAR(50)  NULL,
  medical_notes        TEXT         NULL,
  special_needs        TEXT         NULL,
  previous_school      VARCHAR(100) NULL,
  FOREIGN KEY (class_id)  REFERENCES classes(class_id),
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS parent_profiles (
  parent_phone       VARCHAR(20)  PRIMARY KEY,
  full_name          VARCHAR(100) NULL,
  is_premium         BOOLEAN      DEFAULT FALSE,
  premium_expires_at DATETIME     NULL,
  created_at         DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS student_parent_map (
  student_id   CHAR(9)     NOT NULL,
  parent_phone VARCHAR(20) NOT NULL,
  relationship VARCHAR(30) NULL,
  PRIMARY KEY (student_id, parent_phone),
  FOREIGN KEY (student_id)   REFERENCES students(student_id),
  FOREIGN KEY (parent_phone) REFERENCES parent_profiles(parent_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS otp_sessions (
  session_id VARCHAR(64)  PRIMARY KEY,
  phone      VARCHAR(20)  NOT NULL,
  email      VARCHAR(120) NULL,
  code       CHAR(4)      NOT NULL,
  expires_at DATETIME     NOT NULL,
  verified   BOOLEAN      DEFAULT FALSE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attendance_logs (
  log_id          BIGINT   PRIMARY KEY AUTO_INCREMENT,
  student_id      CHAR(9)  NOT NULL,
  teacher_id      CHAR(9)  NOT NULL,
  attendance_date DATE     NOT NULL,
  status          ENUM('Present','Absent','Late','Excused') NOT NULL,
  marked_at       DATETIME NULL,
  synced_at       DATETIME NULL,
  UNIQUE KEY uq_student_date (student_id, attendance_date),
  FOREIGN KEY (student_id)  REFERENCES students(student_id),
  FOREIGN KEY (teacher_id)  REFERENCES teachers(teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── CBC ASSESSMENT ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS learning_areas (
  area_id    INT         PRIMARY KEY AUTO_INCREMENT,
  school_id  CHAR(9)     NOT NULL,
  level_name VARCHAR(20) NOT NULL,
  area_name  VARCHAR(80) NOT NULL,
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS strands (
  strand_id   INT          PRIMARY KEY AUTO_INCREMENT,
  area_id     INT          NOT NULL,
  strand_name VARCHAR(100) NOT NULL,
  term        ENUM('Term 1','Term 2','Term 3') NOT NULL,
  FOREIGN KEY (area_id) REFERENCES learning_areas(area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sub_strands (
  sub_strand_id   INT          PRIMARY KEY AUTO_INCREMENT,
  strand_id       INT          NOT NULL,
  sub_strand_name VARCHAR(100) NOT NULL,
  FOREIGN KEY (strand_id) REFERENCES strands(strand_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS assessments (
  assessment_id   INT          PRIMARY KEY AUTO_INCREMENT,
  sub_strand_id   INT          NOT NULL,
  assessment_name VARCHAR(120) NOT NULL,
  max_score       DECIMAL(5,1) DEFAULT 100,
  date            DATE         NULL,
  type            ENUM('Formative','Summative','Practical') DEFAULT 'Formative',
  class_id        INT          NOT NULL,
  teacher_id      CHAR(9)      NOT NULL,
  FOREIGN KEY (sub_strand_id) REFERENCES sub_strands(sub_strand_id),
  FOREIGN KEY (class_id)      REFERENCES classes(class_id),
  FOREIGN KEY (teacher_id)    REFERENCES teachers(teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS assessment_results (
  result_id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
  assessment_id     INT          NOT NULL,
  student_id        CHAR(9)      NOT NULL,
  score             DECIMAL(5,1) NULL,
  performance_level ENUM('EE','ME','AE','BE') NULL,
  UNIQUE KEY uq_student_assessment (student_id, assessment_id),
  FOREIGN KEY (assessment_id) REFERENCES assessments(assessment_id),
  FOREIGN KEY (student_id)    REFERENCES students(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS core_competencies (
  competency_id   INT          PRIMARY KEY AUTO_INCREMENT,
  competency_name VARCHAR(100) NOT NULL,
  category        ENUM('competency','value') NOT NULL,
  description     TEXT         NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS student_competency_ratings (
  rating_id     BIGINT   PRIMARY KEY AUTO_INCREMENT,
  student_id    CHAR(9)  NOT NULL,
  term          VARCHAR(20) NOT NULL,
  competency_id INT      NOT NULL,
  rating        ENUM('EE','ME','AE','BE') NOT NULL,
  teacher_id    CHAR(9)  NULL,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_term_competency (student_id, term, competency_id),
  FOREIGN KEY (student_id)    REFERENCES students(student_id),
  FOREIGN KEY (competency_id) REFERENCES core_competencies(competency_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lesson_plans (
  plan_id                INT      PRIMARY KEY AUTO_INCREMENT,
  teacher_id             CHAR(9)  NOT NULL,
  school_id              CHAR(9)  NOT NULL,
  class_id               INT      NOT NULL,
  area_id                INT      NOT NULL,
  strand_id              INT      NULL,
  sub_strand_id          INT      NULL,
  week_number            INT      NOT NULL DEFAULT 1,
  term                   VARCHAR(20) NOT NULL DEFAULT 'Term 1',
  lesson_date            DATE     NULL,
  duration_minutes       INT      NULL DEFAULT 40,
  learning_objectives    TEXT     NULL,
  resources              TEXT     NULL,
  introduction_activities TEXT    NULL,
  main_activities        TEXT     NULL,
  assessment_method      TEXT     NULL,
  remarks                TEXT     NULL,
  created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id)    REFERENCES teachers(teacher_id),
  FOREIGN KEY (school_id)     REFERENCES schools(school_id),
  FOREIGN KEY (class_id)      REFERENCES classes(class_id),
  FOREIGN KEY (area_id)       REFERENCES learning_areas(area_id),
  FOREIGN KEY (strand_id)     REFERENCES strands(strand_id),
  FOREIGN KEY (sub_strand_id) REFERENCES sub_strands(sub_strand_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── EXAM SESSIONS ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exam_sessions (
  session_id    INT          PRIMARY KEY AUTO_INCREMENT,
  school_id     CHAR(9)      NOT NULL,
  class_id      INT          NOT NULL,
  term          ENUM('Term 1','Term 2','Term 3') NOT NULL,
  academic_year YEAR         NOT NULL,
  exam_name     VARCHAR(100) NOT NULL,
  exam_type     ENUM('CAT 1','CAT 2','CAT 3','Mid Term','End Term','Other') NOT NULL DEFAULT 'CAT 1',
  open_date     DATE         NULL,
  close_date    DATE         NULL,
  status        ENUM('Scheduled','Open','Closed') NOT NULL DEFAULT 'Scheduled',
  created_by    VARCHAR(50)  NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(school_id),
  FOREIGN KEY (class_id)  REFERENCES classes(class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sub_learning_areas (
  sub_area_id   INT          PRIMARY KEY AUTO_INCREMENT,
  area_id       INT          NOT NULL,
  sub_area_name VARCHAR(100) NOT NULL,
  display_order INT          DEFAULT 0,
  UNIQUE KEY uq_area_sub (area_id, sub_area_name),
  FOREIGN KEY (area_id) REFERENCES learning_areas(area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS exam_results (
  result_id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
  session_id        INT          NOT NULL,
  student_id        CHAR(9)      NOT NULL,
  sub_area_id       INT          NOT NULL,
  score             DECIMAL(5,1) NOT NULL DEFAULT 0,
  out_of            DECIMAL(5,1) NOT NULL DEFAULT 100,
  performance_level ENUM('EE','ME','AE','BE') NULL,
  entered_by        VARCHAR(50)  NULL,
  entered_at        DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_session_student_sub (session_id, student_id, sub_area_id),
  FOREIGN KEY (session_id)  REFERENCES exam_sessions(session_id),
  FOREIGN KEY (student_id)  REFERENCES students(student_id),
  FOREIGN KEY (sub_area_id) REFERENCES sub_learning_areas(sub_area_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── FEES ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fee_structures (
  fee_id        INT          PRIMARY KEY AUTO_INCREMENT,
  school_id     CHAR(9)      NOT NULL,
  fee_name      VARCHAR(100) NOT NULL,
  amount        DECIMAL(10,2) NOT NULL,
  term          ENUM('Term 1','Term 2','Term 3') NOT NULL,
  academic_year YEAR         NOT NULL,
  is_optional   BOOLEAN      DEFAULT FALSE,
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_assignments (
  assignment_id   INT           PRIMARY KEY AUTO_INCREMENT,
  fee_id          INT           NOT NULL,
  class_id        INT           NULL,
  student_id      CHAR(9)       NULL,
  adjusted_amount DECIMAL(10,2) NULL,
  waived          BOOLEAN       DEFAULT FALSE,
  FOREIGN KEY (fee_id)     REFERENCES fee_structures(fee_id),
  FOREIGN KEY (class_id)   REFERENCES classes(class_id),
  FOREIGN KEY (student_id) REFERENCES students(student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_ledger (
  txn_id                BIGINT        PRIMARY KEY AUTO_INCREMENT,
  transaction_reference VARCHAR(100)  NOT NULL,
  amount                DECIMAL(10,2) NOT NULL,
  parent_phone          VARCHAR(20)   NOT NULL,
  student_reference     VARCHAR(100)  NULL,
  payment_method        VARCHAR(20)   NULL,
  school_id             CHAR(9)       NULL,
  term                  VARCHAR(20)   NULL,
  academic_year         YEAR          NULL,
  recorded_by           VARCHAR(100)  NULL,
  notes                 TEXT          NULL,
  reversed_at           DATETIME      NULL,
  reversed_by           VARCHAR(100)  NULL,
  logged_at             DATETIME      DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_transaction_reference (transaction_reference),
  FOREIGN KEY (parent_phone) REFERENCES parent_profiles(parent_phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── PREMIUM SUBSCRIPTIONS ────────────────────────────────────

CREATE TABLE IF NOT EXISTS premium_bulk_payments (
  payment_id            INT          PRIMARY KEY AUTO_INCREMENT,
  school_id             CHAR(9)      NOT NULL,
  term                  VARCHAR(10)  NOT NULL,
  year                  YEAR         NOT NULL,
  amount                DECIMAL(10,2) NOT NULL,
  total_students        INT          NOT NULL DEFAULT 0,
  transaction_reference VARCHAR(50)  NULL,
  payment_status        ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  initiated_by_phone    VARCHAR(20)  NULL,
  paid_at               DATETIME     NULL,
  created_at            DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS premium_subscriptions (
  subscription_id INT          PRIMARY KEY AUTO_INCREMENT,
  school_id       CHAR(9)      NOT NULL,
  parent_phone    VARCHAR(20)  NOT NULL,
  term            VARCHAR(10)  NOT NULL,
  year            YEAR         NOT NULL,
  payment_model   ENUM('school','parent') NOT NULL DEFAULT 'parent',
  payment_status  ENUM('paid','pending','free') NOT NULL DEFAULT 'pending',
  amount          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  activated_at    DATETIME     NULL,
  expires_at      DATETIME     NULL,
  created_at      DATETIME     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_school_parent_term (school_id, parent_phone, term, year),
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── SCHOOL CONFIG ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS school_rubric_config (
  id          INT          PRIMARY KEY AUTO_INCREMENT,
  school_id   CHAR(9)      NOT NULL,
  level_code  VARCHAR(10)  NOT NULL,
  min_percent DECIMAL(5,1) NOT NULL,
  label       VARCHAR(50)  NOT NULL,
  color       VARCHAR(7)   NOT NULL DEFAULT '#333333',
  UNIQUE KEY uq_school_level (school_id, level_code),
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS school_terms (
  id            INT         PRIMARY KEY AUTO_INCREMENT,
  school_id     CHAR(9)     NOT NULL,
  term_name     VARCHAR(20) NOT NULL,
  start_date    DATE        NOT NULL,
  end_date      DATE        NOT NULL,
  academic_year YEAR        NOT NULL,
  UNIQUE KEY uq_school_term (school_id, term_name, academic_year),
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS school_streams (
  stream_id     INT         PRIMARY KEY AUTO_INCREMENT,
  school_id     CHAR(9)     NOT NULL,
  stream_name   VARCHAR(50) NOT NULL,
  display_order INT         DEFAULT 0,
  UNIQUE KEY uq_school_stream (school_id, stream_name),
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS student_id_sequences (
  school_id CHAR(9)     PRIMARY KEY,
  next_id   INT         NOT NULL DEFAULT 1,
  prefix    VARCHAR(10) NOT NULL DEFAULT 'STU',
  FOREIGN KEY (school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── MERCHANTS & ADS ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS merchants (
  merchant_id   CHAR(9)      PRIMARY KEY,
  business_name VARCHAR(120) NOT NULL,
  phone         VARCHAR(20)  UNIQUE NOT NULL,
  email         VARCHAR(120) NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marketplace_campaigns (
  ad_id            INT          PRIMARY KEY AUTO_INCREMENT,
  target_school_id CHAR(9)      NOT NULL,
  merchant_name    VARCHAR(100) NOT NULL,
  merchant_phone   VARCHAR(20)  NULL,
  message          TEXT         NULL,
  banner_image_url VARCHAR(2048) NOT NULL,
  target_link      VARCHAR(2048) NOT NULL,
  status           ENUM('Active','Paused','Expired') DEFAULT 'Active',
  start_date       DATE         NOT NULL,
  end_date         DATE         NOT NULL,
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (target_school_id) REFERENCES schools(school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── AUTH / ADMIN ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_users (
  admin_id      CHAR(9)      PRIMARY KEY,
  email         VARCHAR(120) UNIQUE NOT NULL,
  full_name     VARCHAR(120) NULL,
  password_hash VARCHAR(255) NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(64)  PRIMARY KEY,
  user_type  ENUM('admin','teacher') NOT NULL,
  user_id    VARCHAR(120) NOT NULL,
  expires_at DATETIME     NOT NULL,
  revoked    BOOLEAN      DEFAULT FALSE,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS password_resets (
  token      VARCHAR(128) PRIMARY KEY,
  user_type  ENUM('admin','teacher') NOT NULL,
  user_id    VARCHAR(120) NULL,
  email      VARCHAR(120) NULL,
  expires_at DATETIME     NOT NULL,
  used       BOOLEAN      DEFAULT FALSE,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── MISC ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(50)  PRIMARY KEY,
  setting_value VARCHAR(255) NOT NULL,
  updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sync_log (
  sync_id         BIGINT   PRIMARY KEY AUTO_INCREMENT,
  teacher_id      CHAR(9)  NOT NULL,
  device_batch_id VARCHAR(64) NOT NULL,
  records_count   INT      NOT NULL,
  synced_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS promotion_history (
  promotion_id  BIGINT   PRIMARY KEY AUTO_INCREMENT,
  student_id    CHAR(9)  NOT NULL,
  from_class_id INT      NULL,
  to_class_id   INT      NULL,
  action        ENUM('Promoted','Graduated') NOT NULL,
  performed_by  CHAR(9)  NULL,
  performed_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  note          TEXT     NULL,
  INDEX idx_promotion_student (student_id),
  INDEX idx_promotion_performed_by (performed_by),
  FOREIGN KEY (student_id)    REFERENCES students(student_id),
  FOREIGN KEY (from_class_id) REFERENCES classes(class_id),
  FOREIGN KEY (to_class_id)   REFERENCES classes(class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS migrations_history (
  name       VARCHAR(255) PRIMARY KEY,
  applied_at DATETIME     NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── SEED DATA ────────────────────────────────────────────────

INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES
  ('premium_price',   '100'),
  ('merchant_7_day',  '200'),
  ('merchant_14_day', '350'),
  ('merchant_30_day', '500'),
  ('merchant_90_day', '1200');

INSERT IGNORE INTO core_competencies (competency_id, competency_name, category, description) VALUES
  (1,  'Communication and Collaboration',    'competency', 'Ability to express ideas and work with others'),
  (2,  'Critical Thinking and Problem Solving','competency','Ability to analyze situations and find solutions'),
  (3,  'Creativity and Imagination',          'competency', 'Ability to generate new ideas and innovate'),
  (4,  'Citizenship',                         'competency', 'Understanding of rights, responsibilities and community'),
  (5,  'Digital Literacy',                    'competency', 'Ability to use technology effectively and responsibly'),
  (6,  'Learning to Learn',                   'competency', 'Ability to reflect on and manage own learning'),
  (7,  'Self-efficacy',                       'competency', 'Belief in own ability to succeed and persevere'),
  (8,  'Love',        'value', 'Showing care and affection towards others'),
  (9,  'Responsibility','value','Being accountable for own actions and duties'),
  (10, 'Respect',     'value', 'Showing regard for others, self and property'),
  (11, 'Unity',       'value', 'Working together harmoniously'),
  (12, 'Peace',       'value', 'Promoting harmony and resolving conflicts'),
  (13, 'Patriotism',  'value', 'Love and loyalty to one''s country'),
  (14, 'Integrity',   'value', 'Being honest and upholding moral principles');
