# WFM Platform — Master Audit
### Deep, page-by-page, evidence-led. Started 2026-08-04.
### This file is the record. It outlives any session and is never reset — findings change STATUS, they are not deleted.

---

## 0. How this audit works, and why the previous ones missed things

Several reviews of this system have been declared complete, and each time defects surfaced
afterwards. The reason is not that the reviewers were careless. It is structural:

1. **Findings lived in a conversation.** When the session ended, the working set was gone.
   The next review restarted from zero and re-covered the easy ground.
2. **"It loads" was accepted as "it works."** A 200 with zero rows renders an empty page. A
   number that returns is not a number that is right.
3. **Breadth was chosen over depth.** Eighty pages skimmed produces exactly the surface
   review that keeps failing.

This audit inverts all three. Findings are written **here, on disk, immediately**. Nothing is
recorded as working without stated evidence. Pages are finished, not visited.

### The bar for each claim

| Claim | What is required before it may be written |
|---|---|
| "works" | The specific test run, and its result |
| "wrong" | Actual behaviour · expected behaviour · root cause · blast radius · fix |
| "missing" | Why it is needed, where it belongs, who needs it |
| "fixed" | The fix, plus a re-test, plus a regression check on dependants |

### Finding status vocabulary

`OPEN` · `VERIFIED` (reproduced with evidence) · `FIXED` (fix + re-test recorded) ·
`FALSE` (investigated and disproved — kept, because a disproved finding is knowledge) ·
`BLOCKED` (cannot progress; blocker named) · `DIRECTOR` (needs a business decision)

---

## 1. System map — discovered independently

| Layer | Extent |
|---|---|
| Frontend routes | **73** (`frontend/src/App.tsx`) |
| Backend modules | ~60 (`backend/src/modules/`) |
| Live database | PostgreSQL `wfm_db` · 125 tables · **21,588** active roster rows · 140 people · 18 functions |
| Canonical spine | `roster_days` (74 cols) — built by `backend/scripts/recon-*.js` from the Director's month files |
| Data span | 2026-01-01 → 2026-08-01 |
| Roles | Platform Admin · WFM Analyst · RTA Agent · Team Leader · HR Specialist · Agent |

### Coverage state

| | Pages | Status |
|---|---|---|
| Proven to the bar above | Roster (grid · trust · decision queue · explain chain) | Prior sessions + today |
| Endpoint surface discovered | **261 real API paths** harvested from every UI call site | This session — the true audit surface |
| Swept at endpoint level | 44 *guessed* endpoints × 6 roles = 196 checks | **Discarded** — see F-004; the guessed list produced only false positives |
| Not yet audited | ~65 routes | **OPEN** |

> **Honest statement of position.** One page audited to the standard this document sets took
> the better part of a day, and still surfaced three defects after it had been called verified.
> Seventy-three routes cannot be done to that standard in one session. What exists now is a
> real system map, a repeatable sweep harness, and four findings — three of which are
> corrections to my own false alarms. The remaining routes are listed as OPEN, in dependency
> order, so the next session resumes mid-investigation rather than restarting.

---

## 2. Findings

### F-001 · The audit sweep's own role assumptions were wrong — `FALSE`

**Claimed:** WFM Analyst reaching `/users` and `/settings` is a privilege leak (2 × HIGH).

**Investigated:** queried the live permission model rather than trusting the probe's assumption.

```
settings.view : Platform Admin · RTA Agent · Team Leader · WFM Analyst
users.view    : Platform Admin · WFM Analyst
```

**Verdict: FALSE.** `users.view` is granted to WFM Analyst by design. The probe hard-coded
`adminOnly` on those two paths without consulting the permission table.

**Kept because it is knowledge:** an access audit that asserts a tier model instead of reading
the granted permissions will manufacture leaks. `scripts/audit-sweep.js` must be driven from
`role_permissions`, not from a constant in the script. → **A-1** below.

---

### F-002 · "HR and Agent cannot log in" — `FALSE`

**Claimed:** two roles fail authentication (2 × HIGH).

**Investigated:** re-tested in isolation → `429 ThrottlerException: Too Many Requests`.

**Verdict: FALSE.** The sweep logs in six roles per run and had been run repeatedly; it tripped
the platform's own login rate limit. The roles authenticate correctly.

**Kept because it is knowledge:** a harness that exhausts a shared resource reports the
exhaustion as a product defect. The sweep must reuse tokens across runs. → **A-2** below.

---

### F-003 · Login throttle may be tight for a shift change — `OPEN · DIRECTOR`

**Observed:** six sequential logins inside a few minutes returned 429.

**Why it may matter:** at shift change, a cohort of agents signs in within the same few
minutes from the same office egress IP. If the throttle counts per IP rather than per
account, a normal shift start could lock out real staff.

**Not yet established:** whether the limit is per-IP or per-account, and what the window is.
Until that is known this is a question, not a defect.

**Next step:** read the throttler configuration; if per-IP, model a 40-agent shift change
against the window.

---

### F-004 · Sixteen endpoints returned 404 to an admin — `FALSE`

**Claimed:** sixteen admin-reachable endpoints return 404, suggesting broken page↔API wiring.

**Investigated:** harvested the API paths the frontend *actually* calls, from every
`apiClient.get/post` call site under `frontend/src/pages/` — **261 distinct real paths**. Then
checked each 404 against that list.

```
/breaks/today            0 call sites in the UI
/scorecard/monthly       0
/attrition/summary       0
/productivity/summary    0
/reports/catalogue       0
/import/batches          0
/coaching                0   — the UI calls /coaching/scan and /coaching/flags/:id/...
/audit-log               0   — the UI calls /schedule/audit-log, which the sweep already passed
```

**Verdict: FALSE — all sixteen.** Every path was invented by the probe. Not one is called by
any page. The two that looked plausible resolve to different real routes that already pass.

**Kept because it is the most important result of this session:** three of the four findings
this sweep produced were false, and the fourth is a question rather than a defect. A harness
that guesses its inputs manufactures defects at a high rate — and a review carrying that noise
is exactly the kind that gets declared complete while real problems survive. The correction is
already known (**A-3**): the endpoint list must be *harvested*, never *assumed*. The harvested
list of 261 paths is the true audit surface and replaces the guessed one.

---

## 3. Harness corrections required before the sweep is trustworthy

| # | Correction | Reason |
|---|---|---|
| **A-1** | Drive role expectations from `role_permissions`, not a hard-coded tier | F-001 — the probe invented a model and then found it violated |
| **A-2** | Cache tokens to disk between runs | F-002 — the probe DOSed the login endpoint and blamed the product |
| **A-3** | Harvest endpoint paths from frontend `apiClient` call sites | F-004 — guessed paths produce phantom 404s and hide real ones |
| **A-4** | Assert row-shape per endpoint, not just count | A 200 with rows can still carry wrong columns |

Until A-1 to A-3 land, **no sweep output may be promoted to a finding without individual
verification** — as was done for F-001 and F-002.

---

## 4. Audit queue — remaining routes, in dependency order

Dependency order, not alphabetical: a page is audited after the data it reads has been proven,
so a defect found downstream is genuinely the page's own and not inherited.

| # | Surface | Depends on | Status |
|---|---|---|---|
| 1 | Roster + Reconciliation | recon engine | **DONE** (prior + today) |
| 2 | Schedule · Generator · Change Log | roster_days, shift dictionary | OPEN |
| 3 | Capacity · Forecasting · Interval HC | schedule, demand model | OPEN |
| 4 | Live Ops / RTA · Coverage | schedule, Sprinklr feed | OPEN |
| 5 | Requests · Permissions · Breaks · Leave · Calendar | roster, coverage | OPEN |
| 6 | Scorecard · Agent Scores · Trends · Coaching | scorecard_monthly | OPEN |
| 7 | People — Employees · 360s · Skills · Attrition · Productivity | identity model | OPEN |
| 8 | Analytics · Report Builder · Dashboard Builder · Report Library | every source above | OPEN |
| 9 | Executive — Command Center · Control Dashboards · WFM Overview | every source above | OPEN |
| 10 | Admin — Users · Settings · Import · Employee Merge · Audit | RBAC | OPEN |
| 11 | Integrations — Odoo · Ameyo · Sprinklr · Health | bridges | OPEN |
| 12 | AI Guard team — Chief · guards · bots · ledger | agent bus | OPEN |

### Per-page method (the standard each queue item must meet)

1. Read the page source; list every API it calls and every number it renders.
2. Drive it in the browser as Admin, WFM, RTA, TL, Agent — including the empty and error states.
3. Trace each displayed number to its SQL, and recompute it independently.
4. Attempt to break it: bad dates, absent data, conflicting edits, repeated submits, a role
   that should be refused.
5. Change something, then verify every dependent surface moved with it.
6. Fix root causes. Re-test. Regression-test dependants.
7. Record here — evidence, not adjective.

---

## 5. Carried forward from earlier work — still open

| Item | Status |
|---|---|
| Jan–June built on superseded engine rules — 10,438 scored days, 87% of the year | **DIRECTOR** — needs full month source files; cannot be rebuilt from the partial slices held |
| Two record-only employees show `presence='absent'` / `hr_code='A'` on 10 person-days despite `location='WFH'` — contradicts BR-WFH-001 | **DIRECTOR** — fix identified, awaiting approval as it changes stored values |
| Generator write paths (`save`, `generate-demand/save`, `versions/:id/publish`) do not invalidate the roster read cache | **OPEN** — same class as the editCell defect fixed today; not yet confirmed whether these affect the grid the user watches |
| 187 open decision-queue items (July) | **DIRECTOR** — requires operational knowledge to settle |

---

## 6. Fixed this session — with evidence

| Fix | Evidence |
|---|---|
| `PATCH /schedule/cell` never invalidated the roster read cache — edits were invisible for up to 90s and read as "the edit does nothing" | Warm cache `09:00-18:00` → edit to C → immediate re-read `11:00-20:00`. Test employee restored to the original B shift and verified. |
| Same gap in `PATCH /schedule/week-status` and `POST /schedule-changes/:id/approve` | Both now invalidate; build clean |
| `--dry-run` did not exist despite being relied upon; a refresh wrote 828 rows live on the belief a flag gated it | Dry run proven: live `21588 \| 2026-08-01 \| 94.40` before and after, byte-identical. `recon-diff.js` reports arriving/leaving/changed/identical and exits non-zero on loss. |

---

*Every entry above states how it was established. Where something is not yet established, it
says so and names the next step. Nothing in this document is an adjective.*

---

### F-005 · Sweep v2 — the corrected harness, and what it found — `VERIFIED`

The harness corrections A-1/A-2/A-3 are implemented. `scripts/audit-sweep.js` now harvests its
endpoints from every `apiClient.get` call site, reads role expectations from `role_permissions`,
and caches tokens so the login throttle is never the thing under test.

**Result over the real surface — 108 harvested GET paths × 6 roles = 756 checks:**

```
HIGH 0 · REVIEW 8 · LOW 1
```

Zero server errors. Zero 404s. Every role authenticated:

```
admin  Platform Admin   73 perms      hr     HR Specialist   17 perms
wfm    WFM Analyst      68 perms      agent  Agent           11 perms
rta    RTA Agent        65 perms
tl     Team Leader      65 perms
```

That statement is worth something, unlike v1's. It is bounded honestly: it proves the endpoints
respond and are permission-gated. It does NOT prove the numbers they return are correct — that
is the page-by-page work still queued.

**The 8 REVIEW items, judged individually:**

Seven are reference catalogues an agent legitimately needs to render their own screens —
`/breaks/types`, `/chat/users`, `/knowledge-base/categories`, `/schedule/available-weeks`,
`/schedule/functions`, `/settings/functions`, `/settings/shift-codes` (the 142-code dictionary).
Row parity with admin is correct for a catalogue. **CLOSED — not defects.**

---

### F-006 · `/requests/employees` exposes `gender` to every agent — `OPEN · DIRECTOR`

**Established:** an Agent calling `/requests/employees` receives 100 colleague records with
fields `id · employee_no · gender · full_name · function_name · function_id · team_name` —
byte-identical to what Platform Admin receives.

**Why most of it is right:** an agent raising a shift swap must pick a colleague, so name,
employee number, function and team are necessary.

**Why `gender` is a question:** it is personal data on 100 colleagues handed to every agent.
There IS a defensible reason — BR-GEN-001 means a swap placing a female agent on MD/MN is
invalid, so the picker may filter candidates by gender to stop an invalid proposal being made.

**Not changed, deliberately.** Removing the field could break swap validation; leaving it is a
privacy choice that belongs to the Directorate, not to me. Two clean options:

1. Keep it, and record the business justification (swap eligibility) against the field.
2. Remove `gender` from the payload and enforce the female-shift rule server-side at
   submission, where it is enforced anyway — the client then never needs the attribute.

Option 2 is the stronger design: the rule is already validated on the server, so the client
holding the attribute buys nothing and costs privacy.

---

## Queue item 2 — Schedule & Generator

### F-007 · Business rules are enforced where the system AUTHORS a schedule, and nowhere on the path every live row actually takes — `FIXED (partial)`

**How it surfaced.** `scripts/audit-schedule.js` checks the agreed scheduling rules against
live data rather than against the code that claims to implement them.

**Established, from the database:**

```
female agents on midnight shifts   138 person-days · 11 women · ZERO flagged
   worst: one agent, 56 MD days, 2026-03-11 → 2026-08-01
minimum-rest breaches (<10h)        10 in July alone · worst 360 min (6h) · ZERO flagged
3+ consecutive OFF days              7 occurrences June onward   · ZERO flagged

engine data_quality flags in total  4,179
   ...of which rest-rule flags           0
   ...of which gender-rule flags         0
```

**Root cause.** The rules ARE implemented — in `schedule-generator/generator.engine.ts`
(`femaleNightViolation`, `femaleRule`, `genderCheck`, 21 references to `femaleLate`). That
engine validates a schedule the platform *generates*. **Every row in this database arrives
through the recon ingest instead**, and that path carries `gender` as a field (recon-build.js
lines 81, 527, 544) while never once testing it. The generator guards a door the data does not
use.

**Why it matters beyond the count.** BR-GEN-003 does not forbid a midnight assignment outright
— it permits an explicit, logged, audited override, because coverage is the governing priority.
So the defect is not that these women worked nights. It is that **an override nobody can see is
not an override**; it is an absence of record. The rule's own enforcement clause ("the system
must flag violations clearly") was the part not built.

**Fix implemented.** `recon-build.js` now raises a rule flag on the ingest path, and Data Trust
carries it as its own queue, listed first and toned `rose` — a rule breach is not a
data-quality problem and must not read like one.

**Verified live:**

```
dry run → diff → promote → restart → API
  ARRIVING 0 · LEAVING 0 · CHANGED 1 (from the source file, not this change)
  scored days 747→747 · conformance 93.7→93.7 · TRUE_OT 3520→3520 · absent 22→22
  GOLDEN MASTER PASS

  Data Trust now returns:  rule_female_midnight — 6 days · 1 person
```

Zero numbers moved. `data_quality` does not feed `include_tardiness` or any score — that comes
from the evidence path — so the flag adds visibility without touching a figure.

**A judgement made during the fix, and why.** The first version also flagged female agents on
the N shift. It produced **46 flags in one week against 6 midnight days**. BR-GEN-002 permits
the N shift where operationally necessary, and the measurement says it is routine rather than
exceptional — so flagging it per day buries the six that are a real breach. That is precisely
the failure this audit document warns about: a check that cries wolf teaches people to close it
without reading. N-shift exposure is a *distribution* question and belongs in the fairness
report as a count per person, not as a per-row alarm. The N flag was removed before shipping.

**Still open from this finding — the same gap, other rules:**

| Rule | Live breaches | Flagged | Status |
|---|---|---|---|
| Female on MD/MN (BR-GEN-003) | 138 person-days | **now yes** | FIXED |
| Minimum 10h rest (BR-RST-001) | 10 in July | no | **OPEN** |
| Never 3+ consecutive OFF (BR-OFF-002) | 7 June onward | no | **OPEN** |
| Exactly 2 OFF per week (BR-OFF-001) | 25% of person-weeks | no | **OPEN** |

Rest and OFF need a window function across adjacent days, which the per-day engine loop does
not currently have in scope. They are a second pass, not an afterthought — recorded here so
they are not lost.

### Verified correct on this surface

| Check | Evidence |
|---|---|
| Stored shift windows match the canonical dictionary | 12 known codes verified against BR-SHF-005 |
| No shift ends at 21:00 | 0 rows |
| Schedule surface has no server error for any role | 6 paths × 6 roles |

**Not yet proven on this surface:** the grid-vs-`roster_days` cell comparison (S1) and the
generator's own output rules (S5) — the harness tokens expired mid-run and those two checks
returned 401 rather than a result. They are re-runnable: `node scripts/audit-schedule.js`.

---

### F-008 · Weekend rule changed to Thursday + Friday + Saturday — `FIXED` · Director's ruling 2026-08-05

**The change requested:** weekend = Thu + Fri + Sat (was Thu + Fri, ruled 2026-07-02).

**What implementing it exposed.** The platform was running **two different weekends at once**:

```
13 SQL sites   EXTRACT(DOW FROM …)    IN (4,5)   = Thursday + Friday
 2 SQL sites   EXTRACT(ISODOW FROM …) IN (5,6)   = FRIDAY + SATURDAY   ← OT tracker
 1 TypeScript  wfm-calc.isWeekend                = Thursday + Friday
 1 TypeScript  generator.service (private copy)  = Thursday + Friday
```

The OT tracker had been tinting **Saturday** as weekend while fairness counted **Thursday**.
The 2026-07-02 ruling's own comment claimed it "resolves the old Thu/Fri/Sat vs Fri/Sat drift"
— it did not, because the rule lived in sixteen separate literals and one was missed.

**Implemented:**

| Change | Why |
|---|---|
| `WEEKEND_DOW = [4,5,6]` + `weekendSql(col)` in `wfm-calc.ts` | One definition. A rule in sixteen literals drifts the moment one is missed. |
| All 16 SQL sites → `IN (4,5,6)` (ISODOW sites corrected to Thu/Fri/Sat too) | Ends the split |
| `generator.service.isWeekend` now delegates to `wfm-calc` | It held a private copy — exactly how the drift happened |
| `wfm-calc.spec.ts` asserts the new rule | The old test asserted Saturday was *not* weekend *because* it starts the week — a non-sequitur that outlived its ruling. Week boundary answers "which seven days"; weekend answers "which are desirable". Both can be true of Saturday. |

**Verified:** 14/14 unit tests pass · build clean · restarted · fairness endpoint 200.

```
weekend-OFF days, June→Aug:   600 (Thu+Fri)  →  878 (Thu+Fri+Sat)
weekend DATES in window:       18            →   27   (denominator +50%)
API offDistribution total:                       866  — see F-009 for the 12-day gap
```

---

### F-009 · An actively-working employee is invisible to every people-level report — `VERIFIED · DIRECTOR`

**How it surfaced.** Verifying F-008 the API reported 866 weekend-OFF days where SQL said 878.
Chasing the 12 rather than rounding it off found the cause.

**Established:**

```
employee_identity (13772, Assil Alhamada)
  status "inactive" · is_active false · last_working_date 2026-06-19
  is_canonical true · alias_of null        → NOT a folded duplicate
roster_days
  64 rows · working through 2026-08-01     → the last day of data
```

The identity table says she left on 19 June. The roster says she worked through 1 August.

**Why this is worse than a mislabelled row.** Every people-level report joins through
`employee_identity`, so she is not merely wrong — she is **absent**. This week the fairness
report can see **104 of 105** working people. If her rotation were unfair, no report in this
system would ever say so. The person vanishes from the report built to protect her.

**Not fixed unilaterally.** Whether she left and returned, or never left, is an employment fact
I cannot verify from data. Flipping the flag would be inventing an HR record.

**What was built instead — check C4 in `accuracy-audit.js`:** any person the identity table
calls inactive while the roster still shows them working now raises HIGH. It fires on this case
today, and will catch the next one on the day it appears rather than during an audit months
later.

```
accuracy audit 2026-07-01 → 08-01:  15/19 clean · 1 HIGH (C4) · 2 med · 1 low
```

**Decision needed:** is Assil Alhamada currently employed? If yes, `employee_identity` needs
refreshing against roster activity. If no, the roster rows after 19 June need explaining.
