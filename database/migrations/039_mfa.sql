-- 039_mfa.sql
-- TOTP multi-factor authentication (opt-in per user). The secret is only acted
-- on once the user verifies a code (mfa_enabled=true); login enforcement is
-- gated on mfa_enabled so existing users are unaffected until they enrol.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS mfa_secret  TEXT,
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
