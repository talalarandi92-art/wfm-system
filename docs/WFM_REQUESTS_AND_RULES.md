# WFM — Requested Capabilities and the Rules That Govern Them
### From: Workforce Management Directorate, Contact Center
### To: IT / Systems
### Purpose: what I need built, and the logic each item must follow

---

## Before the list

Six capabilities are requested below. Each one is written the same way:

**What I need · Why I need it · The rules it must obey · How we will know it is done.**

The rules are not suggestions and they are not new. They are the operating rules of the
Contact Center, already agreed and already enforced in the WFM platform. They are written out
here so that whatever you build does not contradict them — a second system that measures
lateness differently, or decides "absent" differently, does more damage than no system at all.

Where a rule looks unusual, the reason is given. Most of them exist because the obvious
alternative was tried and produced a wrong answer about a real person.

---

## Request 1 — Automated link between the schedule, Odoo, and login/logout

### What I need

A supported, scheduled feed replacing the manual export cycle:

- **From Odoo:** biometric punch in/out, attendance status, leave, official holidays, and
  permission requests with their approval status — per employee, per day.
- **From Sprinklr:** agent session login and logout timestamps.
- **To Odoo (optional):** the published schedule, so its expected-attendance view matches the
  operational plan.

### Why

Every number the Directorate publishes currently depends on someone remembering to export
three spreadsheets on time and in the right shape. That is not a foundation for payroll-
adjacent reporting.

### The rules it must obey

| # | Rule | Reason |
|---|---|---|
| 1.1 | **The employee ID is the only join key. Never match on name.** | Names repeat, change, and transliterate inconsistently between Arabic and English. An intern's 6xxxx ID later becomes a 1xxxx full-time ID and both must resolve to one person. |
| 1.2 | **Sprinklr timestamps are LOCAL Kuwait time. Do not convert to or from UTC.** | A UTC assumption shifts every login by three hours and turns punctual staff into late arrivals. |
| 1.3 | **Approval status must be a discrete enumerated value, not free text.** | The current export returns `HR Approved`, `Approval Refused`, `Waiting 1st Approval`, `Waiting 2nd Approval`, `HR Refused`, `HR Pending`, `HR Cancelled`. Three of those contain the letters "approv" while meaning the opposite of approval. Any consumer doing a partial match reads **a refusal as an approval**. Send `APPROVED` / `REFUSED` / `PENDING` / `CANCELLED` alongside the display text. |
| 1.4 | **Only an APPROVED permission excuses lateness or an early departure.** Pending goes to manual review, never to automatic forgiveness. | A pending request is not a decision. |
| 1.5 | **Every feed must be re-runnable without side effects, and must replace only its own date range.** | A re-import that deletes rows outside its range silently erases live attendance history. |
| 1.6 | **Every payload carries its source system and extraction timestamp.** | When two systems disagree, provenance is what settles it. |
| 1.7 | **Column names and order must be frozen.** If the contract changes, we are told before it ships. | A renamed column is the single most common cause of a silent data fault. We have been hit by it twice: a Sprinklr export that moved its header to row 3, and one that replaced a `Login Date` + `Login Time` pair with a single `Login Timestamp`. Both produced zero sessions from a file with 700 rows in it. |

### Done means

A scheduled feed runs unattended for two full weeks, and a re-run of any past date range
reproduces the same result byte for byte.

---

## Request 2 — Tracking between the biometric punch and the system session

### What I need

A daily view, per employee: **scheduled shift · punch in/out · system login/logout · the
variance between them · the resulting flag.**

### Why

These are two independent witnesses to the same day, and they disagree often enough that the
disagreement itself is the operational signal. I need to see it daily, not discover it at
month end.

### The rules it must obey

| # | Rule | Reason |
|---|---|---|
| 2.1 | **The system login/logout is the official basis for lateness and early departure.** The punch corroborates physical presence and is a different measurement — the two are not interchangeable. | An agent can be in the building and not working, and can be working from home and never punch. |
| 2.2 | **Tolerance is 6 minutes.** At or below it, nothing is counted. | |
| 2.3 | **A credible late arrival or early departure is 7 to 240 minutes.** Beyond 240 on a shift crossing midnight, the reading is session bleed, not tardiness — cap it and flag it. | A logout signal left open overnight would otherwise be recorded as a four-hour late arrival. |
| 2.4 | **A working day with neither a punch nor a system session is FLAGGED for human review. Worked minutes are zero. It is NEVER automatically recorded as an absence — and this applies to every role without exception.** | Missing evidence is a gap in measurement, not proof of behaviour. No employee should ever first learn from a report that a machine marked them absent. |
| 2.5 | **Working from home is concluded from a WFH shift code, an explicit WFH location, or an Odoo WFH status — never from "system login but no punch".** | That pattern describes an office day with a missing punch, which is a completely different thing. |
| 2.6 | **A shift crossing midnight belongs entirely to the day it started** — for attendance, overtime, permissions and leave. | Splitting it across two calendar days double-counts coverage and halves the recorded hours. |
| 2.7 | **Supervisory roles (Team Leader, Senior, RTA, Resolution Specialist, WFM) are record-only for deductions.** Their attendance is tracked and visible; no deduction is computed from it. | They are accountable for coverage, not for a clock. |

### Done means

I can open any day and see, per person, what each system saw and where they disagree — without
exporting anything.

---

## Request 3 — Break requests

### What I need

Break requests submitted, routed, decided and recorded in a system rather than in chat.

### Why

Breaks are the highest-frequency intraday decision we make and the only one with no record.
When coverage collapses at 15:00 nobody can reconstruct who was released and by whom.

### The rules it must obey

| # | Rule | Reason |
|---|---|---|
| 3.1 | **The approver must see the coverage impact at the moment of decision** — how many agents remain for that interval, per function, if this break is granted. | The purpose is not to block the approval. Operational judgement stays with the approver. The purpose is that the decision is made with its cost visible. |
| 3.2 | **The figure shown to the approver is recorded with the decision.** | So a later review judges the decision against what was known at the time, not against hindsight. |
| 3.3 | **Time-to-decision is measured, and an undecided request ages visibly.** | See Request 6. |
| 3.4 | **An approved break is reflected in the intraday plan**, not held separately. | Two versions of the truth is how coverage reporting stops being trusted. |

### Done means

Every break in a day is attributable to a named approver with a timestamp, and the coverage
figure they were shown is retrievable.

---

## Request 4 — Schedule generation, and the rules it must follow

### What I need

Anything that displays, consumes or edits the schedule must respect the generation rules
below. The generator itself exists in WFM; this is so no downstream system contradicts it.

### The rules

**Shift duration**

| Population | Duration |
|---|---|
| Standard agent | **9 hours including a 1-hour break** (8 net) |
| Supervisory / `20`-series codes | 8 hours |
| Ramadan | 7 hours; some split shifts |

> **The gross span including the break is the yardstick for a completed shift**, not the net
> hours. The agent stays logged in through the break, so a 9-hour shift requires a 9-hour
> session. Measuring against 8 marks every complete shift as an hour short.

**Canonical windows** — never invented, never rounded:
`M 07–16 · B 09–18 · C 11–20 · N 13–22 · E 16–01 · EE 18–02/03 · MD 22–07 · MN 23–08`
The `EE` family is role-dependent: an agent works 18:00–03:00 (9h), an administrator
18:00–02:00 (8h). **No real shift ends at 21:00** — a 21:00 end is a data error.

**Coverage and eligibility**

| # | Rule | Reason |
|---|---|---|
| 4.1 | **Minimum rest is 10 hours between consecutive shifts**, calculated across midnight. MD ending 07:00 followed by M starting 07:00 is zero rest and invalid. MD ending 07:00 followed by EE20 at 18:00 is 11 hours and valid. | |
| 4.2 | **Female agents work up to the C shift, ending 20:00.** The N shift only where operationally necessary, and always flagged. **MD/MN are never assigned** except by an explicit, logged, audited manual override. **Configurable — never hard-coded.** | Business coverage remains the governing priority; the rule must be overridable by a named person who accepts the exception, not silently bypassed by software. |
| 4.3 | **Exactly 2 OFF days per week. Never 3 or more consecutive.** | |
| 4.4 | **A published schedule is never overwritten by a new generation run.** | |
| 4.5 | **Post-publication edits produce: rule validation, a version history entry, an audit record, and a before/after impact view** covering coverage, rest, the female rule and shift distribution. | An edit without visible consequence is how a schedule drifts away from the plan it was approved as. |
| 4.6 | **Where coverage cannot be met, the shortfall is published** — interval, function, size, cause, and the available remedies (cross-skill, overtime, shift-mix change, approved exception). | Midnight coverage can be mathematically impossible when the eligible pool is too small. A schedule that looked complete would be a lie, and the honest gap is what triggers a hiring or cross-skill decision. |

**Lifecycle:** `Draft → Generated → Reviewed → Published → Locked`

### Done means

No screen anywhere in the estate displays a shift window, a rest calculation or a completion
judgement that disagrees with the table above.

---

## Request 5 — Fair rotation: OFF fairness and shift fairness

### What I need

This is the part I care about most, and the part most easily got wrong. Fairness must be
**measured**, not assumed.

### The rules

**OFF-day fairness**

| # | Rule | Reason |
|---|---|---|
| 5.1 | **Exactly 2 OFF per week, never 3+ consecutive.** | A long idle block is not rest; it is lost capacity, and it distorts the following week. |
| 5.2 | **Weekend OFF distribution is counted per person across the rotation window and converged.** Someone who received a mid-week pair last week is prioritised for a weekend pair next. | Friday and Saturday are the desirable days. Without an explicit count, the same people absorb every mid-week OFF and nobody notices for a year. |
| 5.3 | **OFF placement is decided BEFORE shift assignment.** | An OFF day removes a person from the coverage pool, and every later calculation depends on knowing who is available. |

**Shift fairness**

```
fairnessScore = 100 − standard deviation of (night + midnight) load
                       across the FAIR POOL
```

| # | Rule | Reason |
|---|---|---|
| 5.4 | **The fair pool excludes employees permanently assigned to a night team.** | Including them inflates the deviation, makes a fair rotation look unfair, and pushes the generator to "correct" an imbalance that is contractual rather than accidental. |
| 5.5 | **The fairness basis is the PRE-SWAP schedule.** An approved swap never rewrites fairness history. | Otherwise two colleagues can swap repeatedly to launder night load off the record. |
| 5.6 | **Female agents must be inside the rotation, not frozen outside it.** | An early version of our generator held women on a single shift: the female-shift rule narrowed their eligible set, and the fairness pass then had nothing left to rotate. The people the rule was written to protect became the only ones who never rotated. Rotate **within** the eligible set — the protection and the rotation are separate mechanisms and must not collapse into one. |
| 5.7 | **Night work is assigned in blocks of 2–3 consecutive days, with a full OFF block after each** — not scattered singles. | A single night between day shifts costs more sleep disruption than three nights together. This is deliberately humane rather than mathematically optimal. |

**Shift Rate (shift distribution) — not a pay rate**

| Category | Codes |
|---|---|
| Morning / Day | M, B, C, AM, their `20` variants, WFH-M, WFH-B, M7-3, B7 |
| Evening | E, EE20 |
| Night | N, N20, WFH-N |
| Midnight | MD, MN, MDR, MNR |

OFF, holiday, leave, sick and absence are **excluded** from the working distribution and
tracked separately.

| # | Rule |
|---|---|
| 5.8 | Reported as count **and** percentage — year-to-date, month-to-date, and for a selected period. |
| 5.9 | **Every edit or swap shows the before/after impact for both employees involved.** |

```
Before:  Morning 42 · Night 8 · Evening 5 · Midnight 18
After :  Morning 41 · Night 8 · Evening 5 · Midnight 19    (C changed to MD)
```

> This is the mechanism that makes an unfair pattern visible **at the moment it is created**,
> rather than at the end of the year when nothing can be done about it.

### Done means

I can ask, for any employee, "have they carried more than their share of nights this year?" and
get a defensible number — and the person who assigned the last night shift saw that number
before they assigned it.

---

## Request 6 — Approval tracking across the RTA team

### What I need

An unambiguous record of who decided what — **and who did not decide.**

### Why

I can currently see approvals. I cannot see silence. A request nobody answered has the same
operational effect as a refusal and appears in no report.

### The rules

| # | Rule | Reason |
|---|---|---|
| 6.1 | Every request records: requester, type, submission time, approver chain, current stage. | |
| 6.2 | Every decision records: **decision, decider identity, decision timestamp**. | |
| 6.3 | **Pending age is tracked and SLA breach is flagged.** An undecided request must age visibly. | This is the capability that does not exist today and the main reason for this request. |
| 6.4 | The impact figure shown to the approver is stored **with** the decision. | So a review judges the decision on what was known then. |
| 6.5 | **Shift swap requires peer acceptance before it reaches approval:** employee requests → colleague accepts or rejects → then TL/WFM approval → system validates coverage, rest, gender rule and skill → approval creates a new schedule version. | A swap imposed on a colleague is not a swap. |
| 6.6 | The audit log is **append-only** and records actor, action, entity, **old value, new value**, timestamp, and reason where applicable — for every schedule change, approval, attendance correction and configuration change. | |

### Done means

I can answer two questions for any RTA team member on any day: what did they decide and how
fast, and what is sitting with them unanswered and for how long.

---

## The principles behind all six

If a decision has to be made that this document does not cover, these are the defaults:

1. **Ambiguous evidence never becomes an accusation.** Where the system cannot tell what
   happened, it flags the day for a person. It does not guess, and it never records an absence
   by inference.
2. **A shortfall is information, not an embarrassment.** Publish the gap.
3. **Show the cost at the moment of the decision**, not in the report afterwards.
4. **One definition per concept, estate-wide.** Two screens that disagree about "late" is worse
   than neither screen existing.
5. **Any number we publish must be re-derivable from its inputs** — and where it cannot be
   verified, say so rather than implying confidence.
6. **No rule in this document changes without WFM Directorate agreement.**

---

## What I need from you next

1. Feasibility and access review for Odoo and Sprinklr — is a supported API available, and
   under what authentication?
2. A written data contract per feed: field names, types, enumerated values, refresh frequency,
   and a commitment that it will not change without notice.
3. An effort estimate per request, so I can sequence them against operational priority.
4. A named technical owner per integration, for the edge cases that will certainly arise.

Requests 1 and 2 carry most of the operational benefit and are my priority. I can provide
sample files for every feed, the full rules library, and the reconciliation logic already
running in production.
