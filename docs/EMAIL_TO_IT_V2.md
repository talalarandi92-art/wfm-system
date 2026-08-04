# PART 1 — The email (paste this into Outlook)

**Subject:** WFM System — Odoo & Sprinklr Integration (updated scope + operating rules)

---

Dear @Maged Ibrahim,

Following my previous note, I am sharing an updated and more complete version of the scope, together with the operating rules the solution must follow. I have kept it short; the detailed rules are in the one-page annex attached.

**Objective:** move Workforce Management from Excel-based tracking to a centralised, integrated, data-driven system built on Odoo — improving control, accuracy, and operational decision-making.

### Scope

**1. Scheduling**
- Shift schedule management, including bulk upload (Excel) and ongoing updates, with full visibility by employee, team, and function (Inbound, Chat, Email, etc.).
- Shift swap with a controlled workflow: **both employees must accept**, then WFM gives final approval, with automatic reflection on schedules and reporting.
- **Fair rotation** — OFF-day fairness and night/midnight fairness measured, not assumed (Annex §D).
- **Shift Rate** by employee, team, and function — this is the *distribution* of shift types, not a pay rate, with before/after impact shown on every edit and swap.

**2. Requests and leave**
- Breaks and permissions (time-based), with their impact reflected dynamically on headcount at hourly level.
- All leave types: Sick, Annual, Absence, and Work From Home, correctly reflected in scheduling, attendance, and reporting.
- **Approval tracking — including what has NOT been approved.** I need to see, per RTA team member, what they decided and how quickly, and **what is sitting with them undecided and for how long**. A request nobody answers has the same effect as a refusal but currently appears in no report.

**3. Attendance integration**
- Fingerprint system: punch in/out, late login, early logout, missing punches.
- Sprinklr (or the operational system): login/logout activity, compared against both the schedule and the fingerprint data.

**4. Automatic comparison**
- Scheduled shift vs fingerprint (late in / early out)
- Scheduled shift vs system login (login delay / early logout)
- Fingerprint vs system login (mismatch scenarios)

**5. Dynamic headcount, hourly**
- Scheduled HC · Available HC (after breaks, permissions, leaves) · Actual HC (system login) · **Gap vs required staffing**
- Impact of every approved request (permission, leave, swap) directly on headcount and coverage.

**6. Reporting**
- Interval-based headcount (hourly), daily and weekly summaries, shrinkage and adherence, attendance vs system activity, request impact analysis, exception tracking (absence, no login, mismatch).
- Direct HR export of updated attendance after all approvals and changes, for payroll accuracy.

### What I would ask you to note

The attached annex lists the operating rules the integration must respect. They are already agreed and already applied in our current WFM process. I am sharing them up front because a system that measures lateness — or decides "absent" — differently from these rules would create more risk than the manual process it replaces.

Two I would highlight now, as they affect the data contract itself:

- **Permission approval status must arrive as a discrete value** (Approved / Refused / Pending / Cancelled), not free text. Three of the current status strings contain the letters "approv" while meaning the opposite of approval, so any partial text match reads a **refusal as an approval**.
- **A working day with neither a punch nor a system login is flagged for review — never recorded automatically as an absence.** Missing evidence is a gap in measurement, not proof of behaviour.

I believe it would be beneficial to schedule a meeting to walk you through the full concept, discuss feasibility, and align on the best implementation approach.

Please let me know your availability.

Thanks & Regards,

---
---

# PART 2 — The annex (attach as a separate one-page document)

## WFM Integration — Operating Rules
*Already agreed and applied in the current WFM process. Shared so the integration does not contradict them.*

### A. Data contract

| # | Rule | Why |
|---|---|---|
| A1 | **Employee ID is the only join key — never match on name.** An intern's 6xxxx ID later becomes a 1xxxx full-time ID; both must resolve to one person. | Names repeat, change, and transliterate inconsistently. |
| A2 | **Sprinklr timestamps are local Kuwait time — do not convert to/from UTC.** | A UTC assumption shifts every login by three hours. |
| A3 | **Permission status as a discrete value:** `APPROVED` / `REFUSED` / `PENDING` / `CANCELLED`, alongside the display text. | "Approval Refused" and "Waiting 1st Approval" both contain "approv". A partial match reads a refusal as an approval. |
| A4 | **Column names and order frozen;** any change communicated before it ships. | A renamed or moved column is the most common cause of a silent data fault. |
| A5 | **Every feed re-runnable without side effects, replacing only its own date range.** | A re-import that reaches outside its range erases live history. |

### B. Time and period conventions

| # | Rule |
|---|---|
| B1 | **The workforce week runs Saturday → Friday.** |
| B2 | **Cut-off cycles are not calendar months:** full-time 15→14 · interns 1→end of month · Bahrain 25→24. Overtime and permission balances settle by cycle. |
| B3 | **A shift crossing midnight belongs entirely to the day it started** — for attendance, overtime, permissions, leave and swaps. Splitting it double-counts coverage and halves recorded hours. |

### C. Attendance measurement

| # | Rule | Why |
|---|---|---|
| C1 | **System login/logout is the official basis** for lateness and early departure. The fingerprint corroborates presence and is a different measurement — not interchangeable. | An agent can be in the building and not working, or working from home and never punch. |
| C2 | **Tolerance is 6 minutes.** At or below, nothing is counted. | |
| C3 | **A credible late-in / early-out is 7 to 240 minutes.** Beyond 240 on a cross-midnight shift it is session bleed, not tardiness — capped and flagged. | A logout left open overnight would otherwise read as a four-hour late arrival. |
| C4 | **A working day with no punch AND no system login is FLAGGED for review. Never recorded automatically as an absence — for any role.** | Missing evidence is a gap in measurement, not proof of behaviour. |
| C5 | **Work-from-home is concluded from a WFH shift code, an explicit WFH location, or an Odoo WFH status — never from "login but no punch".** | That pattern is an office day with a missing punch — a different thing entirely. |
| C6 | **Only an APPROVED permission excuses lateness or early departure.** Pending goes to review, never to automatic forgiveness. An approved permission never lowers conformance. | |
| C7 | **Supervisory roles (TL, Senior, RTA, Resolution Specialist, WFM) are record-only for deductions** — tracked and visible, no deduction computed. | |

### D. Scheduling and fairness

| # | Rule | Why |
|---|---|---|
| D1 | **Standard agent shift = 9 hours including a 1-hour break** (8 net). Supervisory / `20`-codes = 8 hours. Ramadan = 7 hours. | |
| D2 | **The gross span including the break is the yardstick for a completed shift**, not the net hours — the agent stays logged in through the break. | Measuring against 8 marks every complete shift as an hour short. |
| D3 | **Minimum rest: 10 hours between consecutive shifts**, calculated across midnight. MD ending 07:00 then M starting 07:00 = zero rest, invalid. | |
| D4 | **Exactly 2 OFF days per week; never 3 or more consecutive.** Weekend OFF distribution counted per person and converged over the rotation window. | Without an explicit count the same people absorb every mid-week OFF and nobody notices for a year. |
| D5 | **Night/midnight load measured as:** `fairness = 100 − standard deviation of night+midnight load across the fair pool`. Employees permanently on a night team are excluded from that pool. | Including them makes a fair rotation look unfair and pushes the system to "correct" a contractual arrangement. |
| D6 | **Fairness is measured on the PRE-SWAP schedule** — an approved swap never rewrites fairness history. | Otherwise colleagues can swap repeatedly to move night load off the record. |
| D7 | **Female agents:** up to the C shift (ends 20:00); N only where operationally necessary and always flagged; **MD/MN never assigned** except by explicit, logged, audited override. **Configurable — never hard-coded.** | Coverage remains the governing priority, but the exception must be owned by a named person. |
| D8 | **Female agents must rotate *within* their eligible shifts, not be frozen on one.** | In an early version of our own generator the shift rule narrowed their options and the fairness pass had nothing left to rotate — the people the rule protects became the only ones who never rotated. |
| D9 | **A published schedule is never overwritten by a regeneration.** Post-publication edits produce validation, version history, audit record, and a before/after impact view. | |
| D10 | **Where coverage cannot be met, publish the gap** — interval, function, size, cause, and remedies (cross-skill, overtime, shift-mix, approved exception). | A schedule that looks complete when it isn't is worse than a visible shortfall. |

### E. Approvals and audit

| # | Rule |
|---|---|
| E1 | Every request records requester, type, submission time, approver chain, and current stage. |
| E2 | Every decision records the decision, the decider, and the timestamp. |
| E3 | **Pending age is tracked and SLA breach flagged** — an undecided request must age visibly. |
| E4 | The coverage impact shown to the approver is stored **with** the decision, so a later review judges it on what was known at the time. |
| E5 | **Shift swap requires peer acceptance before it reaches approval**, then validation of coverage, rest, gender rule and skill. |
| E6 | The audit log is **append-only**: actor, action, entity, **old value, new value**, timestamp, reason. |

### F. Definitions that must not drift

| Term | Definition |
|---|---|
| **Shift Rate** | The *distribution* of shift types worked (Morning / Evening / Night / Midnight) year-to-date — a fairness measure, **not a pay rate**. OFF, holiday, leave, sick and absence are excluded from the working distribution and tracked separately. |
| **Overtime** | Three disjoint buckets — worked-day, off-day, holiday — **always summed, never subtracted**. Off-day and holiday overtime must be evidence-backed. |
| **Conformance** | `100 × min(overlap + permitted, paid) ÷ paid`, where *permitted* is the raw time forgiven by an approved permission. |

---

**Principle behind all of the above:** where the system cannot tell what happened, it flags the
day for a person to decide. It does not guess, and it never records an absence by inference.

*Any change to these rules requires WFM Directorate agreement before implementation.*
