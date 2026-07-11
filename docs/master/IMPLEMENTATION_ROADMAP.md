# WFM Platform — Implementation Roadmap (As-Built → Target)

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> Reality-based roadmap for the Boutiqaat Contact Center WFM platform. This document records what is
> **already live** (Phase 0), what must be hardened **now** (Phase 1), and the confirmed/recommended path
> forward (Phases 2–3), with dependencies, the risk register, UAT plan, go-live checklist and stabilization plan.
>
> **Canonical companions (one master source per fact — do not fork):**
> - Business rules & decisions → `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (cited below as **RULES §n**)
> - Roster/reports engine & endpoints → `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md`
> - Reconciliation pipeline runbook → `docs/RECON_PIPELINE.md`
> - UI/theme standards → `docs/knowledge/DESIGN_SYSTEM.md`
> - Master project instructions → `CLAUDE.md`
>
> **Status vocabulary (used rigorously):**
> - **Confirmed** — agreed with the WFM Director and/or recorded in RULES / memory. Executable.
> - **Recommended** — improvement proposal. **Not executed before the Director's explicit agreement**
>   (standing order: no new or changed rule runs before agreement).
> - **Needs Approval** — a documented plan explicitly parked awaiting the Director's go (e.g. the
>   page-consolidation plan, D-068). **Deferred** — agreed to postpone; revisit condition stated.
> - **DONE / LIVE** — running today on real data. **PARTIAL** — built, needs completion/verification.

---

## 1. Phase 0 — DONE (the as-built platform, live today)

The platform is **real and running**: NestJS + TypeScript + PostgreSQL (TypeORM, `synchronize:false`, SQL
migrations through 067) backend; React + TypeScript + Vite frontend (~80 pages / 66 routes / 6 tabbed hubs);
live Boutiqaat contact-center data in local PostgreSQL `wfm_db`. Everything below is verified live, not demo.

### 1.1 Data foundation & reconciliation (the crown jewel)

| Item | Status | Evidence / source |
|---|---|---|
| Canonical roster table **`roster_days`** (rich: person_no, role_function, hr_code, presence, OT buckets, tardiness) | LIVE | RULES §11; all `roster-v2/*` reports read it |
| **Recon engine** `backend/scripts/recon-build.js` + `recon-new-roster.js` — every business rule codified IN the engine so each rebuild re-applies it | LIVE | `docs/RECON_PIPELINE.md`; RULES §18 |
| One-command refresh `node scripts/recon-refresh.js` (foundation → engine → ingest → live) | LIVE | RECON_PIPELINE |
| In-system **Upload & Rebuild** button → `POST /attendance-recon/recon-refresh` (perm `schedule.publish`) | LIVE | RULES §18 |
| **Ingest-safety rule** — a partial upload can only replace its own date range, never the rest of the month; `roster_days_recon_bak` refreshed each run (true undo) | LIVE (commit b7b833d) | RULES §20 (incident post-mortem) |
| Combine-both-systems reconciliation (Ameyo ∪ Sprinklr union, bleed guards, punch for floor-support) | LIVE | RULES §5 |
| **TRUE_OT** = ot_min + offday_ot_min + holiday_ot_min (3 disjoint buckets, verified no double-count) | LIVE | RULES §6 |
| Tardiness tolerance **>6 min** (`CRED_LATE`/`CRED_EARLY` = 7..240), full-shift-span rule, no-punch-no-system → flagged + worked 0 | LIVE | RULES §19 |
| Cross-midnight shift **owned by its start day for everything** | LIVE (engine) | RULES §19 |
| Holiday-worked OT + editable holidays (`recon-config.json` → `holidays` table) + **L-on-holiday returns to leave balance** | LIVE | RULES §18–19 |
| CORRECTED WFH rule (WFH = code/location only, never inferred from system-no-punch) — fixed in BOTH pipelines | LIVE | RULES §4, §16 |
| Maternity 7h (12375/12434, early-out exempt only) + `*7` codes | LIVE | RULES §7 |
| Canonical identity: `person_no`, intern 6xxxx → full-time 1xxxx merge, function per-month | LIVE | RULES §1 |
| Engine validated vs the Director's manual reconciliation: login 93% / late 96% / early 95%, **0 cases engine clearly wrong** | Confirmed | RULES §19 |
| Jan–May data consistent (0-diff dry-run); June restored to pre-2026-07-01 snapshot (2733 rows / 103 people) pending rebuild | LIVE (see H-01) | RULES §18, §20 |

### 1.2 Modules live (structural completeness)

- **Scheduling:** Schedule grid (overlays corrected `roster_days`; WFH 🏠 icon, holiday gold ribbon — RULES §18),
  auto **Schedule Generator** (fairness/gender/rest, save-as-draft fixed), **demand→schedule chain**
  (`roster-v2/generate` → `generate-week` → save → atomic reversible `publish`/`unpublish`, RULES §10,
  migrations 065/066), rotation groups, soft-lock on upload + Unlock.
- **Smart Break engine (R3 B0–B5 DONE 2026-07-10/11 — Director spec `SMART_DYNAMIC_BREAK_MANAGEMENT_PROMPT.md`,
  commit 3d1d82e; RULES §23, BR-BRK-001..014, D-078):** policy matrix m079 + daily balance 4×60 + optimizer v2
  with real coverage floor (commit 1801344) · live 45s release engine — explainable priority, risk
  green→critical + stale fail-safe, modes auto/supervisor/hybrid/freeze (9cf3c0e) · BreakCard + Break Command
  Center UI (033f373) · reports + 9-sheet Excel + zero-write simulation (0f5fa44). Supersedes the old breaks
  planner (midnight-clip fixed). **Remaining:** hybrid-mode pilot on one function → threshold/weight tuning →
  accounts provisioning (deliberately LAST, pre-rollout — D-078) → expand function by function.
- **Roster reporting suite** (~18 pages over `roster_days`): Roster grid, Roster Dashboard, Schedule Analysis,
  OT & Exceptions (disjoint OT buckets + Excel), Hourly Analytics, Interval Headcount, Hourly Coverage,
  Agent 360 (period compare), Team 360, WFH HR Report (holiday-aware since commit b6bfcf4), Data Quality,
  System Audit, Schedule Change Log, HR Matrix, **Custom Report Builder + Dashboard Builder**.
- **Attendance & adherence:** tardiness↔conformance (approved permission never lowers conformance — RULES §5),
  OT reconciliation + forgotten-OT report, 180h/year OT cap report, attrition analytics.
- **Requests & approvals:** envelope + extension tables; permission / sick / annual / death / comp / **shift+OFF
  swap with peer acceptance and auto-apply-to-schedule (DONE 2026-06-17, migration 033)** / OT / break /
  appointments & exams with uploads (034) / emergency leave + attendance correction (025); SLA escalation loop
  (027); **HC-impact panel reads canonical `roster_days`** (RULES §16); leave-balance ledger (038) with
  holiday-inside-leave credit-back (RULES §19).
- **Capacity & forecasting:** Erlang-C engine (verified 100% vs textbook + P99 surge scenario), chat/WA
  concurrency 4, email backlog model, intern productivity factor; Volume Forecast (seasonal baseline +
  WAPE/MAPE backtest) — persistence pending (Phase 2).
- **Scorecard & coaching:** per-function KPI bands, Net Points, round-half-up, sick-day penalty, scorecard
  Excel builder (skill `scorecard-builder`); row-level access scoping (agent=own/TL=team/admin=all); coaching
  engine auto-flags (028).
- **The Guard team + Chief:** Health, Analyst (learning, 029), Reporter (030), Security, Scorecard, Researcher,
  Expert (146 KB articles ingested), Reply-Helper; Knowledge Ledger + Team Learning; **Auto Mode** approving
  safe-surplus only (031); Diagnostics + system-wide Smoke Test.
- **Executive surfaces:** Command Center (verified-data-only), Control Dashboards (Exec/WFM/TL/Agent),
  WFM Overview, Fairness (night-team carve-out, 065), Workforce Analytics, Campaign Calendar (024).
- **Integrations:** Ameyo + Sprinklr Chrome-extension bridges (Sprinklr times are LOCAL, not UTC — RULES §12),
  Odoo (holidays/punch/permissions), email→employee link.
- **Security (hardened, phase-2 pass 2026-06-20):** JWT + rotating refresh + blacklist, lockout, RBAC final
  access model, TOTP MFA opt-in (039), self-service password change, IDOR sweep, dependency CVEs patched
  (never `npm audit fix --force` — downgrades NestJS), 162/162 GET smoke-clean, class-level permission guards
  on 14 controllers, immutable audit trigger.
- **Design system:** 3 themes (Dark / Light / Aurora-Glass), light-mode comfort net, dazzle kit
  (`components/dazzle.tsx`), **no animated background** (`DESIGN_SYSTEM.md`).
- **Production packaging:** `docker-compose.prod.yml` (postgres + redis + backend + frontend/nginx + certbot),
  Dockerfiles, `.env.production.example`, `DEPLOYMENT.md` with TLS bootstrap — **built and verified, not yet
  deployed** (deploy is Phase 3).

---

## 2. Phase 1 — MVP HARDENING (immediate; the current phase)

Goal: **the numbers behind every page are provably correct for the whole year, through ONE engine**, and the
page sprawl is consolidated. The 2026-07-01 A-to-Z audit (37 findings) is the work order; batch 1 is already
fixed (commit b6bfcf4: `include_tardiness` ingest, report-builder OT-total 3-bucket, WFH-HR holidays from
table, month-agnostic refresh summary, doc/dead-code).

### 2.1 Work items (in execution order)

| ID | Item | Status | Detail / acceptance |
|---|---|---|---|
| **H-01** | **Full-June upload test: partial Jun 28–30 first, then whole-June rebuild through the corrected engine** | Confirmed — NEXT | Proves the ingest-safety fix (RULES §20): a Jun 28–30 upload must replace ONLY those days. Then a full June rebuild restores today's refinements (cross-midnight de-bleed, leave-on-holiday, username, +13 people) lost in the incident rollback. **Blocker:** needs the Director's PREPARED source files re-shared (raw `Desktop/ROSTER` exports don't match — `byUser` needs the prepared "Ameyo login and logout.xlsx" format). Acceptance: row/people counts match the pre-incident corrected build; spot-check the 4 known cross-midnight cases (12937/11952/13805/13830 → holiday OT 0 on 06-16). |
| **H-02** | **Whole-year through the corrected engine: Jan–May recon rebuild** | Confirmed (follow-up recorded in RULES §19 "REMAINING") | Jan–May was built by the OTHER pipeline (`import-roster-master.js`); its ~480 non-working-days-with-worked rows can't be de-bled via SQL (no session-login sign). Rebuild each month through `recon-refresh` as that month's prepared sources are loaded. **Always dry-run + diff vs live before promoting** (a prior refresh REGRESSED — memory `update_files_refresh_attempt`). Acceptance: per-month diff report reviewed by the Director; no unexplained changes to hr_code/holiday-OT/late/worked/TRUE_OT. |
| **H-03** | **`ot_before_min` / `ot_after_min` ingest fix** | Confirmed (audit high-severity bug, deferred from batch 1) | `recon-build._ingest` + `recon-ingest` MAP never emit them → every corrected refresh NULLs them, so OT-before/after rankings, roster-v2 summary, the hourly-coverage OT cascade, report-builder KPIs and agent/TL profiles silently read 0 while TRUE_OT is non-zero. Fix: compute both in `recon-build` (split `otSystemMin`; before = pre-shift session where OT-before applies) + add to the MAP. **Careful: must not change TRUE_OT semantics.** Do together with the other MAP-omitted columns (`attendance_status`, `late_category`, `week_number`, `month_name`, `missing_punch`, `missing_system`, `comp_worked_min`, `original_shift_code`, `crosses_midnight`) or hide those report-builder fields on recon-sourced data. |
| **H-04** | **`sc` CTE fan-out fix (Custom Report Builder)** | Confirmed (RULES §9 drift) | The scorecard CTE (1 row/person) joins 1:N onto per-day roster rows → grouped `AVG(sc.net)` is **day-weighted, not person-weighted** (a 22-day agent counts 22×). Affects all 13 `sc.*` KPIs in grouped views; detail view is correct. Fix: aggregate at person grain before averaging (`recon.controller.ts:~357`). **Number-changing** → re-validate grouped averages with the Director. |
| **H-05** | **ONE unified shift-category classifier** | Confirmed (RULES §3 + §16; audit found a 6th divergent site) | Six sites classify shifts differently (`recon.controller.ts:422,818`; `schedule.service.ts:876`; `me.service.ts:51`; `generator.service.ts:320,375`; `Schedule.tsx:804`). Build ONE shared classifier keyed by CODE (Morning = M,B,C,AM(+20/WFH); Evening = E,EE20; Night = N,N20; Midnight = MD,MN,MDR,MNR) with start-hour fallback; import it everywhere; adopt-or-delete the orphan `common/wfm-calc.ts`. **Number-changing** (shift-rate %, fairness, rotation) → full re-validation pass. |
| **H-06** | **Page consolidation into hubs** | **Needs Approval — awaiting the Director's go (D-068)** (memory: audit_2026_07_01) | Extend the proven `HubTabs` + `?tab=` shape (6 hubs live) → ~10–12 sidebar entries: **Roster Reports hub** (roster grid + dashboard + analysis + ot-exceptions + intervals + hourly + data-quality + system-audit + change-log + builders), **Scorecard hub** (scorecard/board/leaderboard/trends/360s/coaching/productivity), **Capacity & Coverage hub**, **Chief branch** (nest 13 guard routes), **one executive home** (keep `/command-center`, fold ControlDashboards' role switcher, demote Dashboard). Do NOT restructure navigation before the go. |
| **H-07** | Consolidation quick-wins (do with H-06) | Needs Approval (bundled with H-06 / D-068) | Shared `adhColor` (one threshold set), `<ShiftRateBars>` + one category-colour map, `ROSTER_KPI_DEFS`, shared default date-range helper (kill frozen 2026 literals), `keep-dark` on the ShiftRotation modal (invisible in Light mode), header titles from the i18n route map, de-dup sidebar icons, `DateRangeBar` everywhere. |
| **H-08** | **Legacy `roster_daily` path: re-ingest or deprecate** | Confirmed open (RULES §4, §16) | `/dashboard`, `/metric`, `/overtime`, hr-weekly/matrix legacy consumers read THIN `roster_daily`; the engine WFH fix surfaces there only on re-ingest (heavy parse). Either re-ingest, or repoint those endpoints at `roster_days` and retire the legacy path. **Never cross-wire the two tables** (RULES §11). |
| **H-09** | Remaining authz decisions on mixed controllers | Confirmed open (security memo 2026-06-20) | Coaching, coverage/hourly, breaks, campaigns, schedule-changes, attendance-corrections, calendar, skills, settings-reference, integrations — decide scope per endpoint (own/team/all) like the scorecard model, then guard; re-verify with `scripts/smoke-get.js`. |
| **H-10** | Doc/data-quality follow-ups | Confirmed | Keep RULES self-consistent after each fix (e.g. the CRED 7..240 correction already applied); never-closed Sprinklr sessions stay as-is per decision 2026-06-30 (revisit when a verified recovery method exists — affects 3 people's no-evidence flag). |

### 2.2 Phase-1 exit criteria
1. Jun 28–30 partial upload verified surgical; full June rebuilt = pre-incident corrected state.
2. All 12 months (as sources arrive) flow through ONE engine; dry-run diffs signed off by the Director.
3. No report field silently reads 0/NULL after a refresh (H-03 class closed).
4. Shift-rate %, fairness and grouped scorecard numbers re-validated after H-04/H-05 (numbers WILL move — the
   Director signs the new baselines).
5. Sidebar at ~10–12 entries with hubs (if H-06 approved), Smoke Test + Diagnostics green.

---

## 3. Phase 2 — Real-time & workflow maturity

Confirmed direction (CLAUDE.md stages 10–14 + memory carry-overs); individual designs still need per-item
agreement before build.

| ID | Item | Status | Notes |
|---|---|---|---|
| P2-01 | **RTA Live maturity** | PARTIAL → mature | RTA Live overhauled once (Sprinklr bridge); complete live adherence, interval gap alerts, queue status, permission-impact live view, alert thresholds. Depends on bridges running 24/7. |
| P2-02 | **Notifications maturity** | PARTIAL | In-app exists; add email hook (outage automation is a known gap), then Teams Adaptive Cards, then push. Wire request/SLA/schedule-publish/skill-expiry events. |
| P2-03 | **Swap-to-schedule** | **DONE 2026-06-17** (apply-on-approve, full tuple swap, version timeline, audit both sides) | Remaining follow-up: Schedule `editCell`/`publish` still WRITE `attendance_records` while the grid READS the `roster_days` overlay (RULES §18) — unify the write path. |
| P2-04 | **Teams integration** | Recommended (future per CLAUDE.md §26–27) | Internal chat module exists; Teams = notification cards first, chat bridge later. |
| P2-05 | **Mobile / self-service maturity** | PARTIAL | `/me` self-service + agent dashboards live; add responsive/mobile pass, agent request flows end-to-end on mobile, push. |
| P2-06 | **Comprehensive workflow/SLA reporting** | PARTIAL (workflow SLA reports + approval-chain timeline built) | Director priority: every workflow exportable with who/when/SLA. Extend to all request types + PDF export wiring. |
| P2-07 | **Forecast persistence + saved capacity scenarios** | PARTIAL | Volume Forecast engine works; persist forecasts/scenarios, connect real contact-volume imports to capacity page. |
| P2-08 | **Full English pass** | Confirmed carry-over | Page-by-page 100% English in EN mode; inputs must still accept typed Arabic (RULES §17). |
| P2-09 | **Scorecard productionization** | Confirmed vision (memory: scorecard_system_vision) | Live cumulative module w/ QA ingest + weekly/monthly views on top of the proven Excel method. |
| P2-10 | Skill expiry auto-alerts, attachment preview, chat persistence polish | Confirmed gaps (CLAUDE.md §32) | Close alongside the above. |

---

## 4. Phase 3 — Advanced & production

| ID | Item | Status | Notes |
|---|---|---|---|
| P3-01 | **AI-assisted scheduling maturity** | Recommended | Generator + demand chain exist; add rotation-aware multi-week optimization, what-if scenarios, OT-suggestion when coverage gaps (never hide gaps — CLAUDE.md §11). Advisor LLM (ANTHROPIC_API_KEY) already narrates/proposes — extend to schedule proposals **with human approval always**. |
| P3-02 | **Forecasting maturity** | Recommended | Per-weekday demand curves from accumulated Sprinklr measurements; order-driven forecast (orders × CPO → HC, memory: data_assets_and_reports); backtested model selection. |
| P3-03 | **BI integration** | Recommended | Read-only reporting views / exports for corporate BI; the Dashboard Builder is the in-app layer. |
| P3-04 | **HA / cloud deploy** | Confirmed direction (server + domain, 2026-06-13) | `docker-compose.prod.yml` stack EXISTS and builds (nginx TLS :443 → SPA + `/api` `/uploads` `/socket.io`; PG/Redis internal-only). Remaining: VPS sizing (needs concurrent-user count — re-ask), socket.io Redis adapter under load, off-site backups, uptime monitoring + log aggregation, stop the abandoned :3000 Enterprise-Lab process and run `dist/main` on 3000. |
| P3-05 | **Security world-class tail** | Confirmed list | Audit-log retention/partitioning, CI gates (npm audit/SAST/DAST), pen-test, SSO (future), DTO strictness. |
| P3-06 | **External integrations** | Future (CLAUDE.md §32) | Telephony API (Ameyo parser needs samples), CRM, HR system, push. |
| P3-07 | **Enterprise AI Workforce — the 35-agent department (Director's mandate, 2026-07-06)** | Confirmed program — spec `AI_WORKFORCE_ARCHITECTURE.md` | Waves: **W0 substrate ✅ LANDED 2026-07-06** (LLM model-id fix `claude-sonnet-5`, migration 073 `agent_events` append-only bus, `@common/agent-runner.ts` publish/consume/advisory-lock — all verified incl. the 2-session lock test; REMAINING: `ANTHROPIC_API_KEY`) → **W1** expose the 13 EXISTS agents via the runner + merge Advisor+Expert into WFM Copilot → **W2** extend the 16 PARTIALs (+adaptive baselines, Auto-Mode behind `automation.manage`) → **W3** agent data pipelines (forecast AHT, Odoo staging→recon) → **W4** the 6 NEW agents (Contact-Reason, Workforce Simulator, Documentation Writer, Cost Optimizer, Training Planner, Testing Engineer LAST). Every agent: full §1 contract, explainable + audit-logged, human-in-the-loop for pay/regulated actions. |

---

## 5. Dependency map

```
Prepared monthly source files (Director)  ──►  H-01 June rebuild ──► H-02 Jan–May/year rebuild
                                                      │
recon-ingest safety (DONE b7b833d) ───────────────────┘
H-03 ingest columns ──► trustworthy OT-before/after + report-builder fields ──► P2-06 reporting
H-05 unified classifier ──► shift-rate/fairness/rotation numbers ──► P3-01 AI scheduling
H-04 sc fan-out ──► trustworthy grouped scorecard ──► P2-09 scorecard productionization
H-06 hub consolidation (needs Director GO) ──► H-07 quick wins ──► P2-05 mobile pass
Bridges running 24/7 ──► P2-01 RTA maturity + P3-02 forecasting curves
P2-02 notifications (email) ──► Teams cards (P2-04) ──► push (P2-05)
docker-compose.prod (exists) + VPS sizing answer ──► P3-04 deploy ──► go-live checklist §8
```

Hard rule for every data change in the chain: **rule lives in the engine** (`recon-build.js`), never patched
into data — otherwise the next rebuild wipes it (RULES §18, the root cause of every past "worked then broke").

---

## 6. Risk register — Top 15

Likelihood/Impact: H/M/L. Owner roles: **Dir** = WFM Director (platform owner), **Eng** = engineering (Claude
sessions), **HR**, **Ops/TL**, **IT**.

| ID | Risk | Impact | Likelihood | Mitigation | Owner |
|---|---|---|---|---|---|
| RSK-01 | **Wrong deductions / HR action from tardiness data** — a false late/early flag harms a real employee | H | M | Engine-only rules (>6 min tolerance, 240 cap, +1440 midnight wrap, approved-permission exemption — RULES §5, §19); engine validated vs manual (0 clear-wrong cases); WFH HR report is conservative with fairness guards; HR reviews the report, system never auto-deducts | Dir + HR |
| RSK-02 | **Data mismatch roster ↔ fingerprint ↔ system** (Ameyo bleed, Sprinklr 1970 logouts, stale Odoo leave) | H | H (inherent) | Source-trust table (RULES §5), union rule, bleed guards, worked_min clamp, no-punch-no-system → flagged worth 0 (never silently credited); Data Quality page surfaces every anomaly | Eng + Dir |
| RSK-03 | **Partial upload wipes good data** (happened 2026-07-01) | H | L (post-fix) | Ingest deletes only the uploaded range; per-run `roster_days_recon_bak`; `roster_days_predisaster` snapshot; refuse-to-delete on empty; always dry-run + diff before promoting a rebuild | Eng |
| RSK-04 | **Schedule freeze/publish bypass** — a Generate overwrites a published schedule | H | L | Publish targets only an EMPTY future week, atomic `INSERT … ON CONFLICT DO NOTHING`, fully reversible unpublish (RULES §10); soft-lock on upload; Unlock is an explicit audited action. Residual: manual DB edits — keep `schedule.publish` permission tight | Eng + Dir |
| RSK-05 | **Manual edits unaudited** — cell edits that skip version history/audit | H | M | Cell edits write a notes-JSON timeline + audit_logs; swap-apply audits both sides. **Open gap:** `editCell`/`publish` still write `attendance_records` while reports read `roster_days` (P2-03 follow-up) — until unified, an edit may not surface in reports; verify per-edit during UAT | Eng |
| RSK-06 | **Number-changing fixes (H-04/H-05) silently alter reports management already saw** | M | H (if unmanaged) | Do AFTER demo windows; dry-run + before/after diff; the Director signs new baselines; change-log entry in DECISIONS log | Dir + Eng |
| RSK-07 | **Night/midnight coverage constrained by small male pool** (female MD/MN prohibition — RULES §7) | H | H | Generator must SHOW the gap honestly + reasons (need males / cross-skill / OT / exception) — never hide (CLAUDE.md §11); night-team carve-out option; fairness monitoring | Dir + Ops |
| RSK-08 | **Integration failure** — Ameyo/Sprinklr bridge stops, Odoo export format changes | M | H | Bridges cache + auto-login; source files are file-drops (no hard runtime dependency for recon); recon fails loudly (0-match gotcha documented); keep prepared-file formats documented in RECON_PIPELINE | IT + Eng |
| RSK-09 | **Source-file format drift** — a new month's workbook changes columns/sheet names | M | M | Filename matching + canonical names in refresh endpoint (made month-neutral, b6bfcf4); validation-before-commit import pattern; dry-run diff catches silent mis-parses | Eng + Dir |
| RSK-10 | **Two-table cross-wiring** (`roster_days` vs `roster_daily`) — a fix lands on the wrong table | H | M | RULES §11 NEVER-cross-wire rule; H-08 retires or re-points the legacy path; `/dashboard` auto-ingest-when-0 landmine documented | Eng |
| RSK-11 | **Adoption** — TLs/agents keep using Excel/WhatsApp instead of the system | H | M | Consolidated hubs (H-06) reduce the 35-entry maze; role-scoped dashboards; the Director champions; UAT with real TLs; Arabic/English parity (P2-08); training in go-live plan §8 | Dir + Ops |
| RSK-12 | **Single-machine, not-yet-deployed production** — laptop DB is the live store | H | M | Deploy the existing docker stack (P3-04); until then: routine `pg_dump` backups off-machine, `roster_days_predisaster`-style snapshots before risky ops | IT + Dir |
| RSK-13 | **Security/authz gaps on mixed controllers** (agent-reachable WFM data) | M | M | 14 controllers already class-guarded; H-09 finishes per-endpoint scoping; smoke-get.js per-role regression; MFA available for privileged users | Eng |
| RSK-14 | **Key-person dependency** — the engine/rules live in one Director + one assistant | H | M | This master doc set + `wfm-system`/`mini-me` skills are self-describing and portable; RULES is the arbiter; DECISIONS log tracks every agreement | Dir |
| RSK-15 | **Dependency/upgrade breakage** — `npm audit fix --force` downgrades NestJS; otplib v13 ESM; exceljs/uuid pin | M | M | Documented forbidden commands (security memo); `--legacy-peer-deps` install; build+smoke before merge (CLAUDE.md §34.4) | Eng |

---

## 7. Suggested architecture (as-built — keep it)

**Confirmed as-built: a modular monolith, and it should stay one.**

- **Backend:** NestJS modular monolith (`backend/src/modules/*` — attendance-recon, schedule,
  schedule-generator, requests, leave-balances, scorecard, agent-self, integrations, guards…), PostgreSQL with
  SQL migrations as source of truth (`synchronize:false`), compiled `dist` runtime (`npm run build` → restart).
- **The reconciliation engine lives OUTSIDE the API** as standalone scripts (`backend/scripts/recon-*.js`)
  invoked by the one-command refresh and the in-system endpoint. **Keep this**: it makes every rule re-applied
  per rebuild and independently runnable/diffable.
- **Canonical data spine:** `roster_days` (rich) is THE reporting truth; `attendance_records` is the schedule
  write-store the grid overlays; `roster_daily` is legacy-thin (retire per H-08). One canonical metric layer
  (TRUE_OT / CRED_LATE / CRED_EARLY / MATERNITY_7H) defined once in `recon.controller.ts` constants.
- **Frontend:** React + Vite SPA, hub pattern (`HubTabs` + `?tab=`) as the ONE IA shape; dazzle kit + CSS-var
  themes; inline `ar ? :` i18n.
- **Integrations as bridges** (Chrome extensions + file drops), not tight couplings — resilient to vendor churn.
- **Keep:** pure business-logic functions, engine-owned rules, migration-first schema, permission-guarded
  controllers, audit trigger, verified-data-only dashboards (no counterfactuals — Command Center decision).
- **Recommended (needs agreement):** unify the schedule write path onto the roster overlay model (P2-03
  follow-up); promote `wfm-calc.ts` into the shared classifier or delete it (H-05); do NOT split into
  microservices — the load and team size don't justify it.

---

## 8. UAT plan (key scenarios, by module)

Run with real roles (Dir, one TL, one RTA, one agent, HR) on a restored-backup DB. Every scenario: expected
vs actual signed by the Director.

| # | Scenario | Module / rule under test |
|---|---|---|
| U-01 | Upload June 28–30 only → verify Jun 1–27 untouched; restore from `roster_days_recon_bak` | Recon ingest safety (RULES §20) |
| U-02 | Full-month Upload & Rebuild → spot-check 10 agents vs manual workbook (late/early/OT/WFH/hr_code) | Recon engine (RULES §5, §18–19) |
| U-03 | Worked scheduled shift on an official holiday → whole shift = holiday OT, regular OT 0 | Holiday OT (RULES §18) |
| U-04 | Annual leave day landing on a holiday → shows H, leave balance NOT charged | L-on-holiday (RULES §19) |
| U-05 | Cross-midnight shift starting 23:00 → all hours/OT/permission on the START day | Start-day ownership (RULES §19) |
| U-06 | Agent 5-min late and agent 8-min late → only the 8-min one flagged | >6-min tolerance (RULES §19) |
| U-07 | Maternity agent (12375) leaves 2h early → no early-out; her late-in still counts | MATERNITY_7H (RULES §7) |
| U-08 | Approved permission overlapping late arrival → conformance NOT lowered; pending/refused does not exempt | RULES §5 |
| U-09 | Generate week for a function → female agents get no MD/MN; coverage gaps SHOWN with reasons | Generator + female rule (RULES §7, §10) |
| U-10 | Publish generated week → lands only on empty future week; unpublish removes exactly those rows; re-publish onto an existing week refuses | Publish safety (RULES §10) |
| U-11 | Shift swap: peer accepts → TL approves → both schedule cells swap (marker + times + WFH flag) + both notified + audit both sides | Swap-to-schedule (033) |
| U-12 | Permission request approval → HC-impact panel shows before/after from `roster_days`; risky approval warns | Permission HC impact (RULES §16) |
| U-13 | Report Builder: grouped Net Points for a team vs hand-computed person-grain average | H-04 acceptance |
| U-14 | Same shift (e.g. 14:00 start) shows the SAME category on Schedule, shift-rate, fairness, rotation, /me | H-05 acceptance |
| U-15 | OT & Exceptions: TRUE_OT = regular + off-day + holiday, buckets disjoint; OT-before/after non-zero after a refresh | RULES §6 + H-03 acceptance |
| U-16 | Agent logs in → sees ONLY own data (roster, scorecard, requests); TL sees only their team | Access model + row-level scoping |
| U-17 | WFH agent short-hours on Arafat/Eid → excluded_valid in WFH HR report, not hr_action | WFH HR holidays (b6bfcf4) |
| U-18 | Erlang: known textbook input reproduces expected agents; concurrency-4 chat model sanity | Capacity engine |
| U-19 | Smoke Test + Diagnostics + all guards green; light/glass theme pass on every hub tab | System health + design net |
| U-20 | EN mode: 100% English on audited pages; Arabic still typeable in inputs | i18n (RULES §17) |

---

## 9. Go-live checklist

**Pre-deploy (data & code)**
- [ ] Phase-1 exit criteria met (§2.2); all 12 months rebuilt/consistent through the one engine
- [ ] UAT §8 signed off by the Director; DECISIONS log updated with any new agreements
- [ ] `npm run build` clean (backend + frontend); Smoke Test 100%; smoke-get.js per-role clean
- [ ] Full `pg_dump` + `roster_days` snapshot taken and stored OFF the host machine

**Deploy (existing docker stack — P3-04)**
- [ ] VPS sized (get the concurrent-user count from the Director) and provisioned
- [ ] `.env.production` from the example, strong secrets generated; `POSTGRES_SSL` set correctly
- [ ] `docker-compose.prod.yml` up; certbot TLS bootstrap per `DEPLOYMENT.md`; PG/Redis confirmed NOT exposed
- [ ] Migrations applied via `scripts/migrate.js`; seed/admin accounts verified; MFA enrolled for admins
- [ ] Stop/retire the abandoned :3000 Enterprise-Lab process on the old host
- [ ] Nightly `pg_dump` cron + off-site copy; uptime monitor + log aggregation live
- [ ] Socket.io Redis adapter enabled if >1 backend replica

**Cutover (people)**
- [ ] Roles/users loaded per the final access model; each TL logs in and sees only their team
- [ ] Ameyo/Sprinklr bridges installed & running on RTA machines; Odoo file-drop routine documented
- [ ] Monthly Upload & Rebuild runbook (RECON_PIPELINE) handed to the Director + one backup person
- [ ] 30-minute role-based walkthroughs (Agent / TL / RTA / WFM / HR); Arabic+English quick cards
- [ ] Freeze window announced: no schema/rule changes during week 1

---

## 10. Post-go-live stabilization (hypercare, weeks 1–4)

1. **Daily (week 1):** Diagnostics + Health Guard review each morning; compare 3 random agents/day vs source
   files; watch the Data Quality page for new anomaly classes; verify the first in-production Upload & Rebuild
   with a dry-run diff first.
2. **Feedback loop:** one intake channel (the internal chat WFM channel); triage into DEFECT (fix now) vs
   RULE-CHANGE (goes to the Director for agreement, then into `recon-build.js` + RULES doc — never a data patch).
3. **Weekly (weeks 2–4):** KPI drift review (conformance, TRUE_OT, shrinkage vs pre-go-live baselines);
   backup restore drill once; security log review (lockouts, 403 spikes); performance check on the heaviest
   endpoints (roster-v2 summary, report-builder).
4. **Exit criteria to "steady state":** two consecutive clean monthly rebuild cycles (upload → dry-run → promote →
   reports verified), zero P1 defects for 2 weeks, TL/agent adoption ≥ agreed threshold, and the RSK-12 backup
   routine proven by an actual restore.
5. **Then:** resume the Phase 2 queue (§3) in dependency order (§5).

---

*Maintained with the WFM Director. Any change to a rule referenced here is made in
`docs/knowledge/WFM_RULES_AND_DECISIONS.md` first; this roadmap only sequences the work.*
