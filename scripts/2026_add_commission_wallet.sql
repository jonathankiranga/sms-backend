-- ============================================================
-- Commission Wallet System
-- Each sales rep has a wallet. Commission payouts credit it.
-- Withdrawal requests debit it via M-Pesa STK push.
-- ============================================================

CREATE TABLE IF NOT EXISTS rep_wallets (
  wallet_id     INT           AUTO_INCREMENT PRIMARY KEY,
  rep_id        VARCHAR(20)   NOT NULL UNIQUE,
  balance       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_credited DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  total_withdrawn DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  updated_at    DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (rep_id) REFERENCES sales_reps(rep_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wallet_transactions (
  txn_id        INT           AUTO_INCREMENT PRIMARY KEY,
  rep_id        VARCHAR(20)   NOT NULL,
  txn_type      ENUM('credit','debit') NOT NULL,
  amount        DECIMAL(10,2) NOT NULL,
  balance_after DECIMAL(10,2) NOT NULL,
  description   VARCHAR(255)  NOT NULL,
  reference_id  VARCHAR(100)  NULL,  -- payment_id or withdrawal_id
  reference_type VARCHAR(50)  NULL,  -- 'commission_payment' or 'withdrawal'
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rep_id) REFERENCES sales_reps(rep_id) ON DELETE CASCADE,
  INDEX idx_rep_id (rep_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wallet_withdrawals (
  withdrawal_id INT           AUTO_INCREMENT PRIMARY KEY,
  rep_id        VARCHAR(20)   NOT NULL,
  amount        DECIMAL(10,2) NOT NULL,
  status        ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
  mpesa_phone   VARCHAR(20)   NOT NULL,
  mpesa_reference VARCHAR(100) NULL,
  checkout_request_id VARCHAR(100) NULL,
  failure_reason TEXT         NULL,
  requested_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  completed_at  DATETIME      NULL,
  FOREIGN KEY (rep_id) REFERENCES sales_reps(rep_id) ON DELETE CASCADE,
  INDEX idx_rep_id (rep_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
