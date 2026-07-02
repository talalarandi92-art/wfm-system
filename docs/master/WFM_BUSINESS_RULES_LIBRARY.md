# WFM BUSINESS RULES LIBRARY — Boutiqaat Contact Center WFM Platform

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> One clean library of EVERY business rule in the platform, each with an ID, status, source, and the code
> path that enforces it. This file **indexes and cross-references** the canonical rule text; it never forks it.
>
> **Canonical master:** `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (cited below as **RULES §n**).
> If this library and RULES ever disagree, RULES wins — then fix this file.
> Companion runbook: `docs/RECON_PIPELINE.md` (cited as **PIPELINE**). Engine docs: `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md`.

## How to read this library

| Field | Meaning |
|---|---|
| **ID** | `BR-<domain>-###`. Domains: TIM time/calendar · SHF shifts · GEN gender · RST rest · OFF off-days · ROT rotation/fairness · OT overtime · LVE leave · ATT attendance/reconciliation · WFH work-from-home · PRM permissions · SWP swaps · TRD tardiness · MAT maternity · ROL role exclusions · ADH adherence · HDC headcount/shrinkage · OUT outages/tech issues · SCC scorecard · APP approvals/schedule lifecycle · HOL holidays · ING ingest safety |
| **Status** | **Confirmed** = dictated/agreed by the WFM Director and recorded (RULES, memory, or an explicit dated decision). **Recommended** = an improvement proposal — per the Director's standing order it is NEVER executed before explicit agreement. |
| **Enforced in** | The live code path(s). "Engine" = `backend/scripts/recon-build.js` (+ `recon-new-roster.js`, `recon-ingest.js`, `recon-refresh.js`) — rules in the engine are re-applied on every Upload & Rebuild, so they can never silently regress (RULES §18). |

**Source-of-truth priority when rules conflict (RULES §0):** 1. latest direct Director clarification → 2. the real uploaded workbook (`Desktop/ROSTER/CC Schedule`, tab "Shifts") → 3. `WFM_RULES_AND_DECISIONS.md` → 4. earlier assumptions → 5. generic WFM practice.

---

## 1. Time & Calendar (BR-TIM)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-TIM-001 | **The workforce week starts SATURDAY** (Sat→Fri). Use `fmtLocal` + `snapToSaturday`; never `toISOString()` for local dates (UTC off-by-one once caused a 3-OFF/week bug). | Confirmed | RULES §2; CLAUDE.md §6.1 | Frontend date helpers; generator week logic; weekend-OFF = DOW 5,6 (Fri/Sat) in `recon.controller.ts` fairness |
| BR-TIM-002 | **Cut-off cycles:** full-time **15th → 14th**; interns **1st → end of month**; Bahrain **25th → 24th**. All OT / attendance / permission-balance accounting buckets by the population's cut-off window, not the plain calendar month. | Confirmed (2026-06-16) | RULES §2; memory `cutoff_cycles` | Period bucketing in reports; permission-balance accounting (BR-PRM-003) |
| BR-TIM-003 | **★ Cross-midnight shift = owned by its START day, for EVERYTHING** — attendance, login/logout, worked hours, OT, permission, sick, leave, swaps, and every request type. The discriminator is the shift's start calendar day, never the end day. A 2 AM permission on D+1 for a shift that started on D is filed under D. General — not holiday-specific. | Confirmed (2026-06-30) | RULES §19 (★ cross-midnight) | Engine: `prevDayBleed = !isWorkingKind && govLogin < 0` in recon-build (a non-working day never credits a previous night's session). Applied June + all future uploads; Jan–May Rule-B backfill pending per-month rebuild (R-003) |
| BR-TIM-004 | Cross-midnight and split shifts must be supported everywhere (parsing, rest calc, adherence, intervals). Post-midnight logins are normalized with **+1440 min** before measuring lateness. | Confirmed | RULES §3, §5; CLAUDE.md §6.2 | Engine session windows; `import-roster-master.js` day-wrap; interval-headcount folds overnight tails into 00:00–07:30 |

## 2. Shift Rules (BR-SHF)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-SHF-001 | **Standard agent shift = 9h INCLUDING a 1h break.** | Confirmed | RULES §3; CLAUDE.md §6.2 | Engine gross/net calc; `role_working_hours`; generator |
| BR-SHF-002 | **`20`-suffix codes (responsible/supervisor) = 8h.** 8h also applies to RTA / Resolution Specialist / Team Leader roles (Customer Care = 9h, explicitly NOT 8h). AM = 8h and is different from M9. | Confirmed | RULES §3; memory `roster_conventions` | `role_working_hours` lookup; `roleOf()` (NAMED_ROLES vs EIGHT_HOUR) in recon backfill |
| BR-SHF-003 | **Ramadan shifts = 7h** (MR/BR/NR/ER/MDR/MNR + CR split). Some Ramadan shifts are split shifts. | Confirmed | RULES §3 | Timing-dictionary parsing; engine expected-hours |
| BR-SHF-004 | **The real workbook Timing sheet is the ONLY shift-code dictionary.** Never hardcode a subset. Suffixes: S=sick, A=absence; OFF/H/L/SL/DL/COMP/RES/TER/UPL/COV are non-working codes. Timing-sheet gotcha: a second CORRUPT block (~row 121+) swaps C/MN times — keep the FIRST occurrence only. | Confirmed | CLAUDE.md §6.3; memory `roster_conventions`, `workbook_import_gotchas` | `import-roster-master.js` Timing parse; engine `classifyCode` |
| BR-SHF-005 | **Canonical shift times** (do NOT invent): M 07–16 · B 09–18 · C 11–20 · N 13–22 · E 16–01(+1) · EE 18–02(+1) · MD 22–07(+1) · MN 23–08(+1). Director-confirmed extras: CCNO = fixed 09–17 (management, record-only) · M7-3 = 07–15 · B20 = 10–18 · C20 = 11–20 · N20 = 14–22 · M20 = 08–16. **No real shift ends at 21:00.** | Confirmed (2026-06 + 2026-06-28) | memory `business_rules`, `new_roster_recon_engine` | `generator.types.ts` SHIFTS; engine code-time map; `roster_days.shift_start_min/end_min` are canonical for the Schedule grid overlay |
| BR-SHF-006 | **THE ONE canonical shift-category mapping** (by CODE, start-hour fallback): Morning/Day = M, B, C, AM (+M20/B20/C20, WFH-M/WFH-B, M7-3, B7); Evening = E, EE20; Night = N, N20 (+WFH-N); Midnight = MD, MN, MDR, MNR. Exclude OFF/H/L/S/A/COMP from the working shift-rate (track separately). | Confirmed | RULES §3 | Target: ONE shared classifier. ⚠ Currently computed **6 conflicting ways** (recon.controller:422/818, schedule.service:876, me.service:51, generator.service:320/375, Schedule.tsx:804) — see R-001 |
| BR-SHF-007 | **Shift Rate % = shift-distribution, NOT pay.** Per employee: Morning/Night/Evening/Midnight counts + % YTD/MTD/period, with before/after impact on every edit or swap (both employees for a swap). | Confirmed | RULES §8; CLAUDE.md §7 | `schedule_change_log` (migration 059) computes before/after; `GET /schedule-generator/shift-rate`; fairness endpoint shift-mix |
| BR-SHF-008 | **Per-function shift policy (operating hours):** Outbound (OMT) → B, N only; Refund → M, B, C, N, E, EE (no MD/MN); unlisted functions = 24/7. Female rule and function policy both apply (intersection). | Confirmed (2026-06) | memory `business_rules` | `FUNCTION_SHIFT_POLICY` in generator.types.ts, applied in `getWorkingShifts` (generator.engine.ts) |
| BR-SHF-009 | Schedule cell shows the **shift code DIRECT** (E/M/B/C/MD/C7…) — no `-WFH` suffix; WFH is conveyed only by the 🏠 icon + dotted texture. Corrected (roster) cells solid, planned cells dashed/faded, holiday cells gold-ribboned. | Confirmed (2026-06-30) | RULES §18 | `schedule.service.ts` getGrid (strips `-WFH$`); `Schedule.tsx` ShiftCell |
| BR-SHF-010 | **Friendly bilingual status labels**, classified by `hr_code` FIRST (so an L-on-holiday reads "Official Holiday" and a worked holiday still shows the shift). OFF→Day Off, H→Official Holiday, L→Annual Leave, SL/S→Sick Leave, A→Absent, DL→Death Leave, COMP→Comp Day, RES/TER→Resignation/Termination. | Confirmed (2026-06-30) | RULES §19 (status labels) | Roster page statusLabel; engine hr_code derivation |

## 3. Gender Rules (BR-GEN)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-GEN-001 | **Female agents normally work up to C shift only (ends 20:00).** Business coverage is the top priority, but the boundary is C. | Confirmed | RULES §7; CLAUDE.md §6.4 | Generator `femaleRule` (M/B/C allowed); `allowFemaleN` default **false** |
| BR-GEN-002 | **Female + N shift = only if operationally necessary, and always flagged.** Three exception paths, all explicit: `functionAllowsFemaleLate()` config (OMT is an all-female team to 22:00 → B/N), per-generation `femaleLateFunctionIds[]` picked at generate time, or the global `allowFemaleN` toggle. Relaxes ONLY the 'warn' tier. | Confirmed | RULES §7; memory `business_rules` | generator.engine.ts `getWorkingShifts`; ScheduleGenerator UI multi-select |
| BR-GEN-003 | **Female agents NEVER work MD/MN (midnight)** — 'blocked' tier; only a logged manual override by WFM/Supervisor may place one, and the system must flag the violation visibly + audit it. The rule is configurable, never hardcoded as an unchangeable constant. | Confirmed | RULES §7; CLAUDE.md §6.4 | Generator blocked tier; fairness proposal marks females `canMidnight=false` → "night only"; manual-edit validation warnings |
| BR-GEN-004 | Male agents: any shift per business need — only rest/fairness/coverage constraints apply. | Confirmed | RULES §7; CLAUDE.md §6.5 | Generator (no gender gate for males) |

## 4. Rest & OFF Rules (BR-RST / BR-OFF)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-RST-001 | **Minimum rest = 10h between consecutive shifts**, cross-midnight aware, unless manually overridden (override must warn + audit). Weekly rotation yields ≥10h by construction. | Confirmed | RULES §8; CLAUDE.md §6.6 | Generator rest constraint; schedule-edit validation |
| BR-OFF-001 | **2 OFF days per week** (perWeek=2 in the generator), exact — the engine must never inject a third. Root-cause fix: `enforceEarlyOff` moves an OFF early when `priorConsecutiveDays` is high instead of adding one. Verified 0/144 employee-weeks with OFF≠2. | Confirmed (2026-06) | memory `business_rules` | generator.engine.ts `assignOffDays` + `enforceEarlyOff` |
| BR-OFF-002 | **No 3+ consecutive OFF days.** Mid-week OFF avoids calendar-adjacency to a taken OFF → within-week runs cap at 1, cross-week runs never exceed 2. | Confirmed (2026-06) | memory `business_rules`; CLAUDE.md §10 | generator.engine.ts `assignOffDays` |
| BR-OFF-003 | **Weekend-OFF fairness** is measured and scored separately: per person weekday/weekend OFF split + `weekendOffShare` (% of ALL Fri/Sat dates in the period they got off — the true denominator). weekendFairnessScore = 100 − 3×stdev of weekend-OFF. | Confirmed (2026-06-23) | RULES §8; memory `shift_fairness` | `GET /attendance-recon/roster-v2/fairness` (`offDistribution`, `justice`) |

## 5. Rotation & Fairness (BR-ROT)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-ROT-001 | **fairnessScore = 100 − stdev** of night+midnight load % over the FAIR POOL (night team excluded). Live snapshot: fairness 79, weekend-OFF fairness 81. | Confirmed | RULES §8 | recon.controller.ts `roster-v2/fairness` |
| BR-ROT-002 | **Night-team carve-out is the Director's choice**: BOTH a fixed dedicated night team AND fair distribution are supported. Table `fairness_night_team` (migration 065), seeded with the de-facto ≥80%-night squad (11 people); its members are excluded from the fairness score. Manual config — not reset by a roster rebuild. | Confirmed (2026-06-23) | RULES §8; memory `shift_fairness` | Migration 065; `GET/PUT roster-v2/fairness/night-team` |
| BR-ROT-003 | **Fairness basis = PRE-SWAP.** Rotation/shift-rate fairness is ALWAYS computed on the schedule BEFORE approved shift swaps (approved swaps are reversed before counting). Swapping away your midnight still counts as yours — swaps must never game rotation. | Confirmed (June 2026) | memory `business_rules`; code comment | `loadYtdDistribution(preSwap=true)` in generator.service.ts:97/224; requests.service.ts:753 |
| BR-ROT-004 | Rebalance proposals use **current staff only** (`employee_identity.is_active`), female moves = night-only (never midnight). The `rebalancePlan` (paired night moves + weekend-OFF moves) is a READ-ONLY proposal — the write lands via the Schedule, never automatically. | Confirmed | RULES §8; memory `shift_fairness` | fairness endpoint `proposal` / `rebalancePlan` |
| BR-ROT-005 | Rotation health: an agent ≥80% on one shift category (fair pool, current, non-night-team) is flagged "stuck on one shift". Relief priority `debt = max(0, nightMidPct − poolAvg) + max(0, weekendShareAvg − weekendOffShare)`. | Confirmed (2026-06-23) | memory `shift_fairness` | fairness endpoint `stuckOnOneShift`, `justice` |
| BR-ROT-006 | Restricted-function rotation: functions with a small allowed-shift set round-robin over their OWN categories per week (fixes OMT collapsing to all-B). | Confirmed (2026-06) | memory `business_rules` | generator.engine.ts `generateWeeklySchedule` (`fnCats`) |
| BR-ROT-007 | The generator must never hide a coverage gap (e.g. small male night pool): show gap + reason + suggested remedies (more male coverage / cross-skill / OT / exception). | Confirmed | CLAUDE.md §11 | Generator gap report output |

## 6. Overtime (BR-OT)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-OT-001 | **TRUE_OT = `ot_min` + `offday_ot_min` + `holiday_ot_min` — three DISJOINT buckets** (`ot_min` is 0 on off/holiday rows; verified no double-count). Total is the SUM, never `total − holiday`. Summing `ot_min` alone undercounts ~28%. | Confirmed (verified 2026-06-24) | RULES §6; memory `unified_roster_metrics`, `ot_exceptions_report` | `TRUE_OT` const in recon.controller.ts, applied to ALL roster_days reports + HR matrix + report-builder OT-Total (fixed commit b6bfcf4) |
| BR-OT-002 | Normal-day OT = worked beyond scheduled shift end (before-shift and after-shift OT captured SEPARATELY — `ot_before_min` / `ot_after_min` — for analysis). OFF/holiday worked = whole day − 1h break. | Confirmed | RULES §6; memory `roster_conventions` #6 | Engine OT calc; `import-roster-master.js` |
| BR-OT-003 | **Holiday-worked = the WHOLE scheduled shift as `holiday_ot_min`, capped at scheduled net**; regular OT = 0; row labelled "Official Holiday — <name> (worked)". Presence stays office/wfh (they were present); H-code non-workers stay holiday. | Confirmed (2026-06-29, via Line Khaled Jun16) | RULES §18 | Engine (recon-build) — re-applied every refresh |
| BR-OT-004 | **OFF/holiday OT must be evidence-backed** (biometric punch span ≤13h); system-only → flag `off_work_unverified` and skip. Off-day OT computed from system activity is bleed-guarded: plausible window ≤12h, **capped at 10h**. | Confirmed | RULES §6; memory `new_roster_recon_engine` (LIVE INGEST) | Engine ingest payload; import-roster-master guards |
| BR-OT-005 | **Bleed guards:** the working branch zeroes `otAfter`/`otBefore` >6h when not corroborated by a punch within 90 min. Engine OT window ceiling = 5h (`OT_MAX=300`); OT ≤2h auto-accepted, >2h flagged for human review (`matches punch ✓` / `capped 5h — verify` / `uncorroborated — verify`). No fixed Director rule for big OT — "look at the system total, compare to punch, accept if logical." | Confirmed (2026-06-28) | RULES §6; memory `new_roster_recon_engine` | Engine `pickWindow`; import-roster-master caps (OT-before 6h / OT-after 8h) |
| BR-OT-006 | **180h/year OT cap** monitoring (EXCEEDED / APPROACHING report). | Confirmed | RULES §6 | OT cap report (roster-v2) |
| BR-OT-007 | OT-day/agent counts must filter `ot_min>0 OR offday_ot_min>0 OR holiday_ot_min>0` (not `ot_min` alone). | Confirmed | memory `ot_exceptions_report` | `/roster-v2/ot-exceptions` |

## 7. Leave, Sick & Absence (BR-LVE)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-LVE-001 | **★ Annual leave on an official holiday counts as the HOLIDAY and RETURNS to the leave balance** (not consumed). `L` on a holiday → presence='holiday', `hr_code='H'`, daily_note set, original L kept in shift_code for audit. Not for DL/UPL. Always — every month. Back-applied to Jan–May (40 rows). | Confirmed (2026-06-30) | RULES §19 (★ annual-leave-on-holiday) | Engine `leaveOnHoliday`; **balance side:** `leave-balances.service.EFFECTIVE_DAYS` subtracts holidays inside an annual-leave span (`GREATEST(0, duration − holidays-in-range)`) — verified: 7-day leave over 6 holidays → 1 day charged |
| BR-LVE-002 | **Sick = `SL`, Absent = `A` in HR-matrix codes.** Never invent "P" (present) — never agreed. Raw shift-aware codes (MS/BS/CS/NS/ES = sick-on-shift; MA/BA/CA/NA/EA = absent-on-shift) stay in `attendance_code`; the HR cell = `COALESCE(hr_code, attendance_code, shift_code, 'OFF')`. | Confirmed | RULES §18; memory `roster_conventions` #2–3 | Engine hr_code derivation (recon-build, same logic as import-roster-master.js:322-330); recon-ingest MAP carries hr_code/attendance_code |
| BR-LVE-003 | **Sick only when the Odoo status says sick — never inferred.** A public holiday is never "absence." | Confirmed | RULES §4 | Engine presence classification |
| BR-LVE-004 | Leave-balance ledger: `leave_balances` stores ONLY `entitlement_days`; taken/pending are computed LIVE from `request_leaves` (never stored → cannot drift). Over-request blocking is **opt-in** (only when an entitlement row exists). Types: annual_leave, comp_off, sick_leave. | Confirmed (2026-06-20) | memory `leave_balance_ledger` | `backend/src/modules/leave-balances/` + migration 038; `assertCanRequest` wired into requests.service createLeave |
| BR-LVE-005 | Odoo individual leave data is NOT trusted (goes stale); Odoo IS trusted for holidays and punch. Schedule is the truth for OFF/work/leave. | Confirmed | RULES §5; memory `roster_data_sources` | Engine source-trust order |
| BR-LVE-006 | On-leave scorecard weeks (WD=0) are NOT scored — KPI cells blank + note "on leave — not scored this week". | Confirmed (2026-06-17) | mini-me `rules-confirmed` | scorecard generator (`backend/scorecard-gen.js`) |

## 8. Attendance Reconciliation & No-Show (BR-ATT)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-ATT-001 | **Combine-both-systems:** total work = UNION of Ameyo ∪ Sprinklr active intervals (overlap counted once; separate periods add). Floor support with no system → use punch. For the official session window: **Ameyo FIRST** (its own first-login→last-logout for the shift), Sprinklr fills gaps only — NOT a blind min/max union (that hid real early-outs). Switchable via `RECON_SYS_MODE` (future: Sprinklr-only when the Director says go). | Confirmed (2026-06-28) | RULES §5; memory `new_roster_recon_engine` | Engine session selection (absolute-minute timeline, shift-relative windows) |
| BR-ATT-002 | **Official late/early basis = SYSTEM login/logout vs schedule** for everyone (matches the Director's manual method); punch late/early kept as separate columns. | Confirmed (2026-06-28) | memory `new_roster_recon_engine` | Engine governance columns |
| BR-ATT-003 | Reconciliation source order: Schedule (truth for OFF/work/leave) → Odoo (holidays + punch + permissions/comp/sick) → Permission/Comp files (only **HR Approved** covers) → Ameyo → Sprinklr (AGENT_OCCUPANCY, since raw login/logout bleeds). Sprinklr times are **LOCAL Kuwait time, not UTC** (no +3). Identity spaces: Odoo/Permissions by Employee ID, Ameyo by User ID, Sprinklr by Email. | Confirmed | RULES §5, §12; memory `roster_data_sources`, `roster_reconcile_tz` | Engine loaders (recon-new-roster.js) |
| BR-ATT-004 | **Bleed guards:** never-closed sessions (logout=1970 / >16h raw) dropped; safe 3-condition drop rule (logs in after shift midpoint AND runs longer than the whole shift AND logs out past schedEnd+2h); residual bleeds capped at schedEnd+2h with a `logout capped — verify early-out` note. Ameyo raw logout bleed → discard >16h, cluster gap >4h. | Confirmed | RULES §5; memory `new_roster_recon_engine` | Engine session guards |
| BR-ATT-005 | **★ No-show = no punch AND no system login on a working day → FLAGGED, never silent, and `worked_min = 0`** (never the scheduled net — we never show "worked 8h" for an unprovable day). `data_quality = "No punch & no system login — verify (not auto-absent)"`. The flag is **role-blind**. | Confirmed (2026-06-30) | RULES §19 | Engine `_ingest.dq` + worked_min=0 (commit 5fa8594) |
| BR-ATT-006 | **worked_min clamp:** a non-working day credits only the validated OT session (never raw never-logged-out bleed — killed a 31h false rest-day); working days capped ≤16h. | Confirmed | RULES §18 | Engine |
| BR-ATT-007 | Presence values: `office · wfh · absent · leave · off · holiday · sick · left · unconfirmed`. Office shift + punch → office; + system-only → office (missing punch); + neither → absent, or `unconfirmed` for low-capture roles observed <70% of days (excluded from absence — don't punish RTA/supervisors during a capture gap). | Confirmed | RULES §4 | Engine + import-roster-master presence classification |
| BR-ATT-008 | Employees are matched by **ID, never name-only**. `person_no` is the canonical person key (intern 6xxxx + full-time 1xxxx collapse to one). `is_active` = canonical-dedup, NOT employment. Function is per-month from the schedule row. Name whitespace collapsed on read. | Confirmed | RULES §1 | `employee_identity` (migration 058) + `backfill-identity.js`; the `sc` CTE join |
| BR-ATT-009 | Never-closed Sprinklr sessions: login-only recovery **NOT enabled** — the Director decided leave-as-is until the recovery method is verified (Fatma/Hassan/Noura may be over-strictly flagged until then). | Confirmed (2026-06-30) | RULES §19 | Engine (deliberate non-change) |
| BR-ATT-010 | Always surface the RAW late/early amount even when excused by permission (Raw columns + Covered flag) — transparency over hiding. | Confirmed (2026-06-28) | memory `new_roster_recon_engine` | Engine record columns; Employee_Tardiness_Summary sheet |

## 9. WFH Rules (BR-WFH)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-WFH-001 | **WFH = a WFH shift code OR an explicit WFH `location` OR Odoo Status=WFH — NEVER inferred from "system login + no punch."** An office-located shift + system session + no fingerprint = MISSING PUNCH (presence='office'), not WFH. The old inference rule was wrong; fixed in both pipelines + 1730 live rows corrected. | Confirmed (CORRECTED 2026-06-24; Option A signed 2026-06-28) | RULES §4, §16; memory `wfh_hr_report`, `roster_conventions` #1 | `import-roster-master.js` (~L248) + engine classify; legacy `recon.engine.ts` also fixed (RULES §16 RESOLVED) |
| BR-WFH-002 | A WFH-code row whose location reads 'Office' → **Data Quality**, never an auto-WFH assertion. | Confirmed | RULES §4 | Engine DQ routing |
| BR-WFH-003 | **WFH work requires system-login proof.** Odoo-absence rescue (Director-approved): Odoo='Absence' but Ameyo+Sprinklr prove a full shift (≥6h), no punch ⇒ reclassified WFH-worked (system-verified) — rescued 288 false absences. | Confirmed (2026-06-28) | memory `new_roster_recon_engine` | Engine rescue branch |
| BR-WFH-004 | **WFH HR report is conservative — "ما بدي اظلم حد" (never wrong anyone).** Weak/ambiguous evidence → Data Quality, NEVER HR. HR gate = WFH AND (late-in OR early-out) AND no permission AND no COMP AND no OT AND NOT completed AND shortage ≥5min AND not excluded role. Cross-midnight single rows, >3h late, <1h sessions → Data Quality. Official holidays (from the editable `holidays` table) → holiday work, never an HR flag. | Confirmed | memory `wfh_hr_report`; audit fix b6bfcf4 | `buildWfhReport` in recon.controller.ts (`roster-v2/wfh-hr-report` + 8-sheet export) |
| BR-WFH-005 | "Completed" for WFH = consolidated system span (earliest login→latest logout, cross-midnight aligned) ≥ scheduled **GROSS** shift (9h/7h) — LOCKED decision (see BR-TRD-002 for the general rule). | Confirmed | memory `wfh_hr_report`; RULES §19 | buildWfhReport; engine `completedReq` |

## 10. Permission Rules (BR-PRM)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-PRM-001 | **Only an Approved ("HR Approved") permission covers** a late-in/early-out; Pending/Waiting → **Manual Review** (never auto-excused, never auto-punished); Refused = no cover. An approved permission NEVER lowers conformance (its minutes are added back to covered overlap). | Confirmed (2026-06-28) | RULES §2, §5; memory `new_roster_recon_engine` | Engine permission matching; MeService + AttendanceService tardiness LATERAL joins |
| BR-PRM-002 | Permission-type matching: `late_in` covers late arrival; `early_out`/`temp_out` cover early departure incl. early system-close. `permission_duration` is a TIME-WINDOW string ("7:00 AM → 9:00 AM") — parse end−start (`parsePermMin`), **never SUM it as a number**. | Confirmed | memory `tardiness_conformance`, `ot_exceptions_report` | requests/permission enum; `parsePermMin` in recon.controller.ts |
| BR-PRM-003 | **Permission balance = 6 hours + 3 permissions per cut-off cycle**, renewing on the population's cycle date (BR-TIM-002). Only Approved permissions consume the balance. | Confirmed (2026-06-16) | RULES §2; memory `cutoff_cycles` | Permission-balance accounting |
| BR-PRM-004 | **Permission HC impact:** every approval must show before/after coverage (Required / Scheduled / On-Permission / Available / Gap) BEFORE approving, with risk warnings. Reads canonical `roster_days` (repointed from stale attendance_records). | Confirmed | CLAUDE.md §13; RULES §16 (RESOLVED); memory `permission_hc_impact_fix` | Request-approval coverage panel; `roster-v2/coverage-impact` |
| BR-PRM-005 | A cross-midnight shift's permission belongs to the shift's START day (BR-TIM-003), whatever clock time the permission covers. | Confirmed (2026-06-30) | RULES §19 | Engine |

## 11. Swap Rules (BR-SWP)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-SWP-001 | **Shift-swap chain: employee requests → PEER accepts/rejects → TL/WFM approve → system validates coverage / rest / gender / skills → approval updates the schedule version.** | Confirmed | CLAUDE.md §19 | requests module swap flow; `applySwap` (requests.service) auto-reflects approved swaps to attendance_records (skips silently if a row is missing — known gap) |
| BR-SWP-002 | **Fairness ignores approved swaps (PRE-SWAP basis)** — see BR-ROT-003. Swap approval shows shift-rate before/after for BOTH employees. | Confirmed | memory `business_rules` | generator.service `loadYtdDistribution(preSwap=true)`; schedule_change_log |
| BR-SWP-003 | Swaps on a cross-midnight shift are filed under the shift's START day (BR-TIM-003). | Confirmed | RULES §19 | Engine day-ownership |

## 12. Tardiness & Conformance (BR-TRD)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-TRD-001 | **Tolerance = strictly greater than 6 minutes.** A late-in/early-out counts (deduction/HR) only when >6 min; ≤6 is tolerated. `HR_MIN = 7` in recon-build; **`CRED_LATE`/`CRED_EARLY` = BETWEEN 7 AND 240** in recon.controller.ts — applies to EVERY month's live reports. | Confirmed (2026-06-30) | RULES §19 | Engine + recon.controller consts (docs corrected in commit b6bfcf4) |
| BR-TRD-002 | **Full-shift SPAN rule (9h INCLUDING the break):** the agent stays logged in through the 1h break, so the system-open span must cover the FULL gross shift — "completed required hours" = `span ≥ gross`, NOT `≥ net`. Leaving early while still logging 8h net IS a real early-out. Maternity-7h stays excluded from early-out; approved permissions still cover. | Confirmed (2026-06-30) | RULES §19 | Engine `completedReq = presenceMin >= GROSS` |
| BR-TRD-003 | **Cap credible late/early at 240 min** — cross-midnight night shifts bleed the post-midnight tail into multi-hour false values (saw 29h). Rows above the cap are surfaced as `excludedDq`, never held against night agents. Tardiness counts exclude permission-covered days (shown separately as excused). | Confirmed | RULES §5; memory `ot_exceptions_report`, `unified_roster_metrics` | `CRED_LATE`/`CRED_EARLY` consts, applied across dashboard/agent-360/team-360/insights/report-builder/HR matrix |
| BR-TRD-004 | **Attendance conformance % = present days with NO unauthorized tardiness ÷ present days** (punch/DB-based; separate from the Sprinklr online-time conformance in `adherence_daily` — the roster shows both). | Confirmed (2026-06-21) | memory `tardiness_conformance` | MeService; `GET /attendance/tardiness` (+ by-hour) |
| BR-TRD-005 | Tardiness bands keep the DB label prefix exactly: "Late 1-5" … "Late 60+", "On time", "No show". | Confirmed | memory `roster_conventions` (Agent 360) | agent-360 endpoint |

## 13. Maternity & 7-Hour Shifts (BR-MAT)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-MAT-001 | **MATERNITY_7H = person_no IN ('12375','12434')** (Haya Mohanna, Shaima Saoud) — measured on a **7h window** and **excluded from EARLY-OUT ONLY** (their 2h-early departure is legitimate; late-in and OT still count). Extend the set only as HR confirms. Also recognizes `*7` codes (M7/B7/C7/N7/E7/MD7/MN7/EE7, M7-3). | Confirmed | RULES §7; memory `unified_roster_metrics` | `MATERNITY_7H` const in recon.controller.ts; engine; WFH report `gross = mother ? min(end-start, 420) : …` |
| BR-MAT-002 | 7h-code days count as 7h (not 9h) in productivity totals. | Confirmed (2026-06-17) | mini-me `rules-confirmed` | scorecard/productivity generator |

## 14. Role Exclusions & the System-Open Policy (BR-ROL)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-ROL-001 | **Excluded (record-only) roles = supervisory ONLY: Team Leader / Senior / RTA / Resolution Specialist / WFM.** Customer Care is NOT excluded (9h, in tardiness). "Record-only" means **exempt from tardiness/HR-action DEDUCTIONS only**. Override with `includeExcludedRoles=1`. | Confirmed (2026-06-28/30) | RULES §19; memory `new_roster_recon_engine` | `isExcludedRole` (recon-new-roster.js); `include_tardiness` flag (emitted by `_ingest`, fixed commit b6bfcf4) |
| BR-ROL-002 | **★ ALL roles must open the system — leaders included (policy 2026-06-30, supersedes the old blind-eye).** The no-punch-AND-no-system flag (BR-ATT-005) is role-blind and fires for leaders too. The Director chose "system-open only" for leaders — NOT full tardiness scrutiny. | Confirmed (2026-06-30) | RULES §19 | Engine `_ingest.dq` (role-blind by design) |
| BR-ROL-003 | Scorecard scope = frontline agents ONLY; exclude `/rta|leader|specialist|customer care|support/i`. | Confirmed (2026-06-17) | mini-me `rules-confirmed` | `isSupportFunc` in scorecard generator |

## 15. Adherence, Headcount & Shrinkage (BR-ADH / BR-HDC)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-ADH-001 | Adherence engine compares scheduled shift vs actual punch + system login + breaks + permissions; outputs adherence %, conformance %, late/early minutes, missing punch/login, unplanned absence, approved vs non-approved exceptions — at agent/TL/function/RTA/WFM grain, daily/weekly/monthly. | Confirmed (spec) | CLAUDE.md §17 | roster_days-based reports; `adherence_daily` (Sprinklr online-time) |
| BR-HDC-001 | Coverage matrices per interval/function: Required / Scheduled / On-Permission / Sick-Absent / Available / Gap / Risk. Interval headcount is cross-midnight aware (overnight tails fold into 00:00–07:30). Per-day report default dates skip marker-only tail days (default = latest day with ≥20 working rows). | Confirmed | CLAUDE.md §13, §15; RULES §11 | `roster-v2/interval-headcount`, `coverage-impact`, hourly-coverage |
| BR-HDC-002 | Shrinkage covers planned (leave, holiday, training, meeting, coaching) + unplanned (sick, absence, permission) → shrinkage %, productive/lost hours, by function/interval, trend. Capacity: voice = Erlang-C (audited 100% vs textbook); chat/WhatsApp concurrency = 4; email = backlog/throughput; intern productivity ≈70% (configurable). | Confirmed | CLAUDE.md §14, §18; memory `capacity_audit` | Capacity module; schedule-analysis; workforce-analytics |
| BR-HDC-003 | `headcount_intervals` is the ONE snapshot exception in an otherwise-live-computed system (currently never INSERTed — see R-006). All other KPIs are computed live from source tables so they cannot drift. | Confirmed (as-built) | memory `data_interconnection_map` | — |

## 16. Outages & Technical Issues (BR-OUT)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-OUT-001 | Outage workflow: report → RTA validates → impact visible to WFM/Ops → owner assigned → SLA tracked → resolution + before/during/after impact → optional email automation → report. | Confirmed (spec) | CLAUDE.md §20 | Outage module |
| BR-OUT-002 | **Technical-issue SLA target = 48 hours.** Flow: agent blocked by system issue → internal hold → validation team/RTA validates → escalate to IT with attachments. | Confirmed (spec) | CLAUDE.md §21 | Technical-issue workflow |
| BR-OUT-003 | **Same issue reason repeated for 20+ customers ⇒ flag as a CX issue.** Track SKU defects for product-quality reporting. | Confirmed (spec) | CLAUDE.md §21–22 | Technical-issue repeated-count / CX flag |

## 17. Scorecard Rules (BR-SCC)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-SCC-001 | **Round-half-up every % KPI to a whole integer BEFORE banding** (89.5→90, 89.4→89). This changes bands → changes points. Applies to Productivity, Quality/QA, FCR, CTR, RES, PRR, Quiz. | Confirmed (2026-06-17) | mini-me `rules-confirmed`; memory `scorecard_build_plan` | `backend/scorecard-gen.js`; scorecard-builder skill |
| BR-SCC-002 | **Scoring bands (decoded from the Director's template — exact):** Quality ≥95→30 / 90→20 / 80→10 / 65→−10 / <65→−20 · PRR points+bonus 2.5 each if PRR≥80% AND RES≥10% · AHT single 48h threshold (≤48h→10 else −10; per-channel bands deferred) · FCR ≥85→20 / 80→10 / 75→5 / <75→−10 · Productivity ≥91→15 / 90→10 / 89→5 / 87-88→0 / ≤86→−15 · CTR ≥95→10 / 90-94→5 / <90→−10 · Quiz 95-100→10 / 90-95→5 / <90→−10 · Mistakes 15−(n×5) · Response Time ≤1h→15 / ≤2h→10 / ≤4h→5 / else −15. **Net Points = sum.** | Confirmed | memory `scorecard_build_plan`; mini-me `scoring-bands` | scorecard-gen.js scoring engine; FILLED template formulas |
| BR-SCC-003 | **Week structure: W1 1–7 · W2 8–14 · W3 15–21 · W4 22→end · Final = whole month** (a separate "Week 5" export folds into W4). **Bar applies on FINAL only** — weekly rows carry real computed values (blank if none); Final carries the bar for bar-KPIs (CTR all functions; FCR for voice/Refund) with a cell note "bar score (reference)". | Confirmed (2026-06-17) | mini-me `rules-confirmed` | scorecard-gen.js |
| BR-SCC-004 | **Quiz commitment: present but didn't solve the quiz → −5 routed through the Common Mistakes column** (Common Mistakes=1 → Mistakes Score 10) + a cell note, because Mistakes IS in the Net formula and Attendance Score is not. On leave → no penalty. | Confirmed (2026-06-17) | mini-me `rules-confirmed` | scorecard-gen.js |
| BR-SCC-005 | **Sick-day penalty on the score: 1 sick day → −2%; 2+ → −5%** (applied to productivity/score per the sheet IF; the sheet gives no extra penalty for >2 — replicate but flag). | Confirmed (2026-06-16/17) | memory `metric_formulas`; mini-me `rules-confirmed` | Productivity formula in scorecard-gen.js |
| BR-SCC-006 | Productivity: `X = WD×9h (7h for maternity/7-codes)` → `Y = X − Short Break` → `Z = Y/X` → sick penalty. Named breaks only (Short/Tea/Lunch/Long/Bio); NOT Unavailable/ACW/Meeting/Training. | Confirmed | mini-me `rules-confirmed`; memory `metric_formulas` | `/productivity` module + scorecard-gen.js |
| BR-SCC-007 | Metric definitions: RES = feedback response rate · PRR = positive response rate (Yes÷responses) · CTR = contacts÷tickets · FCR = closed÷total tickets. CTR/FCR peak overrides: Sprinklr functions (CH-WA, Social/Email) CTR=bar, FCR normal; Inbound/Outbound/Refund CTR=bar AND FCR=bar. | Confirmed (2026-06-16/17) | mini-me `rules-confirmed` | scorecard-gen.js |
| BR-SCC-008 | Function consolidation: **CH-WA = Live Chat + WhatsApp = one function; Social Media & Email = one function** (Sprinklr ONLY for SM&Email — never Ameyo). | Confirmed (2026-06-17) | mini-me `rules-confirmed` | scorecard-gen.js source map |
| BR-SCC-009 | Scorecard grain: `scorecard_entries` = weekly per-KPI detail (one month per load); `scorecard_monthly` = Net Points only; `fcr.employee_id` is a uuid. Grouped scorecard averages must aggregate at PERSON grain before AVG (the current 1:N day-weighted `sc` CTE join is drift R-002). | Confirmed | RULES §9 | recon.controller report-builder `sc` CTE |
| BR-SCC-010 | Delivery format: the Director KEEPS their template ("قالبي أحسن") — the system computes KPI VALUES per agent×week+Final and outputs a SCORED workbook + a FILLED template. The FILLED template is the permanent monthly form. | Confirmed (2026-06-17) | memory `scorecard_build_plan`; mini-me `rules-confirmed` | scorecard-gen.js dual output; scorecard-builder skill |

## 18. Approvals & Schedule Lifecycle (BR-APP)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-APP-001 | **Schedule states: Draft → Generated → Reviewed → Published → Locked.** A **published schedule is NEVER overwritten by a Generate action.** Unlock exists (Locked is not a dead-end). Soft-lock = admin-edit-with-audit, auto-applied on roster upload. | Confirmed | RULES §10; CLAUDE.md §6.7; memory `schedule_unlock_fix`, `schedule_analysis_and_lock` | Schedule module state machine; generator regenerates draft/unpublished only |
| BR-APP-002 | **Manual edits after publish** (authorized users only) must: recalc coverage, rest, female rule, shift-rate, HC-by-interval; write an audit entry; keep version history; show violation warnings + before/after impact. | Confirmed | RULES §10; CLAUDE.md §6.8 | `schedule_change_log` (migration 059) + revert endpoint |
| BR-APP-003 | **Demand→Schedule publish is SAFE by construction:** targets the first EMPTY future week (Saturday after MAX date); single atomic multi-row `INSERT … ON CONFLICT DO NOTHING` (never overwrites); rows tagged `notes='[generated <week>]'`; fully reversible via unpublish. | Confirmed (verified live) | RULES §10 | `roster-v2/generate` → `generate-week` → `save` → `publish`/`unpublish` (migrations 065/066) |
| BR-APP-004 | Every request type carries requester, type, status, approver chain, SLA, before/after impact, attachments, comments, audit trail. Overdue requests auto-escalate (SLA loop, migration 027). Auto Mode auto-approves ONLY safe-surplus requests by coverage (guarded, reversible, opt-in). | Confirmed | CLAUDE.md §19; RULES §13; memory `sla_escalation`, `automode_and_chief_face` | Requests module; SLA escalation loop; Chief/Analyst guard |
| BR-APP-005 | Audit log is real and **append-only** (no UPDATE/DELETE on audit_logs); all sensitive actions logged (actor, action, entity, old/new value, timestamp). | Confirmed | CLAUDE.md §31; memory `business_rules` | audit module |
| BR-APP-006 | **The Director's standing meta-rule: no new or changed business rule is EXECUTED before explicit agreement.** Anything not yet agreed is presented as a Recommendation. | Confirmed (standing order) | memory `feedback_rules`; task brief | Process rule (this library's Confirmed/Recommended split) |

## 19. Holidays (BR-HOL)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-HOL-001 | **Official holidays live in the EDITABLE `backend/scripts/recon-config.json`** (mirrored into the `holidays` DB table on every recon-ingest). Edit the list, re-run `node scripts/recon-refresh.js`. Holiday consumers (WFH HR report, leave balance, engine) read the table/config — never a hardcoded date. | Confirmed | RULES §18–19; PIPELINE; audit fix b6bfcf4 | recon-config.json → engine → `holidays` table; `leave-balances.service`; buildWfhReport |
| BR-HOL-002 | **2026 holiday list (current config):** Jan 1 New Year · Jan 18 Israa Wal Miraj · Feb 25 National Day · Feb 26 Liberation Day · Mar 20–23 Eid ul-Fitr · May 26 Arafat Day · May 27–31 Eid ul-Adha · Jun 16 Hijri New Year. | Confirmed (editable) | `backend/scripts/recon-config.json` | Engine holiday set |
| BR-HOL-003 | Holidays also **AUTO-DETECT** from the Odoo Status column (regex: new year, eid, arafat, national day, liberation, isra/mi'raj, hijri, public holiday, ascension, prophet), propagated date-wide — so future uploads catch every public holiday even if the config lags. | Confirmed | RULES §18 | Engine holiday auto-detect |
| BR-HOL-004 | Holiday-OT varies by month for REAL reasons (Apr=0 no holiday; May high = Eid al-Adha) — never "smooth" it. A leave/off code landing on an official holiday shows a conflict ⚠ for review. | Confirmed | RULES §18–19 | Engine + Roster UI conflict badge |

## 20. Ingest & Data Safety (BR-ING)

| ID | Rule | Status | Source | Enforced in |
|---|---|---|---|---|
| BR-ING-001 | **★ A partial upload may only ever replace ITS OWN date range — never the rest of the month.** The ingest derives its DELETE range from `ingest.json`'s actual min..max dates (`RECON_FROM`/`RECON_TO` env can override), REFUSES to delete when no dated records exist, and refreshes `roster_days_recon_bak` every run (a true undo-last-ingest; restore = `node scripts/recon-ingest.js --restore`, using the backup's own range). Born from the 2026-07-01 incident where a Jun 28–30 test upload wiped Jun 1–27 (root cause: hardcoded month-wide DELETE). | Confirmed (fix commit b7b833d) | RULES §20 | `recon-ingest.js` |
| BR-ING-002 | **`roster_days` (RICH, canonical) vs `roster_daily` (THIN, legacy) — NEVER cross-wire.** Every `roster-v2/*`, HR-matrix, agent-360, ot-exceptions report reads `roster_days`; `/upload`+`/ingest` legacy path writes `roster_daily` (feeds only the legacy `/dashboard`, which auto-ingests when count==0 — a landmine). | Confirmed | RULES §11; memory `roster_days_vs_roster_daily` | Data-tables map discipline |
| BR-ING-003 | **Refresh discipline: dry-run + diff before promoting.** Retarget imports onto a scratch/backup table (`ROSTER_OUT_TABLE=scratch`), diff vs live, only then promote — a prior refresh REGRESSED. Every import flow: preview → row-level validation → commit; raw rows stored; heavy jobs async. | Confirmed | RULES §11; memory `update_files_refresh_attempt`; CLAUDE.md §9 | import scripts pattern; import-batch module |
| BR-ING-004 | **In-system "Upload & Rebuild" = the corrected engine** — `POST /attendance-recon/recon-refresh` (perm `schedule.publish`) drops files into the source folder and runs `recon-refresh.js` (foundation → engine → ingest). Every agreed rule re-applies on every rebuild; the refresh summary reports the ACTUAL ingested range (month-agnostic). | Confirmed | RULES §18; PIPELINE; audit fix b6bfcf4 | recon-refresh endpoint + Roster button |
| BR-ING-005 | Rules must live IN the engine, not in one-off SQL: "a rule that is not in the engine gets overwritten on the next rebuild" — the root cause of every "it worked then broke" regression. | Confirmed | RULES §18 (preamble) | Engine architecture principle |

---

## 21. Decisions Register (selected, dated)

| ID | Decision | Date | Source |
|---|---|---|---|
| D-001 | Engine is the trusted source over manual reconciliation ("مبدئيا انت ادق مني") — after diffing the Director's hand-reconciled May30–Jun27 vs the engine: 0 cases the engine was clearly wrong. | 2026-06-30 | RULES §19 |
| D-002 | Leaders stay record-only for deductions; only the system-open flag applies to them (chose "system-open only", not full scrutiny). | 2026-06-30 | RULES §19 |
| D-003 | Sprinklr never-closed-session login-only recovery NOT enabled — leave as-is until the method is verified. | 2026-06-30 | RULES §19 |
| D-004 | Jan–May left AS-IS (dry-run proved 0 diffs on rules; only a ~3% WFH-detection refinement available) — no risky rebuild. | 2026-06-30 | RULES §18 |
| D-005 | Night-team model: support BOTH a fixed night team AND fair distribution — the Director's per-period choice (migration 065). | 2026-06-23 | RULES §8 |
| D-006 | Fairness basis = PRE-SWAP (swaps must never game rotation). | June 2026 | memory `business_rules` |
| D-007 | Scorecard delivery: keep the Director's template as the permanent form; system fills values (SCORED + FILLED outputs). | 2026-06-17 | mini-me `rules-confirmed` |
| D-008 | No fake/"counterfactual" numbers ever — verified-data-only surfaces (Command Center); declined a fabricated score. Live-vs-corrected sources must be badged. | June 2026 | memory `command_center`, `new_roster_recon_engine` |
| D-009 | Canonical foundation = the Director's latest manual workbook (`Final` sheet, 116 employees); in-system Upload writes to it. | 2026-06-30 | RULES §19 |
| D-010 | Future single-system direction = Sprinklr-only sessions (`RECON_SYS_MODE` flag ready) — flip ONLY when the Director says go; June stays ameyo-first. | 2026-06-28 | memory `new_roster_recon_engine` |

## 22. Known Drifts & Risks (open — do not treat as rules)

| ID | Item | Status |
|---|---|---|
| R-001 | Shift-category computed 6 conflicting ways (BR-SHF-006 is the canonical mapping) — consolidating CHANGES NUMBERS (shift-rate %, fairness); do with full re-validation, Director's eyes on. | Open (RULES §16; audit 2026-07-01) |
| R-002 | Report-builder `sc` CTE 1:N fan-out → grouped scorecard KPIs are day-weighted, not person-weighted. Fix = aggregate at person grain before AVG. | Open (RULES §9, §16) |
| R-003 | Jan–May cross-midnight de-bleed (Rule B, BR-TIM-003) needs a per-month recon rebuild (built by the other pipeline; ~480 rows can't be SQL-corrected). June's full corrected rebuild also pending the Director's PREPARED source files (post-incident rollback state, RULES §20). | Open |
| R-004 | `ot_before_min`/`ot_after_min` NULL after engine ingest (BR-OT-002 detail split) — emit in `_ingest` without changing TRUE_OT semantics; several other MAP-omitted columns too. | Open (audit 2026-07-01) |
| R-005 | Off-day OT from the recon engine (594h vs old pipeline 173h) is the one uncertain field — system-only, no schedule anchor; verify before payroll use. | Open caveat |
| R-006 | `headcount_intervals` never INSERTed (the one snapshot exception) — live Hour×Function before/after impact runs on computed queries instead. | Open (as-built) |
| R-007 | `roster_days` lacks permission start/end minutes → precise intra-day permission-HC impact impossible (day granularity only; `permission_duration` is a text window). | Data limit |
| R-008 | Schedule editCell / demand-publish still WRITE `attendance_records` (reads overlay roster_days) — retarget or badge next. | Open follow-up |

**Recommended (needs Director approval before any execution):** adopt the single shared shift-category classifier (R-001); person-grain scorecard aggregation (R-002); per-month Jan–May rebuild when sources are loaded (R-003); emit OT before/after split in `_ingest` (R-004) — all listed in the 2026-07-01 audit batch-2 plan (memory `audit_2026_07_01_and_consolidation`).

---

*Maintained alongside `docs/knowledge/WFM_RULES_AND_DECISIONS.md`. When a new rule is confirmed: add it there first (it is the master), then register its ID here with the enforcement path.*
