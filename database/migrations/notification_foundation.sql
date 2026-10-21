-- Apply once before deploying the notification service. Existing rows are preserved.
ALTER TABLE notifications
  MODIFY COLUMN message TEXT NULL,
  ADD COLUMN recipientRole VARCHAR(80) NULL,
  ADD COLUMN title VARCHAR(160) NULL,
  ADD COLUMN module VARCHAR(80) NULL,
  ADD COLUMN targetUrl VARCHAR(500) NULL,
  ADD COLUMN readAt DATETIME NULL,
  ADD COLUMN dedupeKey VARCHAR(190) NULL,
  ADD UNIQUE KEY uq_notification_dedupe (dedupeKey),
  ADD KEY idx_notification_user_date (userId, createdAt);

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
