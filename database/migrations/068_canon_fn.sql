-- 068 — canonical function fold (Director rule, 2026-07-04)
--
-- Intern functions are the SAME headcount as their parent team:
--   "Internship CH - WA" → "CH - WA", "Internship Inbound" → "Inbound",
--   "Internship Offline" → "Offline", "Internship OMT" → "OMT".
-- Interns rotate within, and count toward, the parent team. This helper is the
-- ONE source of truth for that fold; every headcount / coverage / demand / pool /
-- scheduling-pool query wraps its function key in canon_fn(). Per-person identity
-- surfaces (agent-360, scorecards, per-row report labels) keep the raw intern label.
--
-- IMMUTABLE + PARALLEL SAFE so it is usable in GROUP BY / WHERE / indexes.
CREATE OR REPLACE FUNCTION canon_fn(t text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT NULLIF(regexp_replace(COALESCE(t, ''), '^[Ii]nternship +', ''), '') $$;

COMMENT ON FUNCTION canon_fn(text) IS
  'Fold an intern function name onto its parent team (strips a leading "Internship " prefix). Director rule 2026-07-04 — headcount/coverage only; identity surfaces keep the raw label.';
