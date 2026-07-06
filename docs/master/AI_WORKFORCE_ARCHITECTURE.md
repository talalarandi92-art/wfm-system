# AI WORKFORCE ARCHITECTURE — Enterprise AI Department for the Boutiqaat WFM Platform

> The Director's mandate: this is NOT a single AI assistant. Build a complete **Enterprise AI Workforce** —
> an AI department where each agent has a defined role, memory, permissions, workflow, and collaboration
> model, working together as one intelligent ecosystem. **Every important AI decision must be explainable
> and audit-logged — no black boxes.** Deferred until an `ANTHROPIC_API_KEY` is available (Phase 3), but
> the scaffold + the non-LLM agents can be built now. Companion: `AI_AND_AUTOMATION_OPPORTUNITIES.md`,
> `EXECUTION_BRIEF.md` §7.

## 0. Governing principles (apply to EVERY agent)
- **Explainable, never a black box.** Every material recommendation states its evidence (data + rule + `file:line`/endpoint) and is written to `audit_logs` / `agent_events`.
- **Verified data only** (D-070): every number from a real endpoint over real data; modeled values labelled; fake/counterfactual metrics are DECLINED.
- **Human-in-the-loop for regulated actions.** Schedule publish, approvals, and pay-affecting changes need a human sign-off (or a bounded, reversible, audited Auto-Mode within guardrails). No unsupervised generative scheduling.
- **Shared memory, one source of truth.** Every agent reads AND updates the Enterprise Knowledge Base (§3); never lose a rule, decision, or improvement.
- **Confirmed vs Recommended.** An agent proposing a new rule marks it Recommended; it never executes an unagreed business rule.

## 1. Per-agent contract (required for each of the 35)
Name · Purpose · Responsibilities · Inputs · Outputs · Permissions (RBAC) · Memory (what it persists) ·
Knowledge Sources · Tools/endpoints · Decision Logic · Automation Rules · Notifications · Error Handling ·
Audit Logs · KPIs · Collaboration (which agents it feeds / consumes) · Future scalability. Document each in
this file as it is built.

## 2. The 35 agents — mapped to the existing platform (13 EXISTS · 16 PARTIAL · 6 NEW)
Only **6 are genuinely new** — the rest EXTEND existing modules/guards on the `roster_days` / guard /
knowledge-ledger spine. Do NOT build from scratch.

| # | Agent | Status | Maps to (backend module) | # | Agent | Status | Maps to |
|---|-------|--------|--------------------------|---|-------|--------|---------|
| 1 | WFM Copilot | PARTIAL | advisor + expert (merge) | 19 | Order-Volume Analyzer | PARTIAL | operations-analytics / CPO forecast |
| 2 | Roster Planner | EXISTS | schedule-generator / recon | 20 | Workforce Simulator | **NEW** | capacity + generator |
| 3 | Schedule Optimizer | EXISTS | schedule-generator | 21 | Black-Friday Planner | PARTIAL | campaigns + capacity |
| 4 | Forecast Engine | PARTIAL | forecasting (AHT source dead) | 22 | Ramadan Planner | PARTIAL | recon + generator |
| 5 | Capacity Planner | EXISTS | capacity (Erlang) | 23 | Notification Manager | EXISTS | notifications |
| 6 | Live Coverage Guardian | PARTIAL | coverage + week-forecast | 24 | Report Generator | EXISTS | reporter |
| 7 | RTA Assistant | PARTIAL | rta + sprinklr | 25 | Executive Advisor | EXISTS | chief |
| 8 | Attendance Analyzer | EXISTS | attendance-recon | 26 | Dashboard Builder | EXISTS | builders + command-center |
| 9 | Overtime Analyzer | EXISTS | ot-exceptions | 27 | Data-Quality Auditor | PARTIAL | health-guard + recon DQ |
| 10 | Shrinkage Analyzer | EXISTS | workforce-analytics | 28 | Integration Manager | PARTIAL | integrations (Ameyo/Sprinklr/Odoo) |
| 11 | Request Manager | EXISTS | requests | 29 | Chrome-Extension Manager | PARTIAL | the bridge extensions |
| 12 | Approval Advisor | PARTIAL | automode + analyst | 30 | Knowledge Manager | EXISTS | knowledge-ledger |
| 13 | Scorecard Coach | EXISTS | scorecard-guard | 31 | Documentation Writer | **NEW** | docs-sync over the ledger |
| 14 | Quality Coach | PARTIAL | coaching + scorecard-guard | 32 | Testing Engineer | **NEW** | recon-build + page tests |
| 15 | Productivity Analyzer | PARTIAL | productivity | 33 | Security Auditor | EXISTS | security-guard |
| 16 | SLA Risk Predictor | PARTIAL | sla-escalation + analyst | 34 | Cost Optimizer | **NEW** | OT + shrinkage + gap |
| 17 | Root Cause Analyzer | PARTIAL | diagnostics + analyst | 35 | Training Planner | PARTIAL | skills |
| 18 | Contact-Reason Analyzer | **NEW** | ops_contacts | | | | |

Full per-agent responsibilities/inputs/outputs are the Director's spec (kept verbatim in the source
request); build each to its contract (§1) and record it here.

## 3. Shared memory — the Enterprise Knowledge Base (reuse, don't reinvent)
- **Curated knowledge** = `knowledge-ledger` (Expert corpus + Researcher catalogue + provenance) — the single KB every agent reads/updates.
- **Learned state** = `analyst_thresholds` / `analyst_recommendations` / `automode_decisions`.
- **Facts** = `roster_days` · `scorecard_monthly` · `ops_contacts` · `integration_snapshots` · `odoo_staging` · `attendance_excuses`.
- **Event bus (required upgrade)** = a new append-only **`agent_events`** table (`agent, event_type, subject_ref, payload, severity, created_at`) — the pub/sub backbone so 15→35 agents share knowledge without a hardcoded exchange graph. Every agent publishes its findings + subscribes to relevant events.
- The **6 books** (`docs/master/`) are the documentation memory; the Knowledge Manager + Documentation Writer keep them current (never outdated).

## 4. Collaboration model
Agents form a DAG, not a mesh: e.g. Forecast Engine → Capacity Planner → Roster Planner → Schedule Optimizer;
Attendance/Overtime/Shrinkage Analyzers → Root Cause Analyzer → Executive Advisor; Live Coverage Guardian +
SLA Risk Predictor → RTA Assistant → Notification Manager. Every agent writes to `agent_events`; downstream
agents consume. Avoid duplicated work (dedup by subject_ref). The Executive Advisor (Chief) synthesizes the
whole into an exec posture.

## 5. Build waves (Phase 3, after the LLM key + model-id fix)
- **W0 — Activate:** set `ANTHROPIC_API_KEY` + fix the wrong default `LLM_MODEL` (`llm.service.ts:14`); add `agent_events`; extract an `AgentRunner` base scaffold + a distributed lock. (Lights up ~40% of the "AI" surface.)
- **W1 — Expose the 13 EXISTS** (rename/surface) + merge Advisor/Expert into WFM Copilot.
- **W2 — Extend the PARTIALs** (Coverage/RTA/Request/Productivity/Skills/SLA/RootCause…).
- **W3 — Fix data pipelines** (forecast AHT, Odoo, generator consolidation) so the analytic agents have real inputs.
- **W4 — Build the 6 NEW** (Contact-Reason, Workforce-Simulator, Documentation-Writer, Testing-Engineer, Cost-Optimizer) on the stable spine; Testing Engineer last.

## 6. Final goal
The most advanced AI-powered Enterprise WFM platform possible. Do not stop at the listed 35 — continuously
discover and, when clearly valuable, DESIGN + document + implement additional specialized agents. Act as an
Enterprise AI Engineering Team. **Do not consider the program done until production is 100% working and
100% excellent** (per the EXECUTION_BRIEF Definition of Done), with every AI decision explainable and every
piece of business knowledge preserved in the shared memory.
