-- Upgrade a v2.0 database for independent browser-tab authentication sessions.
-- Back up the database before running this migration.
USE dairy_app;

CREATE TABLE auth_sessions (
  token_hash  CHAR(64) NOT NULL PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  business_id BIGINT UNSIGNED NOT NULL,
  expires_at  DATETIME NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_auth_session_expiry (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (business_id) REFERENCES businesses(id)
) ENGINE=InnoDB;

INSERT INTO schema_version (version) VALUES ('2.1');
