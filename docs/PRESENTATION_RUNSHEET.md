# Sunday Presentation — Run Sheet

**Prepared 2026-07-25 · Boutiqaat Contact-Center WFM Platform**

> One page to run the demo from. What to open, in what order, which number proves
> which claim, what to avoid, and — most importantly — the honest answer to every
> hard question a buyer will ask. Nothing in here is aspirational: every figure
> below was measured on the live system on 2026-07-25 and can be re-measured in
> front of them.

---

## 0 · Twenty minutes before (do this, don't skip it)

```bash
node backend/scripts/preflight.js
```

It prints **GO** or **NO-GO** and, for anything failing, the exact command that
fixes it. It checks, in the order things would hurt:

| Check | Why it is on the list |
|---|---|
| Supervisor | The backend died unattended twice in earlier sessions. PM2 now restarts it — proven by killing it and watching it come back in 18s. This confirms the supervisor is actually running. |
| API up and fast | Obvious, but also catches a half-started process. |
| SPA build fresh | A stale `dist` is invisible until the wrong thing renders on screen. It compares the build time against every source file. |
| Database + feed freshness | Tells you what the roster covers and how current each feed is, before a buyer asks. |
| 46 demo endpoints | Every endpoint the five demo pages call, with real parameters. |
| 13 cross-screen checks | Proves no two screens disagree on the same number. |

**Current state: GO — 8/8 green.**

If the machine has been rebooted, PM2 restores the process automatically
(`pm2 save` is done). To confirm: `npx pm2 list` should show `wfm-backend` online.

---

## 1 · The five-stop route

Run it in this order. Each stop sets up the next, and the story builds from
"we know what happened" → "we know what will happen" → "we act on it now".

### Stop 1 — Roster (`/roster`) · *"One reconciled truth"*

**The claim:** three separate systems (Odoo biometric punch, Ameyo telephony,
Sprinklr omnichannel) plus the published schedule are reconciled into one row per
person per day, and every downstream number is computed from that single spine.

**Numbers on screen (June 2026):** 3,505 person-days · **98.3% conformance** ·
16,978 worked hours · 702h overtime · 140 people · 19,295 rows across the year.

**What to point at:** the coverage note at the top. It states the exact window the
data covers and that the page opens on real data rather than an empty "today".
That honesty *is* the product — a WFM system that silently shows an empty screen
is worse than one that says what it has.

**If asked "is this real or a demo dataset?"** — it is their own live data, seven
months of it, reconciled by the engine. Open **Data Quality** to show what the
engine itself flags as uncertain rather than hiding.

---

### Stop 2 — OT Tracker + Year (`/roster?tab=ot-tracker`, `?tab=ot-year`) · *"We replaced 11 spreadsheets"*

**The strongest single proof in the demo, because it is arithmetic they can check.**

The Director maintained one overtime workbook per occasion — 11 files for 2026.
Those files overlap by design. Stacking every row gives **21,746 hours**. The
truth is **12,807 hours** across 2,855 person-days.

> **8,940 hours — 70% — was double-counted, and no amount of careful
> copy-paste would have caught it.**

Show the **Conflicts** panel: 44 person-days where the source sheets disagree.
The system shows the largest value, lists every candidate with its source sheet,
and asks a human to rule. It does not resolve silently.

Then hit **"Full year 2026 — one sheet"**: every employee × 365 days, month bands,
same colours, live formulas. It opens in Excel as their own workbook would.

---

### Stop 3 — Schedule (`/schedule`) · *"The plan, with rules enforced"*

118 employees · 14 functions · 7 days on screen, with per-day coverage
(66–78% across the week) and per-function counts.

**What to point at:** the coverage strip reconciles exactly — working + off +
leave + absent accounts for all 118 people, every day. That is one of the 13
automated cross-checks; it cannot silently drift.

---

### Stop 4 — Generator (`/schedule?tab=generator`) · *"From forecast to a fair schedule, in one click"*

**Do this live.** Pick the week, pick functions, press Generate.

**The claim to make:** it is demand-driven — forecast → Erlang per function →
required HC per hour → schedule — and it enforces the agreed rules: 10-hour
minimum rest, exactly 2 OFF per week, female-shift rules, fairness across nights
and midnights.

**The differentiator worth saying out loud:** when it cannot cover a requirement,
it says so and explains why, rather than producing a schedule that looks complete
and isn't. A generator that hides a gap is worse than no generator.

---

### Stop 5 — Live Monitoring (`/rta`) · *"Right now"*

**This is the one that is genuinely live** — the Sprinklr feed is current to today
(0 days behind), unlike the roster which is 22 days behind.

180 agents on the board with real state, real queues, live SLA.

**Say the caveat before they find it:** "the scheduled side reads *no roster* for
today because we have not uploaded July's roster yet — the system tells you that
instead of showing 0 out of 0, which would look like nobody came to work." That
single sentence turns a gap into a demonstration of integrity.

---

## 2 · Answers to the hard questions

| They ask | The honest answer |
|---|---|
| "Is the data real?" | Yes — 19,295 reconciled rows, 140 people, Jan–Jul 2026, from their own Odoo/Ameyo/Sprinklr. |
| "How current is it?" | Live feed: today. Reconciled roster: through 3 July — the July upload has not been run. The screens state this themselves. |
| "How do I know the numbers are right?" | 598 automated tests, a gate that blocks any change breaking the pay rules, and 13 cross-checks proving no two screens disagree. Offer to run `preflight.js` in front of them. |
| "What if it crashes?" | It self-heals — supervised, proven by killing the process and watching it recover in 18 seconds. |
| "Can it handle our scale?" | 46 demo endpoints answer in 12–330 ms against seven months of live data. |
| "What is NOT finished?" | See §3 — answer it plainly. Naming your own gaps is what makes the rest credible. |

---

## 3 · What is honestly not finished (say it before they ask)

1. **July roster not uploaded.** The pipeline is one button (Roster → Upload &
   Rebuild); the month simply has not been run. Not a capability gap.
2. **Auto-scoring is data-blocked, not code-blocked.** Only 11.3% of scorecard Net
   Points are computable from live feeds today. The two unlocks are a Sprinklr
   Case-Assignments key (+35 points) and the QA monthly file (+30). The system
   measures and reports this itself — `/scorecard/auto-scoring-readiness`.
3. **OT pay multipliers need formal sign-off.** N ×1.25 · O ×1.5 · H ×2.0 and the
   ÷26÷8 hourly base were read out of the Director's own workbooks, not from an
   approved policy document. They are config constants with a test pinning them
   (D-083). The tracker is read-only and writes no pay data.
4. **20 Sprinklr agents unlinked** — they have no `users` row, so identity cannot
   resolve. They sit in a review queue rather than being guessed. Upstream
   account provisioning, deliberately deferred.
5. **Cloud deployment not done.** Runs on this machine, single origin, port 3000.
   The Docker/nginx/TLS/backup pack exists and is unused.

---

## 4 · Do not click these during the demo

- **Upload & Rebuild** — it rebuilds the whole roster. Correct, but takes time and
  is not something to run live.
- **Publish / Unpublish schedule** — state-changing and audited. Show the button,
  explain the lifecycle, don't press it.
- **Anything under Settings → Users** — account provisioning is deliberately
  incomplete; there is nothing to gain by opening it.

---

## 5 · If something goes wrong

| Symptom | Do this |
|---|---|
| A page is blank | Reload once. The backend self-heals within ~18s; the page will populate. |
| "Cannot reach server" | `npx pm2 restart wfm-backend` from `backend/`, wait 15s. |
| A number looks wrong | Open the same figure in a second place — that is what the cross-checks guarantee. Do not argue from memory. |
| Total loss of confidence | Fall back to the Excel exports (OT tracker, full year). They are self-contained, carry live formulas, and prove the arithmetic without the app. |

---

*Measured and verified on 2026-07-25. Re-run `node backend/scripts/preflight.js`
before presenting — it re-proves every claim on this page in about 30 seconds.*
