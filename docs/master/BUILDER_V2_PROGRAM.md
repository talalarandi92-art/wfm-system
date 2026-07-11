# BUILDER v2 — Universal Report & Dashboard Builder (the Sprinklr replacement)

> **Director 2026-07-11 (verbatim intent): "البلدر مش بس للسكور لكل شي — كل داتا بنقدر نطلع منها ريبورت:
> اوفر تايم، لوج ان/لوج اوت، سكور كارد، بيرميشن، كل شي بالحرف."**
> This is NOT a scorecard feature. It is a SELF-SERVICE report/dashboard engine over EVERY data domain
> in the WFM system — the user builds any report or dashboard themselves, no developer, no ask.
> Grounded in the live Sprinklr capture (SPRINKLR_LIVE_REPORTING_FINDINGS.md) + the 9 screenshots.
> Base: existing `ReportBuilder.tsx` + `DashboardBuilder.tsx` + `roster-reports report-builder` endpoint — EVOLVE, not rewrite.

## Core principle
ONE builder, MANY data domains. Every domain in the DB is a selectable **Data Source**; each source
exposes its **dimensions** (group-by) and **metrics** (measures) to a visual builder. The golden rule
(from live Sprinklr): all metrics in one widget come from ONE source (no cross-source mixing in a
single widget); a dashboard combines many widgets/sources.

## Data domains that MUST be buildable (every one, بالحرف)
| Domain | Table(s) | Example metrics / dimensions |
|---|---|---|
| **Overtime** | roster_days (ot_min/offday/holiday/off_worked/ot_review_flags) | payable OT, off-worked-HR, before/after pending, by person/function/date/bucket |
| **Login / Logout** | roster_days (sys_login/logout, punch), agent_status_events, adherence_daily | first-in/last-out, worked span, late/early, source, by day/hour |
| **Scorecard / KPI** | scorecard_monthly, scorecard_entries, kpi_registry | Net Points, per-KPI bands, rank, incentive, by month/function/agent |
| **Permission / Compo** | request_permissions, requests, roster_days.permission_* | count, hours, status, by type/function/cycle |
| **Attendance / Tardiness** | roster_days, attendance_records | present/absent/WFH, tardiness bands, conformance, adherence |
| **Breaks** | break_slots, break_daily_balance, ot_review… | entitlement/used, delays, fairness, by function |
| **Coverage / HC** | headcount_intervals, roster_days | required vs scheduled vs actual by interval/function |
| **Leave / WFH / Shrinkage** | roster_days, leave tables | leave days, WFH%, shrinkage by function/period |
| **Requests / SLA** | requests, request_* | approval time, SLA breach, by type |
| **Sprinklr / Ameyo ops** | agent_daily_stats, ops_contacts, integration_snapshots | AHT/FRT/contacts/occupancy (as Auto-Ingest fills them) |
| **Roster / schedule** | roster_days, schedule_entries | shift distribution, rotation, fairness |
| …any future table | — | registered as a Data Source = instantly buildable |

## Architecture (evolve existing)
1. **Data-source registry** (backend): a declarative catalog — each source = {key, label, base table/view,
   allowed dimensions (col + type + label en/ar), allowed metrics (col/expr + aggregation + format),
   default date column, permission}. Seeded for every domain above; extensible (add a source = one entry).
   Reuse the metric CONSTS already canonical (TRUE_OT, CRED_LATE 7..240, etc.) so builder numbers == report numbers.
2. **Query compiler** (backend): source + selected dims + metrics + filters + date range + granularity →
   safe parameterized SQL (allowlisted columns only — no injection surface) → rows. Respects tenant + RBAC
   (a user only sees sources/rows their role allows; agents = own data).
3. **Widget builder (UI)** — screenshot 5: pick source → visualization (table/bar/line/donut/stat/pivot) →
   choose dimensions & metrics from the LIBRARY picker (screenshot 6) → per-widget granularity, filters
   (screenshot 2), column config, sort → live preview.
4. **Dashboard composer (UI)** — screenshot 1: tabbed sections, drag widgets, dashboard-level date range
   (relative presets screenshot 7 + custom/dynamic), dashboard-level filters that cascade, save/share,
   Contextual-Notes text widget.
5. **Every number drill-down → provenance** (ties to R0 <Kpi>): click a cell → the source/definition/filter that produced it.
6. **Save / share / schedule / export**: saved reports + dashboards (tables saved_reports/saved_dashboards),
   per-user + shared, Excel export on every widget, later scheduled email (Auto-Ingest era).
7. DESIGN = original WFM (dazzle/ds kit, 3 themes, AR/EN), NOT a Sprinklr clone.

## Waves
- **BLD-0 audit** — read the existing ReportBuilder/DashboardBuilder/report-builder endpoint + reports.service; map what's already there vs the registry/compiler gap. (Pure read.)
- **BLD-1 data-source registry + query compiler** (backend) — seed ALL domains above; allowlist-safe SQL; RBAC; reuse metric consts. Gate: build an Overtime + a Login/Logout + a Scorecard report via the compiler, numbers match the existing dedicated reports byte-for-byte.
- **BLD-2 widget builder UI** — source/metric/dimension picker + visualization + filters + preview.
- **BLD-3 dashboard composer** — sections, date controls, cascading filters, save/share.
- **BLD-4 drill-down provenance + Excel export on every widget.**
- **BLD-5 saved/shared library + (later) scheduled delivery.**

## Not blocked
Starts on EXISTING data (roster_days/scorecard_monthly/agent_daily_stats/requests/breaks/headcount_intervals
are all live) — widens automatically as Auto-Ingest + scorecard B2-B7 add sources. Parallel-safe with Auto-Ingest.

See [[SCORECARD_PROGRAM]], [[SPRINKLR_LIVE_REPORTING_FINDINGS]], [[REDESIGN_PROGRAM]] (R0 <Kpi> provenance).
