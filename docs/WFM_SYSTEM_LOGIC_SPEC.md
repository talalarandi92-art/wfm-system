# WFM Platform — System Logic & Business Rules Specification
### Boutiqaat Contact Center · Workforce Management Directorate
### How the platform actually decides what it decides

---

## 0. How to read this document

This is not a wish list. Every rule and every formula below is **implemented and running** on
live data. The document exists so that anyone integrating with, extending, or auditing the
platform works from the same definitions the engine uses — and so that no second system
quietly adopts a different one.

Three principles govern everything that follows:

1. **Rules live in the engine, never in the data.** A value corrected by hand in a table is
   erased by the next rebuild. Every rule is re-applied on every run, which is what makes the
   whole history reproducible from a folder of source files.
2. **Ambiguous evidence never becomes an accusation.** Where the platform cannot tell what
   happened, it flags the day for a human. It does not guess, and it never records an absence
   by inference.
3. **A number must be able to explain itself.** Every figure the platform publishes can be
   re-derived from its stored inputs, and the platform says so when it cannot.

---

## 1. Foundations — the conventions everything else depends on

| Convention | Definition |
|---|---|
| **Week** | Saturday → Friday. All weekly aggregation, OFF balance and rotation use this boundary. |
| **Cut-off cycles** | Full-time 15→14 · Interns 1→end of month · Bahrain 25→24. Overtime and permission balances settle by cycle, not by calendar month. |
| **Cross-midnight ownership** | A shift crossing midnight belongs **entirely to the day it started** — for attendance, overtime, permissions, leave, swaps and every request type. |
| **Identity** | The person key is `person_no`. An intern 6xxxx ID and a later full-time 1xxxx ID collapse to one person. Matching is by ID; **never by name**. |
| **Function** | Determined per month from the schedule, not from a static employee record — people move between functions. |
| **Time storage** | Minutes from local midnight. A value above 1440 means the following calendar day. |

### 1.1 Shift durations

| Population | Duration |
|---|---|
| Standard agent | **9 hours including a 1-hour break** (net 8) |
| Supervisory / `20`-series | 8 hours |
| Ramadan | 7 hours; some split shifts |
| Maternity (protected) | 7-hour window |

**The gross span including the break is the yardstick**, not the net hours. The agent stays
logged in through the break, so a 9-hour shift requires a 9-hour session. Measuring against 8
would mark every complete shift as one hour short.

### 1.2 Canonical shift windows

`M 07–16 · B 09–18 · C 11–20 · N 13–22 · E 16–01 · EE 18–02/03 · MD 22–07 · MN 23–08`
`M7-3 07–15 · M20 08–16 · B20 10–18 · C20 11–20 · N20 14–22 · CCNO 09–17`

The `EE` family is **role-dependent**: an agent works 18:00–03:00 (9h), an administrator
18:00–02:00 (8h). No real shift ends at 21:00 — a 21:00 end is a data error.

The workbook Timing sheet is the only shift-code dictionary. Codes are never hard-coded to a
subset.

---

## 2. Schedule generation

The generator answers one question: **given the demand, who works which shift on which day,
without breaking a rule and without treating anyone unfairly?**

It runs in five stages. Each stage may reduce the options available to the next, and the
generator reports honestly when the remaining options cannot satisfy demand.

### 2.1 Stage 1 — Demand becomes required headcount, hour by hour

Forecast volume per function is converted to a required headcount **per hour**, not per shift:

| Channel | Model |
|---|---|
| Voice / inbound | **Erlang-C** — volume, AHT, target service level, target answer time, occupancy ceiling |
| Chat / WhatsApp / social | Concurrency-adjusted workload — **concurrency = 4** conversations per agent |
| Email | Backlog and throughput — backlog, incoming volume, AHT, SLA target, available hours |

Each result is then adjusted for **shrinkage** and for **intern productivity** (interns are
not equal to full-time agents; the factor is configurable, default ≈ 70%).

The output is an hourly requirement curve per function. **The shift mix is derived from that
curve** — the generator does not start from a fixed pattern of shifts and hope it fits.

### 2.2 Stage 2 — OFF-day fairness

Each employee receives **exactly 2 OFF days per week**. Two constraints shape their placement:

| Constraint | Rule |
|---|---|
| Never 3+ consecutive OFF | Long idle blocks are not rest, they are lost capacity and they distort the following week |
| Weekend distribution is measured, not assumed | Friday and Saturday are the desirable days. Without an explicit rule the same people absorb every mid-week OFF |

**The fairness measure:** for each employee, count the weekend OFF days received over the
rotation window. The generator distributes so that this count converges across the pool. A
person who received a mid-week OFF pair last week is prioritised for a weekend pair next.

OFF placement is decided **before** shift assignment, because an OFF day removes a person from
the coverage pool for that day and every subsequent calculation depends on knowing who is
available.

### 2.3 Stage 3 — Shift fairness

Night and midnight work is the burden that accumulates unevenly. The platform measures it
explicitly.

```
fairnessScore = 100 − standard deviation of (night + midnight) load
                       across the FAIR POOL
```

**The fair pool is the critical qualifier.** Employees permanently assigned to a night team are
carved out of the calculation. Including them would inflate the standard deviation and make a
perfectly fair rotation look unfair — and worse, would push the generator to "correct" an
imbalance that is contractual rather than accidental.

Two further rules protect the measure:

- **The fairness basis is the PRE-SWAP schedule.** An approved shift swap never rewrites the
  fairness history. Otherwise two colleagues could swap repeatedly to launder night load.
- **Female agents are included in rotation fairness.** An early version of the generator held
  women on a single shift because the female-shift rule narrowed their eligible set and the
  fairness pass then had nothing to rotate. The result was that the people the rule was written
  to protect were the only ones who never rotated. Both engines now rotate within the eligible
  set, and no agreed rule was changed to achieve it.

### 2.4 Stage 4 — Eligibility and rest constraints

Applied as hard filters during assignment:

| Rule | Statement |
|---|---|
| **Minimum rest** | **10 hours between consecutive shifts**, computed across midnight. MD ending 07:00 followed by M starting 07:00 is zero rest and invalid. MD ending 07:00 followed by EE20 at 18:00 is 11 hours and valid. |
| **Female shift rule** | Up to the **C shift, ending 20:00**. The **N shift only where operationally necessary**, and always flagged. **MD/MN never assigned** except by an explicit, logged, audited manual override. Configurable — never hard-coded. |
| **Male agents** | Any shift, subject only to rest, fairness and coverage. |
| **Skill** | An agent is only assigned to a function they are skilled for. Skill expiry is tracked and alerts before it lapses. |
| **Availability** | Approved leave, sickness and separation remove a person from the pool. |

### 2.5 Stage 5 — Rotation shape

Rotation is deliberately **humane** rather than mathematically optimal:

- Night work is assigned in **blocks of 2–3 consecutive days**, not scattered singles. A single
  night between day shifts costs more sleep disruption than three nights together.
- **A full OFF block follows each night block.**
- Rotation patterns (for example M → N → B → C) are configurable per group, with defined cycle
  length and allowed shifts per group.
- Where a target shift would violate a rule, the generator selects the **closest valid
  alternative** rather than discarding the rotation.

### 2.6 Honest gaps

Where coverage cannot be met, the generator publishes the shortfall rather than concealing it.
For each gap it reports: **the interval, the function, the size of the gap, the reason, and the
available remedies** — cross-skill movement, overtime, shift-mix change, or an approved
exception.

This matters because the constraint is often real. Testing found that midnight coverage can be
mathematically impossible when the eligible male pool is too small — a schedule that looked
complete would have been a lie, and the honest output is what triggers a hiring or cross-skill
decision instead.

### 2.7 Lifecycle

```
Draft → Generated → Reviewed → Published → Locked
```

A **published schedule is never overwritten by a new generation run.** Post-publication edits
are permitted for authorised users and each one produces: rule validation, a version history
entry, an audit record, and a **before/after impact view** covering coverage, rest, the female
rule, shift-rate distribution and interval headcount.

---

## 3. Shift Rate — shift distribution

**Shift Rate is not a pay rate.** It is the distribution of shift types an employee has worked
from the start of the year to a selected date. It is a fairness instrument.

| Category | Codes |
|---|---|
| Morning / Day | M, B, C, AM, their `20` variants, WFH-M, WFH-B, M7-3, B7 |
| Evening | E, EE20 |
| Night | N, N20, WFH-N |
| Midnight | MD, MN, MDR, MNR |

OFF, holiday, leave, sick and absence are **excluded from the working distribution** and
tracked separately.

Reported as both count and percentage — year-to-date, month-to-date, and for a selected period.
Every edit or swap shows the **before/after impact for both employees involved**:

```
Before:  Morning 42 · Night 8 · Evening 5 · Midnight 18
After :  Morning 41 · Night 8 · Evening 5 · Midnight 19     (C changed to MD)
```

This is the mechanism that makes an unfair pattern visible at the moment it is created, rather
than at the end of the year.

---

## 4. Attendance reconciliation — how a day is judged

Each working day has up to two independent witnesses: the **biometric punch** and the **system
session**. They are combined, never treated as interchangeable.

### 4.1 Witness selection

- Both systems are combined (historically Ameyo ∪ Sprinklr; Sprinklr alone from July 2026).
- The **system login/logout is the official basis** for lateness and early departure.
- The punch corroborates physical presence and is measured on a different ruler.
- Sprinklr timestamps are **local Kuwait time, not UTC**.

### 4.2 Tardiness

| Rule | Value |
|---|---|
| Tolerance | **6 minutes.** At or below, nothing is counted |
| Credible late-in / early-out | **7 to 240 minutes** |
| Above 240 on a cross-midnight shift | Session bleed, not tardiness — capped and flagged |
| Overtime ceiling | 5 hours per occasion; above 2 hours requires review |

**Only an approved permission excuses lateness or an early departure.** A pending permission
routes to manual review. An approved permission **never lowers conformance** — the minutes it
covers are credited back.

Note a distinction the engine keeps carefully: an approved permission **credits** minutes back;
the maternity rule **stops them being charged** but grants no credit — it shortens the measured
window instead. Collapsing the two costs a protected employee real points.

### 4.3 Conformance

```
conformance = 100 × min(overlap + permitted, paid) ÷ paid

  paid      = scheduled window   (capped at 7h for maternity-protected employees)
  overlap   = the part of the system session that falls inside the scheduled window
  permitted = raw minutes forgiven by an approved permission or comp-off
```

Both the raw (pre-forgiveness) and the charged (post-forgiveness) tardiness are stored, so a
100% day resting on a 39-minute-late login can be re-derived and explained rather than merely
asserted.

### 4.4 The absolute rule

> **A working day with neither a punch nor a system session is FLAGGED for human review.
> Worked minutes are recorded as zero. It is never automatically recorded as an absence, and
> this applies to every role without exception.**

Supervisory roles (Team Leader, Senior, RTA, Resolution Specialist, WFM) are **record-only for
deductions**: their attendance is tracked and visible, but no deduction is computed from it.

### 4.5 Working from home

> **WFH is concluded from a WFH shift code, an explicit WFH location, or an Odoo WFH status —
> never inferred from "system login but no punch".** That pattern describes an office day with
> a missing punch.

### 4.6 Arbitration when the systems disagree

Where the schedule says a person worked and the HR system says the day was off, **neither is
allowed to win automatically.** The day enters a decision queue for a human.

A recorded human decision settles **which system was right about whether the day was worked**.
It does not, and cannot, supply evidence of **how the person performed**. A day confirmed as a
working day but carrying no evidence leaves the queue and remains unscored. The two gates
compose; they never collapse into one.

Decisions are stored separately from the data and re-applied on every rebuild, so they survive
regeneration instead of decaying into a one-off edit.

### 4.7 Overtime

```
TRUE_OT = ot_min + offday_ot_min + holiday_ot_min
```

Three **disjoint** buckets, always summed, never subtracted. Reading the first alone
under-counts by roughly a quarter.

| Rule | Statement |
|---|---|
| Holiday work | A scheduled shift worked on an official holiday becomes **wholly holiday overtime**, capped at the scheduled net. Regular OT is zero for that day |
| Evidence requirement | Off-day and holiday overtime must be evidence-backed. A system login with no punch is flagged, not credited |
| Suppression | Absence, sickness and separation suppress all overtime buckets |

---

## 5. The HR Matrix

The HR Matrix is the month-grid HR reads: one row per employee, one column per day, one code
per cell. It is the most consequential single view in the platform, because a wrong cell is a
wrong statement about a real person's record.

### 5.1 How a cell is resolved

```
cell = COALESCE(hr_code, attendance_code, shift_code, 'OFF')
```

The precedence is deliberate:

1. **`hr_code`** — the HR system of record's determination (leave, sickness, absence, holiday).
   It outranks everything, because HR owns those categories.
2. **`attendance_code`** — the raw cell from the operational sheet, preserved verbatim,
   including shift-aware compound codes such as `MS` (morning + sick) or `MA` (morning +
   absence).
3. **`shift_code`** — the planned shift.
4. **`OFF`** — the default for a day with no other statement.

### 5.2 Code vocabulary

| Code | Meaning |
|---|---|
| `SL` | Sick leave — **never invent `P`** |
| `A` | Absence |
| `L` | Annual leave |
| `H` | Official holiday |
| `DL` | Death leave |
| `COMP` | Compensatory day |
| `OFF` | Weekly rest day |
| `RES` / `TER` | Resignation / termination |
| `S` / `A` suffix | Sick submitted / absence, attached to a shift code |

### 5.3 The rules that govern the Matrix

| Rule | Statement |
|---|---|
| **Leave landing on a holiday** | Counts as the **holiday**, and the leave day **returns to the balance**. The cell reads `H`; the balance calculation subtracts holidays from the leave span |
| **Raw codes are preserved** | The shift-aware compound (`MS`, `MA`) stays in `attendance_code` even when `hr_code` overrides the displayed cell — the original statement is never destroyed |
| **Arbitration flows through** | Where Odoo settles a disputed day, `hr_code` follows that verdict; the raw cell is still preserved underneath |
| **Never wrongly punish** | A day with ambiguous evidence appears as a **flag for review**, not as an absence. The Matrix must never be the place a person first learns they were marked absent by a machine |
| **Maternity protection** | The 7-hour window applies in the early-out count, the conformance denominator **and** expected hours — all three, or the protected employee is penalised in whichever one was missed |

### 5.4 Verification

The Matrix is cross-checked against the reconciled roster on every rebuild. A contradiction
between what the Matrix displays and what the roster computed is treated as a defect in the
engine, not as a discrepancy to be explained away.

---

## 6. Permission impact on coverage

Before a permission is approved, the approver is shown the consequence.

For each affected interval and function:

| Column | Meaning |
|---|---|
| Required HC | From the demand model (§2.1) |
| Scheduled HC | Who is rostered |
| On permission | Already granted |
| Sick / absent | Known losses |
| **Available after approval** | What remains if this is granted |
| **Gap / surplus** | The consequence |
| Risk level | Severity of the resulting shortfall |

The purpose is not to block the approver — operational judgement stays with them. The purpose
is to ensure the decision is made with its cost visible, and that the decision and the figure
shown at the time are both recorded.

---

## 7. Requests, approvals and audit

### 7.1 Structure

A single request envelope with type-specific extensions. Types include permission, sick leave,
annual leave, death leave, compensatory day, shift swap, OFF swap, overtime, break, WFH,
university-student arrangement, technical issue, outage escalation, coaching and schedule
exception.

Every request carries: requester, type, status, submission timestamp, approver chain, SLA,
before/after impact, attachments, comments and a full audit trail.

### 7.2 Shift swap — peer acceptance

Shift swap is the one flow with a two-sided gate:

```
1. Employee requests a swap with a named colleague
2. The colleague accepts or rejects
3. Only then does it reach TL / WFM approval
4. The system validates coverage, rest, gender rule and skill
5. Approval creates a new schedule version
```

The fairness basis remains **pre-swap** (§2.3), so the swap cannot be used to redistribute
night load off the record.

### 7.3 Approval tracking

Two questions must be answerable at any moment, per approver:

1. What did they approve or refuse, and how quickly?
2. **What is sitting unanswered, and for how long?**

The second is the one most systems cannot answer. A request never decided is operationally
identical to a refusal, but it appears in no decision report unless pending age is tracked
explicitly. It is tracked here, with SLA breach flags.

### 7.4 Audit

The audit log is **append-only**. Every schedule change, approval, attendance correction, user
lifecycle event and configuration change records: **actor, action, entity type, entity ID, old
value, new value, timestamp**, and reason where applicable.

---

## 8. What the platform refuses to do

These are deliberate constraints, and they are as much a part of the specification as the
formulas.

| Refusal | Reason |
|---|---|
| It will not mark someone absent by inference | Missing evidence is a gap in measurement, not proof of behaviour |
| It will not present a modelled figure as a measured one | Estimated values are labelled on the page |
| It will not hide a coverage gap behind a complete-looking schedule | An unmet requirement is information, not an embarrassment |
| It will not let a hand-edited value stand in for a rule | It would be erased on the next rebuild and the rule would still be wrong |
| It will not publish a number it cannot re-derive | Where verification is impossible, it says so rather than implying confidence |

---

## 9. Verification regime

The platform is held to six gates, all of which run against live data:

| Gate | What it proves |
|---|---|
| **Accuracy audit** | 18 integrity checks across the reconciled roster |
| **Calculation verification** | Every stored metric recomputed independently from raw columns and diffed |
| **Explain self-check** | Every scored day re-derives to its stored conformance, or is reported as unverifiable |
| **Cross-check** | Independent screens must report the same figure for the same concept |
| **Golden master** | The pay-affecting rules produce unchanged results on a fixed dataset |
| **Pre-flight** | End-to-end endpoint health across every role |

A gate that reports a problem is investigated, not tuned. A harness that raises a false alarm
is fixed with the same urgency as a real defect — a check that cries wolf teaches people to
ignore it, which is worse than not having built it.

---

*Every rule in this document is Confirmed and in production. Any proposed change requires WFM
Directorate approval before implementation — the platform executes no unagreed rule.*
