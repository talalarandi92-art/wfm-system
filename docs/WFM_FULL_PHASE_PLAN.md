# WFM FULL PHASE PLAN — UPDATED FROM ENTIRE CONVERSATION

## Purpose
This document updates the original phases based on everything discussed, added, modified, built, broken, and clarified during the WFM project conversation.

It includes:
- Original phases
- What was added later
- What was implemented
- What is partial
- What is still pending
- Recommended execution order

---

# Phase 0 — Setup & Planning

## Original Request
Read `WFM_Requirements_v1.0.md`.
Generate only:
1. Product scope summary
2. MVP scope
3. Technical assumptions
4. System architecture
5. Main modules
6. Development phases
7. Risks and dependencies
8. Recommended folder structure

Do not write application code yet.

## Completed
- Phase 0 planning completed.
- Scope defined.
- MVP defined.
- Architecture defined.
- Risks and dependencies defined.
- Folder structure defined.
- 22 main modules identified originally.
- 10-phase sequence originally created.

## Added Later
- Project expanded beyond first requirements.
- Full enterprise WFM scope added.
- Real workbook became source of truth.
- Project instructions and roadmap required.
- WFM must be comparable to NICE/Verint/Calabrio/Genesys WFM.
- Must not be generic CRUD.

## Remaining
- Keep updating instructions as the project evolves.
- Ensure Project Instructions reflect all latest rules.

---

# Phase 1 — Database + ERD

## Original Request
Generate:
1. PostgreSQL schema
2. Tables
3. Columns
4. Data types
5. Primary keys
6. Foreign keys
7. Indexes
8. Constraints
9. Audit log tables
10. Attachment tables
11. Approval workflow tables
12. ERD in Mermaid

## Completed
- Full schema around 45 tables / 18 domains.
- MVP schema around 33 tables.
- ERD created.
- Audit log model.
- Attachment model.
- Approval workflow model.
- Requests envelope + extension pattern.
- Headcount intervals.
- Technical tickets.
- Versioned schedule grid.
- Attendance capture.

## Important Design Decisions
- S/A suffix derived, not stored as mutated shift codes.
- Dynamic lists should be table-driven.
- SQL schema source of truth.
- TypeORM synchronize false.
- Audit log should be immutable.

## Added Later
- Need import batch tables.
- Need real workbook raw row storage.
- Need shift-code dictionary from Timing sheet.
- Need attendance metrics tables/views.
- Need shift-rate snapshot/history.
- Need capacity scenario tables.
- Need outage email automation hooks.
- Need chat/notification persistence.
- Need coaching/scorecard tables if not already complete.

## Remaining
- Verify actual schema vs current code.
- Add migrations for real import/parser if missing.
- Add missing tables for Stage 6-15 modules.

---

# Phase 2 — Backend Foundation

## Original Request
Build:
1. Backend folder structure
2. Environment variables
3. Authentication module
4. RBAC module
5. User management module
6. Employee management module
7. Function/team/role management
8. Database connection
9. Seed data
10. API error handling
11. Basic audit logging

Use production-ready code.

## Completed
- NestJS backend.
- Auth.
- RBAC.
- Users.
- Employees.
- Org.
- Database connection.
- Seeds.
- Error handling.
- Audit service/interceptor.
- Swagger.

## Added Later
- User import service.
- Pending user activation.
- Excel/CSV import.
- Temporary password.
- Employee metrics API.
- Capacity planning API.
- Schedule generator core logic partial.
- Parser script partial.

## Remaining
- Run real build/tests.
- Verify TypeORM entities match DB.
- Make audit log real across all modules.
- Make password hashing production-grade if not already.
- Add import module.
- Add attendance/adherence module.
- Add schedule module APIs.
- Add generator APIs.
- Add outage/technical/scorecard/coaching APIs.

---

# Phase 3 — Frontend Foundation

## Original Request
Build:
1. React + TypeScript structure
2. Routing
3. Login page
4. Role-based layouts
5. Agent dashboard
6. WFM dashboard
7. Admin dashboard
8. Sidebar navigation
9. Arabic/English RTL/LTR
10. Light/Dark mode
11. API client setup

Use clean enterprise dashboard design.

## Completed
- Vite React TypeScript.
- Login page.
- Routing.
- Role-based shell.
- Sidebar.
- Topbar.
- i18n AR/EN.
- RTL/LTR.
- Theme.
- API client.
- Token refresh.
- Dashboard shell.

## Added Later
- Dynamic UI visual prototype.
- Animated background.
- KPI cards.
- Live-like dashboard.
- Approvals demo.
- Real-time monitoring demo.
- User management UI.
- Employee metrics page.
- Capacity page.
- Scorecard prototype.
- Internal chat prototype.

## Remaining
- Replace demo data with real APIs.
- Improve UI dynamically without breaking functionality.
- Build real schedule grid.
- Build real RTA command center.
- Build real scorecard/coaching.
- Build real chat/notifications.
- Add attachment previews.

---

# Phase 3.5 — User Management

## Added During Conversation
Because the user asked how users will be created.

## Completed
- Self-registration with pending activation.
- Admin/HR user creation.
- Bulk Excel/CSV import.
- Preview validation.
- Commit only if valid.
- Temporary password generation.
- Pending users screen.
- Role assignment.

## Remaining
- Confirm final approvers: HR/Admin/WFM Supervisor.
- Add password reset flow.
- Add MFA/SSO future.
- Add user import template based on real roster.
- Add real employee import for 162 employees or actual employee count.

---

# Phase 4 — Schedule Management Module

## Original Request
Include:
1. Shift code recognition
2. Leave/attendance codes
3. Schedule grid
4. Weekly schedule view
5. Monthly schedule view
6. Manual cell editing
7. Schedule validation
8. Cross-midnight shifts
9. Schedule import from Excel
10. Schedule export to Excel
11. Schedule versioning

## Added Later
- Published schedules must lock from regeneration.
- Manual edits after publish allowed.
- Version history required.
- Timing sheet is official shift dictionary.
- Support split shifts.
- Support WFH variants.
- Support 20 responsible 8-hour shifts.
- Support Ramadan R shifts.
- Support Shift Rate before/after.
- Support female rule with N exception and no midnight.
- Support rest 10h.
- Support fairness metric.
- Support coverage gap alerts.
- Support real workbook parser.

## Current Status
Partial:
- Some schedule logic and generator core started.
- UI grid not fully real/connected.
- Import/export not fully production.

## Remaining
- Build real grid.
- Build import/export.
- Build versioning/publishing.
- Build validation display.
- Build manual edit modal.
- Build before/after HC and shift-rate impact.

---

# Phase 5 — Auto Schedule Generator

## Original Request
Build:
1. One-click weekly schedule
2. One-click monthly schedule
3. 9-hour shift rule including 1-hour break
4. Female max shift end time 20:00
5. Male night coverage 22:00 to 07:00
6. Main shift rules
7. OFF logic
8. Fairness

## Updated Final Rules
- Business coverage first.
- Female normally up to C / 20:00.
- Female may work N if necessary.
- Female must not work MD/MN.
- Male can work any shift.
- Manual override allowed with warning.
- Use real Timing sheet.
- Include 20 shifts as 8-hour responsible shifts.
- Include WFH.
- Include Ramadan and split shifts.
- Include rest.
- Include shift-rate distribution.
- Include coverage gaps.

## Current Status
Partial:
- Pure generator engine started.
- Gender rules and shift categories built.
- Fairness-aware logic built.
- Testing found male night pool constraint.
- Rest/off rotation fix started.

## Remaining
- Connect to DB and UI.
- Store generated schedule.
- Preview before publish.
- Show coverage gaps.
- Show fairness score.
- Show shift-rate before/after.
- Add monthly generation.
- Add real employee availability.
- Add cross-skill coverage.

---

# Phase 6 — Real Workbook Import / Parser

## Added Later
This became a critical phase after real workbook upload.

## Build
- Import batch
- Timing sheet parser
- Shifts sheet parser
- Monthly matrix parser
- HC sheet parser if needed
- Outage sheet parser if needed
- Row validation
- Preview
- Commit
- Raw row storage
- Error report
- Employee ID matching
- Shift dictionary upsert

## Current Status
Partial:
- Workbook was analyzed.
- Timing sheet understood.
- 146/282 shift codes mentioned in different contexts.
- Parser script may exist partially.
- Employee metrics logic built from real-shaped rows.

## Remaining
- Build production import flow.
- Connect parser to DB.
- Connect metrics to real imported data.
- Make import UI.
- Add validation summary.
- Add export error file.

---

# Phase 7 — Attendance + Agent/Admin Metrics

## Added Later
User requested:
- Agent page shows punch late count/duration
- System late count/duration
- Missing punch
- Missing system
- OT hours/count
- Daily/weekly/monthly
- Admin dashboard same

## Current Status
Partial:
- Pure logic built.
- Tests passed on representative rows.
- WFH/office split added.
- Agent page and admin metrics UI partially built.

## Remaining
- Connect to real imported data.
- Add filters.
- Add trend charts.
- Add export.
- Add adherence.

---

# Phase 8 — Adherence Engine

## Added Later / Gap Identified
Needed but not complete.

## Build
- Scheduled vs actual
- Punch vs schedule
- System login vs schedule
- Break adherence
- Permission exception
- Approved vs unapproved
- Adherence %
- Conformance %
- Agent/TL/RTA/WFM views

## Remaining
- Full backend + frontend.
- Real data connection.
- Alerting.

---

# Phase 9 — Permission HC Impact

## Added Later
User repeatedly emphasized coverage and permissions.

## Build
- Required HC
- Scheduled HC
- Permission HC
- Actual/Available HC
- Before approval
- After approval
- Impacted intervals
- Function impact
- Risk level
- Alternative suggestions

## Current Status
Mostly pending.

## Remaining
- Add to approval workflow.
- Add dashboard.
- Add interval matrix.
- Add warnings.

---

# Phase 10 — Erlang / Capacity Planning

## Added Later
User asked for full WFM and HC logic.

## Confirmed
- Voice uses Erlang C.
- Chat/WhatsApp concurrency = 4.
- Email uses backlog model.
- Intern productivity around 70%.
- Occupancy target around 80% in discussion.
- Multiple scenarios needed.

## Current Status
Partial:
- Pure capacity engine built.
- Erlang-C tested with reference.
- Frontend page built.
- Backend API started.

## Remaining
- Save scenarios.
- Import real volumes.
- Compare required vs scheduled.
- Add function/channel presets.
- Export capacity plan.
- Link to scheduling and HC dashboard.

---

# Phase 11 — RTA Command Center / Live Monitoring

## Required
- Live adherence
- Queue status
- Available agents
- Breaks
- Permissions
- Late logins
- Early outs
- SLA risk
- Gap by interval
- Outages
- Technical issues
- Alerts

## Current Status
Demo/prototype only.

## Remaining
- Real data.
- APIs.
- Live refresh.
- RTA actions.
- Alerts.

---

# Phase 12 — Shrinkage / Workforce Calendar / Intraday

## Required
- Planned/unplanned shrinkage
- Sick/leave/holiday/training/meeting/coaching
- Attrition if needed
- Workforce calendar
- Intraday plan vs actual
- Break planning
- Scenario planning

## Current Status
Mostly pending/demo.

---

# Phase 13 — Outage Management

## Required
- Outage dashboard
- Start/end/status
- Ongoing/resolved
- Escalated by agent
- Validated by RTA
- Duration
- Impacted intervals
- Available agents
- Function/channel
- Root cause
- Owner
- SLA
- Email automation future

## Current Status
Prototype/demo; email hook missing.

## Remaining
- Full DB/API/UI.
- Email automation.
- Before/during/after impact.
- Reports.

---

# Phase 14 — Technical Issue Workflow

## Required
- Customer case internal hold
- Reason Technical Issue
- Validation by RTA/team
- Escalation to IT
- Attach screenshots/videos
- SLA 48h
- CX issue flag after 20+ repeated reasons
- Track who validated/who escalated/who resolved

## Current Status
Mostly pending/prototype.

---

# Phase 15 — Exceptions / CRM / SKU Defective Reporting

## Required
- Exceptions tracker
- CRM integration future
- SKU defect reporting
- Repeated defective SKU dashboard
- Return/exchange/refund exception tracking

## Current Status
Pending.

---

# Phase 16 — Scorecard

## Required
- Daily/weekly/monthly
- Agent/function level
- TL/Agent view
- Wallboard ranking
- Coaching needed
- Improvements vs previous period
- KPI weights/targets
- Export

## Current Status
Prototype added in v3 HTML.
Needs real data/API.

---

# Phase 17 — Coaching

## Required
- Coaching from scorecard
- 1v1 feedback workflow
- Action plan
- Follow-up
- Employee view/acknowledgement optional
- History

## Current Status
Pending/prototype.

---

# Phase 18 — Cross-Skill Engine

## Required
- Skills matrix
- Cross-skill coverage
- Move employee to cover gap
- Skill expiry alert
- Training status
- Recommendation engine

## Current Status
Partial:
- Skills identified.
- Customer Care and NPS skills added later.
- Expiry alert missing.

---

# Phase 19 — Internal Chat / Communication

## Required
- Team channels
- WFM/RTA/outage/TL channels
- Direct messages
- Online status
- Unread count
- Outage auto-post
- Future Teams integration

## Current Status
Prototype added.
Needs persistence/API.

---

# Phase 20 — Notifications

## Required
- In-app notifications
- Email future
- Teams Adaptive Cards future
- Request alerts
- Schedule alerts
- Outage alerts
- SLA alerts
- Skill expiry alerts

## Current Status
Pending/partial.

---

# Phase 21 — Audit / Attachments / Compliance

## Required
- Real audit log across all sensitive actions
- Attachment upload
- Attachment preview
- Download
- Entity linking
- Old/new value
- Actor/time/action

## Current Status
Audit foundation exists.
Attachment preview missing.
Audit not fully applied everywhere.

---

# Phase 22 — Deployment / Production Readiness

## Required
- Cloud deployment
- Real database
- Environment configs
- Backups
- Monitoring
- Logs
- Security hardening
- Real password hashing
- MFA/SSO future
- UAT
- Employee import
- Production data migration

## Current Status
Pending.

---

# Recommended Immediate Next Order

1. Audit current repo and fix build/runtime issues.
2. Implement real workbook import/parser.
3. Connect employee/admin metrics to real data.
4. Implement real attendance/adherence engine.
5. Complete schedule grid + versioning + publish lock.
6. Complete auto schedule generator integration.
7. Add shift-rate before/after.
8. Add permission HC impact.
9. Complete Erlang/capacity with real scenarios.
10. Complete RTA command center.
11. Complete outage and technical issue workflows.
12. Complete scorecard/coaching real data.
13. Complete cross-skill alerts.
14. Complete chat/notifications persistence.
15. Production deployment.