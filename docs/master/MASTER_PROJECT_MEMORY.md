# MASTER PROJECT MEMORY — Boutiqaat Enterprise WFM Platform

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> This is the long-term BRAIN of the project: what the platform is, what is LIVE, the final rules,
> modules, roles, workflows, decisions, lessons, and how to rebuild it all.
> **Reading order for a new session:** this file → `docs/knowledge/WFM_RULES_AND_DECISIONS.md`
> (single source of truth for rules — if code conflicts with it, the rule wins) →
> `docs/RECON_PIPELINE.md` (the roster refresh runbook) → the sibling master docs in `docs/master/`.
> Everything here is **Confirmed** (agreed with the WFM Director / recorded in the canonical docs or
> project memory) unless explicitly labelled **Recommended** (needs approval before execution),
> **Needs Approval** (a documented plan explicitly parked awaiting the Director's go), or **Deferred**
> (agreed to postpone). The Director's standing order: **no new or changed rule is executed before
> agreement** — never dress a recommendation as an agreed rule.

---

## 1. Project Overview

| Item | Value |
|---|---|
| Product | Boutiqaat Contact Center Workforce Management (WFM) platform — enterprise-grade, comparable in purpose/depth to NICE / Verint / Calabrio / Genesys WFM |
| Owner / Product authority | The **WFM Director** at Boutiqaat Contact Center (Kuwait). Deep domain expertise (24/7 omnichannel ops, scheduling, Erlang, RTA, scorecards). Approves every rule before it executes. |
| Status | **REAL and RUNNING** on live Boutiqaat contact-center data — not a prototype. ~80 frontend pages / 66 routes, ~60 backend modules, a standalone reconciliation engine, and an autonomous "guard team". |
| Backend | NestJS + TypeScript + TypeORM (`synchronize:false`, SQL migrations 001…067), JWT + rotating refresh tokens, RBAC, audit logging, Swagger. Runs **compiled `dist`** (`npm run build` → `node dist/main.js`; restart to apply changes). |
| Frontend | React + TypeScript + Vite. Arabic/English (inline `ar?'..':'..'`), RTL/LTR, 3 themes (Dark / Light / Aurora-Glass), dazzle kit (`components/dazzle.tsx`). |
| Database | Live local PostgreSQL **`wfm_db`** with real data (≈162 employees, tens of thousands of attendance/roster rows). Access pattern: `backend/scripts` + `.env` `POSTGRES_*`. |
| Data spine | **`roster_days`** — the rich canonical per-person-per-day table built by the reconciliation engine from the Director's real monthly workbooks (`Desktop/new roster/` sources). Every `roster-v2/*` report reads it. |
| Integrations | Ameyo (telephony) + Sprinklr (omnichannel) Chrome-extension bridges; Odoo (holidays, biometric punch, permissions/comp/sick). |
| Canonical knowledge | `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (§1–20), `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md`, `docs/knowledge/DESIGN_SYSTEM.md`, `docs/RECON_PIPELINE.md`, the `wfm-system` skill (`.claude/skills/wfm-system/reference/`), and ~95 project memory notes. |

### What is LIVE today (as-built truth, 2026-07-02)
- **Corrected roster reconciliation** (`backend/scripts/recon-*.js`): one command (`node scripts/recon-refresh.js`) or the in-system Roster **"Upload & Rebuild"** button (`POST /attendance-recon/recon-refresh`) rebuilds `roster_days` with EVERY agreed rule re-applied. Validated vs the Director's manual reconciliation: login 93% / late 96% / early 95%; **0 cases the engine was clearly wrong** — Director's verdict: the engine is the more accurate, trusted source.
- **Roster & reports suite** on `roster_days`: /roster grid, roster-dashboard, agent-360, team-360, HR Matrix, OT & Exceptions (+Excel), WFH HR report, schedule-analysis, hourly analytics, interval headcount, data-quality, Custom Report Builder (~33 presets) + Custom Dashboard Builder, workflow/SLA reports.
- **Schedule module** overlays `roster_days` onto the grid (corrected cells solid, planned dashed, holiday gold ribbon, WFH 🏠 icon — no `-WFH` suffix); demand→schedule chain (`roster-v2/generate` → `generate-week` → save draft → **publish/unpublish** into `attendance_records`, atomic + reversible).
- **Requests & approvals** (permission, leave types, swap, OT, break, appointments/exams w/ attachments, emergency leave, attendance correction), leave-balance ledger (holiday-inside-leave returns to balance), SLA escalation loop, permission HC-impact panel reading canonical `roster_days`.
- **Guard team + Chief**: Health, Analyst, Reporter, Security, Scorecard, Researcher, Expert, Reply-Helper behind a single **/chief** face; Auto Mode auto-approves only safe-surplus requests; Knowledge Ledger + Team Learning; /diagnostics; system-wide Smoke Test.
- **Command Center** (`/command-center`) executive home with source-basis badges (🔵 live attendance_records vs 🟢 corrected roster_days vs 🟣 12-month).
- Scorecard board + monthly scorecard engine (also packaged as the `scorecard-builder` skill), coaching engine, capacity/Erlang (verified 100% vs textbook), forecasting (seasonal baseline + WAPE/MAPE), RTA live, outages, technical issues, internal chat, notifications, KB (146 Odoo articles), campaign calendar, attrition, shift fairness (+ NIGHT TEAM carve-out).

---

## 2. Final Agreed Scope

**In scope (built or committed):** attendance & reconciliation, scheduling (grid/versioning/publish-lock), auto schedule generation (demand-driven), rotation & fairness, shift-rate distribution, forecasting & capacity (Erlang-C voice, concurrency-4 chat/WhatsApp, backlog email, intern ~70% productivity factor), HC planning & permission HC-impact, RTA command center, adherence/conformance, shrinkage, requests & approvals (15 types incl. peer-accepted shift swap), outage management, technical-issue workflow (48h SLA, 20+ repeat = CX flag), scorecard & coaching, cross-skill, internal chat, notifications, reports/exports, audit log, guard team, integrations (Ameyo/Sprinklr/Odoo).

**Explicitly agreed exclusions / not-now:** see §9.

**Full target spec per module:** `CLAUDE.md` §6–33 (master instructions) and the sibling `docs/master/MODULE_SPECIFICATIONS.md`.

---

## 3. Final Business Rules — Summary Table

> **Master source:** `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (the doc wins over code).
> Numbered rule IDs (BR-XXX-###) with full statements live in the sibling
> `docs/master/WFM_BUSINESS_RULES_LIBRARY.md`. This table is the executive index — do not fork it.

| Area | Rule (Confirmed) | Canonical § |
|---|---|---|
| Identity | `person_no` is THE person key; intern 6xxxx + full-time 1xxxx collapse to one; `is_active` = canonical-dedup NOT employment; function is **per-month** from the schedule; match by ID never name-only | Rules §1 |
| Week / cut-off | Week starts **Saturday**; cut-off cycles: full-time 15→14, interns 1→end, Bahrain 25→24; permission balance renews per cycle = **6h + 3 permissions**, only Approved counts | Rules §2 |
| Shifts | Timing sheet is the shift dictionary source of truth (145+ codes). Standard shift 9h incl. 1h break; `20` codes & supervisory roles 8h; Ramadan 7h; ONE canonical shift-category mapping (Morning: M,B,C,AM…; Evening: E,EE20; Night: N,N20; Midnight: MD,MN,MDR,MNR) | Rules §3 |
| WFH (CORRECTED) | WFH = WFH shift code OR explicit WFH location ONLY — **never** inferred from system-login-without-punch (that is office + missing punch) | Rules §4 |
| Reconciliation | Combine BOTH systems (Ameyo ∪ Sprinklr; Ameyo-first session selection); Sprinklr times are LOCAL; credible tardiness = 7..240 min (**>6 min tolerance**); approved permission never lowers conformance; full-shift span = gross 9h incl. break; no-punch-AND-no-system → flagged + `worked_min=0`, role-blind | Rules §5, §19 |
| Cross-midnight | A shift belongs **entirely to its START day** — for attendance, OT, permissions, sick, leave, swaps, every request type | Rules §19 |
| Overtime | **TRUE_OT = ot_min + offday_ot_min + holiday_ot_min** (3 DISJOINT buckets — sum, never subtract); OFF/holiday OT must be evidence-backed; bleed guards; 180h/year cap report | Rules §6 |
| Holidays | Worked scheduled shift on official holiday → WHOLE shift = holiday OT; annual leave landing on a holiday counts as the HOLIDAY and returns to leave balance; holidays editable (`recon-config.json` + `holidays` table) | Rules §18–19 |
| Maternity / female | MATERNITY_7H = person_no 12375/12434 (7h window, excluded from EARLY-OUT only); female agents: up to C (20:00), N only if operationally necessary (flag), never MD/MN without logged override; configurable, not hardcoded | Rules §7 |
| Rest / fairness | Min rest 10h between shifts (cross-midnight aware); fairnessScore = 100 − stdev of night/midnight load; weekend-OFF fairness separate; optional night-team carve-out | Rules §8 |
| Scorecard | Per-function KPI bands, round-half-up, sick-day penalty (1=−2%, 2+=−5%), quiz-commitment −5; `scorecard_entries` = ONE month only, `scorecard_monthly` = Net Points only | Rules §9 |
| Schedule lifecycle | Draft → Generated → Reviewed → Published → Locked; published is NEVER overwritten by Generate; manual edits = validation + audit + versions + before/after impact | Rules §10 |
| Ingest safety | A partial upload may only ever replace **its own date range**, never the rest of the month; `roster_days_recon_bak` refreshed each run (undo-last-ingest) | Rules §20 |
| Leaders / roles | ALL roles must open the system (role-blind no-evidence flag); leaders stay **record-only for deductions** (system-open flag only) | Rules §19 |

---

## 4. Final Modules — As-Built List

Backend modules (`backend/src/modules/`): auth, users, employees, employee-merge, attendance, attendance-recon (the roster/reports engine), attendance-corrections, schedule, schedule-generator, schedule-changes, schedule-rotation, requests, permission-requests, leave-balances, breaks, calendar, campaigns, capacity, forecasting, coverage, dashboard, control-dashboard, rta, outages-mgmt, technical-issues, scorecard, coaching, productivity, skills, workforce-analytics, operations-analytics, attrition, reports, import, integrations (Ameyo/Sprinklr/Odoo), chat, notifications, knowledge-base, agent-self (/me), settings, sla-escalation, smoke-test, kpi-source, llm — plus the guards: health-guard, analyst, reporter, security-guard, scorecard-guard, researcher, expert, advisor, chief, automode, bots, diagnostics, knowledge-ledger, team-learning.

Key frontend routes (of ~80 pages): `/command-center` (exec home) · `/roster` + RosterDashboard · `/schedule` + ScheduleGenerator/ScheduleDemand/ScheduleAnalysis/ScheduleChangeLog · `/capacity` · `/forecasting` · `/rta` · `/requests` · `/scorecard` + ScorecardBoard/AgentScores/Trends · `/agent-360`, `/team-360`, People360 · `/ot-exceptions`, `/wfh-hr-report`, `/report-builder`, `/dashboard-builder`, `/data-quality`, `/interval-headcount`, `/hourly-analytics`, `/system-audit` · `/chief` (guards face) + Diagnostics/KnowledgeLedger/TeamLearning · 6 tabbed hubs (`HubTabs` + `?tab=`): AttendanceHub, SchedulingHub, LiveOpsHub, WorkspaceHub, EmployeesHub, AnalyticsHub · AgentHome (`/me` self-service).

Key endpoint families: `attendance-recon/roster-v2/*` (agent-360, agent-performance, agent-progress, agent-period-compare, team-360, trends, scorecard, hr-matrix, integrity, employee-master, coverage-impact, interval-headcount, ot-exceptions+/export, wfh-hr-report+/export, fairness, hourly, generate/generate-week/publish/unpublish, schedule-change/swap/revert, schedule-lock, schedule-analysis), `POST /attendance-recon/recon-refresh` (Upload & Rebuild), `report-builder`, `/me/overview` + `/me/attendance`.

> Full per-module specs, endpoints and data contracts: `docs/master/MODULE_SPECIFICATIONS.md` and `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md`.

**Needs Approval (D-068 — awaiting the Director's go):** the 2026-07-01 page-consolidation plan — extend the proven 6-hub `?tab=` shape to ~10–12 sidebar entries (Roster Reports hub, Scorecard hub, Capacity & Coverage hub, Chief branch, Command Center as sole executive home). Do NOT restructure nav before the Director's go.

---

## 5. Final Roles — RBAC Access Model (Confirmed 2026-06-20, migration 040)

| Role | Access |
|---|---|
| **Admin** (platform_admin) | Everything, including settings (162/162 GETs verified) |
| **RTA + Team Leader** | "Like admin but cannot change settings": every permission EXCEPT `settings.edit`, `admin.*` (roles/functions/shift_codes), `users.*` |
| **Agent** | Own data only (self-scoped by employee_id): `/me/overview`, `/me/attendance` (`attendance.view_own`), own requests/schedule/coaching/scorecard; ~43 GETs reachable, pure-WFM endpoints 403 |
| Other seeded roles | WFM Analyst/Supervisor, Operations Manager, HR, IT Admin exist in the role tables; the four scopes above are the verified live model |

Verified with `node scripts/smoke-get.js` per role; 0×5xx all roles. Sensitive actions audited. Guard pattern: class-level `@RequirePermissions` for pure-WFM controllers, method-level self-scope for agent-submittable resources.

---

## 6. Final Workflows

### 6.1 Monthly data refresh (THE base pipeline — `docs/RECON_PIPELINE.md`)
```
Director's month files → Desktop/new roster/   (CC Schedule "Shifts."/"Final" sheet = authority,
                                                Odoo Fingerprint, Permission & Compo, Ameyo, Sprinklr)
→ node scripts/recon-refresh.js   (or Roster "Upload & Rebuild" button / POST /attendance-recon/recon-refresh)
   = recon-extract-foundation-v2 → recon-build (ENGINE: every agreed rule) → recon-ingest (backup + replace
     ONLY the uploaded date range) → live roster_days
→ every roster-v2 report / HR Matrix / schedule overlay refreshes automatically
Restore: node scripts/recon-ingest.js --restore   (roster_days_recon_bak)
```
**Why it never regresses:** every rule (holiday OT, hr_code master codes, worked_min clamp, cross-midnight start-day, leave-on-holiday, tolerance >6min, WFH rule…) is computed **inside `recon-build.js`**, so each refresh re-applies it. If a report looks wrong after a refresh, the rule belongs in the engine — never patch the data.

### 6.2 Schedule generate → publish → lock
`roster-v2/generate` (hourly demand → greedy shift mix) → `generate-week` (per-employee week; female no-midnight, night→least-loaded, OFF→weekend-deprived) → save draft → **publish** into the first EMPTY future week of `attendance_records` (atomic `INSERT … ON CONFLICT DO NOTHING`, tagged `[generated <week>]`, fully reversible via unpublish) → Reviewed → Published → Locked (Unlock exists; soft-lock = admin-edit-with-audit; auto soft-lock on upload). Published schedules are never overwritten by Generate.

### 6.3 Requests → approval
Request envelope + extension tables. Submit (with attachments where applicable) → approver chain (shift swap: peer acceptance FIRST, then TL/WFM) → **HC-impact panel reads canonical `roster_days`** (before/after coverage, red warning on gap) → approve/reject with audit → schedule/balance side-effects (leave ledger draws down `duration_days` minus official holidays inside annual-leave spans). SLA escalation loop auto-escalates overdue requests; Auto Mode may auto-approve only **safe-surplus** cases.

---

## 7. Final Decisions — Top 20

> Full dated log with IDs: sibling `docs/master/DECISIONS_AND_AGREEMENTS_LOG.md` — the **canonical
> D-### register; the IDs below cite it** — and `WFM_RULES_AND_DECISIONS.md` §16–20. The load-bearing twenty:

1. **D-038 / D-050** `roster_days` is the canonical reporting spine; rules live IN the recon engine so every refresh re-applies them (2026-06-29/30).
2. **D-032** WFH rule corrected: code/location only, never inferred from system-no-punch (2026-06-24; 1730 live rows fixed).
3. **D-036** TRUE_OT = 3 disjoint buckets summed (verified no double-count, 2026-06-24).
4. **D-053** Tardiness tolerance **> 6 min** (`HR_MIN=7`; CRED 7..240) (2026-06-30).
5. **D-054** Full-shift span = gross hours incl. break (9h, not net 8h) (2026-06-30).
6. **D-058** Cross-midnight shift owned entirely by its START day, for everything (2026-06-30).
7. **D-059** Annual leave on an official holiday counts as the holiday and returns to the balance (2026-06-30).
8. **D-055** No-punch-AND-no-system working day → flagged, `worked_min=0`, role-blind (2026-06-30).
9. **D-056** All roles must open the system; leaders stay record-only for deductions (system-open flag only) (2026-06-30).
10. **D-044** Session selection = **Ameyo-first**, Sprinklr fills gaps (not min/max union); official late/early basis = SYSTEM times (2026-06-28). Future: Director plans Sprinklr-only (`RECON_SYS_MODE`) — flip only when he says go.
11. **D-052** Engine trusted over manual after the May30–Jun27 diff ("مبدئيا انت ادق مني") (2026-06-30).
12. **D-065** Ingest deletes only its own uploaded date range; backup refreshed every run (post-incident, commit b7b833d) (2026-07-01).
13. **D-062** Jan–May left AS-IS (already consistent; a prior refresh regressed — dry-run-first discipline) (2026-06-30).
14. **D-074** RBAC final model: admin=all; RTA+TL=admin-minus-settings; agent=own + /me (2026-06-20).
15. **D-040** Publish is additive-only into the first empty future week; never overwrites (verified live).
16. **D-030** Maternity 7h set = 12375/12434, excluded from early-out only; extend only as HR confirms.
17. **D-025** Sidebar shows only the **Chief**; guards run behind it; Auto Mode = safe-surplus only (D-026). Declined: self-modifying code (D-069), fake "counterfactual" scores (D-070) — verified-data-only.
18. **D-027** Design: 3 themes, dazzle kit for KPIs, light-mode near-black net, **NO animated background** (removed — do not re-add, D-071).
19. **D-051 / D-061** Schedule cell shows the shift code DIRECT (no `-WFH` suffix; WFH = 🏠 icon + texture); friendly bilingual status labels classified by `hr_code` first.
20. **D-057** Never-closed Sprinklr sessions: **Deferred** — leave as-is, login-only recovery NOT enabled (revisit when the method is verified) (2026-06-30).

---

## 8. Assumptions (Confirmed working assumptions)

- Chat/WhatsApp concurrency = **4** conversations per employee; intern productivity ≈ **70%** (configurable).
- The Director's monthly workbook (Timing/Shifts sheets) is the shift-dictionary and roster authority; source-of-truth priority = latest Director clarification > real workbook > `WFM_RULES_AND_DECISIONS.md` > older assumptions > generic WFM practice.
- Source reliability: Schedule = truth for OFF/work/leave; Ameyo ready-end reliable (drop >16h bleeds); Sprinklr raw sessions bleed (prefer AGENT_OCCUPANCY; times are LOCAL); Odoo trusted for holidays + punch, NOT individual leave (goes stale); punch = office only.
- Off-day OT is the one less-certain field (system-only, bleed-guarded) — verify before trusting.
- `unconfirmed` presence for low-capture roles (<70% observed) so RTA/supervisors/social agents aren't falsely marked absent during capture gaps.

---

## 9. Exclusions / Deferred (agreed NOT now)

- Cloud/production deployment (Docker+nginx plan exists in memory `production_deployment`), MFA/SSO, email/Teams/push notification channels, CRM/HR-system/telephony API integrations beyond the extension bridges, PDF export — all **future**.
- Internal chat is an operational layer, not a Teams replacement.
- Jan–May cross-midnight de-bleed (Rule B): needs a per-month recon rebuild when those months' prepared sources are loaded — deliberately deferred.
- Number-changing refactors deferred for supervised execution: shift-category unification (6 conflicting code sites per the 2026-07-01 audit), `sc` CTE person-grain fix, legacy `roster_daily` re-ingest, `ot_before/after` emission (see §11).
- Nav consolidation plan awaits the Director's go (§4).
- Declined outright: self-modifying code for guards; fabricated/counterfactual KPIs; any KPI granularity beyond what the data holds (single-month `scorecard_entries`).

---

## 10. Key Lessons Learned (institutional memory — do not relearn the hard way)

1. **The partial-upload data-wipe incident (2026-07-01):** a Jun 28–30 test upload wiped Jun 1–27 because ingest hardcoded a whole-month DELETE. Fix: delete only the uploaded range + per-run backup. Lessons: **never hardcode destructive ranges; refuse to delete without dated records; keep a true undo (`roster_days_recon_bak`) and a full snapshot (`roster_days_predisaster`).** The RULES were never lost — only a data snapshot rolled back, because rules live in the engine.
2. **"Rules live IN the engine"** — the recurring "it worked, then a refresh broke it" bug (HR Matrix losing SL/A/L/H semantics) was rules patched into data instead of computed in `recon-build.js`. Any rule not in the engine is overwritten on the next rebuild.
3. **Dry-run first, always:** a prior update-files refresh REGRESSED live data. Pattern: `ROSTER_OUT_TABLE=scratch` dry-run + diff vs live before promoting. Jan–May was kept as-is on this evidence.
4. **Backup discipline:** every ingest is one transaction with a fresh backup; restore path tested.
5. **Two tables, never cross-wire:** rich `roster_days` (reports) vs thin `roster_daily` (legacy /upload+/ingest+/dashboard, which auto-ingests when count==0 — a landmine).
6. **Local-date discipline:** `fmtLocal` + `snapToSaturday`, never `toISOString()` (UTC off-by-one made 3-OFF weeks); `work_date::text` in SQL.
7. **Fairness beats aggression in reconciliation:** flag ambiguous cases (Manual Review) instead of auto-deciding; always surface raw late/early even when excused; the Odoo-absence→system-verified-WFH rescue saved 324 falsely-absent days.
8. **Prototype-era lesson:** no duplicate top-level `let/const` across script blocks; no giant single-file HTML; module-by-module (plan→implement→test→verify); never call mock data complete.
9. **Security:** never `npm audit fix --force` (downgrades NestJS). An unanchored `coverage/` gitignore once hid a whole source module.
10. **Date drift:** cap report date anchors `<= CURRENT_DATE` (`attendance_records` carries future rows); per-day report defaults must skip marker-only tail days (lone RES/TER).

---

## 11. Critical Implementation Notes (read before touching code)

- **`roster_days` vs `roster_daily`:** roster_days = RICH canonical (person_no/role_function/hr_code/OT buckets…), built by the recon engine — all roster-v2/hr-matrix/agent-360/ot-exceptions read it. roster_daily = THIN legacy written by `/upload`+`/ingest`, feeding only the legacy `/dashboard`,`/metric`,`/overtime` path. **Never cross-wire.**
- **TypeORM/PG gotchas:** `ds.query()` has no `.rowCount`; `INSERT…RETURNING` → flat rows (count=length) but `DELETE/UPDATE…RETURNING` → `[rows, count]` tuple; separate `BEGIN`/`COMMIT` via `ds.query()` = FAKE transaction (pooled connections) → one atomic statement or a QueryRunner. Quote camelCase aliases and reserved words (`"month"`, `AS "hour"`); `permission_duration` is TEXT (a time-window string — parse, don't SUM); `SUM(x) FILTER … DESC` sorts NULLS-FIRST → `COALESCE(…,0)` + `DESC NULLS LAST`.
- **Identity join:** aggregate by `person_no` via `employee_identity`; attach scorecard via the **`sc` CTE** pattern (clash-free key). Known open drift: the sc CTE fans out 1:N per-day in grouped report-builder views → day-weighted averages; fix at person grain (deferred, number-changing).
- **Sprinklr login/logout are LOCAL time, not UTC** (no +3). Read workbook serials RAW (`cellDates:false`).
- **Metric consts** at the top of `recon.controller.ts`: `TRUE_OT`, `CRED_LATE`/`CRED_EARLY` (7..240), `MATERNITY_7H` — every report must use them; raw per-row exports stay raw (analyst ground truth).
- **HR Matrix cell** = `COALESCE(hr_code, attendance_code, shift_code, 'OFF')` — never an `ELSE 'P'` catch-all.
- **Design:** verify every new page in Light + Glass; new near-black inline backgrounds must join the light-mode net allow-list or use a covered hex; no inline `color:'#fff'`; no animated background.
- **Known open drifts (fix ONLY with the Director's eyes on it — they change numbers):** shift-category defined 5–6 conflicting ways (canonical mapping in Rules §3); sc-CTE day-weighting; legacy `roster_daily` re-ingest to surface the WFH fix; `ot_before_min`/`ot_after_min` NULL after recon ingest; dead code (`Nx*`+`sevColor` in ds.tsx, orphan `common/wfm-calc.ts`).
- **June 2026 data state (2026-07-01):** June rows = the pre-incident backup (2733 rows/103 people) + SQL re-apply of username/hr_code/attendance_code/presence/leave-on-holiday; still missing until a full rebuild with the Director's PREPARED source files: cross-midnight de-bleed + the 13 extra people (116-employee foundation). Jan–May intact.

---

## 12. REBUILD INSTRUCTIONS

If this platform (or an agent's knowledge of it) must be reconstructed from zero:

1. **Follow `docs/master/REBUILD_PROMPT_AND_OPERATING_INSTRUCTIONS.md`** — the operating prompt, session bootstrap, and step-by-step rebuild order. That file is the executable version of this memory.
2. Load, in order: `CLAUDE.md` (master instructions + module spec) → `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (every rule; doc wins over code) → `docs/RECON_PIPELINE.md` → `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md` → `docs/knowledge/DESIGN_SYSTEM.md` → the sibling `docs/master/*` files (WFM_BUSINESS_RULES_LIBRARY, MODULE_SPECIFICATIONS, DATA_DICTIONARY, DASHBOARDS_AND_REPORTS, DECISIONS_AND_AGREEMENTS_LOG, SYSTEM_LEARNINGS_AND_IMPROVEMENTS, IMPLEMENTATION_ROADMAP, AI_AND_AUTOMATION_OPPORTUNITIES).
3. The portable skills rebuild everything without further input: **`enterprise-wfm-platform`** (the master operating skill — routing, standards, memory protocol), **`wfm-system`** (full knowledge base), **`mini-me`** (assistant clone incl. confirmed rules), **`scorecard-builder`** (monthly scorecard). They live in `.claude/skills/` (version-controlled).
4. Data comes back via the recon pipeline: place the Director's month files in `Desktop/new roster/`, run `node backend/scripts/recon-refresh.js` per month — every rule re-applies automatically. Never bulk-rebuild months that are already consistent without a dry-run diff.
5. Operating covenant with the Director: audit before coding; plan and get approval before executing; distinguish Confirmed vs Recommended; never fake completion or hide mock data; never execute a new/changed rule before agreement; do not restart the project — continue from the latest approved state.
