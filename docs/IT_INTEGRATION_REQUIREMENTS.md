# WFM Platform — Integration & Automation Requirements
### Prepared by: WFM Directorate, Contact Center Operations
### Audience: IT / Systems Integration
### Status: Requirements for scoping and build — phased delivery

---

## 0. Purpose and scope

The Contact Center Workforce Management (WFM) platform already holds the schedule, the
reconciled attendance record, overtime, conformance and the reporting layer. What it does
**not** yet have is a supported, automated link to the systems that produce its raw inputs.
Today those inputs arrive as manually exported spreadsheets.

This document requests the integrations and workflow capabilities needed to close that gap,
organised into six phases. Each phase is independently deliverable and independently useful —
Phase 1 alone removes the largest manual step — so they can be scheduled and released
separately rather than as one large programme.

**One principle governs the whole request:** every rule in this document is already agreed and
already enforced inside the WFM engine. Nothing here asks IT to re-implement business logic.
What is being requested is **reliable, structured access to source data**, plus workflow
support for requests and approvals. Business rules stay in WFM; IT supplies the data contract.

---

## 1. Non-negotiable conventions

These apply to every phase and to every interface. They are not preferences; violating any one
of them silently corrupts payroll-adjacent numbers.

| # | Convention | Why it matters |
|---|---|---|
| C-1 | **The employee ID is the only join key.** Never match on name. | Names repeat, change, and transliterate inconsistently between Arabic and English. Interns carry a 6xxxx ID that later becomes a 1xxxx full-time ID; both must resolve to one person. |
| C-2 | **Sprinklr timestamps are LOCAL Kuwait time, not UTC.** Do not convert. | A UTC assumption shifts every login by three hours and turns on-time staff into late arrivals. |
| C-3 | **A shift that crosses midnight belongs entirely to the day it STARTED** — for attendance, overtime, permissions, leave and every request type. | A 22:00–07:00 shift split across two calendar days double-counts coverage and halves the recorded hours. |
| C-4 | **The workforce week runs Saturday → Friday.** | All weekly aggregation, OFF-day balance and rotation depend on this boundary. |
| C-5 | **Accounting cut-off cycles are not calendar months:** full-time 15→14, interns 1→end of month, Bahrain 25→24. | Overtime and permission balances are settled by cycle. |
| C-6 | Every interface must be **re-runnable without side effects** (idempotent) and must replace **only its own date range**. | A partial re-import that deletes rows outside its range silently erases live attendance records. |
| C-7 | Every payload must carry the **source system and extraction timestamp**. | Without provenance a disagreement between two systems cannot be arbitrated. |

---

## 2. Phase 1 — Schedule ↔ Odoo integration

**Objective:** replace the manual Odoo export with a scheduled, structured feed.

### 2.1 What WFM needs FROM Odoo

Per employee, per calendar day, for a requested date range:

| Field | Notes |
|---|---|
| Employee ID | C-1 — the join key |
| Date | ISO `YYYY-MM-DD` |
| Biometric punch IN / punch OUT | Local time. Absent is a valid value and must be transmitted as null, not as zero |
| Attendance status | Present / WFH / Off Day / Leave / Absent / Sick / Unpaid |
| Leave type and dates | Annual, sick, death, compensatory, unpaid |
| Official holidays | Calendar of public holidays, forward-looking |
| Permission requests | Type, date, time-from, time-to, hours, **approval status** |

### 2.2 Critical detail on permission status

Approval status must be delivered as a **discrete, enumerated value** — not free text.

The current export returns strings including `HR Approved`, `Approval Refused`,
`Waiting 1st Approval`, `Waiting 2nd Approval`, `HR Refused`, `HR Pending`, `HR Cancelled`.
Three of those contain the substring "approv" while meaning the opposite of approval. Any
consumer doing a substring match reads a **refusal as an approval**. WFM has been hardened
against this, but the correct fix is at the source: send a stable enum
(`APPROVED` / `REFUSED` / `PENDING` / `CANCELLED`) alongside the display text.

Only an **approved** permission may excuse lateness or an early departure. Pending must route
to manual review, never to automatic forgiveness.

### 2.3 What WFM will send TO Odoo (optional, Phase 1b)

The published schedule per employee per day: shift code, start, end, and OFF/leave markers —
so Odoo's expected-attendance view matches the operational plan.

### 2.4 Delivery options, in order of preference

1. **REST API** with token authentication, date-range parameters, JSON, paginated.
2. **Scheduled database view or read replica** exposed to WFM.
3. **Automated file drop** — CSV/XLSX to a monitored network path or SFTP on a fixed schedule,
   with a stable filename pattern and a stable column contract.

Option 3 is acceptable as an interim step and materially better than today, **provided the
column set and header names are frozen**. Column order or naming that changes between exports
is the single most common cause of a silent data fault.

---

## 3. Phase 2 — Login / logout tracking and punch-vs-system reconciliation

**Objective:** automate the agent session feed from Sprinklr and support the reconciliation
between the two independent witnesses of attendance.

### 3.1 What WFM needs FROM Sprinklr

| Field | Notes |
|---|---|
| Agent identifier | Email or username, mapped to the employee ID (C-1) |
| Login timestamp | Local Kuwait time (C-2), full date+time |
| Logout timestamp | Local Kuwait time; null where the session never closed |
| Channel / queue if available | Enables per-channel workload analysis |

Requested as an API rather than a dashboard widget export. The widget export prefixes the
sheet with banner rows and has changed its column shape between pulls (a `Login Date` +
`Login Time` pair in one version, a single `Login Timestamp` in another). Both shapes are now
handled, but an API contract removes the class of problem.

### 3.2 The reconciliation WFM performs (for IT awareness — no build required)

Two independent witnesses exist for each working day: the **biometric punch** and the
**system session**. WFM combines them under agreed rules:

- The **system login/logout is the official basis** for lateness and early departure.
- The punch corroborates physical presence; it is a different measurement and is not
  interchangeable with the system time.
- **Tolerance is 6 minutes.** At or below it, nothing is counted.
- A credible late arrival or early departure is **7 to 240 minutes**. Beyond 240 on a
  cross-midnight shift the reading is session bleed, not tardiness, and is capped and flagged.
- **A working day with neither a punch nor a system session is FLAGGED for human review — it
  is never automatically recorded as an absence.** This rule is absolute and applies to every
  role. An employee must never be marked absent by inference.
- Working from home is determined by a **WFH shift code, an explicit WFH location, or an Odoo
  WFH status** — never inferred from "system login but no punch", which describes an office day
  with a missing punch.

### 3.3 What IT is asked to provide

A dashboard or report, sourced from the same feeds, showing per employee per day:
**scheduled shift · punch in/out · system login/logout · the variance between them · the
resulting flag**. This is the operational tracking view the WFM Directorate needs for daily
review, and the same view IT can use to prove an integration is healthy.

---

## 4. Phase 3 — Break requests and approvals

**Objective:** move break requests out of chat and into a tracked workflow.

### 4.1 Required capability

| Requirement | Detail |
|---|---|
| Request submission | Agent requests a break slot; captures employee, date, requested window, reason |
| Coverage check **before** approval | The approver must see the staffing impact of granting it — how many agents remain on the floor for that interval, per function |
| Approval routing | Team Leader / RTA, with escalation if unanswered |
| SLA | Time-to-decision measured and reported |
| Outcome recording | Approved / refused / expired, with the approver's identity and timestamp |
| Schedule reflection | An approved break is reflected in the intraday plan |

### 4.2 The rule that matters

A break must not be approved into an interval that is already below required coverage without
that shortfall being **shown to the approver at the moment of decision**. The purpose is not to
block the approval — operational judgement stays with the approver — but to ensure the decision
is made with the consequence visible.

---

## 5. Phase 4 — Schedule generation and its rules

**Objective:** for IT awareness and for any interface that consumes or displays the schedule.

The generation engine exists in WFM. This section documents the constraints it enforces so
that no downstream system contradicts them.

### 5.1 Shift duration

| Population | Duration |
|---|---|
| Standard agent | **9 hours including a 1-hour break** |
| Supervisory / `20`-series codes | 8 hours |
| Ramadan | 7 hours; some split shifts |

The **gross span including the break** is the yardstick for whether a shift was completed —
the agent remains logged in through the break, so a 9-hour shift requires a 9-hour session,
not an 8-hour one.

### 5.2 Coverage and eligibility constraints

| Rule | Statement |
|---|---|
| **Female shift rule** | Female agents work up to the C shift, ending 20:00. The N shift only where operationally necessary, and always flagged. **Midnight shifts (MD/MN) are never assigned** except by an explicit, logged, audited manual override. This must be configurable, never hard-coded. |
| **Minimum rest** | **10 hours between consecutive shifts**, calculated across midnight. A midnight shift ending 07:00 followed by a 07:00 start is zero rest and invalid. |
| **OFF days** | Exactly 2 per week; never 3 or more consecutive. |
| **Coverage first** | Business coverage is the governing priority; where a rule and coverage conflict, the system must show the conflict rather than silently resolve it. |
| **Honest gaps** | Where coverage cannot be met, the generator reports the gap, its cause, and the available remedies — cross-skill movement, overtime, or an approved exception. It must never hide a shortfall by producing a schedule that looks complete. |

### 5.3 Schedule lifecycle

`Draft → Generated → Reviewed → Published → Locked`

A **published schedule is never overwritten by a new generation run.** Post-publication edits
are permitted for authorised users and must produce: validation warnings, a version history
entry, an audit record, and a before/after impact view.

---

## 6. Phase 5 — Shift Rate (shift distribution)

**Objective:** ensure any system displaying "Shift Rate" uses the agreed meaning.

**Shift Rate is NOT a pay rate.** It is the distribution of shift types an employee has worked
from the start of the year to a selected date — a fairness measure, not a financial one.

Tracked per employee, as both a count and a percentage, year-to-date / month-to-date / for a
selected period:

| Category | Codes |
|---|---|
| Morning / Day | M, B, C, AM (and their `20` variants, WFH-M/WFH-B, M7-3, B7) |
| Evening | E, EE20 |
| Night | N, N20, WFH-N |
| Midnight | MD, MN, MDR, MNR |

OFF, holiday, leave, sick and absence are **excluded** from the working distribution and
tracked separately.

Every schedule edit or swap must display the **before/after impact on this distribution — for
both employees in a swap.** This is the mechanism that makes unfair rotation visible.

---

## 7. Phase 6 — RTA approval tracking and audit

**Objective:** an unambiguous record of who decided what, and who did not decide.

### 7.1 Required tracking

For every request type — permission, break, overtime, shift swap, leave, schedule exception:

| Field | Purpose |
|---|---|
| Requester, type, submission timestamp | The request |
| Approver chain and current stage | Where it stands |
| **Decision, decider identity, decision timestamp** | Who approved, who refused |
| **Pending age and SLA breach flag** | **Who has not answered** — the item most often missing today |
| Impact recorded at decision time | What the approver was shown |
| Attachments and comments | Supporting evidence |

### 7.2 The requirement behind this

The WFM Directorate needs to answer two questions daily, per RTA team member:

1. What did they approve or refuse, and how quickly?
2. **What is sitting unanswered, and for how long?**

The second is the one no current system answers. A request that is never decided is
operationally identical to a refusal but appears nowhere in a decision report.

### 7.3 Audit requirements

The audit record must be **append-only** and must capture, for every schedule change,
approval, attendance correction and configuration change: actor, action, entity, **old value,
new value**, timestamp, and reason where applicable.

---

## 8. Suggested sequencing

| Phase | Delivers | Depends on |
|---|---|---|
| **1 — Odoo feed** | Removes the largest manual step; punches, permissions, leave, holidays | Odoo API or SFTP access |
| **2 — Sprinklr feed** | Automates the session feed; enables daily rather than weekly reconciliation | Sprinklr API access |
| **3 — Break workflow** | Tracked requests with coverage visibility | Phases 1–2 for the coverage figure |
| **6 — Approval tracking** | Answers "who has not decided" | Can proceed in parallel |
| **4 / 5 — Schedule rules & Shift Rate** | Documentation and display alignment | No build dependency |

Phases 1 and 2 carry the great majority of the operational benefit and are requested first.

---

## 9. What is requested from IT at this stage

1. **Feasibility and access review** for Odoo and Sprinklr — is a supported API available, and
   under what authentication?
2. **A written data contract** for each feed: field names, types, enumerated values, refresh
   frequency, and the guarantee that the contract will not change without notice.
3. **An effort estimate per phase**, so delivery can be sequenced against operational priority.
4. **A named technical owner per integration**, for the inevitable questions about edge cases.

The WFM Directorate will provide, on request: sample files for every feed, the full business
rules library with rule identifiers, and the reconciliation logic already in production.

---

*This document describes requirements only. All business rules stated here are already agreed
and enforced within the WFM platform; they are reproduced so that no integration contradicts
them. Any proposed change to a rule requires WFM Directorate approval before implementation.*
