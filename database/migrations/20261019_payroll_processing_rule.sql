-- Payroll processing timing. Apply before deploying the salary-cycle rule.
CREATE TABLE IF NOT EXISTS payroll_processing_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  rule_mode ENUM('AFTER_MONTH_END','AFTER_CUTOFF') NOT NULL DEFAULT 'AFTER_MONTH_END',
  cutoff_day TINYINT UNSIGNED NOT NULL DEFAULT 25,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_payroll_cutoff_day CHECK (cutoff_day BETWEEN 1 AND 31)
);
INSERT IGNORE INTO payroll_processing_settings (id, rule_mode, cutoff_day)
VALUES (1, 'AFTER_MONTH_END', 25);
