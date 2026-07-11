# KPI Rules Decoded Directly From The Director's SC Workbooks

Source: `new folder/Scorecard 2026/1..6 .xlsx` (Jan–June 2026). Read with
`XLSX.readFile(path,{cellFormula:true,cellNF:true})`, inspecting `ws[addr].f`.
Authoritative = the sheet's own cell formulas (not manual score entries).

**Cross-workbook agreement:** For all 3 questions, every one of the 6 workbooks
carries **exactly one** formula variant, and it is **byte-identical** across Jan–June.
**No outliers.** The scoring formulas for Quality (col K), Quiz (col Y) and PRR
(cols N/O) are also **identical across every function block** inside each sheet
(CH-WA, Mail & NPS, Refund, Social Media, Inbound, OMT, Internship CH-WA, Internship Inbound).

The scored table lives in the `<Month> SC` sheet. Header row = row 13:
`J Quality | K Quality Score | L Response Rate | M PRR rate | N PRR Points | O PRR Bonus | P AHT | Q AHT Score | R Suc%-FCR | S FCR Score | T Product. | U Product. Score | V Call-to-Ticket | W CTR Score | X Quiz | Y Quiz Score | Z Common Mistakes | AA Mistakes Score | AB Incidents | AC Incidents Score | AD Attendance | AE Attendance Score | AF Response Time | AG Response Time Score`.
Each function is a stacked block reusing the same columns; raw KPI values are pulled by
`VLOOKUP(C#, 'W1'..'W5'!$B:$P, col, 0)` from the weekly pivot tabs.

---

## Q1 — PRR denominator: **Yes ÷ responses (NOT ÷ contacts)**

**ANSWER (uniform, all functions, all 6 months):** The scored "PRR rate" =
**Yes ÷ number of survey responses (Yes+No)** — i.e. positive rate *among responders*,
NOT divided by total contacts/handled. "Response Rate" is a **separate** column =
responses ÷ contacts.

**Evidence — scoring cells (`Jan 26 SC`!N14 / O14), identical every function:**
```
N (PRR Points): IF(AND(M14>=80%, L14>=10%), 2.5, 0)
O (PRR Bonus) : IF(AND(L14>=10%, M14>=80%), 2.5, 0)
```
- `M` = **PRR rate** = positive-among-responders (must clear 80%).
- `L` = **Response Rate** = responses ÷ contacts (must clear the 10% response floor).
- Max PRR contribution = **2.5 + 2.5 = 5 points**; it is gated on BOTH the rate ≥80% AND the response rate ≥10%.

**Evidence — the raw `PRR` tab (pasted values, arithmetic verified):**
Columns: `Closed | Grand Total | Grand Total RR | Yes | RES | BRR | FCR`.
- Row `a.alabdullah`: Closed 253, Grand Total RR (responses) 20, Yes 18 → **BRR = 18/20 = 0.90** and **RES = 20/253 ≈ 0.08**.
- Row `a.alanzy`: Closed 3, responses 1, Yes 1 → **BRR = 1/1 = 1.00**, **RES = 1/3 ≈ 0.34**.

So in the raw tab:
- **BRR = Yes ÷ (Yes+No responses)** → this feeds the scored **PRR rate** (col M). Denominator = responses.
- **RES = responses ÷ Closed contacts** → this is the **Survey Response Rate** → feeds "Response Rate" (col L). *(Confirmed: RES uses Closed, not Grand Total: 1/3=0.34, not 1/237.)*

**Conclusion:** PRR is scored on the positive rate whose denominator is the count of
survey responses (Yes+No). Survey Response Rate is a distinct column with denominator
= Closed contacts, used only as the ≥10% eligibility gate for PRR.

---

## Q2 — Quiz at exactly 95: **5 points (not 10)**

**ANSWER (uniform, all functions, all 6 months):** A quiz score of **exactly 95 → 5 points.**
Full 10 points require **strictly > 95**.

**Evidence — `Jan 26 SC`!Y14 (identical every block/month):**
```
Y (Quiz Score): IF(AND(X14>=90%, X14<=95%), 5,
                 IF(AND(X14>95%,  X14<=100%), 10,
                 IF(AND(X14<90%), -10, "")))
```
Boundary evaluation:
- **95.0 → 5** (matches first branch `>=90 AND <=95`).
- **90.0 → 5**.
- **94.9 → 5**.
- **95.1 (>95) → 10**.
- **< 90 → -10**.

So it is `>95 → 10, >=90 (through 95) → 5`. Max Quiz weight = **10**.

---

## Q3 — QA/Quality bar: **95% for full points (bar is NOT 0.80)** — uniform across all functions

**ANSWER (uniform, all functions, all 6 months):** The Quality (QA) bar for **full 30 points is 95%**.
80% is only a lower positive band (+10). It does **not** differ by function — identical formula in every block.

**Evidence — `Jan 26 SC`!K14 (identical every block/month):**
```
K (Quality Score): IF(AND(J14>=95%), 30,
                    IF(AND(J14>=90%, J14<95%), 20,
                    IF(AND(J14>=80%, J14<90%), 10,
                    IF(AND(J14<=80%, J14>=65%), -10,
                    IF(AND(J14<65%), -20)))))
```
Bands:
| Quality (J) | Points |
|---|---|
| ≥ 95% | **30** |
| 90–<95% | 20 |
| 80–<90% | 10 |
| 65–≤80% | −10 |
| < 65% | −20 |

Max Quality weight = **30**. (Note the mild overlap at exactly 80%: `>=80 & <90 → 10`
is checked before `<=80 & >=65 → -10`, so 80.0% resolves to **+10**.)

---

## Harvested weights table (max points per KPI = the built-in weights)

Net Points (col **H**) formula, identical in every block/month:
```
H = K + N + O + Q + S + U + W + Y + AA + AG
  = Quality + PRR_pts + PRR_bonus + AHT + FCR + Productivity + CTR + Quiz + Mistakes + ResponseTime
```
`AC (Incidents Score)` and `AE (Attendance Score)` exist as columns but are **NOT** summed
into Net Points. `G (Working Days%)` is a raw eligibility field, not scored.

| KPI (score col) | Max pts | Bands / rule (verbatim source) | Varies by function? |
|---|---|---|---|
| Quality / QA (K) | **30** | ≥95→30, 90–95→20, 80–90→10, 65–80→−10, <65→−20 | No — identical all fns |
| PRR Points (N) | **2.5** | PRR rate ≥80% AND Resp-rate ≥10% → 2.5 else 0 | No |
| PRR Bonus (O) | **2.5** | same gate → 2.5 else 0 | No |
| AHT (Q) | **15** (Email 10) | **band shape differs by function** — see below | **Yes** |
| FCR / Suc% (S) | **20** | <P4→−10, P4–P3→5, P3–P2→10, ≥P2→20 (thresholds in ref block cols P/R rows 2–4) | No (shared threshold block) |
| Productivity (U) | **15** | =R2→15, =R3→10, =R4→5, ≤R6→−15 | No |
| Call-to-Ticket (W) | **10** | T4–T3→5, ≥T2→10, <T4→−10 | No |
| Quiz (Y) | **10** | >95→10, 90–95→5, <90→−10 | No |
| Common Mistakes (AA) | **15** | 0 mistakes→15, else 15−(count×5) | No |
| Response Time (AG) | **15** | band shape differs by function — see below | **Yes** |
| Incidents (AC) | tracked, **not in Net Points** | — | — |
| Attendance (AE) | tracked, **not in Net Points** | — | — |

**Theoretical Net-Points ceiling** ≈ 30+2.5+2.5+15+20+15+10+10+15+15 = **135** (AHT/RT dependent).

### AHT (Q) — the one KPI whose bands genuinely differ by function
- **CH-WA / Internship CH-WA:** `IF(P<=$N$7,15, P>N7&<N6→10, >=N5&<N4→5, >N4→−5)` (chat AHT-seconds band block in cols N).
- **Inbound / Internship Inbound:** `IF(P>=$O$3&<=$O$6,15, >O6&<=O2→10, >O2&<O8→0, <O4&>=O8→−10, >=O4&<O3→5, <O4→−10)`.
- **OMT:** `IF(P>$O$3,−5, P<$O$5→10, >=O5&<=O3→5)`.
- **Mail & NPS (Email):** `IF(P="","", IF(P*24<=48,10,−10))` → **48-hour case SLA, max 10 pts** (not a time-of-day AHT).
- **Refund:** no AHT scored (KPI absent for the block).

### Response Time (AG) — also function-specific
- **CH-WA / Internship CH-WA:** `IF(AF>$AF$4,−10, <AF4&>AF3→5, <=AF3→10)` → max **10**.
- **Mail & NPS:** `IF(AF<=TIME(1:00),15, <=2:00→10, <=4:00→5, else −15)` → max **15**.
- **Social Media:** 5-band `IF(AF<=$AF$5,15, ..AF6→10, ..AF7→5, ..AF8→−5, >AF8→−15)` → max **15**.
- **Inbound / OMT / Refund:** no Response-Time score in the block.

Threshold reference cells (the "bars written in the sheet") live in the top-left block of
the SC sheet, rows 2–8, cols N/O/P/Q/R/S/T/AF (e.g. `$N$5..$N$7` chat AHT, `$O$2..$O$8`
inbound AHT, `$P$2..$P$4` FCR, `$R$2..$R$6` productivity, `$T$2..$T$4` CTR, `$AF$3..$AF$8`
response-time). These are numeric constants, not formulas — they are the editable bars.

---

## Bottom line for the skill's 3 ambiguities
1. **PRR** = Yes ÷ survey responses (Yes+No). Response Rate (responses ÷ contacts) is a separate column and only a ≥10% gate. Max 5 pts.
2. **Quiz 95 = 5 pts.** 10 pts needs strictly >95.
3. **QA bar = 95% → 30 pts, uniform for every function** (80% is just the +10 band). It does not vary by function.
4. Weights are **not** "all 1" — each KPI carries a built-in max-point weight (Quality 30, FCR 20, AHT/Prod/Mistakes/RT 15, CTR/Quiz 10, PRR 5). Table above.
5. **No workbook disagrees** — all 6 months carry one identical formula set; nothing to override.
