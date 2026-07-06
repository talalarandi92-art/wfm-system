# 📒 API SPECIFICATIONS — Boutiqaat WFM Platform

> **Generated from the LIVE Swagger document** (`/api/docs-json`) on 2026-07-06 —
> regenerate with `node scripts/_gen_api_spec.cjs` after route changes (requires the backend running).
> 452 operations across 59 subsystems. Auth: JWT bearer;
> RBAC is **deny-by-default** (2026-07-06): every route carries @RequirePermissions / @Public / @AuthOnly —
> the exact permission codes live on the controllers (grep `@RequirePermissions`).
>
> **"Reads which spine"** — the three employee-day tables are NOT interchangeable
> (see 📓 DATA_DICTIONARY + 📙 TECHNICAL_ARCHITECTURE): `roster_days` = rich canonical;
> `attendance_records` = raw/published schedule (since 2026-07-06 RESYNCED from roster_days by
> recon-refresh step 4); `roster_daily` = thin legacy. The spine column below is per-subsystem.


## advisor

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| POST | `/api/v1/advisor/ask` | Ask the advisor a free-form question |
| GET | `/api/v1/advisor/brief` | Narrate the current situation |
| GET | `/api/v1/advisor/improvements` | Proposed system / design / process improvements |
| GET | `/api/v1/advisor/status` | Whether the LLM advisor is configured |

## analyst

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/analyst/assessment` | Full WFM/RTA situation assessment + recommendations |
| POST | `/api/v1/analyst/feedback` | Accept/reject a recommendation — tunes the analyst (learning) |
| GET | `/api/v1/analyst/history` | Past recommendations + operator decisions |

## analytics

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/analytics/coverage-forecast` | Forecast present headcount per hour for upcoming days (historical weekday×hour avg) |
| GET | `/api/v1/analytics/functions` | Function (department) list for the analytics filter |
| GET | `/api/v1/analytics/hourly-headcount` | Scheduled vs present headcount per hour of day (coverage + shrinkage) |
| POST | `/api/v1/analytics/notify-gaps` | Scan coverage gaps and notify RTA/WFM of under-covered hours |
| GET | `/api/v1/analytics/shift-breakdown` | Per-shift breakdown: present/absent/sick/leave/OT/late/missing/permissions + shrinkage |
| GET | `/api/v1/analytics/shrinkage` | Shrinkage — planned vs unplanned, overall + weekend vs weekday |
| GET | `/api/v1/analytics/shrinkage-trend` | Shrinkage trend bucketed by ISO week and by month |
| GET | `/api/v1/analytics/sick-pattern` | Per-employee sick days — weekend vs weekday split |
| GET | `/api/v1/analytics/weekend-fairness` | Per-employee % of weekend days (Thu/Fri/Sat) given off |

## attendance

*Spine: attendance_records*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/attendance/agent/{employeeId}` | Personal attendance metrics for one employee |
| GET | `/api/v1/attendance/attrition` | Attrition by year (RES=resignation, TER=termination): leavers, last working day, rate |
| GET | `/api/v1/attendance/by-function` | Attendance metrics grouped by function |
| GET | `/api/v1/attendance/daily-trend` | Daily attendance trend |
| GET | `/api/v1/attendance/employees` | All employees with attendance stats |
| GET | `/api/v1/attendance/markers` | Distribution of attendance markers (present/sick/leave/off...) |
| GET | `/api/v1/attendance/missing-ranking` | Top employees with missing punch or system login |
| GET | `/api/v1/attendance/ot-monthly` | Approved overtime by month (trend) + top OT employees |
| GET | `/api/v1/attendance/ot-ranking` | Top OT employees |
| GET | `/api/v1/attendance/peak-events` | Peak/holiday OT events: date range, headcount, OT hours |
| GET | `/api/v1/attendance/summary` | Attendance summary cards for admin dashboard |
| GET | `/api/v1/attendance/tardiness` | Per-employee tardiness (unauthorized) vs permitted + attendance conformance % |
| GET | `/api/v1/attendance/tardiness/by-hour` | By scheduled-start hour & shift: scheduled / present / tardy |
| GET | `/api/v1/attendance/top-late` | Top late employees ranking |
| GET | `/api/v1/attendance/wfh-breakdown` | WFH vs Office distribution |

## attendance-corrections

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/attendance-corrections` | List attendance correction requests |
| POST | `/api/v1/attendance-corrections` | Submit an attendance correction request |
| POST | `/api/v1/attendance-corrections/{id}/approve` | Approve a correction and apply it to attendance |
| POST | `/api/v1/attendance-corrections/{id}/reject` | Reject a correction |

## attendance-recon (roster-v2)

*Spine: roster_days (canonical)*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/attendance-recon/compare` | Compare computed figures vs the analyst manual values (accuracy proof) |
| GET | `/api/v1/attendance-recon/coverage-intervals` | Half-hourly headcount by function for a date — scheduled vs present vs shrinkage vs in-OT |
| GET | `/api/v1/attendance-recon/dashboard` | Deep roster analytics — KPIs, by function/shift, top late/absent/OT, weekday & monthly trends |
| GET | `/api/v1/attendance-recon/employee` | Per-employee performance + commitment profile (rating, OT%, per-day OT window) — search by ID/name/email |
| GET | `/api/v1/attendance-recon/hr-matrix` | HR attendance matrix .xlsx — Update (past week actual) + Advance (next week planned) sheets |
| GET | `/api/v1/attendance-recon/hr-weekly` | Weekly attendance for HR (past week actual / next week planned) — HR shift codes + system details |
| POST | `/api/v1/attendance-recon/ingest` | Parse the source exports once and store the roster in the DB (run after new data lands) |
| GET | `/api/v1/attendance-recon/metric` | Detailed metric view (late/early/absence/conformance/sick) — summary, by function/month, top, detail rows |
| PUT | `/api/v1/attendance-recon/note` | Save a manager note on one (employee, day) — e.g. power cut / technical issue. Persists across re-ingestion. |
| GET | `/api/v1/attendance-recon/ot-bonus` | Days with ≥ minHours overtime (default 5) for the manager bonus list — who/day/window/before-after |
| GET | `/api/v1/attendance-recon/ot-cap` | Annual OT cap (180h/employee/year) with approaching/exceeded alerts |
| GET | `/api/v1/attendance-recon/overtime` | Detailed overtime — before/after/holiday split, by function/month, top employees (180h cap), filterable detail rows |
| GET | `/api/v1/attendance-recon/permissions-detail` | Permission details — type/window/status per (employee, day), filterable by date and name/ID/email |
| POST | `/api/v1/attendance-recon/recon-refresh` | Run the CORRECTED reconciliation engine and refresh roster_days (optional source files replace the engine inputs first; optional sysMode overrides the session-source mode for this run) |
| GET | `/api/v1/attendance-recon/report-builder` | Custom report builder: choose fields/KPIs/groupBy/filters; JSON or xlsx |
| GET | `/api/v1/attendance-recon/roster` | Query the stored roster (indexed, sub-second) — auto-ingests on first use if empty |
| GET | `/api/v1/attendance-recon/roster-dashboard` | Dynamic roster dashboard: KPIs, rankings, distributions, filters |
| GET | `/api/v1/attendance-recon/roster-v2` | Correct combined daily roster (roster_days): summary + filtered, paginated rows |
| GET | `/api/v1/attendance-recon/roster-v2/agent-360` | Agent 360 profile — attendance, tardiness bands, OT, shift-rate, monthly trend |
| GET | `/api/v1/attendance-recon/roster-v2/agent-performance` | Agent performance: official Net Points + AHT/occupancy + FCR joined to roster identity |
| GET | `/api/v1/attendance-recon/roster-v2/agent-period-compare` | Self-comparison across two arbitrary periods (improvement/decline verdict) |
| GET | `/api/v1/attendance-recon/roster-v2/agent-progress` | Per-agent month-over-month progress + improving/declining verdict |
| GET | `/api/v1/attendance-recon/roster-v2/agent-scores` | Composite attendance/adherence score + grade per agent (ranked leaderboard) |
| GET | `/api/v1/attendance-recon/roster-v2/coverage-impact` | Per-function daily coverage vs permission/sick/absent/no-show impact + risk |
| POST | `/api/v1/attendance-recon/roster-v2/cross-skill-cover` |  |
| GET | `/api/v1/attendance-recon/roster-v2/draft` |  |
| GET | `/api/v1/attendance-recon/roster-v2/drafts` |  |
| GET | `/api/v1/attendance-recon/roster-v2/employee-master` | Employee_Master_Clean: canonical humans + role/hours/active |
| GET | `/api/v1/attendance-recon/roster-v2/executive-export` | Executive Summary Excel — KPIs + Insights + Leaderboard + Trends + by-function |
| GET | `/api/v1/attendance-recon/roster-v2/fairness` |  |
| GET | `/api/v1/attendance-recon/roster-v2/fairness/export` | Shift Fairness → multi-sheet Excel (load/mix/OFF split + relief + stuck + night team) |
| GET | `/api/v1/attendance-recon/roster-v2/fairness/night-team` |  |
| PUT | `/api/v1/attendance-recon/roster-v2/fairness/night-team` |  |
| GET | `/api/v1/attendance-recon/roster-v2/gap-backfill` | Propose the likely shift for person-days with system login but no scheduled shift (flagged, read-only) |
| GET | `/api/v1/attendance-recon/roster-v2/gap-remedies` | Per-under-covered-hour remedies: cross-skill / overtime / shift-mix / exception + permission-block windows |
| GET | `/api/v1/attendance-recon/roster-v2/generate` | Demand-driven shift-mix that covers the hourly need per function (set-cover) |
| GET | `/api/v1/attendance-recon/roster-v2/generate-week` | Per-employee weekly shift + OFF assignment covering the demand mix (fair, female-aware) |
| POST | `/api/v1/attendance-recon/roster-v2/generate-week/save` | Save the demand-driven weekly roster as a reviewable draft |
| GET | `/api/v1/attendance-recon/roster-v2/hourly` | Per-hour (0-23) coverage / permissions / shrinkage / sick / absence / tardiness / OT — by function, or per AGENT (level=agent / agent=<id/name>) |
| GET | `/api/v1/attendance-recon/roster-v2/hr-matrix` | HR matrix (employee × date → status) CSV for the window |
| GET | `/api/v1/attendance-recon/roster-v2/insights` | Auto-prioritized WFM insights/alerts (coaching, coverage, OT, trend, data quality) |
| GET | `/api/v1/attendance-recon/roster-v2/integrity` | Data integrity audit: duplicates, inactive, orphans, role-hours, TL verification |
| GET | `/api/v1/attendance-recon/roster-v2/interval-headcount` | Half-hourly headcount by function for a date (scheduled vs present), cross-midnight aware |
| GET | `/api/v1/attendance-recon/roster-v2/ladder-generate` |  |
| GET | `/api/v1/attendance-recon/roster-v2/master-export` | Multi-sheet Excel master (facts + dims + clean + audit + validation + definitions) |
| GET | `/api/v1/attendance-recon/roster-v2/my-ot-pending` |  |
| PUT | `/api/v1/attendance-recon/roster-v2/note` | Set/clear a manager note on a roster day |
| GET | `/api/v1/attendance-recon/roster-v2/on-seat` | Agents on seat for a function+date+hour (actual roster_days, else planned schedule) |
| POST | `/api/v1/attendance-recon/roster-v2/ot-ack` |  |
| GET | `/api/v1/attendance-recon/roster-v2/ot-exceptions` | OT (holiday vs non-holiday) + tardiness/early-out (no permission) + permissions + absences, by agent/function |
| GET | `/api/v1/attendance-recon/roster-v2/ot-exceptions/export` | OT & Exceptions report → .xlsx |
| POST | `/api/v1/attendance-recon/roster-v2/ot-request` |  |
| GET | `/api/v1/attendance-recon/roster-v2/ot-requests` |  |
| GET | `/api/v1/attendance-recon/roster-v2/permission-coverage-check` |  |
| POST | `/api/v1/attendance-recon/roster-v2/publish` | Publish the generated weekly roster into attendance_records (empty week, non-overwriting) |
| GET | `/api/v1/attendance-recon/roster-v2/schedule-analysis` | Consolidated schedule analysis — shrinkage, shift-rate, OFF/leave/weekend-OFF %, hourly HC, permission hours |
| POST | `/api/v1/attendance-recon/roster-v2/schedule-change` | Apply a manual shift change to a (person, date) — logs before/after + impact |
| POST | `/api/v1/attendance-recon/roster-v2/schedule-change/{id}/revert` | Revert a logged schedule change/swap — restores the prior shift(s) |
| GET | `/api/v1/attendance-recon/roster-v2/schedule-changes` | Schedule change/swap history log (newest first) |
| GET | `/api/v1/attendance-recon/roster-v2/schedule-lock` | Approved-schedule soft-lock status (locked range + override capability) |
| PUT | `/api/v1/attendance-recon/roster-v2/schedule-lock` | Set or clear the approved-schedule lock range |
| POST | `/api/v1/attendance-recon/roster-v2/schedule-swap` | Swap shifts between two people on a date — logs both + before/after shift-rate |
| GET | `/api/v1/attendance-recon/roster-v2/scorecard` | Official scorecard board — per-agent (avg of weeks) + weekly W1–W5 drill, all KPIs |
| GET | `/api/v1/attendance-recon/roster-v2/system-audit` | System audit: page/code/assistant tables + live migrations/health/audit-trail |
| GET | `/api/v1/attendance-recon/roster-v2/team-360` | Team 360 — team-leader aggregate + per-agent breakdown + shift distribution |
| GET | `/api/v1/attendance-recon/roster-v2/team-leaders` | Team-leader status table (active/director/left, hidden) + report counts |
| PUT | `/api/v1/attendance-recon/roster-v2/team-leaders` | Upsert a team-leader status (active/director/left + hidden). Hiding removes the label everywhere. |
| GET | `/api/v1/attendance-recon/roster-v2/team-progress` | Team month-over-month progress + improving/declining verdict |
| GET | `/api/v1/attendance-recon/roster-v2/trends` | Weekly/monthly KPI trends (conformance, late, OT, absence, headcount) |
| POST | `/api/v1/attendance-recon/roster-v2/unpublish` | Remove the generated rows for a week (only rows this engine wrote) |
| GET | `/api/v1/attendance-recon/roster-v2/week-forecast` | Live 7×24 headcount forecast — actual (past) blended with plan−requests (future), per hour per day |
| GET | `/api/v1/attendance-recon/roster-v2/wfh-hr-report` | WFH HR action report — conservative late/early-out WFH detection + 8 views |
| GET | `/api/v1/attendance-recon/roster-v2/wfh-hr-report/export` | WFH HR report → .xlsx (HR_Action, Audit_All, Excluded_Valid, Data_Quality + 4 summaries) |
| GET | `/api/v1/attendance-recon/run` | Reconcile Odoo+Ameyo+Sprinklr vs schedule (server-side sources) |
| POST | `/api/v1/attendance-recon/upload` | Upload source files (Odoo/Ameyo/Sprinklr/schedule) → saved server-side + roster re-ingested |

## attrition

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/attrition` | Attrition (RES/TER) + internal transfers from the roster, deduped by person |

## auth

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| POST | `/api/v1/auth/change-password` | Change own password — verifies current, enforces policy, rotates sessions |
| POST | `/api/v1/auth/login` | Login — returns access + refresh tokens |
| POST | `/api/v1/auth/logout` | Logout — revokes refresh token |
| GET | `/api/v1/auth/me` | Get current user profile and permissions |
| POST | `/api/v1/auth/mfa/disable` | Disable MFA — requires password and a current code |
| POST | `/api/v1/auth/mfa/enable` | Verify the first TOTP code and turn MFA on |
| POST | `/api/v1/auth/mfa/setup` | Begin TOTP MFA enrolment — returns secret + otpauth URL for a QR |
| POST | `/api/v1/auth/refresh` | Rotate refresh token — returns new token pair |

## automode

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/automode/decisions` |  |
| POST | `/api/v1/automode/decisions/{id}/revert` | Undo an automated decision (back to pending) |
| POST | `/api/v1/automode/run` | Run an Auto Mode pass now |
| GET | `/api/v1/automode/settings` |  |
| POST | `/api/v1/automode/settings` | Update Auto Mode switches (off by default; reject opt-in) |

## bots

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/bots/team` | Status of all guards + merged activity feed |

## breaks

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/breaks/adherence` | Break adherence report for a date |
| GET | `/api/v1/breaks/coverage` | Coverage by interval with break impact |
| GET | `/api/v1/breaks/fairness` | Break fairness ledger for a month |
| POST | `/api/v1/breaks/generate` | Auto-generate break slots for a date (and optional function) |
| GET | `/api/v1/breaks/my-breaks` | Get my break schedule (agent self-view) |
| GET | `/api/v1/breaks/prayer-times` | Get prayer times for a date |
| POST | `/api/v1/breaks/prayer-times` | Set prayer times for a date |
| GET | `/api/v1/breaks/requests` | List break requests |
| POST | `/api/v1/breaks/requests` | Submit a break change request |
| PATCH | `/api/v1/breaks/requests/{id}/approve` | Approve a break request |
| PATCH | `/api/v1/breaks/requests/{id}/reject` | Reject a break request |
| GET | `/api/v1/breaks/schedule` | Get break schedule for a date |
| GET | `/api/v1/breaks/schedule/employee/{employeeId}` | Get break schedule for a specific employee on a date |
| PATCH | `/api/v1/breaks/slots/{id}/actual` | Record actual break start/end (RTA use) |
| GET | `/api/v1/breaks/types` | List break types |

## calendar

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/calendar/coaching` | List coaching sessions |
| GET | `/api/v1/calendar/cross-skill/gaps` | Detect cross-skill coverage gaps and suggest agents |
| GET | `/api/v1/calendar/events` | List calendar events for a date range |
| POST | `/api/v1/calendar/events` | Create a calendar event |
| DELETE | `/api/v1/calendar/events/{id}` | Delete a calendar event |
| PATCH | `/api/v1/calendar/events/{id}` | Update a calendar event |
| GET | `/api/v1/calendar/today` | Today's events for the current user |

## campaigns

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/campaigns` | List campaigns |
| POST | `/api/v1/campaigns` | Create a campaign |
| DELETE | `/api/v1/campaigns/{id}` | Delete a campaign |
| PATCH | `/api/v1/campaigns/{id}` | Update a campaign |
| GET | `/api/v1/campaigns/active` | Campaigns covering a date |
| GET | `/api/v1/campaigns/check` | Check whether a request type is restricted on a date |

## capacity

*Spine: integration_snapshots + agent_daily_stats*

| Method | Path | Summary |
|---|---|---|
| POST | `/api/v1/capacity/concurrent` |  |
| POST | `/api/v1/capacity/email` |  |
| POST | `/api/v1/capacity/erlang` |  |
| GET | `/api/v1/capacity/function-hourly` |  |
| GET | `/api/v1/capacity/functions` |  |
| GET | `/api/v1/capacity/hc-by-interval` |  |
| GET | `/api/v1/capacity/hc-overview` |  |
| GET | `/api/v1/capacity/live-plan` |  |
| GET | `/api/v1/capacity/scenarios` |  |
| POST | `/api/v1/capacity/scenarios` |  |
| POST | `/api/v1/capacity/scenarios/delete` |  |

## chat

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/chat/channels` |  |
| POST | `/api/v1/chat/channels` |  |
| GET | `/api/v1/chat/channels/{id}/export` |  |
| GET | `/api/v1/chat/channels/{id}/members` |  |
| POST | `/api/v1/chat/channels/{id}/members` |  |
| DELETE | `/api/v1/chat/channels/{id}/members/{userId}` |  |
| PATCH | `/api/v1/chat/channels/{id}/members/{userId}/admin` |  |
| GET | `/api/v1/chat/channels/{id}/messages` |  |
| POST | `/api/v1/chat/channels/{id}/read` |  |
| POST | `/api/v1/chat/direct` |  |
| GET | `/api/v1/chat/presence` |  |
| POST | `/api/v1/chat/upload` |  |
| GET | `/api/v1/chat/users` |  |

## chief

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/chief/briefing` | Executive briefing synthesized from the whole guard team |

## coaching

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/coaching/flags` | List coaching flags |
| POST | `/api/v1/coaching/flags/{id}/address` | Mark a flag as addressed (coached) |
| POST | `/api/v1/coaching/flags/{id}/dismiss` | Dismiss a flag |
| POST | `/api/v1/coaching/flags/{id}/schedule-session` | Schedule a 1:1 coaching session from a flag |
| POST | `/api/v1/coaching/scan` | Scan attendance for coaching triggers now |
| GET | `/api/v1/coaching/sessions` | List coaching 1:1 sessions |

## control-dashboard

*Spine: attendance_records (resynced)*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/control-dashboard` | Role dashboard KPI bundle |

## coverage

*Spine: attendance_records (resynced)*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/coverage/hourly` | Per-function hourly coverage (required/scheduled/available/gap) for a date |

## dashboard

*Spine: attendance_records + roster_daily (legacy)*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/dashboard/summary` | Dashboard summary stats |

## diagnostics

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/diagnostics` | Consolidated issues report (add ?smoke=1 to also run the functional smoke test) |

## employees

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/employees` | List employees with filters |
| GET | `/api/v1/employees/{id}` | Get employee by ID |
| PATCH | `/api/v1/employees/{id}` | Update employee |
| GET | `/api/v1/employees/duplicates` | List suspected duplicate employees grouped by normalized name |
| POST | `/api/v1/employees/merge` | Merge a duplicate employee into the surviving record |
| GET | `/api/v1/employees/meta/functions` | List all functions |

## expert

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| POST | `/api/v1/expert/ask` | Ask the expert (knowledge-grounded) |
| GET | `/api/v1/expert/knowledge` | Full knowledge body (optionally by topic) |
| GET | `/api/v1/expert/status` |  |
| GET | `/api/v1/expert/topics` | List knowledge topics |

## forecasting

*Spine: contact_volume_daily / agent_daily_stats*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/forecasting/accuracy` | Backtest accuracy (MAPE/WAPE/bias) over a past range |
| GET | `/api/v1/forecasting/channels` | Channels present in the contact history |
| GET | `/api/v1/forecasting/export` | Export the forecast (daily + intervals + required HC) as Excel |
| POST | `/api/v1/forecasting/save` | Generate and persist a forecast (header + intervals) |
| GET | `/api/v1/forecasting/saved` | List saved forecasts |
| GET | `/api/v1/forecasting/saved/{id}` | Load a saved forecast with its intervals + overrides |
| PATCH | `/api/v1/forecasting/saved/{id}/override` | Override (or clear) one interval — value null clears it. Audited. |
| GET | `/api/v1/forecasting/volume` | Interval volume forecast + required HC (Erlang) for [from,to] from real history |

## health

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/health` | Health check — database connectivity |

## health-guard

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/health-guard` | Run the full integrity + health battery for the current tenant |

## imports

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/imports` | List import batches |
| POST | `/api/v1/imports/{batchId}/commit` | Commit a validated import batch to the database |
| GET | `/api/v1/imports/{batchId}/preview` | Get parsed preview rows for a batch |
| POST | `/api/v1/imports/sheets` | Return sheet names from an uploaded workbook |
| POST | `/api/v1/imports/upload` | Upload an Excel workbook and get a parse preview |

## integrations/ameyo

*Spine: integration_snapshots*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/integrations/ameyo/live` | Latest Ameyo snapshot — normalized states + computed KPIs + employee links + stale flag |
| POST | `/api/v1/integrations/ameyo/push` | Receive an Ameyo live-monitoring snapshot from the extension |

## integrations/odoo

*Spine: odoo_staging / attendance_excuses*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/integrations/odoo/captured` | What Odoo data the bridge has captured (per-model counts + freshness) |
| GET | `/api/v1/integrations/odoo/config` | Get Odoo configuration |
| PUT | `/api/v1/integrations/odoo/config` | Save Odoo API configuration |
| POST | `/api/v1/integrations/odoo/employees/preview` | Preview employees from Odoo |
| POST | `/api/v1/integrations/odoo/employees/sync` | Sync employees from Odoo to WFM |
| GET | `/api/v1/integrations/odoo/history` | Get Odoo sync history |
| POST | `/api/v1/integrations/odoo/leaves/preview` | Preview approved leaves from Odoo for a date range |
| POST | `/api/v1/integrations/odoo/leaves/sync` | Sync approved leaves from Odoo to WFM schedule |
| POST | `/api/v1/integrations/odoo/push` | Ingest Odoo records scraped from the browser session (extension bridge) |
| POST | `/api/v1/integrations/odoo/reconcile` | Reconcile Odoo requests + technical issues → roster excuses + agent notifications |
| GET | `/api/v1/integrations/odoo/requests` | Staged Odoo Supervisor-Requests mapped to the WFM shape (person_no + dates + status) |
| POST | `/api/v1/integrations/odoo/test` | Test Odoo connection with provided credentials |

## integrations/sprinklr

*Spine: integration_snapshots / agent_daily_stats*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/integrations/sprinklr/adherence` | Schedule adherence report (scheduled vs actual, per agent per day) |
| GET | `/api/v1/integrations/sprinklr/adherence-intraday` | Intraday scheduled vs actual HC per 30-min interval |
| GET | `/api/v1/integrations/sprinklr/agent-360` | Agent 360 — live status + daily stats + timeline for one agent |
| GET | `/api/v1/integrations/sprinklr/agent-board` | Live agent board — status + duration + today’s stats per agent |
| GET | `/api/v1/integrations/sprinklr/agent-daily` | Daily per-agent performance report (linked to employees by email) |
| GET | `/api/v1/integrations/sprinklr/agent-timeline` | Agent working hours and status breakdown from status history |
| GET | `/api/v1/integrations/sprinklr/break-tracker` | Real-time break analysis — who is on break, authorized, history |
| GET | `/api/v1/integrations/sprinklr/compliance-config` | Get compliance thresholds |
| PUT | `/api/v1/integrations/sprinklr/compliance-config` | Update compliance thresholds |
| GET | `/api/v1/integrations/sprinklr/config` | Get Sprinklr API configuration |
| PUT | `/api/v1/integrations/sprinklr/config` | Save Sprinklr API credentials |
| GET | `/api/v1/integrations/sprinklr/contact-forecast` | Contact volume forecast based on daily agent stats |
| GET | `/api/v1/integrations/sprinklr/coverage` | Coverage comparison: scheduled vs actual vs live Sprinklr |
| GET | `/api/v1/integrations/sprinklr/history` | Snapshot ingestion history |
| GET | `/api/v1/integrations/sprinklr/live` | Get latest Sprinklr live data (queues + agents) |
| GET | `/api/v1/integrations/sprinklr/metric-keys` | Distinct agent metric keys captured from Sprinklr (diagnostics) |
| GET | `/api/v1/integrations/sprinklr/permissions-active` | Active permissions currently reducing available HC |
| POST | `/api/v1/integrations/sprinklr/poll` | Poll Sprinklr API directly (requires API key in settings) |
| POST | `/api/v1/integrations/sprinklr/push` | Receive Sprinklr snapshot from Chrome Extension |
| GET | `/api/v1/integrations/sprinklr/queue/{queueId}` | Detailed view for a specific queue (agents, overflow) |
| GET | `/api/v1/integrations/sprinklr/snapshot` |  |
| GET | `/api/v1/integrations/sprinklr/status-now` | Live current status + duration per agent (status-transition engine) |
| GET | `/api/v1/integrations/sprinklr/status-timeline` | Per-agent status timeline for a day (status-transition engine) |
| GET | `/api/v1/integrations/sprinklr/violations` | Compliance violations report (breaks, late/early, off-schedule, meetings, manual dial) |
| PUT | `/api/v1/integrations/sprinklr/violations/{id}/status` | Update violation review status |

## knowledge-base

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/knowledge-base/articles` | List/search articles |
| POST | `/api/v1/knowledge-base/articles` | Create an article (draft or published) |
| DELETE | `/api/v1/knowledge-base/articles/{id}` | Delete an article |
| GET | `/api/v1/knowledge-base/articles/{id}` | Get a single article (increments view count) |
| PATCH | `/api/v1/knowledge-base/articles/{id}` | Update an article (snapshots previous version) |
| GET | `/api/v1/knowledge-base/articles/{id}/versions` | List version history of an article |
| GET | `/api/v1/knowledge-base/categories` | List categories with published article counts |
| POST | `/api/v1/knowledge-base/categories` | Create a category |
| DELETE | `/api/v1/knowledge-base/categories/{id}` | Delete a category (articles kept, uncategorized) |
| POST | `/api/v1/knowledge-base/suggest-reply` | Suggest the best canned-response scripts for a pasted customer message |
| GET | `/api/v1/knowledge-base/whats-new` | Recently added / updated KB articles (since last imports) |

## knowledge-ledger

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/knowledge-ledger` | Every knowledge/expertise item with what / benefit / source / date |

## kpi-source

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/kpi-source/batches` |  |
| DELETE | `/api/v1/kpi-source/batches/{id}` |  |
| GET | `/api/v1/kpi-source/batches/{id}/agent/{login}` |  |
| GET | `/api/v1/kpi-source/batches/{id}/summaries` |  |
| GET | `/api/v1/kpi-source/cpo` |  |
| POST | `/api/v1/kpi-source/cpo` |  |
| POST | `/api/v1/kpi-source/cpo/forecast` |  |
| POST | `/api/v1/kpi-source/upload/commit` |  |
| POST | `/api/v1/kpi-source/upload/preview` |  |

## leave-balances

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/leave-balances` | Leave balances (entitlement/taken/pending/remaining) for an employee |
| GET | `/api/v1/leave-balances/all` | Admin grid: every active employee with their leave balances for a year |
| POST | `/api/v1/leave-balances/entitlement` | Set/replace the annual entitlement for an employee/type (audited) |
| POST | `/api/v1/leave-balances/entitlement/bulk` | Bulk set entitlements from pasted/imported rows (matched by employee_no) |
| GET | `/api/v1/leave-balances/one` | Single leave-type balance for an employee |

## me

*Spine: roster_days + attendance_records*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/me/attendance` | Own attendance detail — punch/system times, late, early-out, OT, permissions, leave balance (self only) |
| GET | `/api/v1/me/live-performance` | Own live Sprinklr performance — status + duration + today’s contacts/AHT/idle/hold + timeline (self only) |
| GET | `/api/v1/me/overview` | Personal overview for the logged-in employee — shift distribution, adherence, score, schedule |

## notifications

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/notifications` | Get notifications for current user |
| PATCH | `/api/v1/notifications/{id}/read` | Mark notification as read |
| PATCH | `/api/v1/notifications/read-all` | Mark all notifications as read |
| GET | `/api/v1/notifications/unread-count` | Unread notification count |

## ops-analytics

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/ops-analytics/batches` | List operations data batches |
| DELETE | `/api/v1/ops-analytics/batches/{id}` | Delete an operations batch |
| GET | `/api/v1/ops-analytics/batches/{id}/agents` | Per-agent contact volume, sentiment, and ranking |
| GET | `/api/v1/ops-analytics/batches/{id}/export` | Export batch analytics as Excel |
| GET | `/api/v1/ops-analytics/batches/{id}/hourly` | Hourly contact volume (heatmap: date × hour) |
| GET | `/api/v1/ops-analytics/batches/{id}/payments` | Payment method breakdown |
| GET | `/api/v1/ops-analytics/batches/{id}/reasons` | Top contact reasons (default 10) |
| GET | `/api/v1/ops-analytics/batches/{id}/summary` | Batch summary — totals, channels, survey, sentiment |
| GET | `/api/v1/ops-analytics/batches/{id}/trends` | Weekly contact volume and sentiment trend |
| GET | `/api/v1/ops-analytics/functions-360` | Per-function 360 rollup (attendance/sick/OT/AHT/occupancy/score) |
| GET | `/api/v1/ops-analytics/orders` | Order mix: status / type / returns / country / tier / payment |
| GET | `/api/v1/ops-analytics/people` | Per-employee 360 — attendance/sick/leave/OT/AHT/occupancy/score, filterable |
| GET | `/api/v1/ops-analytics/people/{id}` | Full 360 for one employee incl. daily attendance + score/productivity trend |
| GET | `/api/v1/ops-analytics/people/export` | Export People 360 (filtered) to .xlsx |
| GET | `/api/v1/ops-analytics/productivity` | Agent productivity (voice): AHT, occupancy, AUX-break, staffed; trend + top agents |
| GET | `/api/v1/ops-analytics/scorecards` | Scorecard monthly: Net-Points trend, top/bottom agents, by function |
| GET | `/api/v1/ops-analytics/shrinkage` | AUX/break shrinkage by reason + category groups + trend |
| POST | `/api/v1/ops-analytics/upload/commit` | Parse and commit operations data to the database |
| POST | `/api/v1/ops-analytics/upload/preview` | Parse operations data file — preview only |
| GET | `/api/v1/ops-analytics/volume` | Contact volume by day/channel, AHT, abandon%, intraday profile, CPO |

## outages

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/outages` |  |
| POST | `/api/v1/outages` |  |
| GET | `/api/v1/outages/{id}` |  |
| PATCH | `/api/v1/outages/{id}` |  |
| PATCH | `/api/v1/outages/{id}/assign` |  |
| GET | `/api/v1/outages/{id}/attachments` |  |
| POST | `/api/v1/outages/{id}/attachments` |  |
| DELETE | `/api/v1/outages/{id}/attachments/{attachmentId}` |  |
| GET | `/api/v1/outages/{id}/notes` |  |
| POST | `/api/v1/outages/{id}/notes` |  |
| GET | `/api/v1/outages/{id}/share-report` |  |
| GET | `/api/v1/outages/dashboard` | Outage dashboard metrics |
| GET | `/api/v1/outages/report` | Detailed outage report with filters |
| GET | `/api/v1/outages/types` |  |

## permission-requests

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/permission-requests` | List permission requests |
| POST | `/api/v1/permission-requests` | Submit a new permission request |
| PATCH | `/api/v1/permission-requests/{id}/approve` | Approve a permission request |
| PATCH | `/api/v1/permission-requests/{id}/cancel` | Cancel a permission request (by employee) |
| GET | `/api/v1/permission-requests/{id}/impact` | Get request details + live HC impact |
| PATCH | `/api/v1/permission-requests/{id}/reject` | Reject a permission request |
| POST | `/api/v1/permission-requests/calculate-impact` | Calculate HC impact before submitting a request |
| GET | `/api/v1/permission-requests/employees` | Get active employees for selector |
| GET | `/api/v1/permission-requests/hc-dashboard` | HC coverage dashboard for a date |
| GET | `/api/v1/permission-requests/weekly-usage` | Get weekly permission quota usage for an employee |

## productivity

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| POST | `/api/v1/productivity/analyze` | Upload an Ameyo Agent Productivity Interval export → per-agent productivity (no DB write) |

## reporter

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| POST | `/api/v1/reporter/generate` | Generate a report now |
| GET | `/api/v1/reporter/recipes` | List report recipes |
| POST | `/api/v1/reporter/recipes` | Create/update a report recipe |
| DELETE | `/api/v1/reporter/recipes/{id}` |  |
| GET | `/api/v1/reporter/runs` | List recent report runs |
| GET | `/api/v1/reporter/runs/{id}` |  |
| GET | `/api/v1/reporter/runs/{id}/excel` | Download a report run as Excel |

## reports

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/reports/attendance` | Attendance report |
| GET | `/api/v1/reports/audit` | Audit trail: who/what/when/why |
| GET | `/api/v1/reports/breaks` | Breaks report: duration, shift, approver |
| GET | `/api/v1/reports/coaching` | Coaching flags: trigger, severity, session, resolve time |
| GET | `/api/v1/reports/cross-skill` | Cross-skill coverage dispatch report |
| GET | `/api/v1/reports/late` | Late arrivals report |
| GET | `/api/v1/reports/meta` |  |
| GET | `/api/v1/reports/outages` | Outages: timeline, duration, SLA met/breached |
| GET | `/api/v1/reports/overtime` | Overtime report |
| GET | `/api/v1/reports/overtime-detailed` | Overtime: before/after shift split + % of work hours |
| GET | `/api/v1/reports/permissions` | Permissions report: hours, types, interval breakdown |
| GET | `/api/v1/reports/requests` | Requests & approvals report |
| GET | `/api/v1/reports/requests-detailed` | Detailed requests: approval chain, SLA, reasons |
| GET | `/api/v1/reports/tech-issues` | Technical issues: escalation timeline, CX flag, SLA |
| GET | `/api/v1/reports/workbook` | Download ALL reports as one multi-sheet Excel workbook |

## requests

*Spine: roster_days (HC-impact) + attendance_records (apply)*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/requests` |  |
| GET | `/api/v1/requests/{id}` |  |
| PATCH | `/api/v1/requests/{id}/approve` |  |
| GET | `/api/v1/requests/{id}/attachments` |  |
| POST | `/api/v1/requests/{id}/attachments` |  |
| PATCH | `/api/v1/requests/{id}/cancel` |  |
| GET | `/api/v1/requests/{id}/hc-impact` |  |
| PATCH | `/api/v1/requests/{id}/peer-accept` |  |
| PATCH | `/api/v1/requests/{id}/peer-reject` |  |
| PATCH | `/api/v1/requests/{id}/reject` |  |
| POST | `/api/v1/requests/break` |  |
| GET | `/api/v1/requests/employees` |  |
| POST | `/api/v1/requests/leave` |  |
| POST | `/api/v1/requests/overtime` |  |
| GET | `/api/v1/requests/peer-pending` |  |
| POST | `/api/v1/requests/shift-swap` |  |
| GET | `/api/v1/requests/stats` |  |
| GET | `/api/v1/requests/swap-candidates` |  |

## researcher

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/researcher/digest` | Top improvement opportunities (live gaps; LLM-synthesized when keyed) |
| GET | `/api/v1/researcher/feed` | WFM research feed + gaps, live-detected vs our platform |
| GET | `/api/v1/researcher/status` |  |

## rta

*Spine: attendance_records (resynced from roster_days, step 4)*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/rta/live` | RTA live monitoring snapshot |

## schedule

*Spine: attendance_records + dual-write → roster_days*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/schedule/absence-analysis` | Absence & sick analysis grouped by shift category |
| GET | `/api/v1/schedule/audit-log` | Schedule edit audit log (all manual changes) |
| GET | `/api/v1/schedule/audit-report` | Full schedule edit audit report with filters & summary |
| GET | `/api/v1/schedule/available-weeks` | List weeks with data |
| PATCH | `/api/v1/schedule/cell` | Edit schedule cell — stores full audit in notes |
| GET | `/api/v1/schedule/coverage` | Daily HC coverage summary by function |
| GET | `/api/v1/schedule/day/{employeeId}/{date}` | Employee day detail card |
| GET | `/api/v1/schedule/functions` | List functions for filter |
| GET | `/api/v1/schedule/grid` | Get schedule grid (1–4 weeks) |
| GET | `/api/v1/schedule/shift-codes` | List all supported shift codes for the edit modal |
| GET | `/api/v1/schedule/timeline/{employeeId}/{date}` | Full change timeline for one schedule cell |
| GET | `/api/v1/schedule/week-status` | Get publish/lock status of a schedule week |
| PATCH | `/api/v1/schedule/week-status` | Publish, lock, or revert a schedule week |

## schedule-changes

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/schedule-changes` | List schedule change requests |
| POST | `/api/v1/schedule-changes` | Submit a schedule change request |
| POST | `/api/v1/schedule-changes/{id}/approve` | Approve a schedule change and apply it |
| POST | `/api/v1/schedule-changes/{id}/reject` | Reject a schedule change |

## schedule-generator

*Spine: attendance_records (publish) + roster_days (demand)*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/schedule-generator/available-weeks` |  |
| GET | `/api/v1/schedule-generator/functions` |  |
| POST | `/api/v1/schedule-generator/generate` |  |
| POST | `/api/v1/schedule-generator/generate-demand` |  |
| POST | `/api/v1/schedule-generator/save` |  |
| GET | `/api/v1/schedule-generator/shift-rate` |  |
| GET | `/api/v1/schedule-generator/versions` |  |
| GET | `/api/v1/schedule-generator/versions/{id}` |  |
| POST | `/api/v1/schedule-generator/versions/{id}/publish` |  |

## schedule-rotation

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/schedule-rotation/groups` | List rotation groups |
| POST | `/api/v1/schedule-rotation/groups` | Create rotation group |
| DELETE | `/api/v1/schedule-rotation/groups/{id}` | Delete rotation group |
| PUT | `/api/v1/schedule-rotation/groups/{id}` | Update rotation group |
| POST | `/api/v1/schedule-rotation/groups/{id}/members` | Assign employees to rotation group |
| DELETE | `/api/v1/schedule-rotation/groups/{id}/members/{employeeId}` | Remove employee from rotation group |
| GET | `/api/v1/schedule-rotation/shift-rates` | YTD shift rate distribution per employee |

## scorecard

*Spine: scorecard_monthly / attendance_records (resynced)*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/scorecard/analyze` | Cumulative performance analysis across all uploaded months |
| GET | `/api/v1/scorecard/batches` | List scorecard upload batches |
| DELETE | `/api/v1/scorecard/batches/{id}` | Delete a scorecard batch |
| GET | `/api/v1/scorecard/batches/{id}/dashboard` | Dashboard summary for a scorecard batch |
| GET | `/api/v1/scorecard/batches/{id}/employee/{loginId}` | All-weeks data for one employee in a batch |
| GET | `/api/v1/scorecard/batches/{id}/export` | Export batch rankings as Excel file |
| GET | `/api/v1/scorecard/batches/{id}/rankings` | Final rankings per function for a batch |
| GET | `/api/v1/scorecard/batches/{id}/trends` | Period-over-period trend comparison |
| GET | `/api/v1/scorecard/employees` | Per-employee attendance scorecard for a period |
| GET | `/api/v1/scorecard/functions` | Aggregated scorecard by function |
| POST | `/api/v1/scorecard/upload/commit` | Parse and commit scorecard Excel to the database |
| POST | `/api/v1/scorecard/upload/preview` | Parse scorecard Excel — preview only, no DB write |

## scorecard-guard

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/scorecard-guard/review` | Build + review the scorecard for a week/function |
| POST | `/api/v1/scorecard-guard/scan` | Flag repeat under-performers into coaching |
| GET | `/api/v1/scorecard-guard/weeks` |  |

## security-guard

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/security-guard` | Run the security/compliance battery for the current tenant |

## settings

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/settings` | Get all tenant settings |
| PATCH | `/api/v1/settings/{key}` | Update a setting value |
| GET | `/api/v1/settings/functions` | Functions list with headcount |
| GET | `/api/v1/settings/shift-codes` | Shift code dictionary |

## skills

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/skills` |  |
| POST | `/api/v1/skills/assign/bulk` | Bulk assign skills from rows {employeeNo, skillCode, proficiency?, expiresAt?} (matched by employee_no + code) |
| POST | `/api/v1/skills/dispatch` | Dispatch employee to cover another function + notify |
| POST | `/api/v1/skills/employee/{empId}` | Assign a skill to an employee |
| DELETE | `/api/v1/skills/employee/{empId}/{skillId}` |  |
| GET | `/api/v1/skills/expiring` | Employee skills expiring soon or already expired |
| POST | `/api/v1/skills/expiring/notify` | Notify WFM/RTA about skills expiring within N days |
| GET | `/api/v1/skills/gaps` | Find agents who can cover a function gap |
| GET | `/api/v1/skills/matrix` | Full employee × skill matrix |

## sla

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| POST | `/api/v1/sla/escalate-overdue` | Escalate all overdue (SLA-breached) pending requests + tech issues now |

## smoke-test

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/smoke-test` | Exercise key write/feature paths to catch functional bugs |

## team-learning

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/team-learning` | What each guard learned + experiences exchanged between guards |

## technical-issues

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/technical-issues` |  |
| POST | `/api/v1/technical-issues` |  |
| GET | `/api/v1/technical-issues/{id}` |  |
| POST | `/api/v1/technical-issues/{id}/attachments` |  |
| DELETE | `/api/v1/technical-issues/{id}/attachments/{aid}` |  |
| PATCH | `/api/v1/technical-issues/{id}/reject` |  |
| GET | `/api/v1/technical-issues/{id}/report` |  |
| PATCH | `/api/v1/technical-issues/{id}/resolve` |  |
| PATCH | `/api/v1/technical-issues/{id}/validate` |  |
| GET | `/api/v1/technical-issues/stats` |  |

## users

*Spine: —*

| Method | Path | Summary |
|---|---|---|
| GET | `/api/v1/users` | List users with linked employee info |
| PATCH | `/api/v1/users/{id}/employee` | Link/unlink a user to an employee record |
| GET | `/api/v1/users/{id}/employee-suggestions` | Suggest employees to link to this user (name match) |
