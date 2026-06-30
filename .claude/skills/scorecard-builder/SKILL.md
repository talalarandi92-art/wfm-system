---
name: scorecard-builder
description: >-
  Build or regenerate the monthly Contact-Center performance Scorecard Excel for
  Boutiqaat WFM. Use whenever the user asks to build/produce/score a month's
  scorecard, KPI scorecard, "السكور كارد", agent performance scoring, Net Points,
  or to fill the <Month> SC template from raw Sprinklr/Ameyo/Inbound/Outbound/
  survey/quiz/QA exports. Encodes the exact per-function KPI bands, rounding,
  productivity formula, quiz-commitment and maternity rules, and source file map.
  Produces two Excel outputs: a self-scored SCORED workbook and a FILLED template.
---

# Scorecard Builder

This skill rebuilds the Boutiqaat Contact-Center monthly **Scorecard** end-to-end from
raw operational exports, applying the user's exact, confirmed scoring rules. It is the
single source of truth for *how the scorecard is computed*. Invoking it should rebuild a
full month's scorecard with **no further instruction** from the user.

The user is the WFM Director. These rules were dictated and verified by them over many
sessions. **Do not invent or "improve" a rule.** If a value or source is genuinely
missing, surface it and use the documented fallback (usually "bar") — never guess silently.

---

## 0. What it produces

For a given month, generate two files into `My work/<Month> SC & ...>/` (or alongside the
source files):

1. **`<Month> 26 Scorecard - SCORED.xlsx`** — self-contained. Sheet `<Month> SC` has, per
   agent, one row per week (W1–W4) + a `Final` row, with every KPI **value** and its
   computed **score**, plus **Net Points** (colored: green=Final, yellow=week, red ≤0).
   Plus raw-data audit tabs (see §7).
2. **`<n>.<Month> 26 SC - FILLED.xlsx`** — the user's own template with sheets W1–W5
   filled by ID; the template's VLOOKUP+IF formulas auto-score on open
   (`calcProperties.fullCalcOnLoad = true`).

The generator is `scorecard-gen.js` in this skill folder (parameterized by month). Run it
with Node from the `backend/` dir (it has `xlsx` + `exceljs`). **Close the output files in
Excel before re-running** (Windows EBUSY lock).

Always finish by running `scorecard-audit.js` (this folder) and report the audit result.

---

## 1. Scope: who is scored

Frontline agents **only**. **Exclude** support/management roles — match
`/rta|leader|specialist|customer care|support/i` on Function (this is `isSupportFunc`).
Excluded: Team Leader, RTA, Customer Care, Support, Specialist.
Included: Inbound, Outbound, CH - WA, Social Media & Email, Refund, OMT, Internship*.

**Function consolidation:**
- `CH - WA` = Live Chat + WhatsApp = ONE function (CSAT/survey combined).
- `Social Media & Email` = ONE function (emails + social together).

---

## 2. Week structure (calendar-based, NOT Sat–Fri)

- W1 = days 1–7 · W2 = 8–14 · W3 = 15–21 · **W4 = 22 → month-end** · **Final = whole month**.
- The template has rows: weeks 1,2,3,4 + a `Final` row per agent. VLOOKUP maps
  W1→wk1 … W4→wk4 and the **W5 sheet = Final**.
- When a month has a separate "WEEK 5" export (e.g. May 29–31), it belongs to **W4**
  (because W4 = 22→end) unless the user says otherwise. Final = aggregate of the whole month.

---

## 3. CRITICAL — rounding (round-half-up)

Round every **percentage** KPI to a whole integer **round-half-up** (≥.5 → up; <.5 → stays:
89.69→90, 89.4→89, 89.5→90) **before** applying the score band. `Math.round(v*100)` does this
for positive percents. Applies to ALL %: Productivity, Quality/QA, FCR, CTR, RES, PRR, Quiz.
The bar/threshold = the **lowest value that still earns a given score** ("العتبة").

---

## 4. Exact score bands (decoded from the template IF-formulas)

All inputs are fractions (e.g. 0.95) unless noted; round-half-up first.

| KPI | Bands → points |
|-----|----------------|
| **Quality (QA)** | ≥95→30 · 90–94→20 · 80–89→10 · 65–79→−10 · <65→−20 |
| **PRR** (two cells: PRR Points + PRR Bonus) | each = 2.5 if `PRR≥80% AND RES≥10%` else 0 (both pass = 5) |
| **AHT** | `hours ≤ 48 → 10 else −10` (single 48h threshold; keep at 48 until Sprinklr revision) |
| **FCR** | ≥85→20 · 80–84→10 · 75–79→5 · <75→−10 |
| **Productivity** | ≥91→15 · =90→10 · =89→5 · 87–88→0 · ≤86→−15 |
| **CTR** | ≥95→10 · 90–94→5 · <90→−10 |
| **Quiz** (stored as fraction pts/100) | 95–100→10 · 90–94→5 · <90→−10 |
| **Common Mistakes** (count) | `15 − (n×5)`; 0 mistakes → 15 |
| **Response Time** (FRT, day-fraction) | ≤1h→15 · ≤2h→10 · ≤4h→5 · else −15 |
| **Commitment** | see §6 (quiz-commitment deduction) |

**Net Points** = QualityScore + PRRPoints + PRRBonus + AHTScore + FCRScore + ProdScore +
CTRScore + QuizScore + MistakesScore + RespTimeScore (+ CommitmentScore when present).

---

## 5. Productivity — the user's exact formula (decoded from May Productivity sheet cols X/Y/Z/AA)

Per agent **per week** (and Final = whole month):

```
X  = WD × 9h            total worked hours   (WD = work days that week)
Y  = X − ShortBreak     productive hours      (break subtracted = the "Short Break" column ONLY)
Z  = 100% − (X−Y)/X  =  Y / X                 raw productivity
Productivity% = sick penalty on Z:
     sick=0 → Z ;  sick=1 → Z−2% ;  sick=2 → Z−5% ;  sick>2 → Z   (matches user's IF)
```

- **7-hour (maternity) shift codes:** any day whose shift code is a `*7` variant —
  `b7, n7, m7, e7, md7, mn7, ee7` — counts as **7 hours**, not 9. So compute total per week as
  `Σ(daily hours)` where a `*7` day = 7h and a normal day = 9h (equivalently WD×9 minus 2h per
  7-code day). The named mothers (Shaima Saoud, Haya Mohanna) are scheduled on these `*7` codes.
- **ShortBreak source is per FUNCTION** (must be per week, not the monthly total):
  - **Inbound, Refund, Outbound** → Ameyo **AGENT_Session_Details** (break reason/duration).
  - **CH - WA, Social Media, Email** → **Sprinklr** occupancy/break export.
  The user supplies these files at build time.
- WD per week comes from the schedule / Productivity blocks (each W-block has a WD column).
- **Known quirk:** the user's IF gives no penalty for sick>2 (likely an oversight; intent was
  "2+ → −5%"). Replicate the IF as written so the FILLED file matches their sheet, but flag it.

---

## 6. Quiz & Commitment rules

- **Quiz source:** weekly MS-Forms files (Email, Name, Total points/100, function). Match by
  email-local OR agent name (space/spelling-tolerant). Quiz is stored as a **fraction** (pts/100).
- **Weeks with no quiz file** (e.g. May W1–W2): everyone gets the **bar** (max quiz score).
- **Commitment deduction:** an agent who was **present but did NOT solve** that week's quiz →
  **−5 on Commitment** AND add an Excel **cell note** "didn't solve quiz" on that week's Quiz cell.
  **First check leave:** if the agent was on leave that week → **no deduction, no note**.

---

## 7. KPI sources & per-function overrides

**Matching:** by **ID** for voice (Inbound/Outbound) and QA; by **agent name**
(space/spelling-tolerant) for Sprinklr Case-Assignments, survey, and quiz.

**Sources:**
- **Voice AHT** (Inbound/Outbound = OMT/voice funcs): "Avg. Handling Time" from the agent's
  **own channel** (Inbound-function ← Inbound.xlsx, Outbound ← Outbound.xlsx). Stored as
  day-fraction, cell format `[h]:mm:ss`. Filter rows to the month, bucket by week via Interval Start.
- **Chat (CH - WA):** if the month was on Ameyo for early weeks (e.g. April W1–W3) use the
  CHAT AMEYO file (Total Chat Duration + FRT, split by Chat Time date); weeks on Sprinklr use
  Case-Assignments. May = uniformly Sprinklr.
- **Social Media & Email:** Sprinklr **only** — never use Ameyo for this function.
- **Case-Assignments (Sprinklr):** header row found by exact cell `=="social network"`; columns
  by name: Last Engaged User, Case Count, First Response Time, First Contact Closure (FCR), and
  prefer **"Avg. Handling Time"** (NOT the "(Case)" variant). Aggregate per agent across social
  networks weighted by case count. FCR string like "100%" → 1.
- **RES/PRR:** Sprinklr survey (Yes/No "able to resolve" + response count) per week when available;
  else Ameyo feedback (feedback1 Yes/No). Scorecard: ResponseRate = RES, PRRrate = positive rate.
- **QA & Quiz:** user-provided files. If a month's QA sheet is empty → use the **bar** (0.95) unless
  the user provides QA.

**CTR / FCR peak-period overrides (confirmed):**
- **Sprinklr functions (CH - WA, Social/Email):** CTR = **100% (bar)**; FCR = **normal/computed**.
- **Inbound, Outbound, Refund:** CTR = **bar** AND FCR = **bar** (tickets weren't opened in peak).
- "bar" = the max score value for that KPI's band (FCR bar=0.85, CTR bar=0.95, QA bar=0.80).

**Audit tabs (embed in SCORED + ideally formula-reference from the W-sheets):** per agent × week
raw values — Voice (AHT/connected), Chat-SM-Email (cases/FCR/FRT/AHT), Survey (RES/PRR Yes/No),
Quiz, Productivity (WD / ShortBreak / X / Y / Z / sick). The user wants to **trace every number**:
each KPI cell should be a formula (`=AVERAGEIFS('DATA-…'!…)`, `=VLOOKUP(…)`) pointing at these tabs.

---

## 8. Run procedure

1. Confirm the month and that source files are present (see `reference/file-map.md`).
2. Set the month config at the top of `scorecard-gen.js` (month index, source filenames,
   output names, quiz-bar weeks, QA source/bar).
3. `node scorecard-gen.js` from `backend/`.
4. `node scorecard-audit.js` — must report **0 issues**; investigate any before delivering.
5. Report: file paths, agent count, and the audit summary. Flag any documented gap
   (missing QA, sparse survey week, AHT scale mix, sick>2 quirk).

---

## 9. Reference files

- `reference/scoring-bands.md` — the bands again, with the raw IF-formula provenance.
- `reference/file-map.md` — every source file, its sheet/columns, and which KPI it feeds.
- `reference/rules-confirmed.md` — the full list of user-confirmed business rules + dates.
- `scorecard-gen.js` — generator. `scorecard-audit.js` — independent verifier.

Keep these in sync whenever the user confirms a new rule. This skill is teachable to other
agents (e.g. Hermes): the SKILL.md + reference + scripts are fully self-describing.
