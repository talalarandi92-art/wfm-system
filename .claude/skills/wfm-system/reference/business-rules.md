# WFM business rules (confirmed)

These were dictated/confirmed by the WFM Director. Never violate in code. Newer clarifications
override older ones; real Timing-sheet data overrides assumptions.

## Week & shifts
- **Working week starts Saturday** (Sat→Fri).
- **Standard agent shift = 9h incl. 1h break.** Responsible/supervisor `20` codes = **8h**.
  **`*7` codes (b7 n7 m7 e7 md7 mn7 ee7) = 7h (maternity).** Ramadan `R` codes may be split shifts.
  `AM` = 8h (different from M9). Some shifts cross midnight.
- **Shift codes come ONLY from the real Timing sheet** — never hardcode just the first 8. Known
  suffixes/codes: `20`=supervisor 8h · `R`=Ramadan · `WFH*`=work-from-home · `S`=sick submitted ·
  `A`=absence · `OFF`=rest · `H`=holiday · `L`=annual leave · `SL`=sick scheduled · `DL`=death leave ·
  `COMP`=comp day · `RES`=resignation · `TER`=termination · `UPL`/`COV` if present.

## Real shift times (fixed 2026-06 to match `shift_codes` — do NOT invent times)
`M 07–16 · B 09–18 · C 11–20 (female boundary) · N 13–22 · E 16–01(+1) · EE 18–02(+1) ·
MD 22–07(+1) · MN 23–08(+1)`. **No real shift ends at 21:00.** (User flagged invented times before.)

## Female shift rule (FINAL — configurable, not hardcoded)
- Business coverage is highest priority. Females normally up to **C** (end 20:00).
- **N** (ends 22:00) only if operationally necessary (`'warn'` tier). **E/EE (end 01:00/02:00) and MD/MN are
  BLOCKED** — gate by the female-blocked CODE (E/EE/MD/MN), NOT the shift category (the "evening" category
  collapses to "day", which historically leaked E to females — fixed 2026-07-04 in ladder + generateWeek).
- `allowFemaleN` default **false** → females end by C. When enabled they may take **N only** (never E).
- **Females must ROTATE across their allowed set (M/B/C), not freeze on one shift** — a generator that pins a
  woman to a single code is a BUG (category-only fairness caused it; fixed with code-level fairness + a female
  rotation guard). Enabling `allowFemaleN` adds N to the rotation.
- Per-function exception: `femaleAllowLate: true` (e.g. **Outbound/OMT is all-female to 22:00** → splits B/N;
  Director accepted OMT women landing on B-only as a menu constraint, not a freeze bug).
- Per-generation runtime exception: `GeneratorOptions.femaleLateFunctionIds[]` (picked at generate time).
- Manual override allowed but MUST create a visible warning + audit log.

## Intern-fold (Director 2026-07-04) — "Internship X" IS the "X" team for headcount
- ONE helper **`canon_fn(text)`** (migration 068, strips a leading `Internship `) folds interns into the parent
  at every headcount / coverage / demand / pool / dropdown site. Per-person identity labels stay RAW;
  function_id/UUID-FK modeling surfaces (capacity Erlang inputs) stay granular. CH-WA pool 25→38.

## Manual edit / swap on a WORKED day → reset stale metrics
- `late/early/OT/adherence` in `roster_days` are plain columns computed against the shift window. A manual
  scheduleChange/scheduleSwap/scheduleRevert on a day with punch/login evidence must `staleMetricReset()` them
  (NULL/zero) so no report shows a wrong value; recon rebuild recomputes. (publish/approve instead SKIP worked days.)

## Per-function shift policy (`FUNCTION_SHIFT_POLICY`, substring match, covers Internship variants)
- **Outbound (OMT)** → only `B, N`. **Refund** → `M B C N E EE` (no MD/MN). Others (Inbound, CH-WA) → 24/7.
- Female rule AND function policy both apply (intersection). Restricted functions rotate their own
  allowed categories round-robin per week (not the global rotation) — fixed OMT collapsing to all-B.

## Male shift rule
Any shift per business need; only rest/fairness/coverage constraints.

## Rest rule
**Minimum 10 hours rest** between consecutive shifts; must handle cross-midnight (e.g. MD end 07:00
→ M start 07:00 = 0 rest = invalid; MD→EE20 = 11h = valid).

## OFF rules
- Default 2 OFF/week. **No 3+ consecutive OFF** (mid-week OFF avoids being adjacent to another OFF;
  caps cross-week runs at 2). Weekend-OFF fairness exact across weeks.

## Publish / lock
States: Draft → Generated → Reviewed → Published/Shared → Locked/Archived. **A published schedule
cannot be overwritten by a new Generate.** Manual edits after publish allowed by authorized users;
every edit → version history + audit + before/after impact (coverage, rest, female rule, shift-rate, HC).

## Shift Rate % (= shift DISTRIBUTION, not pay)
Per employee from year start: Morning/Day, Night, Evening, Midnight counts + %, YTD/month/period.
Show before/after for edits and for BOTH employees on a swap. **Fairness basis = PRE-SWAP** — approved
swaps are reversed before counting (`loadYtdDistribution(preSwap=true)`); swapping away your midnight
still counts as yours, so swaps can't game rotation.

## Permission / HC impact
Every permission approval shows a before/after matrix per interval/function: Required HC · Scheduled HC ·
On-Permission HC · Sick/Absent · Available-after-approval · Gap · Risk. Red warning if approval causes a gap.

## Erlang / capacity
Voice = **Erlang-C**. Chat/WhatsApp **concurrency = 4** per employee. Email = backlog/throughput.
Intern productivity default ≈ **70%** (configurable). Scenarios: base / shrinkage / OT / emergency.

## Generator nature
The active generator (`generateWeeklySchedule`, UI `/generate`) is **fairness/rotation-based, not
demand-based** (`generateDemandDriven` exists but is unused). Users must REGENERATE after fixes —
saved schedules go stale. It must show coverage gaps honestly (e.g. limited male-night pool).

## Reconciliation rules (codified in the engine — 2026-06-30)
Every rule lives in `backend/scripts/recon-build.js` so a refresh re-applies it (a rule left in the data gets wiped
on the next rebuild — the cause of recurring regressions).
- **Holiday-worked OT**: working a SCHEDULED shift on an official holiday → whole shift = `holiday_ot_min` (capped at
  net), regular OT=0, "Official Holiday — <name> (worked)". Holidays auto-detect from Odoo Status (eid/arafat/national
  day/hijri/…) date-wide + editable `recon-config.json`.
- **Master HR codes** (`hr_code`/`attendance_code`; HR-Matrix = `COALESCE(hr_code,attendance_code,shift_code,'OFF')`):
  sick→`SL`, absence→`A`, off→`OFF`, leave→`L`(DL/UPL kept), holiday→`H`, comp→`COMP`, sep→`RES`/`TER`, WFH-working→`WFH`,
  office-working incl. forgot-to-punch→shift code.
- **worked_min**: non-working presence credits only the validated OT session (no rest-day bleed); working ≤16h.
- **In-system upload = the corrected engine**: `recon-refresh` endpoint + Roster "Upload & Rebuild" button.
- **Schedule grid** overlays `roster_days` (corrected WFH/holiday/SL/A + canonical times); cell shows the shift code
  DIRECT, no `-WFH` suffix (WFH via 🏠 icon + dotted texture).
- **Jan–May already consistent** (verified by dry-run); no rebuild. June = recon engine.
- **OT / tardiness clamps (2026-07-05 audit hardening, commit a33fb22)** — the engine credits the scheduled NET
  worked, never the raw login→logout span (training: schedule=truth, logout bleeds). In `recon-build.js`:
  `otNetCap` = schedule net (fallback 480 std / 360 mother) caps holiday & off-day OT on EVERY path;
  `OT_CEIL=300` caps `ot_min` on every basis incl. punch-derived; `otEligible` blocks OT on
  absence/sick/sep/unmapped; cross-midnight `sys_late`/`sys_early` capped at `TARDY_CEIL=240` (>240 = logout
  bleed = DQ); OFF/holiday OT on login-only evidence gets a soft `data_quality` flag (never reversed);
  `recon-ingest.js` now maps `permission_status`. All enforce EXISTING agreed rules (BR-OT-003/004/001, BR-TRD)
  the engine under-applied — no new rule. **Most audit defects were STALE rows from older builds** (Jan–May =
  `import-roster-master.js`; older June recon) — a full rebuild on fresh sources clears them; route all months
  through recon. Always dry-run to a scratch table + diff before ingest (no blind rebuild).
