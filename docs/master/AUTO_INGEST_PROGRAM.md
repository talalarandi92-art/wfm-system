# AUTO-INGEST — session-riding bridges replace manual Excel uploads (no API key)

> **Director 2026-07-11: make Sprinklr + Odoo flow AUTO into the roster/scorecard — login/logout,
> permission, compo, fingerprint, survey — no more manual file uploads. Path = the existing
> session-riding Chrome extensions (no API key), NOT a server pull.** Audit done 2026-07-11.

## Audit headline (the good news)
The **Sprinklr extension ALREADY intercepts `reportingQuery`** — `injected.js` hooks fetch/XHR/WS
(:77-149), duck-types `reportingData→'reportingQuery'` (:41), and content.js harvests
`opName===reportingQuery|queries` (:371-389). So the plumbing to capture login/logout + survey +
agent-perf EXISTS; the gap is a PARSER that recognizes those report ROW tables and forwards them,
plus a staging table + push endpoint. The **Odoo extension** rides the supervisor session generically
(captures whatever model is opened) and stages to `odoo_staging` (m069); its request mapper exists
but has **no hr.attendance check-in/out extraction** and **no emitter** to the recon fingerprint/permission shapes.

**Single-session (SPRINKLR_LIVE_REPORTING_FINDINGS §12):** all Sprinklr capture MUST ride the Director's
open browser — the extension does this with NO conflict (reads from inside his tab). No headless
fallback without key+X-PARTNER-ID.

## The seam
Recon reads 4 XLSX from a folder (recon-new-roster.js): `Odoo Fingerprint`, `Permission & Compo`,
`Ameyo login/logout`, `Login and Logout sprinklr`. GOAL = live captured data PRODUCES those 4 shapes.
Lowest-risk = **emitter scripts** that read the staging tables and write the same shapes (engine
untouched, files stay auditable) — wired before recon-new-roster in recon-refresh.js.

## Waves (SR=session-riding capture · BE=backend · DIR=needs Director's live session to verify)
- **A0 — reportingQuery report-row parser → staging** (SR+BE, DIR). Extend Sprinklr injected/content to
  harvest login/logout + survey + agent-perf ROW tables (not just M_* scalars) → `POST /integrations/
  sprinklr/report-push` → `sprinklr_report_staging(report_type, agent_email, day, payload jsonb)`.
  Director decision: which reporting tab/widget = authoritative login/logout (USER_AVAILABILITY_SLA_REPORT_V2).
- **A1 — promote Sprinklr login/logout → recon** (BE). Emitter reads A0 staging → `Login and Logout
  sprinklr.xlsx` shape (or a staging-read branch). Interim: derive from agent_status_events (approximate —
  prefer A0 real rows). Wire into recon-refresh before recon-new-roster.
- **A2 — Odoo hr.attendance + permission/comp → recon** (SR+BE, DIR). Add hr.attendance check-in/out
  mapper (absent today) + emitters → `Odoo Fingerprint` + `Permission & Compo` shapes. Director: confirm
  which Odoo model holds biometric punches (hr.attendance vs Studio x_ model) + supervisor opens those views.
- **A3 — 0-queue bridge repair** (SR). Harden queue capture (entityFeedStats guard, DOM/cache merge) so
  live queues never collapse to 0.
- **A4 — bridge-health / auto-ingest status surface** (BE+UI). Per-source freshness, staged-row counts,
  promotion status, "capture proven" badges.

## Standing decisions for the Director
1. Authoritative login/logout report/widget name (A0).
2. Accept status-poll-derived sessions as interim (A1) or wait for A0 real rows.
3. Which Odoo model = biometric punches; will the supervisor open hr.attendance + permission views
   routinely (or a scheduled capture pass)? (A2)
4. Per-source staleness SLA (A4).

Extensions all under repo: `chrome-extension/` (Sprinklr v1.5.0, already intercepts reportingQuery),
`chrome-extension-odoo/` (v0.1.0, session-riding), `chrome-extension-ameyo/` (v0.3.0, discovery-stage).
Capture is proven ONLY with the Director's live session (extension rides it — no single-session conflict).
