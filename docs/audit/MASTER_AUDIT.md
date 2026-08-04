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
