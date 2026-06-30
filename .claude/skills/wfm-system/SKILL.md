---
name: wfm-system
description: >-
  The complete knowledge base for the Boutiqaat Contact-Center Workforce
  Management (WFM) platform — everything decided and built with the user from
  day one. Use whenever working on this WFM system: scheduling, auto-generation,
  rotation, attendance & OT reconciliation, adherence, capacity/Erlang, RTA,
  requests/approvals, outages, scorecard/coaching, the autonomous guard team +
  Chief, integrations (Ameyo, Sprinklr, Odoo), roster analytics, or any business
  rule (week start, shift codes, female/maternity shifts, rest, shift-rate,
  cut-off cycles). Load the relevant reference doc before acting. Teachable to
  other agents (e.g. Hermes) — it is fully self-describing and portable.
---

# WFM System — master knowledge

This is the durable memory of the Boutiqaat Contact-Center WFM platform: the role to
play, the architecture, every confirmed business rule, the real data sources, and the
modules built. It exists so any agent (the user's main assistant **or** Hermes) can pick
up the project and act correctly **without re-deriving anything**.

The user is the **WFM Director at Boutiqaat** with deep domain expertise. He owns this
platform. Treat his clarifications as the highest authority; newer clarifications override
older ones. Real workbook/Timing-sheet data overrides theoretical assumptions.

## How to use this skill

1. Identify the domain of the task (scheduling, attendance, scorecard, integrations…).
2. Open the matching `reference/*.md` before acting — it has the confirmed rules and gotchas.
3. For scorecard work, use the dedicated **`scorecard-builder`** skill (more detail there).
4. Never fake completion, never hide mock data, never restart the project, never break the
   working app with unsafe global edits. Build module-by-module: plan → implement → test → verify.

## Reference index

- `reference/architecture.md` — stack, repo layout, build/run, environment gotchas, conventions.
- `reference/business-rules.md` — every WFM rule: week start, shift codes & real times, female &
  maternity (7h) rules, rest, publish/lock, shift-rate, permission HC impact, Erlang, fairness basis.
- `reference/data-sources.md` — Ameyo, Sprinklr, Odoo; roster build & source reliability;
  combine-both-systems rule; cut-off cycles; employee-ID (intern→FT) map; metric formulas.
- `reference/modules.md` — what's built: backend modules, frontend pages, the autonomous guard
  team + the Chief + Auto Mode, attendance-recon/OT engine, analytics, requests, integrations.
- `reference/conventions.md` — i18n (inline ar/en), Saturday week alignment, date pitfalls, RBAC,
  audit-log immutability, async-job rule.
- `reference/design-system.md` — the UI magic: 3 themes (Dark / Light / Aurora-Glass), the
  light-mode comfort layer for a dark-first app, grey mix, keep-dark, neon-hover schedule cells,
  roster zebra + contrasting detail, per-type request colours, NO animated background, and the
  contrast-auditor verification method. Read before ANY UI / theme / styling work.
- `reference/reports-and-roster.md` — the roster/reports ENGINE & rules: canonical identity
  (`person_no` + the `sc` CTE join), `roster_days` model, reconciliation rules (presence, tardiness↔
  conformance, OT bleed guards, cross-midnight, maternity), scorecard data shape (entries=1 month,
  monthly=Net Points only, fcr uuid), the `roster-v2/*` endpoints, the Custom Report/Dashboard
  Builders, SLA/workflow & data-quality reports, and PostgreSQL gotchas. Read before any roster,
  analytics, or report/builder work.

## Golden rules (the ones that bite if forgotten)

- **Week starts Saturday.** Use `fmtLocal`/`snapToSaturday`; never `toISOString()` for local dates
  (off-by-one caused a 3-OFF/week bug).
- **Standard shift = 9h incl. 1h break.** `20` codes = 8h. `*7` codes (b7/n7/m7/e7/md7/mn7/ee7) = 7h
  (maternity). Ramadan `R` codes may be split shifts. Some shifts cross midnight.
- **Match employees by Employee ID, never by name.** Interns (6xxxx) later become FT (1xxxx) — see the
  ID map. Names need whitespace/spelling tolerance only for Sprinklr/quiz sources.
- **Combine BOTH systems** (Ameyo + Sprinklr) for attendance/OT — never trust one alone (login/logout bleed).
- **Female shift rule** (configurable): up to C (ends 20:00); N only if needed (warn); MD/MN blocked.
  Override allowed but must warn + audit.
- **Audit log is append-only.** Heavy ops (import/export/generate/recalc/scorecard/reports) run as async jobs.
- **i18n:** inline `ar ? 'عربي' : 'English'`. English mode must be 100% English, BUT inputs must still
  accept typed Arabic (no `dir=ltr`/filters on inputs).
- **Scorecard scope:** frontline agents only — exclude `/rta|leader|specialist|customer care|support/i`.

## Provenance

This skill is synthesized from the project `CLAUDE.md` and the running memory log
(`~/.claude/.../memory/`). The memory files remain the live, dated journal; this skill is the
curated, portable distillation. When the user confirms a new rule, update BOTH the memory and the
matching reference doc here so the skill stays teachable and current.
