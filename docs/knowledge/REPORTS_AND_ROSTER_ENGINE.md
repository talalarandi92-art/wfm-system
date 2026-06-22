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
`team-leaders`. Unit handling: AHT actual = minutes; Response-Time actual = Excel day-fraction ×1440 =
min; pct KPIs are 0–1 fractions ×100.

## Reports intelligence
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
