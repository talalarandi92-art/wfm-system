# WFM AI SKILLS ROUTER

## Purpose
This file tells Claude Code / AI assistant which specialized skill pack to use depending on the WFM project phase or task type.

The WFM system must not be handled as one generic coding task.  
Before every task, the assistant must identify the task category and apply the right skill pack.

---

## Core Rule

Before starting any task, answer:

1. What phase is this task related to?
2. Which module is affected?
3. Which skill pack applies?
4. Is this planning, database, backend, frontend, Excel import, scheduling, attendance, capacity, RTA, scorecard, outage, security, QA, or DevOps?
5. Are there conflicts with existing instructions?

---

# Skill Packs

## Skill 01 — WFM Product & Business Analyst
Use for:
- Requirements
- PRD/BRD
- User stories
- Business workflows
- MVP vs future scope
- Change requests

Use in phases:
- Planning
- Requirements
- Roadmap
- Workflow design

Focus:
- Contact center reality
- WFM best practices
- Clear business rules
- Avoid generic software assumptions

---

## Skill 02 — WFM Database Architect
Use for:
- Database schema
- ERD
- Migrations
- Tables/relationships
- Indexes
- Constraints
- Audit/attachments/approval tables
- Schedule/attendance/shift-rate/capacity models

Use in phases:
- Database
- Real workbook import
- Schedule
- Attendance
- Scorecard
- Outage
- Technical issue
- Capacity

Focus:
- PostgreSQL best practices
- Normalization
- Auditability
- Performance
- Scalability
- Safe migrations

---

## Skill 03 — Backend NestJS Architect
Use for:
- Backend modules
- APIs
- DTOs
- Controllers/services
- Auth/RBAC
- Audit logging
- File upload
- Background jobs
- Queues
- Integrations

Use in phases:
- Backend foundation
- Import parser
- Attendance APIs
- Requests/approvals
- Schedule APIs
- Outage APIs
- Scorecard APIs
- Notifications

Focus:
- Production-ready NestJS
- Clean modules
- Secure APIs
- Transactions
- Error handling
- Testability

---

## Skill 04 — Frontend React Enterprise UI
Use for:
- React pages
- Dashboards
- Role-based layouts
- RTL/LTR
- Arabic/English
- Forms/tables/charts
- Dynamic UI
- Enterprise UX

Use in phases:
- Frontend foundation
- Agent page
- Admin dashboard
- Schedule grid
- RTA command center
- Scorecard
- Outage dashboard
- Technical issue pages

Focus:
- Clean enterprise UI
- Accessibility
- Responsive design
- Real API connection
- No fake completion

---

## Skill 05 — Excel / Workbook Import Specialist
Use for:
- Real workbook parser
- Timing sheet
- Shifts sheet
- Monthly matrix sheets
- HC sheets
- Import preview
- Row validation
- Employee ID mapping
- Split shifts
- Cross-midnight shifts

Use in phases:
- Real workbook import/parser
- Attendance import
- Historical schedule import
- Shift-code dictionary import

Focus:
- Data accuracy
- Preview before commit
- Row-level errors
- Raw row storage
- No silent assumptions

---

## Skill 06 — Scheduling & Auto Generator Specialist
Use for:
- Schedule grid
- Auto schedule generator
- Shift validation
- Fairness
- Rotation
- OFF distribution
- Rest calculation
- Shift-rate before/after
- Manual override

Use in phases:
- Schedule management
- Auto generator
- Rotation
- Shift-rate
- Publish lock

Focus:
- Coverage first
- Fairness
- 10h rest rule
- Female shift rule
- Cross-midnight
- Split shift
- Published schedules must not be overwritten

---

## Skill 07 — Attendance & Adherence Specialist
Use for:
- Late in
- Early out
- Punch vs system
- Missing punch/system
- OT
- Agent attendance page
- Admin attendance dashboard
- Adherence engine

Use in phases:
- Attendance
- Agent page
- Admin metrics
- RTA monitoring
- Adherence

Focus:
- Real imported data
- Daily/weekly/monthly/YTD
- Approved vs unapproved exceptions
- Punch vs system separation
- Accurate durations

---

## Skill 08 — Capacity Planning / Erlang Specialist
Use for:
- Erlang-C
- Required HC
- Forecasting
- Required vs scheduled vs actual
- Chat/WhatsApp concurrency
- Email backlog model
- Shrinkage scenarios
- OT scenarios

Use in phases:
- Capacity planning
- HC planning
- Forecasting
- Shrinkage
- Scenario planning

Focus:
- Voice = Erlang C
- Chat/WhatsApp concurrency = 4
- Email = backlog/throughput
- Intern productivity factor
- Scenario comparison

---

## Skill 09 — RTA / Live Operations Specialist
Use for:
- RTA command center
- Live dashboard
- Intraday monitoring
- Real-time staffing gap
- Permission impact
- Queue status
- Outage impact
- Adherence alerts

Use in phases:
- RTA command center
- Live monitoring
- Permission HC
- Intraday management
- Outage impact

Focus:
- Interval-based HC
- Required/Scheduled/Actual/Available
- Alerts
- SLA risk
- Real-time decisions

---

## Skill 10 — Scorecard & Coaching Specialist
Use for:
- Scorecard formulas
- KPI weights
- Ranking
- Wallboard
- Coaching-needed flag
- Performance trends
- Agent/TL views
- Coaching workflow

Use in phases:
- Scorecard
- Coaching
- Performance dashboard

Focus:
- Daily/weekly/monthly
- Agent/function/TL levels
- KPI target comparison
- Below-bar highlighting
- Improvement vs previous period

---

## Skill 11 — Outage & Technical Issue Workflow Specialist
Use for:
- Outage module
- Technical issue workflow
- SLA tracking
- CX issue detection
- Escalation to IT
- Attachments
- Validation by RTA
- Outage reports
- CRM/SKU defect reporting

Use in phases:
- Outage management
- Technical issue workflow
- Exceptions tracker
- CRM/SKU defect reporting

Focus:
- Validated workflow
- SLA
- Impact
- Repeated issue flag
- Attachments
- Audit trail

---

## Skill 12 — Security, Scalability & IP Protection Architect
Use for:
- 1,000 concurrent users
- Security architecture
- RBAC/permissions
- Rate limiting
- Queues
- Caching
- Background jobs
- Load testing
- Repo/IP protection
- Secure deployment

Use in all phases, especially:
- Auth/RBAC
- Imports/exports
- Reports
- File upload
- Admin functions
- Production readiness

Focus:
- Enterprise security
- OWASP
- Async heavy jobs
- Private repo
- 2FA
- Secrets management
- Audit
- No sensitive logic only in frontend

---

## Skill 13 — QA / Testing / Code Review Specialist
Use for:
- Code review
- Build failures
- Tests
- Regression
- Performance testing
- Security testing
- Acceptance criteria

Use in every phase before marking complete.

Focus:
- Build passes
- Tests pass
- No broken imports
- No hidden mock data
- No security holes
- No performance issues

---

## Skill 14 — DevOps / Deployment Specialist
Use for:
- Docker
- Docker Compose
- CI/CD
- Environment variables
- Staging/production
- DB migrations
- Redis/Postgres setup
- Backups
- Monitoring/logging

Use in phases:
- Foundation
- Security/scalability
- Production readiness
- Deployment

Focus:
- Secure env vars
- Private repo
- HTTPS
- DB not public
- Backups
- Health checks
- CI build

---

# Phase-To-Skill Mapping

| Phase | Main Skills |
|---|---|
| Planning / PRD | Skill 01 |
| Database / ERD | Skill 02 + Skill 12 |
| Backend Foundation | Skill 03 + Skill 12 + Skill 13 |
| Frontend Foundation | Skill 04 + Skill 13 |
| User Management | Skill 03 + Skill 04 + Skill 12 |
| Real Workbook Import | Skill 05 + Skill 02 + Skill 03 + Skill 13 |
| Attendance Metrics | Skill 07 + Skill 03 + Skill 04 |
| Schedule Management | Skill 06 + Skill 02 + Skill 03 + Skill 04 |
| Auto Generator | Skill 06 + Skill 08 + Skill 13 |
| Shift Rate / Rotation | Skill 06 + Skill 07 |
| Permission HC Impact | Skill 09 + Skill 08 + Skill 03 + Skill 04 |
| Capacity / Erlang | Skill 08 + Skill 02 + Skill 04 |
| RTA Live Monitoring | Skill 09 + Skill 03 + Skill 04 |
| Outage / Technical Issue | Skill 11 + Skill 03 + Skill 04 |
| Scorecard / Coaching | Skill 10 + Skill 03 + Skill 04 |
| Chat / Notifications | Skill 03 + Skill 04 + Skill 12 |
| Security / Scalability | Skill 12 + Skill 13 + Skill 14 |
| Deployment | Skill 14 + Skill 12 + Skill 13 |

---

# Required Behavior

For every task, respond with:

1. Selected skill pack(s)
2. Why these skills apply
3. Files to inspect
4. Files to create/update
5. Risks
6. Implementation plan
7. Test plan
8. Expected output

Do not code before this analysis unless the user explicitly says to skip planning.

---

# Anti-Pattern Rules

Do not:
- Treat this as a simple CRUD app.
- Build UI before confirming data structure.
- Use mock data without labeling it.
- Skip build/tests.
- Put sensitive logic only in frontend.
- Ignore real workbook format.
- Hardcode only the first 8 shift codes.
- Overwrite published schedules.
- Ignore 1,000 concurrent user requirement.
- Ignore cybersecurity/IP protection.
- Mix too many unrelated modules in one unsafe edit.