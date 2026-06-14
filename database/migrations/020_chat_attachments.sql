-- ──────────────────────────────────────────────────────────────────────────────
-- Migration 020: Chat Attachments + Group Management
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS attachment_url     TEXT,
  ADD COLUMN IF NOT EXISTS attachment_type    VARCHAR(20),   -- image|video|audio|file
  ADD COLUMN IF NOT EXISTS attachment_name    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS attachment_size    INTEGER;

-- Allow non-system group channels with custom names
ALTER TABLE chat_channels
  ADD COLUMN IF NOT EXISTS name_ar VARCHAR(120),
  ADD COLUMN IF NOT EXISTS icon    VARCHAR(10)  DEFAULT '💬';

-- Performance index for message paging
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_created
  ON chat_messages(channel_id, created_at DESC);
