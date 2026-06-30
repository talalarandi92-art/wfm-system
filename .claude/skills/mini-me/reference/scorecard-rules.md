# Confirmed business rules (with dates)

Every rule here was dictated/confirmed by the WFM Director. Do not override without a new
explicit confirmation. Append new rules with their date.

## Metric definitions (2026-06-16)
- **RES** = customer feedback response rate.
- **PRR** = positive response rate (Yes ÷ responses).
- **CTR** = Contact-to-Ticket Rate = contacts received ÷ tickets created.
- **FCR** = resolution rate = closed ÷ total tickets.

## Productivity (formula confirmed; exact form decoded from May sheet 2026-06-17)
- `X = WD × 9h` (total) → `Y = X − ShortBreak` (productive) → `Z = Y/X` →
  `Productivity% = IF(sick=0→Z, sick=1→Z−2%, sick=2→Z−5%, else Z)`.
- Break subtracted = the **Short Break** column ONLY (per the user's `Y = X − Q`).
- Per **week** (WD and ShortBreak per week), Final = whole month.
- **Maternity / 7-hour shifts (2026-06-17):** shift codes `b7 n7 m7 e7 md7 mn7 ee7` = 7-hour
  shifts → those days count as 7h not 9h in the productivity total. Named mothers (Shaima Saoud,
  Haya Mohanna) are on these codes.
- **ShortBreak source per function (2026-06-17):** Inbound/Refund/Outbound ← Ameyo
  AGENT_Session_Details; CH-WA/Social/Email ← Sprinklr.
- Sick penalty intent was "2+ → −5%"; the sheet IF gives no penalty for sick>2 — replicate the
  IF but flag.

## Rounding (2026-06-17)
- Round-half-up every % to integer before banding (89.5→90, 89.4→89). Bar = lowest value that
  earns a score ("العتبة").

## Scope / functions (2026-06-17)
- Scorecard = frontline agents only. Exclude `/rta|leader|specialist|customer care|support/i`.
- `CH - WA` = Chat+WhatsApp (one). `Social Media & Email` = one.

## Channel sources (2026-06-17)
- April chat W1–W3 = Ameyo; W4 = Sprinklr. SM & Email = Sprinklr ONLY (never Ameyo). May = uniform Sprinklr.

## CTR / FCR peak overrides (2026-06-17)
- Sprinklr functions (CH-WA, Social/Email): CTR = 100% (bar); FCR = normal.
- Inbound/Outbound/Refund: CTR = bar AND FCR = bar.

## Bar applies on FINAL only — weeks are real (2026-06-17, refinement)
- Weekly rows (W1–W4) = the REAL computed value per criteria (weeks are review-for-improvement; if no
  real value exists, the cell is blank → no weekly score). The FINAL row carries the **bar** for the
  bar KPIs (CTR all funcs; FCR for voice/Refund) — the final evaluation is on Final.
- Add an Excel **cell note "bar score (reference)"** on the Final CTR/FCR cells (both SCORED and the
  template's W5/Final sheet).

## Quiz & Commitment (2026-06-17)
- May W1–W2 = bar (max). W3–W4 from files (+ New Joiners).
- Present but didn't solve quiz → note + **route the −5 through the Common Mistakes column** (set Common
  Mistakes = 1 → Mistakes Score = 15−5 = 10), because Common Mistakes IS in the Net formula (AA) while
  Attendance Score is NOT. Final Common Mistakes = total quiz-miss weeks. On leave → no penalty/note.

## On-leave weeks (2026-06-17)
- A week with **0 working days (WD=0)** in the Productivity sheet = on leave → **do NOT score it**: blank all
  KPI inputs for that week and put WFM Note "on leave — not scored this week". (Compare productivity / WD /
  attendance to decide.) Present (WD>0) → score normally.

## QA (2026-06-17)
- User-provided. Empty month → bar 0.95.

## Week structure (2026-06-17)
- W1 1–7 · W2 8–14 · W3 15–21 · W4 22→end · Final = whole month. W5 sheet = Final.
- Separate "WEEK 5" export (e.g. May 29–31) folds into W4.

## AHT (2026-06-17)
- Keep single 48h threshold for now; revisit after Sprinklr implementation.

## Notes & roster source (2026-06-17, fixes)
- **Template corruption ROOT CAUSE = exceljs re-emits the template's conditional formatting as EMPTY
  `<conditionalFormatting sqref=.../>` (no `<cfRule>`)**, which Excel rejects → "repaired/removed unreadable
  content" on the W-sheets. FIX: clear it before writing — `for (sn of W1..W5) wb.getWorksheet(sn).conditionalFormattings = []`.
  (It was NOT the cell notes/formulas.)
- Put WFM notes as PLAIN TEXT in a free helper column (Q/17 = "WFM Note") — clean and visible: Final rows →
  "bar score (reference)"; quiz-not-solved weeks → "didn't solve quiz (−5 commitment)".
- **FILLED template is the permanent FORM** (user adopts it for every month; we only change function names /
  formulas / add-remove KPIs as agreed). Keep SCORED simple/secondary.
- **Roster source must include new joiners:** the `<Month> SC 26` W1 sheet may lag (May W1 = 66 = April, but the
  Productivity sheet had 108 IDs + "New Joiners" quiz files). Build the month roster from the Productivity sheet
  (frontline only) so new hires are included — don't trust the template W1 list alone.

## Output (2026-06-17)
- Two files: self-scored SCORED + FILLED template (auto-scores on open). User wants KPI cells to
  carry derivation formulas referencing embedded raw-data tabs so every number is traceable.
- The design the user approved: one row per week + Final, value + score per KPI, colored Net Points.
