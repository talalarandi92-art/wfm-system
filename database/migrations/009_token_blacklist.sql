-- Migration 009 — Access token blacklist (no Redis required)
-- Each JTI (JWT ID) of a revoked access token is stored here
-- until its natural expiry, then cleaned up lazily on login.

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti         TEXT            PRIMARY KEY,
  user_id     UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ     NOT NULL
);

-- Fast lookup on every authenticated request
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_jti_expires
  ON revoked_tokens(jti, expires_at);

-- Allows efficient cleanup of expired rows
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires
  ON revoked_tokens(expires_at);

COMMENT ON TABLE revoked_tokens IS
  'Short-lived blacklist for revoked JWT access tokens. '
  'Rows are inserted on logout and cleaned up lazily (on login) after expiry.';
