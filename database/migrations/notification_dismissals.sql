-- Dismissal keys prevent a deleted notification from being recreated for the same user.
-- Notification content is deleted from notifications; this table stores only its dedupe key.
CREATE TABLE IF NOT EXISTS notification_dismissals (
  userId INT NOT NULL,
  dismissalKey VARCHAR(255) NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (userId, dismissalKey)
);
