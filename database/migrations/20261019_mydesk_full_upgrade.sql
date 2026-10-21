-- MyDesk consolidated database upgrade (MySQL 8.0).
-- Select the existing MyDesk database in the SQL client before importing.
-- Back up the database first. This file preserves existing rows and can be rerun.
-- MySQL DDL commits automatically; if a statement fails, fix the cause and rerun.
SELECT DATABASE() AS selected_mydesk_database;
SELECT 1 FROM tbl_users LIMIT 0;
SELECT 1 FROM notifications LIMIT 0;
SELECT 1 FROM calendarsession LIMIT 0;
SELECT 1 FROM salarycycle LIMIT 0;

-- Password reset tables
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

-- Notification schema
ALTER TABLE notifications MODIFY COLUMN message TEXT NULL;

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

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND INDEX_NAME = 'uq_notification_dedupe'), 'SELECT 1', 'ALTER TABLE notifications ADD UNIQUE KEY uq_notification_dedupe (dedupeKey)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND INDEX_NAME = 'idx_notification_user_date'), 'SELECT 1', 'ALTER TABLE notifications ADD KEY idx_notification_user_date (userId, createdAt)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

-- Notification email and dismissal tables
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

-- Notification dismissal keys
﻿-- Dismissal keys prevent a deleted notification from being recreated for the same user.
-- Notification content is deleted from notifications; this table stores only its dedupe key.
CREATE TABLE IF NOT EXISTS notification_dismissals (
  userId INT NOT NULL,
  dismissalKey VARCHAR(255) NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (userId, dismissalKey)
);

-- Chat tables
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

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations' AND COLUMN_NAME = 'project_id'), 'SELECT 1', 'ALTER TABLE chat_conversations ADD COLUMN project_id INT NULL UNIQUE') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations' AND COLUMN_NAME = 'archived_at'), 'SELECT 1', 'ALTER TABLE chat_conversations ADD COLUMN archived_at DATETIME NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_participants' AND COLUMN_NAME = 'pinned_at'), 'SELECT 1', 'ALTER TABLE chat_participants ADD COLUMN pinned_at DATETIME NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_participants' AND COLUMN_NAME = 'muted'), 'SELECT 1', 'ALTER TABLE chat_participants ADD COLUMN muted BOOLEAN NOT NULL DEFAULT FALSE') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_participants' AND COLUMN_NAME = 'delivered_id'), 'SELECT 1', 'ALTER TABLE chat_participants ADD COLUMN delivered_id BIGINT NOT NULL DEFAULT 0') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'file_size'), 'SELECT 1', 'ALTER TABLE chat_messages ADD COLUMN file_size BIGINT NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'file_path'), 'SELECT 1', 'ALTER TABLE chat_messages ADD COLUMN file_path VARCHAR(255) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_messages' AND COLUMN_NAME = 'pinned_at'), 'SELECT 1', 'ALTER TABLE chat_messages ADD COLUMN pinned_at DATETIME NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

-- Allow project conversations
ALTER TABLE chat_conversations MODIFY COLUMN type ENUM('direct','group','project') NOT NULL;

-- Project file metadata
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

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'assignedprojects' AND COLUMN_NAME = 'assigned_by'), 'SELECT 1', 'ALTER TABLE assignedprojects ADD COLUMN assigned_by INT NULL AFTER assignStatus') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

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

-- Payroll run snapshots
CREATE TABLE IF NOT EXISTS payroll_run_items (
  calendar_session_id INT NOT NULL,
  employee_id INT NOT NULL,
  salary_config_id INT NOT NULL,
  paid_days DECIMAL(6,2) NOT NULL,
  gross_salary DECIMAL(14,2) NOT NULL,
  loan_deduction DECIMAL(14,2) NOT NULL,
  overtime_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  net_salary DECIMAL(14,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (calendar_session_id, employee_id),
  KEY idx_payroll_employee (employee_id)
);

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'scheduled_basic'), 'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN scheduled_basic DECIMAL(14,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'scheduled_allowances'), 'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN scheduled_allowances DECIMAL(14,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'absence_deduction'), 'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN absence_deduction DECIMAL(14,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'working_days'), 'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN working_days DECIMAL(6,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'overtime_hours'), 'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN overtime_hours DECIMAL(8,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_run_items' AND COLUMN_NAME = 'loan_balance_after'), 'SELECT 1', 'ALTER TABLE payroll_run_items ADD COLUMN loan_balance_after DECIMAL(14,2) NULL') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

-- Payroll documents and delivery status
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

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calendarsession' AND INDEX_NAME = 'uq_calendar_period'), 'SELECT 1', 'ALTER TABLE calendarsession ADD UNIQUE KEY uq_calendar_period (year, month)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salarycycle' AND INDEX_NAME = 'uq_salary_period'), 'SELECT 1', 'ALTER TABLE salarycycle ADD UNIQUE KEY uq_salary_period (year, month)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

SELECT IF(EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salarycycle' AND INDEX_NAME = 'uq_salary_calendar'), 'SELECT 1', 'ALTER TABLE salarycycle ADD UNIQUE KEY uq_salary_calendar (calendar_session_id)') INTO @mydesk_ddl;
PREPARE mydesk_stmt FROM @mydesk_ddl;
EXECUTE mydesk_stmt;
DEALLOCATE PREPARE mydesk_stmt;

-- Mobile attendance settings
CREATE TABLE IF NOT EXISTS attendance_mobile_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  allowClockIn TINYINT(1) NOT NULL DEFAULT 1,
  allowClockOut TINYINT(1) NOT NULL DEFAULT 1
);

INSERT IGNORE INTO attendance_mobile_settings (id, allowClockIn, allowClockOut)
VALUES (1, 1, 1);

-- Access Control module catalog
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

-- Verification
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_mobile_settings') AS mobile_settings_table,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'password_reset_tokens') AS password_reset_table,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_email_outbox') AS notification_outbox_table,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'chat_conversations') AS chat_table,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_documents') AS payroll_documents_table;
