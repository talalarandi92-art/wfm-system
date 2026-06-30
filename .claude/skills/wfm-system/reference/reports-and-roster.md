# Reports & Roster intelligence — the engine, rules & SQL patterns

The durable "how" behind the roster/analytics/reports — the canonical identity layer, the
reconciliation rules, the report/dashboard builders, and the PostgreSQL patterns that make it
all work. Read before touching `attendance-recon`, the roster, or any report/analytics. This is
the part that re-derives slowly if lost — keep it.

## Live database (verify everything against real data)
There is a **live local Postgres `wfm_db`** with real data (≈162 employees / 22.8k attendance
rows). Connect via `backend/scripts` (pattern: `pg` Client, load `.env` from backend or repo root,
vars `POSTGRES_HOST/PORT/DB/USER/PASSWORD`). Use it to migrate / probe / validate. Backend runs
as compiled `dist/main.js` (prod, NOT watch) → rebuild + restart for new endpoints.

## Canonical identity layer (the spine of all analytics)
`employee_identity` collapses every raw id a person ever had (intern `6xxxx` + full-time `1xxxx`)
into ONE `person_no`, with `is_canonical`, `clean_name`, role/function/flags. **Always aggregate by
`person_no`**, resolving raw ids through it — otherwise one person double-counts.

**The `sc` CTE join pattern** (attach scorecard to roster without breaking existing aggregates):
```sql
WITH sc AS (
  SELECT i.person_no AS sc_person, AVG(se.<kpi>) ...
  FROM scorecard_entries se JOIN employee_identity i ON i.employee_no = se.employee_no
  GROUP BY i.person_no )
... LEFT JOIN sc ON sc.sc_person = roster_days.person_no   -- clash-free key, 1:1, additive
```

## PostgreSQL gotchas (these bit us)
- **Quote camelCase aliases**: `COUNT(*)::int "workedDays"` — unquoted → lowercased → blank in JSON.
- **No SELECT-alias in ORDER BY expressions** — repeat the expression instead.
- **`month` is reserved** — quote it `"month"`.
- `permission_duration` is **TEXT** — no `SUM()`.
- Inline-style attribute selectors must match the **browser-serialized** form (spaces): see design-system.

## roster_days — the normalized model
One row per employee × day (canonical). Key fields: `presence`
(`office|wfh|off|leave|sick|absent|holiday`), `shift_code/start/end` (+ `*2` for split), punch &
system login/logout, `sys_late_min/sys_early_min`, `ot_before_min/ot_after_min/ot_min`,
`missing_punch/missing_system`, `permission_type`, `adherence_pct`, `include_tardiness`,
`month_name/week_number`, `data_quality`. Saturday-week aligned (`fmtLocal`/`snapToSaturday`; never
`toISOString()` for local dates).

## Roster reconciliation RULES (the "قواعد")
- **Combine BOTH systems** (Ameyo + Sprinklr) — never one alone (see data-sources.md).
- **Presence classification** drives everything; OFF/H/L/S/A/COMP are tracked separately from worked.
- **Tardiness vs approved permission**: unauthorized late / early-out / system-close = **tardy** and
  hurts `conformance%`; an **approved permission** for that window does NOT (folds in via
  `include_tardiness`). Surfaced on employee + dashboard tab + by-hour HC tracker + roster.
- **OT bleed guards**: zero impossible OT (otAfter/otBefore > 6h uncorroborated; degenerate punches);
  OFF-day punch-only OT capped; absence → `unconfirmed` when observed rate < 0.7.
- **Cross-midnight** (MD/MN): an overnight shift staffs the late hours of its own date AND the early
  hours of the next; fold the previous day's tail into 00:00–07:30. Login at 00:xx must NOT compute as
  ~20h "OT before" (wrap the login).
- **Maternity `*7` (7h)**: +120 min early-out allowance for the named mothers; productivity uses ×7.
- **Female shift rule** (configurable): up to C; N only if needed (warn); MD/MN blocked (override+audit).

## Scorecard data shape (CRITICAL — don't assume more granularity than exists)
- `scorecard_entries` = **ONE month only** (the latest scored month; weekly `W1..W4` + `Final`; NO
  year/month cols, only `week_label`). So the per-KPI breakdown is **single-month** — not comparable
  across months yet.
- `scorecard_monthly` = many months (e.g. May'25→May'26) but **Net Points only** (avg/best/worst +
  `weekly_nets`). Over-time scorecard comparison can use **Net Points**, not the KPI breakdown, until
  more months of entries are ingested.
- `survey_fcr_monthly.employee_id` is a **uuid** (employees.id), NOT employee_no — join via
  `employee_id IN (SELECT id FROM employees WHERE employee_no = ANY(...))`.

## Key roster/analytics endpoints (`attendance-recon`, `roster-v2/*`)
`agent-360` (attendance/tardiness bands/OT/shift-rate/monthly), `agent-performance` (Net Points +
Ameyo AHT/occupancy + FCR, alias-aware), `agent-progress` (month-over-month + verdict; returns 13
monthly metrics + per-metric deltas), `agent-period-compare` (self vs self over two **arbitrary,
possibly different-length** periods → length-independent **rates/averages**, never raw counts, +
improve/decline verdict; sick/OT shown as neutral context), `team-360`/`team-progress`, `trends`,
`scorecard` board (per-agent avg of weeks + weekly drill, all KPIs, unit-aware actuals),
`agent-scores` (adherence composite + grade), `insights`, `hr-matrix`, `integrity`,
`employee-master`, `coverage-impact`, `interval-headcount`, `schedule-change/swap/changes/revert`,
`team-leaders`, `schedule-analysis`, `ot-exceptions` (+`/export`), `wfh-hr-report` (+`/export`),
`schedule-lock`. Unit handling: AHT actual = minutes; Response-Time actual = Excel day-fraction ×1440 =
min; pct KPIs are 0–1 fractions ×100.

## Canonical metric definitions (ONE source of truth — every report must agree)
Module consts at the top of `recon.controller.ts` so no two reports disagree and no one is wronged:
- **`TRUE_OT`** = `ot_min + offday_ot_min + holiday_ot_min` — OT is in 3 DISJOINT buckets; summing
  `ot_min` alone undercounts ~28% (live: 446k vs 651k min). Use everywhere "total OT" is meant.
- **`CRED_LATE`/`CRED_EARLY`** = `sys_late/early_min BETWEEN 7 AND 240` — **tolerance is > 6 min** (≤6 forgiven,
  rule 2026-06-30); upper 240 because cross-midnight night shifts (MD/MN/MNR, shift_end>1440) bleed the post-midnight
  tail into a multi-HOUR false late/early; cap at 4h, surface the rest as `excludedDq`. **Ranking gotcha:**
  `SUM(x) FILTER(...) DESC` sorts NULLS-FIRST → floats null-valued (all-bleed) agents to the top; use
  `COALESCE(...,0)` + `DESC NULLS LAST`.
- **`MATERNITY_7H`** = person_no `('12375','12434')` (Haya Mohanna, Shaima Saoud) — roster_days does
  NOT flag maternity (they read expected_hours=9), so their ~2h/day early-out (legit 7h day) is
  excluded from **EARLY-OUT only** (late-in + OT still count). Else they wrongly top "most early-out".
- **`NO_EVIDENCE_FLAG`** — a working day with NO punch AND NO system login → `data_quality = "No punch & no
  system login — verify (not auto-absent)"` AND `worked_min = 0` (never the scheduled net). **Role-blind**, fires
  for every role. **Policy 2026-06-30: ALL roles must open the system — leaders included** (supersedes the old
  leaders-blind-eye). `isExcludedRole` (TL/Senior/RTA/Resolution/WFM = record-only) now means exempt from
  tardiness/HR-action *deductions* ONLY, NOT exempt from opening the system. **Decided 2026-06-30: leaders stay
  record-only for deductions — only the system-open flag applies** (not full scrutiny). Caveat: Sprinklr never-closed
  sessions (logout=1970) drop a real login → "login-only recovery" deferred (user chose leave-as-is 2026-06-30), so
  Fatma/Hassan/Noura's flag is over-strict until that's revisited.
- **`CROSS_MIDNIGHT_START_DAY`** (2026-06-30) — a shift starting day D, ending D+1 belongs ENTIRELY to D (attendance/OT/
  permission/sick/leave/swaps/requests). recon-build `prevDayBleed = !isWorkingKind && govLogin<0` → a non-working
  (H/OFF/leave) day never credits OT/worked nor shows a previous-night session. Killed the 06-16 double-count + 85 OFF
  bleeds (June −31.6h holOT, −597.7h worked). Engine-enforced for every upload.
- **`LEAVE_ON_HOLIDAY`** (2026-06-30) — an annual-leave `L` day on an official holiday counts as the HOLIDAY and returns
  to the leave balance (not consumed): presence='holiday', hr_code='H' (HR-matrix/balance skip L), daily_note set,
  original L kept in shift_code. Engine (June) + back-applied to Jan–May (40 rows). 2026 holidays in recon-config.json.
- Applied to: roster-dashboard, agent-360, team-360, agent-progress, agent-period-compare, employee
  list, insights, report-builder agg map, **HR matrix** (appends OT/Worked/Late/Early/Absent/Sick/Perm
  columns). RAW per-row detail + CSV/Excel exports stay RAW (analyst ground truth).

## Reports intelligence
- **OT & Exceptions** (`/ot-exceptions`, `roster-v2/ot-exceptions` + `/export`): overtime, tardiness,
  permissions, absence — by agent (sortable/searchable) / function / hours. **Two HR-grade gotchas
  baked in:** (1) **OT buckets are DISJOINT** — `ot_min` (regular workday) vs `offday_ot_min` (OT on
  an OFF day) vs `holiday_ot_min` (public-holiday OT); each row is in exactly one. **Total = the SUM
  of all three**, never `total − holiday`. Public-holiday-OT % = `holiday_ot_min / total`. (2)
  **Cross-midnight bleed**: night shifts (MD/MN/MNR, `shift_end_min`>1440) make `sys_early_min` read
  as a multi-hour false early-out (saw 29h). **Cap late-in/early-out at 240 min**; rows above the cap
  → `excludedDq` (NOT held against the agent). Tardiness counts exclude permission-covered days
  (`permission_type IS NULL`); excused days reported separately. `permission_duration` is a
  TIME-WINDOW string → `parsePermMin` (end−start).
- **Custom Report Builder** (`/report-builder`, `report-builder` endpoint): three maps — **F** fields
  / **K** KPIs / **G** groups. **Detail** mode = raw rows; **Summary** mode = grouped aggregates.
  Scorecard KPIs (Quality/AHT/FCR/Productivity/CTR/Quiz/PRR/Response-Time/Mistakes/Net Points) join via
  the `sc` CTE and **auto-appear in Summary**. ~33 ready-made presets (set fields/KPIs/filters), saved
  views, Excel export. Filters: date range, search, function, team leader, group, shift, status, late
  category.
- **Custom Dashboard Builder** (`/dashboard-builder`): a METRICS catalogue including all 13 scorecard
  KPIs; compose tiles/charts.
- **Reporter guard** (`/reports-bot`, migration 030): automated **daily reports + Excel**.
- **Workflow + SLA reports**: approval-chain timeline + SLA per request/coaching/outage/tech, with
  dashboard KPIs + expandable timeline (fulfils the "detailed reports w/ approval timeline + SLA" ask).
- **Data Quality & Employee Audit** (`/data-quality`): integrity checks; **HR Matrix** export (use
  `COALESCE(hr_code, attendance_code, shift_code, 'OFF')` — never an `ELSE 'P'` catch-all).
- **Master / executive exports**: employee-master, master-export, system-audit, executive-export.
- Heavy report/export/recalc operations run as **async jobs** (don't block the request).
- Honesty: never fabricate KPI granularity beyond the data (single-month entries); label any
  estimated/mock data; round half-up on percentages per the scorecard rules.

## 2026-06-30 — Engine writes the master codes; schedule reads roster_days; in-system rebuild
**Rules live in the engine, not in the data.** The recurring "report was right, then a refresh broke it" bug was
caused by the corrected-June ingest leaving `hr_code`/`attendance_code` NULL — so the HR-Matrix `COALESCE(hr_code,
attendance_code, shift_code,'OFF')` lost its SL/A/L/H/WFH semantics. FIX: `backend/scripts/recon-build.js` now
computes the master codes (sick→`SL`, absence→`A`, off→`OFF`, leave→`L`/DL/UPL, holiday→`H`, comp→`COMP`,
sep→`RES`/`TER`, WFH-working→`WFH`, office-working incl. forgot-to-punch→shift code) and `recon-ingest.js` MAPs
`hr_code`/`attendance_code`. Every `recon-refresh.js` (or the in-system Upload) re-applies them → no report can
silently regress. Rule of thumb: **if a report looks wrong after a refresh, the rule belongs in `recon-build.js`,
not patched into the data.**
- **Holiday-worked OT** in the engine: worked-a-scheduled-shift-on-an-official-holiday → whole shift = `holiday_ot_min`
  (capped at net), regular OT=0, status "Official Holiday — <name> (worked)". Holidays auto-detect from Odoo Status
  (HOLIDAY_RE) date-wide + editable `recon-config.json`.
- **worked_min** zeroed/clamped on non-working presence (no rest-day system bleed); working ≤16h.
- **In-system rebuild**: `POST /attendance-recon/recon-refresh` (perm `schedule.publish`) + Roster "Upload & Rebuild"
  button drop the 5 month sources into `Desktop/new roster/` then spawn `recon-refresh.js`. Runbook: `docs/RECON_PIPELINE.md`.
- **Schedule grid is now connected**: `schedule.service.ts` getGrid LEFT JOINs `roster_days` (person_no=employee_no,
  work_date) and overlays the corrected cell — real WFH/holiday/SL/A, true-OT/late, and CANONICAL shift times
  (`shift_start_min`/`shift_end_min`, not stale `attendance_records.scheduled_start`). Cell shows the shift code
  DIRECT (no `-WFH` suffix; WFH via icon/texture); `source:'roster'|'schedule'`. Known follow-up: editCell/publish
  still WRITE attendance_records; legacy `/attendance-recon` (dashboard/metric/overtime) still read the thin
  `roster_daily`; Command Center mixes corrected + `/dashboard/summary` (attendance_records) — badge or retarget.
- **Year Jan–May already consistent** (dry-run vs live = 0 material diffs); no rebuild. June = recon engine.
