# DECISIONS & AGREEMENTS LOG — Boutiqaat Enterprise WFM Platform

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> Chronological register of every decision and agreement made with the WFM Director since day one,
> mined from `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (the single source of truth — if this log ever
> conflicts with it, that doc wins), `CLAUDE.md`, `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md`,
> `docs/RECON_PIPELINE.md`, and the ~95 project memory notes.
>
> **Standing order (D-000):** no new or changed rule is EXECUTED before explicit agreement with the
> Director. Entries below are therefore rigorously tagged:
> - **Confirmed** — agreed with the Director and/or recorded in the canonical rules doc; binding.
> - **Recommended** — an improvement proposal; NOT to be executed until approved.
> - **Needs Approval** — explicitly parked awaiting the Director's go.
> - **Declined** — proposed and refused; do NOT build.
> - **Deferred** — agreed to postpone; revisit condition stated.

---

## Quick Index

| Era | Decisions | Theme |
|---|---|---|
| Phase 0–3 (project inception) | D-001 – D-014 | Platform, calendar, shift dictionary, gender/rest, publish/lock |
| 2026-06 early–mid | D-015 – D-027 | Scorecard method, productivity, identity model, guards/Chief, design |
| 2026-06-22 – 06-24 | D-028 – D-040 | Roster reconciliation canon: WFH correction, TRUE_OT, maternity, tables map |
| 2026-06-28 – 06-29 | D-041 – D-051 | New recon engine sign-offs, holiday-OT, master HR codes, in-system upload |
| 2026-06-30 | D-052 – D-064 | Manual-vs-engine verdict, tardiness >6 min, full-shift span, cross-midnight, leave-on-holiday |
| 2026-07-01 | D-065 – D-068 | Partial-upload incident + ingest-safety rule, audit batch-1 fixes, consolidation plan |
| Cross-cutting declines/deferrals | D-069 – D-073 | Self-modifying code, fake metrics, animated background, security |
| Addenda (2026-07-02 audit) | D-074 – D-075 | RBAC final access model, fairness PRE-SWAP basis (registered late) |

---

## Era 1 — Project Inception (Phases 0–3)

### D-001 — Workforce week starts Saturday
- **Status:** Confirmed
- **Rule:** The WFM week is Sat→Fri everywhere (schedules, fairness, weekly reports, presets). Use `fmtLocal` + `snapToSaturday`; never `toISOString()` for local dates (a UTC off-by-one once produced a false 3-OFF/week reading).
- **Reason:** Kuwait operational week; all workbooks and rosters are Saturday-anchored.
- **Impacted:** Scheduling, generator, rotation, all weekly reports, date presets.
- **Source:** CLAUDE.md §6.1; WFM_RULES_AND_DECISIONS.md §2; memory `date_saturday_alignment`.

### D-002 — Technology direction: NestJS + PostgreSQL + React/Vite, migrations as truth
- **Status:** Confirmed
- **Rule:** Modular-monolith NestJS/TypeORM (`synchronize:false`, SQL migrations are the schema truth), React+TS+Vite frontend, JWT + rotating refresh tokens, RBAC, polymorphic audit/attachments, request envelope + extension tables. Backend runs compiled `dist` (`npm run build` → `node dist/main.js`; restart to apply `.ts` changes).
- **Impacted:** Everything.
- **Source:** CLAUDE.md §4–5; WFM_RULES_AND_DECISIONS.md §15.

### D-003 — Real Timing sheet is the shift-code source of truth (never hardcode 8 codes)
- **Status:** Confirmed
- **Rule:** The workbook Timing sheet defines every shift code (M, B, C, N, E, AM, MD, MN, `20`-codes, `R` Ramadan incl. splits, WFH-*, S/A suffixes, OFF, H, L, SL, DL, COMP, RES, TER…). `20` = 8h responsible/supervisor; plain/`9` = 9h agent shift incl. 1h break; AM = 8h and ≠ M9; Ramadan = 7h; some shifts cross midnight or split.
- **Impacted:** Import parser, schedule grid, adherence, shift-rate.
- **Source:** CLAUDE.md §6.2–6.3; WFM_RULES_AND_DECISIONS.md §3.

### D-004 — Employees are matched by ID, never by name only
- **Status:** Confirmed
- **Reason:** Names duplicate, vary in spelling and spacing (a double space once split one person into two).
- **Impacted:** Every import, join, and report.
- **Source:** CLAUDE.md §8; WFM_RULES_AND_DECISIONS.md §1.

### D-005 — Female shift rule (final version)
- **Status:** Confirmed
- **Rule:** Business coverage is the top priority, but female agents normally work up to **C** (ends 20:00); **N only if operationally necessary** (flagged); **never MD/MN midnight** except a logged manual override. Configurable, not hardcoded; violations always flagged. Male agents: any shift per business need.
- **Impacted:** Generator, rotation, schedule validation, manual edits.
- **Source:** CLAUDE.md §6.4–6.5; WFM_RULES_AND_DECISIONS.md §7.

### D-006 — Minimum rest = 10 hours between consecutive shifts
- **Status:** Confirmed
- **Rule:** Cross-midnight-aware rest calculation; <10h invalid unless manually overridden (e.g. MD→07:00 then M 07:00 = 0h invalid; MD→07:00 then EE20 18:00 = 11h valid). Weekly rotation gives ≥10h by construction.
- **Source:** CLAUDE.md §6.6; WFM_RULES_AND_DECISIONS.md §8.

### D-007 — Schedule lifecycle: Draft → Generated → Reviewed → Published → Locked
- **Status:** Confirmed
- **Rule:** A published schedule is **never overwritten by Generate**. Post-publish manual edits are allowed for authorized users but require validation warnings, audit, version history, and before/after impact (coverage, rest, female rule, shift-rate, HC by interval). Soft-lock = admin-edit-with-audit; Unlock exists (Locked is not a dead-end).
- **Source:** CLAUDE.md §6.7–6.8; WFM_RULES_AND_DECISIONS.md §10; memory `schedule_unlock_fix`.

### D-008 — Shift Rate % = shift-distribution, not pay
- **Status:** Confirmed
- **Rule:** Per employee: Morning/Night/Evening/Midnight counts + % (YTD/MTD/period), with before/after impact on every edit/swap (both employees on a swap). OFF/H/L/S/A/COMP excluded from the working distribution but tracked separately.
- **Source:** CLAUDE.md §7; WFM_RULES_AND_DECISIONS.md §8.

### D-009 — Chat/WhatsApp concurrency = 4; intern productivity ≈ 70% (configurable)
- **Status:** Confirmed
- **Rule:** Erlang-C for voice; concurrency-adjusted model for chat/social/WhatsApp (concurrency 4); backlog/throughput for email; intern factor configurable (~0.7). Erlang-C later verified 100% vs textbook; P99 surge scenario added.
- **Source:** CLAUDE.md §14; memory `capacity_audit`.

### D-010 — Generator must show gaps honestly, never fake coverage
- **Status:** Confirmed
- **Rule:** When coverage cannot be met (e.g. small male night pool), show the gap, the reason, and suggested remedies (cross-skill, OT, exception) — never hide it.
- **Source:** CLAUDE.md §11.

### D-011 — Shift Swap requires peer acceptance before TL/WFM approval
- **Status:** Confirmed
- **Rule:** Colleague accepts → approver chain → system validates coverage/rest/gender/skills → approval creates a schedule version.
- **Source:** CLAUDE.md §19.

### D-012 — Permission approval must show HC before/after impact
- **Status:** Confirmed
- **Rule:** Required/Scheduled/On-permission/Available/Gap per interval+function with risk warning before approving. Later repointed to read canonical `roster_days` (was stale `attendance_records`).
- **Source:** CLAUDE.md §13; memory `permission_hc_impact_fix`.

### D-013 — Audit log is real, immutable, append-only
- **Status:** Confirmed
- **Rule:** Actor/action/entity/old/new/timestamp on every sensitive change (users, roles, schedule, approvals, imports, outages, settings).
- **Source:** CLAUDE.md §31.

### D-014 — Single-file prototypes: no duplicate top-level `let`/`const` globals
- **Status:** Confirmed (lesson learned)
- **Reason:** Duplicate `CAP_VIEW`-style globals broke the v3 HTML prototype. Production = React components/state, never giant HTML files.
- **Source:** CLAUDE.md §5, §34.1.

---

## Era 2 — June 2026 (scorecard method, identity, guards, design)

### D-015 — Metric formulas (Director-dictated 2026-06-16)
- **Status:** Confirmed
- **Rule:** RES = feedback response; PRR = positive response rate; CTR = contacts ÷ tickets created; FCR = **closed ÷ total tickets** (resolution rate — as implemented and verified against the 2026 score files, which hold the final criteria; the dictated shorthand "توتال التكيتات على كم كلوز" is the same ratio). Final criteria live in the 2026 score files (April/May 26).
- **Source:** memory `metric_formulas`.

### D-016 — Productivity formula + sick-day penalty
- **Status:** Confirmed (denominator variant pending — see Open Items)
- **Rule:** Productivity **Z = Y/X** = productive ÷ availability, availability = Staffed − Break; **break = named breaks only** (Short/Tea/Lunch/Long/Bio — NOT Unavailable/ACW/Meeting/Training). **Maternity agents measured ×7** (7-hour basis). Sick penalty on the score: 1 sick day −2%, 2+ −5%. Marked DONE — do not change without the Director.
- **Source:** memory `metric_formulas`, `scorecard_build_plan`; task #24.

### D-017 — Scorecard rounding: round-half-up every % to a whole integer BEFORE banding
- **Status:** Confirmed (2026-06-17)
- **Rule:** 89.69→90, 89.4→89, 89.5→90 (`Math.round`). Applies to ALL % KPIs (Productivity, QA, FCR, CTR, RES, PRR, Quiz). Changes which band a value lands in → changes points.
- **Source:** memory `scorecard_build_plan`.

### D-018 — Scorecard bands & Net Points = exact template bands (decoded, verified)
- **Status:** Confirmed
- **Rule:** Per-function KPI bands exactly as in the Director's `<Month> SC 26` template (e.g. Quality ≥95→30 / 90→20 / 80→10 / 65→−10 / <65→−20; FCR ≥85→20/80→10/75→5/<75→−10; Prod ≥91→15/90→10/89→5/87-88→0/≤86→−15; CTR ≥95→10/90-94→5/<90→−10; Quiz ≥95→10/90-95→5/<90→−10; Mistakes 15−(n×5); RT ≤1h→15/≤2h→10/≤4h→5/else −15; PRR 2.5+2.5 if PRR≥80% & RES≥10%). Net Points = sum. Full bands: `.claude/skills/mini-me/reference/scorecard-scoring-bands.md`.
- **Source:** memory `scorecard_study`, `scorecard_build_plan`.

### D-019 — Quiz commitment rule
- **Status:** Confirmed
- **Rule:** An agent PRESENT who did not solve the weekly quiz → **−5 Commitment** + a note on that week's cell; verify not-on-leave first (leave ⇒ no deduction). May W1+W2 = bar (max) by decision.
- **Source:** memory `scorecard_build_plan`; task #25.

### D-020 — Peak-period CTR/FCR bar overrides
- **Status:** Confirmed
- **Rule:** Sprinklr functions (CH-WA, Social/Email): CTR = bar (auto-ticketing), FCR = computed. Inbound/Outbound/Refund: CTR = bar AND FCR = bar during peak (tickets stopped). "Bar" = max band score.
- **Source:** memory `scorecard_build_plan`.

### D-021 — Scorecard scope: frontline agents only; delivery = "قالبي أحسن" (keep the template)
- **Status:** Confirmed (2026-06-17)
- **Rule:** No scorecard for TL/RTA/Customer Care/Support/Specialist. The Director KEEPS his template; the system automates KPI VALUE computation per agent×week+Final and outputs paste-ready + self-scored workbooks. CH-WA = one function; Social Media & Email = one function; SM&Email from Sprinklr ONLY.
- **Source:** memory `scorecard_build_plan`; `scorecard-builder` skill.

### D-022 — Scorecard data grain
- **Status:** Confirmed
- **Rule:** `scorecard_entries` = rich weekly per-KPI detail (one month per load); `scorecard_monthly` = Net Points only; `fcr.employee_id` is a uuid (scheme differs — best-effort join). The composite `/roster-v2/agent-scores` 0-100 score is **NOT the official scorecard** and must be labelled so.
- **Source:** WFM_RULES_AND_DECISIONS.md §9; memory `roster_conventions`.

### D-023 — Canonical identity: `person_no` collapses old/new IDs; `is_active` = dedup, not employment
- **Status:** Confirmed
- **Rule:** Intern 6xxxx and full-time 1xxxx IDs for the same human collapse to ONE `person_no` (Employee_ID_Map). `is_active` keeps leavers' history in reports; forward exclusion via `employees.status`. **Function is per-month from that month's schedule row** ("Social Media" and "Social Media & Email" both valid verbatim). Attrition from RES/TER markers; TRANSFER flagged separately, never invented.
- **Impacted:** Every roster-v2 report, Agent 360, HR matrix, attrition.
- **Source:** WFM_RULES_AND_DECISIONS.md §1; memory `employee_identity_function_model`, `employee_id_map`.

### D-024 — Cut-off cycles + permission balance
- **Status:** Confirmed
- **Rule:** Full-time cycle 15→14, interns 1→end of month, Bahrain 25→24. Permission balance renews per cycle = **6 hours + 3 permissions**; only **Approved** permissions consume/exempt.
- **Source:** WFM_RULES_AND_DECISIONS.md §2; memory `cutoff_cycles`.

### D-025 — Chief is the single visible face; guards run behind it
- **Status:** Confirmed (2026-06-14)
- **Rule:** Sidebar shows only the Chief; the 8-guard team (Health, Analyst, Reporter, Security, Scorecard, Researcher, Expert, Reply-Helper + Knowledge Ledger/Team Learning) runs invisibly and feeds it.
- **Source:** WFM_RULES_AND_DECISIONS.md §13; memory `automode_and_chief_face`.

### D-026 — Auto Mode: guarded autonomous approval, opt-in and reversible
- **Status:** Confirmed (2026-06-14)
- **Rule:** Auto-approves only **safe-surplus** requests by coverage verdict; auto-REJECT extra-gated (default OFF, HR-sensitive); everything audited (real actor) and revertible; default disabled. This deliberately overrides the earlier "no auto-approval" stance because the Director explicitly requested it WITH a controlled toggle.
- **Source:** memory `automode_and_chief_face` (migration 031).

### D-027 — Design system: 3 themes, light-mode net, NO animated background
- **Status:** Confirmed
- **Rule:** Dark / Light / Aurora-Glass; the dazzle kit (`components/dazzle.tsx`) is var-based + reduced-motion; a fixed allow-list remaps near-black inline hexes in Light mode (any NEW near-black inline bg must join the list or use a covered hex); inline `color:'#fff'` is not flipped — use theme vars; verify every new page in Light + Glass. **The animated background was removed by the Director — never re-add it.** i18n = inline `ar ? '…' : '…'`; EN mode 100% English but inputs still accept typed Arabic.
- **Source:** WFM_RULES_AND_DECISIONS.md §14, §17; docs/knowledge/DESIGN_SYSTEM.md; memory `design_system_polish`, `light_mode_css_net`.

---

## Era 3 — 2026-06-22 → 06-24 (roster reconciliation canon)

### D-028 — HR-matrix master codes: Sick = SL, Absent = A; never invent "P"
- **Status:** Confirmed
- **Rule:** HR Matrix cell = `COALESCE(hr_code, attendance_code, shift_code, 'OFF')`. Sick→SL, Absent→A, off→OFF, leave→L (DL/UPL kept), holiday→H, comp→COMP, separation→RES/TER, WFH-working→`WFH`, office-working incl. forgot-to-punch→the shift code (never OFF/absent). "P" (present) was a bug catch-all — never agreed, removed.
- **Source:** memory `roster_conventions` (#2), WFM_RULES_AND_DECISIONS.md §18.

### D-029 — Shift-aware sick/absence codes MS/MA family
- **Status:** Confirmed
- **Rule:** Roster/report codes encode shift+status: Sick = MS/BS/CS/NS/ES, Absent = MA/BA/CA/NA/EA (prefix = shift letter, suffix S=sick A=absent) — so "sick on the 7 AM shift" is filterable.
- **Source:** memory `roster_conventions` (#3).

### D-030 — Maternity/mothers 7-hour rule (MATERNITY_7H)
- **Status:** Confirmed
- **Rule:** `person_no IN ('12375','12434')` (Haya Mohanna / Shaima Saoud) work 7h (M7/B7/C7/N7 codes); measured on a 7h window and **excluded from EARLY-OUT only** (late still counts). Extend the set only as HR confirms.
- **Source:** WFM_RULES_AND_DECISIONS.md §7; memory `roster_conventions` (#4), `unified_roster_metrics`.

### D-031 — OT before/after captured separately; week-by-week validation
- **Status:** Confirmed
- **Rule:** OT BEFORE shift start and OT AFTER shift end are separate, analyzable columns. Roster validation proceeds in careful 7-day blocks, never a bulk dump.
- **Source:** memory `roster_conventions` (#6, #7).

### D-032 — ★ CORRECTED WFH RULE (2026-06-24 — overrides the old inference)
- **Status:** Confirmed
- **Rule:** **WFH = a WFH shift code OR an explicit WFH `location` ONLY. NEVER inferred from "system login + no punch."** Office-located shift + system session + no fingerprint = **MISSING PUNCH (presence=office)**. A WFH-code row whose location reads 'Office' → Data Quality flag, not auto-WFH.
- **Reason:** The old inference stamped WFH even when location='Office' — 1,730 live rows corrected wfh→office.
- **Impacted:** Presence, WFH/office split, WFH HR report, HR matrix.
- **Source:** WFM_RULES_AND_DECISIONS.md §4; memory `roster_conventions` (#1).

### D-033 — Presence taxonomy + protective rules
- **Status:** Confirmed
- **Rule:** Presence ∈ office/wfh/absent/leave/off/holiday/sick/left/unconfirmed. Office shift + punch→office; + system-only→office (missing punch); + neither→absent, or `unconfirmed` for low-capture roles (<70% observed) so RTA/supervisors/social aren't wrongly punished during capture gaps. **A public holiday is never "absence." Sick only when Odoo says sick — never inferred.**
- **Source:** WFM_RULES_AND_DECISIONS.md §4.

### D-034 — ★ Combine-both-systems work time
- **Status:** Confirmed
- **Rule:** Total work = **UNION of Ameyo ∪ Sprinklr** active intervals — overlap counted once, separate periods add ("9h Ameyo + 2h Sprinklr = 11h"). Floor-support with no system → punch.
- **Source:** WFM_RULES_AND_DECISIONS.md §5; memory `ot_reconciliation_engine`, `roster_data_sources`.

### D-035 — Source-trust hierarchy + Sprinklr local time
- **Status:** Confirmed
- **Rule:** Schedule = truth for OFF/work/leave · Ameyo ready-end reliable (discard >16h bleeds, cluster gap>4h) · Sprinklr raw login/logout bleeds → prefer AGENT_OCCUPANCY · Odoo = holidays + punch trusted, individual leave NOT (goes stale) · punch = office only. **Sprinklr login/logout timestamps are Kuwait LOCAL, not UTC (no +3).**
- **Source:** WFM_RULES_AND_DECISIONS.md §5, §12; memory `roster_reconcile_tz`.

### D-036 — ★ TRUE_OT: three DISJOINT buckets
- **Status:** Confirmed (verified 2026-06-24 — no double count)
- **Rule:** **TRUE_OT = ot_min + offday_ot_min + holiday_ot_min**; `ot_min` is 0 on off/holiday rows; total is the SUM (never total − holiday). OFF/holiday worked = whole day − 1h break. **OFF/holiday OT must be evidence-backed** (biometric punch span ≤13h) — system-only → flag `off_work_unverified`, skip. Bleed guards zero uncorroborated >6h OT. **180h/year OT cap** report (EXCEEDED/APPROACHING).
- **Source:** WFM_RULES_AND_DECISIONS.md §6; memory `unified_roster_metrics`, `ot_exceptions_report`.

### D-037 — Credible tardiness window + permission exemption
- **Status:** Confirmed (threshold later raised — see D-053)
- **Rule:** CRED_LATE/CRED_EARLY capped at 240 min (cross-midnight logouts read 25–29h otherwise); post-midnight login normalized +1440 before measuring. **An Approved permission NEVER lowers conformance** (minutes added back); only Approved exempts. Tardiness = unauthorized late/early/system-close.
- **Source:** WFM_RULES_AND_DECISIONS.md §5; memory `tardiness_conformance`, `unified_roster_metrics`.

### D-038 — Data tables map: roster_days ≠ roster_daily — never cross-wire
- **Status:** Confirmed
- **Rule:** **`roster_days`** = RICH canonical (person_no/role_function/is_active) — every `roster-v2/*`, HR-matrix, Agent 360, OT-exceptions report reads it. **`roster_daily`** = THIN legacy (`/upload`+`/ingest` → `/dashboard` only; auto-ingests at count==0 — a landmine). Refresh = retarget import onto a backup + dry-run before promoting. Per-day report defaults skip marker-only tail days (lone RES/TER) — default to the latest day with ≥20 working rows.
- **Source:** WFM_RULES_AND_DECISIONS.md §11; memory `roster_days_vs_roster_daily`.

### D-039 — Fairness model + night-team carve-out
- **Status:** Confirmed
- **Rule:** `fairnessScore = 100 − stdev` of night/midnight load over the fair pool; weekend-OFF fairness scored separately; optional fixed NIGHT TEAM carve-out (Director's choice, migration 065). Rebalance proposals use current staff only.
- **Source:** WFM_RULES_AND_DECISIONS.md §8; memory `shift_fairness`.

### D-040 — Demand→Schedule chain publishes SAFELY
- **Status:** Confirmed (verified live)
- **Rule:** `roster-v2/generate` → `generate-week` → save draft → `publish`/`unpublish` into live `attendance_records`; publish targets the first EMPTY future week, single atomic `INSERT … ON CONFLICT DO NOTHING` (never overwrites), rows tagged `[generated <week>]`, fully reversible.
- **Source:** WFM_RULES_AND_DECISIONS.md §10; memory `demand_scheduling_chain`, `smoke_test_and_publish_apply`.

---

## Era 4 — 2026-06-28 → 06-29 (new recon engine sign-offs)

### D-041 — New standalone recon engine replaces the wrong June output
- **Status:** Confirmed (2026-06-28)
- **Rule:** `recon-extract-foundation.js` → `recon-new-roster.js` + `recon-build.js` → ingest. Four root causes fixed for good: TZ off-by-one (read raw serials, no shift), four identifier spaces (Odoo/Permission by Employee ID, Ameyo by User ID, Sprinklr by Email), duplicate/never-closed sessions (absolute-minute timeline + shift-relative windows + bleed caps), pending permissions (only "HR Approved" covers; Pending/Waiting → Manual Review).
- **Source:** memory `new_roster_recon_engine`; docs/RECON_PIPELINE.md.

### D-042 — Three sign-off decisions (2026-06-28)
- **Status:** Confirmed
- **Rule:** (1) WFH = roster WFH code OR Location=WFH OR Odoo Status=WFH — office-coded + system-no-punch ⇒ Manual Review, never auto-WFH (Option A). (2) Excluded roles = supervisory ONLY: Team Leader / Senior / RTA / Resolution Specialist / WFM — **Customer Care NOT excluded (9h, in tardiness)**. (3) Pending permission ⇒ Manual Review.
- **Source:** memory `new_roster_recon_engine`.

### D-043 — Odoo-absence rescue: system-verified WFH beats a stale "Absence"
- **Status:** Confirmed (Director-approved)
- **Rule:** Odoo='Absence' but Ameyo+Sprinklr prove a full shift (≥6h, no punch) ⇒ reclassify **WFH-worked (system-verified)** — 324 days / 69 employees rescued from false absence.
- **Source:** memory `new_roster_recon_engine`.

### D-044 — Official late/early basis = SYSTEM; session selection = Ameyo-first
- **Status:** Confirmed (2026-06-28)
- **Rule:** Late/early measured on Login/Logout **System** vs schedule for everyone (punch late/early kept as separate columns). Session pick = **Ameyo first** (own first-login→last-logout), Sprinklr only fills gaps — NOT a min/max union (union hid real early-outs). Never-closed bleeds dropped only by the safe 3-condition rule; residuals capped schedEnd+2h with a verify note. Engine mode switchable (`RECON_SYS_MODE`); the Director plans to move to **Sprinklr-only in future months** — do not change June until told.
- **Source:** memory `new_roster_recon_engine`.

### D-045 — Raw tardiness is ALWAYS surfaced even when excused
- **Status:** Confirmed (Director rule)
- **Rule:** Record RawLoginDelay/RawEarlyOut + a Covered flag even when a permission excuses the case, plus a per-employee Employee_Tardiness_Summary (covered vs UNCOVERED) over a user-defined period.
- **Source:** memory `new_roster_recon_engine`.

### D-046 — OT acceptance: no fixed rule — logic + corroboration; ceiling 5h
- **Status:** Confirmed (2026-06-28)
- **Rule:** OT window ceiling = 5h (OT_MAX=300). OT ≤2h auto-accepted; >2h flagged for the Director's eye (`matches punch ✓` / `capped 5h — verify` / `uncorroborated — verify`). Honest limit acknowledged: a real 5h OT vs a bleed can't be auto-told without a punch (WFH staff have none) — flag, don't decide.
- **Source:** memory `new_roster_recon_engine`.

### D-047 — Clock display: 12-hour AM/PM; durations stay HH:MM:SS
- **Status:** Confirmed (Director preference)
- **Source:** memory `new_roster_recon_engine`.

### D-048 — ★ Holiday-worked OT lives IN the engine
- **Status:** Confirmed (2026-06-29, verified via Line Khaled Jun 16)
- **Rule:** Whoever works a SCHEDULED shift on an official holiday gets the WHOLE shift as `holiday_ot_min` (capped at scheduled net), regular OT = 0, row labelled "Official Holiday — <name> (worked)". Holidays auto-detect from the Odoo Status regex, propagated date-wide, **plus** the editable list. Holiday OT legitimately varies by month (Apr=0, May high=Eid al-Adha) — Director-approved.
- **Source:** WFM_RULES_AND_DECISIONS.md §18; memory `new_roster_recon_engine`.

### D-049 — ★ Holidays are EDITABLE data, not code
- **Status:** Confirmed
- **Rule:** `backend/scripts/recon-config.json` holds the full editable 2026 holiday list, mirrored into the `holidays` table on every recon-ingest. All consumers must read the table/config — never a hardcoded date (the WFH-HR-report hardcoded `2026-06-16` was a violation, fixed 2026-07-01).
- **Source:** WFM_RULES_AND_DECISIONS.md §18–19; memory `new_roster_recon_engine`, `audit_2026_07_01_and_consolidation`; task #36.

### D-050 — Rules live IN the engine so refreshes can never silently regress them
- **Status:** Confirmed (the anti-"it worked then broke" doctrine)
- **Rule:** Every business rule (holiday-OT, hr_code derivation, worked_min clamp, WFH, maternity…) is codified inside `recon-build.js` and re-applied on every rebuild. A rule that is not in the engine gets overwritten on the next ingest — that was the root cause of the recurring HR-matrix regressions.
- **Source:** WFM_RULES_AND_DECISIONS.md §18; docs/RECON_PIPELINE.md.

### D-051 — In-system Upload = the corrected engine
- **Status:** Confirmed
- **Rule:** `POST /attendance-recon/recon-refresh` (perm `schedule.publish`) + the Roster "رفع وإعادة بناء / Upload & Rebuild" button run `recon-refresh.js` (foundation→engine→ingest). Uploading FROM the system becomes the permanent corrected base. Schedule grid OVERLAYS `roster_days` when covered; cell shows the SHIFT CODE DIRECT (no `-WFH` suffix — WFH = 🏠 icon + dotted texture); planned cells dashed/faded; holiday cells gold ribbon.
- **Source:** WFM_RULES_AND_DECISIONS.md §18; docs/RECON_PIPELINE.md; memory `new_roster_recon_engine`; task #37.

---

## Era 5 — 2026-06-30 (manual-vs-engine review: the tightening)

### D-052 — ★ Director verdict: the engine is more accurate than the manual reconciliation
- **Status:** Confirmed (2026-06-30)
- **Detail:** The Director hand-reconciled May 30–Jun 27 (`Final` sheet) and we diffed: login 93% / late 96% / early 95% match; of 166 diffs **0 were the engine clearly wrong** — most were the manual grabbing a wrong cross-midnight session or missing a Sprinklr session. Verdict: **"مبدئيا انت ادق مني" — the engine is the trusted source.**
- **Impacted:** The engine output is authoritative for HR action going forward.
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-053 — ★ Tardiness tolerance = strictly > 6 minutes
- **Status:** Confirmed (2026-06-30)
- **Rule:** A late-in or early-out counts (deduction/HR) only when **> 6 min** (≤6 tolerated). `HR_MIN=7` in recon-build; `CRED_LATE`/`CRED_EARLY` = `BETWEEN 7 AND 240` in recon.controller — applies to EVERY month's live reports, not just June. (Supersedes the earlier 1..240 window in D-037.)
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-054 — ★ Full-shift span: system-open must cover the GROSS shift (9h incl. break)
- **Status:** Confirmed (2026-06-30)
- **Rule:** The agent stays logged in through the 1h break, so "completed required hours" means login→logout span ≥ GROSS shift (9h), NOT net 8h. Leaving early while still logging 8h net is a REAL early-out (previously wrongly excused). Maternity-7h still excluded from early-out; approved permissions still cover. Effect on the Director's Check list: 37 deduct (was 17).
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-055 — ★ No-punch-AND-no-system working day → FLAGGED + worked_min = 0
- **Status:** Confirmed (2026-06-30)
- **Rule:** Never silent, never auto-absent, and **never credited scheduled hours we can't prove**: `data_quality = "No punch & no system login — verify (not auto-absent)"` AND `worked_min = 0`. The flag is **role-blind**. (June check: 9 employees / 50 days, all → worked 0.)
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-056 — ★ ALL roles must open the system; leaders stay record-only for DEDUCTIONS
- **Status:** Confirmed (policy 2026-06-30 — supersedes the old blind-eye)
- **Rule:** Everyone — Team Leader / Senior / RTA / Resolution Specialist / WFM included — **must open the system**; the no-system-no-punch flag fires for them too. `isExcludedRole` "record-only" means **exempt from tardiness/HR-action deductions ONLY**, not from opening the system. The Director explicitly chose **"system-open only"** for leaders, NOT full tardiness scrutiny.
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-057 — Sprinklr login-only recovery: DEFERRED (leave as-is)
- **Status:** Deferred (Director decision 2026-06-30)
- **Rule:** Never-closed Sprinklr sessions (logout=1970 / >16h) are dropped by the bleed-guard, which loses a valid LOGIN — so the no-evidence flag may be over-strict for Fatma/Hassan/Noura. **Login-only recovery NOT enabled**; revisit once the recovery method is verified.
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-058 — ★ Cross-midnight shift = OWNED BY ITS START DAY, for everything
- **Status:** Confirmed + implemented (2026-06-30)
- **Rule:** A shift starting day D and ending D+1 belongs ENTIRELY to D — attendance, login/logout, worked hours, OT, permission, sick, leave, swaps, every request type. Discriminator = the shift's START calendar day. **General — not holiday/June-specific.** Impl: `prevDayBleed` in recon-build (a non-working day never credits a prev-day session). Fixed 4 holiday-OT double-counts + 85 OFF-day bleeds (June −31.6h holiday-OT, −597.7h worked). Jan–May Rule-B de-bleed needs per-month rebuilds (other pipeline) — open follow-up.
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-059 — ★ Annual leave on an official holiday → counts as the HOLIDAY, returns to balance
- **Status:** Confirmed + implemented (2026-06-30, always — every month)
- **Rule:** An `L` day landing on an official holiday is NOT a consumed leave day: presence='holiday', `hr_code='H'`, note set, original `L` kept in shift_code for audit. Leave-balance side: `EFFECTIVE_DAYS` subtracts holidays inside an annual-leave span (verified: 7-day leave over 6 holidays → 1 day charged). Back-applied to Jan–May (40 rows). Excludes DL/UPL.
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-060 — Canonical foundation = the Director's Final sheet (116 employees)
- **Status:** Confirmed (2026-06-30)
- **Rule:** The manual workbook `CC Schedule 26 May 30 and 31 and June to 27.xlsx › "Final"` (116 employees, +13 vs the old 103) is the canonical schedule foundation; the in-system Upload writes over it. Foundation/compare tools accept sheet `final|shift`.
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-061 — Friendly bilingual status labels (map approved)
- **Status:** Confirmed (2026-06-30)
- **Rule:** Morning/Day (M,B,C,AM,M20,B20,C20,M7-3,B7) · Evening (E,EE20) · Night (N,N20) · Midnight (MD,MN,MDR,MNR) — WFH folds into the base category; OFF→Day Off, H→Official Holiday, L→Annual Leave, SL/S→Sick Leave, A→Absent, DL→Death Leave, COMP→Comp Day, RES/TER→Resignation/Termination. Classified by `hr_code` first (L-on-holiday reads Holiday; a worked holiday still shows the shift). Plus: User ID (username), punch/system Σ totals, prefix search, leave-on-holiday conflict ⚠.
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-062 — Jan–May year data: leave AS-IS (no risky rebuild)
- **Status:** Confirmed (Director decision 2026-06-30)
- **Rule:** Dry-run vs live showed 0 diffs in hr_code/shift/holiday-OT/late/worked/TRUE_OT (only ~3% WFH-detection refinement) → year already consistent; a prior refresh attempt REGRESSED, so no rebuild. Always dry-run + diff into a scratch table before promoting any refresh.
- **Source:** WFM_RULES_AND_DECISIONS.md §18; memory `update_files_refresh_attempt`, `new_roster_recon_engine`.

### D-063 — Test plan: small June 28–30 upload FIRST, then full-year rebuild
- **Status:** Confirmed (agreed 2026-06-30)
- **Rule:** (1) On 2026-07-01 upload only **Jun 28–30** via the in-system Upload, compare/verify/correct drift; (2) after it passes, re-run the corrected engine over the **full year from January** ("الداتا الدسمة" — the Director has all source files). All 2026-06-30 rules auto-apply to any upload.
- **Source:** WFM_RULES_AND_DECISIONS.md §19; memory `new_roster_recon_engine`.

### D-064 — TL status is editable data; Aya Ruiz removed permanently
- **Status:** Confirmed
- **Rule:** `team_leader_status` (migration 060) replaced the hardcoded resolver; hiding a TL scrubs the label from roster_days everywhere. Aya Ruiz removed per the Director ("شيلها نهائي", 514 rows nulled); Talal Arandi = director (kept); Fatme Hassan→Fatma Hasan documented alias. Also: no person/code "صبا/Saba" exists — dropped, do not re-ask (2026-06-30).
- **Source:** memory `roster_conventions`, `new_roster_recon_engine`.

---

## Era 6 — 2026-07-01 (incident, audit, consolidation)

### D-065 — ★ INCIDENT: partial upload wiped June → the ingest-safety rule
- **Status:** Confirmed (fix commit b7b833d)
- **What happened:** A test upload of only Jun 28–30 wiped Jun 1–27 — `recon-ingest.js` hardcoded `DELETE … BETWEEN 2026-06-01 AND 2026-06-30` then inserted only 339 rows.
- **Rule (permanent):** The ingest DELETEs **only the actual min..max date range present in `ingest.json`** (`RECON_FROM/TO` may override), refuses to delete when no dated records exist, and refreshes `roster_days_recon_bak` every run (true undo-last-ingest). **A partial upload can only ever replace its own days.** Restore: `node scripts/recon-ingest.js --restore`; full snapshot in `roster_days_predisaster` (15,794 rows).
- **Recovery state:** Jan–May untouched; June restored to the pre-incident snapshot (2,733 rows/103 people) — the RULES were never lost, only June's data snapshot rolled back; hr_code/attendance_code/presence/username SQL-re-derived; the cross-midnight de-bleed + 13 extra people await a full rebuild with the Director's PREPARED source files (raw `Desktop/ROSTER/` exports are NOT the prepared engine inputs).
- **Source:** WFM_RULES_AND_DECISIONS.md §20; memory `new_roster_recon_engine`.

### D-066 — A-to-Z audit batch-1 data bugs: FIXED (commit b6bfcf4)
- **Status:** Confirmed (executed 2026-07-01)
- **Fixed:** (1) `include_tardiness` now emitted by recon-build + mapped in recon-ingest (was NULL after refresh → `AND r.include_tardiness` filtered EVERY row → empty tardiness rankings). (2) Report-builder "OT Total" column → the 3-bucket TRUE_OT sum (was bare `ot_min`). (3) WFH HR report reads holidays from the editable `holidays` table (was hardcoded `2026-06-16`). (4) recon-refresh summary reports the ACTUAL ingested range (was pinned to June). (5) Doc §5 corrected to `7..240 (>6 tolerated)`; dead `Placeholder` import removed.
- **Source:** memory `audit_2026_07_01_and_consolidation`; audit output `tasks/wqw23hg78.output`; commit b6bfcf4.

### D-067 — Audit deferred items: number-changing fixes wait for the Director's eyes
- **Status:** Needs Approval (execution), rules themselves Confirmed
- **Items:** (1) `ot_before_min`/`ot_after_min` still NULL after a corrected ingest (+ ~7 other MAP-omitted report columns) — emit in `_ingest` without changing TRUE_OT semantics. (2) sc-CTE 1:N fan-out — grouped scorecard KPIs are day-weighted; fix = aggregate at person grain (changes grouped averages). (3) **Shift-category computed 6 conflicting ways** — the ONE canonical mapping (doc §3: Morning=M/B/C/AM+20s+WFH-M/B · Evening=E/EE20 · Night=N/N20+WFH-N · Midnight=MD/MN/MDR/MNR) is the Confirmed rule; unifying the 6 code sites CHANGES shift-rate/fairness numbers → do with full re-validation. (4) Dead code: `Nx*`+`sevColor`, orphan `common/wfm-calc.ts` — adopt or delete. (5) Quick wins: shared `adhColor`/`ShiftRateBars`/`ROSTER_KPI_DEFS`, `keep-dark` on the ShiftRotation modal, i18n header titles, sidebar icon de-dup.
- **Source:** WFM_RULES_AND_DECISIONS.md §3, §9, §16; memory `audit_2026_07_01_and_consolidation`.

### D-068 — ★ Page-consolidation plan (hubs): CONFIRMED & EXECUTED (core), 2026-07-02
- **Status:** Confirmed — Director gave the go 2026-07-02 ("بلش يا وحش ابدع"); core executed in commits `5f68365` + `e9f5bb6`.
- **Executed (verified live):** 3 new hubs extend the proven `HubTabs + ?tab=` shape to 9 hubs total:
  - **Roster Reports hub** `/roster` (10 tabs): grid, dashboard, ot, analysis, wfh, quality, audit, changes, report-builder, dashboard-builder. "Reports & Analytics" sidebar section (7 items) deleted.
  - **Scorecard hub** `/scorecard` (8 tabs): overview, board, leaderboard, trends, agent360, team360, coaching, productivity.
  - **Capacity & Coverage hub** `/capacity` (3 tabs): planning (Erlang), coverage, intervals.
  - Every old route redirects to its hub tab (deep links + existing buttons keep working). Polish: ShiftRotation modal `keep-dark`, PAGE_TITLES 15→33, Roster header farm 14→6 buttons.
- **Remaining sub-items (still Needs Approval):** Chief branch nesting (13 guard routes under one shell); executive-home merge (CommandCenter + ControlDashboards + Dashboard + WfmOverview → one landing); hourly-analytics/demand-schedule stay in AnalyticsHub for now (cross-linked, not duplicated).
- **Source:** memory `audit_2026_07_01_and_consolidation`; audit output `tasks/wqw23hg78.output`; execution commits `5f68365`, `e9f5bb6`.

---

## Cross-Cutting Declines & Deferrals

### D-069 — DECLINED: self-modifying / self-deploying bot code
- **Status:** Declined (safety boundary stated to the Director)
- **Rule:** No guard may auto-fix its own codebase and deploy without human review. The Chief DETECTS and reports for human fix. Do not build autonomous self-coding.
- **Source:** memory `automode_and_chief_face`.

### D-070 — DECLINED: the fake "Counterfactual Roster Replay" score
- **Status:** Declined (honesty over demo dazzle)
- **Rule:** A schedulability score whose demand is derived from the schedule itself is circular (always ~100%) — refused to ship it for the management demo. Becomes the flagged "next big build" once an independent per-hour demand signal (ops_contacts / Erlang volume) is wired. Command Center shows verified-data-only, with source-basis tags (🔵 live / 🟢 corrected / 🟣 12-month).
- **Source:** memory `command_center`, `new_roster_recon_engine`.

### D-071 — Animated background: REMOVED — never re-add
- **Status:** Confirmed (Director removed it)
- **Source:** WFM_RULES_AND_DECISIONS.md §14; memory `design_system_polish`.

### D-072 — Security: never `npm audit fix --force`
- **Status:** Confirmed (it downgrades NestJS and breaks the build). CVE patching is done surgically; IDOR sweep + SSL done in Hardening Phase 2.
- **Source:** memory `security_hardening_phase2`.

### D-073 — "Review / make sure it's fine" = deep correctness audit
- **Status:** Confirmed (working agreement with the Director)
- **Rule:** When the Director asks to review or verify, that means a DEEP correctness and data-integrity audit against the rules doc and real data — never a surface render check. Mock/demo data is never called complete.
- **Source:** memory `feedback_review_means_correctness`, `feedback_rules`; CLAUDE.md §3, §34.3.

---

## Addenda — decisions registered late (2026-07-02 consistency audit)

### D-074 — Final RBAC access model
- **Status:** Confirmed (2026-06-20, migration 040)
- **Rule:** Admin = everything, including settings (162/162 GETs verified); **RTA + Team Leader = "like admin but cannot change settings"** — every permission EXCEPT `settings.edit`, `admin.*` (roles/functions/shift_codes), `users.*`; **Agent = own data only** (self-scoped by employee_id via `/me/overview`, `/me/attendance`, own requests/schedule/coaching/scorecard). Verified per role with `scripts/smoke-get.js`; 0×5xx all roles; sensitive actions audited.
- **Source:** memory `final_access_model`; MASTER_PROJECT_MEMORY.md §5.

### D-075 — Fairness basis = PRE-SWAP
- **Status:** Confirmed (June 2026)
- **Rule:** Rotation/shift-rate fairness is ALWAYS computed on the schedule BEFORE approved shift swaps (approved swaps are reversed before counting). Swapping away your midnight still counts as yours — swaps must never game rotation.
- **Source:** memory `business_rules`; BR-ROT-003 / BR-SWP-002 in `WFM_BUSINESS_RULES_LIBRARY.md`; `loadYtdDistribution(preSwap=true)` (generator.service.ts:97/224, requests.service.ts:753).

### D-076 — June 1–27 rebuild DEFERRED; roster goes Sprinklr-first going forward
- **Status:** Confirmed (2026-07-03, Director)
- **Facts verified live:** roster_days June 1–27 = 103 people / 2733 rows; the correct source workbook (`CC Schedule 26 May 30 and 31 and June to 27.xlsx` › Final) = 116 people → true gap = **13 missing people** (10790, 12122, 12937, 9565, 11571, 9569, 11603, 13827, 11480, 10083, 13234, 13524, 12377), zero extras — NOT the 24 previously estimated. Foundation re-extract verified working (3084 rows / 116 emp), but SRCDIR `Ameyo login and logout.xlsx` + `Login and Logout sprinklr.xlsx` are byte-identical to the `_2830` slices → no full-June attendance sources on disk → dry-run build = 0 records.
- **Decision:** Director has the original attendance files but chose to DEFER the June fix — "الروستر كامل رح يكون من سبرينكلر الفترة الجاي": from the next period the roster is sourced fully from Sprinklr. June 1–27 stays at 103 people unless revisited. No live data was touched during the investigation (scratch + report file only).
- **Reopen recipe:** restore the two full-June Ameyo/Sprinklr exports → `MANUAL_FILE=<May30+June-to-27 workbook> MANUAL_SHEET=final RECON_FROM=2026-06-01 RECON_TO=2026-06-27 node scripts/recon-extract-foundation-v2.js` → recon-new-roster/build dry-run → diff → ingest.
- **Source:** session 2026-07-03; memory `audit_2026_07_03_suffix_normalizer_healthcheck`.

---

## Open Items Register (as of 2026-07-02)

| # | Item | Status | Blocking on |
|---|---|---|---|
| O-1 | Page-consolidation plan (D-068) | **FULLY DONE** — core 3 hubs (commits 5f68365/e9f5bb6) + Chief hub 14 tabs & ONE executive home `/command-center` (commit 8f00a4c); all 13 guard routes + dashboard/control-dashboards/wfm-overview redirect to hub tabs. Register verified 2026-07-03 | — |
| O-2 | June full rebuild (cross-midnight de-bleed + 116-person foundation, D-065) | **DEFERRED per D-076** (true gap = 13 people, not 24; Sprinklr-first from next period) | Director reopening it + the full-June Ameyo/Sprinklr files |
| O-3 | Full-year re-run from January (D-063 step 2) | Pending | O-2 test pass |
| O-4 | Shift-category 6-site unification (D-067.3) | **ANALYTIC SITES DONE** (verified 2026-07-03): fairness/shift-rate/self-service all import `@common/shift-category`. Remaining LOCAL taxonomies are display/behaviour by design: Schedule-grid visual colours ('between'), absence-panel PANEL_FAMILY (E→night, B/C→afternoon), demand.engine SHIFT_FAMILY (C→afternoon). **Recommended:** align absence-panel + demand-engine families to canonical (E=evening, C=morning) — changes on-screen groupings, needs Director's eyes | Director decision on the 2 display taxonomies |
| O-5 | sc-CTE person-grain aggregation (D-067.2) | **DONE & VERIFIED 2026-07-03** — `sc_rn` ROW_NUMBER per (person, group) + `FILTER (WHERE sc_rn=1)` on all scorecard KPI aggregates (recon.controller:321-327/371); live June check: person- vs day-weighted differ ≤0.1 pt | — |
| O-6 | `ot_before_min`/`ot_after_min` + report-builder columns in corrected ingest (D-067.1) | **ENGINE DONE** (recon-build.js:282-288 emits otBefore/otAfter + week/month/attendance_status/late_category/missing flags; recon-ingest maps all) — verified 2026-07-03. Live June rows still NULL (pre-fix build; rebuild deferred per D-076); first next rebuild backfills automatically | Next rebuild (July or June reopen) |
| O-7 | Jan–May cross-midnight Rule-B de-bleed (D-058) | Pending | Per-month recon rebuilds |
| O-8 | Sprinklr login-only recovery (D-057) | Deferred | Recovery method verified |
| O-9 | Sprinklr-only session mode (D-044) | **READY 2026-07-03** (commit 757ed0e) — engine reads `sysMode` from recon-config.json / per-run selector on Upload & Rebuild; June default untouched (ameyo-first). Flip at first July upload per D-076 | First July upload |
| O-10 | Productivity denominator variant (Staffed−Break vs scheduled hours, D-016) | Built as (a); Director to confirm | Data review |
| O-11 | editCell / demand-publish still WRITE `attendance_records` (D-051 follow-up) | **DONE 2026-07-03** — editCell (commit 97df531), generator publish + schedule-change approval (commit 8070d97) all dual-write roster_days (UPDATE-only, actual-evidence guard) | — |
| O-12 | Legacy `roster_daily` re-ingest to surface the WFH fix on `/dashboard` (§4 drift) | **DONE 2026-07-03** (Director-approved) — re-ingest impossible (SRC_DIR exports gone); synced presence to canonical roster_days instead: 2,342 rows fixed (1,236 WFH→office…), backup `roster_daily_wfh_bak_20260703`, script `fix-roster-daily-wfh-sync.js` (commit 2757dae) | — |

---

*Maintained alongside `docs/knowledge/WFM_RULES_AND_DECISIONS.md` — that document remains the single
source of truth for the RULES themselves; this log records WHEN and WHY each was decided, by whom,
and what may not be executed without approval.*
