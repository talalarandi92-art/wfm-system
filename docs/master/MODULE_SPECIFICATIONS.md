# WFM Platform — Module Specifications (AS-BUILT + Target)

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> Module-by-module final specification of the Boutiqaat Contact Center WFM platform as it actually runs
> (NestJS + React/Vite + PostgreSQL, live contact-center data, ~80 frontend pages, the recon engine, the
> guard team), plus the agreed target where a gap remains.
>
> **How to read this file**
> - **Confirmed** = agreed with the WFM Director and/or recorded in `docs/knowledge/WFM_RULES_AND_DECISIONS.md`
>   (the single source of truth — cited as **RULES §n**) or a memory note. It is executable policy.
> - **Recommended** = an improvement proposal. Per the Director's standing order, **no new or changed rule is
>   executed before explicit agreement** — nothing marked Recommended may be treated as agreed.
> - Rule IDs: `BR-<MOD>-###`. Risks: `R-<MOD>-###`. Where a rule already lives in a canonical doc, this file
>   summarizes and cross-references; the canonical doc wins on any divergence.
> - Companion docs: `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md` (engine + SQL patterns),
>   `docs/RECON_PIPELINE.md` (rebuild runbook), `docs/knowledge/DESIGN_SYSTEM.md` (UI standards),
>   `CLAUDE.md` (full program scope), `.claude/skills/wfm-system/reference/*`.

---

## 0. Cross-Cutting Foundations (apply to every module)

| Foundation | Confirmed rule | Source |
|---|---|---|
| Identity | `person_no` is the canonical person key; intern `6xxxx` + full-time `1xxxx` collapse to one via `employee_identity` / `Employee_ID_Map.xlsx`. Match by **ID, never name-only**. | RULES §1 |
| `is_active` | Canonical-dedup flag, **NOT** employment. Leavers keep history; forward exclusion via `employees.status`. | RULES §1 |
| Function | **Per-month from the schedule row** (`role_function = COALESCE(NULLIF(month.function_name,''), static)`); "Social Media" and "Social Media & Email" both valid verbatim. | RULES §1 |
| Week | Starts **Saturday** (Sat→Fri). `fmtLocal` + `snapToSaturday`; never `toISOString()` for local dates. | RULES §2 |
| Cut-off cycles | Full-time **15→14**, interns **1→end of month**, Bahrain **25→24**. Permission balance renews per cycle: **6 hours + 3 permissions**. | RULES §2 |
| Shift dictionary | Timing sheet is the source of truth; standard agent shift **9h incl. 1h break**; `20`-codes/leaders **8h**; Ramadan **7h**; mothers `*7` codes 7h. THE one shift-category mapping is RULES §3 (Morning M/B/C/AM · Evening E/EE20 · Night N/N20 · Midnight MD/MN/MDR/MNR). | RULES §3 |
| Cross-midnight ownership | A shift starting day D and ending D+1 belongs **entirely to D** — attendance, worked hours, OT, permission, sick, leave, swaps, every request type. Discriminator = shift **start** day. | RULES §19 ★ |
| Data tables | **`roster_days`** = the RICH canonical table every `roster-v2/*` report reads. **`roster_daily`** = THIN legacy (`/upload`+`/ingest`, `/dashboard` path only). **Never cross-wire.** | RULES §11 |
| Access model | Admin = everything; **RTA + Team Leader = admin minus settings** (`settings.edit`, `admin.*`, `users.*` blocked — migration 040); Agent = own data only (`/me/*` self-service). | memory `final_access_model` |
| Honesty | Never present mock/demo data as complete; never fabricate KPI granularity; flag data-quality instead of silently excusing or accusing. | CLAUDE.md §3, RULES §0 |
| Design | 3 themes (Dark/Light/Aurora-Glass); dazzle kit for KPIs; light-mode near-black net; **no animated background**. | DESIGN_SYSTEM.md |

---

## 1. Forecasting (Volume Forecast + order-driven CPO)

**Purpose / problem.** Predict contact volume per (date, hour, channel) so capacity and scheduling stop being
reactive. Users: WFM Analyst/Supervisor, Ops Manager.

**AS-BUILT (Confirmed).**
- Module `backend/src/modules/forecasting/` (built 2026-06-20). Engine `forecasting.engine.ts` (pure, tested):
  `buildProfile` = (dow,hour)→recency-weighted average volume; `forecastRange`; `accuracy` = **WAPE (headline)
  / MAPE / bias** backtest over matched cells. Model = seasonal-weighted-recency deterministic baseline.
- Inputs: real history from `ops_contacts` (contact_date, contact_hour, channel); AHT from
  `agent_daily_stats.aht_seconds`. Returns `dataPoints` so the UI says "no data" honestly (no fake zeros).
- **Forecast→Required HC**: self-contained Erlang-C (`requiredAgents(volume,{ahtSec,intervalSec,targetSL,
  targetSec,shrinkage,occupancyCap})`) → per-interval requiredHc/occupancy + peakRequiredHc.
- API `/api/v1/forecasting/{channels,volume,accuracy,export,save,saved,saved/:id,saved/:id/override}`
  (perm `hc.view`; export `reports.export`). Persistence: migration 036 `forecasts` + `forecast_intervals`
  with per-cell **overrides** (override_volume/by/at/reason, audited `forecast.override`).
- UI: "Volume Forecast" tab in AnalyticsHub (`/analytics?tab=forecast`) — daily bars, 24h curve, accuracy
  card, required-agents overlay, save/load, click-hour-to-override (amber), Excel export.
- A **second, separate** live forecast exists in the Sprinklr integration (`/integrations/sprinklr/
  contact-forecast`): recent-level(median 14d) × day-of-week shape, ×1.3 P90 buffer, volume from
  `contact_volume_daily` (dense Ameyo daily source). Lesson codified: trailing averages over-forecast after a
  level shift — anchor to a recent median.

**Business rules.**
- BR-FC-001 (Confirmed): WAPE is the headline accuracy metric (robust to zero cells); backtest = forecast a
  past range from data strictly before it.
- BR-FC-002 (Confirmed): overrides never overwrite the model value — effective = override ?? model; every
  override is audited with reason.
- BR-FC-003 (Confirmed): missing history renders as "no data", never as a zero forecast.
- BR-FC-004 (Confirmed, separate idea): **order-driven forecast** — orders × CPO (contacts-per-order) → volume
  → HC (memory `data_assets_and_reports`); planned as its own input path, not yet built.

**Target / Recommended.** Event calendars (Ramadan / campaign / salary-day multipliers — wire the Campaign
Calendar uplift into the model), ML models, accuracy-over-time tracking vs stored actuals, and unifying the
two forecast surfaces (AnalyticsHub vs Sprinklr live) behind one model with two lenses.

**Risks.** R-FC-001: two forecasts from two sources can disagree in front of management — label sources until
unified. R-FC-002: `ops_contacts` recent days are sparse; `contact_volume_daily` is the dense daily source.

**Acceptance.** Backtest WAPE displayed for any range; saved forecast reloads identically; override audit trail
complete; export opens in Excel with Summary/Daily/Intervals sheets.

---

## 2. Capacity Planning (Erlang-C · chat concurrency · email backlog)

**Purpose.** Convert forecast volume into required HC per channel/interval with scenarios. Users: WFM, Ops.

**AS-BUILT (Confirmed).**
- `backend/src/modules/capacity/capacity.service.ts` — **audited textbook-correct** (2026-06-15): stable
  Erlang-B recursion → Erlang-C; serviceLevel `1−C·e^(−(N−A)t/AHT)`; ASA; `findMinAgents` enforces SL +
  **occupancy cap 0.85**; shrinkage gross-up `net÷(1−shrinkage)`. Matches standard Erlang tables to 4 decimals.
- **Chat/WhatsApp**: business concurrency = **4** conversations/agent (Confirmed); the engine applies
  marginal-efficiency `1+(c−1)·0.75` (c=4 → 3.25 effective servers/agent).
- **Email**: backlog/throughput model — async waiting = BACKLOG cleared via Little's Law over an 8h horizon,
  never treated as real-time pressure (the naive model once demanded 4,967 agents for a 10k backlog; correct ≈67).
- **Interns**: productivity factor ≈ **70%**, configurable (Confirmed).
- **Scenarios**: Base (labelled "P90 demand"), Lean, withOT (chat/email), and the accurate **P99 Surge**
  scenario — re-runs `findMinAgents` per interval at volume×1.30 (Erlang is non-linear; naive ×0.9 scaling was
  removed). `capacity_scenarios` save/list/delete.
- Routes `/api/v1/capacity/*` (erlang/concurrent/email POST; live-plan/function-hourly/scenarios GET).
  `/capacity/live-plan` feeds measured Sprinklr in-progress Erlangs directly.
- UI `Capacity.tsx`: modern shell, function picker; **non-frontline roles excluded** from planning
  (`EXCLUDED_FN = /rta|customer care|team leader/i` — Confirmed, no contact queue → no Erlang demand).

**Business rules.** BR-CP-001 occupancy cap 0.85 (Confirmed). BR-CP-002 chat concurrency 4 (Confirmed).
BR-CP-003 feed **P90 demand**, not averages (Confirmed — Cleveland anti-pattern). BR-CP-004 intern 70%
configurable (Confirmed). BR-CP-005 async channels = backlog model (Confirmed).

**Target / Recommended.** Auto-feed saved forecasts into capacity inputs (today caller-supplied); persist
assumption notes per scenario; per-interval intraday reforecast.

**Acceptance.** Erlang spot-checks (C(8,5)=0.1673, C(13,10)=0.2853) hold; A=5, 80/20, AHT180 → 8 agents;
surge > base for every interval; excluded roles never appear in pickers.

---

## 3. Schedule Builder + Generator (demand-driven chain, publish/lock)

**Purpose.** Build, edit, validate, publish and lock the working schedule; generate it from demand fairly.
Users: WFM Analyst/Supervisor; agents consume the published result.

**AS-BUILT (Confirmed).**
- **Schedule grid** (`schedule.service.ts` getGrid + `Schedule.tsx`): weekly/monthly, function/team filters,
  cell edit, Excel import/export, versioning. **The grid OVERLAYS `roster_days`** (RULES §18): covered cells
  show the corrected truth — real WFH/holiday/SL/A, true OT/late, canonical shift times; future weeks fall
  back to the plan. Cell shows the shift code DIRECT (no `-WFH` suffix; WFH = 🏠 icon + dotted texture;
  planned cells dashed; holiday cells gold ribbon). Known follow-up: editCell/publish still WRITE
  `attendance_records`.
- **States** (RULES §10): Draft → Generated → Reviewed → Published → Locked. **A published schedule is never
  overwritten by Generate.** Unlock exists (Locked was a dead-end; fixed — memory `schedule_unlock_fix`).
  **Soft-lock auto-engages on roster upload** = admin-edit-with-audit (memory `schedule_analysis_and_lock`).
- **Fairness/rotation generator** (`/schedule-generator`, `generateWeeklySchedule`): female & function shift
  policies, rest/OFF rules, shift-rate before/after. ("Save as Draft" 500 fixed — memory `generator_save_fix`.)
- **Demand-driven chain** (RULES §10, memory `demand_scheduling_chain`) — all on `roster_days`, endpoints under
  `attendance-recon/roster-v2/*`, UI `ScheduleDemand.tsx` (`/analytics?tab=generate`):
  1. `GET roster-v2/generate` — demand[24] from the real coverage pattern; shift defs via MODE() of real
     windows; greedy **set-cover** shift mix; staffing check (need = shifts×7/6 for one OFF/week); honest
     verdict (coversAllHours / shortHours).
  2. `GET roster-v2/generate-week` — per-employee weekly code + OFF: **females excluded from midnight**;
     night → least historical-night-load first; OFF biased to the weekend-deprived; **weekly rotation ⇒ ≥10h
     rest by construction**; honest male-night flag when males run out.
  3. `POST roster-v2/generate-week/save` → draft (migration 066 `schedule_drafts`); `GET roster-v2/drafts`.
  4. `POST roster-v2/publish` — **SAFE BY DESIGN**: targets the first EMPTY future week (Saturday after MAX
     date); single atomic multi-row `INSERT … ON CONFLICT DO NOTHING` (never overwrites); rows tagged
     `notes='[generated <week>]'`; confirm-gated in UI.
  5. `POST roster-v2/unpublish` — deletes only the tagged rows; fully reversible. Verified live round-trip
     (CH-WA 259→DB→0; idempotent re-publish skipped=259).
- **Schedule-change / swap application**: approved requests auto-apply to the grid with audit
  (`roster-v2/schedule-change/swap/changes/revert`; `schedule-changes` module).

**Business rules.** BR-SCH-001 publish never overwrites (Confirmed). BR-SCH-002 manual edit after publish →
validation + audit + version history + before/after impact on coverage/rest/female rule/shift-rate/HC-by-
interval (Confirmed, RULES §10; full impact panel partially built). BR-SCH-003 min rest 10h cross-midnight-
aware unless overridden (Confirmed, RULES §8). BR-SCH-004 female: up to C (ends 20:00); N only if
operationally necessary (flag); never MD/MN without logged override; configurable (Confirmed, RULES §7).
BR-SCH-005 generator must show gaps honestly with reasons (need males / cross-skill / OT / exception) —
never hide undercoverage (Confirmed, CLAUDE.md §11).

**Validations.** Rest <10h; female-midnight; unknown shift code; leave/absence conflicts; consecutive-days;
coverage shortage; skill/function mismatch.

**Target / Recommended.** Rewire editCell/publish writes onto the roster model (declared follow-up); the
before/after HC + shift-rate impact panel on every manual edit; version compare UI.

**Risks.** R-SCH-001: two write targets (grid writes `attendance_records`, truth reads `roster_days`) until
the rewire lands — the overlay masks but does not remove it. R-SCH-002: old generator path still reads stale
`attendance_records` data for some flows.

**Acceptance.** Publish→unpublish round-trip leaves DB unchanged; re-publish idempotent; a published week
cannot be regenerated; every manual edit appears in audit + version history.

---

## 4. Rotation Engine & Shift Fairness

**Purpose.** Rotate shifts fairly (nobody stuck on midnight; weekend OFFs shared), support both a fixed night
team and fair distribution. Users: WFM, TLs.

**AS-BUILT (Confirmed — memory `shift_fairness`).**
- `GET attendance-recon/roster-v2/fairness` on `roster_days`: per canonical person — category day-counts,
  night+midnight % of working days, OFF, weekend-OFF (Fri/Sat). **fairnessScore = 100 − stdev** of night/mid%
  over the fair pool; **weekendFairnessScore = 100 − 3×stdev** of weekend-OFF share. Live snapshot: 79 / 81.
- **Night-team carve-out** (Confirmed — the Director wants BOTH options): `fairness_night_team` (migration 065),
  seeded with the de-facto ≥80%-night squad (11 people); excluded from the fairness score. `GET/PUT
  roster-v2/fairness/night-team`. NOTE: manual config — a fresh DB needs re-seeding.
- **Justice / relief index**: `debt = max(0, nightMidPct − poolAvg) + max(0, weekendShareAvg −
  weekendOffShare)` → "who deserves relief" list. `offDistribution` (weekday vs weekend OFF split +
  weekendOffShare over ALL weekend dates = the true denominator).
- **rebalancePlan** = concrete paired moves (over-loaded → under-loaded; female-aware `take='night-only'`;
  weekend-OFF give/take pairs). **Read-only proposal** — the write lands in the Schedule (Confirmed stance).
- Shift-mix heatmap, **stuck-on-one-shift** flag (≥80% one category), Excel export (5 sheets), UI
  `ShiftFairness.tsx` (`/analytics?tab=fairness`, 7 tabs).
- Rebalance uses **current staff only**; females = night-only additions (RULES §8).
- Legacy `schedule-rotation` module (rotation groups UI, `ShiftRotation.tsx`) still runs on
  `attendance_records` — its numbers are not roster-accurate (known drift; the roster-v2 fairness endpoint is
  authoritative).

**Business rules.** BR-ROT-001 fairness formula as above (Confirmed). BR-ROT-002 night team is optional and
Director-controlled (Confirmed). BR-ROT-003 proposals never auto-write the schedule (Confirmed).

**Target / Recommended.** "Apply proposal" button writing through the publish pipeline; retire/rewire legacy
schedule-rotation onto roster_days; rotation history view. Also fix the Light-mode rotation modal (audit
finding — hardcoded dark gradient + `bg-slate-800` inputs unreadable in Light).

**Acceptance.** Fairness score reproducible from roster_days by hand; night-team edits change the fair pool
immediately; proposal pairs sum to a net-zero load move.

---

## 5. Request Management (15 types)

**Purpose.** One envelope for every employee request with type-specific extensions, impact awareness and audit.
Users: all staff (submit), TL/WFM/RTA (approve).

**AS-BUILT (Confirmed).**
- Envelope + extension tables (`requests`, `request_types`, `request_leaves`, `request_permissions`,
  `request_breaks`, `request_attendance_corrections`, `request_schedule_changes`, …). Types live:
  permission, sick/annual/death/comp leave, shift swap, OFF swap, OT, **break** (migration 034 — FROM→TO time,
  duration derived 5–240 min, break_date auto = submission day Kuwait time), **Appointments & Exams**
  (renamed `university_exam`, requires_attachment; image/PDF upload 15MB via generic
  `POST /requests/:id/attachments` → polymorphic `attachments`, thumbnails for approver + employee),
  **emergency leave** (migration 025, SLA 2h fast-track), **attendance correction** (own module; approve
  applies whitelisted punch/system fields to attendance + clears missing flags + audit), **schedule change**
  (migration 026; approve upserts the grid from `shift_codes`), WFH request.
- **Permission HC-impact** (Confirmed fix): the approval coverage panel reads canonical **`roster_days`**
  (was stale attendance_records) — approving now correctly drops headcount during the worked hours
  (memory `permission_hc_impact_fix`; RULES §16 RESOLVED).
- **Campaign blackout** wired into submission (warn-only per Ops decision): flags notes ⚠ + notifies WFM/RTA;
  permissions during any active campaign are exceptional → forced `is_urgent`, reviewers notified.
- **Leave-balance gate**: `assertCanRequest` blocks over-request **only when an entitlement row exists**
  (opt-in — see §12).

**Business rules.** BR-REQ-001 every request: requester, type, status, approver chain, SLA, before/after
impact, attachments, comments, audit (Confirmed, CLAUDE.md §19). BR-REQ-002 only **Approved** permissions
consume balance / exempt tardiness (Confirmed, RULES §2/§5). BR-REQ-003 cross-midnight: a request for an
overnight shift files under the shift's **start day** (Confirmed, RULES §19 ★). BR-REQ-004 swap requires peer
acceptance before approval (Confirmed — see §14).

**Target / Recommended.** Alternate-time suggestion on risky permissions; SLA-risk preview at submit time.

**Acceptance.** Each of the 15 types submits, appears in listAll with extension fields, approves/rejects with
audit, and (where applicable) applies its side-effect (attendance fix, schedule upsert, balance draw-down).

---

## 6. Approval Workflow + SLA Escalation

**AS-BUILT (Confirmed).**
- Approval chains per request type (levels in `request_types`); Approvals tab with `RequestCard`.
- **SLA escalation loop** (migration 027, `sla-escalation` module): plain timers (30s first pass, then every
  3 min); finds `status IN (pending,peer_pending) AND sla_due_at < NOW() AND escalated_at IS NULL` → sets
  escalated_at/level 1, notifies rta/wfm_analyst/wfm_supervisor/operations_manager/platform_admin, audits
  (`request.sla_escalated`, actor 'system'). Idempotent. Manual trigger `POST /api/v1/sla/escalate-overdue`
  (`rta.override`).
- **Workflow + SLA reports** (memory `workflow_sla_reports`): approval-chain timeline + SLA per
  request/coaching/outage/tech issue, with KPIs and an expandable timeline.
- **Auto Mode** (migration 031): auto-approves only **safe-surplus** requests by coverage — guarded,
  reversible, opt-in auto-reject; holds are transparent (Confirmed; self-modifying code was DECLINED).

**Business rules.** BR-APR-001 escalation is idempotent and system-audited (Confirmed). BR-APR-002 Auto Mode
never approves into a coverage gap (Confirmed).

**Target / Recommended.** Multi-level escalation (level 2+ after further breach); per-type SLA dashboards on
the Chief.

**Acceptance.** An overdue request escalates exactly once; Auto Mode log shows the coverage math per decision.

---

## 7. Attendance & Reconciliation (THE recon engine)

**Purpose.** Produce the single corrected attendance truth (`roster_days`) from 5 sources; the base of every
report. Users: WFM (owns), HR (consumes), everyone downstream.

**AS-BUILT (Confirmed — canonical runbook `docs/RECON_PIPELINE.md`; rules RULES §4–§6, §18–§20).**
- **Pipeline**: `Foundation (exact shift times from the final "Shifts." sheet) → recon-build engine →
  recon-ingest → live roster_days`. One command: `cd backend && node scripts/recon-refresh.js`. Scripts:
  `recon-extract-foundation-v2.js`, `recon-new-roster.js` + `recon-build.js`, `recon-ingest.js`
  (+`--restore`), `recon-compare-manual.js`.
- **In-system**: Roster page **"Upload & Rebuild"** button = `POST /attendance-recon/recon-refresh`
  (perm `schedule.publish`) — files matched by name into `Desktop/new roster/`, then the same pipeline.
- **Month sources** (5): final CC Schedule (`Shifts.` sheet — the authority), Odoo Fingerprint, Permission &
  Compo, Ameyo login/logout, Sprinklr login/logout.
- **Doctrine: every rule lives IN the engine** (`recon-build.js`) so each refresh re-applies it — a re-ingest
  can never silently wipe semantics. "If a report looks wrong after a refresh, the rule belongs in
  recon-build.js, not patched into the data." (RULES §18.)
- **Rules codified in the engine** (all Confirmed): combine-both-systems (UNION Ameyo ∪ Sprinklr; overlap
  once, separate periods add); source trust (Ameyo ready-end; Sprinklr AGENT_OCCUPANCY not raw; Odoo holidays
  + punch trusted, individual leave stale; punch = office only); **WFH = code or explicit location ONLY, never
  system-no-punch** (RULES §4 CORRECTED — office+system+no punch = missing punch); master **hr_code**
  (SL/A/OFF/L/H/COMP/RES/TER/WFH/shift — HR Matrix reads `COALESCE(hr_code, attendance_code, shift_code,
  'OFF')`); **holiday-worked OT** = whole scheduled shift as `holiday_ot_min` capped at net, regular OT 0
  (holidays auto-detect from Odoo status + editable `recon-config.json` / `holidays` table); **worked_min
  clamp** (non-working day credits only validated OT; working ≤16h); OT bleed guards (discard >16h sessions,
  zero uncorroborated >6h otBefore/otAfter); **cross-midnight owned by start day** (`prevDayBleed` — killed
  85 OFF-day bleeds + 4 double-counted holiday OTs); **leave-on-holiday counts as the holiday and returns to
  balance**; **no-punch-AND-no-system working day = flagged AND worked_min 0, role-blind** (never auto-absent,
  never credited); mothers 7h; approved-permission-only.
- **Ingest safety (RULES §20, incident-hardened)**: ingest deletes **only the date range present in
  `ingest.json`**; refuses when no dated records; `roster_days_recon_bak` refreshed each run (true
  undo-last-ingest); full snapshot `roster_days_predisaster` kept. **A partial upload can only ever replace
  its own days.**
- **Validation**: engine vs the Director's manual month — login 93% / late 96% / early 95% match; 0 cases the
  engine was clearly wrong → **the engine is the trusted source** (RULES §19).
- Jan–May built by the older `import-roster-master.js` path and verified consistent (dry-run diff = 0 material
  changes); June+ on the recon engine. Deprecated: `import-roster-days.js` (cross-midnight gap).

**Business rules (pointers).** BR-REC-001 WFH rule (RULES §4). BR-REC-002 combine-both (RULES §5). BR-REC-003
tardiness tolerance **>6 min** (`HR_MIN=7`; `CRED_LATE/CRED_EARLY BETWEEN 7 AND 240`) (RULES §19). BR-REC-004
full-shift span: system-open must cover the GROSS shift (9h incl. break), not net (RULES §19). BR-REC-005
system-open requirement applies to ALL roles incl. leaders; leaders stay record-only for **deductions** only
(Confirmed decision 2026-06-30). BR-REC-006 holiday never = absence; sick only from Odoo status (RULES §4).

**Open items.** R-REC-001: corrected ingest does **not** populate `ot_before_min/ot_after_min` (audit
2026-07-01 — verified still absent from the MAP): after a recon refresh, OT-before/after views read 0 while
TRUE_OT stays correct. Fix belongs in recon-build/_ingest. R-REC-002: Jan–May "Rule B" cross-midnight
de-bleed needs a per-month recon rebuild when those sources are loaded (RULES §19). R-REC-003: June rows are
the pre-incident snapshot (2733 rows / 103 people); the latest June refinements need a rebuild from the
Director's PREPARED source files (RULES §20 — raw ROSTER exports are NOT the engine sources). R-REC-004:
never-closed Sprinklr sessions (logout 1970) are dropped — decision: leave as-is; may over-flag 3 named people.
(Batch-1 audit fixes already landed in commit b6bfcf4: `include_tardiness` in the ingest MAP, report-builder
OT total, WFH holidays from the table, month-agnostic refresh summary.)

**Acceptance.** `recon-refresh` reproduces every codified rule on a fresh run; `--restore` reverts exactly one
ingest; partial upload touches only its own dates; manual-vs-engine comparison workbook regenerates.

---

## 8. Adherence / Conformance

**AS-BUILT (Confirmed).**
- **Two conformance figures, deliberately distinct** (memory `tardiness_conformance`): (a) punch/DB-based
  **attendance conformance % = present days with NO unauthorized tardiness ÷ present days**; (b) the
  Sprinklr-online-time adherence in `adherence_daily` (migration 017): adherence% = in-shift online ÷ TRACKED
  minutes (untracked excluded honestly); conformance% = worked ÷ scheduled. The roster shows both.
- **Tardy vs permitted**: a late-in/early-out is TARDY unless covered by an **approved** permission of the
  matching type that date (`late_in` covers late; `early_out`/`temp_out` cover early/system-close). Approved
  permission **never lowers conformance** (minutes folded back via `include_tardiness`) (RULES §5).
- Endpoints: `GET /attendance/tardiness` (+`/by-hour`), MeService self views (tardy/permitted counts + per-day
  badges), AttendanceDashboard "Tardiness & Conformance" tab, RosterDashboard permission-aware table,
  `/adherence` (+csv), `/adherence-intraday` (30-min scheduled vs actual HC).
- Cross-midnight: post-midnight login normalized +1440 before measuring late; tardiness capped 240 min with
  the excess surfaced as `excludedDq`, never held against the agent (RULES §5, REPORTS doc).

**Business rules.** BR-ADH-001 tolerance >6 min (RULES §19). BR-ADH-002 240-min credibility cap + excludedDq
(Confirmed). BR-ADH-003 maternity 7h excluded from EARLY-OUT only (RULES §7).

**Acceptance.** Injecting one approved late_in permission converts exactly one tardy→permitted; night agents
never appear in top-early-out via bleed.

---

## 9. Live Headcount + Hourly/Interval Coverage

**AS-BUILT (Confirmed — memory `hourly_analytics`, `hourly_coverage`).**
- `GET /attendance-recon/roster-v2/hourly` — per hour 0–23 × function on `roster_days`: scheduled, working,
  coverage%, permission, tardiness/earlyOut (credible, maternity-excluded) vs permLate/permEarly (authorized),
  shrinkage, otBefore/otAfterHc, otHours/permHours (exact minute overlap via `covMin`), conformance. The
  **cascade model**: `hcWithOt = working + otBefore + otAfter` → `hcAfterPerm = hcWithOt − permLate −
  permEarly` → `effective = hcAfterPerm − tardiness − earlyOut`. Cross-midnight-aware bucket overlap.
  Honesty note (stated to the user): totals are EXACT; the per-hour spread is an interval-attribution model.
- UI `HourlyAnalytics.tsx` (`/analytics?tab=hourly`): 16-col cascade table with shaded "=" checkpoints, TOTAL
  row at bottom, demand-driven coverage recommendation panel (under-covered open hours + suggested category).
- `/coverage/hourly` (coverage module): per-function Required/Scheduled/Available/Gap + one-click "cover gap".
- `interval-headcount` (half-hourly, single-day zoom) + `coverage-impact` per-day report — **default date must
  skip marker-only tail days** (lone RES/TER): default = latest day with ≥20 working rows (RULES §11).
- RTA live: wallboard, queue/agent boards, Sprinklr live HC (see §22).

**Business rules.** BR-HC-001 the cascade definitions above (Confirmed). BR-HC-002 permission HC-impact reads
roster_days (Confirmed). BR-HC-003 cross-midnight shifts staff the late hours of their own date AND the early
hours of the next (REPORTS doc).

**Recommended.** Reconcile the three "HC per hour" curves (ScheduleAnalysis avg / Hourly effective /
IntervalHeadcount scheduled-vs-present) into one definition with zoom levels (audit 2026-07-01 finding).

---

## 10. Shrinkage

**AS-BUILT (Confirmed).**
- Workforce Analytics module: shrinkage weekly/monthly trend, per-function; Schedule Analysis
  (`/schedule-analysis`): shrinkage = lost-hours ÷ schedulable-hours (+ shift-rate, OFF, hourly HC).
- Hourly Analytics reports a per-hour shrinkage **case count/%** (absent+sick+leave off a scheduled shift) —
  a different unit than Schedule Analysis. Both are real; the naming collision is a flagged inconsistency.
- Categories tracked: sick, annual leave, holiday, absence, permission, training/meeting via Sprinklr status
  breakdown; OFF/H/L/S/A/COMP always tracked separately from worked (RULES §3/§8).

**Business rules.** BR-SHR-001 exclude OFF/H/L/S/A/COMP from working distributions; count them as their own
categories (Confirmed).

**Recommended.** Rename one of the two "shrinkage" figures (e.g. hourly → "availability drop") or add a shared
definition note (audit finding); planned-vs-unplanned split per CLAUDE.md §18.

---

## 11. Overtime (3 disjoint buckets)

**AS-BUILT (Confirmed — RULES §6, memory `ot_exceptions_report`, `ot_reconciliation_engine`).**
- **TRUE_OT = ot_min + offday_ot_min + holiday_ot_min** — module consts at the top of `recon.controller.ts`;
  the three buckets are **DISJOINT** (ot_min is 0 on off/holiday rows; verified no double-count; summing
  ot_min alone undercounts ~28%). Total = the SUM, never `total − holiday`.
- Normal-day OT = worked beyond scheduled end. OFF/holiday worked = whole day − 1h break. **OFF/holiday OT
  must be evidence-backed** (punch span ≤13h); system-only → `off_work_unverified`, skipped. Bleed guards zero
  >6h uncorroborated otBefore/otAfter. OT ≤2h auto / >2h flagged (pipeline doctrine).
- **OT & Exceptions report** (`/ot-exceptions`, `roster-v2/ot-exceptions` + `/export` xlsx): OT
  regular/off-day/holiday split, tardiness (240 cap + excludedDq), permissions (`permission_duration` is a
  TIME-WINDOW string → `parsePermMin`), absence; by agent/function/date. Verified live: 10,849h = 8,467
  regular + 2,188 off-day + 194 holiday.
- **Forgotten-OT report** + colored **OT_Review workbook** (attendance-recon OT engine); **180h/year OT cap**
  report (EXCEEDED / APPROACHING); 5h+ OT bonus report.
- Holiday-worked OT rule lives in the engine (§7 above).

**Business rules.** BR-OT-001 disjoint buckets (Confirmed). BR-OT-002 evidence-backed off-day/holiday OT
(Confirmed). BR-OT-003 OT accounting buckets by the population's **cut-off cycle**, not calendar month
(Confirmed, RULES §2). BR-OT-004 cross-midnight OT belongs to the start day (RULES §19 ★).

**Risk.** R-OT-001 = R-REC-001: recon ingest wipes ot_before/ot_after split (open). R-OT-002: off-day OT is
the least-certain field (no schedule anchor) — verify before trusting (RECON_PIPELINE notes).

**Acceptance.** Bucket sums reconcile to TRUE_OT on any range; no OT row appears in two buckets; ranking uses
`COALESCE(...,0) DESC NULLS LAST` (null-bleed gotcha).

---

## 12. Leave & Permission (balances, holiday exclusion)

**AS-BUILT (Confirmed — memory `leave_balance_ledger`; RULES §19).**
- `leave_balances` (migration 038) stores **entitlement only** per (employee, type, year); taken/pending are
  **computed live** from `request_leaves.duration_days` (approved/pending) — balances cannot drift.
  BALANCE_LEAVE_TYPES = annual_leave, comp_off, sick_leave.
- **Over-request block is opt-in**: `assertCanRequest` blocks only when an entitlement row exists; none
  configured → flow unchanged.
- **EFFECTIVE_DAYS holiday exclusion** (Confirmed ★): an official holiday inside an **annual-leave** span never
  costs a leave day — `GREATEST(0, duration − holidays-in-range)`; and an `L` day landing on a holiday is
  recoded presence='holiday', `hr_code='H'`, balance returned (engine + Jan–May back-applied, 40 rows).
  Holidays live in the editable `holidays` table (mirrored from `recon-config.json` each recon-ingest).
  Verified: 7-day leave over 6 holidays → 1 day charged.
- **Permission balance: 6 hours + 3 permissions per cut-off cycle** (full-time 15→14 / interns 1→end /
  Bahrain 25→24); only **Approved** consumes/exempts (RULES §2).
- Admin UI: Settings → Leave Balances grid (entitlement entry, live remaining), bulk paste import by
  employee_no (never name). Agent self-view via `/me/attendance`. Read-scoping fixed (IDOR — own unless
  `requests.view_team/all`).

**Business rules.** BR-LV-001 entitlement-only storage (Confirmed). BR-LV-002 holiday-in-leave exclusion
(Confirmed ★). BR-LV-003 sick never inferred — Odoo status only (RULES §4). BR-LV-004 permission renewal per
cycle (Confirmed).

**Acceptance.** Balance = entitlement − live taken − live pending; holiday inside leave charges 0; block fires
only where entitlement configured.

---

## 13. WFH Management + WFH HR Weekly Report

**AS-BUILT (Confirmed — memory `wfh_hr_report`; RULES §4).**
- **WFH definition (CORRECTED 2026-06-24)**: WFH = WFH shift code OR explicit WFH `location` ONLY — never
  inferred from system-login-without-punch (that is a MISSING PUNCH, presence='office'). 1730 live rows were
  corrected wfh→office (backup `roster_days_wfhfix_bak`). A WFH-code row located 'Office' → Data Quality.
- **WFH HR report** (`roster-v2/wfh-hr-report` + `/export` = 8-sheet xlsx; UI `/wfh-hr-report`): automates
  HR's weekly "who worked from home late/short" ask. **Accuracy-critical — drives HR action; the Director's
  hard rule: "ما بدي اظلم حد" (never wrongly flag); weak/ambiguous evidence → Data Quality, NOT HR.**
- **HR gate (all must hold)**: WFH day AND (late-in OR early-out) AND no permission AND no COMP AND no OT AND
  NOT completed AND shortage ≥5 min AND not an excluded role.
- **Completed (LOCKED decision)** = consolidated system span (earliest login→latest logout, cross-midnight
  aligned) ≥ scheduled **GROSS** shift (9h/7h).
- **Fairness guards**: cross-midnight rows routed to Data Quality (single-row split is incomplete — never
  auto-flag night agents); >3h late or <1h session → Data Quality; mothers measured on a **7h window**;
  holidays excluded (now read from the `holidays` table — the hardcoded 2026-06-16 literal was replaced,
  batch-1 fix). Excluded roles: `include_tardiness=false` or leader/senior/RTA/care/resolution regex;
  override `includeExcludedRoles=1`.
- Outputs: HR_Action / Audit_All / Excluded_Valid / Data_Quality + agent/TL/function/date summaries, each row
  with a reason. Verified 1 May–20 Jun: 2262 WFH days → 17 HR-action / 1682 excluded / 563 data-quality.

**Business rules.** BR-WFH-001 the corrected WFH definition (Confirmed). BR-WFH-002 conservative gate +
Data-Quality routing (Confirmed). BR-WFH-003 validate permission/COMP against the Director's authoritative
files before any final HR submission (Confirmed pending step).

**Acceptance.** No HR_Action row without every gate condition; every excluded row carries its reason; night
agents absent from HR_Action.

---

## 14. Shift / OFF Swap

**AS-BUILT (Confirmed).**
- Peer-acceptance chain: employee requests swap with a colleague → colleague accepts/rejects
  (`peer_pending`) → TL/WFM approval → **auto-applies to the schedule** on final approval (modules doc).
- Validations: coverage, rest, gender rules, skills; before/after shift-rate impact for BOTH employees
  (CLAUDE.md §7/§19). Campaign blackout check on both dates (warn-only).
- `roster-v2/schedule-change/swap/changes/revert` provide the change log + revert on the roster side;
  `/schedule-change-log` UI shows before/after rate bars.

**Business rules.** BR-SWP-001 peer acceptance precedes managerial approval (Confirmed). BR-SWP-002 swap of a
cross-midnight shift is keyed to the start day (RULES §19 ★).

**Acceptance.** A swap approved without peer acceptance is impossible; applied swap visible in change log and
revertible.

---

## 15. Outage Management

**AS-BUILT / spec (CLAUDE.md §20 — partially demo-grade; workflow + SLA reporting live).**
- Workflow: report (agent/TL/RTA) → RTA validates → impact visible to WFM/Ops → owner assigned → SLA tracked →
  resolution + root cause recorded → impact before/during/after → optional email automation (hook built) →
  report. Categories: IVR down, Ameyo, CRM, Sprinklr, app slow, electricity, network, payment,
  exchange/return, other.
- Fields: type, channel impacted, start/end, severity, impacted intervals, available agents, escalated_by,
  validated_by, owner, root cause, resolution, SLA, attachments, comments, audit.
- Covered by the Workflow+SLA reports (approval timeline per outage). Outage email automation code exists
  (task #16 completed); agents have **no outage access** (access model).

**Target.** Full interval-impact calculation tied to live coverage; auto-post to the internal Outage channel.

**Acceptance.** An outage cannot close without resolution + validated_by; SLA breach appears in the SLA report.

---

## 16. Technical Issues Workflow

**AS-BUILT / spec (CLAUDE.md §21; access model wiring Confirmed).**
- Flow: agent blocked by system/CRM issue → case on internal hold (reason: Technical Issue) → validation
  team/RTA validates → escalate to IT → attachments (screenshots/video) → resolution **SLA 48h** → if the same
  reason repeats for **20+ customers → CX-issue flag**.
- Endpoints guarded: list/detail/report self-scoped by reporter; **resolve = `tech_issues.resolve`** (was
  unguarded — fixed); create = `tech_issues.create`.
- Tracks: case ID, customer impact, SKU (links to the Exceptions/SKU-defect tracker idea, CLAUDE.md §22),
  function/channel, reason, validated_by, escalated_to, status, repeated count, CX flag.

**Acceptance.** Repeat counter increments per distinct customer; CX flag fires at 20; SLA report shows 48h
compliance.

---

## 17. Scorecard & Coaching

**Purpose.** Monthly per-agent performance scoring (Net Points) + the coaching loop it feeds. Users: WFM
(builds), TLs (coach), agents (see own), management (rankings).

**AS-BUILT (Confirmed — the full method is the `scorecard-builder` skill; bands in
`.claude/skills/mini-me/reference/scorecard-scoring-bands.md`).**
- **Method**: per-function KPI bands decoded from the Director's real 2026 template (`<Month> SC 26`);
  **round-half-up** every % before banding (`Math.round(v*100)`); **Net Points** = Σ of QualityScore, PRR
  Points+Bonus, AHTScore, FCRScore, ProdScore, CTRScore, QuizScore, MistakesScore, ResponseTimeScore
  (+Commitment) — max ≈130. Bands (examples): Quality ≥95→30 … <65→−20; AHT ≤48h→10 else −10; FCR ≥85→20;
  Productivity ≥91→15 (discrete 90/89 steps); CTR ≥95→10; Mistakes 15−5n; RT ≤1h→15. Bars: QA .95, FCR .85,
  CTR .95 (Sprinklr override 1.0).
- **Confirmed formulas** (memory `metric_formulas`): productivity% = (WD×9 − namedBreaks) ÷ (WD×9) — named
  breaks only (Short/Tea/Lunch/Long/Bio; NOT Unavailable/ACW/Meeting/Training); CTR = contacts ÷ tickets;
  FCR = tickets ÷ closed; **sick-day penalty: 1 sick −2%, 2+ −5%**; quiz-commitment −5 on unsolved weeks;
  maternity ×7 productivity window.
- **Data shape (critical)**: `scorecard_entries` = ONE month only (weekly W1..W4 + Final, no year/month cols);
  `scorecard_monthly` = many months but **Net Points only**; `survey_fcr_monthly.employee_id` is a **uuid** —
  join via employees. Over-time comparison = Net Points only until more months ingest (REPORTS doc).
- Surfaces: `scorecard` board (per-agent weekly drill, unit-aware actuals: AHT=min, RT=day-fraction×1440,
  pct=fraction×100), `agent-scores` leaderboard, `agent-360`, `team-360`, `trends`, `agent-progress`
  (13 monthly metrics + deltas), `agent-period-compare` (length-independent rates only, sick/OT neutral
  context). Excel outputs: SCORED workbook + FILLED template (two files, skill-generated).
- **Coaching** (migration 028): `coaching_flags` auto-scan every 6h over last 30 days — repeated_late /
  repeated_early_out / missing_punch ≥3 → flag (≥6 high, ≥4 medium); idempotent partial-unique upsert;
  notifies TL/WFM/Ops; flag→schedule 1:1 session (`coaching_sessions`, coach = current user, employee
  notified, audited). `/coaching` UI with Flags|Sessions views. Scorecard Guard also raises coaching flags.

**Known drift (Confirmed OPEN — RULES §9/§16, re-verified in the 2026-07-01 audit).** In the Custom Report
Builder the `sc` CTE joins 1:N onto per-day roster rows → grouped `AVG(sc.net)` is **day-weighted, not
person-weighted** (a 22-day agent outweighs an 8-day one) for all 13 sc KPIs in grouped views; per-row detail
is correct. Fix = aggregate at person grain (number-changing — do with full re-validation).

**Target.** Live cumulative scorecard module with QA ingest + weekly/monthly views (memory
`scorecard_system_vision`); multi-month KPI history.

**Acceptance.** Generated workbook matches the template banding cell-for-cell on a validated month; coaching
flag appears within one scan of the 3rd occurrence.

---

## 18. Notification Center

**AS-BUILT (Confirmed).**
- In-app notifications live: request lifecycle (submitted/approved/rejected), SLA escalations, coaching flags
  + sessions, campaign-window reviewer alerts, break-request outcomes, Auto-Mode decisions, guard alerts.
  Skill-expiry alerts built (workforce analytics).
- Spec targets (CLAUDE.md §27): schedule published/changed, outage open/resolved, tech-issue SLA risk,
  scorecard published, missing punch/system, late/early alerts. Channels: in-app now; email / Teams Adaptive
  Cards / push are **future** (Confirmed as future, not built).

**Acceptance.** Every approval/rejection/escalation writes exactly one notification to each intended role.

---

## 19. Dashboards & Reports Center

**AS-BUILT (Confirmed — REPORTS_AND_ROSTER_ENGINE.md is the canonical reference).**
- **Custom Report Builder** (`/report-builder`): three maps — **F** fields / **K** KPIs / **G** groups; Detail
  = raw rows (analyst ground truth, stays RAW), Summary = grouped aggregates; scorecard KPIs join via the `sc`
  CTE; **~33 ready-made presets**; saved views; Excel export; filters (range, search, function, TL, group,
  shift, status, late category, `shiftStartHour` group-by).
- **Custom Dashboard Builder** (`/dashboard-builder`): metrics catalogue incl. all 13 scorecard KPIs +
  coverage/shrinkage/late/early; compose tiles/charts.
- **Report surfaces on roster_days** (`roster-v2/*`): agent-360, team-360, agent-performance, agent-progress,
  agent-period-compare, trends, scorecard board, agent-scores, insights, **hr-matrix** (master codes +
  appended OT/Worked/Late/Early/Absent/Sick/Perm columns), integrity, employee-master, coverage-impact,
  interval-headcount, schedule-analysis, ot-exceptions(+export), wfh-hr-report(+export), hourly, fairness
  (+export), data-quality, system-audit, executive/master exports.
- **Reporter guard** (`/reports-bot`, migration 030): automated daily reports + Excel. Workflow+SLA reports.
- Canonical metric consts (TRUE_OT, CRED_LATE/EARLY, MATERNITY_7H) applied across all summary endpoints so no
  two reports disagree; heavy exports run as async jobs.
- Command Center (`/command-center`): verified-data-only flagship (a fake "counterfactual" score was declined).

**Consolidation plan (Recommended — audit 2026-07-01, awaiting the Director's go).** 80 pages / 66 routes /
~35 sidebar items → extend the proven hub pattern: Roster hub (9 sibling roster pages as tabs), Scorecard hub,
Capacity & Coverage hub, Chief hub for the 13 guard routes; one executive landing; shared DateRangeBar,
default-range helper, one adhColor scale, shared ShiftRateBars/OT-split components.

**Acceptance.** Any preset renders both Detail and Summary without column drift; the same KPI shows the same
number on every surface for the same filter.

---

## 20. Audit & Compliance

**AS-BUILT (Confirmed).**
- Append-only `audit_logs` (actor, action, entity, old/new, timestamp) written by: imports, schedule
  changes/publish, request approvals, attendance corrections, forecast overrides, leave entitlements,
  balance sets, SLA escalations, recon refresh, Auto-Mode decisions, coaching sessions.
- **Security posture**: two hardening passes (CVEs patched, IDOR sweep — leave balances, mixed controllers,
  tech-issue resolve; SSL; never `npm audit fix --force` — it downgrades NestJS); login throttle 10/60s,
  account lock at 5 failures; Security Guard (10 continuous checks); `system-audit` export; Smoke Test guard
  (system-wide GET sweep per role via `scripts/smoke-get.js`).
- Data-quality compliance: `/data-quality` integrity checks; `data_quality` flags on roster rows are
  first-class (no silent excuses/accusations).

**Business rules.** BR-AUD-001 audit log immutable/append-only (Confirmed). BR-AUD-002 every sensitive change
audited with old+new (Confirmed).

**Recommended.** IP/device capture on audit rows; retention policy; periodic access-review report.

---

## 21. The Guard Team + The Chief

**AS-BUILT (Confirmed — RULES §13; modules doc).**
- **Sidebar shows ONLY the Chief** (`/chief`); 8 guards run behind it:
  1. **Health Guard** (`/health-guard`,`/system-health`) — front/back/data + 11 schedule-rule checks.
  2. **Analyst** (`/analyst`, migration 029) — assess coverage/schedule/queues/compliance, recommend, **learns
     from accept/reject**.
  3. **Reporter** (`/reports-bot`, migration 030) — auto daily reports + Excel.
  4. **Advisor LLM** (`/advisor`) — narrates/proposes; Anthropic API + graceful fallback (`ANTHROPIC_API_KEY`).
  5. **Expert** (`/expert`) — WFM knowledge corpus (14 topics) + KB search.
  6. **Security Guard** (`/security-guard`) — 10 account/access/audit checks.
  7. **Scorecard Guard** — builds/reviews scorecard entries → coaching flags.
  8. **Researcher** — curated WFM gap feed (live gap detection).
- **Auto Mode** (migration 031): auto-approves only safe-surplus requests by coverage; guarded, reversible,
  transparent holds. **Self-modifying code was explicitly DECLINED** (Confirmed boundary).
- `/bots` hub, `/knowledge-ledger` (every knowledge item: what/benefit/source/date), `/team-learning`
  (per-guard learnings + exchanges), `/diagnostics` (consolidated daily issues + copy-to-clipboard).

**Acceptance.** Chief renders one executive posture from all guards; every Auto-Mode action reversible and
logged; Analyst decisions change with recorded feedback.

---

## 22. Integrations (Ameyo · Sprinklr · Odoo · KB)

**AS-BUILT (Confirmed — memories `sprinklr_bridge`, `ameyo_bridge`, `knowledge_base_ingestion`; RULES §12).**
- **Sprinklr bridge** (Chrome extension v1.5+, `/integrations/sprinklr/*`): GraphQL interception → push;
  persistent caches; auto-login on 15-min token expiry (rotating refresh token, one-time password wipe);
  snapshot persistence + adaptive-richness hydration + prune guards; **status-transition engine** (migration
  067 `agent_status_events`) → live status durations; Agent 360 drawer, Queue 360, **Agent Board**, Wallboard
  /TV (3 rotating pages), Executive Overview, 24-col agent-daily CSV; **compliance engine** (migration 016:
  excess_break >60min, late_login >10min grace, early_logout, off_schedule, unauthorized meeting/manual-dial;
  thresholds per-tenant in `tenant_settings`); adherence engine (migration 017); break auto-approval only when
  live state allows; **Bridge Doctor** 🩺 self-diagnosis. **Sprinklr login/logout are LOCAL time, not UTC**
  (Confirmed gotcha). Employee link = dual-signal email matcher, unique-match-only, never name-alone.
- **Ameyo bridge** (`chrome-extension-ameyo/`, `/integrations/ameyo/push|/live`): same pattern; **still
  discovery-phase** — parser finalization needs real captured samples; no RTA UI surface yet. Ameyo daily
  volume already ingested into `contact_volume_daily` (1.7M offered, 2020→2026).
- **Odoo**: holidays + fingerprint punches + permissions/comp/sick feeds (trusted for holidays+punch;
  individual leave goes stale — RULES §5); integration completed 2026-06-13.
- **KB ingestion**: 146 Odoo KB articles → `kb_articles` + Expert search (SOP↔KB reconcile pending).
- Future (Confirmed as future): telephony deepening, CRM, Teams, push.

**Risks.** R-INT-001: bridge stops pushing when the Chrome tab is throttled/discarded — operational fix = pin
the tab; Doctor detects it. R-INT-002: Ameyo parser unfinished — voice KPIs limited to file ingests meanwhile.

---

## 23. Employee Master & Identity

**AS-BUILT (Confirmed — RULES §1; memory `employee_identity_function_model`, `employee_id_map`).**
- `employees` (master) → `backfill-identity.js` → `employee_identity` (person_no, is_canonical, clean_name)
  → `roster_days`. Intern 6xxxx → full-time 1xxxx merges via `Employee_ID_Map.xlsx`; Employee Merge tool
  (migration 005) for duplicate rows.
- **Leaver rule**: remove from forward scheduling only when next month's schedule stays empty
  (`employees.status='inactive'`); history always visible (is_active = canonical-dedup).
- **Attrition** (memory `attrition_rate`): separations = RES/TER markers on roster_days; **Transfer = internal
  move, NOT attrition** (separate list); rate = separations ÷ avg monthly distinct headcount, annualized.
  `/analytics?tab=attrition`.
- User management: manual + pending + self-register approval + Excel/CSV bulk import
  (preview→validate→commit, temp passwords). Name whitespace collapsed on read; match by ID.
- **Rebuild order caveat**: the manual master corrections (leaver statuses, inserted RES/TER/Transfer markers,
  function_id sync) are NOT re-derived by a roster rebuild — re-apply or guard after re-imports.

**Acceptance.** Every person appears once in any report; a leaver's past months never change; a transfer never
inflates attrition.

---

## 24. Campaign Calendar

**AS-BUILT (Confirmed — memory `campaign_calendar`; migration 024).**
- `campaigns` table (type: Flash Sale/Mega Sale/Eid/Ramadan/National Day/Other; date range;
  `restricted_types` jsonb; `required_hc_uplift_pct`). `/api/v1/campaigns` list/active/check/CRUD; UI
  `/campaigns` (perm `schedule.view`).
- **Blackout behavior = warn-only (Ops decision)**: leave + swap submissions during a window flag notes ⚠ and
  notify WFM/RTA — never block. **Permissions during any active campaign are exceptional**: flagged, forced
  `is_urgent`, reviewers notified (independent of restricted_types).

**Target / Recommended.** Feed `required_hc_uplift_pct` into forecasting/capacity as an event multiplier
(links to BR-FC target).

---

## 25. Module Status Summary

| Module | Status | Canonical source |
|---|---|---|
| Forecasting | LIVE (baseline model + persistence + overrides); events/ML pending | memory `forecasting_module` |
| Capacity | LIVE, math audited 100% | memory `capacity_audit` |
| Schedule + Generator | LIVE; grid overlays roster_days; write-rewire pending | RULES §10/§18 |
| Rotation/Fairness | LIVE on roster_days; legacy rotation module stale | memory `shift_fairness` |
| Requests (15 types) | LIVE | modules doc, migrations 025/026/034 |
| Approval + SLA | LIVE (loop + Auto Mode) | migrations 027/031 |
| Recon engine | LIVE — THE base pipeline; ot_before/after ingest gap OPEN | RECON_PIPELINE.md, RULES §18–20 |
| Adherence/Conformance | LIVE (two defined figures) | RULES §5/§19 |
| Hourly/Interval HC | LIVE (cascade model) | memory `hourly_analytics` |
| Shrinkage | LIVE (two units — rename pending) | audit 2026-07-01 |
| Overtime | LIVE (3 buckets, canonical consts) | RULES §6 |
| Leave & Permission | LIVE (ledger + holiday exclusion) | migration 038, RULES §19 |
| WFH + HR report | LIVE, conservative | memory `wfh_hr_report`, RULES §4 |
| Swap | LIVE (peer-accept → approve → apply) | modules doc |
| Outage / Tech issues | Workflow + SLA live; parts demo-grade | CLAUDE.md §20–21 |
| Scorecard & Coaching | LIVE (skill-encoded method); grouped-avg drift OPEN | scorecard skills, RULES §9 |
| Notifications | In-app LIVE; email/Teams/push future | CLAUDE.md §27 |
| Reports/Dashboards | LIVE (~33 presets + builders); hub consolidation awaiting go | REPORTS doc, audit |
| Audit & Compliance | LIVE (append-only + guards + smoke test) | memory security notes |
| Guards + Chief | LIVE (8 guards, Auto Mode) | RULES §13 |
| Integrations | Sprinklr deep-live; Ameyo discovery; Odoo done; KB ingested | RULES §12 |
| Identity & Attrition | LIVE | RULES §1 |
| Campaign calendar | LIVE (warn-only) | migration 024 |

---

## 26. Open Risks Register (cross-module, most material first)

| ID | Risk | Status |
|---|---|---|
| R-REC-001 | Recon ingest omits `ot_before_min/ot_after_min` → OT-before/after views zero after refresh | OPEN (verified 2026-07-02) |
| R-SC-001 | Report-builder grouped scorecard averages day-weighted (§17) | OPEN — number-changing fix |
| R-CAT-001 | Shift-category computed 6 conflicting ways vs RULES §3 canonical mapping | OPEN — number-changing fix |
| R-REC-002 | Jan–May cross-midnight de-bleed needs per-month recon rebuild | OPEN |
| R-REC-003 | June rows = pre-incident snapshot; rebuild needs the Director's prepared source files | OPEN |
| R-SCH-001 | Grid edit/publish still writes attendance_records while truth reads roster_days | OPEN follow-up |
| R-INT-001/2 | Bridge push stoppage (pin tab); Ameyo parser unfinished | Operational / discovery |
| R-UI-001 | Rotation modal + several roster pages break in Light mode; `keep-dark` class unused | OPEN (audit) |
| R-IA-001 | ~40 standalone pages pending hub consolidation | Awaiting Director's go |

*(Batch-1 audit fixes already shipped in commit b6bfcf4: include_tardiness ingest, report-builder OT-total
detail column, WFH holidays from the `holidays` table, month-agnostic recon-refresh summary.)*
