-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 081: OT record-only flag (Director rule 4, 2026-07-11)
--   Excluded roles (Team Leader / Senior / Resolution Specialist / RTA / WFM /
--   Management-CCNO) still have their OT computed and stored in the ot_* columns,
--   but it is RECORD-ONLY — not payable, future-counted. Payroll reports
--   (roster-v2/ot-exceptions) exclude flagged rows from payable totals and list
--   them in a separate record-only section. Written by scripts/recon-build.js →
--   recon-ingest.js on every rebuild.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE roster_days ADD COLUMN IF NOT EXISTS ot_record_only boolean NOT NULL DEFAULT false;
