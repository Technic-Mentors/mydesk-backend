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
