-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 019: Internal Chat
-- ─────────────────────────────────────────────────────────────────────────────

-- Channel types
DO $$ BEGIN
  CREATE TYPE chat_channel_type AS ENUM ('system', 'group', 'direct');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Message types
DO $$ BEGIN
  CREATE TYPE chat_message_type AS ENUM ('text', 'system_event', 'file');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Presence status
DO $$ BEGIN
  CREATE TYPE presence_status AS ENUM ('online', 'away', 'offline');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Channels ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  name         VARCHAR(80) NOT NULL,
  name_ar      VARCHAR(80),
  channel_type chat_channel_type NOT NULL DEFAULT 'group',
  icon         VARCHAR(10),          -- emoji icon
  description  TEXT,
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,  -- system channels can't be deleted
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Channel Members ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_channel_members (
  channel_id   UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin     BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (channel_id, user_id)
);

-- ── Messages ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id   UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  sender_id    UUID NOT NULL REFERENCES users(id),
  content      TEXT NOT NULL,
  message_type chat_message_type NOT NULL DEFAULT 'text',
  reply_to_id  UUID REFERENCES chat_messages(id),
  is_edited    BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at    TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,          -- soft delete
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── User Presence ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_presence (
  user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id),
  status       presence_status NOT NULL DEFAULT 'offline',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chat_channels_tenant    ON chat_channels(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_user       ON chat_channel_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel   ON chat_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender    ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_user_presence_tenant    ON user_presence(tenant_id);

-- ── Seed: System Channels ────────────────────────────────────────────────────
INSERT INTO chat_channels (id, tenant_id, name, name_ar, channel_type, icon, description, is_system, created_at)
VALUES
  ('e1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'General',        'عام',            'system', '💬', 'General announcements', TRUE, NOW()),
  ('e1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'WFM Team',       'فريق WFM',       'system', '📋', 'Workforce Management team', TRUE, NOW()),
  ('e1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'RTA',            'RTA',            'system', '📡', 'Real-Time Adherence', TRUE, NOW()),
  ('e1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Operations',     'العمليات',       'system', '🏢', 'Operations team', TRUE, NOW()),
  ('e1000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Outage Alerts',  'تنبيهات الأعطال','system', '🚨', 'Auto-posted outage updates', TRUE, NOW()),
  ('e1000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Tech Issues',    'المشاكل التقنية','system', '🔧', 'Technical issue escalations', TRUE, NOW())
ON CONFLICT DO NOTHING;

-- Add admin to all system channels
INSERT INTO chat_channel_members (channel_id, user_id, is_admin, joined_at)
SELECT c.id, 'd0000000-0000-0000-0000-000000000001', TRUE, NOW()
FROM chat_channels c
WHERE c.tenant_id = 'a0000000-0000-0000-0000-000000000001'
  AND c.is_system = TRUE
ON CONFLICT DO NOTHING;
