# SYSTEM LEARNINGS & IMPROVEMENTS — Boutiqaat WFM Platform

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> This file records everything the system *learned the hard way*: ambiguities that were resolved,
> improvements that hardened the engine, corrections that changed numbers, risks discovered but not yet
> retired, automation opportunities, and the non-negotiable operating rules that must survive any rebuild.
>
> **Status vocabulary (used rigorously):**
> - **Confirmed** — agreed with the WFM Director and recorded in `docs/knowledge/WFM_RULES_AND_DECISIONS.md`
>   or the project memory. Executable now.
> - **Recommended** — an improvement identified by audit/review that **needs the Director's approval before
>   execution**. Standing order: no new or changed rule is executed before agreement.
> - **Needs Approval** — a fully documented plan explicitly parked awaiting the Director's go
>   (e.g. the page-consolidation plan, D-068). **Deferred** — agreed to postpone; revisit condition stated.
>
> **Canonical sources this file summarizes (one master per fact — do not fork):**
> - `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (rules §1–20 — THE source of truth)
> - `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md` (engine + endpoints)
> - `docs/RECON_PIPELINE.md` (refresh runbook)
> - Memory notes: `audit_2026_07_01_and_consolidation`, `new_roster_recon_engine`,
>   `update_files_refresh_attempt`, `deep_review_2026_06_20`, `typeorm_rawquery_gotchas`,
>   `workbook_import_gotchas`, `security_audit`, `security_hardening_phase2`,
>   `roster_days_vs_roster_daily`, `predemo_audit_and_datefix`, `nav_hub_consolidation`.

---

## 1. What Was Unclear Before (and how each was resolved)

Numbered as **L-###** (learnings). Each entry: the ambiguity → the resolution → where the truth now lives.

| ID | Was unclear | Resolution | Canonical home |
|----|-------------|------------|----------------|
| L-001 | **Shift-category classification** — computed **6 conflicting ways** in code (`recon.controller.ts:422,818`, `schedule.service.ts:876`, `me.service.ts:51`, `generator.service.ts:320,375`, `Schedule.tsx:804`). A 14:00 shift was "evening" in one site and "night" in another; some sites used start-hour, some code-prefix, one a 3-way collapse. | **ONE canonical code-keyed mapping** decided (Confirmed): Morning/Day = M, B, C, AM (+ M20/B20/C20, WFH-M/WFH-B, M7-3, B7); Evening = E, EE20; Night = N, N20 (+ WFH-N); Midnight = MD, MN, MDR, MNR. OFF/H/L/S/A/COMP excluded from working shift-rate. Code unification is **still pending** (number-changing — see R-003). | WFM_RULES_AND_DECISIONS.md §3 |
| L-002 | **`hr_code` semantics** — the HR Matrix cell is `COALESCE(hr_code, attendance_code, shift_code, 'OFF')`, but for months nobody knew *which pipeline set hr_code*. The corrected recon ingest never wrote it → every June re-ingest left it 100% NULL → sick showed raw `NS/ES` instead of `SL`, absence `CA/BA` instead of `A` — the recurring "HR Matrix خربت / it worked then broke" mystery. | hr_code + attendance_code are now computed **IN the engine** (`recon-build.js`, same logic as `import-roster-master.js`): sick→`SL`, absence→`A`, off→`OFF`, leave→`L` (DL/UPL kept), holiday→`H`, comp→`COMP`, separation→`RES`/`TER`, WFH-working→`WFH` (shift kept in attendance_code), office-working incl. forgot-to-punch→the SHIFT CODE (never OFF/absent). Added to the recon-ingest MAP. **Root principle learned: a rule that is not in the engine gets overwritten on the next rebuild.** | WFM_RULES_AND_DECISIONS.md §18; memory `new_roster_recon_engine` |
| L-003 | **Sprinklr timestamps** — assumed UTC, causing +3h drift; a later export format stored 1899-epoch serials with an LMT +3:11 offset; raw login/logout also "bleeds" (never-closed sessions read 25–29h). | Sprinklr login/logout is **LOCAL time, not UTC** (no +3 shift). Read raw serials (`cellDates:false`) + `serialToISO`; times from `frac*1440`. Use the **AGENT_OCCUPANCY** report instead of raw sessions where possible; bleed sessions are dropped by a safe 3-condition rule and residuals capped at schedEnd+2h. | WFM_RULES_AND_DECISIONS.md §12; memory `roster_reconcile_tz`, `new_roster_recon_engine` |
| L-004 | **WFH detection** — originally *inferred* from "system login + no punch," silently converting forgot-to-punch office days into WFH. | **CORRECTED (2026-06-24):** WFH = WFH shift code OR explicit WFH `location` ONLY — never inferred. Office shift + system session + no fingerprint = **missing punch, presence=`office`**. 1,730 live rows corrected wfh→office; both the rich builder and the legacy `recon.engine.ts` fixed. | WFM_RULES_AND_DECISIONS.md §4 |
| L-005 | **Which roster table is real** — two tables with near-identical names: rich `roster_days` (74 cols today — person_no, OT buckets — read by every roster-v2 report) vs thin `roster_daily` (18 cols incl. `payload jsonb`, written by `/upload`+`/ingest`, read only by the legacy `/dashboard` path). Refreshes aimed at the wrong one "did nothing" or nearly corrupted the right one. | Documented as a hard rule: **never cross-wire**. `/dashboard` auto-fires a destructive ingest of roster_daily when count==0 (landmine). Refresh of roster_days goes ONLY through the standalone recon/import scripts. | WFM_RULES_AND_DECISIONS.md §11; memory `roster_days_vs_roster_daily` |
| L-006 | **Whose numbers to trust** — the Director manually reconciled May 30–Jun 27 and we diffed engine vs manual: login 93% / late 96% / early 95% match, and of 166 diffs **0 were cases the engine was clearly wrong** (most were the manual grabbing a wrong cross-midnight session or missing a Sprinklr session). | Director's verdict: **"the engine is the more accurate, trusted source."** Two rule corrections came out of the review (tolerance >6 min; full-shift 9h span) — see §4. | WFM_RULES_AND_DECISIONS.md §19 |
| L-007 | **Cross-midnight ownership** — which day owns a shift that starts on D and ends on D+1 (attendance? OT? a 2 AM permission?). Ambiguity caused double-counted holiday OT on 2026-06-16. | **Confirmed: a cross-midnight shift belongs ENTIRELY to its START day, for everything** — attendance, worked hours, OT, permission, sick, leave, swaps, every request type. General rule, not holiday-specific. | WFM_RULES_AND_DECISIONS.md §19 (★ cross-midnight) |
| L-008 | **Identity** — same person under intern ID (6xxxx) and full-time ID (1xxxx); duplicate names via double-spaces; function changing per month. | `person_no` is canonical (Employee_ID_Map merges); `is_active` = canonical-dedup NOT employment; function is per-month from that month's schedule row; match by ID, never name. `backfill-identity.js` MUST run after every `import-roster-master.js` rebuild. | WFM_RULES_AND_DECISIONS.md §1 |
| L-009 | **Workbook structure quirks** — Shifts-sheet future dates hold stale formula `0`; Timing sheet has two blocks (Ramadan redefines M/B/C lower down); Jan–Mar matrix sheets have NO Team column (dates start col 6) vs Apr–Jun (col 7), which silently dropped the 1st of Jan/Feb/Mar and mis-marked ~3,259 WFH days absent. | Matrix backfill for future codes; first-occurrence-wins on Timing; **detect columns by HEADER NAME, never position**. Core times confirmed: M 07-16, B 09-18, C 11-20, N 13-22, E 16-01, MD 22-07, MN 23-08; CCNO 09-17, M7-3 07-15, B20 10-18, C20 11-20, N20 14-22, M20 08-16. | memory `workbook_import_gotchas`, `update_files_refresh_attempt` |
| L-010 | **Holiday authority** — which source declares an official holiday (schedule H-codes missed workers; regex missed Israa Wal Miraj / Liberation Day). | The **Odoo Status column is the holiday authority**, propagated **date-wide** (a holiday applies to everyone who worked that date), PLUS an editable list in `backend/scripts/recon-config.json` mirrored to the `holidays` table on every ingest. A holiday is never "absence." | WFM_RULES_AND_DECISIONS.md §18 |
| L-011 | **Intern-fold + generator fairness + female-shift leaks (2026-07-04)** — (a) "Internship X" functions counted as SEPARATE headcount from the parent team (CH-WA 25 not 38); (b) generators FROZE 48/75 women on one shift (avg 1.39 distinct vs the manual roster's 5.37) — fairness balanced only by CATEGORY, so day-locked women tied and never rotated; (c) both generators LEAKED female-blocked shifts (E ends 01:00) to women because "evening" collapses to "day". | (a) ONE `canon_fn()` (migration 068) folds interns into the parent at every headcount/coverage/pool/dropdown site (identity labels stay raw; function_id/UUID-FK modeling surfaces granular). (b) Added specific-code fairness (rotate M→B→C) + a female rotation guard. (c) Gate female eligibility by the female-blocked CODE (E/EE/MD/MN) not category; females day-only, N only via `allowFemaleN`. Manual edit/swap now `staleMetricReset`s window-derived metrics. Whole schedule module deep-tested end-to-end (generate→schedule→headcount→requests→fairness all proven). | WFM_RULES_AND_DECISIONS.md §1/§7/§10; memory `deep_test_schedule_2026_07_04`, `generator_female_fairness`, `ladder_rotation` |

---

## 2. What Was Improved (engine hardening — all Confirmed & live)

The 2026-06-28 → 2026-07-01 hardening arc turned the reconciliation engine into the trusted base. Every
rule below lives **inside** `backend/scripts/recon-build.js` (or the recon controller), so every
`recon-refresh` re-applies it — the permanent fix for "it worked, then a re-ingest broke it."

### 2.1 Engine hardening list (rules doc §18–19)
1. **Holiday-worked OT** — anyone working a scheduled shift on an official holiday gets the WHOLE shift as
   `holiday_ot_min` (capped at scheduled net), regular OT = 0, row labelled "Official Holiday — <name> (worked)".
   Jun 16 (Hijri New Year): 51 workers → 406h holiday OT.
2. **Master HR codes in-engine** (see L-002).
3. **worked_min clamp** — a non-working day credits only the validated OT session, never raw never-logged-out
   system bleed (killed a 31h false rest-day); working days capped ≤16h; persistent sessions capped at
   shift-gross+5h with `data_quality='persistent-session-capped'`.
4. **Tardiness tolerance > 6 min** — late/early counts only when strictly >6 min (`HR_MIN=7` in recon-build;
   `CRED_LATE`/`CRED_EARLY = BETWEEN 7 AND 240` in recon.controller — applies to ALL months' live reports).
5. **Full-shift span** — "completed required hours" = system-open span ≥ GROSS shift (9h incl. break), not net 8h.
6. **No-punch-AND-no-system = flagged, worth 0** — `data_quality='No punch & no system login — verify (not
   auto-absent)'` AND `worked_min=0`. Role-blind: leaders included (policy 2026-06-30 — everyone must open the
   system; `isExcludedRole` exempts leaders from *deductions* only).
7. **Cross-midnight = start-day** (`prevDayBleed`) — see L-007/§4.
8. **Annual leave on an official holiday → counts as the holiday, returned to the leave balance** — presence
   `holiday`, `hr_code='H'`, original `L` kept in shift_code; `leave-balances.service.EFFECTIVE_DAYS` subtracts
   holidays inside an annual-leave span. Back-applied to Jan–May (40 rows). Always, every month.
9. **Permission handling** — only **HR Approved** covers (adds minutes back to conformance); Pending/Waiting →
   Manual Review; raw late/early ALWAYS kept on record even when excused ("covered by permission" note).
10. **Session selection = Ameyo-first**, Sprinklr fills gaps (never min/max union — the union hid real
    early-outs); shift-relative windows on an absolute-minute timeline; OT ceiling 5h (`OT_MAX=300`), OT ≤2h
    auto-accepted, >2h flagged for the Director's eye. Source switchable via `RECON_SYS_MODE` (Sprinklr-only
    ready for the planned migration — do not flip without the go).
11. **In-system Upload & Rebuild** — `POST /attendance-recon/recon-refresh` (perm `schedule.publish`) + the
    Roster "رفع وإعادة بناء" button run `recon-refresh.js` (foundation→engine→ingest). Uploading FROM the
    system = the corrected base. Runbook: `docs/RECON_PIPELINE.md`.
12. **Schedule ↔ roster linkage** — the Schedule grid OVERLAYS `roster_days` (code AND canonical times both
    from roster_days) when covered; future weeks fall back to the plan; shift code shown DIRECT (no `-WFH`
    suffix — WFH = 🏠 icon + dotted texture); planned cells dashed; holiday cells gold ribbon.

### 2.2 Batch-1 audit fixes (2026-07-01 A-to-Z audit, commit `b6bfcf4` — Confirmed, live)
1. **`include_tardiness` ingest** — recon-build `_ingest` now emits it (`!dayExcluded`) + added to the
   recon-ingest MAP. It was NULL after every corrected upload → `AND r.include_tardiness` filtered out EVERY
   row → tardiness rankings / `?onlyTardiness=1` returned **empty** while the data was fine.
2. **Report-builder "OT Total" column** → the 3-bucket sum `(ot_min + offday_ot_min + holiday_ot_min)`
   (was bare `ot_min`, which is 0 by design on off-day/holiday-worked rows → OT Total showed 0).
3. **WFH HR report holidays from the `holidays` table** (was a hardcoded single `2026-06-16`) — WFH work on
   Arafat/Eid/National Day now correctly counts as holiday, never an HR case. Dead `WFH_HOLIDAYS` field removed.
4. **Month-agnostic recon-refresh summary** — parses the engine log "ingest range: X..Y" and reports the
   ACTUAL ingested range (was hardcoded `>= 2026-06-01 AND < 2026-07-01`, so any non-June upload summarized
   as "0 rows" and looked broken).
5. Doc correction `CRED 1..240 → 7..240 (>6 tolerated)`; dead `Placeholder` import removed.

### 2.3 Ingest safety (2026-07-01 incident fix, commit `b7b833d` — Confirmed, live)
After a partial test upload (Jun 28–30) **wiped Jun 1–27** (hardcoded month-wide DELETE), `recon-ingest.js`
now: deletes **only the min..max date range actually present in `ingest.json`** (`RECON_FROM`/`RECON_TO`
override); **refuses to delete when there are no dated records**; and refreshes `roster_days_recon_bak`
every run (true undo-last-ingest — `node scripts/recon-ingest.js --restore`). **A partial upload can now
only ever replace its own days.** Full pre-incident snapshot kept in `roster_days_predisaster` (15,794 rows).

---

## 3. What Was Merged / Consolidated

### 3.1 Done (Confirmed)
- **6 tabbed hubs** (2026-06-14, `frontend/src/pages/*Hub.tsx`, `HubTabs` + `?tab=` + permission-gated tabs +
  `<Navigate>` redirects from old routes): **AnalyticsHub** `/analytics`, **SchedulingHub** `/schedule`,
  **AttendanceHub** `/attendance`, **LiveOpsHub** `/rta`, **WorkspaceHub** `/chat`, **EmployeesHub**
  `/employees`. Sidebar shrank ~28→~22; tab bar hides when a user can see only one tab.
- **DateRangeBar rollout** (commit `c1be5f7`) — the shared single-calendar range picker + Saturday-week
  presets is now used by OT & Exceptions, Schedule Analysis, Agent 360, WFH HR Report (born from the Roster
  page's picker, commits `9f672c4`/`afcac66`).
- **Guard team behind the Chief** — sidebar shows only the Chief; the 13 guard pages are hidden routes.
- **Nav-farm reality check** — Roster.tsx still carries an 11-button header link-farm and its own inline
  duplicate of the range picker (~130 lines); RosterDashboard/HourlyAnalytics/ScheduleChangeLog/
  IntervalHeadcount still use bare native date inputs; every page boots with a different hardcoded 2026
  default range.

### 3.2 Pending (**Needs Approval** — awaiting the Director's go before restructuring nav, D-068)
From the 2026-07-01 audit (37 findings; ~80 page files / 66 routes / ~35 sidebar entries — the hub pattern
was proven 6 times then abandoned). Target ≈ 10–12 sidebar entries:
- **Roster Reports hub** `/roster` — roster grid, roster-dashboard, schedule-analysis, ot-exceptions,
  interval-headcount, hourly-analytics, data-quality, system-audit, schedule-change-log, report-builder,
  dashboard-builder (delete the "Reports & Analytics" sidebar section + the duplicate WfmOverview tile grid).
- **Scorecard hub** `/scorecard` — scorecard, scorecard-board, leaderboard (/agent-scores), trends,
  agent-360, team-360, coaching, productivity.
- **Capacity & Coverage hub** `/capacity` — capacity (Erlang), hourly-coverage, interval-headcount,
  hourly-analytics, demand-schedule.
- **Chief branch** `/chief` — nest the 13 guard routes under one shell.
- **Executive home** — keep `/command-center` as the ONE landing; fold ControlDashboards' role switcher in;
  demote Dashboard; WfmOverview becomes a hub shell (currently 4 overlapping executive landings).
- Quick wins (Recommended): shared `adhColor` + `ShiftRateBars` + `ROSTER_KPI_DEFS`; one shared default-range
  helper (remove frozen 2026 literals); `keep-dark` on the ShiftRotation modal (invisible in light mode);
  header titles from a route map; update AppLayout SEARCH_PAGES/PAGE_TITLES to hub `?tab=` URLs; de-dup
  sidebar icons; delete the dead `Placeholder` page.

---

## 4. What Was Corrected (wrong → right, with the number impact)

Numbered **C-###**. All Confirmed and live unless noted.

| ID | Wrong | Corrected | Impact |
|----|-------|-----------|--------|
| C-001 | **HR-matrix NULL hr_code** — recon ingest never wrote hr_code/attendance_code; after the June rollback both were all-NULL again. | Engine computes them (L-002); for the rolled-back June snapshot they were **re-derived via SQL using the engine's own `classifyCode`** (`require('./recon-new-roster').classifyCode` + copy of recon-build derive()): S-suffix (NS/BS/CS/ES/MS/MDS)→SL, A-suffix (EA/BA/MA/CA/NA)→A, WFH→WFH, L→L, H→H, COMP/RES/TER, shifts→code. | June 2,733 rows: SL=46, A=13, WFH=975, L=142, H=52, OFF=827. HR matrix + status labels correct without a rebuild. |
| C-002 | **No-evidence day credited scheduled hours** — a working day with neither punch nor system login fell back to scheduled net (~8h) → false "worked 8h". | `worked_min = 0` + role-blind data-quality flag (commit `5fa8594`). Never assert hours we cannot prove. | June: 9 employees / 50 days → all worked 0, all flagged. |
| C-003 | **Cross-midnight double-count (`prevDayBleed`)** — a night shift ending on a holiday/OFF day credited that second day with OT/worked too. | `prevDayBleed = !isWorkingKind && govLogin < 0` → a non-working day neither credits OT/worked nor shows a session starting before the day began (start-day ownership, L-007). | Jun-16: Ali Muteb 12937 / Habib 11952 / Ghadir 13805 / Mohammad Sahar 13830 holiday-OT 587/226/541/540 → 0; +85 OFF-day bleeds (June −31.6h holiday-OT, −597.7h worked). |
| C-004 | Tardiness counted from minute 1; conformance computed from RAW (uncapped) tardiness so cross-midnight bleed tanked real workers. | >6-min tolerance (7..240 credible band); conformance from credible tardiness; post-midnight login normalized +1440. | 231 falsely-nonconforming rows repaired; HR list 72 → 37 real deducts. |
| C-005 | Early-out excused if net 8h reached. | Full-shift span rule: span must cover the GROSS shift (9h incl. break). | e.g. Abdulrahman 13762 06-27: 8h03m span < 9h → real 55m early-out. |
| C-006 | `L` on an official holiday consumed a leave day. | Leave-on-holiday → H + balance returned (engine + Jan–May back-applied + `EFFECTIVE_DAYS`). | 40 historical rows; verified: 7-day leave over 6 holidays → 1 day charged. |
| C-007 | Requests HC-impact read stale `attendance_records`. | Repointed to canonical `roster_days` — approval now truly drops headcount during worked hours. | Verified live (5→4 at 20:00–22:00 demo case). |
| C-008 | Legacy dashboard anchored "today" to `MAX(attendance_date)` while `attendance_records` carries ~4,293 FUTURE scheduled rows → trend/MTD/alerts/Chief briefing computed over July. | Cap every date anchor `<= CURRENT_DATE` (dashboard.controller 5 spots + analyst.service). **Reusable rule: attendance_records runs AHEAD of reality — never trust its raw MAX.** | Trend/briefing back to real dates; all numbers unchanged. |
| C-009 | `import-roster-days.js` lacked the cross-midnight +1440 wrap (false "on-time"). | DEPRECATED (header comment); `import-roster-master.js` is the sole live builder of that pipeline. | Duplicate-path drift eliminated. |
| C-010 | Technical-issues module queried tables no migration ever created (every endpoint 500'd); calendar crossSkillGaps queried non-existent `schedule_records`. | Migration 037 renamed/aligned tables + 48h SLA + CX-flag at 20+ repeats; calendar rewritten onto `attendance_records`. Sweep method: diff `CREATE TABLE` names (migrations + runtime-CREATEs) vs every `FROM/JOIN/INTO/UPDATE` ref. | Whole module revived; 2 more dead queries caught by the sweep. |

---

## 5. Future Risks Discovered (open — ranked)

Numbered **R-###** — this file's own register (the BR library's drift register uses **DRIFT-###** and the
roadmap's risk register uses **RSK-##**; always name the file when citing an ID across documents).
"Number-changing" fixes are **Recommended** and need the Director's eyes-on approval + full re-validation.

| ID | Risk | Detail | Mitigation / plan |
|----|------|--------|-------------------|
| R-001 | **Jan–May built by the OLD pipeline — needs a per-month recon rebuild** for full rule parity. | Jan–May came from `import-roster-master.js`; dry-run diff vs the recon engine showed 0 diffs in hr_code/shift/holiday-OT/late/worked/TRUE_OT (only ~3% WFH refinement) so the Director decided **leave as-is**. BUT the cross-midnight Rule B de-bleed cannot be SQL-derived there (~480 non-working-with-worked rows lack a session-login sign), and June's post-rollback snapshot still misses the cross-midnight fix + 13 people of the 116-employee foundation. | Agreed plan: small partial-upload test, then re-run the corrected engine over the **full year from January** ("الداتا الدسمة") when the Director shares the PREPARED source files (raw `Desktop/ROSTER` exports are NOT engine-ready — raw Ameyo matched 0 rows; `byUser` needs the small prepared "Ameyo login and logout.xlsx" User-ID format). |
| R-002 | **`ot_before_min` / `ot_after_min` still dropped by the ingest MAP** — NULL after every corrected upload. | Reports referencing them (and other MAP-omitted cols: attendance_status, late_category, week_number, month_name, missing_punch/system, comp_worked_min, original_shift_code, crosses_midnight) read NULL/blank. | Recommended: emit in `_ingest` (split `otSystemMin`) **without changing TRUE_OT semantics**; add the missing cols to the MAP. Deferred deliberately — do with the Director watching. |
| R-003 | **Shift-category 6-way drift still in code** (L-001). | Shift-rate %, fairness, and category filters differ per page until unified. **Changes numbers.** | Recommended: one shared code-keyed classifier (doc §3) imported by all 6 sites + full re-validation of shift-rate/fairness outputs. |
| R-004 | **`sc` CTE 1:N fan-out** (`recon.controller.ts:357`) — the scorecard CTE joins one row per roster DAY, so grouped `AVG(sc.net)` is **day-weighted, not person-weighted** (a 22-day agent outweighs an 8-day agent) across all 13 `sc.*` KPIs in grouped views. Per-row detail is correct. | Grouped scorecard KPIs in the Custom Report Builder are subtly biased. | Recommended: aggregate at person grain before AVG. **Changes grouped averages** — re-validate with the Director. |
| R-005 | **`attendance_records` carries future rows** (forward schedule table, ~159 rows/day ahead). | Any NEW query anchoring on its MAX date resurfaces the C-008 bug class; coverage/HC counts, editCell WRITE, and demand-publish still live on it. | Rule: always cap `<= CURRENT_DATE` or read `roster_days`. Follow-up: retarget/badge remaining readers (Command Center tags live 🔵 vs corrected 🟢 already shipped). |
| R-006 | **Hardcoded date horizons** — the recon-refresh June-only summary (fixed in batch-1, §2.2.4) is a bug *class*: frozen date literals still boot every roster report page (Roster=June, OT&E=Jan–Jun, ScheduleAnalysis=→06-19, WFH-HR=May–Jun…). | Pages silently show different periods; literals go stale after June. | Recommended: one computed default-range helper shared by the hub (audit quick-win). |
| R-007 | **`/dashboard` auto-ingest landmine** — fires a destructive clear+rebuild of `roster_daily` whenever count==0; `doIngest` DELETE+INSERT is non-transactional. | A stray dashboard load mid-migration can corrupt the legacy path. | Keep the tables strictly separated (L-005); legacy re-ingest is an open deferred item (heavy parse) to surface the WFH fix on `/dashboard`,`/metric`,`/overtime`. |
| R-008 | **Never-closed Sprinklr sessions** (logout=1970 / >16h) are dropped whole, losing a valid LOGIN — Fatma/Hassan/Noura can be falsely flagged "no system". | Their no-evidence flag may be over-strict. | **Director decided 2026-06-30: leave as-is** — login-only recovery NOT enabled until the method is verified. |
| R-009 | **Off-day OT is the one uncertain field** — system-only, no schedule anchor (recon 594h vs old pipeline 173h for June). | Could over-credit OFF-day work. | Verify before trusting/paying; OFF/holiday OT already requires punch evidence ≤13h else `off_work_unverified`. |
| R-010 | **Dead code ambiguity** — `common/wfm-calc.ts` (the "single source of truth" nothing imports; one live copy diverges) + the `Nx*` library/`sevColor` in `ds.tsx` (0 usages). | Future devs may "fix" the orphan and think they changed behavior. | Recommended: adopt or delete — never keep both. |
| R-011 | **Scorecard scoring is a standalone script** (`backend/scorecard-gen.js`), not a server-side service. | Monthly scorecards depend on a manual run. | Recommended: ScorecardEngine service + `POST /scorecard/compute` (see `scorecard_system_vision`). |
| R-012 | **Security remainders** — mixed controllers still need per-endpoint role decisions (coaching, breaks, campaigns, skills, integrations…); secrets in `.env`; audit-log retention; CI security gates; pen-test. | See memory `security_hardening_phase2` "STILL FLAGGED". | Use `scripts/smoke-get.js <role>` to re-verify after each guard change. |

---

## 6. Automation Opportunities Found

All **Recommended** unless marked Confirmed-built.

1. **Confirmed-built:** one-command refresh (`node scripts/recon-refresh.js`) + in-system Upload & Rebuild;
   Guard team (Health/Analyst/Reporter/Security/Scorecard/Researcher/Expert) + Chief + opt-in Auto Mode
   (auto-approves only safe-surplus requests); SLA escalation loop; coaching auto-flags; daily Reporter
   Excel; `/diagnostics` consolidated daily issues; smoke-test guard; `gen-test-token.js` + `smoke-get.js`
   for API verification.
2. **Post-ingest verification bot** — after every Upload & Rebuild, auto-run the anchor checks (Haya 12375
   maternity-7h, Jun-16 holiday-OT, TRUE_OT envelope, NULL-scan on hr_code/include_tardiness/username) and
   surface a red banner on drift. (The audit found `include_tardiness` NULL only because a human looked.)
3. **Ingest MAP contract test** — a script that diffs the `_ingest` emitted keys vs the recon-ingest MAP vs
   `roster_days` columns, failing on any silently-dropped field (would have caught R-002 and L-002 at birth).
4. **Scheduled month-end pipeline** — cut-off-aware (full-time 15→14, interns 1→end, Bahrain 25→24) auto
   reminder/run: recon-refresh → WFH HR report → OT & Exceptions → scorecard build.
5. **Classifier drift linter** — CI grep forbidding new inline shift-category mappings outside the canonical
   module (once R-003 lands).
6. **Route/IA guard** — CI check that new pages register inside a hub (`?tab=`) instead of new top-level routes.

---

## 7. WHAT MUST NEVER BE FORGOTTEN (operating non-negotiables)

The distilled cost-of-blood list. Each item was paid for with a real regression or near-miss.

1. **Backup before ingest.** `roster_days_recon_bak` is auto-refreshed per run (restore:
   `node scripts/recon-ingest.js --restore`); for anything manual: `CREATE TABLE roster_days_bak_YYYYMMDD AS
   SELECT * FROM roster_days` first. `roster_days_predisaster` (15,794 rows) is the full 2026-07-01 snapshot.
2. **Dry-run + diff before promote.** Retarget imports to a scratch table (`ROSTER_OUT_TABLE=roster_days_scratch`,
   `SCHED_PATH=<file>`), diff vs live, gate on anchor employees + the OT envelope — a prior refresh REGRESSED
   and was only caught by the diff. Then promote. After `import-roster-master.js`: **always run
   `backfill-identity.js`** (else person_no/role_function go NULL and every report silently degrades).
3. **A partial upload replaces ONLY its own date range.** Never a hardcoded month-wide DELETE (the Jun-28–30
   upload that wiped Jun 1–27). Ingest must refuse to delete when it has no dated records.
4. **Rules live IN the engine.** Any rule applied as a one-off SQL/report patch WILL be overwritten by the
   next rebuild. If it matters, put it in `recon-build.js` / `recon-config.json` so every refresh re-applies it.
5. **Never `npm audit fix --force`.** It downgrades NestJS 11→7, swagger, and exceljs. Install with
   `--legacy-peer-deps`. The 2 remaining uuid advisories via exceljs are documented not-exploitable.
6. **TypeORM raw-query gotchas.** `ds.query()` has no `.rowCount`; `INSERT…RETURNING` returns a FLAT rows
   array (count = length) but `DELETE/UPDATE…RETURNING` returns a `[rows, count]` TUPLE (count = `r[1]`);
   manual `BEGIN`/`COMMIT` via separate `ds.query()` calls is a FAKE transaction (different pooled
   connections) — use ONE atomic statement or a QueryRunner. Also: `work_date::text` against TZ off-by-one;
   quote reserved aliases (`AS "hour"`); backend runs compiled `dist` — `npm run build` + restart to apply .ts changes.
7. **ExcelJS is 1-indexed.** `row.values` is 1-based; `H.indexOf(name)` already yields the 1-based column —
   use `getCell(idx)` directly, NO +1 (that off-by-one once silently zeroed all annotations).
8. **exceljs conditional-formatting corruption.** exceljs re-emits a template's conditional formatting as
   EMPTY `<conditionalFormatting sqref=…/>` (no `<cfRule>`) → Excel "repaired/removed unreadable content".
   FIX before writing: `for (sn of W1..W5) wb.getWorksheet(sn).conditionalFormattings = []`. (Related:
   corrupt-zip sheets need **exceljs streaming**, not `xlsx`.)
9. **Never `toISOString()` for local dates** — UTC off-by-one broke Saturday weeks (use `fmtLocal` +
   `snapToSaturday`). Week starts Saturday, always.
10. **Never infer WFH from "system + no punch"** (L-004). Never infer sick — only the Odoo status says sick.
    A holiday is never absence. Match by Employee ID, never name.
11. **roster_days ≠ roster_daily** (L-005). Reports read the rich table; `/upload`+`/ingest` write the thin
    one; never cross-wire; never let recon output reach roster_days except via `recon-ingest.js`.
12. **TRUE_OT = ot_min + offday_ot_min + holiday_ot_min — three DISJOINT buckets** (never `total − holiday`);
    any "OT Total" column must sum all three (§2.2.2 regression proves it).
13. **The Director's standing orders:** no new/changed rule executes before agreement; never fake completion
    or hide mock data; a published schedule is never overwritten by Generate; "review it" means a deep
    correctness & data-integrity audit, not a render check; always surface raw late/early even when excused.
14. **NO animated background** (removed by the Director — do not re-add). Any new near-black inline hex must
    join the light-mode net allow-list or reuse a covered hex; verify every new page in Light + Aurora-Glass.
15. **`.env` on port/DB:** the `:3000` process may be the abandoned "Enterprise Lab" copy — verify which
    backend is live before judging an endpoint; use `APP_PORT=3001` for test boots.

---

## 8. What to Reuse on Rebuild (proven assets — don't reinvent)

| Asset | Where | Why it's the keeper |
|-------|-------|---------------------|
| Recon pipeline (foundation→engine→ingest) | `backend/scripts/recon-{extract-foundation,new-roster,build,ingest,refresh}.js` + `recon-config.json` | Every rule §2.1 codified; one command; manually validated (96% match, 0 clear engine errors) |
| Rebuild recipe (old pipeline) | `ROSTER_OUT_TABLE=… SCHED_PATH=… node import-roster-master.js <from> <to>` per month + `backfill-identity.js` | The only safe way to rebuild Jan–May style months |
| Comparison harness | `recon-compare-manual.js`, `recon-diff-evidence.js`, `check-compare.js` | Diffs engine vs the Director's manual workbook with raw-session evidence |
| Verification tooling | `gen-test-token.js`, `smoke-get.js`, the smoke-test guard, `/diagnostics` | Role-scoped live API sweeps (162/162 GET clean baseline) |
| Hub pattern | `HubTabs` + `?tab=` + permission gating + redirects (6 live hubs) | The approved IA shape for the pending consolidation |
| Dazzle kit + DateRangeBar | `frontend/src/components/dazzle.tsx`, `DateRangeBar.tsx` | Theme-safe by construction (3 themes); Saturday-week presets |
| Skills | `.claude/skills/wfm-system`, `scorecard-builder`, `mini-me` | Portable, self-describing rebuild knowledge — keep in sync with the docs |
| Canonical docs | `WFM_RULES_AND_DECISIONS.md`, `REPORTS_AND_ROSTER_ENGINE.md`, `RECON_PIPELINE.md`, `DESIGN_SYSTEM.md` | If code conflicts with them, the doc wins — fix the code |

---

## 9. Open Questions (for the Director)

1. **Full-year recon rebuild (R-001):** when will the PREPARED source files (Ameyo User-ID format, Odoo,
   permissions) for Jan–June be shared so the engine can rebuild "الداتا الدسمة" with every 2026-06-30 rule?
2. **Consolidation go/no-go (§3.2):** approve the Roster/Scorecard/Capacity/Chief hub restructuring?
3. **Number-changing fixes (R-002/R-003/R-004):** schedule the supervised sessions for ot_before/after
   ingest, the canonical shift-category classifier, and the person-grain scorecard aggregation?
4. **Sprinklr-only mode:** when the migration lands, flip `RECON_SYS_MODE` — and enable login-only recovery
   for never-closed sessions (R-008) once verified?
5. **Maternity-7h set:** any additions to `12375`/`12434` as HR confirms?
