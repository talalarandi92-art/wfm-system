# REDESIGN PROGRAM — "World-Class WFM" (Sprinklr-replacement bar)

> **Status: DRAFT — awaiting Director review of phase order. Last updated: 2026-07-08.**
> Director's mandate (2026-07-08, verbatim intent): reformulate all code & design; remove every
> duplicated/scattered idea; deep-analyze and fix half-baked ideas; **every number clickable →
> shows where the data came from**; everything interconnected; modern, beautiful, simple to read;
> fewer scattered tabs, easy to reach/understand; **queue-state-driven break scheduling**; the
> smartest roster; measured against the best WFM/contact-center tools — the system should replace
> a 1.5M KWD Sprinklr purchase.
>
> Grounding: full read-only IA audit 2026-07-08 (89 pages, 68 backend modules). Findings below are
> measured, not impressions. Standing gates: `npm run verify` green per phase · 3-theme check ·
> legacy redirects preserved · **MD/MN=WFH rule + June data edits remain separately GATED**.

## Audit facts the program answers

| Finding | Measured evidence |
|---|---|
| Too many tabs | 5 hubs > 6 tabs: **Chief 13 · Roster 10 · Scheduling 9 · Scorecard 8 · Analytics 8** (65 tabbed sub-pages under 11 hubs) |
| Duplication root | `attendance-recon` = **9 controllers, 35+ `roster-v2/*` endpoints** feeding Roster + half of Scheduling + Capacity coverage + Analytics fairness |
| Same idea, many places | Coverage/hourly-HC ×4 endpoints (all reading `roster_days`) · Forecasting ×5 modules · Scorecard ×3 tables · Agent/Team-360 ×3 · "Changes" tab in 2 hubs |
| Dead numbers | `ControlDashboards`: **24 KPI tiles, ~90% not clickable**; CommandCenter/WfmOverview/RosterDashboard ~half; `Dashboard.tsx` is the good model |
| Design drift | **39/89 pages (44%) import neither ds.tsx nor dazzle.tsx**; top hex offenders: Outages 68 · Scorecard 49 · Requests 35 · rta/ReportPanels 32 · Dashboard 31 · Sidebar itself hardcodes its palette |
| Placeholder debt | **Zero** TODO/FIXME, zero mock-data pages — the "scattered" problem is navigational/architectural, not fake content |

## Phases

### R0 — Foundations (low risk, immediate)
1. **Provenance kit**: shared `<Kpi>` tile (ds.tsx) with a REQUIRED `source` prop — click → drill
   route; info affordance → "where this number comes from" (endpoint, table, definition, period).
   Retrofit order: ControlDashboards (24 tiles) → CommandCenter → WfmOverview → RosterDashboard.
   Definition text comes from the metric consts (TRUE_OT, CRED_LATE…) — one wording everywhere.
2. **Design-token sweep**: the top-15 hex offenders → theme vars/tp/ts (same proven recipe as the
   TechnicalIssues fix, commit dd234d7); Sidebar palette → tokens. Target: 0 near-black/#fff
   hardcodes in pages; ds/dazzle adoption 89/89.
3. Gate: verify + 3 themes + screenshot pass.

### R1 — IA consolidation (tabs → reachable)
Per-hub target ≤6 tabs via grouping, not deletion (every current URL keeps a redirect):
- **Chief 13 → 4**: Overview · Guards (health/analyst/security/scorecard/researcher/reply) ·
  Knowledge (expert/ledger/learning) · Reports & Diagnostics (+bots into Overview).
- **Roster 10 → 5**: Grid · Dashboard · Reports (ot/wfh/quality/audit) · Builders (report+dashboard) · Changes.
- **Scheduling 9 → 6**: Schedule · Generate (generator+ladder) · Coverage (forecast+hourly) ·
  Demand · Rotation · Changes→ merged with Roster Changes (ONE changes surface, D-pending).
- **Scorecard 8 → 5**: Overview · Board & Leaderboard · Trends · 360 (agent+team) · Coaching & Productivity.
- **Analytics 8 → 5**: People360 · Workforce (workforce+insights+attrition) · Forecast · Fairness · Reports.
- Kill cross-hub dupes: ONE "Changes", ONE forecast surface per audience (planner vs analyst).

### R2 — Backend canonicalization (the duplication engine) ⚠ number-changing risk
Method proven by the recon-controller split: parallel-run, byte-diff, then retire.
1. **Coverage/hourly HC**: crown `interval-headcount` (schedule-ops) as THE computation; re-point
   `coverage/hourly`, `coverage-intervals`, `week-forecast` internals to one shared service; byte-diff responses; retire dupes.
2. **Forecasting**: `forecasting` module engine = the only Erlang/forecast math; staffing/event/
   week-forecast/kpi-source consume it as a library (no re-implementations).
3. **Scorecard**: `scorecard_monthly` = the one scored source; `roster-v2/scorecard` + `ops/scorecards`
   re-pointed or explicitly re-labeled as raw operational views (never presented as "the scorecard").
4. **360**: one Agent360/Team360 component + one endpoint pair; other copies become links.
5. `attendance-recon` module rename/split into domain services so no future feature lands there by default.

### R3 — Queue-driven breaks + smartest roster
1. **Break scheduler v2**: optimize break slots against `headcount_intervals` (15-min) + live queue
   state (Sprinklr bridge signals) — never drop coverage below required; RTA sees/live-adjusts;
   fairness across agents; Director's break rules to confirm before build (BR-pending).
2. **Roster intelligence**: demand-engine + rotation fairness already merged (D-077); add
   learned-blend AHT (Sprinklr learning store, ready) + residual-gap remedies as first-class
   generator output. Spec with Director which "smart" levers matter next.

### R4 — World-class polish
Unified drill-down everywhere · exports on every table · EN/AR pass · density/spacing standard ·
⌘K coverage of every entity · empty/loading/error states standard · wallboard mode.

## Sequencing & effort
R0 (fast, this week) → R1 (per-hub, reviewable per PR) → R2 (careful, byte-diff gates) → R3 (needs
Director rules for breaks) → R4 continuous. Each phase lands as separate commits with verify green.

Cross-refs: [[MASTER_PROJECT_MEMORY]] · IA audit (session 2026-07-08) · DESIGN_SYSTEM.md ·
WFM_BUSINESS_RULES_LIBRARY.md · EXECUTION_BRIEF.md (Phase 4 tail).
