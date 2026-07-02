---
name: enterprise-wfm-platform
description: >-
  The master operating skill for the Boutiqaat Contact-Center Enterprise WFM platform — a REAL,
  RUNNING system (NestJS + React/Vite + PostgreSQL, live contact-center data). Use for ANY Boutiqaat
  WFM work: scheduling & auto-generation, roster reconciliation & recon-refresh rebuilds, attendance,
  tardiness/conformance, overtime (TRUE_OT), WFH, leave/permissions/swaps, maternity & female rules,
  scorecards, capacity/Erlang, forecasting, RTA, dashboards & report building, data-dictionary or
  rules questions, audits, documentation updates, and full knowledge rebuilds. Routes every task to
  the canonical docs/master/ + docs/knowledge/ files, enforces the Confirmed-vs-Recommended
  discipline, and carries the MEMORY UPDATE PROTOCOL for persisting new rules and decisions.
---

# Enterprise WFM Platform — Master Operating Skill

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> Companion skills: `wfm-system` (reference knowledge base), `mini-me` (assistant clone),
> `scorecard-builder` (monthly scorecard). This skill is the OPERATING layer: where the truth lives,
> the top rules, the standards for every output type, and the protocol for persisting new knowledge.

---

## 1. When to use

Invoke this skill for **any** work on the Boutiqaat Contact-Center WFM system:

- Scheduling, schedule generation, rotation, publish/lock, swaps.
- Roster reconciliation, `recon-refresh` / Upload & Rebuild, ingest, data fixes.
- Attendance, tardiness, conformance, OT, WFH, leave, permissions, no-show questions.
- Scorecard, coaching, capacity/Erlang, forecasting, RTA, fairness.
- Dashboards, reports, report-builder work, exports.
- ANY business-rule question ("what counts as late?", "who owns a cross-midnight shift?").
- Audits, correctness reviews, data-integrity checks ("review", "make sure it's fine" = DEEP audit).
- Documentation updates and full knowledge rebuilds (new session / new agent).

**Do not** answer WFM questions from generic WFM knowledge. Every material claim must trace to a
source doc, memory note, code path, table, endpoint, or a confirmed decision (see §12 ALWAYS-check).

---

## 2. Project context (one page)

| Item | Value |
|---|---|
| Product | Boutiqaat Contact Center WFM platform — enterprise-grade (NICE/Verint/Calabrio class) |
| Owner | The **WFM Director** at Boutiqaat (Kuwait). Deep domain expertise. Approves every rule before it executes. Works in Levantine Arabic; keep codes/SQL English. |
| Status | **REAL and RUNNING** on live data — NOT a prototype. ~80 frontend pages / 66 routes, ~60 backend modules, a standalone reconciliation engine, an autonomous guard team (8 guards + Chief). |
| Backend | NestJS + TypeScript + TypeORM (`synchronize:false`, SQL migrations ~067), JWT + rotating refresh, RBAC, audit log. Runs compiled `dist` (`npm run build` → `node dist/main.js`; restart to apply changes). |
| Frontend | React + TS + Vite; Arabic/English inline `ar?'..':'..'`; RTL/LTR; 3 themes (Dark / Light / Aurora-Glass); dazzle kit `components/dazzle.tsx`. NO animated background. |
| Database | Live local PostgreSQL **`wfm_db`** — real data (~162 employees, 126 tables, tens of thousands of roster/attendance rows). Access via `backend/scripts` + `.env` `POSTGRES_*`. |
| Data spine | **`roster_days`** (74 cols) — the RICH canonical per-person-per-day table built by the recon engine (`backend/scripts/recon-build.js` et al.) from the Director's real month files (`Desktop/new roster/`). Every `roster-v2/*` report reads it. **`roster_daily`** is a THIN legacy table — never cross-wire (BR-ING-002). |
| Refresh | `node scripts/recon-refresh.js` or the Roster **Upload & Rebuild** button (`POST /attendance-recon/recon-refresh`). Every agreed rule is re-applied on each rebuild — rules live IN the engine, never patched into data. Runbook: `docs/RECON_PIPELINE.md`. |
| Integrations | Ameyo (telephony) + Sprinklr (omnichannel) Chrome-extension bridges; Odoo (holidays, biometric punch, permissions/comp/sick). Sprinklr times are LOCAL Kuwait, not UTC. |
| RBAC | Admin = everything · RTA + Team Leader = admin minus settings/users · Agent = own data (`/me/*`). Migration 040; verified 0×5xx per role. |
| Engine trust | Validated vs the Director's manual reconciliation (login 93% / late 96% / early 95% match; **0 cases the engine was clearly wrong**) — Director's verdict: the engine is the trusted source. |

**Canonical knowledge map (one master source per fact — cross-reference, never fork):**

| File | Role |
|---|---|
| `docs/knowledge/WFM_RULES_AND_DECISIONS.md` | **THE single source of truth** for every rule & decision (§1–20). If code conflicts, the RULE wins — fix the code. |
| `docs/master/MASTER_PROJECT_MEMORY.md` | The project brain: what exists, what is live, top decisions, lessons. |
| `docs/master/WFM_BUSINESS_RULES_LIBRARY.md` | Every rule with an ID (BR-XXX-###), status, source, enforcing code path. |
| `docs/master/MODULE_SPECIFICATIONS.md` | Per-module AS-BUILT + target spec, endpoints, acceptance criteria. |
| `docs/master/DATA_DICTIONARY.md` | Live-verified column-level dictionary of `wfm_db` (provenance codes E/I/U/S/D). |
| `docs/master/DASHBOARDS_AND_REPORTS.md` | Every dashboard/report: purpose, KPIs, endpoint, roles, caveats. |
| `docs/master/DECISIONS_AND_AGREEMENTS_LOG.md` | Chronological D-### register (Confirmed / Recommended / Needs Approval / Declined / Deferred). |
| `docs/master/SYSTEM_LEARNINGS_AND_IMPROVEMENTS.md` | L-### learnings + R-### open risks/drifts. |
| `docs/master/IMPLEMENTATION_ROADMAP.md` | Phase 0 (live) → hardening → target phases, UAT, go-live. |
| `docs/master/AI_AND_AUTOMATION_OPPORTUNITIES.md` | Guard team as-built + automation catalogue + AI governing principles. |
| `docs/master/REBUILD_PROMPT_AND_OPERATING_INSTRUCTIONS.md` | Paste-ready restart prompt, operating covenant, reading order, memory protocol. |
| `docs/RECON_PIPELINE.md` | The roster refresh runbook (one command; restore path). |
| `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md` | Engine mechanics, `roster-v2/*` endpoints, SQL patterns, PG gotchas. |
| `docs/knowledge/DESIGN_SYSTEM.md` | UI/theme standards (read before ANY UI work). |

---

## 3. Final WFM business rules — TOP 25

> **Master library:** `docs/master/WFM_BUSINESS_RULES_LIBRARY.md` (every rule, full statements,
> status, source, enforcing code path). Canonical text: `docs/knowledge/WFM_RULES_AND_DECISIONS.md`.
> All rows below are **Confirmed**. This is the executive index — do not fork it.

| # | BR-ID(s) | Rule (compressed) |
|---|---|---|
| 1 | BR-TIM-001 | **Week starts Saturday** (Sat→Fri). Use `fmtLocal`+`snapToSaturday`; never `toISOString()` for local dates. |
| 2 | BR-TIM-002 | **Cut-off cycles:** full-time 15→14, interns 1→end of month, Bahrain 25→24. All OT/attendance/permission accounting buckets by cycle, not calendar month. |
| 3 | BR-TIM-003 | **Cross-midnight shift is owned entirely by its START day — for EVERYTHING** (attendance, OT, permission, sick, leave, swaps, every request type). |
| 4 | BR-SHF-001/002/003 | Standard agent shift = **9h incl. 1h break**; `20`-codes & supervisory roles = 8h (AM=8h ≠ M9; Customer Care = 9h); Ramadan = 7h (some split). |
| 5 | BR-SHF-004 | The workbook **Timing sheet is the ONLY shift-code dictionary** (145+ codes; S=sick, A=absence suffixes; OFF/H/L/SL/DL/COMP/RES/TER non-working). Never hardcode a subset. |
| 6 | BR-SHF-005 | **Canonical shift times** (never invent): M 07–16 · B 09–18 · C 11–20 · N 13–22 · E 16–01 · EE 18–02 · MD 22–07 · MN 23–08 · M7-3 07–15 · B20 10–18 · C20 11–20 · N20 14–22 · M20 08–16 · CCNO 09–17. No real shift ends at 21:00. |
| 7 | BR-SHF-006 | **THE ONE shift-category mapping:** Morning = M,B,C,AM (+20s, WFH-M/B, M7-3, B7) · Evening = E,EE20 · Night = N,N20 (+WFH-N) · Midnight = MD,MN,MDR,MNR. OFF/H/L/S/A/COMP excluded from working shift-rate. |
| 8 | BR-SHF-007 | **Shift Rate % = shift-distribution, NOT pay** — counts + % (YTD/MTD/period) with before/after impact on every edit/swap (both employees on a swap). |
| 9 | BR-GEN-001/002/003 | **Female agents:** up to C (ends 20:00); N only if operationally necessary (always flagged; explicit exception paths); **never MD/MN** except a logged, audited manual override. Configurable, never hardcoded. Males: any shift. |
| 10 | BR-RST-001 · BR-OFF-001/002 | **Min rest 10h** between shifts (cross-midnight aware; override warns + audits). **Exactly 2 OFF/week**, never 3+ consecutive OFF. |
| 11 | BR-ROT-001/003 | fairnessScore = 100 − stdev of night+midnight load over the FAIR POOL (night-team carve-out excluded, migration 065). **Fairness basis = PRE-SWAP** — approved swaps never game rotation. |
| 12 | BR-OT-001 | **TRUE_OT = ot_min + offday_ot_min + holiday_ot_min — 3 DISJOINT buckets, always SUMMED** (never subtract; `ot_min` alone undercounts ~28%). Const in `recon.controller.ts`, used by every report. |
| 13 | BR-OT-003 | Worked scheduled shift on an official holiday → the **WHOLE shift = `holiday_ot_min`** (capped at scheduled net); regular OT = 0; presence stays office/wfh. |
| 14 | BR-OT-004/005 | OFF/holiday OT must be **evidence-backed** (punch span ≤13h); system-only → flagged, skipped. Bleed guards: OT window ceiling 5h; ≤2h auto-accepted, >2h flagged for review. |
| 15 | BR-LVE-001 | **Annual leave landing on an official holiday counts as the HOLIDAY and RETURNS to the leave balance** (hr_code='H'; balance side: `EFFECTIVE_DAYS` subtracts holidays in the span). |
| 16 | BR-LVE-002 | HR-matrix codes: sick = **`SL`**, absent = **`A`** — never invent "P". Cell = `COALESCE(hr_code, attendance_code, shift_code, 'OFF')`; shift-aware raw codes (MS/MA…) stay in `attendance_code`. |
| 17 | BR-ATT-001/002 | **Combine BOTH systems** (Ameyo ∪ Sprinklr; **Ameyo-first** session selection, Sprinklr fills gaps). Official late/early basis = SYSTEM login/logout vs schedule. Sprinklr times are LOCAL, not UTC. |
| 18 | BR-ATT-005 · BR-ROL-001/002 | **No punch AND no system login on a working day → FLAGGED, `worked_min=0`, role-blind** (never silently absent, never credited hours). ALL roles must open the system; supervisory roles (TL/Senior/RTA/Resolution/WFM) stay **record-only for deductions**. |
| 19 | BR-ATT-008 | Identity: **`person_no` is THE person key** (intern 6xxxx + full-time 1xxxx collapse via `employee_identity`); match by **ID, never name-only**; `is_active` = canonical-dedup NOT employment; function is per-month from the schedule. |
| 20 | BR-WFH-001 | **WFH = WFH shift code OR explicit WFH location OR Odoo Status=WFH — NEVER inferred from "system login + no punch"** (that is office + missing punch). Corrected 2026-06-24; 1,730 rows fixed. |
| 21 | BR-PRM-001/003 | Only an **Approved** permission covers late/early (Pending → Manual Review; approved permission NEVER lowers conformance). Balance = **6h + 3 permissions per cut-off cycle**. `permission_duration` is a text time-window — parse, never SUM. |
| 22 | BR-TRD-001/002/003 | Tardiness tolerance **>6 min** (`CRED_LATE`/`CRED_EARLY` = 7..240; cap at 240 excludes cross-midnight bleed as DQ). **Full-shift span = GROSS hours incl. break** (9h span, not 8h net) = "completed". |
| 23 | BR-MAT-001 | **MATERNITY_7H = person_no 12375/12434** — 7h window, excluded from **EARLY-OUT only** (late-in and OT still count); `*7` codes = 7h days. Extend only as HR confirms. |
| 24 | BR-APP-001 | Schedule lifecycle **Draft → Generated → Reviewed → Published → Locked**; a published schedule is **NEVER overwritten by Generate**; post-publish edits = validation + audit + versions + before/after impact; Unlock exists. |
| 25 | BR-ING-001/002/005 | **Ingest safety:** a partial upload may only replace **its own date range** (never the rest of the month); `roster_days_recon_bak` refreshed every run (true undo). `roster_days` (rich) vs `roster_daily` (thin legacy) — **never cross-wire**. **Rules live IN the engine** — a rule patched into data is overwritten on the next rebuild. |

**The standing meta-rule (BR-APP-006 / D-000):** *no new or changed business rule is EXECUTED before
the Director's explicit agreement.* Everything not yet agreed is presented as **Recommended** — never
dressed as an agreed rule.

---

## 4. Final module list

> **Full per-module specs** (purpose, AS-BUILT, rules, endpoints, risks, acceptance):
> `docs/master/MODULE_SPECIFICATIONS.md`. Engine/report mechanics: `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md`.

**Backend (`backend/src/modules/`):** auth · users · employees · employee-merge · attendance ·
**attendance-recon** (the roster/reports engine — `roster-v2/*`) · attendance-corrections · schedule ·
schedule-generator · schedule-changes · schedule-rotation · requests · permission-requests ·
leave-balances · breaks · calendar · campaigns · capacity · forecasting · coverage · dashboard ·
control-dashboard · rta · outages-mgmt · technical-issues · scorecard · coaching · productivity ·
skills · workforce-analytics · operations-analytics · attrition · reports · import · integrations
(Ameyo/Sprinklr/Odoo) · chat · notifications · knowledge-base · agent-self (`/me`) · settings ·
sla-escalation · smoke-test · kpi-source · llm — plus the **guard team**: health-guard, analyst,
reporter, security-guard, scorecard-guard, researcher, expert, advisor, **chief**, automode, bots,
diagnostics, knowledge-ledger, team-learning.

**Key frontend routes (of ~80 pages):** `/command-center` (exec home) · `/roster` + RosterDashboard ·
`/schedule` (+ Generator / Demand / Analysis / ChangeLog) · `/capacity` · `/forecasting` · `/rta` ·
`/requests` · `/scorecard` (+ Board / AgentScores / Trends) · `/agent-360`, `/team-360`, People360 ·
`/ot-exceptions` · `/wfh-hr-report` · `/report-builder` · `/dashboard-builder` · `/data-quality` ·
`/interval-headcount` · `/hourly-analytics` · `/system-audit` · `/chief` (+ Diagnostics /
KnowledgeLedger / TeamLearning) · 6 tabbed hubs (`?tab=`): Attendance, Scheduling, LiveOps,
Workspace, Employees, Analytics · AgentHome (`/me`).

**Standalone engine (not a Nest module):** `backend/scripts/recon-*.js`
(recon-extract-foundation-v2 → recon-build → recon-ingest, orchestrated by recon-refresh) +
`import-roster-master.js` + `backfill-identity.js`.

**Recommended (awaiting the Director's go — do NOT execute):** the 2026-07-01 nav consolidation plan
(~10–12 sidebar hubs: Roster Reports, Scorecard, Capacity & Coverage, Chief branch, Command Center
as sole exec home).

---

## 5. Documentation standards

- **One master source per fact.** New rule text goes in `WFM_RULES_AND_DECISIONS.md`; every other
  file summarizes + cross-references ("see RULES §7") — never a divergent copy. If two docs disagree,
  the canonical doc wins; fix the other.
- **Status tags are mandatory and rigorous:** **Confirmed** (agreed with the Director / recorded) vs
  **Recommended** (needs approval) — plus, in the decisions log: Needs Approval / Declined / Deferred.
- **IDs everywhere:** rules `BR-<domain>-###`, decisions `D-###`, learnings `L-###`, risks `R-###`,
  recommended dictionary changes `REC-###`. Tables over prose; numbered headings.
- Every material claim traces to a source: doc §, memory note, code path (`file:line` where useful),
  table, endpoint, migration number, or commit hash. **No generic WFM boilerplate.**
- Date-stamp doc headers (`Last rebuilt: YYYY-MM-DD`) and dated decisions.
- Professional English; keep canonical shift codes (M, B, C, N, E, MD, MN, WFH-*, SL, A, H, L, COMP,
  RES, TER, M7-3, B7, N20 …) and all system identifiers exactly as-is. The Director's Arabic phrasing
  may be quoted where it IS the decision ("ما بدي اظلم حد").
- Document the **AS-BUILT truth first**, then the target spec.

## 6. Audit checklist (for any "review / make sure it's fine" request)

"Review" means a **DEEP correctness & data-integrity audit**, never a surface render check:

1. **Rules vs code:** does the code implement RULES / the BR library exactly? (doc wins — fix code).
2. **Metric constants:** every report uses `TRUE_OT`, `CRED_LATE`/`CRED_EARLY` (7..240),
   `MATERNITY_7H` from `recon.controller.ts` — no local redefinitions.
3. **Table discipline:** reads from `roster_days` (never `roster_daily`); aggregation by `person_no`;
   scorecard joins via the `sc` CTE; date anchors capped `<= CURRENT_DATE`.
4. **Date safety:** `fmtLocal`/`snapToSaturday`, `work_date::text` in SQL, no `toISOString()` for
   local dates; cross-midnight = start-day ownership; `*_min > 1440` handled.
5. **PG/TypeORM gotchas:** `ds.query()` has no `.rowCount`; DELETE/UPDATE…RETURNING = tuple;
   no fake `BEGIN/COMMIT` via ds.query (use QueryRunner); quoted camelCase aliases;
   `COALESCE(...,0)` + `DESC NULLS LAST`; `permission_duration` parsed not summed.
6. **Fairness-to-people:** ambiguous evidence → Data Quality, never HR action; raw values still
   surfaced; excluded roles + maternity guards applied.
7. **Ingest safety:** destructive operations scoped to their own date range; backup refreshed;
   dry-run + diff (`ROSTER_OUT_TABLE=scratch`) before promoting any refresh.
8. **UI:** verify in all 3 themes (Light + Glass especially); theme vars, no inline near-black/`#fff`;
   no animated background; EN mode 100% English but inputs accept typed Arabic.
9. **Numbers cross-check:** spot-check totals against a second endpoint or raw SQL; investigate any
   drift instead of explaining it away.
10. **Report honestly:** what works, what is mock/demo, what is broken, what to fix first — with
    open risks (R-###) acknowledged, not hidden.

## 7. Developer-ready output format

When handing work to a developer (or a future session), deliver:

1. **Objective** — one sentence, plus the BR-IDs / D-### it implements.
2. **Files touched** — exact paths (backend module, frontend page, migration number next in sequence).
3. **Data contract** — tables/columns read & written (per DATA_DICTIONARY), endpoints + permissions.
4. **Rule references** — link each behavior to RULES § / BR-ID; flag anything **Recommended** that
   must NOT ship without approval.
5. **Validation plan** — build (`cd backend && npm run build`), restart dist, smoke endpoints per role,
   spot-check numbers vs SQL, verify in 3 themes.
6. **Rollback** — how to undo (backup table, unpublish, `recon-ingest.js --restore`, git revert).
7. **Memory updates** — which docs/master files to update after merge (see §11).
Never fake completion; never present mock data as done; heavy jobs async; audit-log sensitive actions.

## 8. Dashboard standards

(Full catalogue + per-dashboard specs: `docs/master/DASHBOARDS_AND_REPORTS.md` §1–2.)

- **P-1 Verified data only** — every number from a real endpoint over real data; modeled/estimated
  values labelled on-page; fake/counterfactual metrics are DECLINED (D-008 / D-AI-004).
- **P-2 One canonical table** — roster-family reads `roster_days`; badge or retarget anything still
  on `attendance_records`/legacy paths (source-basis badges: 🔵 live / 🟢 corrected / 🟣 12-month).
- **P-3 One metric definition per concept** — the shared consts; no two dashboards may disagree.
- **P-4 Rules in the engine** — a dashboard fix that edits data instead of the engine is wrong.
- **P-5 Never wrongly punish** — HR-grade surfaces route weak evidence to Data Quality.
- **P-6 Exports accompany dashboards** — raw per-row exports stay RAW (analyst ground truth);
  caps/exclusions apply to aggregates and rankings only.
- **P-7 Design system** — dazzle kit (StatTile/Donut/BarRow/Gauge/Sparkline), theme vars, verified in
  all 3 themes; DateRangeBar with Saturday-week presets for date filtering; agent-visible pages
  respect RBAC (`reports.view` etc.).

## 9. Data-dictionary standards

(Master file: `docs/master/DATA_DICTIONARY.md` — live-verified vs `information_schema`.)

- Every field documented with: type, required, **provenance code** (E engine / I imported / U user /
  S system / D derived-at-read), description + validation, example, and the RULES § behind it.
- Conventions: `tenant_id` on all operational tables; `*_min` = minutes from local midnight
  (>1440 = next calendar day, cross-midnight); dates compared as `work_date::text`; weeks Saturday.
- The three "employee-day" tables (`roster_days` / `roster_daily` / `attendance_records`) are never
  interchangeable — restate the distinction wherever confusion is possible.
- Engine-computed (E) columns are **never patched in data** — fix `recon-build.js` and rebuild.
- Schema changes go through numbered SQL migrations (next in sequence); update the dictionary in the
  same change; mark proposals as `REC-###` until approved.

## 10. Risk review standards

(Registers: BUSINESS_RULES_LIBRARY §22, SYSTEM_LEARNINGS R-###, IMPLEMENTATION_ROADMAP risk table.)

- Every open risk gets an **R-###** ID, a status (Open / Data limit / Deferred), and a canonical home.
- **Number-changing fixes require the Director's eyes on** — e.g. R-001 shift-category unification
  (6 conflicting classifiers), R-002 `sc` CTE person-grain fix, R-003 Jan–May cross-midnight rebuild,
  R-004 `ot_before/after` emission. Dry-run + diff + explicit approval before promoting.
- Distinguish **rule risk** (code drifts from a Confirmed rule → fix code now) from **proposal risk**
  (a Recommended change → park until approved).
- Post-incident discipline (learned 2026-07-01): never hardcode destructive ranges; refuse to delete
  without dated records; keep a true undo + full snapshot; write the post-mortem into RULES + the
  learnings file so it survives every rebuild.
- Payroll-sensitive caveats stay visible (e.g. R-005 off-day OT is system-only — verify before use).

---

## 11. MEMORY UPDATE PROTOCOL

When new knowledge is produced (rule confirmed, decision made, module changed…), persist it in the
right master file(s) **in the same session** — the docs are the memory. Routing table:

| New knowledge | Update (in this order) |
|---|---|
| **New / changed business rule** (Director-confirmed) | `docs/master/WFM_BUSINESS_RULES_LIBRARY.md` (new BR-ID + enforcement path) **+** `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (the canonical master text) |
| **New decision / agreement** (incl. Declined & Deferred) | `docs/master/DECISIONS_AND_AGREEMENTS_LOG.md` (next D-###, dated, status-tagged) |
| **Module detail** (spec, endpoint, behavior change) | `docs/master/MODULE_SPECIFICATIONS.md` |
| **Dashboard / report** (new or changed) | `docs/master/DASHBOARDS_AND_REPORTS.md` |
| **Field / table / column** (schema or semantics) | `docs/master/DATA_DICTIONARY.md` |
| **Learning / resolved ambiguity / incident lesson** | `docs/master/SYSTEM_LEARNINGS_AND_IMPROVEMENTS.md` (L-### / R-###) |
| **Automation / AI idea or guard change** | `docs/master/AI_AND_AUTOMATION_OPPORTUNITIES.md` |
| **Rebuild / operating instruction** | `docs/master/REBUILD_PROMPT_AND_OPERATING_INSTRUCTIONS.md` |
| **Project-wide understanding** (state, scope, workflow) | `docs/master/MASTER_PROJECT_MEMORY.md` |

Also keep in sync where applicable: the auto-memory notes
(`~/.claude/projects/.../memory/`), and the `wfm-system` / `mini-me` skill references — the skills
must stay teachable and current. **Commit** documentation updates to git (they ship with the repo).

---

## 12. ALWAYS-check list (non-negotiable)

1. **Before answering ANY WFM question:** read `docs/master/MASTER_PROJECT_MEMORY.md` +
   `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (and the BR library entry for the specific rule).
   Answer from the docs, not from generic WFM knowledge.
2. **Never execute a new or changed rule before the Director's agreement.** Present it as
   **Recommended**, wait for the go, then implement + persist per §11.
3. **Distinguish Confirmed vs Recommended in every output** — never dress a recommendation as an
   agreed rule.
4. **Commit + persist everything:** doc updates per the routing table, git commits for code AND docs,
   memory notes for session-level context. Knowledge that isn't persisted is lost on the next rebuild
   — the same principle as "rules live in the engine".
5. **Do not restart the project. Do not build generic CRUD. Continue from the latest approved state.**
   Audit before coding; plan and get approval before executing; never fake completion or hide mock data.
