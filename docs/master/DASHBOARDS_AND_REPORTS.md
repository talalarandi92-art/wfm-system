# DASHBOARDS & REPORTS — Master Specification (As-Built + Approved Plan)

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> Part of the `docs/master/` knowledge base for the Boutiqaat Contact-Center WFM platform.
> **Canonical rule source:** `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (if a number or rule here
> conflicts with it, that document wins). Engine mechanics: `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md`.
> Refresh runbook: `docs/RECON_PIPELINE.md`. UI standards: `docs/knowledge/DESIGN_SYSTEM.md`.

**Status legend used throughout:**

| Tag | Meaning |
|---|---|
| **Confirmed / Built** | Live in the running system, verified on real data, or an explicitly agreed decision |
| **Confirmed / Pending fix** | Built, but a recorded defect or drift affects it (see §8) |
| **Needs Approval** | Proposed and documented (e.g. the 2026-07-01 consolidation plan) — the Director has NOT yet said go |
| **Recommended** | Improvement or new artifact suggested by Claude — must be agreed before any execution |

---

## 1. Governing principles (Confirmed)

- **P-1 — Verified data only.** Every dashboard number traces to a real endpoint over real data. No mock
  KPIs; anything estimated or modeled is labelled as such on the page (e.g. the Hourly Analytics
  per-hour attribution note). The Command Center was explicitly built "verified-endpoints only", and a
  fake "counterfactual schedulability score" was **declined** rather than shipped (D-070 in the
  DECISIONS log, 2026-06-24).
- **P-2 — One canonical data table.** All roster/reconciliation reports read the RICH **`roster_days`**
  table (canonical `person_no` identity). The THIN `roster_daily` table serves only the legacy
  `/dashboard`,`/metric`,`/overtime` path. **Never cross-wire** (Rules doc §11).
- **P-3 — One metric definition per concept.** Module constants at the top of
  `backend/src/modules/attendance-recon/recon.controller.ts` define **TRUE_OT** (3 disjoint buckets),
  **CRED_LATE / CRED_EARLY** (7..240 min; >6 min tolerated), **MATERNITY_7H** (early-out exclusion for
  person_no 12375/12434) — so no two reports can disagree (Rules doc §5, §6, §7, §19).
- **P-4 — Rules live in the engine, not in the data.** Every business rule (holiday-OT, hr_code matrix,
  worked_min clamps, cross-midnight ownership, leave-on-holiday) is codified in
  `backend/scripts/recon-build.js` and re-applied on every refresh, so reports never silently regress
  (Rules doc §18).
- **P-5 — Never wrongly punish anyone.** HR-grade reports (WFH HR, tardiness) route weak/ambiguous
  evidence to **Data Quality**, never to HR action ("ما بدي اظلم حد"). Approved permission never lowers
  conformance; excluded roles and maternity guards apply everywhere.
- **P-6 — Exports accompany dashboards.** Raw per-row detail and CSV/Excel exports stay RAW (analyst
  ground truth); canonical caps/exclusions apply to aggregates and rankings.
- **P-7 — Design system.** All new dashboards use the theme-var dazzle kit
  (`frontend/src/components/dazzle.tsx`: StatTile / Donut / BarRow / Gauge / Sparkline) so they render
  correctly in all 3 themes (Dark / Light / Aurora-Glass). No animated background.

---

## 2. AS-BUILT DASHBOARD SUITE

All routes confirmed live in `frontend/src/App.tsx` (66 routes; ~80 page files). Roster-family
endpoints are `GET /attendance-recon/roster-v2/*` unless noted. Refresh model for all roster-family
pages: **on-demand query of `roster_days`** (recomputed live per request); data itself advances via the
recon pipeline (§6).

### DASH-01 · Command Center — `/command-center` (Confirmed / Built 2026-06-24)
The executive flagship single-screen (first sidebar item, Crown icon). `CommandCenter.tsx`.
- **Purpose:** one cinematic operation overview for management — every number from a verified endpoint
  (`Promise.allSettled` over 6 endpoints; graceful nulls).
- **Layout / KPIs:** hero banner (Chief posture badge + live clock + directive) → 4 **Gauges**
  (Coverage — from `coverage-impact`; Conformance — from roster-v2 summary; Shift Fairness; Weekend-OFF
  Fairness — from `fairness`) → 6 count-up **StatTiles** (Headcount · Present-today w/ 7-day Sparkline ·
  On-permission · Pending requests · Annual attrition w/ monthly Sparkline · OT hours) →
  coverage-by-function **risk BarRows** (present/planned, risk-coloured) + presence **Donut** →
  quick-links into the proof pages.
- **Roles:** perm `reports.view`, agent-hidden. **Decisions supported:** daily exec posture, where
  coverage risk sits by function, whether fairness is drifting.
- **Known caveat (Confirmed):** it mixes corrected roster data with the legacy `/dashboard/summary`
  (attendance_records) — flagged for badge-or-retarget (Rules/Engine doc follow-up list).

### DASH-02 · Roster & Reconciliation — `/roster` (Confirmed / Built, continuously enriched)
`Roster.tsx` — the working surface over the canonical reconciled roster.
- **Purpose:** per-employee × per-day reconciled truth (schedule ∪ Ameyo ∪ Sprinklr ∪ Odoo punch),
  the base for every HR/OT conversation.
- **Features:** roster table (zebra + contrasting detail row) with per-row **conformance mini-bar**;
  presence **Donut**; **OT spotlight** (regular/off-day/holiday segments + top-OT-functions bars);
  summary gauges/tiles band; attendance **heatmap**; friendly bilingual status labels classified by
  `hr_code` first (L-on-holiday reads Holiday; worked holiday shows the shift); User ID column
  (`roster_days.username`); punch/system Σ totals; prefix search.
- **Date control:** the shared **DateRangeBar** (single-calendar range picker, Saturday-week presets:
  Today / Yesterday / Last 7 / Last 30 / This week / Last week / This month / Last month / All)
  — rolled out here and to OT & Exceptions / Schedule Analysis / Agent 360 / WFH HR (commit c1be5f7).
  (Audit note: `Roster.tsx` still carries an older inline duplicate of the picker — cleanup queued, §8.)
- **Filters:** date range, function, team leader, search. **Exports:** Excel; header links to every
  sibling report (the "11-button farm" the consolidation plan replaces, §7).
- **Actions:** **"Upload & Rebuild"** button → `POST /attendance-recon/recon-refresh`
  (perm `schedule.publish`) runs the full corrected engine (§6).
- **Decisions supported:** verify any individual day before HR action; validate a month before payroll.

### DASH-03 · Roster Dashboard — `/roster-dashboard` (Confirmed / Built)
`RosterDashboard.tsx` — aggregate summary over the same range.
- **KPIs:** Conformance / Late / Early / OT (before/after/total) / Sick / Absent / Permissions /
  Office / WFH / Off tiles + **rankings** (most-late, most-early, lowest-conformance — all using
  CRED caps, `COALESCE(...,0) DESC NULLS LAST`) + distributions by role / shift / function / TL.
- **Note:** near-duplicate of Schedule Analysis; the consolidation plan merges both into one
  "Analysis" tab of the Roster hub (§7).

### DASH-04 · OT & Exceptions — `/ot-exceptions` (Confirmed / Built 2026-06-22)
`OtExceptions.tsx`; endpoint `roster-v2/ot-exceptions` (+ `/export` → .xlsx).
- **Purpose:** the single HR/payroll-grade OT + tardiness surface.
- **KPIs / charts:** OT split donut — **regular `ot_min` vs off-day `offday_ot_min` vs holiday
  `holiday_ot_min` (DISJOINT buckets; total = sum of all three, never `total − holiday`)**;
  public-holiday-OT %; tardiness (late-in / early-out, capped 240 min, excess → `excludedDq`, not held
  against the agent); permissions by type/shift/date (`permission_duration` is a time-window string →
  `parsePermMin`); absence. Slices: by agent (sortable/searchable), by function, by hours.
- **Filters:** DateRangeBar range, function, teamLeader. **Exports:** Excel workbook.
- **Business rules honoured:** tardiness excludes permission-covered days (excused shown separately);
  MATERNITY_7H excluded from early-out; 180h/year OT-cap report (EXCEEDED / APPROACHING) lives in this
  family. **Decisions supported:** OT payment approval, HR tardiness action, forgotten-OT recovery.

### DASH-05 · Schedule Analysis — `/schedule-analysis` (Confirmed / Built 2026-06-22)
`ScheduleAnalysis.tsx`; endpoint `roster-v2/schedule-analysis`.
- **KPIs:** people, **shrinkage %** (lost-hours ÷ schedulable-hours), shift-rate distribution
  (Morning/Night/Evening/Midnight per the canonical mapping), OFF / leave / sick / absence %, WFH %,
  weekend-OFF %, hourly headcount curve (avg concurrent, cross-midnight aware), permission hours —
  by function/team/period. Verified on Jan–Jun real data.
- **Filters:** DateRangeBar, function, TL. **Export:** not yet (Recommended: mirror the WFH export
  pattern). **Decisions supported:** shrinkage planning, WFH policy, weekend-OFF fairness.

### DASH-06 · WFH HR Report — `/wfh-hr-report` (Confirmed / Built 2026-06-22, accuracy-critical)
`WfhHrReport.tsx`; endpoint `roster-v2/wfh-hr-report` (+ `/export` = 8-sheet xlsx).
- **Purpose:** automates HR's weekly "who worked from home late/short" ask — **drives HR action, so it
  is conservative by design**.
- **Logic (Confirmed):** WFH = WFH shift code OR explicit WFH location ONLY (never inferred from
  system-no-punch — corrected 2026-06-24). HR gate = WFH AND (late-in OR early-out) AND no permission
  AND no COMP AND no OT AND NOT completed AND shortage ≥5 min AND not excluded role. "Completed" =
  consolidated system span ≥ **gross** shift (9h incl. break; mothers 7h). Cross-midnight, >3h-late and
  <1h-session cases → **Data Quality**, never HR. Official holidays read from the editable `holidays`
  table (fixed 2026-07-01 — was a hardcoded single date).
- **Outputs (8 sheets):** HR_Action, Audit_All, Excluded_Valid, Data_Quality + summaries by
  agent/TL/function/date; every row carries a reason. **Decisions supported:** the weekly HR submission.

### DASH-07 · Agent 360 — `/agent-360` (Confirmed / Built)
`Agent360.tsx`; endpoints `agent-360`, `agent-performance`, `agent-progress`, `agent-period-compare`.
- **Purpose:** everything about one person: attendance, tardiness bands, OT (before/after/off/holiday),
  shift-rate distribution, monthly trend, scorecard Net Points + Ameyo AHT/occupancy + FCR (alias-aware).
- **Compare modes:** [Agent | Period] toggle — **agent-period-compare** = self vs self over two
  arbitrary (possibly different-length) periods using **length-independent rates/averages only**
  (never raw counts); sick/OT shown as neutral context; improve/decline verdict.
- **Data-shape constraint (Confirmed):** `scorecard_entries` = one month of KPI detail;
  `scorecard_monthly` = Net Points only across months → over-time comparison uses Net Points only.
- **Decisions supported:** coaching conversations, performance reviews, disputes.

### DASH-08 · Team 360 / Agent Scores / Trends (Confirmed / Built)
- **Team 360** — `/team-360`: the Agent-360 aggregates at team grain (`team-360`, `team-progress`).
- **Agent Scores (Leaderboard)** — `/agent-scores`: adherence composite + grade per agent.
- **Trends** — `/trends`: metric trends over time (`trends` endpoint).
- All read `roster_days` with the canonical metric consts. **Decisions supported:** ranking, recognition,
  coaching-needed flags.

### DASH-09 · Scorecard Board — `/scorecard-board` (+ `/scorecard`) (Confirmed / Built)
`ScorecardBoard.tsx`; `scorecard` board endpoint — per-agent average of weeks + weekly drill-down, all
KPIs, unit-aware actuals (AHT = minutes; Response-Time = Excel day-fraction ×1440; pct KPIs ×100).
Scoring rules (bands, round-half-up, sick-day penalty, quiz-commitment) per Rules doc §9 and the
`scorecard-builder` skill. **Decisions supported:** monthly performance review, wallboard ranking.
- **Performance tab (`GET /scorecard/analyze`) — repointed 2026-07-07:** cumulative cross-month series
  now reads canonical `scorecard_monthly` (13 months of Net Points, alias-aware `employee_identity` fold)
  instead of the single-month `scorecard_entries` batch; weak-KPI/coaching detail stays on the latest
  batch (source labelled in `insights.kpiSource`). Verified vs the May 2026 SCORED workbook (82/82 match).

### DASH-10 · Hourly Analytics — `/analytics?tab=hourly` (Confirmed / Built 2026-06-23)
`HourlyAnalytics.tsx`; endpoint `roster-v2/hourly` — per hour 0–23 × function on `roster_days`.
- **The cascade model (Confirmed):** scheduled → working → **+OT-before → +OT-after = HC after OT →
  −perm-late → −perm-early = HC after permission → −tardiness → −early-out = EFFECTIVE HC** →
  coverage % (= effective/scheduled) → conformance %. Checkpoint columns shaded; TOTAL row at bottom.
  Also per-hour OT **hours** and permission **hours** via exact minute-overlap (`covMin`).
- **Charts:** 6 count-up StatTiles (peak hour, coverage %, shrinkage %, permissions, tardiness, OT) +
  24-bar working-HC curve (peak highlighted) + 16-col hour×metric table. Function selector.
- **Honesty label (Confirmed):** totals are EXACT; the per-hour spread of OT/late/early/permission is an
  interval-attribution MODEL — stated on the page.
- **Extra panel:** demand-driven coverage recommendation (under-covered open hours + suggested shift
  category) — a signal from observed coverage, explicitly NOT volume-based.
- **Decisions supported:** intraday staffing shape, where to add shifts, permission-hour policy.

### DASH-11 · Interval Headcount — `/interval-headcount` (Confirmed / Built)
`IntervalHeadcount.tsx`; endpoint `interval-headcount` — half-hourly scheduled-vs-present for a single
day (the "zoom-in" of the hourly view). Default date skips marker-only tail days (≥20 working rows
rule, Rules doc §11). **Decisions supported:** same-day staffing checks, interval-level RTA follow-up.

### DASH-12 · Hourly Coverage — `/hourly-coverage` (Confirmed / Built)
Per-function Required / Scheduled / Available / Gap by hour over `/coverage/hourly`
(attendance_records + approved+pending permissions, LIVE — see `data_interconnection_map`).
Overlaps DASH-10/11 conceptually — the consolidation plan reconciles the three HC definitions (§7).

### DASH-13 · Data Quality & Employee Audit — `/data-quality` (Confirmed / Built)
Integrity checks over roster/identity (`integrity`, `employee-master` endpoints): unknown codes,
WFH-code-but-Office-location rows, no-punch-AND-no-system flagged days (role-blind, worked_min = 0),
duplicate identities. **Decisions supported:** what to verify before trusting a month.

### DASH-14 · System Audit — `/system-audit` (Confirmed / Built)
`SystemAuditPage` over `system-audit` / audit_logs (append-only, immutable via trigger): who changed
what, when, old/new values. **Decisions supported:** accountability, change tracing.

### DASH-15 · HR Matrix export (Confirmed / Built — engine-owned)
Endpoint `hr-matrix` + export. Cell = `COALESCE(hr_code, attendance_code, shift_code, 'OFF')` — never
an `ELSE 'P'` catch-all. The master codes (SL, A, OFF, L/DL/UPL, H, COMP, RES/TER, WFH, forgot-to-punch
→ shift code) are computed **in the engine** so a refresh can never strip them (Rules doc §18). Appends
OT/Worked/Late/Early/Absent/Sick/Perm columns with the canonical caps. **Decisions supported:** the
monthly HR attendance submission.

### DASH-16 · Custom Report Builder — `/report-builder` (Confirmed / Built)
`ReportBuilder.tsx`; endpoint `report-builder` with three maps — **F** fields / **K** KPIs / **G** groups.
- **Modes:** Detail (raw rows) and Summary (grouped aggregates). Scorecard KPIs (Quality / AHT / FCR /
  Productivity / CTR / Quiz / PRR / Response-Time / Mistakes / Net Points) join via the `sc` CTE and
  auto-appear in Summary.
- **Presets:** **33 one-click ready reports** (the code comment says "The 36 spec reports" but the
  `PRESETS` array holds 33; each sets mode + fields/KPIs + groupBy + filters), grouped by theme, plus
  user-saved presets (localStorage).
- **Filters:** date range, search, function, team leader, group, shift, status, late category,
  `shiftStartHour` group-by, `onlyTardiness` mode. **Export:** Excel.
- **Open defects affecting it:** sc-CTE day-weighting in grouped views; columns NULL after a corrected
  refresh (§8).

### DASH-17 · Custom Dashboard Builder — `/dashboard-builder` (Confirmed / Built)
`DashboardBuilder.tsx` — compose tiles/charts from a METRICS catalogue (all 13 scorecard KPIs +
coveragePct / shrinkagePct / shrinkageDays / lateDays / earlyDays; DIMS incl. shiftStartHour).
To add a metric: backend K map + frontend METRICS array.

### DASH-18 · RTA Live (LiveOps Hub) — `/rta` (Confirmed / Built, overhaul bookmarked)
`LiveOpsHub` tabs: rta (`rta.view`) | outages (`outages.view`) | technical (`requests.view_own`).
The 2026-06-24 overhaul (10 steps done, backlog saved in memory `live_overhaul_resume`):
- Bridge-freshness banner (self-explains stale data); status-transition engine (migration 067
  `agent_status_events`) → live "in status for X" + timeline; **Agent 360 drawer** (click any agent);
  **Queue 360** (8-metric grid) + 24-col agent Excel report; **Wallboard / TV mode** (full-screen,
  auto-rotation 3 pages, LIVE/STALE badge); Executive Overview tab + contact forecast →
  required-HC; rich Agent Board (status+duration+contacts/AHT/hold/idle/conformance, table + card
  gallery); agent self live-performance card on `/my`.
- **Data source:** the Sprinklr/Ameyo Chrome-extension bridges; contacts/AHT populate when the
  Supervisor agents table is pinned. Sprinklr times are LOCAL, not UTC.
- **Decisions supported:** intraday adherence interventions, queue escalations, outage response.

### DASH-19 · Control Dashboards — `/control-dashboards` (Confirmed / Built)
`ControlDashboards.tsx`; `GET /control-dashboard?from&to` returns ONE bundle (requests
total/approved/rejected/pending/escalated/overdue/urgent/avgDecisionHours; latest-day attendance;
coaching open flags by severity; campaignsActive; otHours; byType; byFunction). One page, 4 role tabs
— **Exec / WFM / TL / Agent** — each a role-relevant slice; Agent tab links to `/my`. Uses
`MAX(attendance_date)` as "today". **Decisions supported:** role-appropriate daily control.

### DASH-20 · Diagnostics — `/diagnostics` (Confirmed / Built 2026-06-15)
`GET /diagnostics?smoke=1` aggregates Health-guard + Security-guard + Analyst findings + smoke-test
probes into one severity-sorted issue list with scores; **"Copy report"** produces a plain-text digest
for handing off fixes. Honest stance recorded: the bot detects and describes; it does not self-edit
code. **Decisions supported:** the daily "what's broken" review.

### DASH-21 · Workflow & SLA Reports — `/analytics?tab=reports` (Confirmed / Built 2026-06-17)
`Reports.tsx` inside AnalyticsHub; backend `backend/src/modules/reports/`.
- `/reports/requests-detailed` → `{period, total, summary, data}` — KPI tiles (counts by status,
  avgApprovalHours, SLA met/breached/open-breach + slaCompliancePct) derived from the SAME mapped rows
  as the table, per-type rollup, and a clickable row → horizontal **approval-chain Timeline**
  (Submitted → Peer → L1 → L2 → decision, each with timestamp + actor).
- `/reports/coaching`, `/reports/outages`, `/reports/tech-issues` — each `{detail, summary}` with the
  SLA verdict pattern (Met / Breached / Breached-open from `sla_due_at` vs `resolved_at`).
- **Export:** multi-sheet workbook (Requests-by-Type, Coaching, Outages, Technical Issues); CSV/xlsx
  with UTF-8 BOM. **Decisions supported:** approval-chain accountability, SLA compliance.

### DASH-22 · The Guard team & Chief — `/chief` (+13 hidden guard routes) (Confirmed / Built)
Sidebar shows only the **Chief**; behind it: Health · Analyst · **Reporter (automated daily reports +
Excel, migration 030)** · Security · Scorecard-guard · Researcher · Expert · Reply-helper +
Knowledge Ledger / Team Learning / Diagnostics / Advisor / Bots hub. Auto Mode auto-approves only
safe-surplus requests (guarded, reversible). **Decisions supported:** autonomous monitoring + daily
reporting without adding headcount.

### DASH-23 · Other landing/analytics surfaces (Confirmed / Built — merge targets)
- `/dashboard` (main dashboard w/ Operations-Now strip), `/wfm-overview` (13 quick-access tiles),
  `/analytics` (AnalyticsHub: workforce | ops | reports | hourly | generate | attrition …),
  `/productivity`, `/schedule-change-log` (change/swap log + before/after ShiftRateBars + revert),
  `/analytics?tab=generate` (ScheduleDemand: demand curve → shift mix → weekly assignment → draft →
  confirm-gated publish/unpublish). All remain functional; several are consolidation targets (§7).

---

## 3. Standard specification grid (Confirmed defaults)

Unless a dashboard section above says otherwise:

| Attribute | Default across the suite |
|---|---|
| Data source | `roster_days` via `roster-v2/*` (canonical `person_no`; Saturday weeks) |
| Filters | DateRangeBar (from/to + Sat-week presets) · function · team leader · search |
| Metric definitions | TRUE_OT · CRED_LATE/EARLY (7..240) · MATERNITY_7H · include_tardiness gate |
| Refresh | Live query per request; underlying data advances only via the recon pipeline (§6) |
| Exports | Excel (xlsx) and/or CSV with BOM; raw detail stays raw |
| Access | `reports.view` for report pages; `schedule.publish` for rebuild/lock/publish actions; RBAC per Final Access Model (admin = all; RTA+TL = admin-minus-settings; agent = own data via `/me`) |
| i18n / themes | Inline `ar ? :` bilingual; verified in Dark + Light (+ Aurora) |

---

## 4. Report inventory (as-built, beyond the dashboards)

| ID | Report | Where | Status |
|---|---|---|---|
| RPT-01 | OT & Exceptions Excel (agent/function/permission/absence slices) | `ot-exceptions/export` | Built |
| RPT-02 | WFH HR 8-sheet workbook (HR_Action / Audit_All / Excluded_Valid / Data_Quality + 4 summaries) | `wfh-hr-report/export` | Built |
| RPT-03 | HR Matrix (master-code month grid + appended totals) | `hr-matrix` | Built |
| RPT-04 | Report Builder — 33 presets + saved views + Excel | `report-builder` | Built |
| RPT-05 | Workflow/SLA workbook (requests, coaching, outages, tech issues) | `/reports/*` | Built |
| RPT-06 | Reporter-guard automated daily report + Excel | `/reports-bot` | Built |
| RPT-07 | RTA 24-column live agent Excel report | LiveOps Queue 360 | Built |
| RPT-08 | 180h/year OT-cap report (EXCEEDED / APPROACHING) | OT family | Built |
| RPT-09 | Forgotten-OT report / OT_Review workbook | OT reconciliation engine | Built (offline workbook flow) |
| RPT-10 | Employee-master / master-export / executive-export | recon endpoints | Built |
| RPT-11 | Schedule Analysis Excel export | — | **Recommended** (mirror RPT-02 pattern) |

Heavy exports/recalcs run as **async jobs** (never block the request).

---

## 5. Access roles (Confirmed)

- **Agent:** `/my` self-service (own live performance, own attendance/requests); Control Dashboards
  Agent tab; hub tabs gated to `*_own` permissions.
- **TL / RTA:** admin-minus-settings — all dashboards & reports, RTA Live, team drill-downs.
- **WFM Analyst / Supervisor / Ops Manager / Admin:** full suite; `schedule.publish` required for
  Upload & Rebuild, schedule lock/unlock, publish/unpublish.
- **HR:** WFH HR Report, HR Matrix, OT & Exceptions (consumption).
- Sensitive actions audited (System Audit, DASH-14).

---

## 6. Refresh & data-flow model (Confirmed)

- **The one-command pipeline** (`node scripts/recon-refresh.js` = foundation → engine → ingest → live
  `roster_days`) or the in-system **Upload & Rebuild** button (`POST /attendance-recon/recon-refresh`).
  Every business rule is re-applied on each run (P-4). Runbook: `docs/RECON_PIPELINE.md`.
- **Ingest-safety rule (INCIDENT 2026-07-01, fixed commit b7b833d):** a partial upload deletes ONLY the
  date range actually present in the upload; `roster_days_recon_bak` refreshed each run (undo-last-ingest);
  full snapshot in `roster_days_predisaster`. A partial upload can never wipe the rest of the month.
- **Live vs snapshot:** coverage/shrinkage/fairness/HC-impact recompute live on read; the ONE snapshot
  exception is the Breaks coverage view (`headcount_intervals` — never INSERTed in code, mostly inactive).
- **Refresh summary** reports the ACTUAL ingested range (month-agnostic — fixed 2026-07-01).

---

## 7. CONSOLIDATION PLAN — page → hub mapping (Needs Approval, from the 2026-07-01 A-to-Z audit)

> **Status: NEEDS APPROVAL.** The Director has not yet said go on restructuring the navigation.
> Source: 37-finding multi-agent audit (2026-07-01); batch-1 data bugs already fixed (commit b6bfcf4).
> Baseline: ~80 page files / 66 routes / ~35 sidebar entries; the `HubTabs + ?tab=` pattern is proven
> in 6 existing hubs (Scheduling `/schedule`, Attendance `/attendance`, LiveOps `/rta`, Analytics
> `/analytics`, Employees `/employees`, Workspace `/chat`). Target: **~10–12 sidebar entries**.

| # | Target hub | Pages that become `?tab=` inside it | Notes |
|---|---|---|---|
| C-1 | **Roster Reports hub** — `/roster` | roster grid · roster-dashboard · schedule-analysis · ot-exceptions · interval-headcount · hourly-analytics · data-quality · system-audit · schedule-change-log · report-builder · dashboard-builder | Replaces the 11-button header farm and the "Reports & Analytics" sidebar section + WfmOverview tile grid. RosterDashboard + ScheduleAnalysis merge into ONE "Analysis" tab. Agent 360 / WFH HR / Change Log stay standalone deep-dives launched from the hub. |
| C-2 | **Scorecard hub** — `/scorecard` | scorecard (overview) · scorecard-board · agent-scores (leaderboard) · trends · agent-360 · team-360 · coaching · productivity | Collapses 8 flat entries across 2 sidebar sections into one. |
| C-3 | **Capacity & Coverage hub** — `/capacity` | capacity (Erlang) · hourly-coverage · interval-headcount · hourly-analytics · demand-schedule | Reconcile the three HC-curve definitions (avg vs effective vs scheduled) so the curve means one thing; canonical richest view lives in ONE hub, linked from the other. |
| C-4 | **Chief branch** — `/chief` | the 13 guard routes (system-health, analyst, reports-bot, security-guard, scorecard-guard, researcher, expert, reply-helper, knowledge-ledger, team-learning, diagnostics, advisor, bots) | Already sidebar-hidden; nest under one shell with shared back-nav. |
| C-5 | **Executive home** — keep `/command-center` only | Fold ControlDashboards' Exec/WFM/TL/Agent role switcher into Command Center; demote `/dashboard` to the agent/manager default; WfmOverview becomes the Roster-hub shell | 4 overlapping landings → 1. |

**Companion quick wins (Needs Approval, same audit):** one shared default-date-range helper (kill the
frozen 2026 literals — every page currently boots a different range); one exported `adhColor(v)`
(conformance thresholds currently 95/85/70 vs 90/75); shared `<ShiftRateBars>` + `ROSTER_KPI_DEFS`
(colour maps drift across pages); rename or footnote one of the two "shrinkage" definitions
(hours-based vs headcount-case-based); header titles driven from the i18n route map; de-duplicated
sidebar icons; `keep-dark`/theme-var fix for the Shift Rotation modal.

---

## 8. Known defects & drift affecting dashboards (Confirmed — tracked, not hidden)

> IDs here are **DEF-##** (file-local). The BR library's drift register uses DRIFT-###, the learnings
> file R-###, the roadmap RSK-## — name the file when citing across documents.

| ID | Issue | Affects | Status |
|---|---|---|---|
| DEF-01 | Corrected ingest wipes `ot_before_min`/`ot_after_min` (NULL after every Upload & Rebuild) | OT-before/after tiles (Roster Dashboard, Agent 360, Hourly cascade, report-builder KPIs) read 0 while TRUE_OT is correct | **Open — deferred** (do with the Director's eyes on it; emit in `_ingest` + MAP without touching TRUE_OT semantics) |
| DEF-02 | Report-builder references MAP-omitted columns (attendance_status, late_category, week/month, missing_punch/system, comp_worked_min, original_shift_code, crosses_midnight) → blank after a corrected refresh | Report Builder detail fields/filters | Open — deferred (emit from build or hide fields) |
| DEF-03 | `sc` CTE 1:N fan-out → grouped scorecard KPIs are **day-weighted, not person-weighted** | Report Builder Summary mode (all 13 sc KPIs); detail view unaffected | Open — number-changing; aggregate at person grain (Rules doc §9) |
| DEF-04 | Shift-category computed 6 conflicting ways vs the canonical §3 mapping | Shift-rate %, fairness, rotation buckets differ per endpoint | Open — number-changing; one shared code-keyed classifier (Rules doc §16) |
| DEF-05 | Legacy `/dashboard`,`/metric`,`/overtime` still read thin `roster_daily` (old WFH inference until re-ingest) | Legacy dashboard path only (badged) | Open — retarget or re-ingest |
| DEF-06 | Command Center mixes corrected roster + legacy `/dashboard/summary` | DASH-01 | Open — badge or retarget |
| DEF-07 | Jan–May "Rule B" cross-midnight de-bleed needs a per-month recon rebuild (June + future already engine-enforced) | Historical OT/worked on non-working days | Open — waits on month sources |
| ✅ | include_tardiness NULL after refresh → tardiness rankings empty · report-builder OT-Total = bare `ot_min` · WFH-holidays hardcoded → `holidays` table · June-pinned refresh summary | — | **Fixed** 2026-07-01, commit b6bfcf4 |

---

## 9. TARGET SUITE — approved master-prompt spec not yet (fully) built

All items below are **Recommended** unless marked otherwise — none may be executed before the
Director's agreement (standing order). Where a partial as-built exists it is cross-referenced.

| ID | Dashboard / report | Spec essence | Status vs as-built |
|---|---|---|---|
| T-01 | **Executive Dashboard** | Single exec view: SLA, coverage, shrinkage, attrition, OT cost trend | Largely covered by DASH-01 + DASH-19; gap = cost dimension. **Recommended:** add OT-cost tile once rates are provided |
| T-02 | **Forecast Accuracy** | WAPE/MAPE of volume forecast vs actual by channel/interval | Forecasting module computes WAPE/MAPE backtests (memory: forecasting_module); **Recommended:** persist forecasts + a dedicated accuracy page |
| T-03 | **Staffing Gap / Permission HC-Impact matrix** | Interval × function: Required / Scheduled / On-permission / Sick-Absent / Available-after-approval / Gap / Risk | Partially built: coverage-impact + request-approval HC panel (reads `roster_days`, Confirmed) + DASH-12; **Recommended:** the full single matrix view with risk level + suggested alternate time |
| T-04 | **Compliance Dashboard** | Rest <10h, female-N/midnight flags, consecutive-days, OFF balance violations | Rules exist in generator/analyst checks; **Recommended:** one dedicated compliance surface with drill-down |
| T-05 | **Approval Aging** | Pending requests by age bucket, approver, SLA countdown | Partially covered by DASH-21 KPIs + SLA-escalation loop (migration 027); **Recommended:** aging-bucket view |
| T-06 | **Outage Dashboard** | Open/resolved, severity, impacted intervals, SLA, root cause | Workflow report exists (DASH-21) + LiveOps outages tab; **Recommended:** impact-before/during/after quantification + email automation hook |
| T-07 | **Technical Issue / CX-flag report** | 48h SLA, repeated-reason ≥20 customers → CX issue flag, SKU defect board | Tech-issues SLA report exists (DASH-21); **Recommended:** repeated-count/CX-flag analytics + SKU defect dashboard |
| T-08 | **Shrinkage planned-vs-unplanned trend** | Split planned (leave/training/meeting) vs unplanned (sick/absence/late) over time | Shrinkage % exists (DASH-05, workforce analytics); **Recommended:** planned/unplanned split + trend |
| T-09 | **Counterfactual Roster Replay** | Grade the optimizer against actual demand | **Explicitly declined/deferred (Confirmed decision D-070):** needs an independent per-hour volume signal first — a schedule-derived score is circular/fake |
| T-10 | **Skill-expiry & cross-skill coverage board** | Expiring skills + coverage-move recommendations | Skill-expiry alerts built; **Recommended:** consolidated board |
| T-11 | **Attendance-compliance score & team trends** | Composite compliance score by team/function w/ weekly trend | Components all exist (rankings, conformance); **Recommended:** the composite + trend view |
| T-12 | **PDF export layer** | PDF variants of the key HR/exec reports | Excel/CSV exist everywhere; PDF **Recommended** (future per CLAUDE.md §28) |

---

## 10. Open questions (for the Director)

1. **Consolidation go/no-go (§7):** approve the 5-hub merge (C-1..C-5) as a whole, or phase it
   (suggested order: C-1 Roster hub → C-2 Scorecard hub → C-5 executive home → C-3/C-4)?
2. **DEF-01/DEF-02 timing:** the OT-before/after + report-builder-column ingest fix changes what a refresh
   writes — schedule it with a dry-run + diff on a backup, per the update-files refresh lesson?
3. **Number-changing passes (DEF-03, DEF-04):** when to run the person-grain scorecard fix and the single
   shift-category classifier (both will move published numbers — need a validation window)?
4. **T-01 OT cost:** provide hourly cost rates (or a per-band table) to turn OT hours into cost?
5. **T-02/T-09:** priority of wiring a true per-hour volume signal (ops_contacts / Erlang inputs) —
   it unlocks Forecast Accuracy AND the honest Roster Replay?
6. **Agent visibility on RTA Live:** should agents see the team board (full vs status-only)? —
   decision explicitly parked in the Live-overhaul backlog.

---

*End of DASHBOARDS_AND_REPORTS.md — cross-references: WFM_RULES_AND_DECISIONS.md (rules),
REPORTS_AND_ROSTER_ENGINE.md (engine/SQL), RECON_PIPELINE.md (refresh), DESIGN_SYSTEM.md (UI).*
