# REBUILD PROMPT & OPERATING INSTRUCTIONS — Boutiqaat Enterprise WFM Platform

> **Last rebuilt: 2026-07-02 — full knowledge reconstruction.**
> This is THE future-rebuild file: the paste-ready restart prompt, the one-page project context, the
> operating covenant with the WFM Director, the canonical file map, and the memory-update protocol.
> It is the **executable companion** of `docs/master/MASTER_PROJECT_MEMORY.md` — if you are a new
> session (or a new agent entirely), start HERE, paste the prompt in §1, then follow §8 (reading order).
>
> Everything in this file is **Confirmed** (agreed with the WFM Director / recorded in
> `docs/knowledge/WFM_RULES_AND_DECISIONS.md` or the project memory) unless explicitly tagged
> **Recommended** — and per the Director's standing order, a Recommended item is NEVER executed
> before his explicit agreement.

---

## 1. THE MASTER RESTART PROMPT (paste-ready)

This supersedes `CLAUDE.md` §35. Use it verbatim as the first message of any new session, any new
agent, or any environment where the assistant's knowledge of this project must be reconstructed.

```text
You are continuing the Boutiqaat Contact Center WFM System — a REAL, RUNNING enterprise platform
(NestJS + React/Vite + PostgreSQL `wfm_db`, live contact-center data, ~80 pages, a standalone
reconciliation engine, an autonomous guard team). Do NOT restart the project. Do NOT build a
generic CRUD app. Continue from the latest approved state.

READ FIRST, IN THIS ORDER (do not code before finishing #1–#4):
1. docs/master/MASTER_PROJECT_MEMORY.md            — the project brain: what exists, what is live
2. docs/knowledge/WFM_RULES_AND_DECISIONS.md       — THE single source of truth for every business
   rule & decision (§1–20). If code conflicts with it, the RULE wins — fix the code.
3. docs/master/WFM_BUSINESS_RULES_LIBRARY.md       — every rule with an ID (BR-XXX-###), status,
   and the code path that enforces it
4. docs/master/REBUILD_PROMPT_AND_OPERATING_INSTRUCTIONS.md — how to behave, what may never
   change, the memory-update protocol
5. The module spec of whatever area you touch: docs/master/MODULE_SPECIFICATIONS.md,
   docs/master/DATA_DICTIONARY.md, docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md,
   docs/RECON_PIPELINE.md (roster refresh runbook), docs/knowledge/DESIGN_SYSTEM.md (UI)
6. docs/master/DECISIONS_AND_AGREEMENTS_LOG.md (D-###) and
   docs/master/SYSTEM_LEARNINGS_AND_IMPROVEMENTS.md (L-###/R-###) — history + open risks
7. The project memory index (~95 notes distilled from every past conversation):
   C:/Users/t.bassam/.claude/projects/C--Users-t-bassam-Desktop-WFM-System/memory/MEMORY.md
   — open the topic notes relevant to your task; they are history the Director insists is honored.
8. The portable skills (version-controlled, self-describing):
   .claude/skills/enterprise-wfm-platform/  (master operating skill — routing + protocols)
   .claude/skills/wfm-system/  (full knowledge base)
   .claude/skills/mini-me/     (assistant clone incl. confirmed rules + scorecard method)
   .claude/skills/scorecard-builder/  (monthly scorecard generator)

THEN, BEFORE ANY CODING:
- Inspect the repo (backend/, frontend/, database/migrations/, backend/scripts/recon-*.js).
- Verify the build: cd backend && npm run build (backend runs compiled dist — node dist/main.js;
  restart to apply .ts changes). The process on :3000 may be an ABANDONED copy — verify which
  backend is live; use APP_PORT=3001 for test boots.
- Tell me honestly: what works, what is mock/demo, what is broken, what should be fixed first.
- Present a plan and WAIT FOR MY APPROVAL before writing code.

OPERATING RULES (non-negotiable — full covenant in the rebuild file §6):
- I work in Arabic (Levantine). Match my language; keep all codes/identifiers/SQL in English.
- No new or changed business rule is EXECUTED before I agree to it. Distinguish rigorously:
  Confirmed (agreed/recorded) vs Recommended (needs my approval).
- "Review / make sure it's fine / كل شي تمام" = a DEEP correctness & data-integrity audit against
  the canonical data (roster_days), never a "page loads" check.
- Backup before any ingest; dry-run + diff before promoting any data; a partial upload may only
  replace its own date range. Rules live IN the engine (backend/scripts/recon-build.js) — never
  as one-off data patches.
- Report failures and gaps honestly. Never fake completion. Never hide mock data.
- Persist every decision: rules doc + docs/master suite + memory notes + skills (protocol in the
  rebuild file §10).

The data foundation is the Director's real workbooks (Desktop/ROSTER + Desktop/new roster/) and
the canonical table roster_days, refreshed only via node backend/scripts/recon-refresh.js or the
in-system Roster "Upload & Rebuild" button. Match employees by ID (person_no), never by name.
```

---

## 2. Full Project Context — One Page

| Item | AS-BUILT truth (2026-07-02) |
|---|---|
| Product | Enterprise Contact-Center WFM platform for Boutiqaat (Kuwait, 24/7 omnichannel) — purpose-comparable to NICE / Verint / Calabrio / Genesys WFM. Single source of truth for WFM, Ops, HR, RTA, TLs, agents, management. |
| Owner | The **WFM Director** at Boutiqaat — deep domain expert, approves every rule before it executes, works in Arabic (Levantine). |
| Status | **REAL and RUNNING on live data** — not a prototype. ~80 frontend pages / 66 routes / 6 tabbed hubs, ~60 backend modules, 125 DB tables (migrations `001`…`067`), a standalone recon engine, and an 8-guard autonomous team fronted by "the Chief". |
| Backend | NestJS + TypeScript + TypeORM (`synchronize:false`; SQL migrations are the schema truth), JWT + rotating refresh tokens, RBAC (`RequirePermissions`), append-only audit log, Swagger. Runs **compiled `dist`**. |
| Frontend | React + TypeScript + Vite. Arabic/English inline (`ar?'..':'..'`), RTL/LTR, 3 themes (Dark / Light / Aurora-Glass), dazzle kit (`frontend/src/components/dazzle.tsx`), DateRangeBar (Saturday weeks). |
| Database | Live local PostgreSQL **`wfm_db`** (~162 employees, tens of thousands of roster/attendance rows). Access via `backend/scripts` + root `.env` `POSTGRES_*`. Full column reference: `docs/master/DATA_DICTIONARY.md`. |
| Data spine | **`roster_days`** — the RICH canonical per-person-per-day table, built by the recon engine from the Director's real monthly workbooks. Every `roster-v2/*` report, HR matrix, Agent 360, OT & Exceptions reads it. (`roster_daily` is a THIN legacy table — never cross-wire; RULES §11.) |
| Recon engine | `backend/scripts/recon-{refresh,extract-foundation-v2,new-roster,build,ingest,compare-manual}.js` + editable `recon-config.json` (holidays). One command re-applies EVERY agreed rule. Validated vs the Director's manual reconciliation: login 93% / late 96% / early 95%, **0 cases the engine was clearly wrong** — his verdict: the engine is the trusted source. Runbook: `docs/RECON_PIPELINE.md`. |
| Scheduling chain | Demand→schedule on `roster_days` (`roster-v2/generate` → `generate-week` → save draft → **publish/unpublish** into `attendance_records`; publish is atomic `ON CONFLICT DO NOTHING`, never overwrites — RULES §10). Schedule grid OVERLAYS corrected `roster_days` (RULES §18). |
| Scorecard | Per-function KPI bands, Net Points, round-half-up, sick-day penalty, quiz-commitment — method fully codified in the `scorecard-builder` + `mini-me` skills (RULES §9). |
| Guards | Health · Analyst · Reporter · Security · Scorecard · Researcher · Expert · Reply-Helper behind **the Chief** (only the Chief shows in the sidebar). Auto Mode approves only safe-surplus requests (RULES §13). |
| Integrations | Ameyo + Sprinklr Chrome-extension bridges (Sprinklr times are LOCAL, not UTC); Odoo = holidays + biometric punch + permissions/comp/sick (individual leave goes stale — don't trust it). |
| Data state | **Jan–May 2026 consistent** (verified by dry-run diff — do NOT bulk-rebuild). **June** = pre-incident backup (2733 rows / 103 people) + SQL re-applies; a full June rebuild needs the Director's PREPARED source files (RULES §20). `roster_days_predisaster` (15,794 rows) is the 2026-07-01 full snapshot. |
| Latest audit | 2026-07-01 A-to-Z audit: 37 findings; batch-1 data bugs FIXED (commit `b6bfcf4`); the page-consolidation (hub-merge) plan is **Needs Approval — awaiting the Director's go (D-068)**. |

---

## 3. Final Rules Summary (pointers — never fork the text)

The rule TEXT lives in exactly one place: **`docs/knowledge/WFM_RULES_AND_DECISIONS.md`** ("RULES").
The ID'd, code-path-annotated index lives in **`docs/master/WFM_BUSINESS_RULES_LIBRARY.md`** (BR-XXX-###).
This table is only a router:

| Area | Where | Headline |
|---|---|---|
| Source-of-truth priority | RULES §0 | Latest Director clarification > real workbook > RULES doc > older assumptions > generic WFM |
| Identity | RULES §1 | `person_no` canonical; `is_active`=dedup not employment; function per-month; match by ID never name |
| Time & calendar | RULES §2 | Week starts SATURDAY; cut-offs 15→14 / interns 1→end / Bahrain 25→24; permission balance 6h+3 per cycle |
| Shift dictionary & THE ONE category mapping | RULES §3 | Morning (M,B,C,AM,20s,WFH-M/B) · Evening (E,EE20) · Night (N,N20,WFH-N) · Midnight (MD,MN,MDR,MNR); 9h incl. break; 20-codes=8h; Ramadan=7h |
| Presence & WFH | RULES §4 | WFH = WFH code or explicit location ONLY — NEVER inferred from system-no-punch; holiday is never absence; sick only from Odoo status |
| Reconciliation | RULES §5 | Combine Ameyo ∪ Sprinklr; source-trust table; CRED_LATE/EARLY 7..240; approved permission never lowers conformance |
| Overtime | RULES §6 | TRUE_OT = ot + offday + holiday (3 DISJOINT buckets); OFF/holiday OT must be punch-evidenced; 180h/year cap report |
| Maternity & female | RULES §7 | MATERNITY_7H (12375/12434, `*7` codes) excluded from early-out only; female ≤C, N only if needed, never MD/MN (configurable, flagged) |
| Rest / rotation / fairness | RULES §8 | 10h min rest; fairnessScore = 100−stdev; night-team carve-out optional; shift-rate excludes OFF/H/L/S/A/COMP |
| Scorecard | RULES §9 | Bands, round-half-up, sick penalty; sc-CTE day-weighting drift is OPEN |
| Demand→schedule | RULES §10 | Publish targets first EMPTY future week, atomic, reversible; published schedules never overwritten by Generate |
| Data tables map | RULES §11 | roster_days (rich) vs roster_daily (thin) — never cross-wire |
| Engine hardening (2026-06-30) | RULES §18 | Holiday-worked OT, master hr_code, worked_min clamp, in-system Upload & Rebuild, schedule↔roster overlay |
| Tardiness / HR actions | RULES §19 | >6 min tolerance; full-shift 9h span; no-punch-no-system = flagged + worked 0 (role-blind); ★ cross-midnight owned by START day for EVERYTHING; ★ leave-on-holiday returns to balance |
| Ingest safety | RULES §20 | Partial upload replaces only its own date range; per-run backup; the incident that taught it |

---

## 4. Final Assumptions (Confirmed unless noted)

| ID | Assumption | Status |
|---|---|---|
| A-01 | Chat / WhatsApp concurrency = **4** conversations per agent | Confirmed |
| A-02 | Intern productivity factor ≈ **70%** (configurable, never hardcoded) | Confirmed default |
| A-03 | Minimum rest between shifts = **10h** unless manually overridden (logged) | Confirmed |
| A-04 | Tardiness tolerance: late/early counts only when **> 6 minutes** (≤6 tolerated) | Confirmed 2026-06-30 |
| A-05 | Ameyo raw logouts bleed → discard sessions >16h, cluster on gap>4h; Sprinklr raw login/logout bleeds → use AGENT_OCCUPANCY; Sprinklr timestamps are **LOCAL** (no +3) | Confirmed |
| A-06 | Never-closed Sprinklr sessions (logout=1970): login-only recovery **NOT enabled** — Director chose leave-as-is; revisit when verified (may over-flag 3 people) | Confirmed (deferred) |
| A-07 | Leaders/supervisory roles: record-only for tardiness deductions, but the system-open flag applies to ALL roles | Confirmed 2026-06-30 |
| A-08 | Erlang-C voice engine verified 100% vs textbook cases; scenarios: base / shrinkage / OT / P99 surge | Confirmed |
| A-09 | Low-capture roles observed <70% of days → `unconfirmed`, excluded from absence | Confirmed |
| A-10 | Demo/mock data is allowed ONLY with a visible DEMO badge; a feature on mock data is not complete | Confirmed (standing) |

---

## 5. Final Structure — Repo Layout, Docs Map, Canonical-For-What

### 5.1 Repo layout

```
WFM System/
├── CLAUDE.md                      master project instructions (module list §6–33, roadmap, roles)
├── backend/                       NestJS (src/modules/** ~60 modules; runs compiled dist/)
│   └── scripts/                   recon-*.js engine, import-roster-master.js, backfill-identity.js,
│                                  gen-test-token.js, smoke-get.js, recon-config.json (editable holidays)
├── frontend/                      React+Vite (src/pages/** ~80 pages, src/App.tsx routes,
│                                  components/dazzle.tsx, components/Layout/Sidebar.tsx)
├── database/migrations/           NNN_*.sql — schema source of truth (001…067)
├── docs/
│   ├── knowledge/                 WFM_RULES_AND_DECISIONS.md ⭐ · REPORTS_AND_ROSTER_ENGINE.md ·
│   │                              DESIGN_SYSTEM.md
│   ├── RECON_PIPELINE.md          roster refresh runbook
│   └── master/                    THIS suite (see 5.2)
├── .claude/skills/                enterprise-wfm-platform · wfm-system · mini-me · scorecard-builder (portable, versioned)
└── My work/                       the Director's real operational files (OPS, Score Card 2026, …)
Outside the repo: Desktop/ROSTER + Desktop/new roster/ (month source files) ·
C:/Users/t.bassam/.claude/projects/C--Users-t-bassam-Desktop-WFM-System/memory/ (~95 notes + MEMORY.md index)
```

### 5.2 The `docs/master/` suite (rebuilt 2026-07-02)

| File | Contains |
|---|---|
| `MASTER_PROJECT_MEMORY.md` | The project brain: overview, what is LIVE, modules, roles, lessons, rebuild recipe |
| `WFM_BUSINESS_RULES_LIBRARY.md` | Every rule as BR-XXX-### with status + enforcing code path (indexes RULES, never forks it) |
| `MODULE_SPECIFICATIONS.md` | Per-module as-built spec + target spec |
| `DATA_DICTIONARY.md` | Every live table/column, provenance codes, verified against `information_schema` |
| `DASHBOARDS_AND_REPORTS.md` | Every dashboard/report: purpose, KPIs, endpoint, roles, defects (DEF-##), consolidation plan |
| `DECISIONS_AND_AGREEMENTS_LOG.md` | Chronological D-### register — **the canonical decision numbering** (Confirmed / Recommended / Needs Approval / Declined / Deferred) |
| `SYSTEM_LEARNINGS_AND_IMPROVEMENTS.md` | L-### learnings, R-### open risks, operating non-negotiables |
| `IMPLEMENTATION_ROADMAP.md` | Phase 0 (live) → hardening → target phases, dependency map, RSK-## risk register, UAT plan, go-live checklist |
| `AI_AND_AUTOMATION_OPPORTUNITIES.md` | Guard team as-built + automation catalogue + AI governing principles & boundaries |
| `REBUILD_PROMPT_AND_OPERATING_INSTRUCTIONS.md` | **This file** — restart prompt + behavior covenant + memory protocol |

### 5.3 Which file is CANONICAL for what (one master per fact)

| Fact class | Canonical file | Everything else must… |
|---|---|---|
| Business rule / decision TEXT | `docs/knowledge/WFM_RULES_AND_DECISIONS.md` | cross-reference "RULES §n" — never restate divergently |
| Rule → code-path index | `docs/master/WFM_BUSINESS_RULES_LIBRARY.md` | cite BR IDs |
| Roster refresh procedure | `docs/RECON_PIPELINE.md` | link to it |
| Engine + endpoints + report shapes | `docs/knowledge/REPORTS_AND_ROSTER_ENGINE.md` | link to it |
| DB schema (tables/columns) | `docs/master/DATA_DICTIONARY.md` (+ `database/migrations/`) | link |
| UI/theming standards | `docs/knowledge/DESIGN_SYSTEM.md` | link |
| Module behavior & scope | `docs/master/MODULE_SPECIFICATIONS.md` + `CLAUDE.md` §6–33 | link |
| Dashboard / report catalogue | `docs/master/DASHBOARDS_AND_REPORTS.md` | cite DASH-## / RPT-## |
| Phasing, risks, UAT, go-live | `docs/master/IMPLEMENTATION_ROADMAP.md` | cite H-## / P2-## / P3-## / RSK-## |
| AI/automation boundaries & guard catalogue | `docs/master/AI_AND_AUTOMATION_OPPORTUNITIES.md` | cite D-AI-### / AI-## / B-AI-## |
| Decision history | `docs/master/DECISIONS_AND_AGREEMENTS_LOG.md` | cite D-### (the ONLY D-### numbering) |
| Session-to-session working memory | `memory/MEMORY.md` + topic notes | keep the index line per note |
| Portable teach-another-agent knowledge | `.claude/skills/{wfm-system,mini-me,scorecard-builder}` | keep in sync with the docs above |

---

## 6. HOW THE AI MUST BEHAVE (the operating covenant)

Numbered OP-### so reviews can cite them. All Confirmed — these were dictated by or agreed with the
Director, most after a real incident.

| ID | Behavior |
|---|---|
| OP-01 | **Language:** the Director works in **Arabic (Levantine)**. Reply in his language; keep shift codes, identifiers, SQL, file paths, and code in English exactly as-is. English UI mode must be 100% English, but inputs must always accept typed Arabic. |
| OP-02 | **Plan first, code after approval.** Every session: inspect → audit → plan → WAIT for explicit approval → implement. Never start coding immediately. Work module-by-module in small reviewable steps (large multi-module edits broke the app before). |
| OP-03 | **"Review" means a DEEP correctness & data-integrity audit** — not "does it render". Check: (1) does every user-facing number read the CANONICAL source (`roster_days`), (2) are the agreed rules applied consistently everywhere, (3) verify against REAL data (query the DB / call the endpoint) — never assume. False positives waste trust as much as misses. He trusts verified conclusions, not "it works". |
| OP-04 | **No new or changed rule is EXECUTED before agreement.** Propose → the Director approves → then implement. Never dress a recommendation as an agreed rule; tag everything Confirmed vs Recommended. |
| OP-05 | **Everything built must be committed & persisted** — git commit, plus the knowledge trail: rules doc, docs/master suite, memory note, skill reference (§10 routing table). A decision that lives only in chat is considered lost. |
| OP-06 | **Dry-run + diff before ANY data promote.** Retarget imports to a scratch table (`ROSTER_OUT_TABLE=… SCHED_PATH=…`), diff vs live on anchor employees + the OT envelope, then promote. A prior refresh REGRESSED and was only caught by the diff. After `import-roster-master.js` always run `backfill-identity.js`. |
| OP-07 | **Backup before ingest.** `roster_days_recon_bak` auto-refreshes per run (`node scripts/recon-ingest.js --restore` = undo); for manual surgery, `CREATE TABLE roster_days_bak_YYYYMMDD AS SELECT * FROM roster_days` first. A partial upload may only ever replace its own date range (RULES §20). |
| OP-08 | **Rules live IN the engine.** Any rule applied as a one-off SQL/report patch WILL be wiped by the next rebuild. If it matters, it goes into `recon-build.js` / `recon-config.json` so every refresh re-applies it. |
| OP-09 | **Report failures honestly.** Surface coverage gaps, broken data, regressions, and inconvenient findings plainly — never fake completion, never call a phase complete unless the code exists and the build passes, never hide mock data (visible DEMO badge or connect the real API). |
| OP-10 | **Verify before asserting.** Build (`npm run build`), boot, and smoke the real endpoints (`gen-test-token.js` + `smoke-get.js`, the smoke-test guard, `/diagnostics`). Beware: the `:3000` process may be the abandoned "Enterprise Lab" copy — confirm which backend is live; use `APP_PORT=3001` for test boots. |
| OP-11 | **Honor the environment gotchas:** never `npm audit fix --force` (downgrades NestJS); install with `--legacy-peer-deps`; dotted-username short TEMP breaks npm/electron (set `$env:TEMP` long form); never `toISOString()` for local dates; TypeORM raw-query tuple/flat quirks (RULES §15). |
| OP-12 | **Never restart the project.** Continue from the latest approved state; real workbook/Timing data is the source of truth over any early assumption; match employees by ID, never name. |
| OP-13 | **Design discipline:** verify every new page in Light + Aurora-Glass; new near-black inline backgrounds must join the light-mode net allow-list or reuse a covered hex; **NO animated background — ever** (the Director removed it). |
| OP-14 | **Security from day one:** every table `tenant_id`, every endpoint auth-guarded, append-only audit log, secrets in env/config never in chat. |

---

## 7. WHAT MUST NEVER CHANGE WITHOUT THE DIRECTOR'S APPROVAL

1. **The rules library** — anything in `docs/knowledge/WFM_RULES_AND_DECISIONS.md` and its BR-###
   index. Changing a rule = a Director decision, then update doc → engine → code → memory, in that order.
2. **Engine semantics** — `recon-build.js` / `recon-ingest.js` behavior (holiday-OT, hr_code mapping,
   worked_min clamp, cross-midnight start-day ownership, tardiness 7..240, WFH detection, bleed guards,
   date-range-scoped delete). These produce the numbers HR acts on; a silent change is a payroll incident.
3. **RBAC and the access model** — admin=all; RTA+TL=admin-minus-settings; agent=own data (`/me`);
   permission gates on endpoints; append-only `audit_logs`.
4. **The canonical data map** — `roster_days` as spine; the roster_days/roster_daily separation;
   refresh only via the recon pipeline.
5. **Schedule publish safety** — a published schedule is never overwritten by Generate; publish stays
   atomic + reversible; manual edits keep versioning/audit/before-after impact.
6. **Number-changing open drifts** (RULES §16) — the shift-category unification (6 conflicting code
   sites per the 2026-07-01 audit), sc-CTE person-grain fix, legacy `roster_daily` re-ingest: fix ONLY
   with the Director's eyes on it, with full re-validation, because grouped report numbers will move.
7. **Design vetoes** — no animated background; the 3-theme system stays.

---

## 8. HOW TO READ THE FILES (reading order for any new session)

1. `docs/master/MASTER_PROJECT_MEMORY.md` — orient: what the platform is and what is live.
2. `docs/knowledge/WFM_RULES_AND_DECISIONS.md` — the rules (§1–20). Doc wins over code.
3. `docs/master/WFM_BUSINESS_RULES_LIBRARY.md` — the same rules with IDs + enforcing code paths.
4. **The module spec of the area you are touching**: `docs/master/MODULE_SPECIFICATIONS.md`
   (+ `DATA_DICTIONARY.md` for tables, `REPORTS_AND_ROSTER_ENGINE.md` for roster/reports,
   `RECON_PIPELINE.md` for any refresh, `DESIGN_SYSTEM.md` for any UI).
5. **The memory index** `memory/MEMORY.md` → open the task-relevant topic notes (they carry the
   incident details and gotchas the docs summarize).
6. When history/why matters: `DECISIONS_AND_AGREEMENTS_LOG.md` (D-###) and
   `SYSTEM_LEARNINGS_AND_IMPROVEMENTS.md` (L-###/R-###).

Rule of thumb: **MASTER_PROJECT_MEMORY → RULES → module spec of the area → memory index.** Never act
on an area whose module spec and rules sections you have not read.

---

## 9. HOW TO CONTINUE DEVELOPMENT

1. **Verify the system runs.** `cd backend && npm run build` → `node dist/main.js` (or confirm the
   already-running process is the right one); frontend `npm run build` / dev server; login; run the
   smoke-test guard / `/diagnostics`. Fix build/runtime breakage before features (CLAUDE.md §4).
2. **Read the latest audit + open items.** As of 2026-07-02 the queue is:
   - **Needs Approval (D-068 — awaiting the Director's go):** the 2026-07-01 consolidation plan — merge ~40
     standalone pages into the proven hub pattern (`HubTabs` + `?tab=`), sidebar ~35 → ~10-12 entries
     (memory `audit_2026_07_01_and_consolidation`; batch-1 data bugs already fixed, commit `b6bfcf4`).
   - **Number-changing drifts (careful, post-approval):** shift-category unification to the ONE
     canonical mapping (RULES §3); sc-CTE person-grain aggregation; legacy `roster_daily` re-ingest;
     dead-code removal (`Nx*`+`sevColor`, orphan `common/wfm-calc.ts`).
   - **Data follow-ups:** full June rebuild once the Director re-shares the PREPARED source files
     (RULES §20 gotcha — raw `Desktop/ROSTER/` exports do NOT feed the engine); Jan–May "Rule B"
     cross-midnight backfill via per-month recon rebuilds.
   - **Roadmap remainder:** CLAUDE.md §33 stages (production deployment, notifications channels,
     integrations beyond the bridges, PDF export…).
3. **Pick ONE item**, read its module spec + memory notes, plan, get approval, implement, verify
   (OP-02/OP-03/OP-10), then persist per §10.
4. **Data refreshes** are never development: follow `docs/RECON_PIPELINE.md` (or the in-system
   Upload & Rebuild), with OP-06/OP-07 always.

---

## 10. MEMORY UPDATE PROTOCOL (after EVERY decision or built change)

The Non-Negotiable Memory Rule: **a decision that is not written into the knowledge chain does not
exist.** After each agreed decision / shipped change, route the knowledge as follows — one master per
fact, pointers everywhere else:

| What happened | Update (in this order) |
|---|---|
| **New / changed BUSINESS RULE** (agreed by the Director) | 1. `docs/knowledge/WFM_RULES_AND_DECISIONS.md` (the text — add/amend the § with the date) → 2. `docs/master/WFM_BUSINESS_RULES_LIBRARY.md` (BR-### row + enforcing code path) → 3. the ENGINE if data-affecting (`recon-build.js`/`recon-config.json`, per OP-08) → 4. `DECISIONS_AND_AGREEMENTS_LOG.md` (D-###) → 5. memory topic note + `MEMORY.md` index line → 6. skill reference (`wfm-system`/`mini-me` business-rules / rules-confirmed) |
| **Decision that is NOT a rule** (scope, priority, decline, deferral) | `DECISIONS_AND_AGREEMENTS_LOG.md` (D-### with status Confirmed/Declined/Deferred) → memory note if it will matter across sessions |
| **New module / endpoint / page shipped** | `docs/master/MODULE_SPECIFICATIONS.md` (as-built section) → `CLAUDE.md` only if the module list itself changes → memory note → skill `modules.md` if durable |
| **Schema change** (new migration) | `database/migrations/NNN_*.sql` (the change itself) → `docs/master/DATA_DICTIONARY.md` (columns + provenance) → RULES §11 if the tables-map changes |
| **Incident / regression / hard-won gotcha** | `SYSTEM_LEARNINGS_AND_IMPROVEMENTS.md` (L-### + §7 non-negotiables if it must survive rebuild) → RULES §16/§19/§20 if it produced a rule → memory note (this is what memory notes exist for) |
| **Engine/pipeline procedure change** | `docs/RECON_PIPELINE.md` (runbook) → `REPORTS_AND_ROSTER_ENGINE.md` if report semantics moved → memory `new_roster_recon_engine` note |
| **Design/theme decision** | `docs/knowledge/DESIGN_SYSTEM.md` → memory `design_system*` notes → skill `design-system.md` |
| **Scorecard method change** | `mini-me`/`scorecard-builder` skill references (scorecard-method/bands/file-map) → RULES §9 → memory scorecard notes |
| **How-to-work-with-the-Director feedback** | memory feedback note (`feedback_rules` / a new `feedback_*`) → §6 of THIS file if it is a standing behavior |

**Always finish with:** git commit (descriptive message, per project convention), and confirm to the
Director what was persisted and where. If a memory note supersedes an old one, mark the old index
line `[stale — superseded]` rather than deleting history.

---

## 11. HOW TO AUDIT FUTURE CHANGES

The proven pattern (used for the 2026-06-24 six-dimension audit and the 2026-07-01 37-finding A-to-Z):

1. **Scope by dimension**, not by file: data-correctness · rule-consistency (every rule vs every code
   site) · canonical-source usage (`roster_days` everywhere user-facing) · IA/scatter · security/RBAC ·
   design/theme.
2. **Adversarial + verify-each-finding:** every candidate finding must be verified against the live DB
   or a live endpoint before it is reported (OP-03). Report Confirmed findings ranked by severity;
   discard what cannot be reproduced.
3. **Classify before fixing:** safe-fix (no numbers move) vs **number-changing** (needs the Director's
   explicit go + full re-validation + before/after diff) vs structural (plan, don't patch).
4. **Fix batch → re-verify → commit → persist** per §10. Never bundle number-changing fixes with
   cosmetic ones in a single commit.
5. **Regression net:** after any engine or report change, re-run the comparison harness
   (`recon-compare-manual.js` / dry-run diff on anchor employees + OT envelope) and the smoke-test
   guard before declaring done.

---

*End of file. If you are reading this as your first contact with the project: go back to §1, paste
the prompt, and follow it exactly.*
