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

---

### F-010 · Assil Alhamada restored to the reports — `FIXED`

Director confirmed 2026-08-05: still employed. Fixed at the **source**, not the derived table —
a value patched into `employee_identity` is erased by the next backfill (BR-ING-005).

```
employees.status          inactive → active   (13772)
backfill-identity re-run  → employee_identity.is_active true, two records grouped as one person
fairness offDistribution  117 → 118 people · 866 → 877 weekend-OFF days
Assil now reads           11 weekend-OFF of 19 OFF (58%) · 32 worked days
current week visibility   104/105 → 105/105
```

The last day is fully accounted for: **878 = 877 active + 1 Fayza Mahgoub**, whose last roster
day was 2026-06-07 and whose inactive status is correct. Nothing is unexplained.

Accuracy check **C4 now passes**.

---

### F-011 · The B3 check overstated a rule breach that was not happening — `FIXED`

B3 reported **238 HIGH** "scored days with zero evidence". Investigated before acting:
`adherence_pct` is NULL on **every one**, and `raw_sys_late_min` is NULL on every one — they are
pre-2026-07-25 rows where `include_tardiness` was left true before that flag encoded the
evidence gate. **Nothing was scored. No average polluted. Nobody judged.**

B3 was testing the *flag* and reporting it as the *outcome*. A check that reports 238 breaches
of a rule that is not being broken trains the reader to skip the section — and the day a real
one appears, they skip that too.

Split into two honest checks:

| Check | Tests | Severity | Now |
|---|---|---|---|
| **B3** | a day carrying a CONFORMANCE FIGURE with zero measured work | HIGH | **passes** |
| **B3b** | old-engine rows whose `include_tardiness` predates the evidence gate | LOW | 201, clears on rebuild |

---

### F-012 · A one-minute session produced a 0% conformance score — `FIX WRITTEN · NOT PROMOTED`

**The real defect the corrected B3 was hiding.**

```
Elyas Najar  2026-07-12   worked   1 min   conformance 0.0%
Sham Ali     2026-07-30   worked   2 min   conformance 0.0%
Sham Ali     2026-07-25   worked   2 min   conformance 0.0%
Elyas Najar  2026-07-04   worked  23 min   conformance 5.0%
```

The engine **knew**: it flagged "Evidence covers only 0% of the shift" and set
`include_tardiness = false`. Then it wrote a zero anyway, because the arithmetic was possible.

`roster-analytics.controller.ts` averages `adherence_pct` three times — **line 101 gates on
`include_tardiness`; lines 68 and 78 do not.** So the excluded score comes straight back in on
two of three surfaces, and those people read as catastrophic performers because a session
lasted a minute.

```
July conformance   ungated 94.10% over 1727 days   ← lines 68/78
                   gated   94.68% over 1625 days   ← line 101
```

The 0.58-point aggregate is not the point. The point is the individual carrying a 0% they never
earned, on a day the system had already decided not to judge.

**Fix written** in `recon-build.js`: a day the engine declines to score carries no figure at all.

**One over-correction, caught by the diff before it shipped.** The first version also nulled the
score for record-only roles — Dana Khaled 89.0 → —, Noureldeen Elnaggar 97.0 → —. BR-ROL-002
makes those roles record-only for **deductions**: "tracked and visible, no deduction computed".
Deleting their figure does not stop a deduction, it stops them being seen. Excluded from
consequence is not excluded from measurement. Condition narrowed to evidence failure only;
changes fell 47 → 24.

**NOT PROMOTED, deliberately.** The remaining diff contains two rows I cannot yet account for —
Amthal Alrashid and Athari Almulla flip `include_tardiness` true → false with no conformance
change, and the identity backfill reclassified them Excluded → OMT in between, which muddies
the comparison. Promoting a number-changing rebuild containing a change I cannot explain would
break the rule this audit is built on. It waits for that explanation.

```
dry run: ARRIVING 0 · LEAVING 0 · CHANGED 24 · IDENTICAL 804 · live table untouched
```

---

### F-012 · resolved and promoted — `FIXED`

**The blocker cleared itself once I stopped guessing and read the config.** Amthal Alrashid and
Athari Almulla are listed explicitly in `recon-config.json`:

```json
recordOnlyPeople: [
  { id: 13863, name: "Amthal Alrashid", why: "OMT, standing WFH pattern — does not open the system" },
  { id: 13540, name: "Athari Almulla",  why: "OMT, standing WFH pattern — does not open the system" }
]
```

Which is the Director's own instruction, verbatim from 2026-07-24: *"they don't open the
system … keep them in the record."* So the dry-run (`Excluded`, not scored) was **correct** and
the live rows (`OMT`, scored) were **wrong** — the rebuild fixes a second defect I had not
targeted. Promoted.

**Then the surface fix**, because the engine writing NULL only helps rebuilt data:

| Site | Was |
|---|---|
| `roster-analytics` — 8 averages incl. the **lowest-performer list** (`HAVING AVG(adherence_pct)<70`) | ungated |
| `roster-analytics` — decline detection ("conformance dropped sharply") | ungated |
| `roster-reports` — 5 averages | ungated |
| `me.service` — **the agent's own page** | ungated |

The lowest-performer list is the one that mattered most: a one-minute session scoring 0% could
place a real person in front of a manager as a poor performer. `me.service` is the second — an
agent opening their own page and finding a zero they never earned.

Two deliberate exceptions, left alone: Data Trust reports `mean` **and** `mean_strong`
side by side on purpose, and the Report Builder metric now self-corrects because the engine
writes NULL.

**Verified:**

```
626/626 unit tests pass
Elyas Najar / Sham Ali thin-evidence days → adherence_pct NULL on every one
accuracy 17/20 clean · 0 HIGH   (was 3 HIGH)
calculation verify 7/7           (was 5/7)
explain self-check 461/461
golden master PASS
```

---

### F-013 · Widening the weekend without widening its complement double-counted Saturday — `FIXED`

**Caught by the cross-check, not by me.** After F-008 the partition check failed:

```
✗ Shrinkage: weekday and weekend partition the same scheduled days
    overall scheduled = 18,113 days   vs   weekday + weekend = 20,661
    DIFFER by 2,548 (12.3%)
```

I updated every `DOW IN (4,5)` to `(4,5,6)` and missed the three `DOW NOT IN (4,5)` twins. So
Saturday satisfied **both** predicates and every weekday/weekend split counted it twice.

A rule and its complement are one fact expressed twice; changing one without the other is not a
partial fix, it is a contradiction. Fixed in `roster-fairness.controller.ts` and
`analytics.service.ts`.

```
31/31 cross-checks agree — "Every screen tells the same story."
```

**Why this belongs in the record even though it lasted an hour:** it is the strongest argument
for the `weekendSql()` helper introduced in F-008. Sixteen literals plus three complements is
nineteen places to remember. One function is one place.

---

### F-014 · The rest and OFF rules reach the ingest path — `FIXED`

Closes the remaining half of **F-007**. Three rules were enforced only in
`generator.engine.ts` — the path that AUTHORS a schedule — and never on the ingest path,
which is where every row in this database arrives.

They could not live in the per-day loop: each is a statement about a person's days **next to
each other**. Added as a cross-day pass after all records are built, before the payload is
written.

| Rule | Implemented | Result on 2026-07-25 → 08-01 |
|---|---|---|
| BR-RST-001 · 10h rest between consecutive shifts | flag on the earlier day, naming the next shift | **8 breaches** |
| BR-OFF-002 · never 3+ consecutive OFF | flag on the MIDDLE day, so one run = one item | 0 in this window |
| BR-OFF-001 · exactly 2 OFF per week | **deliberately not flagged per row** | see below |

**The pattern in the 8 is the finding, not the count:**

```
Mona Abdulbaqi   07-25  N    → 07-26 M     9h
Raghad Qamhieh   07-27  N    → 07-28 M     9h
Illaf Alloubab   07-27  N    → 07-28 M     9h
Dima Awada       07-29  N20  → 07-30 M7-3  9h
Hanan Shire      07-29  N    → 07-30 M     9h
Sham Ali         07-30  N20  → 07-31 M7-3  9h
Donya Sulaiman   07-31  N    → 08-01 M     9h
Rand Chbib       07-31  E    → 08-01 B     8h
```

**Six of eight are the same hand-off.** A late shift ending 22:00 followed by a morning
starting 07:00 is nine hours — one short of the minimum, every time. That is a property of the
shift mix, not eight individual mistakes, and it will recur every week until the mix changes or
the exception is recorded. Rand Chbib's E→B is eight hours.

**Why the weekly-OFF-count rule is not flagged per row.** 25% of person-weeks deviate from
"exactly 2". Flagging a quarter of all person-weeks would bury eight genuinely rare rest
breaches under hundreds of routine items — the same judgement made for the N shift in F-007.
It is a distribution question and belongs in the fairness report as a count per person.

**Verified — flags only, nothing altered:**

```
dry run  ARRIVING 0 · LEAVING 0 · CHANGED 0 · IDENTICAL 828
         scored 747=747 · conformance 94.7=94.7 · TRUE_OT 3520=3520

promoted, restarted, live API:
   8 days ·  8 people · rule_min_rest          Less than 10 hours rest between shifts
   6 days ·  1 person · rule_female_midnight   Female agent on a midnight shift

accuracy 17/20 · 0 HIGH · calc verify 7/7 · explain 461/461
cross-check 31/31 · golden PASS · 626/626 unit tests
```

**F-007 is now fully closed.** Every rule that was enforced only where the system writes a
schedule is now also checked where it receives one.

---

## Queue item 2 — The Schedule Generator

The generator is the one place the system **authors** a schedule instead of receiving one, so it
is the one place a broken rule stays invisible: nobody reviews 120 people × 7 days by eye. It was
driven for real (`scripts/audit-generator.js`, week 2026-08-15, 840 assignments) and every rule it
claims was re-derived from its output independently — from the shift catalog, not from its own
report.

The first run came back CLEAN. Five defects were behind that word.

### F-015 · The "shift before the week" was up to 29 days old — `FIXED`

`loadLastShifts` took the most recent `attendance_records` row before the week **with no date
floor**. Generating any week past the data horizon anchored on whatever row happened to be last.

```
week requested          2026-08-15
latest data             2026-08-01
→ 104 people anchored on a row 14 days earlier
→  54 people anchored on a row 29 days earlier
```

Both uses of that value are statements about the **adjacent** day: the rest check on day 1, and
the rotation band to move on from. So the generator reported a rest violation — *Line Khaled, 0h
rest* — between two days two weeks apart. A rule breach nobody could have caused, on a schedule
nobody had worked.

The sibling query `loadConsecutiveDays` already bounds itself to 7 days. Same file, one got it
and one did not. Fixed with the tighter window rest actually needs:
`AND ar.attendance_date >= $3::date - interval '1 day'`. **Reported violations 1 → 0**, and the
independent check still finds 0 real breaches — a false alarm removed without hiding anything.

### F-016 · Six women could not be scheduled on the shift their own team runs — `FIXED`

Outbound/OMT is configured `codes: ['B','N'], femaleAllowLate: true` — an all-female team whose
window runs to 22:00. The week it generated:

```
before   Aisha B  B  B  B  OFF B  B          all six women, every day, B only
after    Aisha OFF B  B  B  B  OFF B   ·  Amthal N N N N OFF N OFF
```

Three places ask "may this woman work N?" and each answered differently:

| site | consulted | result |
|---|---|---|
| `getWorkingShifts` | function config + per-run + global | N offered ✓ |
| `validateShift` | **global override only** | N flagged ✗ |
| band rotation | per-run + global | never targeted night ✗ |

Candidate generation allowed N, validation vetoed it, so B won every time. The configured
exception had never once fired, and the team's **18:00–22:00 window was structurally
uncoverable** while the config said it was allowed. The existing spec even documented the split
as intended — it pinned the bug in place.

One predicate now, `femaleLateAllowed()`, used by both engines (the demand path also stopped
warning "no alternative available — needs supervisor approval" on the team where N *is* the
policy). Blocked shifts stay blocked through every path — asserted in the new regression test.

Result: **15 female-N assignments, all inside the exception, 0 violations, 0 midnight,
0 blocked-evening.**

### F-017 · One DTO, two endpoints, two different meanings of "which function" — `FIXED`

`/generate` reads `body.functionIds`. `/generate-demand` reads `options.functionIds` and drops
the top-level field. A caller filling in the field the DTO advertises got a **whole-company
schedule** back — 120 people instead of the 6 requested — with no error and no clue.

```
before   functionIds → 120 people  ·  options.functionIds → 6 people
after    functionIds →   6 people  ·  options.functionIds → 6 people
```

### F-018 · Every schedule made from the screen gave a six-day week — `FIXED`

Backend default `offDaysPerWeek: 2`, with the comment citing the rule. Frontend default: **1**.
The screen is the only way this is used, so every generated schedule broke BR-OFF-001 — visible
in plain sight on the page: six women, one OFF each. Default corrected; the switch stays for a
deliberate override.

### F-019 · The weekend rule reached the measurements but not the placement — `FIXED`

The 2026-08-06 ruling widened the weekend to Thu+Fri+Sat and `WEEKEND_DOW` moved. The generator
carried a **second, independent** definition:

```js
// Weekend = THURSDAY + FRIDAY only … (Saturday is a regular working day)
const WEEKEND_DAY_INDICES = [5, 6];
const WEEKDAY_INDICES     = [0, 1, 2, 3, 4];   // ← Saturday sat in here
```

So Saturday counted as a weekend day in every fairness measure, while OFF placement could never
give it as the weekend OFF — it competed with Sunday–Wednesday for the mid-week slot. The same
half-applied change that made the platform run two weekends at once. Both sets are now **derived**
from `WEEKEND_DOW`; complements cannot drift apart again.

```
OFF days by weekday, after      Sat 40 · Thu 38 · Fri 42   ← the weekend
                                Sun 28 · Mon 25 · Tue 34 · Wed 33
```

Also fixed alongside: `weekend` health totals carried `{thu, fri}` while its own recommendation
text **named three days and printed two** — a Saturday at 60% raised nothing. And ten user-facing
labels across five screens still read "Thu/Fri" (two of them "Thu/Thu/Fri") over numbers that had
already been counting Saturday.

### Two smaller ones

- The rest message read **"0hh rest"** — the violation token already carries its unit and the
  formatter appended another.
- The publish-lock refusal told the user to *"re-publish with force=true"*. **No route accepts
  `force`** — the parameter has exactly one caller and it never passes it. The message advertised
  a capability that does not exist; exposing it would let a published week be rewritten under
  agents who have already been told their shifts, so it stays the Director's call (BR-APP-006).
  The message now points at the escape hatch that is real: edit the published version.

### The publish lock itself — proven, not read

`generate` never overwrites: `saveDraft` always inserts a new draft. Publishing over a published
period is refused by a conflict guard. That was **tested, not trusted** — snapshot, attempt,
diff:

```
snapshot 1120 rows · publish draft aef73cd7 over published Jun 20 – Jul 17
→ HTTP 400  "A published/locked schedule already covers 2026-06-20 → 2026-06-26 …"
attendance_records unchanged: YES   ·   version statuses unchanged: YES
```

The three overlapping published versions already in the database were all published
2026-06-15 — **before the guard existed**. History, not a hole.

> **Method note.** The first version of this harness reported G7 as a pass. Both 400s it saw were
> **my own malformed requests** — a date key that does not exist on the response, and a `schedules`
> field the DTO rejects. A refusal is not proof; the check now asserts the *reason* and re-reads
> the state afterwards. Same lesson as the crying-wolf gate: a green light whose cause you have
> not verified is not a green light.

### Standing gates after this work

```
audit-generator   G1–G7 clean on real output   ·   unit tests 627/627
explain           1401/1401 re-derive (100%)   ·   cross-check 31/31
accuracy (rebuilt window 07-25 → 08-01)        17/20 · 0 HIGH
accuracy (01–24 Jul, pre-rebuild data)         13/20 · 2 HIGH  ← the known limitation,
                                                                 untouched by this work
```

The two HIGH sit entirely outside the rebuilt window and are the same superseded-engine data
already on record. Every "0 HIGH" quoted for the roster is measured on the rebuilt window — said
here plainly so the number is never read wider than it is.

---

## Queue item 3 — Capacity, Forecasting and the demand behind every schedule

Every cell of `/capacity/staffing/requirement` returns its full working — volume → effective AHT
→ erlangs → agents for SL → occupancy → ÷productivity → ÷(1−shrinkage). That makes it checkable,
so `scripts/audit-capacity.js` re-derives each step with a **textbook Erlang-C written out in the
harness**, never imported from the engine: a check that borrows the formula it is checking cannot
catch a wrong formula.

**The maths is sound. All 108 cells re-derive.** What it is being fed is the problem.

```
K1  erlangs = vol × AHT / 3600      108/108 ✓     K5  shrinkage → scheduled HC   108/108 ✓
K2  agents match textbook Erlang-C  108/108 ✓     K6  chat/WhatsApp concurrency = 4    ✓
K3  occupancy = A / N               108/108 ✓     K7  more volume never needs fewer     ✓
K4  afterProductivity divisor       108/108 ✓     K8  generator demand = this engine  43 = 43 ✓
```

> **Method note — three findings that were mine, not the engine's.** The first run reported 2 HIGH
> and 1 MED. All three were the harness reaching past what it knew: it applied **Erlang-C to
> throughput functions** (which have no wait-time target and are staffed to their occupancy
> ceiling); it divided concurrency load by the raw `concurrency` when the engine models
> **diminishing returns** (4 chats = 3.25 servers, `1 + (c−1)·0.75` — conservative, it staffs
> *more*); and it failed **Social Media & Email** for using concurrency 3 when the confirmed rule
> names chat and WhatsApp only, not social or email. Corrected, the engine is clean. The pattern
> is now familiar enough to name: **a red light I cannot explain is my measurement until proven
> otherwise.**

### F-020 · A six-person team was told to cover the whole company — `FIXED`

Generating for OMT alone produced **10,452 required hours against 252 staffed — 1.7% coverage,
every day critical.** For a team of six.

The requirement engine correctly passes `functionKeys` when it has a forecast. When it does not,
the code falls back to the Sprinklr live plan — and `getLivePlan(tenantId, date)` has **no function
dimension at all**. It is the whole centre's workload. So a function with no demand basis was
handed the entire company's curve and judged against it.

The same shape as F-017 and F-019: **a scope honoured on the primary path and dropped on the
fallback.** Third instance in two days.

The multi-function path already handles this properly — it names such functions in `noCurveFns`
and leaves them alone. The scoped path now refuses the same way, naming them:

```
before   OMT → 201, coverage 1.7%, 7 critical days   (fabricated)
after    OMT → 400  "No demand basis for OMT … the measured live plan is centre-wide,
                     so it cannot stand in for one function."
         Inbound → 201, coverage 85.7%   (unchanged)
         ALL     → 201, coverage 84.6%   (unchanged)
```

A gap the generator invented is worse than a gap it cannot see.

### F-021 · The demand behind every schedule is 55 days old, from a system being switched off

Not a code defect — a fact the platform was not saying loudly enough.

```
contact_volume_daily   every row source = 'ameyo'   newest 2026-06-21
order_aggregates       newest "2026-06 (1-14)"
roster_days            newest 2026-08-01        today 2026-08-06
```

The Director's own note: from July the centre is fully on Sprinklr, no Ameyo. So the table feeding
every staffing calculation holds **only** the decommissioned system's data, and it stops seven
weeks back. Monthly means show the wind-down across all five channels:

```
voice     01: 375  02: 260  03: 762  04:1659  05:2430  06: 537
chat      01: 821  02: 688  03:1637  04: 605  05: 158  06:  41
whatsapp                    03:  50  04: 928  05:2720  06: 829
```

The engine reported its measurement window, but a date range is not a warning — nobody reads
"measured 2026-05-23 → 2026-06-20" on an August schedule and computes seven weeks in their head.
The requirement response now returns a `freshness` verdict (`daysBehind`, `level`,
current/ageing/stale) which the generator carries up, and the screen shows it beside the green
badge: **⚠ الفوليوم متأخر 55 يوم (آخر قياس 2026-06-21)**.

**For the Director:** the maths is correct and the inputs are not current. Loading Sprinklr volume
is the fix; nothing in the code can substitute for it.

### F-022 · WAPE 125% was measuring a decommissioning, not a forecast

The backtest reported **overall WAPE 124.8%, bias +124%** — error larger than the actual volume,
which reads as a broken model. It is not. Voice Wednesdays:

```
04-29: 8271 · 05-06: 4319 · 05-13: 2412 · 05-20: 1723 · 05-27: 743 · 06-03: 1289 · 06-17: 287
forecast(05-27) = mean(8271, 4319, 2412, 1723) = 4181.25   — reported 4181.3, exactly right
```

A trailing-mean forecast meeting a series in freefall reports huge error, and the error is real —
but its cause is the level change, not the model. Sending someone to fix a working model is the
expensive outcome. The endpoint now measures the level shift beside the error and says which one
you are looking at:

```
voice     WAPE 155.7  levelShift −76.1%  series-fell      sources: [{ameyo, 3030 rows, newest 2026-06-21}]
chat      WAPE 120.9  levelShift −73.6%  series-fell      headline: 3 of 5 channels changed level
whatsapp  WAPE 115.4  levelShift −58.2%  series-fell      inside this window — read the error as a
email     WAPE  90.9  levelShift −26.6%  model            level change first, the model second.
social    WAPE  84.3  levelShift −39.1%  model
```

### F-023 · The six-day week was fixed in a file that never runs — `FIXED`

F-018 changed `offDaysPerWeek` from 1 to 2 in `pages/ScheduleGenerator.tsx`. The generator screen
renders **`pages/schedule/GeneratorPanel.tsx`**. `ScheduleGenerator.tsx` — 1,285 lines — is
imported by nothing: dead, and near-identical, which is exactly why the edit looked right.

Caught by the build hash: after the edit the bundle name did not change, so the edit was not in
the build. Fixed in the live file and the dead duplicate deleted, so the next person cannot make
the same edit in the same wrong place.

**Verified on the running screen, not asserted:** 105 scheduled people × 2 OFF = **210**, × 5 shifts
= **525**. The arithmetic closes exactly.

### F-024 · Fifteen people got no schedule and the screen did not say so — `FIXED`

`525 shifts + 210 OFF` over `120 employees` reads as a full week. It is 735 of 840 person-days.
The missing 105 were **15 people with a completely empty week** — whole functions with no demand
basis (OMT 6, Team Leader 4, RTA 3, Resolution Specialist 2).

The engine was honest: `verdict.unscheduled` names every one of them by function. The KPI row
simply dropped it. Added as a tile that is grey at zero and rose otherwise, carrying the
breakdown:

```
الموظفون 120 · بلا جدول 15 (OMT: 6 · Resolution Specialist: 2 · RTA: 3 · Team Leader: 4)
ورديات مخططة 525 · أيام OFF 210
```

### Gates

```
audit-capacity  108/108 cells CLEAN   ·   audit-generator G1–G7 CLEAN
unit tests 627/627   ·   cross-check 31/31   ·   explain 1401/1401
```

---

## Queue item 4 — Live Ops / RTA

The honesty layer here is already good: `/rta/live`, `/rta/intraday` and `/rta/alerts` each return
their own age, and the Command Center prints it on every tile — *"بيانات قديمة · 29س"*,
*"لقطة قديمة (29س) — ليست الآن"*, *"مجدول (الجسر قديم)"*. Nothing pretends to be now. So the audit
question was not "is it honest" but **"are the numbers right, and do they agree with each other"**.

### F-025 · Two people on approved sick leave were counted as absentees — `FIXED`

`/rta/live` reported `absent: 6` for 2026-08-01. Both tables hold **4 absent and 2 sick**:

```sql
COUNT(*) FILTER (WHERE attendance_marker IN ('absent','sick')) AS absent
```

Operationally the grouping is right — RTA needs "not on seat, whatever the reason". The **word**
is not: absence is unexcused and carries consequences, sick leave is approved and carries none.
Two people who did nothing wrong sat inside a number labelled *absent* (P-5, never wrongly
punish). Split in both the summary and the per-function breakdown, keeping the operational total
under a name that is true:

```
before   absent 6
after    absent 4 · sick 2 · unavailable 6
```

**Reported honestly: no screen was showing this.** `/rta/live` has no consumer today — the front
end uses only `/rta/alerts`, and no guard agent calls it. It is a live API defect that had not yet
reached a person, fixed before it could.

`wfh` is likewise a **subset** of `present` (54 present, of which 33 remote — never 87 at work);
that is now stated where the two fields are built, since the tiles sit side by side.

### F-026 · The coverage table stopped following the roster a month ago — `FIXED`

The Command Center's "Coverage now" tile was serving **2026-07-03** while the roster ran to
**2026-08-01**. The tile disclosed the date, so this was visible rather than hidden — but the
cause was real:

```
headcount_intervals   2026-06-01 → 2026-07-03   (20,656 rows, 33 days)
roster_days           2026-06-01 → 2026-08-01
```

`headcount_intervals` is **derived** from `roster_days`, and nothing advanced it when the roster
advanced. `CoverageRebuildService.rebuild()` existed and had exactly two callers: a manual
endpoint, and the break scheduler — which only fires it when it happens to find a date *completely
empty*. The roster refresh (`recon-refresh`, the one-command pipeline and the Upload & Rebuild
button) parsed the ingested range, cleared caches, and never rebuilt the derivation.

So the pipeline advanced the spine and left every live-coverage surface a month behind, silently
except for a date on one tile.

Fixed at the pipeline: the refresh now rebuilds coverage over **the range it actually ingested**,
through the same service the endpoint uses — one definition, not a second copy. A failure there
never fails the ingest, but is reported rather than swallowed.

The existing month-wide gap was then backfilled and **verified against `roster_days`
independently**, not trusted:

```
rebuild 2026-07-04           inserted    500
backfill 2026-07-05 → 08-01  inserted 14,252
verification, 2026-08-01, 11 interval checks:
  07:00 sched 10/10 act 10/10 · 13:00 43/43 41/41 · 16:00 33/33 30/30 · 20:00 17/17 14/14 …
  11/11 agree
Command Center coverage tile:  2026-07-03  →  2026-08-01
```

> **Method note — the fourth false alarm of the day.** The first verification run reported four
> mismatches on 2026-08-01 (engine 43 vs 41, 33 vs 30 …). I had compared the engine's
> `scheduled_hc` — everyone **with a shift window** in that interval — against my own count of
> everyone who **actually worked** it. Two different questions. The matching column is
> `actual_hc`, and against it every interval agrees exactly. Same lesson as the capacity run,
> now four times over: **an unexplained red light is my measurement until proven otherwise.**

### Checked and found correct

- **`permission_status ILIKE '%approved%'`** in the coverage rebuild. Given the earlier `'%approv%'`
  bug that swallowed *"Approval Refused"*, this deserved a look at the live values rather than an
  assumption. The full-word form is what saves it: only `HR Approved` (1,387 rows) matches;
  `Approval Refused` (55), `HR Refused` (42), `HR Pending` (37), `Waiting 1st/2nd Approval` (18)
  all correctly do not.
- **`/rta/live` vs `roster_days` for 2026-08-01** — both hold exactly 104 rows and agree
  category by category (wfh 33, off 27, leave 17, office 21, absent 4, sick 2), with zero people
  present in one table and missing from the other.

### Gates

```
unit tests 627/627 · cross-check 31/31 · audit-generator CLEAN · audit-capacity 108/108
accuracy (rebuilt window) 17/20 · 0 HIGH
```

---

## Queue item 5 — Requests, Permissions, Leave, Breaks

Permission HC Impact has one job: tell the approver who is left on seat if they say yes. It
answers entirely out of `roster_days`, so the keys it uses to find the requester there must be
the **roster's** keys, not the HR record's. Two of them were not.

### F-027 · `is_active` erased people who were genuinely scheduled — `FIXED`

`is_active` on `roster_days` marks the **canonical row when a person has duplicates**. It is not
employment (BR-ATT-008). The impact queries filtered `AND is_active`, so anyone whose *only* row
for the date carried `is_active = false` vanished from the coverage calculation entirely.

Ibrahim AlAsmi, 2026-01-05: one roster row, MD 22:00–07:00, `is_active = false`. The approver was
told *"requester not working — no coverage impact"* about a man on a midnight shift. Replaced with
`DISTINCT ON (person_no, work_date) … ORDER BY is_active DESC`: canonical preferred, **nobody
erased**.

### F-028 · The coverage set was scoped to the wrong team — `FIXED`

The function came from `employees.function_id`. Function is **per-month from the schedule**
(BR-ATT-008), and the two stores disagree:

```
Ahmad Abuali    employees: "Social Media & Email"    roster_days: "Mail & NPS"
Mona Abdulbaqi  employees: "Social Media & Email"    roster_days: "Mail & NPS"
```

`canon_fn` folds *Internship X → X*; it does not reconcile two different names, so the query
counted a different team's coverage. Both paths now take the function from the requester's own
roster row for that date.

Also hardened while in there: the requester's `person_no` is now resolved through
`employee_identity` rather than the raw `employees.employee_no`, so an intern number (6xxxx) finds
the full-time row (1xxxx) the roster knows them by. One resolver, `resolveRosterIdentity()`, used
by both the permission and the leave path.

### F-029 · A leave request with no entitlement on file showed nothing at all — `FIXED`

118 of 120 people have **no leave entitlement configured**. The API is honest about it
(`configured: false`, `entitlement: 0`, `remaining: null` — it never invents a balance), and the
form only rendered the balance chip `when configured`. So for almost everyone the chip simply
**vanished** — indistinguishable, to an approver, from a balance that was checked and found fine.
Now an amber chip says the entitlement is missing and shows the days already taken.

*(The missing entitlements are HR data entry, not a code defect — surfaced here because the
platform should say so rather than fall silent.)*

### Checked and found correct

- **Permission cycle and caps** — `/permission-requests/weekly-usage` returns
  `2026-07-15 → 2026-08-14`, `max 360 min`, `max 3 requests`: the full-time cut-off (15→14) and
  the 6h/3-permission allowance, exactly as agreed (BR-TIM-002, BR-PRM-003).
- **BR-LVE-001 (holiday inside annual leave returns to the balance)** — implemented on **both**
  sides: `EFFECTIVE_DAYS` subtracts holidays inside an annual-leave span, and the engine sets
  `hr_code = 'H'` with the note *"counted as holiday, not deducted from leave balance"*. It has
  **never fired on real data**: only two annual-leave requests exist and neither spans a holiday.
  The two roster rows in the entire year that would exercise it (Suliman Chaar and MHD AlTamer,
  2026-01-18, still `L` beside 44 `H`) predate the rule (2026-06-30) *and* the last rebuild — they
  will correct themselves when January is rebuilt. Stated as **implemented, unexercised**, not as
  verified.
- **`/breaks/engine/status`** — running on a 45s loop and honest that its live feed is 30 hours
  stale.

> **Method note — and a correction.** I first reported **five** people wrongly flagged as "not
> scheduled". Three of them were correct all along. I had taken `permissionDate` from the API,
> which serializes a `date` column as a UTC instant — `2026-07-06T21:00:00.000Z` **is** 2026-07-07
> in Kuwait — and sliced the first ten characters, shifting **every** date back a day. Each
> permission was then compared against the wrong day's roster row. Two of the five were real, and
> both are fixed above. The harness now reads dates from the database as `::text`, and the trap is
> written into its header so the next person does not repeat it.

`scripts/audit-requests.js` re-derives, per pending permission and per hour, whether the requester
is rostered, whether they are working in that hour (cross-midnight aware), and whether
`afterApproval = scheduled − 1` when they are:

```
8 pending · CLEAN — 8/8 permissions re-derive to the roster
```

### Gates

```
627/627 tests · cross-check 31/31 · audit-requests 8/8
audit-generator CLEAN · audit-capacity 108/108
```

---

## Queue item 6 — Scorecard & Coaching

The batch `verify` endpoint compares the engine's re-computed Net Points against the Director's
workbook, per person, per KPI. Run across all four uploaded batches it says:

```
January 2026   82 rows   81 matching    1 mismatched   98.8%
February 2026  73 rows   71 matching    2 mismatched   97.3%
March 2026     67 rows   25 matching   42 mismatched   37.3%
April 2026     58 rows    9 matching   49 mismatched   15.5%
```

A 15.5% match rate reads as "the engine is broken". It is the opposite.

### F-030 · March and April did not score chat AHT — `FOR THE DIRECTOR`

Every mismatch is dominated by one KPI. Taking the CH - WA "Final" rows and asking what AHT range
each awarded score actually covered:

```
January   +15 for 5.3–8.8min   ·  +10 for 9.1–9.4min  ·  +5 for 9.6min  ·  −5 for 10.4–15.2min
February  +15 for 6.2–8.2min   ·                          +5 for 9.5–9.9min  ·  −5 for 10.3–84.7min
March     +15 for 7.6min (n=1) ·  +10 for 5.5–19.1min (n=24)
April                             +10 for 5.2–20.3min (n=23)   ← no other score awarded at all
```

January and February reproduce the seeded bands **exactly** — 18/18 and 24/24 of the chat rows
re-derive from 9:00 / 9:30 / 10:00 → 15/10/5/−5. In March and April the workbook gave **every
chat agent +10 regardless of their AHT**, from 5.2 minutes to 20.3 minutes against a 9-minute
target. That is not a band. It is a constant written down the column, and no engine can or should
reproduce it.

March carries a second one: `prr` flat at 0 for 63 of 67 rows.

**This is a decision, not a defect, and nothing was changed.** Either those KPIs were suspended
for those periods — in which case the engine needs a period-scoped rule saying so, exactly as
migration 091 already does for other period-specific cases — or the workbooks are wrong and those
two months' Net Points are overstated by up to 15 points for ~46 people. Only the Director knows
which. **No score was touched.**

What *was* fixed: `verify` now states the cause instead of a bare percentage. It detects a KPI
whose workbook column carries one dominant value (≥90% of rows) while the engine's varies, and
says so in both languages. Dominant rather than strictly constant on purpose — March is April
with a single outlier, and a strict test would have explained one month and stayed silent about
its twin.

```
April 2026   15.5%   aht flat 10 (53/53 rows)
March 2026   37.3%   prr flat 0 (63/67 rows) · aht flat 10 (60/61 rows)
February     97.3%   — no constant column
January      98.8%   — no constant column
```

### Checked and found correct — including a stale note of my own

- **The coaching guard's `low_scorecard` trigger.** A note carried in my own memory said it flags
  *"below the function average"* — which by arithmetic condemns half of any team for being
  ordinary. That is no longer what it does. It selects strictly below the function's **P25**, with
  proper linear interpolation and a `MIN_POOL` guard, and the flag text names the quartile
  threshold, the function average and the weakest KPI:

  > `سكور 55 — ضمن أدنى 25% في CH - WA (حد الربع 60 · متوسط القسم 69.3) — الأضعف: الكويز`

  20 flags over a 104-person population (~19%) is what a per-function bottom quartile with a pool
  guard should produce. **The concern was already resolved; the memory note was stale, not the
  code.** Corrected rather than repeated.
- **Auto-scoring readiness** — still reports **11.3%** of Net Points computable from live feeds
  (15 of 132.5 points), and names the feeds that would unlock the rest. Honest and unchanged.
- **The engine's own provenance label** names *"Jan/May/June 100%"* — it never claimed March or
  April. The label was right; the screen just did not carry the reason.

### Gates

```
627/627 tests · cross-check 31/31 · audit-requests 8/8
audit-capacity 108/108 · audit-generator CLEAN
```

---

## Queue item 7 — People pages (Agent 360 · Team 360)

Both endpoints answer from `roster_days` and every figure in them re-derives. The defect here is
not a wrong number — it is three correct numbers placed so that the obvious reading of them is
wrong.

### F-031 · "OT before / OT after / Total OT" are not parts and a whole — `FIXED`

Agent 360 showed three adjacent tiles in the same green. A reader takes the first two as a split
of the third. They are not related that way at all:

```
all rows, 2026-07-01 → 08-01
  ot_min          22,937        ot_before_min   12,264
  offday_ot_min        0        ot_after_min    23,976
  holiday_ot_min       0        before + after  36,240   ← 58% MORE than credited
  TRUE_OT         22,937
```

`ot_before_min` / `ot_after_min` are the **raw span outside the shift window** on each side,
*before* the 5h ceiling, the bleed guards and the evidence gate. `otTotal` is **TRUE_OT** — the
three credited buckets (BR-OT-001). Neither direction of the arithmetic holds, and on a real agent
it fails the other way:

```
OT قبل (خام)   27h 34m  ┐ sum 59h 12m
OT بعد (خام)   31h 38m  ┘
إجمالي OT     169h 57m   ← of which 32h off-day · 78h 30m holiday
```

The credited total is nearly **three times** the raw sum, because most of it is off-day and
holiday OT that the before/after split never touches. Both tiles are now muted, named
`OT قبل (خام)` / `OT before (raw)`, and carry *"pre-cap span, not part of Total"*.

### F-032 · Two teams were being compared on a pre-cap number — `FIXED`

Team 360's side-by-side comparison listed `otafter` — and it was the **only** OT figure on the
screen. So a team leader comparing their team against another was comparing raw after-shift spans,
with off-day and holiday OT absent entirely. Replaced with `ottotal` (TRUE_OT), labelled
*"إجمالي OT (معتمد)" / "Total OT (credited)"* — the same definition every other surface uses.

### Note

The backend process was gone at the start of this item — several days had passed since the last
turn and the detached process did not survive. Restarted from `dist`, no crash in the log, nothing
lost. Recorded because "the server was down" is worth distinguishing from "the server fell over".

### Gates

```
627/627 tests · cross-check 31/31 · audit-requests 8/8
audit-capacity 108/108 · audit-generator CLEAN
```

---

## Queue item 8 — Analytics & the Report/Dashboard Builder

The builder is the widest surface in the platform for a metric to quietly acquire a **second
definition**: anyone can assemble a report, and the number it produces looks exactly as official
as the dedicated screen's. So every metric was re-derived three ways — the builder, the endpoint
that owns it, and raw SQL over `roster_days`.

`scripts/audit-builder.js`:

```
B1  bad sourceKey → 400 that names the valid keys, not 500     ✓
B2  every source in the catalogue runs             14/14       ✓
B3  attendance day counts == raw roster_days        6/6        ✓
B4  grouped sum == ungrouped total   3381/3381 · 1986/1986     ✓
```

**The builder agrees with the database and with itself.** Grouping by function reproduces the
ungrouped total exactly, which is the property that matters most: a self-service report cannot
invent or lose rows.

### F-033 · A malformed builder request returned a bare 500 — `FIXED`

`getSource()` raises `BuilderValidationError` for a missing or mistyped `sourceKey` — the right
error in the wrong place. Every caller invoked it *before* the `try/catch` that converts those
into a 400, so a body without `sourceKey` came back as `{"statusCode":500,"message":"Internal
server error"}` with nothing to act on. Routed through a `resolveSource()` helper that converts
it and lists the valid keys.

*(Found by sending the wrong field names myself — `source`/`from`/`to` instead of
`sourceKey`/`dateFrom`/`dateTo`. The mistake was mine; the 500 was not.)*

### F-034 · The weekend lived in eighteen separate SQL literals — `FIXED`

`WEEKEND_DOW` and `weekendSql()` exist precisely so the weekend has one definition. Eighteen
call sites across five files still wrote it out by hand:

```
ot-tracker.service.ts           2      roster-generate.controller.ts   1
roster-fairness.controller.ts   3      schedule-ops.controller.ts      3
analytics.service.ts            9
```

All eighteen currently agree with Thu/Fri/Sat, so **nothing was wrong today** — but this is
exactly how F-019 happened: the generator's `[5, 6]` survived a rule change because it was a copy,
not a reference. One of these is worse than a copy: `ot-tracker` uses **ISODOW** where the others
use **DOW**. Those two functions differ by one and agree here only because Thu/Fri/Sat sits at
the offset where they happen to overlap — an accident that holds until a weekend includes Sunday.

Added `weekdaySql()` (the complement — the pair is where drift happens; widening one without the
other once double-counted 2,548 days) and routed all eighteen through the two helpers. Zero
hardcoded sites remain.

**Proven to change nothing**, not asserted — payload hashes across every weekend-sensitive
endpoint, before and after:

```
BEFORE                                    AFTER
200  de4310cd7daf21ea  78648b  fairness   200  de4310cd7daf21ea  78648b  fairness
200  2246a998c3f0079c   5746b  team-360   200  2246a998c3f0079c   5746b  team-360
```

Byte-identical.

### Gates

```
627/627 tests · audit-builder CLEAN · cross-check 31/31
audit-requests 8/8 · audit-capacity 108/108 · audit-generator CLEAN
```

---

## Queue item 9 — Command Center (executive)

Every headline on the exec screen was traced to its source and re-derived.

```
الموظفون 120            = employees.status='active'                          ✓
حاضرون اليوم 54          = /rta/live present, same 2026-08-01 rows            ✓
طلبات معلّقة 21          = /requests/stats pending                            ✓
ساعات OT (الفترة) 382س   = 22,937 min TRUE_OT by raw SQL — exact             ✓
التغطية 90% · الكونفورمانس 94.8% · العدالة 80/71  = their endpoints           ✓
```

The date rendering was checked too, because the API serializes `refDate` as a UTC instant
(`2026-07-31T21:00:00.000Z` **is** 2026-08-01 in Kuwait) — the trap that cost me three false
findings in queue item 5. The screen prints **2026-08-01**. Correct; checked rather than assumed.

### F-035 · Four gauges in a row, three different periods, one window label — `FIXED`

The hero row shows Coverage, Conformance, Shift Fairness and Weekend-OFF Fairness side by side,
with a single footer line reading *"roster window: 2026-07-01 → 2026-08-01"* under all of them.
They do not share a period:

```
Coverage            2026-08-01                one day
Conformance         2026-07-01 → 08-01        the stated window
Shift fairness      2026-01-01 → 08-01        YEAR TO DATE
Weekend-OFF fairn.  2026-01-01 → 08-01        YEAR TO DATE
```

The fairness call takes no dates, so it returns the full year — and that is almost certainly
right: a single month is too short to judge how night load and weekend rest are shared out. The
numbers are correct. The framing was not: an executive reading "fairness 80%" under a July window
is reading a year-to-date figure.

Each gauge now states the span it was actually measured over, and the footer says which tiles its
window governs:

```
90%    حاضر/مخطّط · 08-01
94.8%  التزام الفترة · 07-01 → 08-01
80%    توزيع الليل · 01-01 → 08-01
71%    توزيع الراحة · 01-01 → 08-01
نافذة الروستر (للأرقام المُصحّحة): 2026-07-01 → 2026-08-01
```

### Checked and found correct — annual attrition 51.6%

A 51.6% annual attrition rate on an executive screen is the kind of number that drives decisions,
so it was re-derived. My first attempt disagreed (46.3%) — and my query was the wrong one, for the
third time this session:

| | endpoint | my check | who is right |
|---|---|---|---|
| separations | 31 | 30 | **endpoint** — it reads `COALESCE(shift_code, attendance_code)`, so a separation recorded outside `hr_code` still counts |
| avg headcount | 103 | 111 | **endpoint** — it counts people who actually **worked** that month (`presence IN ('office','wfh')`); mine counted anyone with a row, including OFF and leave |

With the right definitions: `31 / 103 = 30.1%` over 7 months, `× 12/7 = 51.6%`. **Verified.**

> Three times now a red light has been my measurement rather than the system's. The pattern is
> consistent enough to state as a rule: when a check disagrees with a screen, find which of the
> two is asking the wrong question **before** writing it down as a finding.

### Gates

```
627/627 tests · audit-builder CLEAN · cross-check 31/31
audit-requests 8/8 · audit-capacity 108/108 · audit-generator CLEAN
```

---

## Queue item 10 — Admin, Settings, RBAC

`scripts/audit-sweep.js` drives the real endpoint surface as every role and judges each response
against the permissions the live `role_permissions` table actually grants:

```
roles: admin(73 perms) · wfm(68) · rta(65) · tl(65) · hr(17) · agent(11)
756 role×endpoint checks     HIGH 0 · REVIEW 8 · LOW 2
```

**Zero privilege leaks.** Seven of the eight REVIEW items are an agent seeing the same row count
as an admin on pure reference data — break types, KB categories, chat contacts, the function list,
the 142-code shift dictionary. An agent needs all of those to read their own schedule; each was
looked at and dismissed.

### F-036 · Every agent could read every colleague's gender — `FIXED`

The eighth was different: `/requests/employees` returns **100 people** to any authenticated
caller, and the payload carried `e.gender`. Names, employee numbers and functions are defensible
— you need them to pick a swap partner. Gender is not.

Before removing it, the question was whether anything *used* it. Nothing does: the only
gender-related thing the UI ever displays is `genderCheckPassed`, a boolean the **server**
computes when it validates a swap against BR-GEN-*. The field was mapped into the frontend's
`Employee` type and then read by nothing. Removed from the query and the type; both builds pass,
which is TypeScript confirming there was no reader.

The rule stays enforced where it belongs. The raw attribute no longer travels.

```
before  id, employee_no, gender, full_name, function_name, function_id, team_name
after   id, employee_no,         full_name, function_name, function_id, team_name
```

*(This resolves the open F-006 question with evidence rather than a decision — there was no
trade-off to weigh once the field turned out to be unused.)*

### F-037 · My own restarts had silently stopped working — `FIXED (method)`

Verifying the gender fix, the endpoint kept returning `gender` while `dist` plainly did not
select it. The running process was started at **11:02** and its command line reads
`dist\main.js` — a **backslash**. Every restart I had issued matched `*dist/main*`, with a forward
slash, so `Stop-Process` never matched it. `Start-Process` then launched a second process that
died on the already-bound port, and the 11:02 build kept serving.

**What this invalidated:** the F-034 verification. I had compared payload hashes "before and
after" a restart that never happened — both samples came from the same process, so identical
hashes proved nothing at all.

Redone properly, with git supplying the pre-refactor sources and the PID printed on both sides so
the comparison cannot lie again:

```
BEFORE — pre-refactor build, PID 16640      AFTER — refactored build, PID 24852
200  de4310cd7daf21ea  78648b  fairness     200  de4310cd7daf21ea  78648b  fairness
200  06b44aa54700584a  93756b  fairness     200  06b44aa54700584a  93756b  fairness
200  2246a998c3f0079c   5746b  team-360     200  2246a998c3f0079c   5746b  team-360
200  e28c9f917b415972  64581b  ot-tracker   200  e28c9f917b415972  64581b  ot-tracker
```

Byte-identical across two different processes and two different builds — including the OT tracker,
the one site that had been on ISODOW. **F-034 is now genuinely verified.** The matcher is now
`dist[\/]+main\.js`, and the restart prints the new PID.

> The lesson is the same one this audit keeps teaching, turned on myself: a green result whose
> mechanism you have not confirmed is not a result. I checked that the numbers matched and never
> checked that anything had changed underneath them.

### Gates

```
627/627 tests · audit-sweep 756 checks, 0 HIGH · audit-builder CLEAN
cross-check 31/31 · audit-requests 8/8 · audit-capacity 108/108 · audit-generator CLEAN
```

---

## Queue item 11 — Integrations (Sprinklr · Odoo · Ameyo)

The Director's Sprinklr session was never touched — this item audits what the platform holds and
what it reports about its own feeds.

```
sprinklr_live      green   169s     20 queues · 180 agents   ← pushing right now
sprinklr_reports   green  1127s     323 staged rows
odoo               amber  2,487,496s = 28.8 days   1,122 rows
ameyo_live         amber  never     0 queues · 0 agents
```

### F-038 · The same feed was "stale" and "green" at the same instant — `FIXED`

`/integrations/sprinklr/live` carried its own literal — `> 120_000` ms — while the bridge-health
page read `HEALTH_THRESHOLDS.sprinklrLiveSec: 5 * 60`. Between two and five minutes the same
Sprinklr feed reported **stale on the RTA surfaces and green on the health page simultaneously**.
Caught by reading 129s → `isStale: true` on one and 169s → `verdict: green` on the other, seconds
apart.

Which value is right was settled by **measuring the bridge**, not by preference:

```
141 pushes in 24h · gap p50 10s · p90 20s · p99 60s · max 60s
gaps over 120s: 0 of 140      gaps over 300s: 0 of 140
```

A feed silent for 120s has missed at least two consecutive pushes. Five minutes is **five times
the worst normal gap** — it would let a genuinely stopped bridge read green through roughly thirty
missed pushes. So the two are now one constant at **120s**, and the health page inherits the
evidence-based value.

Verified on a genuinely restarted process — both surfaces now report the same age and the same
verdict at every moment:

```
thresholds  { sprinklrLiveSec: 120, … }
live endpoint  age 363s  isStale true
health page    age 363s  isStale true  verdict amber
```

*(That 363s is itself real: the bridge had stopped pushing by then. Under the old 300s threshold
the health page would have gone amber at the same moment — the fix is that the two screens can no
longer disagree at any age, not that one of them was blind.)*

**Flagged for the Director:** the health page will now turn amber sooner than before. That is
deliberate and measured, but it is a visible change to a screen you watch — say the word if it
proves twitchy in practice.

### F-039 · A retired system shown as a degraded one — `FIXED`

`ameyo_live` sat permanently amber. Ameyo is not broken — it was **switched off**: the centre moved
fully to Sprinklr in July 2026, and every row in `contact_volume_daily` is `source='ameyo'` and
stops 2026-06-21 (F-021). A permanent amber on something deliberately retired is noise, and noise
on a health page is how a real amber gets ignored.

The verdict is unchanged — the feed *is* silent — but it now carries `retired: true` and says why,
so the page can render a retired bridge differently from a broken one:

```
ameyo_live  amber  RETIRED  "Ameyo was retired when the centre moved fully to Sprinklr
                             (July 2026) — silence here is expected, not a fault."
```

### Noted, not changed

**Odoo staging is 28.8 days old** (1,122 rows: permissions, attendance, comp, leave). Its
threshold is 24h, so the amber is correct and already visible. Refreshing it is a bridge run on the
Director's session — nothing in the code can substitute for it.

### Gates

```
627/627 tests · audit-builder CLEAN · cross-check 31/31
audit-requests 8/8 · audit-capacity 108/108 · audit-generator CLEAN
```

---

## Queue item 12 — The AI guard team (Chief + agents)

First question: are they real or shells? **Real.** The Chief's self-test probes all six guards and
all six answer:

```
selfTest 6/6 — health · analyst · security · reporter · automode · scorecard
llm: false        (no API key — the LLM advisor is off, as agreed)
```

The briefing is substantive: posture, a ranked directive list, three domain lines, learning,
auto-mode state, last report. And the priorities are **derived, not invented** — each traces to
the analyst's assessment, which traces to real coverage rows.

### F-040 · The Chief's top directive measured against the wrong thing — `FIXED`

The headline directive read:

> *"Priority 1 — Coverage shortfall: CH - WA. **Cover 14** at 13:00 with overtime/cross-skill and
> don't approve leave."*

Traced down: analyst → `bottleneck { hour: 13, required: 24, available: 10, gap: −14 }`. Real
numbers. But on the **same date, same function, same hour**, the platform's own requirement engine
says:

```
/capacity/staffing/requirement  CH - WA @13 on 2026-08-01
  volume 59.9 · AHTeff 1102s · erlangs 18.33 · agentsForSl 8 · requiredScheduledHc 15
analyst                        CH - WA @13
  required 24
```

**15 against 24 — a 60% divergence at the single most consequential number in the platform.**

The cause is a second definition. The analyst computes `required` as
`Math.round(a.reqSum[h] / nH)` — the **mean headcount rostered at that hour over the last ~6
days**. That is "what we usually staff", not the demand-derived requirement (forecast → effective
AHT → Erlang → productivity → shrinkage) that the requirement engine produces, that the generator
consumes, and that this audit verified 108/108.

Both measures are legitimate and they answer different questions. Calling one by the other's name
turned a **staffing-pattern deviation** into a **demand shortfall**, at the top of the executive
briefing.

The measure is kept — it covers every function, including the ones the staffing engine has no
volume for (OMT, Team Leader, RTA…) where the requirement engine would say nothing at all. What
changed is that it now says what it is, at every surface it reaches:

```
before  نقص تغطية: CH - WA — غطِّ 14 عند 13:00 …
after   أقل من المعتاد: CH - WA — أقل بـ14 عن المعتاد (24) عند 13:00 — غطِّ بأوفرتايم/cross-skill
        ولا توافق إجازات. الأساس: متوسط التجديل ٦ أيام، لا طلب الفوركاست.
```

**For the Director:** whether the Chief should instead be driven by the forecast→Erlang
requirement is a real choice, not a bug fix. Repointing it would make the guard consistent with
every other screen — and would blind it on the functions that have no volume data. Left as it is,
correctly labelled, until you decide.

### Noted

The briefing is dated **2026-08-01** and carries no age field, while today is 2026-08-09. It is
computed over the newest data that exists, which is right — but every other surface in this audit
learned to declare how far behind "now" it sits, and the executive face is where that matters
most. Recorded rather than changed: the fix belongs with the same `freshness` treatment applied to
the requirement engine (F-021), and is worth doing as one consistent pass rather than a twelfth
one-off.

### Gates

```
627/627 tests · audit-builder CLEAN · cross-check 31/31
audit-requests 8/8 · audit-capacity 108/108 · audit-generator CLEAN
```
