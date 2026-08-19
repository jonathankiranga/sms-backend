-- Sales reps commission support
ALTER TABLE sales_reps
  ADD COLUMN commission_type ENUM('percent', 'flat') NOT NULL DEFAULT 'percent',
  ADD COLUMN commission_value DECIMAL(10, 2) NOT NULL DEFAULT 0;