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
- **N** only if operationally necessary (`'warn'` tier). **MD/MN blocked.**
- `allowFemaleN` default **false** → females end by C unless a supervisor enables the late-shift toggle.
- Per-function exception: `femaleAllowLate: true` (e.g. **Outbound/OMT is all-female to 22:00** → splits B/N).
- Per-generation runtime exception: `GeneratorOptions.femaleLateFunctionIds[]` (picked at generate time).
- Manual override allowed but MUST create a visible warning + audit log.

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

## Attendance reconciliation (confirmed 2026-06-30)
- **Tardiness tolerance = > 6 min** (≤6 forgiven). `HR_MIN=7`; live `CRED_LATE/EARLY = BETWEEN 7 AND 240`.
- **Shift span = full gross (9h incl. break)** — system stays open during break, so "completed required hours"
  means login→logout span ≥ gross shift, NOT net 8h. Leaving early but logging 8h net = real early-out.
- **No-punch AND no-system working day → FLAG + `worked_min=0`** (`data_quality="No punch & no system login —
  verify (not auto-absent)"`), never the scheduled net. **Role-blind.**
- **ALL roles must open the system — leaders included** (supersedes the old "don't scrutinise leaders"). The
  `isExcludedRole` record-only (TL/Senior/RTA/Resolution/WFM) = exempt from tardiness/HR *deductions* ONLY, NOT
  from opening the system. Full leader tardiness scrutiny = separate open decision.
- Maternity-7h (12375/12434) excluded from early-out only. Approved permission covers late/early.
