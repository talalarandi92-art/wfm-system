---
name: mini-me
description: >-
  A complete clone of the WFM project assistant for the Boutiqaat Contact-Center
  Workforce Management platform. Use whenever working on this WFM system —
  scheduling, auto-generation, rotation, attendance & OT reconciliation,
  adherence, capacity/Erlang, RTA, requests/approvals, outages, scorecard,
  coaching, the autonomous guard team + Chief, integrations (Ameyo, Sprinklr,
  Odoo), roster analytics — or any confirmed business rule (week start, shift
  codes, female/maternity 7h shifts, rest, shift-rate, cut-off cycles), or to
  build/regenerate a monthly scorecard. Contains every decision and rule agreed
  with the user from day one. Self-contained and portable — teach it to any
  agent (e.g. Hermes) and it rebuilds everything we built without further input.
---

# mini-me — the WFM project, distilled

This skill is a portable clone of the assistant's knowledge of the Boutiqaat Contact-Center
WFM platform. It holds the role to play, the architecture, **every** confirmed business rule,
the real data sources, the modules built, and the full scorecard method. An agent that reads it
can rebuild what we built and regenerate the monthly scorecard **without re-asking the user** —
given the raw data exports (which the skill cannot invent) and the code repo (git holds the code).

The user is the **WFM Director at Boutiqaat** with deep domain expertise and owns this platform.
His clarifications are the highest authority; newer ones override older; real Timing-sheet/workbook
data overrides assumptions. Never fake completion, hide mock data, restart the project, or break the
working app with unsafe global edits. Build module-by-module: plan → implement → test → verify.

## How to use

1. Identify the task's domain, then open the matching `reference/*.md` before acting.
2. For scorecard work, follow `reference/scorecard-method.md` and run `scripts/scorecard-gen.js`
   then `scripts/scorecard-audit.js` (from `backend/`, which has `xlsx` + `exceljs`).
3. Surface gaps honestly; use documented fallbacks (e.g. "bar") rather than guessing.

## Reference index

System knowledge:
- `reference/architecture.md` — stack, repo layout, build/run, Excel I/O, environment gotchas.
- `reference/business-rules.md` — every WFM rule (week, shift codes & real times, female & maternity
  7h, rest, OFF, publish/lock, shift-rate, permission HC, Erlang, fairness basis, per-function policy).
- `reference/data-sources.md` — Ameyo / Sprinklr / Odoo, combine-both-systems, roster reliability,
  cut-off cycles, intern→FT ID map, break-source per function, metric formulas, OT engine.
- `reference/modules.md` — everything built (backend modules, frontend pages, guard team + Chief +
  Auto Mode, attendance-recon, analytics, requests, integrations, relief suite).
- `reference/conventions.md` — i18n (inline ar/en), Saturday week alignment, RBAC, audit immutability,
  async-job rule, how to work with this user.

Scorecard (full method + tools):
- `reference/scorecard-method.md` — the end-to-end scorecard build procedure.
- `reference/scorecard-scoring-bands.md` — exact bands + round-half-up engine.
- `reference/scorecard-file-map.md` — every source file/sheet/column → which KPI.
- `reference/scorecard-rules.md` — confirmed scorecard rules with dates.
- `scripts/scorecard-gen.js` — generator · `scripts/scorecard-audit.js` — independent verifier.

## Golden rules (the ones that bite if forgotten)

- **Week starts Saturday.** Use local formatting (`fmtLocal`/`snapToSaturday`); never `toISOString()`
  for local-day logic (off-by-one caused a 3-OFF/week bug).
- **Standard shift = 9h incl. 1h break.** `20` codes = 8h. **`*7` codes (b7 n7 m7 e7 md7 mn7 ee7) = 7h
  (maternity)** → those days count as 7h in productivity. Ramadan `R` may be split shifts; some cross midnight.
- **Match by Employee ID, never name.** Interns `6xxxx` → FT `1xxxx` (resolve via the ID map).
- **Combine BOTH systems** (Ameyo + Sprinklr) for attendance/OT — never one alone.
- **Break source per function:** Inbound/Refund/Outbound ← Ameyo Session Details; CH-WA/Social/Email ← Sprinklr.
- **Female shift rule** (configurable): up to C (20:00); N only if needed (warn); MD/MN blocked; override → warn + audit.
- **Audit log append-only;** heavy ops are async jobs; imports = preview→validate→commit.
- **i18n:** inline `ar ? 'عربي' : 'English'`; English mode 100% English BUT inputs still accept typed Arabic.
- **Scorecard scope:** frontline only — exclude `/rta|leader|specialist|customer care|support/i`.
- **Productivity:** `(WD×9 − ShortBreak)/(WD×9)` = Y/X, `*7` days use ×7; sick penalty 1→−2%, 2→−5%.
- **Round-half-up** every percentage before scoring. Bar = the lowest value that earns a score ("العتبة").

## Keeping it current

When the user confirms a new rule, update the matching `reference/*.md` here (and the project memory)
so this clone stays accurate. This skill is the single portable source of truth — teach it to Hermes.
