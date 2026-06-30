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
- Name whitespace is collapsed (`\s+`→space) on every read (double-space split one person into two).
- Match employees by **ID, never name-only**.

## 2. Time & Calendar
- **Week starts Saturday** (Sat→Fri). Use `fmtLocal` + `snapToSaturday`; never `toISOString()` for local dates
  (UTC off-by-one caused a 3-OFF/week bug).
- **Cut-off cycles:** full-time **15→14**, interns **1→end of month**, Bahrain **25→24**.
- **Permission balance renews per cycle: 6 hours + 3 permissions.** Only **Approved** permissions consume/exempt.

## 3. Shift Dictionary & THE ONE Canonical Shift-Category Mapping
**⚠ DRIFT TO FIX (audit): shift-category is currently defined 5+ conflicting ways** (by start-hour in
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
- **Tardiness/Early — credible only (`CRED_LATE`/`CRED_EARLY` = 1..240 min)**; cross-midnight bleed capped at
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
- **Male agents:** any shift per business need (subject to rest/fairness/coverage).

## 8. Rest, Rotation & Fairness
- **Minimum rest = 10h** between consecutive shifts (cross-midnight aware) unless manually overridden. Weekly
  rotation ⇒ ≥10h rest by construction.
- **`fairnessScore` = 100 − stdev** of night/midnight load over the fair pool. Optional **night-team carve-out**
  (fixed team vs fair distribution — user's choice, migration 065). **Weekend-OFF fairness** separately scored.
  Live snapshot: fairnessScore 79, weekend-OFF fairness 81.
- Rebalance proposal uses **current staff only**, female = night-only.
- Shift-rate % = distribution of each person's shifts YTD/MTD/period (count + %), with **before/after impact** on
  edit/swap. Exclude OFF/H/L/S/A/COMP from the working distribution.

## 9. Scorecard & Net Points
- Per-function KPI bands; **round-half-up** all %; productivity formula confirmed; sick-day penalty (1 sick −2%,
  2+ −5%); quiz-commitment −5 on unsolved-quiz weeks.
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
  - **Shift-category 5-way conflict** — one canonical mapping (§3) imported by all 5 sites; changes shift-rate %/fairness.
  - **Net-Points day-weighted join** (Custom Report Builder grouped scorecard) — aggregate at person grain; changes grouped averages.
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
