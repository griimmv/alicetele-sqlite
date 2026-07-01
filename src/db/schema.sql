CREATE TABLE IF NOT EXISTS sessions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL DEFAULT 'default',
  chat_id    BIGINT NOT NULL,
  archived   TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS turns (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  session_id    INT NOT NULL,
  turn_index    INT NOT NULL,
  query         TEXT NOT NULL DEFAULT '',
  summary       TEXT,
  quotes        TEXT,
  sources       TEXT,
  raw           TEXT,
  error         TEXT,
  input_tokens  INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_chat ON sessions(chat_id, archived);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id, turn_index);
