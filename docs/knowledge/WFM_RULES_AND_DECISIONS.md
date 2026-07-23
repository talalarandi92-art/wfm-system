# WFM — Rules & Decisions (Single Source of Truth)

> **The one reference for every business rule and decision in the Boutiqaat WFM system.**
> If anything here conflicts with code, the rule here wins — fix the code. Maintained by Claude + the WFM
> Director. Ships with the repo, mirrored into the `wfm-system` skill and the user's memory. Last consolidated
> 2026-06-24 (after a 6-dimension adversarial audit, health 82/100).

## 0. Source-of-Truth Priority (when rules conflict)
1. Latest direct user clarification → 2. Real uploaded workbook (`Desktop/ROSTER/CC Schedule` tab **"Shifts"**)
→ 3. This document → 4. Earlier assumptions → 5. Generic WFM practice.
Newer overrides older. Real data overrides theory. A feature on mock/demo data is **not** complete.

---

## 1. Canonical Identity Model
- **`person_no`** is the canonical person key. Old internship ID (6xxxx) and new full-time ID (1xxxx) for the
  same person are **collapsed to one** `person_no` (see `Employee_ID_Map.xlsx`).
- **`is_active` = canonical-dedup, NOT employment.** It keeps a leaver's history in reports (so historical
  numbers stay correct); forward-exclusion of leavers is via `employees.status`. A duplicate old/new ID → only
  the canonical row is `is_active`.
- **Function is per-month, from each month's schedule row** — never a global first-wins value. `role_function`
  = `COALESCE(NULLIF(month.function_name,''), static)`. "Social Media" and "Social Media & Email" are BOTH valid
  (kept verbatim per month — sometimes merged, sometimes split).
- **Intern-fold (Director 2026-07-04): an "Internship X" function IS the "X" team for headcount.** `Internship
  CH - WA` → `CH - WA`, `Internship Inbound` → `Inbound`, `Internship Offline` → `Offline`, `Internship OMT` →
  `OMT`. ONE canonical helper **`canon_fn(text)`** (migration 068, IMMUTABLE, strips a leading `Internship `) is
  the single source of truth; it is wrapped at **every** headcount / coverage / demand / pool / scheduling-pool /
  dropdown site (recon engine + dashboard/control-dashboard/coverage/capacity-HC/people-insights/generator/
  rotation/workforce-analytics; two-key coverage endpoints fold BOTH `role_function` and `employees.function_id`).
  **Per-person identity labels and raw exports KEEP the intern label.** function_id/UUID-FK modeling surfaces
  (capacity Erlang inputs, analyst FK) stay granular by design. Verified CH-WA pool 25→38 (16 interns merged).
- Name whitespace is collapsed (`\s+`→space) on every read (double-space split one person into two).
- Match employees by **ID, never name-only**.

## 2. Time & Calendar
- **Week starts Saturday** (Sat→Fri). Use `fmtLocal` + `snapToSaturday`; never `toISOString()` for local dates
  (UTC off-by-one caused a 3-OFF/week bug).
- **Cut-off cycles:** full-time **15→14**, interns **1→end of month**, Bahrain **25→24**.
- **Permission balance renews per cycle: 6 hours + 3 permissions.** Only **Approved** permissions consume/exempt.

## 3. Shift Dictionary & THE ONE Canonical Shift-Category Mapping
**⚠ DRIFT TO FIX (audit): shift-category is currently defined 6 conflicting ways** (by start-hour in
`wfm-calc.ts`/`me.service`, by code-prefix in `recon.controller:380`, a 3-way in `recon.controller:776`,
collapsed in `schedule.service`, different again in `Schedule.tsx`). A 14:00 shift is "evening" in one and
"night" in another. **Canonical mapping (use everywhere, by CODE with start-hour fallback):**
- **Morning/Day:** M, B, C, AM (+ M20/B20/C20, WFH-M/WFH-B)
- **Evening:** E, EE20
- **Night:** N, N20 (+ WFH-N)
- **Midnight:** MD, MN, MDR, MNR
- Exclude OFF/H/L/S/A/COMP from working shift-rate (track separately).
- Standard agent shift = **9h incl. 1h break**. Responsible/supervisor `20`-codes & RTA/CC/Resolution/TL = **8h**.
  **Ramadan = 7h** (MR/BR/NR/ER/MDR/MNR + CR split). Some shifts cross midnight; some are split shifts.

## 4. Presence & WFH Rule (CORRECTED 2026-06-24)
**Presence values:** `office · wfh · absent · leave · off · holiday · sick · left · unconfirmed`.
- **WFH = a WFH shift code OR an explicit WFH `location` ONLY.** **NEVER** inferred from "system login + no
  punch." An office-located shift + system session + no fingerprint = **MISSING PUNCH (presence=`office`)**, not
  WFH. (Old rule was wrong; fixed in `import-roster-master.js`, 1730 live rows corrected `wfh→office`.)
- A WFH-code row whose location reads 'Office' → **Data Quality**, not an auto-WFH assertion.
- **Office vs missing-punch:** `office` shift + punch → office; + system-only → office (missing punch); + neither
  → `absent` (or `unconfirmed` for low-capture roles observed <70% of days — excluded from absence so we don't
  wrongly punish RTA/supervisors/social agents during a capture gap).
- A public **holiday is never "absence."** **Sick** only when the Odoo status says sick — never inferred.
- **⚠ DRIFT TO FIX (audit):** the LEGACY engine (`recon.engine.ts:72-73`) feeding `roster_daily` →
  `/dashboard`,`/metric`,`/overtime`,`hr-weekly`,`hr-matrix` **still infers WFH from system-no-punch**. Fix:
  point those at `roster_days`, or deprecate the legacy path. (The rich `roster_days` path is already correct.)

## 5. Attendance Reconciliation
- **Combine-both-systems:** total work = **UNION of Ameyo ∪ Sprinklr** active intervals (overlap once; separate
  periods add — "9h Ameyo + 2h Sprinklr = 11h"). Floor-support with no system → use punch.
- **Source trust:** Schedule = truth for OFF/work/leave · Ameyo ready-end reliable (raw logout bleeds → discard
  >16h, cluster gap>4h) · Sprinklr raw login/logout bleeds → use **AGENT_OCCUPANCY** report instead · Odoo =
  holidays + punch trusted, individual leave NOT (goes stale). Punch = office only (WFH have none).
- **Tardiness/Early — credible only (`CRED_LATE`/`CRED_EARLY` = 7..240 min; >6 tolerated, see §19)**; cross-midnight bleed capped at
  240 (night logout reads 25–29h otherwise). Normalize post-midnight login with +1440 before measuring late.
- **Approved permission NEVER lowers conformance** (its minutes are added back to the covered overlap); only
  **Approved** exempts (not Refused/Pending). Tardiness = unauthorized late/early/system-close.
- **⚠ DRIFT TO FIX (audit):** `import-roster-days.js:183` lacks the cross-midnight +1440 wrap (false "on-time")
  — `import-roster-master.js` (the live builder) does it right; retire the duplicate `days.js`.

## 6. Overtime
- **TRUE_OT = regular `ot_min` + `offday_ot_min` + `holiday_ot_min`** — the three buckets are **DISJOINT**
  (`ot_min` is 0 on off/holiday rows; **verified 2026-06-24 — NO double-count**). `total = ot_min + offday +
  holiday` (NOT `total − holiday`).
- Normal day OT = worked beyond the scheduled shift end. OFF/holiday worked = whole day − 1h break.
- **OFF/holiday OT must be evidence-backed** (biometric punch span ≤13h); system-only → flag `off_work_unverified`,
  skip. Bleed guards: working-branch zeroes `otAfter`/`otBefore` >6h if not corroborated by a punch within 90min.
- **180h/year OT cap** report (EXCEEDED / APPROACHING).

## 7. Maternity & Female Shift Rules
- **MATERNITY_7H = `person_no IN ('12375','12434')`** (Haya Mohanna / Shaima Saoud) — measured on a **7h window**
  and **excluded from EARLY-OUT only** (their 2h-early departure is legitimate; late still counts). Extend the
  set as HR confirms (also recognizes `*7` codes M7/B7/C7/N7).
- **Female agents:** normally up to **C (ends 20:00)**; **N only if operationally necessary** (flag it); **never
  MD/MN (midnight)** unless a logged manual override. Configurable, not hardcoded; flag violations.
- **Female shift boundary (precise — 2026-07-04): E/EE/MD/MN are BLOCKED for females; N is the only
  "necessity" exception.** E ends 01:00 and EE ends 02:00 — both past C's 20:00 cap → a female must never be
  assigned E/EE (a common generator leak: the "evening" category collapses to "day", so gate by the female-blocked
  CODE, not the category). N (ends 22:00) is the ONLY late shift a female may take, and only under the
  `allowFemaleN` operational-necessity flag. Every generator (ladder, generateWeek, demand.engine, generator.engine)
  enforces this; the ladder puts females on N via `allowFemaleN=1` and never E.
- **Females must ROTATE across their allowed set (M/B/C), not freeze on one shift** (fixed 2026-07-04). The
  "up to C / no midnight" rule restricts the *set*, it does NOT mean one fixed shift. A generator that pins
  women to a single code is a BUG: proven on data (generated women averaged 1.39 distinct shifts / 48-of-75
  frozen vs the manual roster's 5.37 / 0-frozen). Both engines now rotate women within their allowed bands
  (demand.engine: code-level fairness tiebreak; generator.engine: female rotation guard). Enabling
  `allowFemaleN` additionally rotates them through N/E. See §8.
- **Male agents:** any shift per business need (subject to rest/fairness/coverage).

## 8. Rest, Rotation & Fairness
- **Minimum rest = 10h** between consecutive shifts (cross-midnight aware) unless manually overridden. Weekly
  rotation ⇒ ≥10h rest by construction.
- **`fairnessScore` = 100 − stdev** of night/midnight load over the fair pool. Optional **night-team carve-out**
  (fixed team vs fair distribution — user's choice, migration 065). **Weekend-OFF fairness** separately scored.
  Live snapshot: fairnessScore 79, weekend-OFF fairness 81.
- **Shift-VARIETY fairness (2026-07-04): rotate people across specific CODES, not just categories.** An employee
  locked to one category (e.g. a female to day: M/B/C are all `morning`) ties on category-share and, without a
  code-level tiebreak, freezes on one code. Both generators now add specific-code rotation so everyone cycles
  through the shifts they may work. Rule of thumb: if a working roster shows anyone on the *same* shift every day
  for weeks (and it isn't a fixed night-team member), that is a rotation bug — check the assigner's tiebreak.
- **Schedule-gap backfill** (`GET /roster-v2/gap-backfill`, read-only): person-days with a system login but no
  scheduled shift get a *proposed* shift (nearest canonical start to the login; logout ignored — ~17% bleed).
  Flagged, never writes, never overrides an explicit shift; females never proposed MD/MN; post-midnight logins
  flagged as a possible previous-day cross-midnight tail. Surfaced at Attendance → Gap Review.
- Rebalance proposal uses **current staff only**, female = night-only.
- Shift-rate % = distribution of each person's shifts YTD/MTD/period (count + %), with **before/after impact** on
  edit/swap. Exclude OFF/H/L/S/A/COMP from the working distribution.

## 9. Scorecard & Net Points
- Per-function KPI bands; **round-half-up all % is DISPLAY ONLY — scoring bands the RAW percentage**
  (D-079, Director 2026-07-22). Rounding first promoted values across band edges and paid MORE than the
  Director's own SC workbooks on 71 cells (68 higher, +550 net points; QA 79.80% paid 10 by the old
  path and −10 by his sheet). Enforced in `kpi-registry/score-band.ts` (`bandPct`, threshold_pct +
  gate); the hour bands never rounded and keep their exact edges. Productivity formula confirmed;
  sick-day penalty (1 sick −2%, 2+ −5%); quiz-commitment −5 on unsolved-quiz weeks.
  **Resolved (D-082, 2026-07-23):** the productivity band now uses RANGES at the top
  (`≥91→15, ≥90→10, ≥89→5, ≥87→0`) instead of the sheet's exact `=90`/`=89` steps, which under D-079
  left 90.5% scoring 0 while 90.0% scored 10. The BOTTOM edge stays `≤86→−15` exactly as the sheet
  wrote it — widening it to `<87` was measured and would have cost 8 real people 15 points each.
- `scorecard_entries` = 1 month only; `scorecard_monthly` = Net Points only; `fcr.employee_id` is a uuid.
- **⚠ DRIFT TO FIX (audit):** in the Custom Report Builder, the `sc` (scorecard) CTE is joined 1:N onto per-day
  roster rows, so a grouped `AVG(sc.net)` is **day-weighted, not person-weighted** (a 22-day agent outweighs an
  8-day agent). Aggregate at person grain before averaging. Affects all 13 `sc.*` KPIs in grouped views (the
  per-row detail view is correct).

## 10. Demand → Schedule Engine
- Chain (all on `roster_days`): `roster-v2/generate` (demand per hour → greedy set-cover shift mix → staffing
  check) → `generate-week` (per-employee weekly shift+OFF; female no-midnight; night→least-loaded; OFF→weekend-
  deprived) → `generate-week/save` (draft) → **`publish`/`unpublish`** into live `attendance_records`.
- **PUBLISH is SAFE:** targets the first **empty** future week (Saturday after MAX date); **single atomic
  multi-row `INSERT … ON CONFLICT DO NOTHING`** (never overwrites); rows tagged `notes='[generated <week>]'`;
  fully reversible. Verified live (CH-WA: 259→DB→unpublish 259→0).
- **Schedule states:** Draft → Generated → Reviewed → Published → Locked. A **published schedule is never
  overwritten by Generate.** Manual edits after publish require validation + audit + version history +
  before/after impact (coverage, rest, female rule, shift-rate, HC by interval). Soft-lock = admin-edit-with-audit.
- **Manual edit/swap on a WORKED day must reset the window-derived metrics (2026-07-04).** `late/early/OT/
  adherence` in `roster_days` are plain stored columns (no trigger), computed against the shift window. If a
  manual scheduleChange/scheduleSwap/scheduleRevert changes the window on a day that already has punch/login
  evidence, those metrics are now WRONG — the write NULLs/zeros them (`staleMetricReset()`) so no report shows a
  stale value; the next recon rebuild recomputes them. (publishVersion + schedule-changes/approve instead SKIP
  worked days entirely — `punch_in_min IS NULL AND sys_login_min IS NULL`.) The **Gap Review "Apply"** reuses
  scheduleChange (override) — safe because it only fills OFF/no-shift days (no prior window metrics to corrupt).
- **Laddered Rotation (`roster-v2/ladder-generate`):** humane 2-3 day blocks, a rest OFF after each (≤3
  consecutive working days; ≥2 OFF/week), forward M→E→N, coverage proven per band vs 28-day demand. Females are
  **day-only** (M/B/C) by default; `allowFemaleN=1` lets them cover evening via **N only** (never E). Male blocks
  are sized by the RESIDUAL demand after females take morning. Read-only proposal — a coverage gap is SHOWN, never
  hidden by leaking a blocked shift to a female (§11 "never hide a gap").

## 11. Data Tables Map (NEVER cross-wire)
- **`roster_days`** = RICH canonical (person_no/role_function/is_active, built by standalone `import-roster-*.js`
  from `Desktop/ROSTER` + all data). **Every** `roster-v2/*`, hr-matrix, agent-360, ot-exceptions report reads it.
- **`roster_daily`** = THIN (`/upload`+`/ingest` write it; the `/dashboard` legacy path only). `/dashboard`
  auto-ingests when count==0 (a landmine).
- Refresh = retarget the import scripts onto a **backup** + dry-run before promoting.
- **Per-day report default date** must skip marker-only tail days (a lone RES/TER) — default to the latest day
  with ≥20 working rows (fixed for coverage-impact + interval-headcount 2026-06-24).

## 12. Integrations
- **Ameyo / Sprinklr** bridges (Chrome extensions) cache & auto-login; **Sprinklr login/logout is LOCAL time,
  not UTC** (no +3). **Odoo** for holidays + punch + permissions/comp/sick. Email→employee link.

## 13. The Guard Team & The Chief
- Sidebar shows **only the Chief**; the guards run behind it. Health · Analyst · Reporter · Security · Scorecard ·
  Researcher · Expert · Reply-Helper, + Knowledge Ledger / Team Learning. **Auto Mode** auto-approves only
  **safe-surplus** requests by coverage (guarded, reversible, opt-in auto-reject). Analyst learns from accept/reject.

## 14. Design System
- 3 themes: **Dark / Light / Aurora-Glass**. The dazzle kit (`components/dazzle.tsx`: StatTile / Donut / BarRow /
  Gauge / Sparkline) is **var-based + reduced-motion** → correct in all 3 by construction. Prefer it for KPIs.
- **Light-mode near-black NET** (`index.css`): a fixed allow-list remaps inline near-black hexes
  (#11162a/#0f1527/#0f172a/#0b0f1c/#0b1120/#080f1a/rgba(7,9,15)) to light. **Any NEW near-black inline bg must be
  added to the list** OR use a net-covered hex (e.g. `#0f172a`) — else it stays dark on light. `text-white`,
  `bg-white/`, and listed `rgb()` text are already flipped. Inline `color:'#fff'` is NOT flipped → on a flipped
  bg it goes white-on-light (use theme vars instead). Verify every new page in Light + Glass.
- **NO animated background** (the user removed it — do not re-add).

## 15. TypeORM / PostgreSQL Gotchas
- `ds.query()` does **NOT** expose `.rowCount`. `INSERT…RETURNING` → FLAT rows array (count = `length`);
  `DELETE/UPDATE…RETURNING` → `[rows[], count]` TUPLE (count = `r[1]`). Manual `BEGIN`/`COMMIT` via separate
  `ds.query()` calls = FAKE transaction (different pooled connections) → use ONE atomic statement or a QueryRunner.
- `day_name` NULL → derive from DOW. `work_date::text` to avoid TZ off-by-one. Quote reserved aliases (`AS "hour"`).
- Backend runs **compiled `dist`**: `npm run build` then `node dist/main.js`; restart to apply `.ts` changes.

## 16. Known Drifts & Retired Code (do NOT reintroduce)
- ✅ **RESOLVED:** WFH inferred from system-no-punch — fixed in BOTH paths: the rich builder
  (`import-roster-master.js`, +1730 live rows corrected) AND the legacy `recon.engine.ts` (now `office` +
  `missing_punch`, never `wfh`; spec updated, 15/15 pass; roster_daily reflects it on the next re-ingest).
- ✅ **RESOLVED:** request **HC-impact** (permission + leave) repointed from stale `attendance_records` → canonical
  `roster_days` (approval now correctly drops the headcount during worked hours; verified live).
- ✅ **RESOLVED:** `import-roster-days.js` DEPRECATED (header) — it had the cross-midnight late gap; `master.js`
  is the sole live builder.
- ⚠ **OPEN (number-changing — do carefully, with full re-validation, AFTER the demo):**
  - **Shift-category conflict — ✅ ANALYTIC SITES UNIFIED 2026-07-02** (`common/shift-category.ts` = THE §3 mapping;
    wired into fairness catExpr [C was mis-bucketed as evening], generate-week 3-way, and /me shift-rate hour buckets —
    verified live). REMAINING BY DESIGN: the Schedule grid's visual 'between' colour taxonomy (display language, not
    analytics) and the generator's hour→code derivation (changes generation behaviour — needs the Director's eyes).
  - **Net-Points day-weighted join — ✅ FIXED 2026-07-02**: grouped report-builder scorecard KPIs are PERSON-weighted
    via `sc_rn = ROW_NUMBER() OVER (PARTITION BY person, group)` + `FILTER (WHERE sc_rn=1)`; verified live.
  - **Dead code** — remove `Nx*`+`sevColor` (`ds.tsx`) and `common/wfm-calc.ts` (orphan); safe cleanup, no behavior change.
  - **Legacy roster_daily re-ingest** — to surface the engine WFH fix on `/dashboard`,`/metric`,`/overtime` (heavy parse).
- 🧹 **DEAD CODE:** the entire `Nx*` library + `sevColor` in `ds.tsx` (0 usages) and `common/wfm-calc.ts` (the
  "single source of truth" imported by nothing but its own spec; live copies re-implemented & one diverges) —
  either adopt or delete; do not keep both.

## 17. i18n Convention
- Inline `ar ? 'عربي' : 'English'` (not a dictionary). EN mode must be **100% English** BUT inputs must still
  accept typed Arabic (no `dir=ltr`/filters on inputs).

## 18. 2026-06-30 — Engine hardening, schedule linkage & in-system upload (codified)
All of the following live **inside the reconciliation engine** (`backend/scripts/recon-build.js`) so every refresh
re-applies them — a re-ingest can never silently wipe them. This is the fix for the recurring "it worked then broke"
regressions: a rule that is not in the engine gets overwritten on the next rebuild.
- **Holiday-worked OT** — whoever works a SCHEDULED shift on an official holiday gets the WHOLE shift as
  `holiday_ot_min` (capped at scheduled net), regular OT = 0, row labelled "Official Holiday — <name> (worked)".
  Holidays AUTO-DETECT from the Odoo Status column (`new year|eid|arafat|national day|liberation|isra|mi'raj|hijri|
  public holiday|ascension|prophet`) propagated date-wide, **plus** an EDITABLE list in `backend/scripts/recon-config.json`.
  Jun 16 (Hijri New Year): 51 worked → 406h holiday OT. Holiday OT varies by month for real reasons (Apr=0, May high=Eid al-Adha). User-approved.
- **Master HR codes** (`hr_code`/`attendance_code`) — HR Matrix cell = `COALESCE(hr_code, attendance_code, shift_code,
  'OFF')`. Engine sets sick→`SL` (raw NS/ES in attendance_code), absence→`A`, off→`OFF`, leave→`L` (DL/UPL kept),
  holiday→`H`, comp→`COMP`, sep→`RES`/`TER`, WFH-working→hr_code `WFH`, office-working incl. **forgot-to-punch**
  (system but no punch, not WFH)→hr_code = shift code (never OFF/absent). Same logic as import-roster-master.
- **worked_min clamp** — a non-working day credits only the validated OT session, not raw never-logged-out system
  bleed (killed a 31h false rest-day); working days capped ≤16h.
- **In-system upload = the corrected engine** — `POST /attendance-recon/recon-refresh` (perm `schedule.publish`) + the
  Roster "رفع وإعادة بناء / Upload & Rebuild" button run `recon-refresh.js` (foundation→engine→ingest). Uploading FROM
  the system becomes the permanent corrected base. Runbook: `docs/RECON_PIPELINE.md`.
- **Schedule ↔ corrected roster** — the Schedule grid OVERLAYS `roster_days` (real WFH/holiday/SL/A + true OT/late +
  CANONICAL shift times) when a cell is covered; future weeks fall back to the plan. Cell shows the SHIFT CODE DIRECT
  (E/M/B/C/MD/C7…) — **no `-WFH` suffix**; WFH is shown by a 🏠 icon + dotted texture. Planned cells dashed+faded;
  holiday cells get a gold ribbon. (editCell/publish still WRITE attendance_records — follow-up.)
- **Year Jan–May = already consistent** — dry-run vs live diff: 0 changes in hr_code/shift/holiday-OT/late/worked/
  true-OT (only ~3% WFH-detection refinement). No rebuild (a prior refresh regressed). June stays on the recon engine.

## 19. 2026-06-30 — Tardiness / HR-action rules (after the manual-vs-engine review)
The user reconciled May30–Jun27 by hand and we diffed it vs the engine (login 93% / late 96% / early 95% match;
**0 cases the engine was clearly wrong**) — verdict: **the engine is the more accurate, trusted source**. Two rule
corrections came out of it (both now LIVE):
- **Tardiness tolerance = > 6 min.** A late-in or early-out counts (deduct/HR) only when **strictly greater than 6
  minutes** (≤6 tolerated). `HR_MIN` = 7 in recon-build; `CRED_LATE`/`CRED_EARLY` = `BETWEEN 7 AND 240` in
  recon.controller.ts (applies to EVERY month's live reports).
- **Full-shift span (9h INCLUDING the break).** The agent stays logged in during the 1-hour break, so the
  system-open span (login→logout) must cover the FULL scheduled shift (e.g. 9h for a 9h shift) — NOT the net 8h.
  "Completed required hours" now means `span ≥ gross shift`, not `≥ net`. So leaving early but still logging 8h net
  is a REAL early-out (it was wrongly excused before). Maternity-7h still excluded from early-out; approved
  permissions still cover.
- **No-punch-AND-no-system days are FLAGGED, never silent — and worth 0 worked hours.** A working day with neither a
  punch nor a system login gets `data_quality = "No punch & no system login — verify (not auto-absent)"` **AND
  `worked_min = 0`** (never the scheduled net — we must never show "worked 8h" for a day we can't prove). The flag is
  **role-blind**: it fires for every role. (June check: 9 employees / 50 days, all → worked 0.)
- **System-open requirement applies to ALL roles — leaders included (policy 2026-06-30, supersedes the old blind-eye).**
  Everyone — including Team Leader / Senior / RTA / Resolution Specialist / WFM — **must open the system**; a
  no-system-no-punch working day is a real flag for them too (already enforced: the `_ingest.dq` flag is role-blind).
  The `isExcludedRole` "record-only" exclusion now means **exempt from tardiness / HR-action *deductions* ONLY** — it is
  NOT an exemption from opening the system. **DECIDED 2026-06-30: leaders stay record-only for deductions — only the
  system-open flag applies to them** (user chose "system-open only", NOT full tardiness scrutiny).
- **Never-closed Sprinklr sessions (logout=1970, >16h):** a real login that the engine currently drops → can falsely
  flag someone (Fatma/Hassan/Noura) as "no system" even though they opened it. **DECIDED 2026-06-30: leave as-is —
  login-only recovery NOT enabled** (revisit once the recovery method is verified). Until then their no-evidence flag
  may be over-strict for those 3.
- **Canonical foundation** is now the user's latest manual workbook (`Final` sheet, 116 employees); the in-system
  Upload writes to it. NOTE: the live reports' tolerance change covers all months, but the no-punch flag + full-span
  disposition currently apply to June (the recon-engine month); rebuilding Jan–May through the same rule is a follow-up.
- **★ CROSS-MIDNIGHT SHIFT = OWNED BY ITS START DAY, FOR EVERYTHING (CONFIRMED + DONE 2026-06-30, commit pending).**
  A shift that begins on day D and ends on D+1 belongs **entirely to D** — for attendance, login/logout, worked hours,
  **OT, permission, sick, leave, schedule swaps, and every request type**. The discriminator is the shift's **start
  calendar day**, never the end day. Example: a shift starting 06-15 evening and ending 07:00 on 06-16 (a holiday) is a
  **06-15** shift in full; a 2 AM permission on 06-16 for it is filed under 06-15. A genuine shift that *starts* 06-16
  00:00→07:00 belongs to 06-16. **GENERAL — not holiday/June-specific.** Impl in recon-build: `prevDayBleed =
  !isWorkingKind && govLogin < 0` → a non-working (H/OFF/leave) day does NOT credit OT/worked and does NOT show a
  session whose login is before the day began. Fixed the double-count (Ali Muteb 12937, Habib 11952, Ghadir 13805,
  Mohammad Sahar 13830 on 06-16 → holiday OT 587/226/541/540 → 0) + 85 OFF-day bleeds (June: −31.6h holiday-OT,
  −597.7h worked). Engine-enforced for every upload; applies to all future months.
- **★ ANNUAL LEAVE ON AN OFFICIAL HOLIDAY → counts as the HOLIDAY, returns to the leave balance (CONFIRMED + DONE
  2026-06-30).** An `L` day that lands on an official holiday is NOT a consumed leave day. Impl: `leaveOnHoliday =
  isHolidayDate && kind==='leave' && not DL/UPL` → presence='holiday', `hr_code='H'` (so HR-matrix/balance don't count
  L as taken), `daily_note` set, original `L` kept in shift_code for audit. Applied in the engine (June) AND back-applied
  to Jan–May existing data (40 rows: New Year/Israa Wal Miraj/National/Liberation/Arafat/Eid ul-Adha). Holidays for the
  whole of 2026 are now in `recon-config.json` (editable). **Always — every month.** **Leave-balance side (done):** the
  balance draws down `request_leaves.duration_days` (calendar days) — `leave-balances.service.EFFECTIVE_DAYS` now
  subtracts any official holiday that falls inside an **annual-leave** span (`GREATEST(0, duration − holidays-in-range)`),
  so a holiday during leave never costs a leave day. Holidays live in the editable `holidays` table (mirrored from
  `recon-config.json` on every recon-ingest). Verified: 7-day leave over 6 holidays → 1 day charged.
- **Status labels (map APPROVED + DONE 2026-06-30):** friendly bilingual labels instead of raw codes — Morning/Day
  (M,B,C,AM,M20,B20,C20,M7-3,B7), Evening (E,EE20), Night (N,N20), Midnight (MD,MN,MDR,MNR) [WFH folds into base cat];
  OFF→Day Off, H→Official Holiday, L→Annual Leave, SL/S→Sick Leave, A→Absent, DL→Death Leave, COMP→Comp Day,
  RES/TER→Resignation/Termination. Classified by `hr_code` first (so an L-on-holiday reads as Holiday, a worked holiday
  still shows the shift). On the row + detail. Also added: **User ID** (a.wahab, `roster_days.username`), punch/system
  **Σ totals**, prefix search. Roster commit 584260b; rules commit next.
- **REMAINING (Jan–May Rule B):** the cross-midnight double-count is fixed in the recon engine (June + future). Jan–May
  was built by the OTHER pipeline (import-roster-master) and its 480 non-working-with-worked rows can't be cleanly
  de-bled via SQL (no session-login sign) — needs a per-month recon rebuild when those months' sources are loaded.

## 20. 2026-07-01 — Partial-upload data-loss INCIDENT + the ingest-safety rule
A test upload of only **Jun 28–30** wiped **Jun 1–27**. Root cause: `recon-ingest.js` hardcoded `DELETE FROM
roster_days WHERE work_date BETWEEN 2026-06-01 AND 2026-06-30` then inserted only the 339 uploaded rows.
- **FIX (commit b7b833d):** the ingest now DELETEs **only the actual date range present in `ingest.json`** (min..max
  `date`); `RECON_FROM`/`RECON_TO` still override; it refuses to delete when there are no dated records; and
  `roster_days_recon_bak` is refreshed **each run** (a true undo-last-ingest — restore uses the backup's own range).
  **A partial upload can now only ever replace its own days — never the rest of the month.**
- **Recovery state:** Jan–May untouched (safe, keep their fixes). June restored from `roster_days_recon_bak` to the
  PRE-today version (**2733 rows / 103 people**) — so today's June refinements (cross-midnight, leave-on-holiday,
  username, totals, +13 people) are NOT on June's rows until a rebuild. Full snapshot of ALL months kept in
  `roster_days_predisaster` (15794 rows). **The RULES were never lost — only June's data snapshot rolled back.**
- **GOTCHA:** the raw `Desktop/ROSTER/` exports are NOT the prepared engine sources (raw Ameyo matched 0 rows because
  `byUser` needs the small prepared "Ameyo login and logout.xlsx" User-ID format) — rebuilding today's corrected June
  needs the user's PREPARED source files re-shared. A partial June re-apply is possible via SQL (username + leave-on-
  holiday) but the cross-midnight de-bleed and the 13 missing people need the rebuild.

## 21. 2026-07-02 — Scheduling-engine overhaul ("أقوى محرّك") — audited, implemented, spec-gated
A 74-finding deep audit of the WHOLE scheduling chain, then a parallel-lane implementation (commits 85c00b5, 2385c94,
0ed413f, 13aaf77, f6018f1). **Verified before/after on the SAME generated week (118 employees): fairness 20 → 82,
OFF exactly 2 per employee (118×2), females on E/EE/MD/MN = 0, coverage 86% → 71% (the honest ×5/6 effect of 2-OFF).**
- **Generator:** YTD/rotation classification is CODE-FIRST via `common/shift-category` (was hour-drifted → corrupted
  fairness + broken midnight rotation); classic generate() honors APPROVED LEAVE ('L' assignment — never scheduled,
  never consumes OFF, out of coverage); OFF default = 2/week; demand path enforces FUNCTION_SHIFT_POLICY (Refund never
  MD, OMT only B/N) + surplus-OFF capped at the allowance; fairness = max(0, 100 − √((nightVar+midVar)/2)) ⊕ 0.7/0.3
  weekend; publishVersion has a force-guard (archives replaced versions, audit_logs, skips punch-carrying cells).
- **Spec gate (permanent):** `generator.engine.spec.ts` + `demand.engine.spec.ts` — 29 tests lock rest (MD→M=0h
  invalid), exact-2-OFF, no full-pool day-7 OFF, female blocks, function policies, leave semantics. The gate CAUGHT
  2 real demand bugs (forced-OFF pre-pass never credited planned OFFs; planned-OFF registration ignored the weekly
  allowance) — both fixed. Run with `npx jest schedule-generator`.
- **Requests ↔ schedule (THE wiring):** approving a leave-family request now WRITES the live schedule — attendance_records
  marker + roster_days hr_code (L/SL/DL/COMP/WFH, engine-identical codes) in ONE QueryRunner transaction BEFORE the
  status flip; permission approvals stamp roster_days.permission_type/duration; requester notified. Security: peer-accept
  forgery closed, requests self-scoped, L2 approver ≠ L1 approver.
- **Schedule module:** SQL-injection parameterized; editCell rest vs ADJACENT days (cross-midnight, both directions);
  female rule by shift END > 20:00 with logged override required; locked/soft-locked weeks enforced server-side;
  dual-write attendance_records + active roster_days (no ghost edits); break-coverage guard un-no-op'd (live fallback).
- **roster-v2:** publish/unpublish need `schedule.publish`; generateWeek = 2 spaced OFFs + males-first night; generateMix
  discloses `basis: replicates current schedule`; change/swap validated (female+rest) with is_active + dual-write.
- **⚠ OPEN FOR THE DIRECTOR:** (1) weekend definition conflict — generator says Thu/Fri/Sat, roster-v2 SQL says Fri/Sat:
  needs his ruling then one shared constant; (2) sign-off on the new fairness numbers before the next real publish;
  (3) generateMix → Erlang livePlan switch (flagged, not flipped); (4) headcount_intervals: write on publish vs retire;
  (5) Ramadan generator catalog; (6) half-day leave reflection (no half-day marker exists yet).

## 22. 2026-07-03 — Full audit cycle: A/S-suffix grammar, shared normalizer, Roster Health Check
- **THE suffix grammar (Director, binding):** ANY valid base shift + `A` = absence (no medical report, HR-Matrix `A`),
  + `S` = sick leave (medical report, HR-Matrix `SL`). Generic — EE20A/EE20S/M7-3A/M7-3S included. `ABS` is NOT an
  official code (legacy read-alias of `A` only; never emitted). A/S rows KEEP the base shift + timing for analysis;
  they count as scheduled-not-actual = unplanned shrinkage. L/H/COMP = planned shrinkage; OFF/RES/TER = not scheduled.
- **Shared normalizer:** `backend/src/common/shift-normalize.ts` (33-test spec) is the ONE code→(base, status, hrCode,
  WFH, HC flags, shrinkage type, timing, cross-midnight) mapping. Wired: schedule editCell (accepts suffix codes),
  timing-sheet import parser. Every new consumer must import it — never re-derive.
- **Manual-edit integrity:** editCell dual-write now carries presence/hr_code/attendance_code/shift_category into
  roster_days (was shift columns only → analysis/shrinkage/HR-matrix went stale after manual edits). `override:true`
  added to the DTO (was documented but unreachable). E2E verified N→NA→override→N.
- **Roster Health Check (generator must never leave the user blind):** generate-week now returns `health` — 7-day×24h
  Required/Scheduled/Effective grid (effective = scheduled × (1 − last-28-day sick/absent/leave rate, disclosed)),
  status colors, weekend Thu+Fri + night focus, totals, ACCEPTABLE verdict (no red hours AND ≥95%), ranked
  recommended actions. Saved in draft payloads; rendered on the Demand-Schedule page before publish.
- **Data repairs applied (scripts/fix-absence-holiday-and-permdur.js):** 11 legacy A-on-holiday rows presence
  holiday→absent (engine parity); June permission_duration backfilled 199/237 from the year-wide Odoo exports
  (38 unmatched = sources end 06-21/22; the full rebuild will complete them). permissionHrs 0→440.8 in analysis.
- **⚠ OPEN INCIDENT — June roster missing 24 people:** live roster_days June 1–27 = 103 people (2733 rows) but the
  source workbook `CC Schedule 26 May 30 and 31 and June to 27.xlsx` contains 120+ incl. Ali Muteb (12937), Hassan
  Saad (13827) etc. The corrected Jul-2 ingest (3084 rows) was later replaced by a rebuild from the older 103-person
  foundation. FIX = re-run the engine on the ORIGINAL workbook + full-June system sources (the SRCDIR June-named files
  currently hold the 28–30 test slices — restore/rename before refresh). Requires the Director per the test-first plan.

## 23. 2026-07-10/11 — Smart Break Management (Director's 32-section spec, EXECUTED)
Source of truth: **`SMART_DYNAMIC_BREAK_MANAGEMENT_PROMPT.md`** (repo root, commit 3d1d82e) — the Director's full
spec, executed R3 waves B1–B5 (commits 1801344 · 9cf3c0e · 033f373 · 0f5fa44). All rules below are **CONFIRMED**
(Director spec 2026-07-10) and live in `backend/src/modules/breaks/` + migration `database/migrations/079_break_policies_v2.sql`.
- **Daily entitlement = 4 sessions / 60 minutes**, CONFIGURABLE per function / shift type / employment type via the
  `break_policies_v2` matrix (NULL selector = wildcard; **most-specific-wins**: function=4 + shift=2 + employment=1
  score, `pickMostSpecificPolicy`). The default distribution ([15,15,15,15]) is a policy pattern, never hardcoded.
  Entitlement is enforced in BOTH request paths (breaks module + requests-module bridge) with a bilingual reject;
  an authorized override is possible but ALWAYS audited (`breaks.entitlement.override`) — **never silently exceeded**.
- **Protected first + last shift hour:** no AUTO break may start in the first 60 min or end within the last 60 min
  of the shift (`generationWindow`; both windows policy-configurable). A break inside a protected window requires a
  **manual exception request** with reason + coverage impact + authorized approval — and even manual approval must
  not exceed the daily entitlement without the separate audited override.
- **Function-level calculation:** every coverage/capacity/risk number is computed PER FUNCTION (canon_fn), never one
  global contact-center pool. Coverage floor source = `headcount_intervals` (auto-rebuilt in-process via
  `CoverageRebuildService` when empty for the date); when still empty the engine FALLS BACK to required=scheduled and
  **discloses** `coverageSource:'fallback'` — never a silent assumption.
- **Queue-aware release:** a break is released only when releasing ONE more employee keeps the function safe —
  current state (scheduled−onBreak vs required, live Sprinklr availability, queue waiting, SLA-risk queues) **plus the
  near-term forecast** (next-30-min required vs scheduled). Never the current queue count alone.
- **Explainable fair priority (§7/§22):** transparent score with a per-factor AR/EN breakdown
  (`{points, reason, reasonAr}`) shown to supervisor AND agent; weights configurable per policy
  (`thresholds.priority_weights`). **Penalties look at TODAY only** (recently-returned, above-median-sessions) —
  no permanent punishment; delayed employees gain priority (+1/min waited, capped) and keep it.
- **Anti-clustering (§9):** per-function per-15-min simultaneous-break cap (explicit `max_simultaneous` or computed
  scheduled−required−buffer) + per-`team_manager` cap (default 1) enforced at BOTH generation and live release
  (`antiClusterOk`). AS-BUILT honest scope: function + team caps only — skill/language/seniority clusters deferred.
- **Release modes (§13):** `auto` / `supervisor` / `hybrid` (auto for normal, supervisor-recommend for protected-window,
  entitlement-override or orange risk) / `freeze` (emergency — nothing releases). Red/critical risk = HOLD in every
  non-frozen mode. Mode changes go through `POST /breaks/engine/mode` and are **audited** (`breaks.engine.mode`).
- **Risk ladder (§23) + fail-safe (§30):** green → yellow → orange → red → critical with REASONS shown for every level
  (`riskAssess` simulates one more release). **Stale data never assumed safe:** snapshot >5 min old degrades the level
  one step (worse only, never better); >15 min or NO snapshot enforces an orange floor = supervisor-confirmation.
- **Delay transparency (§11):** a delayed break is never silently pending — status + delay reason + updated ETA are
  shown to the employee; the configurable escalation ladder (default 10/20/30/max-delay min, `delay_ladder`) notifies →
  raises priority → alerts the supervisor, restart-safe (stage dedup), audited (`breaks.delay.escalated`).
- **Start gated on release:** the agent's START button/endpoint returns 400 until the system releases the slot —
  an employee can never self-start an automatic break.
- **Return monitoring (§19):** reminder at end−5 min, `overdue` at end+5 min grace, actual minutes posted to
  `break_daily_balance` on return. Late returns are reportable; **future breaks are NEVER auto-extended to compensate**.
- **Cross-midnight dating:** a slot whose wall-clock start crosses midnight belongs to the NEXT calendar day
  (`planned_date`, `plannedDateFor` — fixed the date-loss bug, 4,985 slots backfilled).
- **Simulation never writes (§28):** `POST /breaks/simulate` dry-runs the SAME optimizer + the SAME `riskAssess`
  with scenario overlays (deterministic FNV-1a absence, queue spike, extra staff) — zero persistence proven
  (identical slot counts on double-run). UI badges every result "SIMULATION — not applied".
- **Deferred honestly (spec items not built):** occupancy/AHT/backlog risk inputs (no reliable feed), skill/language
  clusters, multi-day carry-forward fairness weighting, websocket push (45s engine tick + 30s UI poll instead),
  per-function live HC (Sprinklr agents not function-mapped — schedule spine + global live layer).
- **⚠ Rollout gap:** live `users.employee_id` links are missing (agents have no accounts) — accounts provisioning is
  deliberately the LAST pre-rollout step (Director 2026-07-11); see D-078.
