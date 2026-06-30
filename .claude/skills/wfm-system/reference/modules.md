# Modules built (what exists)

## Core WFM
- **Auth / RBAC / Users / Employees / Org** (functions/teams/roles). Manual + pending + self-register
  approval + Excel/CSV bulk import (preview→validate→commit) + temp passwords. Employee merge tool
  (duplicate detect/merge, migration 005).
- **Schedule generator** (`/schedule-generator`): fairness/rotation-based weekly generation; female &
  function shift policies; rest/OFF rules; shift-rate before/after (`/shift-rate`). Active path =
  `generateWeeklySchedule`. Demand-driven variant exists but unused.
- **Roster** + **deep roster dashboard** (`RosterDashboard.tsx`): per-function/shift/late/early-out/
  permission/absence detail, employee search + performance profile, half-hourly headcount by function
  (scheduled vs present vs shrinkage vs OT count), 5h+ OT bonus report, OT before/after the shift.
- **Attendance-recon / OT engine** (`attendance-recon`): combine-both-systems model, bleed guards,
  split-shift/Ramadan/maternity handling, forgotten-OT report, colored OT_Review workbook. See data-sources.

## Planning & live
- **Capacity** (Erlang-C voice; concurrency=4 chat/WA; email backlog; intern 70%; scenarios).
- **Coverage**: hourly per-function Required/Scheduled/Available/Gap (`/coverage/hourly`), one-click
  "cover gap", predictive coverage forecast.
- **Workforce Analytics**: shift/shrinkage/coverage/fairness/sick analytics; weekend-OFF share;
  shrinkage weekly/monthly trend; skill-expiry alerts; break data in shift breakdown.
- **RTA / control dashboards**: role dashboards (Exec/WFM/TL/Agent) over a `/control-dashboard` KPI bundle.

## Requests & workflow
- **Requests** (envelope + extension tables): permission, sick/annual/death/comp leave, shift swap,
  OFF swap, OT, **break** (manual type), **Appointments & Exams** (image/PDF upload), emergency leave,
  attendance correction (apply-to-attendance on approve). Shift/OFF swap = peer-accept → TL/WFM approve →
  **auto-applies to schedule** on final approval. SLA escalation background loop (migration 027) auto-
  escalates overdue → notifies WFM/RTA/Ops. Workflow + SLA reports with approval timeline.
- **Coaching engine** (migration 028): auto-flags repeated late/early-out/missing-punch → `/coaching`.
- **Campaign calendar** (migration 024): blackout/peak windows.
- **Outage** + **technical issue** workflows: SLA, RTA validation, email automation hook, CX-issue detection.

## Scorecard & knowledge
- **Scorecard**: per-month Excel matching the user's template — see the **`scorecard-builder`** skill for
  the full method (bands, rounding, sources, productivity, quiz commitment, maternity).
- **Knowledge Base**, **Chat** (internal comms), **Notifications**.

## The autonomous guard team (sidebar shows ONLY the Chief; guards run behind the scenes)
8 guards orchestrated by **The Chief** (`/chief`) into one executive posture + priorities:
1. **Health Guard** (`/health-guard`, `/system-health`) — front/back/data healthy + schedule obeys
   codified rules (11 checks).
2. **Analyst** (`/analyst`, migration 029) — assesses coverage/schedule/queues/compliance, recommends the
   best decision, learns from accept/reject.
3. **Reporter** (`/reports-bot`, migration 030) — auto daily reports + Excel.
4. **Advisor LLM** (`/advisor`) — narrates/answers/proposes improvements; native-fetch Anthropic +
   graceful fallback; activates via `ANTHROPIC_API_KEY`.
5. **Expert Advisor** (`/expert`) — WFM knowledge corpus (14 topics).
6. **Security Guard** (`/security-guard`) — continuous account/access/audit security monitoring (10 checks).
7. **Scorecard Guard** — builds/reviews real scorecard_entries → coaching flags.
8. **Researcher** — curated WFM gap feed (live gap detection).
- **Auto Mode** (migration 031): auto-approves safe-surplus requests by coverage, guarded/reversible,
  self-test. **DECLINED: self-modifying code.**
- **/bots** hub unifies the team. **/knowledge-ledger** (every knowledge item: what/benefit/source/date).
  **/team-learning** (what each guard learned + experiences exchanged, with real evidence counts).
- Every guard page has a back button; Auto Mode holds are transparent.

## Integrations
Ameyo bridge (`/integrations/ameyo`), Sprinklr bridge, Odoo (HR holidays/leave, completed). Future:
telephony deepening, CRM, Teams, push.

## Relief suite (automating the user's manual reports)
#1 Agent Productivity = DONE. Pending: refund report, incentive+voucher, incidents.
