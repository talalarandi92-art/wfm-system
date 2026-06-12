-- ============================================================================
-- 008 — Security Hardening
--
-- 1. Add locked_until to users table (auto-unlock support)
-- 2. Add upload_rate_limit index hints
-- ============================================================================

-- Auto-unlock: store when the lock expires (NULL = permanent until admin unlocks)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;

-- Index for fast lock-expiry check on login
CREATE INDEX IF NOT EXISTS idx_users_locked_until
  ON users(locked_until)
  WHERE status = 'locked';

-- Audit log index improvement: faster actor queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_action
  ON audit_logs(actor_id, action, created_at DESC);
