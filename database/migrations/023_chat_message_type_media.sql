-- ═══════════════════════════════════════════════════════════════════════════
-- 023 — Extend chat_message_type enum with media kinds
-- Migration 020 added attachment columns but never added the media values to the
-- message_type enum, so image/video/audio messages were REJECTED on insert and
-- attachments silently vanished. Add the missing values.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE chat_message_type ADD VALUE IF NOT EXISTS 'image';
ALTER TYPE chat_message_type ADD VALUE IF NOT EXISTS 'video';
ALTER TYPE chat_message_type ADD VALUE IF NOT EXISTS 'audio';
