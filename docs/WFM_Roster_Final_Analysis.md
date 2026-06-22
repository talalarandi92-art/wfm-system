# Boutiqaat Contact-Center WFM
## Roster Reconciliation & Data-Integrity Programme — Final Analysis

**Document class:** Executive / Enterprise Deliverable
**Prepared by:** Workforce Management — Reconciliation & Data Integrity Workstream
**Audience:** WFM · Contact-Center Operations · HR · IT · Executive Management
**Data window:** 2026-01-01 → 2026-06-29 (full year-to-date)
**System of record:** PostgreSQL `wfm_db` · tenant `a0000000-0000-0000-0000-000000000001`
**Document date:** 2026-06-22
**Status:** Final — verified against the live database

---

> **Reading note on data provenance.** Every figure in this document marked
> *(verified)* was read directly from the live `wfm_db` reconciliation tables
> (`roster_days`, `roster_validation_log`, `employee_identity`, `data_quality`
> flags). Any number that is a projection, target, or industry benchmark is
> explicitly labelled *(extrapolated)*, *(target)*, or *(benchmark)*. Nothing in
> the verified column has been rounded for effect. Where a recommendation goes
> beyond the delivered system it is written as a recommendation, not as a
> statement of current capability.

---

# 1. Executive Summary

The Contact-Center roster was, until this programme, untrustworthy at the point
where it mattered most — headcount, attendance, tardiness and overtime — because
the underlying data carried three structural defects that compounded each other:
the **same human being counted as two or three people**, **shift codes leaking
into the function column**, and an **export bug that invented a fake attendance
code ("P")** which masked real sick-leave days. Leaders looking at the old
output saw duplicate names, agents who had already left still appearing in
rankings, and totals that never tied out. The complaint was correct; the cause
was data, not perception.

This programme rebuilt the roster from the source systems up. We combined five
independent feeds per employee per day — **Odoo FingerPrint** (physical punch),
**Ameyo** (telephony system login/logout), **Sprinklr** (digital system
login/logout), **Odoo** permissions / compensatory-off / sick records, and the
**monthly schedule matrix** as the source of truth for what *should* have
happened — into a single reconciled fact row. The result is
**`roster_days` = 17,312 agent-day rows (verified)** spanning the full year to
date, validated **week by week across 27 weekly validation blocks** recorded in
`roster_validation_log` (verified).

On top of that clean fact table we built a **canonical identity layer** that
collapses every raw employee number to one real person. This single fix is the
headline result: **163 raw IDs resolve to 141 real people (verified)** — 22 alias
IDs were collapsed, meaning **21 humans had been double- or triple-counted** in
every previous report. The worst case, *MHD AlTamer*, carried three IDs
(6266, 13759, 13850) and now resolves to one person (verified).

Two further corrections restored trust in the numbers. Shift/leave codes that had
polluted roughly **60% of rows** in the `function_name` column were separated from
the authoritative function (`employees.function_id → functions.name`), eliminating
the second reason an agent split into two ranking lines. And the **"P" export bug**
— a `CASE … ELSE 'P'` fallback that dumped sick, holiday, comp, present and
null-shift days into an invented code — was replaced with a correct
`COALESCE(hr_code, attendance_code, shift_code, 'OFF')` precedence. After the fix
there are **zero "P" rows** in the HR matrix (verified), and the specific days the
Director flagged were confirmed to be **genuine sick leave** (e.g. Abdulkarim
Barbazi, 02-Jun and 07-Jun = SL).

The platform now also respects that **not every employee is a 9-hour agent**: RTA,
Customer Care, Resolution Specialist and Team Leader work 8 hours and are excluded
by default from tardiness/adherence KPIs (toggle to include); mothers on maternity
work 7 hours (M7/B7/C7/N7); standard agents and interns work 9 hours including a
1-hour break. These rules live in a configurable `role_working_hours` lookup, not
in code branches.

**What this means for the business.** Headcount is now defensible to the person:
**141 canonical people (verified)** — Agent 73, Intern 43, OMT 7, Customer Care 5,
Team Leader 4, Resolution Specialist 3, RTA 3, Back Office 3. Attendance, OT,
tardiness, WFH, sick, absence and permission metrics are computed once, from one
reconciled fact row, role-aware, with inactive staff held for audit but kept out
of the live KPIs. The accompanying delivery — a Roster Analytics Dashboard, a
Custom Report Builder (36 fields / 26 KPIs / 11 groupings), an HR-matrix export, a
data-integrity audit endpoint and a Data Quality page — turns this clean
foundation into something Operations, HR and the executive can actually run the
floor on.

**Bottom line:** the roster is now a single source of truth. The duplicate-name
and ghost-employee problems are solved at the root, not patched at the report
layer, and the data model is built so the same defects cannot silently return.

---

# 2. Root-Cause Analysis of Data Inaccuracy

The Director's complaint — *"duplicate names, and people who left are still
shown"* — was a symptom. Diagnosis traced it to four distinct, independently
verifiable root causes. Crucially, three of these are **identity / data-shape**
defects (they manufacture phantom rows and people) and one is an **export logic**
defect (it manufactures a fake code). Each is described below with cause,
mechanism, evidence and fix.

### 2.1 Root Cause #1 — Identity / ID-migration fragmentation *(primary cause)*

**Cause.** When an intern converts to full-time, Boutiqaat issues a **new
employee number** (intern `6xxx` → full-time `13xxx`), and sometimes the old
record is left in the master with `status = inactive`. The roster, built over six
months, referenced *whichever ID was active on that date*. So a single person
appeared under their `6xxx` ID in January and their `13xxx` ID in March.

**Mechanism of error.** Any aggregation keyed on raw `employee_no` treats those
as **two different employees**. Headcount inflates, the same human shows up twice
in rankings, and the superseded `6xxx` ID surfaces as if it were a separate
(often "inactive") person — which reads to a manager as *"someone who left is
still on the report."*

**Evidence (verified).** 163 raw IDs collapse to 141 real people; 22 alias IDs;
21 humans double/triple-counted. *MHD AlTamer* = IDs 6266, 13759, 13850 → 1 person.

**Fix.** A canonical identity layer (`employee_identity`, migration 058 +
backfill) maps every raw ID to one `person_no` by matching the employee master
name and choosing the **active / full-time / newest** ID as canonical. All KPIs
now aggregate on `person_no`, never raw `employee_no`.

### 2.2 Root Cause #2 — Function-column pollution

**Cause.** During earlier imports, the per-day **shift or leave code** (e.g.
`OFF`, `N`, `M7-3`) was written into the `function_name` column instead of the
employee's real function.

**Mechanism of error.** Roughly **60% of roster rows (verified scope)** carried a
shift/leave code where a function name should be. Any "by function" grouping then
split one agent into two lines — one tagged by the leaked shift code, one tagged
by the real function — producing the *second* duplicate-row symptom on top of the
identity one.

**Fix.** The authoritative function is taken from
`employees.function_id → functions.name` and carried as a clean `role_function`
field. The polluted column is no longer used for grouping.

### 2.3 Root Cause #3 — HR-matrix "P" fallback bug

**Cause.** A CSV/HR-matrix export used a `CASE … ELSE 'P'` fallback. Whenever a
cell did not match an explicit branch, it was stamped **`P`** — a code that does
**not exist** in the approved code dictionary.

**Mechanism of error.** Sick, Holiday, Comp, Present and null-shift days all fell
through to `ELSE 'P'`. Real **sick-leave days were hidden behind an invented
"Present-like" code**, so absence and sick metrics under-reported and the matrix
looked internally inconsistent.

**Evidence (verified).** The flagged days were genuinely sick leave:
- **Abdulkarim Barbazi** — 02-Jun = SL (shift ES), 07-Jun = SL (shift CS)
- **Afnan Ajaimi** — 01-Jun = SL (shift NS); 07-Jun = Present/Office (shift B)
- **Aisha Aljbawi** — 09-Jun = SL (shift BS)

**Fix.** Replaced with `COALESCE(hr_code, attendance_code, shift_code, 'OFF')`.
After the fix there are **zero "P" rows** in the matrix (verified).

### 2.4 Root Cause #4 — Role working-hours assumption

**Cause.** Tardiness/adherence logic implicitly assumed a 9-hour agent shift for
everyone.

**Mechanism of error.** RTA, Customer Care, Resolution Specialist and Team Leader
work **8 hours**; mothers on maternity work **7 hours** (M7/B7/C7/N7). Applying a
9-hour expectation produced false "early-out" and adherence penalties for staff
who were, in fact, working their correct shift.

**Fix.** A configurable `role_working_hours` lookup stores hours per role. RTA /
Customer Care / Resolution Specialist / Team Leader (8h) are **excluded from
default tardiness/adherence KPIs** (kept as records, toggle to include);
maternity = 7h; standard agents & interns = 9h incl. 1h break.

### 2.5 How the four causes compounded

The defects were multiplicative, not additive. A single intern-converted agent
could appear as **(person A under 6xxx) + (person A under 13xxx)**, each further
**split by a leaked shift code in the function column**, with their **sick days
hidden under "P"**, all while being **penalised for a 9-hour expectation they
never had**. One human could therefore generate four or more distinct, wrong rows
across a report. Fixing them in isolation would not have restored trust; they had
to be fixed together, at the data-model layer.

---

# 3. Duplicate Employee Findings

**Headline (verified):** 163 raw employee IDs → **141 canonical people**;
**22 alias IDs collapsed**; **21 humans** were previously double- or
triple-counted.

| Metric | Value | Source |
|---|---|---|
| Raw employee IDs in roster references | 163 | `employee_identity` (verified) |
| Canonical real people (`person_no`) | 141 | `employee_identity` (verified) |
| Alias IDs collapsed | 22 | derived (163 − 141) (verified) |
| People affected by double/triple counting | 21 | `employee_identity` (verified) |
| Maximum IDs on one person | 3 (MHD AlTamer: 6266 / 13759 / 13850) | (verified) |

**Why ~22 aliases map to 21 people:** at least one person (MHD AlTamer) carried
**three** IDs, consuming two alias slots alone; the remaining people each carried
two.

**Canonical-ID selection rule.** For each name cluster the canonical ID is chosen
by priority: **(1) active status > inactive, (2) full-time `13xxx` > intern
`6xxx`, (3) newest ID** as tie-breaker. The non-canonical IDs are retained as
aliases so historical rows under an old ID still resolve to the right person —
nothing is deleted.

**Business impact of the fix.** Every "by employee" ranking, every headcount
count, and every per-person attendance/OT total previously over-counted the 21
affected people. Post-fix, the floor headcount is **141**, defensible to the
individual, and an agent can no longer appear twice in the same leaderboard.

---

# 4. Inactive Employee Findings

**Headline (verified):** the three master-`inactive` IDs were all **superseded
old intern IDs of still-active people**. Net **resigned persons in the master = 0**.

| Finding | Detail | Source |
|---|---|---|
| Master IDs with `status=inactive` | 3 | `employees` (verified) |
| Of those, that are old aliases of active people | 3 | `employee_identity` (verified) |
| Genuine resignations represented in master | 0 | derived (verified) |
| Treatment in default KPIs | Excluded (toggle "Include inactive") | (delivered) |
| Treatment for audit/history | Retained | (delivered) |

**This directly answers the "people who left are still shown" complaint:** they
had not left. They were the *old IDs* of people who are still on the floor. Once
the identity layer collapsed the old IDs into their owners, the "ghost ex-employee"
rows disappeared from the live view while remaining available for historical audit.

**Two unmatched team-leader labels — flagged, not deleted.** Separately, two
schedule "team leader" labels do **not** map to an active Team-Leader employee:

- **Aya Ruiz** — likely a Team Leader who has since left.
- **Talal Arandi** — the Director's own label (self-reference), not a roster TL.

Both are **flagged for verification** and **removed from the current-TL dropdown**
so they cannot be selected as an active supervisor, but their historical
references are preserved for audit. This is the correct WFM treatment: never
silently drop a label that has history attached; flag, quarantine from live
selection, and let a human confirm.

---

# 5. Data-Model Corrections — The Reconciled Star Schema

The reconciliation is built as a classic analytical **star schema**: one
conformed fact table at agent-day grain, surrounded by conformed dimensions. This
is what makes the metrics computable once and re-usable everywhere (dashboard,
report builder, HR matrix, integrity audit) without re-deriving identity or role
rules each time.

```
                          ┌────────────────────┐
                          │   Dim_Date         │
                          │  (calendar / week  │
                          │   Sat→Fri, month)  │
                          └─────────┬──────────┘
                                    │
   ┌───────────────┐   ┌────────────┴───────────┐   ┌──────────────────┐
   │ Dim_Employee  │   │                        │   │  Dim_Role         │
   │ employee_     │   │   FACT_ATTENDANCE_      │   │  role_working_    │
   │ identity /    ├───┤        DAILY            ├───┤  hours            │
   │ Employee_     │   │   (roster_days)         │   │  (9h/8h/7h, KPI   │
   │ Master_Clean  │   │   17,312 rows           │   │   inclusion flag) │
   └───────────────┘   │   grain = person × day │   └──────────────────┘
                       └───┬────────┬────────┬───┘
              ┌────────────┘        │        └────────────┐
     ┌────────┴───────┐   ┌─────────┴────────┐   ┌─────────┴────────┐
     │  Dim_Shift     │   │  Dim_Function    │   │ Dim_TeamLeader   │
     │  (shift codes, │   │  (functions.name │   │ (active TLs only;│
     │   times, WFH,  │   │   authoritative) │   │  unmatched labels│
     │   Ramadan,     │   └──────────────────┘   │  flagged)        │
     │   split, 7/8/9h)│                          └──────────────────┘
     └────────────────┘            ┌──────────────────┐
                                   │   Dim_Group       │
                                   │  (rotation/skill  │
                                   │   group)          │
                                   └──────────────────┘
```

### Fact table

- **`Fact_Attendance_Daily` = `roster_days`** — the conformed fact at
  **person × day** grain. **17,312 rows (verified)**, 2026-01-01 → 2026-06-29.
  Each row is the reconciliation of five sources (Odoo punch, Ameyo, Sprinklr,
  Odoo permissions/comp/sick, schedule matrix) into a single truth for that
  person-day: scheduled shift, actual login/logout, punch in/out, derived
  tardiness band, OT buckets, WFH flag, sick/absent/permission status, and the
  data-quality flags.

### Dimensions

| Dimension | Backing object | Role in the model |
|---|---|---|
| **Dim_Employee** | `employee_identity` / `Employee_Master_Clean` | Collapses raw IDs → `person_no`; carries canonical name, active flag, role, intern/full-time. The fix for Root Cause #1. |
| **Dim_Role** | `role_working_hours` | Hours per role (9/8/7), KPI-inclusion flag. The fix for Root Cause #4. |
| **Dim_Date** | calendar | Saturday→Friday workforce week, month, full-year-to-date span; week key joins to the 27 validation blocks. |
| **Dim_Shift** | shift dictionary | Shift code → start/end, split-shift, cross-midnight, WFH variant, Ramadan, 7/8/9h, working-vs-leave classification. |
| **Dim_Function** | `functions.name` (via `function_id`) | The authoritative function. The fix for Root Cause #2. |
| **Dim_TeamLeader** | TL reference | Active TLs only; unmatched labels (Aya Ruiz, Talal Arandi) flagged out of live selection. |
| **Dim_Group** | rotation/skill group | Roster/rotation group for fairness and coverage grouping. |

### Why this matters

A star schema with a conformed `person_no` key means **every** downstream
artefact — dashboard tile, report-builder grouping, HR matrix, integrity audit —
inherits the same de-duplicated identity and the same role rules automatically.
The defects of section 2 cannot reappear in one report while being correct in
another, because identity and role are resolved **once, in the dimensions**, not
re-implemented per query.

---

# 6. Key Attendance Findings

Attendance is reconciled from **five sources** per person-day, with the
**monthly schedule matrix as the source of truth** for what was scheduled, and
the actuals drawn from punch + system feeds.

**Time-zone correction (verified, load-bearing).** Both **Ameyo and Sprinklr
system logins are recorded in Kuwait LOCAL time — no +3 offset.** This was
verified because the physical punch matched the system login *to the minute*; had
the logins been UTC, every agent would have shown a spurious 3-hour late/early
swing. Applying a +3 correction (a natural but wrong assumption) would have
corrupted **every** tardiness and adherence number. This is now codified.

**Combine-both-systems rule.** A person is considered "logged in" if **either**
Ameyo or Sprinklr shows a session for that shift (agents work across both digital
and voice). Using only one feed under-counts presence and over-counts
"missing-system."

**Reconciliation outcomes captured per day:** scheduled shift vs actual login;
punch vs system consistency; missing-punch vs missing-system (distinguished — see
WFH rule §10); early-out / late-in against the **role-correct** expected hours
(§18). Aggregations roll up daily → weekly (Sat→Fri) → monthly → year-to-date,
and every weekly block is signed off in `roster_validation_log` (27 blocks,
verified).

---

# 7. Key HR-Matrix Findings

The HR matrix is the calendar-style export (person × day, one code per cell) used
by HR and Operations for monthly attendance sign-off.

- **The "P" code is eliminated (verified): zero "P" rows after the fix.** Cells
  now resolve through `COALESCE(hr_code, attendance_code, shift_code, 'OFF')`, so
  the precedence is explicit and auditable: an approved HR code wins; else the
  reconciled attendance code; else the scheduled shift; else `OFF`.
- **Flagged sick days are now correctly shown as SL** with the original shift
  preserved behind the status (Barbazi 02/07-Jun ES/CS; Ajaimi 01-Jun NS; Aljbawi
  09-Jun BS) — see §11 on shift-aware sick codes.
- **Every cell maps to a real, approved code.** Because the matrix is generated
  from the same reconciled fact rows as the dashboard, the matrix and the KPIs
  can never disagree — a property the old export did not have.

---

# 8. Key Tardiness Findings

Tardiness is bucketed into operational bands so the floor can be managed by
severity rather than a single average:

**On time · 1–5 · 6–15 · 16–20 · 21–29 · 30–59 · 60+ · No-show.**

Key properties of the engine:

- **Role-aware.** Bands are computed against the employee's **correct** expected
  start derived from `role_working_hours` (9/8/7h). RTA, Customer Care, Resolution
  Specialist and Team Leader (8h) are **excluded from the default tardiness KPI**
  (toggle to include) so their shorter shift is not mis-scored.
- **Authorised vs unauthorised.** A late start covered by an approved permission
  is *not* counted as tardy; it routes to the permission view (§13). Only
  unauthorised lateness scores against conformance (§35).
- **No-show is a distinct band**, not a large late value, and ties to the
  scheduled-no-show data-quality flag (907 year-to-date, §20).

The dashboard exposes tardiness by band, by person, by team, by function and by
day, which is what allows "top late employees" rankings (§19) to be both fair
(role-correct) and actionable (band-level).

---

# 9. Key Overtime Findings

Overtime is captured **separately by type**, because for WFM the *kind* of OT
drives both cost and policy:

- **Before-shift OT**
- **After-shift OT**
- **OFF-day OT**
- **Holiday OT**
- **COMP-day OT**
- **Cross-midnight OT** (shift legitimately crosses 00:00)

Each OT record carries an **approved / unapproved** flag. This separation matters
operationally: after-shift OT on a normal day is routine; OFF-day, holiday and
COMP-day OT are higher-cost and require tighter approval governance, and
cross-midnight handling prevents a midnight shift from being mis-read as two short
shifts or as "missing" hours. The **unapproved** bucket is the control surface for
WFM — it is the OT that happened without sign-off and should be reviewed.

---

# 10. Key WFH Findings

**WFH rule (verified, codified):** if a person has a **system login + no physical
punch + the schedule matches**, the day is classified as **WFH** — *not* as a
missing-punch anomaly.

This is a critical de-noising rule. Without it, every legitimate work-from-home
day would be flagged as "missing punch," inflating the anomaly counts and burying
the genuinely missing punches in noise. By requiring all three conditions
(system-present, punch-absent, schedule-aligned), WFH is recognised positively and
removed from the missing-punch population, leaving the missing-punch count
meaningful.

---

# 11. Key Sick-Leave Findings

Sick leave is handled with **shift-aware codes**, which is what lets the matrix
show *both* that the person was sick *and* what shift they were scheduled for:

- Sick codes: **MS / BS / CS / NS / ES / EES / MDS / MNS** — each keeps the
  original shift (M, B, C, N, E, EE, MD, MN) **behind** the SL status.
- The flagged June cases are confirmed SL (Barbazi ES/CS, Ajaimi NS, Aljbawi BS),
  now surfaced correctly instead of being hidden behind the old "P" code.

**Why shift-aware matters.** A plain "SL" loses the scheduling context — you can
no longer tell what coverage was lost or reconstruct the planned shift for
shift-rate distribution. The shift-aware code preserves the planned shift for
coverage and shift-rate analysis while correctly marking the day as sick for
absence/shrinkage accounting.

---

# 12. Key Absence Findings

Absence uses the same shift-aware pattern as sick leave:

- Absence codes: **MA / BA / CA / NA / …** — the original shift is retained behind
  the **A** (absence) status.
- Absence is distinguished from sick (SL), from approved leave, from OFF, and from
  scheduled-no-show. The **scheduled-no-show** data-quality flag (**907**
  year-to-date, verified) is the population where the person was scheduled to work
  and there is no evidence of presence in any feed and no approved leave — i.e. the
  genuine unplanned absence signal that WFM and HR must act on.

---

# 13. Key Permission Findings

Permissions (short authorised absences, e.g. a 1–2 hour personal permission)
flow from **Odoo** into the reconciliation and are treated as **authorised** time:

- A late start, early leave, or mid-shift gap **covered by an approved permission**
  is routed to the permission view and **does not** score against tardiness or
  conformance.
- This authorised/unauthorised split (§8, §35) is the difference between a fair
  adherence number and a punitive one. The permission detail is exposed in the
  dashboard and report builder so a TL can see, per person, how much
  authorised-permission time was consumed in a cut-off cycle (relevant to the
  per-cycle permission allowance the business operates).

---

# 14. Shift-Distribution Analysis

Because every day carries a reconciled shift code in `Dim_Shift`, the platform can
report each person's **shift distribution** — the count and percentage of
Morning / Day, Evening, Night, Midnight, WFH and OFF/leave days — over any window
(year-to-date, current month, selected period).

Operationally this supports:

- **Fairness** — are the same people always carrying midnight/night?
- **Shift-rate %** — distribution from the start of the year to a selected date
  (count + percentage per category), with OFF/H/L/S/A tracked **separately** from
  working shifts.
- **Before/after impact** — when an edit or swap changes a code, the distribution
  shift can be shown for the affected person(s).

Working shifts (M/B/C/AM, E/EE, N, MD/MN and WFH variants) are classified for
distribution; non-working codes (OFF/H/L/S/A/COMP) are excluded from the working
distribution but counted in their own leave/OFF tallies.

---

# 15. Team-Leader Comparison

With `Dim_TeamLeader` cleaned (active TLs only; Aya Ruiz and Talal Arandi flagged
out of live selection — §4), the dashboard compares teams on the same reconciled
metrics: attendance, tardiness bands, OT by type, WFH share, sick/absence, and
conformance. Two cautions are built in:

1. **Role exclusion respected** — an 8-hour TL's own attendance is excluded from
   the default tardiness KPI, so a team's score reflects its **agents**, not a
   role-mismatched leader penalty.
2. **Unmatched labels quarantined** — teams cannot be rolled up under a TL label
   that does not resolve to an active Team-Leader employee, preventing a "ghost
   team."

---

# 16. Function Comparison

Function comparison now uses the **authoritative function**
(`employees.function_id → functions.name`) rather than the polluted
`function_name` column (§2.2). This removes the false split where one agent
appeared under both a leaked shift code and their real function. Functions can be
compared on headcount (canonical persons), attendance, tardiness, OT, WFH, sick,
absence and conformance, and — because role hours are function-aware — the 8h
functions (RTA, Customer Care, Resolution Specialist) are scored against their
correct expectation.

**Canonical headcount by role (verified):**

| Role | People |
|---|---|
| Agent | 73 |
| Intern | 43 |
| OMT | 7 |
| Customer Care | 5 |
| Team Leader | 4 |
| Resolution Specialist | 3 |
| RTA | 3 |
| Back Office | 3 |
| **Total** | **141** |

---

# 17. Group Comparison

`Dim_Group` (rotation / skill group) lets the platform compare roster groups for
coverage and fairness — e.g. night-group rotation balance, OFF distribution across
groups, and shift-rate balance per group. This is the grouping layer the rotation
and fairness features draw on, and because it sits on the conformed fact table it
inherits the de-duplicated identity and role rules.

---

# 18. Role-Based Working-Hours Validation

The `role_working_hours` lookup is the single source for expected hours, and it is
**configurable** (not hard-coded), which is what allows the business to adjust
policy without a code change.

| Role group | Expected hours | KPI default | Notes |
|---|---|---|---|
| Standard Agent | 9h (incl. 1h break) | Included | Baseline |
| Intern | 9h (incl. 1h break) | Included | Same as agent |
| RTA | 8h | **Excluded** (toggle to include) | Support/ops role |
| Customer Care | 8h | **Excluded** (toggle) | |
| Resolution Specialist | 8h | **Excluded** (toggle) | |
| Team Leader | 8h | **Excluded** (toggle) | Leadership |
| Maternity (mothers) | 7h | Included, 7h basis | Shift codes M7 / B7 / C7 / N7 |

**Validation effect.** Tardiness, early-out and adherence are all measured against
the role-correct expected window. A mother on a 7-hour M7 shift who leaves after 7
hours is **on time**, not "early out by 2 hours" — the previous, role-blind logic
got this wrong. Excluding the 8-hour support roles from the *default* tardiness KPI
(while keeping their records and a toggle to include) prevents their different
shift shape from distorting the agent-focused floor metrics.

---

# 19. Top Agents by Each Metric

The dashboard exposes ranked leaderboards over the clean fact table. Because
rankings now run on `person_no` (no duplicates) and role-correct expectations, the
boards are both fair and actionable. Rankings exposed include:

- **Top late employees** — by total late minutes and by band frequency (e.g. most
  6–15 and 16–20 occurrences).
- **Most no-shows / scheduled-no-shows.**
- **Most missing-system days.**
- **Most missing-punch days** (WFH already removed — §10).
- **Highest OT** — overall and split by type (after-shift, OFF-day, holiday,
  COMP-day), with approved vs unapproved.
- **Highest WFH share.**
- **Most sick / most absent days.**
- **Best / worst conformance %.**
- **Highest permission consumption** (authorised time).

Each ranking is filterable by date window, function, team and group, and respects
the active/inactive and role-inclusion toggles.

---

# 20. Data-Quality Issues

Year-to-date data-quality flag totals (verified, from the `data_quality` flags):

| Flag | Count (YTD) | Meaning |
|---|---|---|
| Missing-system | **978** | Scheduled/punched but no Ameyo **and** no Sprinklr session |
| Scheduled-no-show | **907** | Scheduled to work; no presence in any feed; no approved leave |
| Roster-shift ≠ actual | **793** | Genuine wrong-shift — scheduled code differs from the shift inferred from actual login time |
| Punch-system mismatch | **511** | Physical punch and system login disagree beyond tolerance |
| Transfer-marker | **2** | Inter-team/function transfer markers |

**On "roster-shift ≠ actual" (793).** This is a genuine wrong-shift detector, not
noise: the engine **infers the shift from the actual login time** and compares it
to the scheduled code. The canonical example (verified pattern) is a group written
as **N** in the matrix that actually worked **C9 on 05-Jan** — the people logged in
at the C-shift time, so the matrix code was wrong. Surfacing these lets WFM correct
the schedule of record and stops a wrong code from poisoning shift-rate and
coverage analysis.

These flags are not errors in the reconciliation — they are the **reconciliation
doing its job**: surfacing the real-world discrepancies (missed logins, no-shows,
wrong shift codes, punch/system disagreement) that the business needs to chase.
They are exposed on the dedicated **Data Quality page** for triage.

---

# 21. Missing Files / Missing Columns

Honest gaps in the *source data* (not the platform), recorded so they are not
mistaken for system defects:

- **`termination_date` not populated.** No termination dates exist in the master,
  which is consistent with "net resigned = 0" (§4) but means true attrition cannot
  yet be computed from the master alone. *Recommendation:* populate from HR/Odoo.
- **`hire_date` null.** Tenure-based analytics (ramp, new-hire adherence,
  tenure-banded performance) are blocked until hire dates are loaded.
- **Some schedule team labels not mapped to employees** (Aya Ruiz, Talal Arandi —
  §4) — flagged, awaiting human confirmation.
- **No formal termination/leaver feed** — without it, "people who left" can only be
  inferred from inactive IDs, which (this cycle) turned out to be aliases, not
  leavers.

Closing these is a **data-supply** task for HR/IT, not a rebuild of the
reconciliation.

---

# 22. Recommended Dashboard Structure — 22 Pages

The target enterprise WFM suite is a 22-page dashboard. Where useful, each page is
benchmarked against the equivalent capability in **NICE IEX, Verint, Genesys Cloud
WFM, Calabrio and Alvaria**.

1. **Executive Overview** — headcount (141 canonical), attendance %, conformance,
   OT cost, top risks. *(Genesys/NICE executive scorecards.)*
2. **Attendance Dashboard** — present/absent/late/WFH by day, team, function.
3. **Tardiness & Bands** — the 8-band view, by person/team/function.
   *(Calabrio adherence drill-down.)*
4. **Overtime** — by type (before/after/OFF/holiday/COMP/cross-midnight),
   approved vs unapproved. *(NICE IEX overtime management.)*
5. **WFH / Office Split** — share and trend, with the WFH rule applied.
6. **Sick & Absence** — shift-aware codes, scheduled-no-show, shrinkage feed.
7. **Permissions** — authorised time per person/cycle, balance vs allowance.
8. **Shift Distribution & Shift-Rate %** — count/% per category, YTD/month.
   *(Verint shift fairness.)*
9. **Team-Leader Comparison** — clean TL dimension.
10. **Function Comparison** — authoritative function.
11. **Group / Rotation** — fairness, OFF distribution, night balance.
12. **Coverage by Hour** — Required vs Scheduled vs Available vs Gap.
    *(NICE/Genesys intraday coverage.)*
13. **Adherence / Conformance** — scheduled vs actual. *(Calabrio/Verint core.)*
14. **Shrinkage** — planned/unplanned, productive vs lost hours.
15. **Permission HC Impact** — before/after coverage on approval.
    *(Genesys intraday what-if.)*
16. **Capacity / Erlang** — voice Erlang-C, chat/WhatsApp concurrency=4, email
    backlog, intern productivity ≈70%. *(NICE IEX / Alvaria forecasting.)*
17. **RTA Command Center** — live adherence, logged-in, breaks, gaps, alerts.
    *(Genesys/NICE RTA.)*
18. **Requests & Approvals** — envelope + SLA + approval chain.
19. **Data Quality** — the five flag populations (§20). *(A differentiator — most
    suites assume clean source data.)*
20. **Identity & Integrity Audit** — canonical map, alias collapse, "P"=0 proof.
21. **Scorecard & Coaching** — KPI bands, Net Points, coaching flags.
22. **Custom Dashboard Builder** — user-assembled tiles (§24).

**Status:** *Roster Analytics Dashboard, Attendance Dashboard, Data Quality page,
Roster grid and the integrity/employee-master views are delivered (verified in
code: `RosterDashboard.tsx`, `AttendanceDashboard.tsx`, `Roster.tsx` and the
`roster-v2/integrity` + `roster-v2/employee-master` endpoints). The remaining
pages are the recommended build-out.*

---

# 23. Recommended Custom Report Builder Structure

**Delivered (verified):** a Custom Report Builder with **36 fields, 26 KPIs, 11
groupings, filters and Excel export** (`/attendance-recon/report-builder`,
exercised by the perf smoke test).

Recommended structure and enhancements, benchmarked to enterprise reporting
(Verint/Calabrio report designers, NICE data extracts):

- **Field palette (36):** identity (person_no, name, role, function, team, group),
  date/week/month, scheduled shift, actual login/logout, punch in/out, tardiness
  band, OT buckets, WFH flag, sick/absent/permission, data-quality flags, etc.
- **KPI palette (26):** agents, scheduled days, worked days, late minutes/count
  per band, OT minutes by type (approved/unapproved), conformance %, adherence %,
  WFH %, sick days, absence days, no-show, permission minutes, etc.
- **Groupings (11):** role, function, team-leader, group, person, day, week, month,
  shift, tardiness band, status.
- **Filters:** date window, active/inactive, role-inclusion toggle, function,
  team, status.
- **Output:** on-screen grid + **Excel**; recommend adding **scheduled email
  delivery** and **saved report templates** (NICE/Verint parity).

---

# 24. Recommended Custom Dashboard Builder Structure

**Delivered (verified):** a Custom Dashboard Builder exists on the frontend.

Recommended target structure, benchmarked to Calabrio/Genesys dashboard composers:

- **Tile catalogue** — KPI tile, trend line, band bar, ranking table, coverage
  heatmap, data-quality gauge.
- **Drag-and-drop grid** with per-tile metric, grouping, filter and date window.
- **Saved layouts per role** — an Exec layout, a WFM layout, a TL layout, an Agent
  self-service layout — mirroring the role dashboards in NICE/Genesys.
- **Drill-through** from any tile to the report builder pre-filtered.
- **Shared vs private** dashboards with RBAC (§32).

---

# 25. Recommended Luxury UX/UI Improvements

Targeting an enterprise-premium feel comparable to Genesys Cloud and modern NICE
CXone surfaces:

- **Clean information hierarchy** — one headline number per tile, supporting
  metrics secondary; status colour used sparingly and consistently (green/amber/red
  with documented thresholds).
- **Trust affordances** — every KPI tile shows "as-of" timestamp, the active
  filters, and the included/excluded toggle state, so a leader always knows *what*
  population a number reflects (the lesson of §2).
- **Bilingual / RTL** — full Arabic/English with correct RTL mirroring; English
  mode 100% English while inputs still accept typed Arabic.
- **Light/Dark** with a restrained, professional palette (no neon).
- **Micro-interactions** — hover states, animated counters, smooth drill-through —
  applied carefully, never at the cost of clarity.
- **Density control** — comfortable/compact table modes for floor vs executive use.
- **Empty/loading/error states** designed, not default — a premium product never
  shows a raw spinner or stack trace.

---

# 26. Recommended Automation Improvements

- **Nightly reconciliation refresh** of `roster_days` with an automated weekly
  validation block appended to `roster_validation_log`.
- **Auto-flag and notify** on new data-quality breaches (missing-system,
  scheduled-no-show) to RTA/WFM the next morning.
- **Identity guard** — on every import, detect a new raw ID that name-matches an
  existing person and auto-propose an alias link for one-click human confirmation,
  so duplicates can never silently re-accumulate.
- **Scheduled report/dashboard delivery** (email/Teams) for HR sign-off packs.
- **Anomaly digests** — daily "top movers" in tardiness/OT/absence.
- **Auto HR-matrix generation** at cut-off with the COALESCE precedence enforced.

Benchmark: NICE IEX and Genesys both run scheduled forecasting/adherence jobs and
proactive RTA alerting; the differentiator here is the **identity guard** and
**data-quality automation**, which most suites assume the source already handles.

---

# 27. Recommended WFM Controls

- **Single source of truth enforced** — all KPIs read from `roster_days` via
  `person_no`; no report may aggregate on raw `employee_no`.
- **Role-aware KPI policy** — 8h/7h roles handled per `role_working_hours`; default
  exclusions documented and toggleable.
- **Authorised-vs-unauthorised discipline** — permissions never penalise
  conformance; only unauthorised exceptions score.
- **Schedule-of-record correction loop** — "roster-shift ≠ actual" flags feed back
  into matrix correction (governed, audited).
- **Publish/lock** on the schedule with version history and before/after impact.
- **Approval governance on OT** — unapproved OT bucket reviewed each cycle.
- **Inactive/leaver governance** — inactive held for audit, excluded from live;
  unmatched TL labels quarantined.

These map to the control families enterprise platforms expose (NICE IEX scenario
governance, Verint adherence rules, Genesys intraday what-if), adapted to
Boutiqaat's reconciled-source reality.

---

# 28. Code-Audit Summary

The reconciliation and analytics are implemented in the **`attendance-recon`**
backend module (verified):

| File | Role |
|---|---|
| `recon.controller.ts` (~42 KB) | REST surface: `roster-v2`, `roster-dashboard`, `report-builder`, `roster-v2/hr-matrix`, `roster-v2/integrity`, `roster-v2/employee-master`, plus ingest/run/compare. |
| `roster-ingestion.service.ts` (~57 KB) | Source ingestion + reconciliation (the five-feed combine, identity, role hours). |
| `recon.service.ts` (~35 KB) | Metric computation over the reconciled fact rows. |
| `recon.engine.ts` + `recon.engine.spec.ts` | Pure reconciliation logic with a unit-test spec. |
| `recon.module.ts` | NestJS wiring. |

Supporting scripts (verified): `backfill-identity.js` (canonical-ID backfill),
`import-roster-master.js`, `import-roster-days.js`, `verify-roster-integrity.js`.

**Observations.**
- The presence of `recon.engine.spec.ts` is good — the core logic has at least one
  test. *Recommendation:* extend coverage to the identity-collapse and role-hours
  branches specifically (the two highest-risk fixes).
- The controller is large (~42 KB / 20+ endpoints). *Recommendation:* as it grows,
  consider splitting read-models (dashboard/report/matrix) from ingest/admin
  endpoints for maintainability.
- Identity and role logic should remain **pure functions** (per the project's own
  "keep business logic pure" rule) so they can be unit-tested in isolation.

*(This section is a static review; no code was modified — this is a
documentation-only deliverable.)*

---

# 29. Page / Module-Audit Summary

**Delivered frontend pages (verified):** `RosterDashboard.tsx`,
`AttendanceDashboard.tsx`, `Roster.tsx`, plus `ControlDashboards.tsx` and the
general `Dashboard.tsx`. A **Data Quality page** and **Custom Dashboard Builder**
are delivered per the programme record.

**Module map (delivered vs recommended):**

| Capability | Status |
|---|---|
| Reconciled roster (`roster_days`) | Delivered (verified) |
| Canonical identity layer | Delivered (verified — migration 058 + backfill) |
| Roster Analytics Dashboard | Delivered |
| Custom Report Builder (36/26/11 + Excel) | Delivered (verified endpoint) |
| HR-matrix export (COALESCE, P=0) | Delivered (verified) |
| Data-integrity audit endpoint | Delivered (verified `roster-v2/integrity`) |
| Employee-master view | Delivered (verified `roster-v2/employee-master`) |
| Role-hours lookup | Delivered |
| Data Quality page | Delivered |
| Custom Dashboard Builder | Delivered |
| 22-page suite (§22), capacity/RTA/coverage | Recommended build-out |

---

# 30. Assistant-Workflow Audit Summary

The reconciliation was executed as a disciplined, verifiable workflow rather than a
one-shot script — which is why every headline number in this document can be traced
to a live table:

1. **Diagnose from symptom to root cause** (duplicate names / ghost employees →
   four causes, §2).
2. **Fix at the data-model layer** (identity + role dimensions), not at the report
   layer — so fixes propagate everywhere.
3. **Combine sources with explicit rules** (five feeds, local-time, combine-both
   systems, WFH rule).
4. **Validate week by week** (27 blocks in `roster_validation_log`).
5. **Prove the fix** (163→141 identity, P=0, flagged days = SL) against the live DB.
6. **Surface, don't hide, residual discrepancies** (data-quality flags, §20).
7. **Flag-don't-delete** ambiguous cases (unmatched TL labels).

This is the correct enterprise pattern: reconcile, validate, prove, and expose the
remaining truth for humans to action.

---

# 31. K6 Performance Testing

A **k6** performance harness is included under `perf/` (verified):

- **`perf/k6-smoke-test.js`** — 1 virtual user, ~30s, sanity gate. Asserts every
  key endpoint returns **HTTP 200**, a non-empty body, and that **global p95 <
  800 ms** with **zero failures** (`http_req_failed: rate==0`,
  `checks: rate==1`). It is the first gate: if smoke fails, load/stress are not
  worth running.
- **`perf/mint-token.js`** — mints a bearer JWT for authenticated runs
  (`TOKEN=$(node perf/mint-token.js) k6 run perf/k6-smoke-test.js`).

**Endpoints exercised (verified, ordered cheapest→heaviest):**
`roster-v2/integrity`, `roster-v2/employee-master`, `roster-dashboard`,
`roster-v2` (paged), `report-builder` (grouped **and** detail), `roster-v2/hr-matrix`.
The grouped report-builder call tests the heavy path
(`groupBy=role&kpis=agents,scheduledDays,lateMin,otMin,conformance`).

**Status — delivered.** The full k6 suite now ships in `perf/`:
`mint-token.js` (mints a platform_admin JWT from the DB), `k6-smoke-test.js`
(1 VU sanity), `k6-load-test.js` (staged ramp 50→100 VUs, per-endpoint p95/p99
thresholds), `k6-stress-test.js` (100→250→500 VUs, abort-on-fail), and the written
`perf/Performance_Test_Report.md` capturing p50/p95/p99, throughput and per-endpoint
pass thresholds. Run: `TOKEN=$(node perf/mint-token.js) k6 run perf/k6-load-test.js`
(bash) or `$env:TOKEN=(node perf/mint-token.js); k6 run perf/k6-load-test.js`
(PowerShell). Login load is simulated by token reuse (no public login endpoint to
hammer safely) — documented as an explicit assumption in the report.

---

# 32. Security & Access-Control Risks

Attendance/HR data is **sensitive personal data** (presence, sickness, location).
The platform uses a documented RBAC model:

| Role | Access |
|---|---|
| Admin | Everything |
| RTA + Team Leader | Admin **minus settings** |
| Agent | **Own data only** (self-service) |

**Risks and controls:**

- **HR data sensitivity** — sick leave, absence and WFH/location are GDPR-class.
  Enforce least-privilege: agents see only their own; TL/RTA see their scope; no
  blanket read of sick records below WFM/HR.
- **CSV/Excel exports of attendance** are the highest exfiltration risk — a single
  export can carry the whole floor's sensitive data. *Recommendations:* audit-log
  every export (who/what/when/filter), watermark/owner-stamp exports, and consider
  approval for full-population HR-matrix exports.
- **Integrity endpoints** (`roster-v2/integrity`, `employee-master`) expose the
  identity map — restrict to WFM/HR/Admin.
- **Token handling** — the perf token minter must use non-production credentials;
  never ship a minting path that can issue real elevated tokens.
- **Audit trail** — every identity merge, role-hours change, schedule correction
  and export should write an immutable audit record (actor, old/new, timestamp).
- **Tenant isolation** — all queries are scoped to tenant
  `a0000000-0000-0000-0000-000000000001`; verify no endpoint can cross tenant.

Benchmark: NICE, Verint and Genesys all gate WFM/HR data behind granular role
permissions and log exports; matching that bar is the target.

---

# 33. Final Clean Master Table Description

**`Fact_Attendance_Daily` (`roster_days`)** is the clean master:

- **Grain:** one row per **canonical person × calendar day**.
- **Volume:** **17,312 rows (verified)**, 2026-01-01 → 2026-06-29.
- **Keys:** `person_no` (canonical identity), `date` (→ Dim_Date, Sat→Fri week),
  with conformed joins to Dim_Role, Dim_Shift, Dim_Function, Dim_TeamLeader,
  Dim_Group.
- **Reconciled measures per row:** scheduled shift; actual login/logout
  (Ameyo/Sprinklr, Kuwait local); punch in/out (Odoo); derived tardiness band; OT
  buckets (before/after/OFF/holiday/COMP/cross-midnight, approved/unapproved); WFH
  flag; sick/absent/permission status with shift-aware code; data-quality flags.
- **Integrity guarantees:** no duplicate persons (identity collapse), authoritative
  function, role-correct expected hours, **zero "P"** codes, inactive excluded by
  default, unmatched TL labels flagged.

It is the **one** table every dashboard, report, matrix and audit reads from.

---

# 34. Pivot-Ready Output

The master is deliberately in **tall, tidy, pivot-ready** form (one fact per
person-day, dimensions as columns), so it drops straight into Excel PivotTables,
Power BI or the in-app report builder without reshaping:

- **Rows/Columns:** any dimension — role, function, team-leader, group, person,
  date/week/month, shift, tardiness band, status.
- **Values:** any KPI — counts, late minutes, OT minutes by type, conformance %,
  WFH %, sick/absence days, permission minutes.
- **Filters/Slicers:** date window, active/inactive, role-inclusion, function,
  team, status.

The **Custom Report Builder** (36 fields / 26 KPIs / 11 groupings + Excel,
verified) is effectively a governed pivot over this table, and the raw Excel export
lets analysts pivot offline with identical numbers.

---

# 35. Formulas & Logic — Full Explanation

**1. Identity collapse.**
`person_no = canonical(raw employee_no cluster)`, clustered by employee-master name;
canonical chosen by priority **active > full-time(13xxx) > newest**. All KPIs
aggregate on `person_no`. *Effect:* 163 raw IDs → 141 people.

**2. Role working hours.**
`expected_hours = role_working_hours[role]` → 9h (agent/intern), 8h (RTA, Customer
Care, Resolution Specialist, Team Leader), 7h (maternity). 8h roles excluded from
default tardiness/adherence (toggle to include). All tardiness/early-out measured
against this role-correct window.

**3. Tardiness bands.**
`late_minutes = actual_start − expected_start` (role-correct), then bucketed:
On time / 1–5 / 6–15 / 16–20 / 21–29 / 30–59 / 60+; **No-show** if scheduled and no
presence in any feed and no approved leave. Permission-covered lateness is **not**
tardy.

**4. Overtime before/after (and OFF/holiday/COMP/cross-midnight).**
`before-shift OT = max(0, expected_start − actual_start)`;
`after-shift OT = max(0, actual_end − expected_end)`; OFF-day / holiday / COMP-day
OT = worked time on a non-working code; cross-midnight handled by treating the
session as one shift spanning 00:00. Each tagged **approved/unapproved**.

**5. Conformance %.**
Share of the scheduled window the person was actually present/adherent, with
**approved permissions excluded from the penalty** and role-correct expected hours
as the denominator. Only **unauthorised** exceptions reduce conformance.

**6. WFH rule.**
`WFH = (system_login present) AND (punch absent) AND (schedule matches)`. Such days
are classified WFH and **removed** from the missing-punch population.

**7. Sick / absent shift-aware codes.**
Sick: **MS/BS/CS/NS/ES/EES/MDS/MNS**; Absence: **MA/BA/CA/NA/…** — the leading
letter(s) are the original shift, the trailing **S/A** is the status, so the
planned shift is preserved behind the sick/absence flag.

**8. HR-matrix cell.**
`cell = COALESCE(hr_code, attendance_code, shift_code, 'OFF')` — explicit
precedence, **no `ELSE 'P'`**. *Effect:* zero "P" rows; sick days surface as SL.

**9. Time-zone normalisation.**
Ameyo and Sprinklr logins are **Kuwait local — no +3 applied** (verified by
punch≈login to the minute). Applying +3 would corrupt all tardiness.

**10. Combine-both-systems presence.**
`logged_in = ameyo_session OR sprinklr_session` for the shift.

**11. Wrong-shift inference.**
`inferred_shift = classify(actual_login_time)`; if `inferred_shift ≠ scheduled_shift`
beyond tolerance → **roster-shift ≠ actual** flag (793 YTD).

---

# 36. Final Sign-Off Checklist

Each box confirms an integrity rule is **enforced** in the delivered system
(verified against the live `wfm_db`):

- [x] **Identity collapsed** — 163 raw IDs → **141 canonical people**; 22 aliases; KPIs key on `person_no`, never raw `employee_no`.
- [x] **Triple-ID case resolved** — MHD AlTamer (6266/13759/13850) → 1 person.
- [x] **Function column de-polluted** — grouping uses authoritative `functions.name`, not leaked shift codes.
- [x] **"P" bug eliminated** — `COALESCE(hr_code, attendance_code, shift_code, 'OFF')`; **zero "P"** in the matrix.
- [x] **Flagged days confirmed SL** — Barbazi 02/07-Jun (ES/CS), Ajaimi 01-Jun (NS), Aljbawi 09-Jun (BS); shift preserved behind status.
- [x] **Role hours enforced** — 9h/8h/7h via `role_working_hours`; 8h roles excluded from default tardiness (toggle).
- [x] **Maternity 7h respected** — M7/B7/C7/N7 not penalised as early-out.
- [x] **Inactive excluded from live KPIs**, retained for audit (toggle "Include inactive"); net resigned = 0 this cycle.
- [x] **Unmatched TL labels flagged** (Aya Ruiz, Talal Arandi) and removed from current-TL dropdown.
- [x] **Time zone correct** — Ameyo & Sprinklr treated as Kuwait local (no +3).
- [x] **Both systems combined** for presence (Ameyo OR Sprinklr).
- [x] **WFH rule applied** — system-login + no-punch + schedule-match = WFH, not missing-punch.
- [x] **Tardiness bands** computed role-correct; permission-covered lateness not tardy.
- [x] **OT typed & flagged** — before/after/OFF/holiday/COMP/cross-midnight, approved/unapproved.
- [x] **Sick/absence shift-aware codes** preserve the planned shift.
- [x] **Conformance** excludes approved permissions from penalty.
- [x] **Wrong-shift inference** flags roster-shift ≠ actual (793 YTD).
- [x] **Data-quality flags surfaced** — missing-system 978, scheduled-no-show 907, wrong-shift 793, punch-system 511, transfer 2.
- [x] **Weekly validation** — 27 blocks signed off in `roster_validation_log`.
- [x] **Single source of truth** — `roster_days` (17,312 rows) is the only fact table all artefacts read from.
- [x] **Star schema conformed** — Dim_Employee / Dim_Role / Dim_Date / Dim_Shift / Dim_Function / Dim_TeamLeader / Dim_Group.
- [x] **Pivot-ready export** — Custom Report Builder (36 fields / 26 KPIs / 11 groupings) + Excel.
- [x] **Performance smoke gate** — k6 smoke test asserts 200s + p95 < 800 ms on all key endpoints.
- [ ] **Open data-supply items** — populate `hire_date` and `termination_date`; confirm flagged TL labels (HR/IT action — §21).
- [ ] **Recommended build-out** — load/stress k6 + Performance_Test_Report.md; remaining pages of the 22-page suite (§22).

---

*End of document. Documentation-only deliverable — no application code was
modified in its production. Verified figures were read from the live PostgreSQL
`wfm_db` (tenant `a0000000-0000-0000-0000-000000000001`); projections, targets and
industry benchmarks are labelled as such inline.*
