# 📙 TECHNICAL ARCHITECTURE — Boutiqaat WFM Platform

> **Created: 2026-07-06** (Phase 1, EXECUTION_BRIEF §8). AS-BUILT truth with `file:line` anchors.
> Companion books: 📘 `MASTER_PROJECT_MEMORY.md` · 📗 `WFM_BUSINESS_RULES_LIBRARY.md` ·
> 📕 `DECISIONS_AND_AGREEMENTS_LOG.md` · 📓 `DATA_DICTIONARY.md` · 📒 `API_SPECIFICATIONS.md`.
> The rules doc `docs/knowledge/WFM_RULES_AND_DECISIONS.md` wins on any conflict.

## 1. Topology

| Layer | Stack | Where | Runtime |
|---|---|---|---|
| Backend | NestJS + TypeScript + TypeORM (`synchronize:false`) | `backend/src` (~60 modules, 452 routes / 59 subsystems) | compiled `dist` — `npm run build` → `node dist/main.js` on :3000; **restart required** after changes |
| Recon engine | standalone Node scripts (NOT Nest) | `backend/scripts/recon-*.js` | `node scripts/recon-refresh.js` (4 steps, §4) |
| Frontend | React + TS + Vite, 3 themes, RTL/i18n | `frontend/src` (~88 pages → 17 nav + 16 hubs) | Vite dev :5173, proxies `/api`→:3000 |
| DB | PostgreSQL `wfm_db` (live data, ~125 tables) | creds in repo-ROOT `.env` (`POSTGRES_*`; app.module `envFilePath:['.env','../.env']`) | migrations: `node scripts/migrate.js` (SQL files in `database/migrations`, next = 072) |
| Bridges | Chrome extensions (browser-session capture, no API keys) | `chrome-extension/` (Sprinklr) · `chrome-extension-ameyo/` · `chrome-extension-odoo/` | push to `/integrations/*/push` as `bridge@boutiqaat.wfm` (role rta) |

**SQL-migrations-are-truth:** the schema is owned by numbered SQL files; TypeORM entities mirror it
(`synchronize:false`). Never edit schema outside a numbered migration.

## 2. The three employee-day spines (the #1 architectural fact)

| Table | Nature | Written by | Read by |
|---|---|---|---|
| **`roster_days`** | RICH canonical (74 cols: person_no, OT buckets, tardiness, presence, hr_code, DQ) | the recon engine (§4) + guarded dual-writes | every `roster-v2/*` report, requests HC-impact, analytics |
| **`attendance_records`** | RAW/published schedule (marker, scheduled times, ot_minutes) | schedule publish/editCell + **recon-refresh step 4 resync** | ~31 readers: dashboard, RTA, scorecard, coverage |
| **`roster_daily`** | THIN legacy (`payload jsonb`) | legacy `/upload`+`/ingest` | legacy `/dashboard` path only |

**Why they diverged (fixed 2026-07-06):** recon-refresh corrected `roster_days` but never resynced
`attendance_records`, so the same person-day showed different OT/late per page (live sample: person
6297 2026-06-10 → TRUE_OT 300 vs 0; 13,017/16,855 matched rows diverged). **Fix:**
`scripts/recon-sync-attendance.js` = pipeline step 4/4 (`recon-refresh.js`) projects
roster_days → attendance_records for the ingested range (marker/times/TRUE_OT/late/early/wfh/missing),
preserving generated future weeks (`notes LIKE '[generated %'`). One-time catch-up synced 16,855 rows;
exit proof: sampled person-days identical on both spines. **Never cross-wire `roster_daily`** (BR-ING-002).

**Canonical metric definitions** live in ONE module — `backend/src/common/wfm-metrics.ts`
(`TRUE_OT`, `CRED_LATE`, `CRED_EARLY`, `MATERNITY_7H`); consumers import, never redefine
(recon.controller imports at `recon.controller.ts:15`; the rd-aliased inline in
`schedule.service.ts:239` is annotated canonical-by-reference).

## 3. Dual-write contract (schedule ⇄ roster)

- Schedule grid edit (`schedule.service.ts` editCell ~:800) writes `attendance_records` AND
  dual-writes `roster_days` — but **NEVER a row carrying real evidence**: the UPDATE carries
  `AND punch_in_min IS NULL AND sys_login_min IS NULL` (worked-day guard, 2026-07-06). Deliberate
  worked-day overrides go through the Roster `schedule-change` endpoint, which `staleMetricReset()`s
  the window-derived metrics.
- Publish/approve also SKIP worked days; generated weeks are tagged `notes='[generated <weekStart>]'`
  (`recon.controller.ts:~2018`) and are preserved by the resync.
- Requests approval applies to the schedule via an **atomic first-wins claim** (conditional UPDATE →
  apply → release-on-failure, `requests.service.ts` approve) — double-approve cannot double-stamp.

## 4. The recon pipeline (rules live IN the engine)

`node scripts/recon-refresh.js` orchestrates:
1. `recon-extract-foundation-v2.js` — foundation from the Director's final "Shifts." sheet
   (exact scheduled times) → `foundation.json`.
2. `recon-new-roster.js` — source loading (Odoo xlsx / Permission&Compo / Ameyo / Sprinklr; columns
   **by header name, never position** — L-009) + `classifyCode` + `pickWindow` (bleed detection, OT window).
3. `recon-build.js` — the per-person-day rule engine (WFH Option-A, permission coverage, holiday-OT
   whole-shift-capped-at-net, OT clamps `otNetCap`/`OT_CEIL=300`/`otEligible`, cross-midnight
   `TARDY_CEIL=240`, hr_code matrix) → `ingest.json` → `recon-ingest.js` (range-scoped replace,
   `roster_days_recon_bak` = undo).
4. `recon-sync-attendance.js` — resync the raw spine (§2).

**Fragility (open):** `recon-new-roster.js:26-27` hardcodes `SCRATCH` (a session-UUID temp path) and
`SRCDIR='Desktop/new roster/'` — parameterize via env (Phase 1 cleanup). Two engines exist: the tested
`recon.engine.ts` (specs) is NOT the shipping one (`recon-build.js`, no tests) — unification + a
golden-master test is Phase 4 (risk #9). **Dry-run + diff before any rebuild** (`ROSTER_OUT_TABLE`
scratch convention); a partial upload may only replace its own date range (BR-ING-001).

## 5. Auth / RBAC chain

- Global guards (`app.module.ts:182-184`): `ThrottlerGuard` → `JwtAuthGuard` (honors `@Public`,
  `is_public` metadata) → `PermissionsGuard`.
- **Deny-by-default (2026-07-06, `permissions.guard.ts`):** `@Public` passes; an authenticated route
  with `@AuthOnly` passes (auth self-service + reference lookups); a route with NO declared
  permissions is **REJECTED**. All 452 routes are explicitly tagged (coverage scanner:
  `scripts/_scan_rbac.cjs`).
- Permissions: 74 codes (`permissions` table; migration 071 added `chat.view`/`chat.manage` +
  agent `tech_issues.view`). Roles: platform_admin 73 · wfm_analyst · team_leader · rta ·
  hr_specialist · agent (own-data codes). JWT: 15-min access + rotating refresh
  (`auth.service.ts`; lockout after 5 failures); MFA (TOTP) available.
- Service-level authorization beyond RBAC: chat member ops authorize the CALLER
  (`chat.service.ts assertChannelAccess` — membership for reads, channel-admin for member
  mutations, `chat.manage` bypass); requests self-scope via `scopeEmployeeId`
  (`requests.controller.ts:56`).

## 6. Integrations (browser-bridge pattern — no external API keys)

| Bridge | Extension | Ingest | Store | Brain |
|---|---|---|---|---|
| Sprinklr (omnichannel, PRIMARY) | `chrome-extension/` v1.5+ (Doctor, auto-login) | `POST /integrations/sprinklr/push` | `integration_snapshots` + `agent_daily_stats` + `agent_status_events` | `sprinklr.service.ts` (status engine, rollups, adherence, violations) |
| Ameyo (telephony — **de-prioritized**, moved to Sprinklr) | `chrome-extension-ameyo/` v0.3.0 | `POST /integrations/ameyo/push` | `integration_snapshots` | `ameyo.service.ts` (state normalizer + employee link) |
| Odoo (HR — API-free path) | `chrome-extension-odoo/` v0.1.0 (intercepts `/web/dataset/*`) | `POST /integrations/odoo/push` | `odoo_staging` (m069, idempotent) + `attendance_excuses` (m070) | `odoo-bridge.controller.ts` (`mapOdooRequest` 8 Studio models, `reconcile` → excuses + alerts) |

Odoo XML-RPC (`odoo.service.ts`) exists for the future API path (Phase 2). Sprinklr times are LOCAL
Kuwait, not UTC. All bridge pushes are gated `rta.view`.

## 7. AI guard team (the seed of the 35-agent AI Workforce)

15 modules: health-guard, analyst, reporter, security-guard, scorecard-guard, researcher, expert,
advisor, **chief** (orchestrator), automode, bots, diagnostics, knowledge-ledger, team-learning + llm.
Shared stores: `knowledge-ledger` (curated KB), `analyst_thresholds`/`analyst_recommendations`/
`automode_decisions` (learned state), `coaching_flags`/`report_runs`/`notifications`/`audit_logs`
(events). **LLM narration dormant** — no `ANTHROPIC_API_KEY` + wrong default model id
(`llm.service.ts:14`) — Phase 3 W0 fixes both, then `AgentRunner` scaffold + `agent_events` bus.
Design doc: `AI_WORKFORCE_ARCHITECTURE.md`.

## 8. Known architectural debt (tracked)

| Debt | Where | Plan |
|---|---|---|
| Two recon engines, tested one doesn't ship | `recon.engine.ts` vs `scripts/recon-build.js` | Phase 4: unify + golden-master |
| God-files | `recon.controller.ts` ~4,100 lines · `RTA.tsx` ~3,850 | Phase 4: split by concern |
| No caching; heavy per-request grids | `roster-v2/hourly`, `week-forecast` | Phase 4: Redis cache + CTE collapse + pool raise |
| `headcount_intervals` never populated | migration 035 | Phase 4: populate-or-retire |
| Hardcoded recon paths | `recon-new-roster.js:26-27` | Phase 1 cleanup: env |
| 3 overlapping generators | schedule-generator | Phase 1 cleanup: consolidate |
