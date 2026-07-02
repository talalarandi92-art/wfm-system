# AI & AUTOMATION OPPORTUNITIES — Boutiqaat WFM Platform

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> Master catalogue of every AI / automation capability in the platform: what is **Built** and running today,
> what is **Partially built**, and what remains an **Idea** — each with its concrete data inputs (already in
> this system), trigger, human-approval gate, effort, and value.
>
> Canonical companions (one master source per fact — this file cross-references, it does not fork):
> - `docs/knowledge/WFM_RULES_AND_DECISIONS.md` — THE single source of truth for business rules (§13 guard team)
> - `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md` — roster engine, `roster_days`, `roster-v2/*` endpoints
> - `docs/RECON_PIPELINE.md` — the Upload & Rebuild reconciliation pipeline
> - `CLAUDE.md` — master module list & roadmap

---

## 1. Governing Principles (Confirmed — the Director's standing orders)

| ID | Principle | Source |
|----|-----------|--------|
| D-AI-001 | **AI never decides alone.** Every AI/automation output is a *recommendation* until a human (or an explicitly-enabled, audited, reversible automation the Director turned on himself) acts on it. | Standing order; encoded in Advisor design ("LLM suggests → human approves") |
| D-AI-002 | **The one sanctioned exception is Auto Mode** — guarded autonomous approve/hold of *safe-surplus* requests: OFF by default, allowed-types configurable (default `["permission"]`), auto-REJECT extra-gated (default off, HR-sensitive), every decision audited (`automode_decisions`, actor = the human who enabled it, never null) and reversible (`/automode/decisions/:id/revert`). | Memory `automode_and_chief_face` (built 2026-06-14, user-requested) |
| D-AI-003 | **DECLINED — self-modifying code.** A bot that auto-fixes / deploys its own codebase was explicitly refused (no human review = dangerous). The safe loop instead: guards DETECT + DESCRIBE → Diagnostics report → human forwards → human/LLM-with-approval fixes. **Do not build autonomous self-coding.** | Memory `automode_and_chief_face`, `diagnostics_report` |
| D-AI-004 | **DECLINED — fake counterfactual score.** The "Counterfactual Roster Replay / schedulability score" was refused for the 750k demo because demand derived from the schedule itself is circular (~always 100% = a fake metric). It stays the flagged "next big build" **only after** an independent per-hour demand signal (`ops_contacts` / Erlang) is wired. Never ship a metric whose input is its own output. | Memory `command_center` (2026-06-24) |
| D-AI-005 | **Verified-data-only on executive surfaces.** The Command Center aggregates only verified endpoints — every number real, no demo/mock. A feature on mock data is not complete (rules doc §0). | Memory `command_center`; `WFM_RULES_AND_DECISIONS.md` §0 |
| D-AI-006 | **Deterministic-first, LLM-upgrade.** Every guard works FREE (deterministic) with no API key; setting `ANTHROPIC_API_KEY` upgrades Advisor / Expert / Chief / Researcher narration at once. Endpoints return `{llm:true|false}` so the UI never pretends templated output is intelligence. The Director stays free until value is proven to management. | Memory `advisor_llm`, `expert_and_chief` |
| D-AI-007 | Guards run **behind** one face: the sidebar shows only the **Chief**; the team is reachable from the Chief's "team behind the scenes" panel. | Rules doc §13; memory `automode_and_chief_face` |

---

## 2. The AI/Automation Stack As-Built (Confirmed, live today)

The platform already runs a **team of 8 guards + the Chief** — the canonical 8-guard lineup (RULES §13) is
**Health · Analyst · Reporter · Security · Scorecard · Researcher · Expert · Reply-Helper**; the **Advisor
LLM** (listed in the table below for completeness) is the key-gated narration layer on top of them. All are
deterministic background workers on the real PostgreSQL data (NestJS `OnModuleInit` timer pattern — no
`@nestjs/schedule` dependency), plus the LLM layer that activates with one env var.

### 2.1 The guard team (all **Built**)

| # | Guard | Module / route | What it does autonomously | Cadence | Human gate |
|---|-------|----------------|---------------------------|---------|------------|
| 1 | **Health Guard** | `backend/src/modules/health-guard/` → `/system-health` | 11 checks: technical (db, migrations, attendance freshness, Sprinklr freshness, SLA-worker liveness) + calculation rule checks (female cross-midnight FAIL, female >20:00 WARN, rest<10h FAIL, function shift policy, present-no-schedule, employee-no-function). Score 0–100. | 30 min sweep; notifies admin/WFM/RTA on NEW fail | Detect + notify only — never mutates |
| 2 | **Analyst** | `modules/analyst/` → `/analyst` (migration 029) | Assesses coverage (per-function hourly required vs available → bottleneckGap), schedule rules, Sprinklr queues, compliance offenders; issues verdicts `approve/caution/danger` + a recommendation. **LEARNS** from operator Accept/Reject: nudges `analyst_thresholds.surplus_safe` (accept −0.25 min 1, reject +0.5 max 5). | On demand + feeds Chief/AutoMode | Recommendations carry Accept/Reject buttons — human decides, machine adapts |
| 3 | **Reporter** | `modules/reporter/` → `/reports-bot` (migration 030) | Auto-composes daily reports (coverage/compliance/queues/schedule/requests/health) from recipes (`report_recipes`), fires at schedule_time (Kuwait), notifies recipients, Excel export via SheetJS. | 5-min loop, once/day per recipe | Humans consume; recipes human-created |
| 4 | **Advisor (LLM)** | `modules/advisor/` + `modules/llm/llm.service.ts` → `/advisor` | Anthropic Messages API (no npm dep, Node fetch; `x-api-key`, 45s timeout, returns null never throws). Embeds `WFM_KNOWLEDGE` system prompt = our codified rules. `/advisor/brief` narrates the live situation, `/advisor/ask` free-form Q&A, `/advisor/improvements` proposes system/design/process improvements. Templated fallback when unkeyed. | On demand | **Suggests only** — the safe continuous-improvement loop (D-AI-001) |
| 5 | **Security Guard** | `modules/security-guard/` → `/security-guard` | 10 checks in 3 categories — accounts (failed logins, stale passwords, dormant), access (privileged admins, orphan users, **access_not_revoked** for leavers = highest-value), audit (freshness, untraceable changes). | 30 min sweep; notify on NEW fail | Detect + notify only |
| 6 | **Expert** | `modules/expert/` → `/expert` | 14-topic WFM knowledge corpus (Erlang, forecasting, adherence, shrinkage, occupancy, omnichannel, attrition, coaching, RTA, scheduling, concurrency, reporting, scorecard design) + **searches the 146 ingested KB articles** (`searchKb`, keyword-ranked over `kb_articles`). `ask()` answers grounded in corpus + live analyst context. | On demand | Advisory only |
| 7 | **Scorecard Guard** | `modules/scorecard-guard/` → `/scorecard-guard` | Reviews real `scorecard_entries` (net_points + 11 KPI scores): by-function/TL averages, top/bottom 5, below-target list each with the **weakest KPI**; background scan upserts `coaching_flags` (`low_scorecard`). | 6 h scan | Flags feed the human coaching workflow |
| 8 | **Researcher** | `modules/researcher/` → `/researcher` | Curated catalogue of 10 WFM innovations mapped to OUR platform (have/partial/missing + action); gap feed + digest (LLM-synthesized when keyed). | On demand | Advisory only |
| — | **The Chief** | `modules/chief/` → `/chief` | Orchestrator: injects all guard services; `briefing()` = overall posture (worst-of), per-domain lines, top-8 prioritized cross-cutting directives, learning stats, Auto Mode summary, guard self-test. LLM executive brief when keyed. | On demand (the sidebar face) | Presents; the Director acts |

Supporting reports (Built): **Knowledge Ledger** (`/knowledge-ledger` — every knowledge item with
what/benefit/source/date, grows automatically) and **Team Learning** (`/team-learning` — what each guard
learned + inter-guard exchanges). **Reply Helper** (`/reply-helper`) — agent pastes a customer message →
matching canned-response script from 120 full-text `kb_scripts` (AR+EN, one-click copy).

### 2.2 Autonomous background automations (Built)

| ID | Automation | Trigger | Behaviour | Gate |
|----|-----------|---------|-----------|------|
| AUT-001 | **SLA auto-escalation** (migration 027, `modules/sla-escalation/`) | 3-min loop | `pending/peer_pending` past `sla_due_at` → sets `escalated_at`/`escalation_level=1`, notifies RTA/WFM/ops/admin roles, audits (`request.sla_escalated`, actor 'system'). Idempotent. | Escalates visibility only — never approves/rejects |
| AUT-002 | **Coaching auto-flags** (migration 028, `modules/coaching/`) | 6-h scan | Last 30 days of attendance: repeated_late / repeated_early_out / missing_punch ≥3 → open `coaching_flags` (severity ≥6 high / ≥4 medium), notifies TL/WFM. Flag → human schedules the 1:1 (`coaching_sessions`). | Flags only; the coaching session is a human act |
| AUT-003 | **Auto Mode** (migration 031, `modules/automode/`) | 3-min loop over enabled tenants | For pending requests of allowed types: analyst verdict `approve` (safe surplus) → auto-approve; `danger` → auto-reject **only if** opt-in; `caution` → hold. Audited + notified + revertible. Verified live: approved 1 safe-surplus, held 12 caution. | D-AI-002 — the one sanctioned autonomy, human-enabled + reversible |
| AUT-004 | **Smoke Test** (`modules/smoke-test/`) | daily + on demand from Chief | Exercises REAL write paths (generate+saveDraft+delete, tx-rollback probes for publish/request/correction) — catches runtime raw-SQL bugs tsc misses. Notifies admins on any failed probe. | Detect only (probes always roll back — zero mutation) |
| AUT-005 | **Diagnostics** (`/diagnostics`) | on demand | Consolidates health + security + analyst + smoke into one issue list with **Copy-report** → the human forwards it for fixing. The codified answer to "can the bot self-fix?" = NO (D-AI-003). | Human-in-the-loop by design |
| AUT-006 | **Outage email automation hook** | outage lifecycle | Email automation on outage open/resolve (code present; delivery depends on mail config). | Human owns the outage workflow |
| AUT-007 | **KB continuous learning** (migrations 062–064) | on re-import | Incremental corpus import (md5 content_hash) records new/updated into `kb_changes` → "What's New" banner + badges. | Content authored by humans upstream |

### 2.3 The LLM layer (Built, key-gated)

- `LlmService.chat(system, messages, maxTokens)` — Anthropic Messages API; `isConfigured()` =
  `!!(ANTHROPIC_API_KEY || LLM_API_KEY)`; model via `LLM_MODEL`; endpoint override `LLM_ENDPOINT`.
- **Activation:** set `ANTHROPIC_API_KEY` in root `.env`, rebuild/restart backend — Advisor, Expert `ask`,
  Chief brief, Researcher digest all upgrade at once; BotsHub auto-detects and flips Advisor from SKIP to OK.
- Status as of last verification: **no key set** (all guards running in deterministic/fallback mode) — D-AI-006.

---

## 3. Opportunity Matrix — the full catalogue

Status legend: **Built** (live, verified) · **Partially built** (real foundation exists, gap named) ·
**Idea** (Recommended — needs Director approval before any build; per the standing order, nothing here is
an agreed rule until confirmed).

Effort: S (≤1 day) / M (2–5 days) / L (1–3 weeks). Value: ★–★★★ (operational impact).

| ID | Opportunity | Status | Effort | Value |
|----|-------------|--------|--------|-------|
| AI-01 | AI schedule recommendation | **Partially built** | M | ★★★ |
| AI-02 | Pre-publish risk detection | **Partially built** | S–M | ★★★ |
| AI-03 | Request approval assistant | **Built** | — | ★★★ |
| AI-04 | Attendance anomaly detection | **Partially built** | M | ★★ |
| AI-05 | Outage impact analysis | **Partially built** | M | ★★ |
| AI-06 | Coaching suggestions | **Built** | — | ★★ |
| AI-07 | Forecast accuracy tracking | **Partially built** | S | ★★ |
| AI-08 | Staffing gap prediction | **Partially built** | M | ★★★ |
| AI-09 | Fatigue risk scoring | **Idea** | M | ★★ |
| AI-10 | Shift fairness score | **Built** | — | ★★ |
| AI-11 | Compliance score (per person/team) | **Partially built** | S–M | ★★ |
| AI-12 | Schedule quality score | **Idea** (gated by D-AI-004) | L | ★★★ |
| AI-13 | SLA risk alerts (predictive) | **Partially built** | S | ★★ |
| AI-14 | Auto-escalation | **Built** | — | ★★ |
| AI-15 | Smart notification routing | **Partially built** | M | ★ |
| AI-16 | What-if simulation | **Partially built** | M–L | ★★★ |
| AI-17 | Scenario planning | **Partially built** | M | ★★ |
| AI-18 | Root-cause analysis (RCA) | **Idea** | M | ★★ |
| AI-19 | Knowledge-base integration | **Built** | — | ★★ |
| AI-20 | Workflow automation | **Partially built** | M | ★★ |
| AI-21 | Executive cockpit | **Built** | — | ★★★ |

### AI-01 · AI schedule recommendation — Partially built
- **What:** propose next-period schedules that satisfy demand, rules, and fairness; explain the trade-offs.
- **Already have:** the **demand→schedule chain** on `roster_days` (rules doc §10): `roster-v2/generate`
  (per-hour demand → greedy set-cover shift mix) → `generate-week` (per-employee week: female no-midnight,
  night→least-loaded, OFF→weekend-deprived) → `save` (draft) → **safe `publish`/`unpublish`** into
  `attendance_records` (atomic `INSERT … ON CONFLICT DO NOTHING`, never overwrites, reversible — verified
  live 259→0). Plus the fairness engine (`roster-v2/fairness`) and the pure fair-scheduling generator.
- **Gap:** the recommendation is deterministic-greedy; no LLM narration of *why* this mix, no alternative-plan
  comparison, no coverage-gap "suggested solutions" narrative (more males / cross-skill / OT / exception).
- **Trigger:** WFM clicks Generate for a future week. **Gate:** Draft → human review → explicit Publish
  (schedule states, rules doc §10). Generator must show gaps honestly, never hide them (CLAUDE.md §11).

### AI-02 · Pre-publish risk detection — Partially built
- **What:** a single gate that scores a draft schedule before Publish: rule violations, coverage gaps,
  fairness deltas, rest violations.
- **Already have:** all the individual detectors — Health Guard's forward-looking calculation checks
  (female cross-midnight/late-night, rest<10h, function shift policy), generator staffing check, fairness
  before/after, HC-by-interval impact. Publish itself is already structurally safe (only fills empty weeks).
- **Gap:** they run as separate surfaces; there is no one "Pre-publish report card" bound to the Publish button.
- **Trigger:** on Save-draft / before Publish. **Gate:** report blocks nothing — it informs; the human
  publishes (or overrides with the warning logged, per the manual-override rule CLAUDE.md §6.8).

### AI-03 · Request approval assistant — Built
- **What:** show the approver the coverage consequence of saying yes, and optionally act on the safe cases.
- **Have:** the **Permission HC-impact panel** reads canonical `roster_days` (repointed from stale
  `attendance_records` — rules doc §16 RESOLVED) so approval correctly shows the headcount drop during worked
  hours; the **Analyst** verdict (`approve/caution/danger` per function/date); **Auto Mode** (AUT-003) acts on
  the safe-surplus subset. Only **Approved** permissions consume/exempt (rules doc §2).
- **Gate:** human approves all `caution`/`danger`; Auto Mode per D-AI-002.

### AI-04 · Attendance anomaly detection — Partially built
- **What:** surface abnormal attendance patterns beyond fixed thresholds.
- **Already have:** coaching auto-flags (AUT-002, threshold ≥3/30d); the recon engine's **credible windows**
  (`CRED_LATE`/`CRED_EARLY` = 7..240 min, >6 tolerated — rules doc §19) so noise is pre-filtered; the
  role-blind **no-punch-AND-no-system flag** (`data_quality`, worked_min=0); `unconfirmed` presence for
  low-capture roles; the Data Quality report page.
- **Gap / Idea (Recommended):** statistical anomaly detection over `roster_days` — e.g. a person whose late
  pattern shifts vs their own baseline, weekday-specific absence patterns, WFH-day-adjacent sickness. Inputs
  all exist in `roster_days` (per-day late/early/presence/OT per person_no).
- **Gate:** anomalies are flags for TL/WFM review — never an HR action by themselves.

### AI-05 · Outage impact analysis — Partially built
- **What:** quantify an outage's staffing/SLA impact before/during/after automatically.
- **Already have:** the outage module (type, impacted function/channel, severity, intervals, RTA validation,
  SLA, email hook AUT-006); Sprinklr queue snapshots (`integration_snapshots`) the Analyst already reads;
  hourly coverage per function.
- **Gap:** the before/during/after impact calculation (CLAUDE.md §20 step 7) is not automated — it needs a
  join of outage window × hourly coverage × queue metrics, plus optional LLM narrative.
- **Trigger:** outage marked resolved (or on demand while ongoing). **Gate:** report only.

### AI-06 · Coaching suggestions — Built
- **Have:** two independent feeders into one human workflow: attendance-pattern flags (AUT-002) and
  Scorecard-Guard below-target flags **with the weakest KPI identified** per person. Flag → TL schedules the
  1:1 (`coaching_sessions`, focus_areas = trigger). LLM upgrade (Idea, Recommended): draft the coaching talking
  points from the person's evidence jsonb. **Gate:** the coach owns the session and the message.

### AI-07 · Forecast accuracy tracking — Partially built
- **Have:** the Forecasting module (`modules/forecasting/`) — seasonal-weighted-recency baseline over real
  `ops_contacts`, **backtest** with WAPE (headline) / MAPE / bias, honest `dataPoints` (no fake zeros),
  persistence + audited manual overrides (migration 036), Erlang-C forecast→required-HC, Excel export.
- **Gap (named in memory):** **accuracy-over-time tracking vs stored actuals** — persist each saved forecast's
  error once actuals land, trend WAPE by channel/week, and flag model drift. Also not built: event calendars
  (Ramadan / campaign / salary-day multipliers — `campaigns` table exists, migration 024) and ML models.
- **Trigger:** nightly once actuals close. **Gate:** informational; overrides stay human + audited.

### AI-08 · Staffing gap prediction — Partially built
- **What:** predict tomorrow/next-week's gap per function/hour before it happens.
- **Already have:** Analyst coverage (required from same-weekday history vs available after sick/absent/perm/
  late/early — today-focused); Forecasting `requiredHc` per interval (forward-looking demand side); the
  workforce-analytics **coverage forecast** (task #15, done); hourly coverage Required/Scheduled/Available/Gap.
- **Gap:** the two sides aren't joined into one forward view: forecasted required HC (Erlang) × the actual
  published schedule × predicted shrinkage → gap heatmap for the coming week, with alerts.
- **Trigger:** on schedule publish + daily. **Gate:** alerts only; fixing the gap is a human schedule action.

### AI-09 · Fatigue risk scoring — Idea (Recommended)
- **What:** per-person fatigue index from consecutive working days, night/midnight streaks, rest windows,
  cross-midnight frequency, and OT load — flag before burnout, feed rotation.
- **Inputs already in-system:** `roster_days` per-day shift codes + worked_min + TRUE_OT; the rest<10h checker
  (Health Guard); night/midnight load per person (fairness engine); the 180h/year OT-cap report (rules doc §6).
- **Trigger:** weekly scan + on schedule generation (penalize assigning night to high-fatigue). **Gate:**
  a flag/score for WFM — never auto-changes a schedule. Scoring bands need Director sign-off before use.

### AI-10 · Shift fairness score — Built (EXISTS)
- **Have:** `/roster-v2/fairness` — `fairnessScore = 100 − stdev` of night/midnight load over the fair pool;
  separate **weekend-OFF fairness**; optional **NIGHT TEAM carve-out** (migration 065, the Director's choice);
  rebalance proposal (current staff only, female = night-only). Live snapshot: fairness 79, weekend-OFF 81 —
  both on the Command Center gauges. See rules doc §8. Nothing to build; extend only on request.

### AI-11 · Compliance score — Partially built
- **What:** one composite attendance-compliance score per person/team (late, early, missing punch/system,
  absence, conformance) for ranking and trend.
- **Already have:** all components in `roster_days` (credible late/early, conformance% with approved-permission
  add-back — rules doc §5, presence, missing punch); the tardiness↔conformance fold (`/attendance/tardiness`);
  scorecard attendance KPI; platform-level scores exist (Health 0–100, Security 0–100).
- **Gap:** the weighted composite per person/team + its bands. **Weights/bands = a business rule → must be
  agreed with the Director before shipping** (do not invent bands — same discipline as the scorecard study).
- **Gate:** score is informational; HR action still flows through the existing WFH-HR/tardiness reports.

### AI-12 · Schedule quality score — Idea (explicitly gated by D-AI-004)
- **What:** grade a published schedule against *independent* demand: coverage attainment, over/under-staffing
  cost, SLA attainability ("the counterfactual roster replay").
- **Boundary:** **declined once as fake** — demand derived from the schedule is circular. Build **only after**
  per-hour independent volume is wired (`ops_contacts` per-hour × Erlang-C — the Forecasting module already
  computes requiredHc, so the missing piece is the replay join + the honest scoring definition).
- **Value when real:** genuinely novel (NICE/Verint don't replay the optimizer on actuals — memory
  `command_center`). **Gate:** Director approves the scoring definition before it appears on any surface.

### AI-13 · SLA risk alerts (predictive) — Partially built
- **Have:** post-breach handling is Built (AUT-001); Health Guard's `sla_worker` check detects the loop being
  down; Analyst flags problem queues (slaPct < target, backlog > max) from Sprinklr snapshots.
- **Gap:** the *pre*-breach alert — "these 4 pending requests breach within 2h" (simple query on `sla_due_at`
  window) and "WhatsApp backlog trajectory breaches SLA by 16:00" (slope over recent snapshots).
- **Trigger:** the existing 3-min loop. **Gate:** notification only.

### AI-14 · Auto-escalation — Built (EXISTS)
- AUT-001. Extension idea (Recommended): escalation_level 2+ (re-escalate to the next chain tier after N hours)
  — the column already exists.

### AI-15 · Smart notification routing — Partially built
- **Have:** every guard/automation routes by role (platform_admin / wfm_analyst / rta / TL…), typed
  notifications (`health_guard`, `security_guard`, `report_ready`, `sla_escalation`, `coaching`, `smoke_test`),
  and the BotsHub feed.
- **Gap / Idea:** per-user preference learning (mute/priority by type — the open "Reporter preference-learning"
  item), digest bundling (one morning digest instead of N pings), quiet-hours. **Gate:** user controls own prefs.

### AI-16 · What-if simulation — Partially built
- **Have:** before/after impact is a platform-wide pattern (Confirmed rule): edit/swap → shift-rate before/after
  both employees, HC-by-interval before/after, permission HC-impact before/after; capacity scenario inputs.
- **Gap:** a free-form simulator — "what if 3 agents move CH→WA for a week / what if we add 2 male nights" —
  replaying coverage + fairness + rest over a hypothetical roster copy without touching live data.
- **Inputs:** `roster_days` (clone range), the demand chain's staffing check, fairness engine. **Gate:**
  simulation is sandboxed by definition; applying any result goes through the normal draft→publish path.

### AI-17 · Scenario planning — Partially built
- **Have:** Capacity module (Erlang-C verified 100% vs textbook + concurrency-4 chat model + email backlog
  model + intern-70% factor) with Base / Shrinkage / OT scenarios **plus the P99 surge scenario** (capacity
  audit); forecast save/load.
- **Gap:** persisted, named, comparable capacity scenarios (save/compare/share — CLAUDE.md §14 "Save scenario")
  and the order-driven forecast (orders × CPO → HC) from `data_assets_and_reports`.
- **Gate:** planning artifacts; hiring/OT decisions are human.

### AI-18 · Root-cause analysis — Idea (Recommended)
- **What:** when a KPI dips (conformance, coverage, SLA), auto-assemble the likely drivers: who/which
  function/which hours, correlated events (holiday, outage, campaign, schedule change), and a narrative.
- **Inputs already in-system:** `roster_days` (per-day per-person everything), `holidays` table, outages,
  `campaigns` (blackout/peak windows), schedule change log, queue snapshots, audit logs. Diagnostics (AUT-005)
  already aggregates *issues*; RCA would explain *movements*.
- **LLM role:** narration over a deterministic driver-decomposition (never invent causes without the data).
- **Gate:** analytical output only.

### AI-19 · Knowledge-base integration — Built (EXISTS)
- **Have:** 146 clean articles (~56.5k words) ingested from the real Odoo KB into the existing `kb_articles`
  module (migrations 062–064): Expert `searchKb` merges KB hits into answers; **Reply Helper** suggests among
  120 full canned-response scripts; incremental re-import with What's-New change tracking; reusable
  pull→corpus pipeline. **Pending (named):** SOP ↔ KB reconciliation; the Outlook email-analysis idea.

### AI-20 · Workflow automation — Partially built
- **Have:** approval chains + SLA per request type (15 types incl. shift-swap peer acceptance), SLA
  escalation, Auto Mode for the safe subset, workflow-SLA reports with expandable timelines, leave-balance
  ledger with opt-in over-request block (migration 038).
- **Gap / Ideas (Recommended):** auto-suggest alternate permission times when the requested slot is `danger`
  (Analyst already knows the safe hours); swap-partner suggestions (skill/coverage/rest-compatible); auto-apply
  approved swaps to the schedule (the swap-to-schedule carryover item). **Gate:** suggestions only; every
  status change stays in the approval chain + audit.

### AI-21 · Executive cockpit — Built (EXISTS)
- **Have:** **Command Center** (`/command-center`, first sidebar item) — verified-data-only single screen:
  Chief posture + directive, 4 gauges (Coverage / Conformance / Fairness / Weekend-OFF), 6 count-up tiles,
  risk BarRows, presence donut; **Chief briefing** (posture, ranked priorities, learning stats, self-test);
  Control Dashboards role switcher. LLM executive narration activates with the key (D-AI-006).
- **Note:** the 2026-07-01 audit recommends consolidating the 4 overlapping landings (Dashboard /
  CommandCenter / ControlDashboards / WfmOverview) into one — part of the page-merge plan
  (**Needs Approval**, D-068 — awaiting the Director's go).

---

## 4. Cross-cutting inputs the AI layer already owns

Every opportunity above runs on data that already exists — no new instrumentation needed:

| Input | Where | Used by |
|-------|-------|---------|
| `roster_days` (RICH canonical: per person_no per day — shift, presence, worked_min, TRUE_OT 3 buckets, credible late/early, permission, hr_code, data_quality) | recon engine, `docs/RECON_PIPELINE.md` | AI-01/02/04/08/09/10/11/16/18 |
| `ops_contacts` per-hour volume + `agent_daily_stats` AHT | Forecasting module | AI-07/08/12/17 |
| `analyst_recommendations` + `analyst_thresholds` (the accept/reject learning loop) | migration 029 | AI-03/08; the platform's only live ML-ish loop |
| Sprinklr queue snapshots (`integration_snapshots`) | Sprinklr bridge | AI-05/13 |
| `holidays` (editable) + `campaigns` (peak/blackout) | recon-config sync, migration 024 | AI-07/18 |
| `coaching_flags` / `coaching_sessions` | migration 028 | AI-06 |
| `scorecard_entries` (real KPI grain) | scorecard module | AI-06/11 |
| `kb_articles` / `kb_scripts` / `kb_changes` | migrations 062–064 | AI-19 |
| Audit logs + schedule change log + request envelope | core schema | AI-18/20 |
| Guard scores (Health / Security 0–100) + smoke probes | guard modules | AI-02/13/18 |

---

## 5. Recommended build order (Recommended — needs Director approval)

Ranked by value ÷ effort, respecting the audit's "stabilize before new features" posture and the pending
page-consolidation plan:

1. **AI-07 accuracy-over-time** (S) — closes the forecasting loop; pure add, no rule risk.
2. **AI-13 predictive SLA alerts** (S) — one query + one slope on existing loops.
3. **AI-02 pre-publish report card** (S–M) — composes existing detectors at the Publish moment; directly
   serves the publish/lock rule.
4. **AI-08 staffing-gap forward view** (M) — joins Forecasting × published schedule; the natural sequel to
   the coverage-forecast task already done.
5. **AI-11 compliance score** (S–M) — **after** the Director agrees the weights/bands.
6. **AI-05 outage impact** + **AI-18 RCA** (M each) — reporting depth; LLM narration optional.
7. **AI-09 fatigue risk** (M) — bands need sign-off.
8. **AI-16 what-if simulator** (M–L) — high demo value, sandboxed.
9. **AI-12 schedule quality score** (L) — **last**, and only once independent per-hour demand is wired
   (D-AI-004 boundary).

Standing sequencing constraints (Confirmed): the §16 number-changing drifts (shift-category unification,
Net-Points person-grain) come with full re-validation and before any AI feature that consumes those numbers
(fatigue, compliance, quality scores would inherit the drift otherwise); and the LLM key decision stays the
Director's (D-AI-006).

---

## 6. Boundary Register (never cross without a new explicit decision)

| ID | Boundary |
|----|----------|
| B-AI-01 | No autonomous self-modifying/self-deploying code (D-AI-003). Guards detect; humans fix. |
| B-AI-02 | No circular/fake metrics on any surface (D-AI-004). A score's inputs must be independent of its outputs. |
| B-AI-03 | No silent auto-approval beyond Auto Mode's configured safe-surplus scope; auto-reject stays opt-in (D-AI-002). |
| B-AI-04 | No demo/mock data presented as live (D-AI-005); templated LLM fallbacks must self-identify (`llm:false`). |
| B-AI-05 | No new scoring bands/weights (compliance, fatigue, quality) executed before Director agreement — recommendations are labelled as such. |
| B-AI-06 | AI outputs never bypass the audit trail: every automated action writes `audit_logs` with a real actor. |

---

*End of file. When a new AI capability ships or a boundary changes, update this file AND the corresponding
section of `docs/knowledge/WFM_RULES_AND_DECISIONS.md` in the same commit — one master source per fact.*
