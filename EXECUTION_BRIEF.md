# EXECUTION BRIEF — Boutiqaat WFM → Production

> **This document is written FOR the executing model (Fable 5).** It is self-contained: read it once,
> then execute. It folds together three audits run on 2026-07-05/06 (whole-system inventory ·
> production-readiness · world-class WFM benchmarking) so you do **not** need to re-audit. Cite
> `file:line` when you touch code; everything below is already evidence-based.
>
> Prepared by Opus 4.8 as design/engineering lead. Goal: take a REAL, RUNNING system to
> **100% production-ready** — evolve it, do not rewrite it.

---

## 0. MISSION & TOKEN DISCIPLINE (read first)

**Mission.** Boutiqaat Contact-Center WFM: NestJS + TypeORM backend (`backend/src/modules`, ~66 routes,
~60 modules), a standalone reconciliation engine (`backend/scripts/recon-*.js`), a React+Vite frontend
(`frontend/src`, ~88 pages → 17 nav + 16 hubs), live PostgreSQL `wfm_db` with **real** data. It is NOT a
prototype. ~70% is genuinely wired to live data; ~20% is built-but-inert (correct code, empty data
source); ~10% is dead/orphaned. Your job is to close that last 30% and harden the whole for production.

**Token discipline (the Director is paying per token — be surgical):**
1. **Do not re-audit.** §3 gives you the inventory, the bugs, and the dead code with `file:line`. Read a
   file only when you are about to edit it.
2. **Work phase by phase, one commit per item.** Never batch unrelated changes. Small, verifiable diffs.
3. **Dry-run + diff before any recon/data change.** A prior refresh regressed silently — never blind-run.
4. **Prefer targeted `Grep`/`Read` over broad exploration.** You already know where things are.
5. **Stop at each phase's exit criteria and report** before starting the next. Do not free-run to Phase 4.
6. **Reuse, don't reinvent.** Every change extends an existing code path. Copy the nearest working pattern.

---

## 1. NON-NEGOTIABLE OPERATING RULES

- **Evolve, never rewrite.** The foundations are real; the defects are *divergence, staleness, and
  dead surfaces* — not missing foundations.
- **The rules doc wins.** `docs/knowledge/WFM_RULES_AND_DECISIONS.md` is the single source of truth for
  every business rule. If code conflicts with it, **fix the code, not the rule.**
- **Confirmed vs Recommended.** Never change an agreed business rule silently. Tag every proposal
  **Confirmed** (already agreed with the Director) or **Recommended** (your suggestion) so the Director
  decides. The Director's standing rule: *"ما بدي اظلم حد"* — never wrongly punish an employee; weak
  evidence routes to Data Quality, never to an HR action.
- **Canonical spine invariant.** All new writes land on `roster_days` (via the recon engine or the
  guarded dual-write). Every business rule is re-applied on each `recon-refresh`, so a rule left patched
  into data is wiped on the next rebuild — **rules live in the engine, never in the data.**
- **Repo-as-memory.** The 6 books under `docs/master/` (§8) ARE the memory. After every merge, update the
  relevant book + the memory per the `enterprise-wfm-platform` skill's MEMORY UPDATE PROTOCOL.
- **Evidence over assertion.** Cite `file:line`/endpoint. Distinguish "wired to real data" from
  "built-but-inert" from "mock". Never call a prototype complete.
- **PostgreSQL/TypeORM gotchas (already bit us):** `ds.query()` has no `.rowCount`; separate
  `ds.query('BEGIN')`/`COMMIT` is a **fake** transaction — use a `QueryRunner`; Postgres lowercases
  unquoted aliases; compare dates as `work_date::text`; never `toISOString()` for local dates (use the
  `fmtLocal`/`ymdLocal` helpers) — Kuwait is UTC+3 and it causes off-by-one.

---

## 2. READ-ORDER (so you find everything immediately)

Read these, in order, before touching code. Do not read more than this up front.

1. **This file** (`EXECUTION_BRIEF.md`).
2. Load the **`enterprise-wfm-platform`** skill (routes all WFM work + the memory protocol).
3. `docs/master/MASTER_PROJECT_MEMORY.md` — the project brain (📘 Project Bible).
4. `docs/knowledge/WFM_RULES_AND_DECISIONS.md` — the rule source of truth (wins on conflict).
5. `CLAUDE.md` — auto-loaded project instructions (its top links to this brief).

Per-phase, read only the specific doc that phase names (e.g. `DATA_DICTIONARY.md` for the one-spine work).
The memory index is `.claude` project memory (`MEMORY.md`) — consult it when a topic is unfamiliar.

---

## 3. CURRENT STATE (do not re-audit — this is the inventory)

### 3.1 System inventory

| Subsystem | Health | Real & done | Partial | Dead / inert |
|---|---|---|---|---|
| **Recon engine / `roster_days`** | 🟢 rule-rich | orchestrator, in-engine rules, OT/tardiness clamps (commit a33fb22), ingest safety, restore, editable holidays | self-QA, legacy `reconcileDay` | **zero unit tests**, `permission_status` NULL |
| **Schedule / generator / rotation** | 🟢 wired | fairness+demand engines, publish/lock, dual-write, shift-rate, ladder | rotation groups, demand persistence | **3 overlapping generators**, Custom Rotation Builder (stored, never applied) |
| **Live / RTA / coverage / headcount** | 🟡 split | RTA screen, week-forecast, gap-remedies, coverage/hourly | Sprinklr `/coverage`, adherence | `headcount_intervals` **never INSERTed**, `/rta/live` orphaned |
| **Requests / approvals** | 🟡 fragmented | unified list, swap peer-accept, HC-impact, SLA escalation, attachments | 2-level permission, leave-balance | **OT/Break approve = cosmetic (no side-effect)**, no idempotency |
| **Capacity / forecasting** | 🟡 ~60% | Erlang-C (textbook), live-plan, volume forecast, backtest | scenario persistence | **staffing layer DEAD (AHT 100% NULL)**, lean/withOT inverted |
| **Scorecard / coaching / productivity** | 🟡 fragmented | KPI upload, Net Points, coaching flags, skills matrix | cumulative analyze | `kpi-source` (0 rows), skill `expires_at` never derived |
| **Integrations / import** | 🟡 mixed | Sprinklr push bridge (live), Excel import, file-based recon | Sprinklr REST poller, **Odoo XML-RPC transport works** | Ameyo live bridge orphaned, Odoo manual-only |
| **AI guards + Chief (15 mods)** | 🟢 real, **dormant** | 8 guards, Chief, Auto Mode, Bots, diagnostics | researcher, expert, advisor, ledger | **all LLM narration dormant** (no key + wrong model id) |
| **Frontend / design** | 🟢 near-full | 88→17 nav+16 hubs, 3 themes, RTL/i18n | legacy `ds.tsx` | `Placeholder.tsx` (0 importers), duplicate `useCountUp` |
| **Data model / auth / migrations** | 🟢 strong | 69 SQL migrations, JWT+refresh+MFA, RBAC (~70 perms), immutable `audit_logs`, merge/dedup | — | **user-lifecycle unaudited**, demo-seed shared password |

### 3.2 The three employee-day tables (never cross-wire — this is the #1 confusion)

- **`roster_days`** — the RICH canonical table (person_no key, OT buckets, ~74 cols). Read by every
  `roster-v2/*` report. **All corrections land here.**
- **`attendance_records`** — the RAW/published schedule table (31 readers: dashboard, RTA, scorecard,
  coverage). **recon-refresh never resyncs it** → same KPI shows different numbers depending on the page.
- **`roster_daily`** — a THIN legacy table (`payload jsonb`), read only by the legacy `/dashboard` path.

### 3.3 Top bugs / gaps (ranked — fix in the phases below)

| # | Bug/Gap | Where | Fix class |
|---|---|---|---|
| 1 | recon-refresh never resyncs `attendance_records` → live/RTA/coverage/scorecard stale after every rebuild | recon-refresh pipeline | add a 4th pipeline step (project roster_days→attendance_records) |
| 2 | Two divergent metric defs (TRUE_OT vs raw `ot_minutes`; CRED_LATE vs raw punch late) | `recon.controller.ts:42-46` vs 31 readers | extract shared consts + retarget |
| 3 | June half-rebuilt; authority file overwritten by a 3-day slice | `recon-new-roster.js:27` SRCDIR | restore full-month file + one full recon-refresh (Phase 0) |
| 4 | `editCell` roster_days UPDATE lacks worked-day guard → manual edit corrupts real punch/login rows | `schedule.service.ts:826-830` | one-line: `AND punch_in_min IS NULL AND sys_login_min IS NULL` |
| 5 | Forecast staffing permanently null (AHT source 100% NULL) | `forecasting.service.ts:69-76` | ingest AHT → `agent_daily_stats.aht_seconds` + fallback |
| 6 | Two parallel permission systems; richer 2-level path is dead code | `permission-request.service` vs `RequestsService.approve` | unify — pick one owner |
| 7 | No idempotency guard on approve (leave/permission/OT can double-stamp) | `RequestsService.approve:659` | add applied guard |
| 8 | `headcount_intervals` never INSERTed → 4 read sites get zeros | `sprinklr.service.ts:615`, `break-scheduler.service.ts:179` | populate (CTE/job) or retire |
| 9 | OT/Break approvals have no side-effect (approve = cosmetic) | `RequestsService.approve:669` | wire roster_days OT / break_slot write |
| 10 | Intern-fold inconsistent (permission HC-impact + RTA use raw `role_function`) | `requests.service.ts:1654`, `rta.controller.ts:52-64` | wrap in `canon_fn()` |
| 11 | Skill-expiry alerts 0% firing (`expires_at` never derived) | `employee_skills` (0/709 rows) | derive from `skills.expiry_months` at assign + backfill |
| 12 | User account lifecycle unaudited (violates CLAUDE.md §31) | `users.service.ts` | add `audit_logs` writes (~1hr, reuse `auth.service.ts:26-58`) |
| 13 | Hardcoded recon paths (session-UUID `63e84c5a`, `Desktop/new roster/`) | `recon-new-roster.js:26-27` | parameterize via env |
| 14 | Weekly-quota `toISOString()` +03 off-by-one | `permission-request.service.ts` | use `ymdLocal` helper |
| 15 | Scorecard analyze/trends run on 1 month (13-month history in separate table) | `scorecard_entries` vs `scorecard_monthly` | repoint to `scorecard_monthly` |

### 3.4 Dead / removable (retire during Phase 1 cleanup)

- **Recon scripts:** `recon-extract-foundation.js` (v1), `roster-reconcile-june.js`,
  `recon-profile-sources/diff-evidence/compare-manual.js`, one of the two demand generators.
- **Source files:** the `_2830` slice files in `new roster/` (after the full rebuild).
- **Backend scratch:** ~80 `backend/_*.js`, `run_migration.js` (hardcodes DB creds → move to `scratch/` or delete).
- **Orphaned endpoints:** `/v1/rta/live` (0 consumers), Sprinklr REST poller (unverified), Ameyo live bridge — decide wire-or-retire.
- **Frontend:** `pages/Placeholder.tsx`, `ds.tsx` (after migrating importers to `dazzle.tsx`), duplicate `useCountUp`.

---

## 4. DEFINITION OF DONE — apply to EVERY page / endpoint / module

Nothing is "done" until **all** of the following are demonstrated. No exceptions for "it's a one-liner."

**Correctness & algorithms**
- [ ] Verified against the confirmed rule (`WFM_RULES_AND_DECISIONS.md`; rule wins on conflict). For any
      OT/tardiness/presence/HR value, a **golden-master test** asserts exact outputs (`ot_min`,
      `offday_ot_min`, `holiday_ot_min`, `sys_late_min`, `sys_early_min`, presence, HR flags) over a
      frozen fixture and fails if any paid number changes.
- [ ] Every threshold (`HR_MIN`/`TARDY_CEIL`/`OT_CEIL`/`MATERNITY_7H`) and business-ID list is imported
      from **exactly one** shared source — `grep` proves each is declared once.

**Security — RBAC + tenant scoping**
- [ ] Route carries an explicit least-privilege `@RequirePermissions` (or `@Public`) — **not** reachable
      via allow-by-default.
- [ ] Every query scoped by `tenant_id`. Any endpoint taking an `employeeId`/`:id` self-scopes for
      non-team callers; only `view_team`/`view_all` may pass an arbitrary id. IDOR probe returns 403, not data.
- [ ] Write body validated by a class-validator DTO (no `@Body() body: any`).

**Transactions on multi-writes**
- [ ] Any handler writing >1 row/table runs in a **real** `QueryRunner` transaction
      (BEGIN/COMMIT/ROLLBACK on one connection). A partial-failure test proves rollback leaves no half-state.

**Performance & scale (data grows to 100k+ `roster_days` rows)**
- [ ] Interactive lists cap `limit ≤ 200`; exports are a **separate streamed** path (CSV/XLSX via
      `StreamableFile`), never a bulk JSON dump.
- [ ] Every filter/sort/search column is indexed (functional index for `canon_fn(role_function)`,
      trigram for name search). `EXPLAIN ANALYZE` on the hot query shows **Index Scan, not Seq Scan** —
      capture it in the PR.
- [ ] Query plan validated at 100k+ rows (seed/synthesize); p95 does not regress vs the 18k baseline.
      Heavy grids (`hourly`, `week-forecast`) are cached (60–180s TTL) or served from a materialized rollup.

**Concurrency (100+ users on the SAME page)**
- [ ] Load-test the hot endpoints — `roster-v2/hourly`, `week-forecast`, `roster-v2`, `roster-dashboard`,
      RTA coverage — with **k6 or autocannon at 100–150 concurrent VUs for 60s** against the exact request
      the page fires. Pass bar: **p95 < 1s, zero pool-exhaustion errors, error rate < 0.1%.** Attach the run.

**Readable + typed + no god-files**
- [ ] No touched file > ~600 lines. No `any` on any OT/tardiness/payroll value (type each SQL row via an
      interface). `npm run lint` + `npm run typecheck` + `npm test` pass for backend **and** frontend.

**Audit-logged mutations**
- [ ] Every state-changing action writes an `audit_logs` row (actor, action, entity, old→new, timestamp).

**Works in production**
- [ ] `npm run build` passes (backend + frontend). Per-role smoke test (agent / TL / RTA / WFM / admin):
      page loads, key figures render, a forbidden action returns 403 for a lower role. Rate limiting works
      behind proxy (`trust proxy` set, per-user keying, Redis-backed) so 100 users behind one egress IP
      aren't collectively throttled.

**The reviewer gate (acceptance test):** a page is NOT done until a reviewer can change a business rule in
**one** place and the test suite proves it held everywhere.

---

## 5. PRODUCTION-READINESS RISK REGISTER (17, ranked — all confirmed against real code)

**P0 — ships broken/exploitable (Phase 1, first commits):**
1. **RBAC allow-by-default** — `PermissionsGuard` returns `true` for any route with no
   `@RequirePermissions` → ~228/448 handlers reachable by any authenticated user (campaigns CRUD, Ameyo
   push, reporter, diagnostics). `common/guards/permissions.guard.ts:22`. → Deny-by-default; tag all 228
   handlers with least-privilege codes first, then flip the guard.
2. **Chat member-management IDOR** — add/remove/patch members + read messages with no membership/admin
   check; any agent joins any channel and self-grants `is_admin`. `chat/chat.controller.ts:115-137`,
   `chat.service.ts:156-183`. → membership for reads, `is_admin` for member mutations, `tenant_id` scoping.
3. **Destructive recon writes gated by a READ permission, unaudited** — `upload` (full rebuild), `ingest`,
   `schedule-change`, `schedule-swap`, `revert` all require only `attendance.view_team`; whole controller
   writes **one** audit row. `recon.controller.ts:3841,3951,3611,3650,3705,1999`. → retag to write/publish
   codes + `audit_logs` INSERT on every mutation.

**P1 — degrades under load / at scale (Phase 4 hardening, but indexes are cheap — do early):**
4. `roster-v2/hourly` rebuilds a 7-metric × 24-hour grid **per request, no cache** (`recon.controller.ts:693-797`).
5. Function filter `canon_fn(role_function)=…` has **no functional index** → full-scan on the most common
   filter (`recon.controller.ts:88,176,645`). → `CREATE INDEX idx_roster_canon_fn ON roster_days(tenant_id, canon_fn(role_function), work_date)`.
6. **Zero caching** for any roster analytics (`cache-manager` not installed) → 100 users = same heavy query 100×.
7. DB pool `max: 20` (`app.module.ts:103`) → 100+ users exhaust it, requests block then error.
8. `week-forecast` runs the `generate_series` cascade + plan CTE + 2 correlated `NOT EXISTS` per row×hour, uncached.
9. **Two reconciliation engines with divergent thresholds; the tested one does NOT ship.** Pure
   `recon.engine.ts` (has specs) vs shipping `recon-build.js`/`recon-new-roster.js` (zero tests). A dev
   fixing a rule in the tested engine changes no paid number. → make one the source; golden-master test.

**P2 — maintainability debt that guarantees future regressions (Phase 1/4):**
10. IDOR in `requests` (`peer-pending`/`swap-candidates` take unscoped `employeeId`).
11. Export pulls up to **50,000 rows** as one JSON payload, no virtualization (`Roster.tsx:294-297`).
12. `headcount_intervals` built + indexed but never populated (`migrations/035:19-21`).
13. Name search uses POSIX regex (`~`) → can't use b-tree, full-scans on every keystroke.
14. 12 write endpoints use `@Body() body: any` → bypass validation.
15. Rate limiting broken behind proxy (per-IP + in-memory, no `trust proxy`).
16. **God-files + no lint/type gate** — `recon.controller.ts` 4093 lines/226 `any`; `RTA.tsx` 3847;
    `noImplicitAny:false`; **frontend has 0 tests**.
17. Triplicated shift-timing dictionary + hardcoded maternity IDs across 4+ files → read/write sides diverge.

---

## 6. PHASED ROADMAP TO PRODUCTION

Execute in order. **Stop at each exit gate and report.** Each item: Confirmed-vs-Recommended, show the diff,
run the smoke/regression test, update the book + memory.

### Phase 0 — Stabilize the June roster *(✅ EXECUTED 2026-07-06 for Jun 1–27 — commit `efeb436`)*
June 1–27 rebuilt through the clamped engine using the Director's to-27 long-form sheet: the engine now
(a) **supplements embedded evidence** (punches/system/permissions from the 'Final' sheet, never overriding
dedicated files; `login_src='Workbook (recorded)'`), (b) **carries per-day WFH location evidence forward**
from live roster_days (`recon-export-wfh-evidence.js`, refresh step 1.5 — re-exports flattened Location
to 'Office'), (c) horizon counts punch **or** system evidence. Dry-run+diff → promote: 0 rows lost,
+5 missing persons, TRUE_OT 1–26 corrected 1,499h→890h (pre-clamp bleed removed), spine resynced,
**golden gate WIDENED to `work_date >= '2026-06-01'` and PASSES**.
**Remaining tail:** Jun 27–30 raw evidence exports when the Director provides them ("لبعدين") +
the slice-overwrite guard (date-stamped filenames).

### Phase 1 — Books + one-spine + P0 security + cleanup *(highest structural ROI)*
- **Books:** create 📙 `TECHNICAL_ARCHITECTURE.md` + 📒 `API_SPECIFICATIONS.md`; extend 📓 `DATA_DICTIONARY.md` (§8).
- **One spine:** extract `TRUE_OT`/`CRED_LATE`/`CRED_EARLY`/`MATERNITY_7H` from `recon.controller.ts:42-46`
  into one shared module; retarget scorecard/RTA/coverage/dashboard; **add the `attendance_records` resync
  step** to recon-refresh (preserve future generated weeks marked `'[generated'`).
- **P0 security (risks 1–3):** deny-by-default RBAC (+tag 228 handlers), chat IDOR fix, retag destructive
  recon writes + audit every mutation.
- **Correctness:** editCell one-line guard (risk 4); approve idempotency (risk 7); `canon_fn()` in
  permission HC-impact + RTA (risk 10); requests IDOR self-scope (risk 10b).
- **Consolidate/cleanup:** ~~3 generators → 1~~ **RESOLVED-AS-ANALYZED 2026-07-06** — mapped all three:
  the RULE layer is already ONE (demand engine imports `calcRestHours`/`allowedShiftCodes`/female policy
  from the classic engine + `generator.types.ts`; the ladder is structurally female-safe — females can
  only reach the morning band). The residual divergence is OFF-placement + fairness-scoring STRATEGY
  (classic = YTD/weekend-fair, demand = lowest-demand-day + 35% cap), both Director-tested products;
  merging them CHANGES scheduling outputs → **APPROVED by the Director 2026-07-08 ("موافق كمل")** —
  execute the behavioral merge (demand-driven engine becomes THE generator; classic's weekend-fair
  OFF structure + rotation-band fairness grafted in as options).
  rotation hour-buckets → `common/shift-category` ✅ done (commit 8b0d89a); parameterize
  recon paths via env; retire dead code (§3.4); user-lifecycle `audit_logs` (risk 12); guard demo-seed;
  replace `@Body() body: any` with DTOs (risk 14); `trust proxy` + user-keyed Redis throttler (risk 15).
- **Cheap scale wins:** add the `canon_fn` + covering indexes + `pg_trgm` name-search index (risks 5,13);
  split interactive vs export limits (risk 11).
**Exit:** all 6 books under `docs/master/`; a sampled person-day shows **identical** OT/late across
dashboard/RTA/scorecard/roster (one-definition proof); recon-refresh succeeds on a fresh temp dir; RBAC
deny-by-default holds (IDOR probes 403); editCell + double-approve regression tests pass; `EXPLAIN` shows
Index Scan on the function-filtered hot queries.

### Phase 2 — Odoo direct integration
One verified live test run (confirm `hr.employee` field mapping + `hr.leave` dates); scheduled sync loop;
fix leave-day UTC off-by-one (`odoo.service.ts:215`); reconcile Odoo leaves into the recon pipeline (→
`roster_days`, not a parallel `attendance_records` write). Read-only first, **diff `db` vs `xlsx` before
cutover** (`RECON_ODOO_SOURCE=db|xlsx`). See §9.
**Exit:** scheduled sync runs unattended, verified vs the Odoo UI for a sample; leave dates correct at the
UTC boundary; Odoo leaves appear in `roster_days`.

### Phase 3 — AI workforce waves (15 → 35) — the Director's Enterprise AI Department mandate
The 35-agent ecosystem (spec: `docs/master/AI_WORKFORCE_ARCHITECTURE.md` — per-agent contract §1, the
35-agent map §2, shared Enterprise KB + `agent_events` bus §3, collaboration DAG §4). Every agent:
explainable + audit-logged (no black boxes), human-in-the-loop for regulated/pay actions.

- **W0 — Activate the substrate** *(✅ scaffold LANDED 2026-07-06; key pending)*: default `LLM_MODEL`
  fixed (`llm.service.ts` — the old `claude-sonnet-4-6` was a non-existent id that 400'd silently;
  now `claude-sonnet-5`); **migration 073 `agent_events`** (append-only pub/sub backbone, indexed by
  stream/agent/subject); **`@common/agent-runner.ts`** — publishEvent (evidence payload = the
  explainability record) / consumeEvents (cross-agent, self-excluding) / runExclusive (Postgres
  advisory-lock distributed lock — verified: 2-session test, instance B skips while A holds).
  REMAINING in W0: set `ANTHROPIC_API_KEY` → verify Advisor/Expert/Chief `llm:true`.
- **W1 — Expose the 13 EXISTS agents** through the runner (rename/surface per §7) + merge Advisor+Expert
  into the WFM Copilot.
- **W2 — Extend the 16 PARTIALs** (Live Coverage Guardian, RTA Assistant, Approval Advisor, SLA Risk
  Predictor, Root Cause, Quality Coach, Productivity, Data-Quality Auditor, Integration Manager…);
  adaptive baseline stores; one assessment/tenant/TTL cache; Auto-Mode arming behind `automation.manage`.
- **W3 — Data pipelines the agents need**: forecast AHT unlock, Odoo staging→recon, generator consolidation.
- **W4 — Build the 6 NEW agents** (Contact-Reason Analyzer, Workforce Simulator, Documentation Writer,
  Cost Optimizer, Training Planner extensions, Testing Engineer LAST).
**Exit:** Advisor/Expert/Chief return `llm:true`; `AgentRunner` powers all guards (specs pass); no duplicate
notifications under a 2-instance test (advisory lock — already proven at the scaffold level); Auto-Mode
write paths reject a `hc.view`-only token; each shipped agent's §1 contract documented in
AI_WORKFORCE_ARCHITECTURE.md §2.

### Phase 4 — Harden / scale / test *(the "100% production, 100+ users, no slowdown" gate)*
- **Concurrency/scale (risks 4–8):** install `@nestjs/cache-manager` on the existing Redis (60–180s TTL,
  invalidate on recon-refresh/upload/publish/editCell); collapse the 5–6 sequential grid passes into one
  CTE or `Promise.all`; **then** raise the pool to 40–60 (env-configurable) + PgBouncer; load-test to the
  DoD bar.
- **Engine safety (risk 9):** unify on one recon engine; add the recon-build golden-master smoke test
  (holiday/cross-midnight/WFH/absence-suffix fixture asserting ceilings/net-caps/hr_code) + wire
  `recon-accuracy-check` to the recon-refresh tail.
- **Activate inert modules:** populate-or-retire `headcount_intervals` (risk 12); unlock forecast staffing
  (ingest AHT + fallback) + fix lean/withOT; derive skill `expires_at` + backfill 709 rows; repoint
  scorecard analyze → `scorecard_monthly`.
- **Maintainability (risks 16,17):** ESLint + typecheck + test CI gates; split god-files
  (`recon.controller.ts` → concern-scoped controllers; triage `RTA.tsx`); one canonical shift-timing table
  + one config for business IDs; Vitest baseline for the top-10 pages.
- **Prod hardening:** Docker/nginx/TLS/backups/monitoring; cross-spine drift check in health-guard (daily).
**Exit:** load test green (p95 < 1s at 150 VUs, 0 pool errors); recon smoke test gates recon-refresh in CI;
`headcount_intervals` non-empty (or dependency removed); forecast `requiredHc` non-null for all active
functions; multi-instance deploy passes with no duplicate loops; per-role smoke green.

---

## 7. THE 35 AI AGENTS (13 EXISTS · 16 PARTIAL · 6 NEW)

Only **6 are genuinely new** — the rest is an assembly job on the existing `roster_days`/guard/
`knowledge-ledger` spine. Do NOT build from scratch.

| Agent | Status→Maps | Agent | Status→Maps |
|---|---|---|---|
| WFM Copilot | PARTIAL → advisor+expert merge | Order-Volume Analyzer | PARTIAL → CPO forecast |
| Roster Planner | EXISTS → recon-* | Workforce Simulator | **NEW** → capacity+generator |
| Schedule Optimizer | EXISTS → schedule-generator | Black-Friday Planner | PARTIAL → campaigns+capacity |
| Forecast Engine | PARTIAL → forecasting (AHT dead) | Ramadan Planner | PARTIAL → recon+generator |
| Capacity Planner | EXISTS → capacity (Erlang) | Notification Manager | EXISTS → notifications |
| Live Coverage Guardian | PARTIAL → coverage+week-forecast | Report Generator | EXISTS → reporter |
| RTA Assistant | PARTIAL → rta+sprinklr | Executive Advisor | EXISTS → chief |
| Attendance Analyzer | EXISTS → attendance-recon | Dashboard Builder | EXISTS → builders+command-center |
| Overtime Analyzer | EXISTS → ot-exceptions | Data-Quality Auditor | PARTIAL → health-guard+recon DQ |
| Shrinkage Analyzer | EXISTS → workforce-analytics | Integration Manager | PARTIAL → integrations |
| Request Manager | EXISTS → requests | Chrome-Ext Manager | PARTIAL → extension bridge |
| Approval Advisor | PARTIAL → automode+analyst | Knowledge Manager | EXISTS → knowledge-ledger |
| SLA Risk Predictor | PARTIAL → sla-escalation+analyst | Documentation Writer | **NEW** → docs-sync over ledger |
| Scorecard Coach | EXISTS → scorecard-guard | Testing Engineer | **NEW** → recon-build tests |
| Quality Coach | PARTIAL → coaching+scorecard-guard | Security Auditor | EXISTS → security-guard |
| Productivity Analyzer | PARTIAL → productivity | Cost Optimizer | **NEW** → OT+shrinkage+gap |
| Root Cause Analyzer | PARTIAL → diagnostics+analyst | Training Planner | PARTIAL → skills |
| Contact-Reason Analyzer | **NEW** → ops_contacts | | |

**Shared memory (reuse):** curated knowledge = `knowledge-ledger`; learned state =
`analyst_thresholds`/`analyst_recommendations`/`automode_decisions`; event bus =
`coaching_flags`/`report_runs`/`notifications`/`audit_logs`; facts =
`roster_days`/`scorecard_monthly`/`ops_contacts`/`integration_snapshots`. **One required upgrade:** an
append-only `agent_events` table (`agent, event_type, subject_ref, payload, severity`) as the pub/sub
backbone for scaling 15→35. **Every agent decision must be explainable and audit-logged — no black boxes.**

---

## 8. THE 6 BOOKS (repo-as-memory)

| Book | File | Status |
|---|---|---|
| 📘 Project Bible | `docs/master/MASTER_PROJECT_MEMORY.md` | ✅ exists |
| 📗 Business Rules | `docs/master/WFM_BUSINESS_RULES_LIBRARY.md` | ✅ exists (BR-IDs) |
| 📕 Decision Log | `docs/master/DECISIONS_AND_AGREEMENTS_LOG.md` | ✅ exists (to D-076) |
| 📓 Data Dictionary | `docs/master/DATA_DICTIONARY.md` | ✅ exists — **add** the 3-table spine + canonical metric defs |
| 📙 Technical Architecture | `docs/master/TECHNICAL_ARCHITECTURE.md` | ⚠️ **CREATE** (Phase 1) |
| 📒 API Specifications | `docs/master/API_SPECIFICATIONS.md` | ⚠️ **CREATE** (Phase 1) |

**📙 Technical Architecture** must document (with `file:line`): the two employee-day spines & why they
diverge; the recon pipeline + path fragility; the dual-write contract & the missing guard; the AI scaffold
+ shared stores; the auth/RBAC chain + SQL-migrations-are-truth. **📒 API Specifications** — generate from
live Swagger, group by subsystem, add a **"reads which spine"** column (makes divergence auditable) + flag
orphaned endpoints. **Rule:** `WFM_RULES_AND_DECISIONS.md` stays the single source of truth; on conflict it wins.

---

## 9. ODOO DIRECT INTEGRATION (replace the manual .xlsx exports)

**Transport already works** — `odoo.service.ts` has `authenticate()` (`:56`), generic `call()`/`execute_kw`
(`:74`), `testConnection()` (`:240`), config persistence (`:256`); `xmlrpc ^1.3.2` installed. It reads only
`hr.employee`, `hr.leave.allocation`, `hr.leave`. The 4 Studio "Supervisor-Requests" models (OT / Comp /
Permissions / Sick — the live screens: Sick 2,806 · Extra Hours 899 · Comp Off 1,550 · Permissions 9,109)
are unreachable → those are today's manual exports.

**Design (feed the existing recon seam; change neither engine nor requests schema):**
1. **Discover** model/field names via `ir.model` + `ir.model.fields` (Studio `x_*` models — map by
   discovered name, **never by position** → avoids the L-009 column-shift bug class). Persist a field-map
   in `tenant_settings`.
2. **Stage** to a new `odoo_staging` table (`UNIQUE(tenant,model,odoo_id)` = idempotent upsert) +
   `odoo_sync_state` watermark (incremental by `write_date`).
3. **Materialize** into (a) the engine's `odoo{}`/`perms{}` `id|date` maps — **byte-identical shape so
   `recon-build.js` is unchanged**, toggled by `RECON_ODOO_SOURCE=db|xlsx` for a side-by-side diff; and (b)
   `requests`/`request_permissions` (replaces the 3 `import-odoo-*.js` importers; can also flow *pending* rows).
4. OT (`x_extra_hours`) = a **validation feed beside** engine-derived TRUE_OT, not authoritative (preserves
   the agreed OT rules).
5. Convert Odoo UTC → Asia/Kuwait **before** taking `event_date` (cross-midnight attribution).

---

## 10. BEST-PRACTICE ADOPTIONS (from NICE / Verint / Calabrio / Genesys — where we're behind)

Where we're **already ahead** (extend, don't rebuild): order-driven forecasting · the guard-team/Chief
agentic layer · gap-remedy recommendations on the coverage heatmap · correct adherence-vs-conformance.

Highest-leverage upgrades (all have the data in-house):
1. **Interval concurrency lookup table (2.0–4.0)** replacing the fixed chat concurrency = 4 — real
   concurrency compresses at peak, expands when quiet; build a 15-min table from Sprinklr history.
2. **Constraint-optimization scheduler (OR-Tools CP-SAT, free, Node-callable)** to structurally kill the
   "frozen shift"/fairness bug class (hard constraints: rest≥10h, female-midnight, coverage; soft: fairness,
   shift-rate, preference) instead of patching each.
3. **Hierarchical forecast reconciliation (total→channel→queue) + confidence intervals** over the order engine.
4. **Predictive pre-breach RTA alerts + saved adjustment-plan playbooks** under Auto Mode.
5. **Erlang A (abandonment) + blended-AHT uplift (+20–40%) + channel-specific shrinkage** (voice 28–35%,
   chat 18–24%, async 12–18%) instead of one shrinkage number.
6. **Complete the canonical KPI set:** add SL / ASA / Occupancy / Abandonment from the Ameyo interval feed.
7. **Open shift-trade marketplace + agentic low-risk time-off auto-approval + mobile PWA.**
8. **Forecast copilot + a standing anomaly-detection guard + NL query over `roster_days`/scorecard.**

---

## 11. INPUTS REQUIRED FROM THE DIRECTOR (these block specific phases)

- **Phase 0:** the **complete full-month June source files** — the full June 1–30 schedule (Final sheet) +
  full-month Ameyo + Sprinklr login/logout (the on-disk copies were overwritten by the 28–30 slice).
- **Phase 2 (Odoo):** (1) Odoo base URL + on-prem/Online; (2) database name; (3) an integration
  service-account email + **API key** with read access to Attendance / Time Off / the 4 Supervisor apps;
  (4) confirm XML-RPC `/xmlrpc/2/*` is reachable (firewall/IP allow-list); (5) either let the executor run
  `ir.model` discovery or the 4 technical model names; (6) which `hr.employee` field carries our
  `employee_no` (`barcode`/`identification_id`/`registration_number`?); (7) confirm timezone Asia/Kuwait;
  (8) decision: is `x_extra_hours` authoritative OT or a validation feed (**recommend validation**).
- **Phase 3 (AI):** an `ANTHROPIC_API_KEY` (and confirm the model id fix lands before the key is set).
- **Working files:** point the executor at any additional working folders the Director wants ingested.

---

## 12. LEAD'S NOTES & RECOMMENDATIONS (Opus 4.8, ranked)

1. **Fix June first, then freeze the slice-overwrite footgun.** Until Phase 0 passes, *every* OT/tardiness
   report is untrustworthy. Non-negotiable.
2. **Collapse to one metric spine** (extract the consts + resync `attendance_records`). One change kills the
   #1 bug class — same KPI, different number per page — and makes every corrected number propagate.
3. **Ship the one-line `editCell` guard now.** Trivial; stops silent corruption of already-worked rows.
4. **Turn on the AI layer** (key + fix the fake `claude-sonnet-4-6` default). Highest ROI/effort in the
   program — ~40% of the "AI" surface activates with near-zero code. **Fix the model id before the key** or
   it 400s silently.
5. **Unify the two permission systems + add approve idempotency** (double-approve can double-stamp roster_days).
6. **Unlock forecast staffing** by ingesting AHT — the Erlang code is textbook-correct but starved of input.
7. **Odoo read-only first, diff before cutover.** Transport is done; lowest-risk path to the biggest gap.
8. **Write tests for `recon-build.js` before scaling anything on it.** 536 lines of pay-affecting rules,
   zero coverage, is the single biggest structural risk.
9. **Extract the `AgentRunner` scaffold + `agent_events` bus before adding agents.** Don't scale 15→35 by
   copy-paste; one base class + one event table + a distributed lock makes "shared learning" real.
10. **Close compliance + hygiene cheaply:** audit user-account lifecycle (~1hr), guard the demo-seed against
    prod, prune ~80 root scratch scripts and `run_migration.js` (plaintext DB creds).

**The one creative bet worth making:** the constraint-optimization scheduler (§10.2). Everything else is
disciplined evolution; that one is the leap that turns the generator from "rule-based and occasionally
unfair" into "provably optimal under the agreed constraints" — and it retires a whole class of bugs.

---

---

## 14. ODOO BROWSER BRIDGE — API-free (built 2026-07-06; finish the wiring)

The Odoo/Anthropic **APIs are deferred** (no credentials until the system is proven to management), so we
built the **browser** path to Odoo — an extension that rides the supervisor's own Odoo web session (like the
Sprinklr/Ameyo bridges) and needs **no API key**. Do NOT rebuild it; finish the wiring. Memory:
`odoo_browser_bridge.md`.

**Already built + verified on live data (commits d344366 / 7965ebf / ebd2df9):**
- `chrome-extension-odoo/` — intercepts Odoo's own data calls (`/web/dataset/*`), pushes records to
  `POST /integrations/odoo/push` → **migration 069 `odoo_staging`** (idempotent by tenant/model/odoo_id).
  Bridge login `bridge@boutiqaat.wfm` / `Demo@2026`. Verified: **1,053 real records across 8 Studio models**
  (hr.sick.leave · attendance.permissions[late/early] · attendance.extra.hours[OT] · comp.off ·
  comp.off.total.balance · leave.request[Annual/Unpaid] · attendance.official.tasks · hr.back.vacation
  [resignation/transfer/termination]).
- Generic mapper `mapOdooRequest` + `GET /integrations/odoo/requests?model=&status=` — person_no extracted
  from the `[ 13311 ]` employee label; normalized status (confirm/first/second→pending · approve/validate/
  done→approved · refuse/portal_refuse→refused); fields date/days/hours/type/leaveType/employeeStatus.
- **migration 070 `attendance_excuses`** + `POST /integrations/odoo/reconcile?from=&to=&apply=` (rta.override,
  dry-run default): APPROVED request → excuse; VALIDATED technical_issue → excuse kind=`technical`;
  PENDING → standing alert; REFUSED → "fix hours & resubmit" alert; missing punch/system + no request →
  "submit a justification" alert. Idempotent. Verified: 643 excuses + 1,047 alerts classified.

**Reality:** the `users` table has only ~8 accounts (admin/RTA/bridge), **0 employee-linked** → agents have
no WFM login, so in-app **agent** notification delivery is future-gated; `reconcile` returns the `alerts[]`
list for RTA/WFM to act on now.

**Remaining Odoo steps (do these; Director-agreed rules):**
1. **Roster HONORS excuses — the core effect.** Make the recon engine read `attendance_excuses` and treat an
   excused late/early/absence exactly like the existing covered permission (`coversLate`/`coversEarly` in
   `recon-build.js`): **exclude it from conformance + penalty**, keep `worked`/presence honest, and LABEL the
   reason on the row (e.g. `data_quality`/a note: "late — validated technical issue"). Rules-in-engine so
   every rebuild re-applies. Dry-run + diff (payroll-critical). *(Alt if a rebuild isn't available: a
   read-time LEFT JOIN overlay on the `roster-v2` conformance reads — but the engine path is canonical.)*
2. **Approved sick/leave → `roster_days` presence** (sick/leave/H) via the engine, replacing the manual
   Permission&Compo/Sick `.xlsx` inputs with `odoo_staging`.
3. **Replace the manual Odoo exports:** point the recon `perms{}`/`odoo{}` inputs at `odoo_staging`
   (`RECON_ODOO_SOURCE=db|xlsx`, diff before cutover) so the whole Supervisor-Requests suite flows live.
4. **UI:** an `/odoo-requests` page (filter by model/status/employee + Excel export) + an `/alerts` surface
   (refused/pending/missing-submit per agent) reusing the dazzle kit.
5. **Scheduled reconcile** (reuse the guard `setInterval` pattern; a sensible recent window — the full-range
   apply would emit ~800 missing-evidence alerts).
6. **Agent accounts** (future) so agents receive their own alerts; until then deliver the alert list to RTA/WFM.
7. `hr.back.vacation` (resignation/transfer/termination) → feed **attrition**, not an excuse.

All Odoo work still obeys §1 operating rules + §4 Definition of Done (RBAC, tenant scope, DTOs, real
transactions, indexes, audit-logged mutations, tests).

---

*End of brief. Execute Phase 0 → 4 in order, honoring §1, §4, and the token discipline in §0. Report at
every exit gate. Update the 6 books + memory as you go. Do not rewrite; evolve.*
