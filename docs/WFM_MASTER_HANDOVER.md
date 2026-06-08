# WFM System — Master Handover & Roadmap

## 1. Executive Summary

This project is a custom Workforce Management platform for Boutiqaat Contact Center.  
It started as a planning and database design project, then expanded into a full operational platform covering scheduling, attendance, requests, live monitoring, scorecards, outage management, technical issues, employee dashboards, and future integrations.

The system is being built in phases:
- Planning and requirements
- PostgreSQL database and ERD
- Backend foundation
- Frontend foundation
- User management
- Schedule and shift logic
- Real attendance and employee metrics
- Operational modules
- Scorecard and productivity
- Advanced WFM analytics and integrations

The current project should **not be restarted**. Claude Code must continue from the latest approved state, preserve all decisions, and prioritize converting mock/demo areas into real connected modules.

---

## 2. What Has Been Completed

### Phase 0 — Setup & Planning
Completed:
- Product scope summary
- MVP scope
- Technical assumptions
- System architecture
- Main modules
- Development phases
- Risks and dependencies
- Recommended folder structure
- Monorepo direction
- Enterprise WFM platform vision

Key decision:
- `WFM_Requirements_v1.0.md` was initially treated as the source of truth.
- Later requirements from the conversation must override older versions.

---

### Phase 1 — Database + ERD
Completed:
- PostgreSQL database schema
- MVP migration
- Full ERD in Mermaid
- Audit log tables
- Attachment tables
- Approval workflow model
- RBAC and self-registration tables
- Employees, functions, teams, skills
- Shift and leave codes
- Configurable scheduling rules
- Leave balances
- Versioned schedule grid
- Attendance capture
- Request envelope + extension tables
- Headcount interval snapshot table
- Technical tickets
- Immutable audit log

Important design decisions:
- S/A suffix is derived from `shift_code_id + attendance_marker`, not stored as a mutated code.
- Requests use a base `requests` envelope with extension tables per request type.
- Attachments and audit logs are polymorphic using `entity_type + entity_id`.
- Dynamic business lists should be tables, not hardcoded enums.
- `headcount_intervals` is a derived snapshot table for live Hour × Function visibility.

---

### Phase 2 — Backend Foundation
Completed:
- NestJS backend
- PostgreSQL / TypeORM
- Modular monolith structure
- Environment variable config
- Authentication module
- JWT access token + refresh token
- RBAC module
- User management
- Employee management
- Function/team/role management
- Database connection
- Seed data
- API error handling
- Audit logging
- Swagger/OpenAPI docs

Important caveat:
- Some delivered code was stated as not fully compiled against installed `node_modules`; Claude Code must run `npm install`, `npm run build`, tests, and fix any actual type/runtime issues.

---

### Phase 3 — Frontend Foundation
Completed:
- React + TypeScript + Vite frontend
- Routing
- Login page
- Role-based layouts
- Agent/WFM/Admin dashboards
- Sidebar navigation
- Arabic/English RTL/LTR support
- Light/Dark mode
- API client with token handling
- Session refresh logic
- App shell with dynamic design direction

Important caveat:
- Some dashboard numbers are still demo/mock until real API modules are completed.

---

### Visual Design / Dynamic Sample
Completed:
- HTML visual sample
- Dynamic animated sample
- Glass-style cards
- Live-feel dashboard
- Approvals screen demo
- Real-time monitoring demo
- Arabic/English and dark/light design direction

Status:
- Approved as a **visual direction only**.
- Must be converted into real React components connected to backend APIs.

---

### User Management Extension
Completed:
- Manual user creation
- Role assignment
- Pending activation list
- Self-registration approval flow
- Bulk Excel/CSV import
- Preview/validation before commit
- Row-level validation errors
- Temporary password generation
- Backend + frontend user management screens

Default:
- HR/Admin can manage users unless later changed.

---

### Real Data Analysis From Schedule Workbook
Completed analysis:
- The real schedule workbook contains monthly sheets, HC sheets, Shifts, Outages, and Timing.
- The system must use the real `Timing` sheet as the official shift-code dictionary.
- Around 146 shift codes were extracted from the real timing data.
- Real shift logic is more complex than the first requirements.

Real shift code rules discovered:
- `20` shift codes = 8-hour responsible/supervisor shifts.
- `9` or no suffix = normal 9-hour agent shifts.
- `R` = Ramadan shifts.
- Some Ramadan shifts are split shifts.
- `WFH`, `WFH-M`, `WFH-B`, `WFH-N`, `WFHM`, `WFHN` = work from home variants.
- `S` suffix = sick leave submitted.
- `A` suffix = absence.
- `OFF`, `H`, `L`, `SL`, `DL`, `RES`, `TER`, `COMP`, `UPL`, `COV` must be supported.
- Cross-midnight and split shifts must be supported.

---

### Employee Metrics / Agent Page
Partially completed:
- Logic was built for:
  - Punch late count
  - Punch late duration
  - System late count
  - System late duration
  - Missing punch count
  - Missing system login count
  - Overtime hours
  - Overtime count
  - Early out
  - Working days
  - Daily / weekly / monthly aggregation
- Employee page route was planned/added.
- Admin/team metrics were planned/added.

Important caveat:
- Displayed numbers may still be demo until the real import/parser is fully built and connected.
- The next critical step is building the real schedule/attendance parser from the workbook.

---

## 3. Major Requirements Added Later

### Schedule Generator Updates
Added:
- One-click weekly schedule generation
- One-click monthly schedule generation
- Manual cell editing
- Schedule versioning
- Schedule publishing and locking
- No regeneration overwrite after publishing
- Cross-midnight shifts
- Split shifts
- Excel import/export
- Validation rules
- Fairness rules
- Shift-rate distribution before/after editing
- Support real Timing sheet codes

### Gender / Shift Rule Final Version
Final agreed rule:
- Business coverage is the highest priority.
- Female agents should normally be scheduled only up to C shift, ending at 20:00.
- Female agents may work N shift only if operationally necessary.
- Female agents must not be assigned to Midnight shifts.
- Male agents can work any shift based on business need.
- Manual override is allowed by WFM/Supervisor, but violations must be flagged.

### Shift Rate %
Meaning clarified:
- Not pay rate.
- It means employee shift distribution from year start until now.
- Track how many Morning, Night, Evening, Midnight shifts each employee had.
- Show count and percentage.
- Before/After impact must show when manual edit or swap happens.

Suggested classification:
- Morning / Day: M, B, C and normal daytime variants
- Late/Night: N
- Evening: E, EE/EE20
- Midnight: MD, MN
- WFH variants should map to their underlying shift type
- OFF/H/L/S/A/COMP should be excluded from shift-rate distribution unless reported separately

---

### Attendance Additions
Added:
- Agent page must show:
  - Punch lateness count and duration
  - System login lateness count and duration
  - Missing punch count
  - Missing system login count
  - Overtime hours
  - Overtime count
  - Daily / weekly / monthly view
- Admin dashboard must show the same metrics at team/function level.
- Need import and calculation from real schedule workbook.

---

### WFM Modules Added
Added or reinforced:
- Erlang capacity planning
- HC planning
- Permission HC impact
- RTA command center
- Live monitoring
- Shrinkage
- Schedule adherence
- Rotation tracker
- Outage management
- Technical issue workflow
- Scorecards
- Coaching
- Internal chat / Teams-like communication
- Coverage protection
- Workforce calendar
- Scenario planning
- Executive dashboard
- Intraday management
- Break planning
- Notifications
- Audit logs

---

## 4. Current Risks / Gaps

### Critical Gaps
1. Real Excel parser is not fully completed.
2. Demo dashboard data must be replaced with real API data.
3. Schedule generator must be connected to real Timing shift dictionary.
4. Schedule module must support cross-midnight and split shifts.
5. Attendance and adherence engine must be completed.
6. Permission HC impact must be completed.
7. Erlang capacity planning is still missing.
8. Outage, technical issue, scorecard, and coaching modules need full implementation.
9. Audit log exists conceptually, but must be enforced across all modules.
10. Testing/build verification must be done locally by Claude Code.

### Technical Risks
- TypeScript build may reveal issues.
- Existing generated files may not be fully wired.
- Schema and TypeORM entities may have mismatch.
- Mock UI may look finished but not be data-connected.
- Old requirements may conflict with later real-data discoveries.

### Business Risks
- Gender/shift rules need configurable override and HR/legal review.
- Real attendance rules depend on clean Excel data.
- Employee matching should use Employee ID, not name.
- Historical schedule import is required for accurate shift-rate percentages.

---

## 5. Recommended Next Execution Order

### Next Immediate Phase — Stabilization & Audit
Claude Code should first:
1. Read `PROJECT_CONTEXT.md`
2. Read `CLAUDE.md`
3. Inspect current repo
4. Run install/build/test
5. List what actually compiles
6. Identify incomplete modules, placeholders, and mock data
7. Fix broken imports/types before adding new features

### Then Build in This Order
1. Real workbook import/parser
2. Shift-code dictionary import from Timing sheet
3. Attendance metrics from real Shifts data
4. Employee page real data connection
5. Admin dashboard real metrics
6. Schedule module
7. Auto schedule generator
8. Shift-rate before/after impact
9. Permission HC impact
10. Schedule adherence
11. Erlang capacity planning
12. Outage management
13. Technical issue workflow
14. Scorecard engine
15. Coaching workflow
16. Internal chat / notifications
17. Deployment and production hardening

---

## 6. Do Not Forget

- Do not restart the project.
- Newer conversation decisions override older requirements.
- The real workbook structure is more important than assumptions in early documents.
- `Timing` sheet is the official shift-code dictionary.
- The agent dashboard and admin dashboard must use real imported data.
- Keep mock/demo data clearly marked until replaced.
- Manual schedule edits must be allowed after publishing.
- Published schedules must not be overwritten by new generate action.
- Keep version history for schedules.
- Before/After impact must exist for approvals, schedule changes, shift swaps, and shift-rate distribution.