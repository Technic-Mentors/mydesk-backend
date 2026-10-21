-- =========================================================
-- MyDesk Full Database Update - MySQL 8.x
-- =========================================================
-- Back up the live database and select it before importing this single file.
-- Baseline: Dump20261002 (1).sql and current backend SQL usage.
-- No production rows or tables are deleted, truncated, recreated, or reset.
-- DDL implicitly commits. Run in a maintenance window; rerun after any error.
-- Existing arbitrary incompatible table definitions cannot be repaired safely
-- by CREATE TABLE IF NOT EXISTS; known partial chat/payroll upgrades are guarded.
-- Duplicate rows cause only their optional unique key to be skipped.
-- Do not import older MyDesk migrations alongside this file.

-- 1. Session / database checks
SELECT DATABASE() AS selected_mydesk_database, VERSION() AS mysql_version;
SELECT 1 FROM tbl_users LIMIT 0;
SELECT 1 FROM notifications LIMIT 0;
SELECT 1 FROM assignedprojects LIMIT 0;
SELECT 1 FROM calendarsession LIMIT 0;
SELECT 1 FROM salarycycle LIMIT 0;
SELECT 1 FROM modules LIMIT 0;
SELECT 1 FROM access_control LIMIT 0;


-- 2. New independent and dependent tables
-- =========================================================
-- Authentication and password reset
-- =========================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_password_reset_token_hash (token_hash),
  KEY idx_password_reset_user (user_id, used_at)
);

CREATE TABLE IF NOT EXISTS password_reset_rate_limits (
  scope_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  window_started_at DATETIME NOT NULL,
  attempts INT UNSIGNED NOT NULL
);


-- =========================================================
-- Notifications and email queue
-- =========================================================

CREATE TABLE IF NOT EXISTS notification_email_outbox (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  dedupeKey VARCHAR(190) NOT NULL UNIQUE,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  bodyHtml MEDIUMTEXT NOT NULL,
  status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  lastError VARCHAR(500) NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sentAt DATETIME NULL
);

CREATE TABLE IF NOT EXISTS notification_dismissals (
  userId INT NOT NULL,
  dismissalKey VARCHAR(255) NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (userId, dismissalKey)
);


-- =========================================================
-- Chat and project conversations
-- =========================================================

CREATE TABLE IF NOT EXISTS chat_conversations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('direct','group','project') NOT NULL,
  name VARCHAR(120) NULL,
  project_id INT NULL UNIQUE,
  created_by INT NOT NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chat_created (created_at)
);

CREATE TABLE IF NOT EXISTS chat_participants (
  conversation_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  pinned_at DATETIME NULL,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  read_id BIGINT NOT NULL DEFAULT 0,
  delivered_id BIGINT NOT NULL DEFAULT 0,
  cleared_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id,user_id),
  KEY idx_chat_user (user_id,conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT NOT NULL,
  sender_id INT NOT NULL,
  content TEXT NULL,
  reply_to_id BIGINT NULL,
  file_name VARCHAR(255) NULL,
  file_type VARCHAR(120) NULL,
  file_size BIGINT NULL,
  file_path VARCHAR(255) NULL,
  pinned_at DATETIME NULL,
  edited_at DATETIME NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chat_messages (conversation_id,id),
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_reactions (
  message_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(16) NOT NULL,
  PRIMARY KEY (message_id,user_id,emoji),
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_files (
  message_id BIGINT NOT NULL PRIMARY KEY,
  data LONGBLOB NOT NULL,
  FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_typing (
  conversation_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  expires_at DATETIME NOT NULL,
  PRIMARY KEY (conversation_id,user_id),
  FOREIGN KEY (conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_presence (
  user_id INT NOT NULL PRIMARY KEY,
  last_seen DATETIME NOT NULL
);


-- =========================================================
-- Project files
-- =========================================================

CREATE TABLE IF NOT EXISTS project_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  stored_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(255) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_project_files_project_id (project_id)
);


-- =========================================================
-- Payroll processing and documents
-- =========================================================

CREATE TABLE IF NOT EXISTS payroll_processing_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  rule_mode ENUM('AFTER_MONTH_END','AFTER_CUTOFF') NOT NULL DEFAULT 'AFTER_MONTH_END',
  cutoff_day TINYINT UNSIGNED NOT NULL DEFAULT 25,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_payroll_cutoff_day CHECK (cutoff_day BETWEEN 1 AND 31)
);


CREATE TABLE IF NOT EXISTS payroll_run_items (
  calendar_session_id INT NOT NULL,
  employee_id INT NOT NULL,
  salary_config_id INT NOT NULL,
  paid_days DECIMAL(6,2) NOT NULL,
  gross_salary DECIMAL(14,2) NOT NULL,
  loan_deduction DECIMAL(14,2) NOT NULL,
  overtime_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_salary DECIMAL(14,2) NOT NULL,
  scheduled_basic DECIMAL(14,2) NULL,
  scheduled_allowances DECIMAL(14,2) NULL,
  absence_deduction DECIMAL(14,2) NULL,
  working_days DECIMAL(6,2) NULL,
  overtime_hours DECIMAL(8,2) NULL,
  loan_balance_after DECIMAL(14,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (calendar_session_id, employee_id),
  KEY idx_payroll_employee (employee_id)
);

CREATE TABLE IF NOT EXISTS payroll_documents (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  salary_cycle_id INT NOT NULL,
  employee_id INT NULL,
  document_key VARCHAR(50) NOT NULL,
  generated_at DATETIME NULL,
  email_status ENUM('Pending','Sending','Sent','Failed','Skipped') NOT NULL DEFAULT 'Pending',
  email_sent_at DATETIME NULL,
  email_error VARCHAR(500) NULL,
  email_attempts INT NOT NULL DEFAULT 0,
  email_claimed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payroll_document (salary_cycle_id,document_key),
  KEY idx_payroll_document_employee (employee_id,salary_cycle_id)
);

CREATE TABLE IF NOT EXISTS payroll_admin_deliveries (
  salary_cycle_id INT NOT NULL,
  recipient_id INT NOT NULL,
  status ENUM('Pending','Sending','Sent','Failed') NOT NULL DEFAULT 'Pending',
  sent_at DATETIME NULL,
  error VARCHAR(500) NULL,
  attempts INT NOT NULL DEFAULT 0,
  claimed_at DATETIME NULL,
  PRIMARY KEY (salary_cycle_id,recipient_id)
);


-- =========================================================
-- Mobile attendance controls
-- =========================================================

CREATE TABLE IF NOT EXISTS attendance_mobile_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  allowClockIn TINYINT(1) NOT NULL DEFAULT 1,
  allowClockOut TINYINT(1) NOT NULL DEFAULT 1
);

-- 3. Existing employee, notification, and project assignment columns
-- Employee / Authentication Updates
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_users' AND COLUMN_NAME = 'auth_version'), 'SELECT 1', 'ALTER TABLE tbl_users ADD COLUMN auth_version INT UNSIGNED NOT NULL DEFAULT 0') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_users' AND COLUMN_NAME = 'must_change_password'), 'SELECT 1', 'ALTER TABLE tbl_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_users' AND COLUMN_NAME = 'department'), 'SELECT 1', 'ALTER TABLE tbl_users ADD COLUMN department VARCHAR(120) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbl_users' AND COLUMN_NAME = 'reporting_manager'), 'SELECT 1', 'ALTER TABLE tbl_users ADD COLUMN reporting_manager VARCHAR(120) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

-- Notification Table Updates
-- Existing dump has message VARCHAR(255); current notices can exceed that.
-- Duplicate non-NULL dedupe keys are detected automatically below.
SELECT IF(EXISTS (
  SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications'
    AND COLUMN_NAME = 'message'
    AND (DATA_TYPE IN ('char','varchar','tinytext') OR (DATA_TYPE = 'text' AND IS_NULLABLE <> 'YES'))
), 'ALTER TABLE notifications MODIFY COLUMN message TEXT NULL', 'SELECT 1') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'recipientRole'), 'SELECT 1', 'ALTER TABLE notifications ADD COLUMN recipientRole VARCHAR(80) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'title'), 'SELECT 1', 'ALTER TABLE notifications ADD COLUMN title VARCHAR(160) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'module'), 'SELECT 1', 'ALTER TABLE notifications ADD COLUMN module VARCHAR(80) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'targetUrl'), 'SELECT 1', 'ALTER TABLE notifications ADD COLUMN targetUrl VARCHAR(500) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'readAt'), 'SELECT 1', 'ALTER TABLE notifications ADD COLUMN readAt DATETIME NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'dedupeKey'), 'SELECT 1', 'ALTER TABLE notifications ADD COLUMN dedupeKey VARCHAR(190) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
-- Preserve duplicate rows; this optional unique key is skipped if needed.
SELECT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND INDEX_NAME = 'uq_notification_dedupe') INTO @mydesk_uq_notification_dedupe_exists;
SELECT EXISTS(SELECT 1 FROM notifications WHERE dedupeKey IS NOT NULL GROUP BY dedupeKey HAVING COUNT(*) > 1)
  INTO @mydesk_uq_notification_dedupe_duplicates;
SELECT IF(@mydesk_uq_notification_dedupe_exists = 1 OR @mydesk_uq_notification_dedupe_duplicates = 1,
  'SELECT 1', 'ALTER TABLE notifications ADD UNIQUE KEY uq_notification_dedupe (dedupeKey)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT 'uq_notification_dedupe skipped: duplicate dedupeKey records exist' AS migration_warning
WHERE @mydesk_uq_notification_dedupe_exists = 0 AND @mydesk_uq_notification_dedupe_duplicates = 1;
SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND INDEX_NAME = 'idx_notification_user_date'), 'SELECT 1', 'ALTER TABLE notifications ADD KEY idx_notification_user_date (userId, createdAt)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

-- Project Assignment Updates
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignedprojects' AND COLUMN_NAME = 'assigned_by'), 'SELECT 1', 'ALTER TABLE assignedprojects ADD COLUMN assigned_by INT NULL AFTER assignStatus') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

-- Payroll Constraints
-- Duplicate checks run automatically; preserve rows and skip only the affected unique key.
-- Preserve duplicate rows; this optional unique key is skipped if needed.
SELECT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calendarsession' AND INDEX_NAME = 'uq_calendar_period') INTO @mydesk_uq_calendar_period_exists;
SELECT EXISTS(SELECT 1 FROM calendarsession  GROUP BY year, month HAVING COUNT(*) > 1)
  INTO @mydesk_uq_calendar_period_duplicates;
SELECT IF(@mydesk_uq_calendar_period_exists = 1 OR @mydesk_uq_calendar_period_duplicates = 1,
  'SELECT 1', 'ALTER TABLE calendarsession ADD UNIQUE KEY uq_calendar_period (year, month)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT 'uq_calendar_period skipped: duplicate year, month records exist' AS migration_warning
WHERE @mydesk_uq_calendar_period_exists = 0 AND @mydesk_uq_calendar_period_duplicates = 1;

-- Salary-cycle unique keys (automatic duplicate checks below)
-- Preserve duplicate rows; this optional unique key is skipped if needed.
SELECT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salarycycle' AND INDEX_NAME = 'uq_salary_period') INTO @mydesk_uq_salary_period_exists;
SELECT EXISTS(SELECT 1 FROM salarycycle  GROUP BY year, month HAVING COUNT(*) > 1)
  INTO @mydesk_uq_salary_period_duplicates;
SELECT IF(@mydesk_uq_salary_period_exists = 1 OR @mydesk_uq_salary_period_duplicates = 1,
  'SELECT 1', 'ALTER TABLE salarycycle ADD UNIQUE KEY uq_salary_period (year, month)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT 'uq_salary_period skipped: duplicate year, month records exist' AS migration_warning
WHERE @mydesk_uq_salary_period_exists = 0 AND @mydesk_uq_salary_period_duplicates = 1;
-- Preserve duplicate rows; this optional unique key is skipped if needed.
SELECT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salarycycle' AND INDEX_NAME = 'uq_salary_calendar') INTO @mydesk_uq_salary_calendar_exists;
SELECT EXISTS(SELECT 1 FROM salarycycle WHERE calendar_session_id IS NOT NULL GROUP BY calendar_session_id HAVING COUNT(*) > 1)
  INTO @mydesk_uq_salary_calendar_duplicates;
SELECT IF(@mydesk_uq_salary_calendar_exists = 1 OR @mydesk_uq_salary_calendar_duplicates = 1,
  'SELECT 1', 'ALTER TABLE salarycycle ADD UNIQUE KEY uq_salary_calendar (calendar_session_id)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT 'uq_salary_calendar skipped: duplicate calendar_session_id records exist' AS migration_warning
WHERE @mydesk_uq_salary_calendar_exists = 0 AND @mydesk_uq_salary_calendar_duplicates = 1;

-- Access Control / Module Updates
-- Add missing module labels. Existing access_control role grants are unchanged.
INSERT INTO modules (moduleName)
SELECT names.moduleName FROM (
  SELECT 'Dashboard' AS moduleName
  UNION ALL SELECT 'People'
  UNION ALL SELECT 'Human Resources'
  UNION ALL SELECT 'Attendance'
  UNION ALL SELECT 'Configuration'
  UNION ALL SELECT 'Projects'
  UNION ALL SELECT 'Performance'
  UNION ALL SELECT 'Lead Management'
  UNION ALL SELECT 'Pipeline'
  UNION ALL SELECT 'Follow-ups'
  UNION ALL SELECT 'Sales'
  UNION ALL SELECT 'Accounts'
  UNION ALL SELECT 'Payroll'
  UNION ALL SELECT 'Expenses'
  UNION ALL SELECT 'Assets'
  UNION ALL SELECT 'Talent Acquisition'
  UNION ALL SELECT 'Dynamics'
  UNION ALL SELECT 'Users Management'
  UNION ALL SELECT 'Reports'
) AS names
WHERE NOT EXISTS (SELECT 1 FROM modules m WHERE m.moduleName = names.moduleName);

-- Configuration Seed Data
-- The settings tables are created earlier in this file.
-- INSERT IGNORE preserves an existing configured singleton row.
INSERT IGNORE INTO payroll_processing_settings (id, rule_mode, cutoff_day)
VALUES (1, 'AFTER_MONTH_END', 25);
INSERT IGNORE INTO attendance_mobile_settings (id, allowClockIn, allowClockOut)
VALUES (1, 1, 1);

-- 4. Known partial chat and payroll upgrades
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations' AND COLUMN_NAME = 'project_id'),
  'SELECT 1', 'ALTER TABLE chat_conversations ADD COLUMN project_id INT NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations' AND COLUMN_NAME = 'archived_at'),
  'SELECT 1', 'ALTER TABLE chat_conversations ADD COLUMN archived_at DATETIME NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_participants' AND COLUMN_NAME = 'pinned_at'),
  'SELECT 1', 'ALTER TABLE chat_participants ADD COLUMN pinned_at DATETIME NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_participants' AND COLUMN_NAME = 'muted'),
  'SELECT 1', 'ALTER TABLE chat_participants ADD COLUMN muted BOOLEAN NOT NULL DEFAULT FALSE') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_participants' AND COLUMN_NAME = 'read_id'),
  'SELECT 1', 'ALTER TABLE chat_participants ADD COLUMN read_id BIGINT NOT NULL DEFAULT 0') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_participants' AND COLUMN_NAME = 'delivered_id'),
  'SELECT 1', 'ALTER TABLE chat_participants ADD COLUMN delivered_id BIGINT NOT NULL DEFAULT 0') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_participants' AND COLUMN_NAME = 'cleared_id'),
  'SELECT 1', 'ALTER TABLE chat_participants ADD COLUMN cleared_id BIGINT NOT NULL DEFAULT 0') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'reply_to_id'),
  'SELECT 1', 'ALTER TABLE chat_messages ADD COLUMN reply_to_id BIGINT NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'file_size'),
  'SELECT 1', 'ALTER TABLE chat_messages ADD COLUMN file_size BIGINT NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'file_path'),
  'SELECT 1', 'ALTER TABLE chat_messages ADD COLUMN file_path VARCHAR(255) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'pinned_at'),
  'SELECT 1', 'ALTER TABLE chat_messages ADD COLUMN pinned_at DATETIME NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'edited_at'),
  'SELECT 1', 'ALTER TABLE chat_messages ADD COLUMN edited_at DATETIME NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'deleted_at'),
  'SELECT 1', 'ALTER TABLE chat_messages ADD COLUMN deleted_at DATETIME NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'scheduled_basic'),
  'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN scheduled_basic DECIMAL(14,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'scheduled_allowances'),
  'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN scheduled_allowances DECIMAL(14,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'absence_deduction'),
  'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN absence_deduction DECIMAL(14,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'working_days'),
  'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN working_days DECIMAL(6,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'overtime_hours'),
  'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN overtime_hours DECIMAL(8,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'loan_balance_after'),
  'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN loan_balance_after DECIMAL(14,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
-- Add 'project' only to the exact older two-value enum.
SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations'
    AND COLUMN_NAME = 'type' AND COLUMN_TYPE = 'enum(''direct'',''group'')'),
  'ALTER TABLE chat_conversations MODIFY COLUMN type ENUM(''direct'',''group'',''project'') NOT NULL',
  'SELECT 1') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;


-- 5. Known partial-table nonunique indexes
SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations' AND INDEX_NAME = 'idx_chat_created'),
  'SELECT 1', 'ALTER TABLE chat_conversations ADD KEY idx_chat_created (created_at)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_participants' AND INDEX_NAME = 'idx_chat_user'),
  'SELECT 1', 'ALTER TABLE chat_participants ADD KEY idx_chat_user (user_id, conversation_id)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND INDEX_NAME = 'idx_chat_messages'),
  'SELECT 1', 'ALTER TABLE chat_messages ADD KEY idx_chat_messages (conversation_id, id)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_files' AND INDEX_NAME = 'idx_project_files_project_id'),
  'SELECT 1', 'ALTER TABLE project_files ADD KEY idx_project_files_project_id (project_id)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND INDEX_NAME = 'idx_payroll_employee'),
  'SELECT 1', 'ALTER TABLE payroll_run_items ADD KEY idx_payroll_employee (employee_id)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_documents' AND INDEX_NAME = 'idx_payroll_document_employee'),
  'SELECT 1', 'ALTER TABLE payroll_documents ADD KEY idx_payroll_document_employee (employee_id, salary_cycle_id)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

-- 6. Remaining optional unique constraints
-- Preserve duplicate rows; this optional unique key is skipped if needed.
SELECT EXISTS(SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations'
  GROUP BY INDEX_NAME
  HAVING COUNT(*) = 1 AND MIN(NON_UNIQUE) = 0 AND MAX(COLUMN_NAME = 'project_id') = 1) INTO @mydesk_uq_chat_project_exists;
SELECT EXISTS(SELECT 1 FROM chat_conversations WHERE project_id IS NOT NULL GROUP BY project_id HAVING COUNT(*) > 1)
  INTO @mydesk_uq_chat_project_duplicates;
SELECT IF(@mydesk_uq_chat_project_exists = 1 OR @mydesk_uq_chat_project_duplicates = 1,
  'SELECT 1', 'ALTER TABLE chat_conversations ADD UNIQUE KEY uq_chat_project (project_id)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT 'uq_chat_project skipped: duplicate project_id records exist' AS migration_warning
WHERE @mydesk_uq_chat_project_exists = 0 AND @mydesk_uq_chat_project_duplicates = 1;

-- Preserve duplicate rows; this optional unique key is skipped if needed.
SELECT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_documents' AND INDEX_NAME = 'uq_payroll_document') INTO @mydesk_uq_payroll_document_exists;
SELECT EXISTS(SELECT 1 FROM payroll_documents  GROUP BY salary_cycle_id, document_key HAVING COUNT(*) > 1)
  INTO @mydesk_uq_payroll_document_duplicates;
SELECT IF(@mydesk_uq_payroll_document_exists = 1 OR @mydesk_uq_payroll_document_duplicates = 1,
  'SELECT 1', 'ALTER TABLE payroll_documents ADD UNIQUE KEY uq_payroll_document (salary_cycle_id, document_key)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;
SELECT 'uq_payroll_document skipped: duplicate salary_cycle_id, document_key records exist' AS migration_warning
WHERE @mydesk_uq_payroll_document_exists = 0 AND @mydesk_uq_payroll_document_duplicates = 1;

-- 7. Final verification - read only
-- Run after all updates; queries here do not modify data.
-- =========================================================

SELECT DATABASE() AS selected_database, VERSION() AS mysql_version;

-- Expected legacy columns should all report PRESENT.
SELECT expected.table_name, expected.column_name,
       IF(actual.COLUMN_NAME IS NULL, 'MISSING', 'PRESENT') AS schema_status,
       actual.COLUMN_TYPE
FROM (
  SELECT 'tbl_users' AS table_name, 'auth_version' AS column_name UNION ALL
  SELECT 'tbl_users', 'must_change_password' UNION ALL
  SELECT 'tbl_users', 'department' UNION ALL
  SELECT 'tbl_users', 'reporting_manager' UNION ALL
  SELECT 'notifications', 'recipientRole' UNION ALL
  SELECT 'notifications', 'title' UNION ALL
  SELECT 'notifications', 'module' UNION ALL
  SELECT 'notifications', 'targetUrl' UNION ALL
  SELECT 'notifications', 'readAt' UNION ALL
  SELECT 'notifications', 'dedupeKey' UNION ALL
  SELECT 'assignedprojects', 'assigned_by'
) AS expected
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE()
 AND actual.TABLE_NAME = expected.table_name
 AND actual.COLUMN_NAME = expected.column_name
ORDER BY expected.table_name, expected.column_name;

-- Notification message should be nullable TEXT.
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'notifications'
  AND COLUMN_NAME = 'message';

-- Expected legacy indexes should all report PRESENT.
SELECT expected.table_name, expected.index_name,
       IF(actual.INDEX_NAME IS NULL, 'MISSING', 'PRESENT') AS schema_status,
       actual.NON_UNIQUE
FROM (
  SELECT 'notifications' AS table_name, 'uq_notification_dedupe' AS index_name UNION ALL
  SELECT 'notifications', 'idx_notification_user_date' UNION ALL
  SELECT 'calendarsession', 'uq_calendar_period' UNION ALL
  SELECT 'salarycycle', 'uq_salary_period' UNION ALL
  SELECT 'salarycycle', 'uq_salary_calendar'
) AS expected
LEFT JOIN (
  SELECT TABLE_NAME, INDEX_NAME, MIN(NON_UNIQUE) AS NON_UNIQUE
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
  GROUP BY TABLE_NAME, INDEX_NAME
) AS actual
  ON actual.TABLE_NAME = expected.table_name
 AND actual.INDEX_NAME = expected.index_name
ORDER BY expected.table_name, expected.index_name;

-- Settings rows should each return one row with id = 1.
SELECT id, rule_mode, cutoff_day FROM payroll_processing_settings WHERE id = 1;
SELECT id, allowClockIn, allowClockOut FROM attendance_mobile_settings WHERE id = 1;

-- Check access-control module labels; existing role grants were not changed.
SELECT id, moduleName FROM modules ORDER BY id;
SELECT status, COUNT(*) AS grants FROM access_control GROUP BY status;

-- These queries show any duplicate groups behind skipped unique keys.
SELECT dedupeKey, COUNT(*) AS records FROM notifications
WHERE dedupeKey IS NOT NULL GROUP BY dedupeKey HAVING COUNT(*) > 1;
SELECT year, month, COUNT(*) AS records FROM calendarsession
GROUP BY year, month HAVING COUNT(*) > 1;
SELECT year, month, COUNT(*) AS records FROM salarycycle
GROUP BY year, month HAVING COUNT(*) > 1;
SELECT calendar_session_id, COUNT(*) AS records FROM salarycycle
WHERE calendar_session_id IS NOT NULL
GROUP BY calendar_session_id HAVING COUNT(*) > 1;

-- Known partial-upgrade columns should all report PRESENT.
SELECT expected.table_name, expected.column_name,
       IF(actual.COLUMN_NAME IS NULL, 'MISSING', 'PRESENT') AS schema_status
FROM (
  SELECT 'chat_conversations' AS table_name, 'project_id' AS column_name
  UNION ALL SELECT 'chat_conversations', 'archived_at'
  UNION ALL SELECT 'chat_participants', 'pinned_at'
  UNION ALL SELECT 'chat_participants', 'muted'
  UNION ALL SELECT 'chat_participants', 'read_id'
  UNION ALL SELECT 'chat_participants', 'delivered_id'
  UNION ALL SELECT 'chat_participants', 'cleared_id'
  UNION ALL SELECT 'chat_messages', 'reply_to_id'
  UNION ALL SELECT 'chat_messages', 'file_size'
  UNION ALL SELECT 'chat_messages', 'file_path'
  UNION ALL SELECT 'chat_messages', 'pinned_at'
  UNION ALL SELECT 'chat_messages', 'edited_at'
  UNION ALL SELECT 'chat_messages', 'deleted_at'
  UNION ALL SELECT 'payroll_run_items', 'scheduled_basic'
  UNION ALL SELECT 'payroll_run_items', 'scheduled_allowances'
  UNION ALL SELECT 'payroll_run_items', 'absence_deduction'
  UNION ALL SELECT 'payroll_run_items', 'working_days'
  UNION ALL SELECT 'payroll_run_items', 'overtime_hours'
  UNION ALL SELECT 'payroll_run_items', 'loan_balance_after'
) AS expected
LEFT JOIN information_schema.COLUMNS actual
  ON actual.TABLE_SCHEMA = DATABASE() AND actual.TABLE_NAME = expected.table_name
 AND actual.COLUMN_NAME = expected.column_name
ORDER BY expected.table_name, expected.column_name;

-- Verify the chat enum includes project without narrowing any other live type.
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations'
  AND COLUMN_NAME = 'type';

-- Indexes on partially upgraded new tables should report PRESENT.
SELECT expected.table_name, expected.index_name,
       IF(actual.INDEX_NAME IS NULL, 'MISSING', 'PRESENT') AS schema_status
FROM (
  SELECT 'chat_conversations' AS table_name, 'idx_chat_created' AS index_name
  UNION ALL SELECT 'chat_participants', 'idx_chat_user'
  UNION ALL SELECT 'chat_messages', 'idx_chat_messages'
  UNION ALL SELECT 'project_files', 'idx_project_files_project_id'
  UNION ALL SELECT 'payroll_run_items', 'idx_payroll_employee'
  UNION ALL SELECT 'payroll_documents', 'idx_payroll_document_employee'
) AS expected
LEFT JOIN information_schema.STATISTICS actual
  ON actual.TABLE_SCHEMA = DATABASE() AND actual.TABLE_NAME = expected.table_name
 AND actual.INDEX_NAME = expected.index_name AND actual.SEQ_IN_INDEX = 1
ORDER BY expected.table_name, expected.index_name;

-- Required new tables: all should report PRESENT.
SELECT expected.table_name,
       IF(actual.TABLE_NAME IS NULL, 'MISSING', 'PRESENT') AS schema_status
FROM (
  SELECT 'password_reset_tokens' AS table_name
  UNION ALL SELECT 'password_reset_rate_limits'
  UNION ALL SELECT 'notification_email_outbox'
  UNION ALL SELECT 'notification_dismissals'
  UNION ALL SELECT 'chat_conversations'
  UNION ALL SELECT 'chat_participants'
  UNION ALL SELECT 'chat_messages'
  UNION ALL SELECT 'chat_reactions'
  UNION ALL SELECT 'chat_files'
  UNION ALL SELECT 'chat_typing'
  UNION ALL SELECT 'chat_presence'
  UNION ALL SELECT 'project_files'
  UNION ALL SELECT 'payroll_processing_settings'
  UNION ALL SELECT 'payroll_run_items'
  UNION ALL SELECT 'payroll_documents'
  UNION ALL SELECT 'payroll_admin_deliveries'
  UNION ALL SELECT 'attendance_mobile_settings'
) AS expected
LEFT JOIN information_schema.TABLES actual
  ON actual.TABLE_SCHEMA = DATABASE() AND actual.TABLE_NAME = expected.table_name
ORDER BY expected.table_name;

-- Optional unique constraints show PRESENT or SKIPPED_DUPLICATES.
SELECT 'uq_notification_dedupe' AS constraint_name,
       CASE WHEN EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND INDEX_NAME = 'uq_notification_dedupe')
            THEN 'PRESENT'
            WHEN @mydesk_uq_notification_dedupe_duplicates = 1 THEN 'SKIPPED_DUPLICATES'
            ELSE 'MISSING' END AS migration_status;
SELECT 'uq_calendar_period' AS constraint_name,
       CASE WHEN EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calendarsession' AND INDEX_NAME = 'uq_calendar_period')
            THEN 'PRESENT'
            WHEN @mydesk_uq_calendar_period_duplicates = 1 THEN 'SKIPPED_DUPLICATES'
            ELSE 'MISSING' END AS migration_status;
SELECT 'uq_salary_period' AS constraint_name,
       CASE WHEN EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salarycycle' AND INDEX_NAME = 'uq_salary_period')
            THEN 'PRESENT'
            WHEN @mydesk_uq_salary_period_duplicates = 1 THEN 'SKIPPED_DUPLICATES'
            ELSE 'MISSING' END AS migration_status;
SELECT 'uq_salary_calendar' AS constraint_name,
       CASE WHEN EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salarycycle' AND INDEX_NAME = 'uq_salary_calendar')
            THEN 'PRESENT'
            WHEN @mydesk_uq_salary_calendar_duplicates = 1 THEN 'SKIPPED_DUPLICATES'
            ELSE 'MISSING' END AS migration_status;
SELECT 'uq_chat_project' AS constraint_name,
       CASE WHEN EXISTS(SELECT 1 FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations'
  GROUP BY INDEX_NAME
  HAVING COUNT(*) = 1 AND MIN(NON_UNIQUE) = 0 AND MAX(COLUMN_NAME = 'project_id') = 1) THEN 'PRESENT'
            WHEN @mydesk_uq_chat_project_duplicates = 1 THEN 'SKIPPED_DUPLICATES'
            ELSE 'MISSING' END AS migration_status;
SELECT 'uq_payroll_document' AS constraint_name,
       CASE WHEN EXISTS(SELECT 1 FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_documents'
              AND INDEX_NAME = 'uq_payroll_document') THEN 'PRESENT'
            WHEN @mydesk_uq_payroll_document_duplicates = 1 THEN 'SKIPPED_DUPLICATES'
            ELSE 'MISSING' END AS migration_status;
SELECT 'MyDesk database migration completed' AS migration_status,
       DATABASE() AS selected_database,
       (SELECT COUNT(*) FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('password_reset_tokens', 'password_reset_rate_limits', 'notification_email_outbox', 'notification_dismissals', 'chat_conversations', 'chat_participants', 'chat_messages', 'chat_reactions', 'chat_files', 'chat_typing', 'chat_presence', 'project_files', 'payroll_processing_settings', 'payroll_run_items', 'payroll_documents', 'payroll_admin_deliveries', 'attendance_mobile_settings')) AS required_new_tables_present,
       17 AS required_new_tables_expected;

