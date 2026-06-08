# WFM PROJECT INSTRUCTIONS — FULL MASTER VERSION

## 0. Purpose of This File

This file is the master instruction file for the Boutiqaat Contact Center WFM System.

It must be placed in Claude Project Instructions and/or in the repository as:

- `PROJECT_CONTEXT.md`
- `CLAUDE.md`
- or `WFM_PROJECT_INSTRUCTIONS_FULL.md`

The purpose is to make Claude Code understand the full project from the beginning until the latest discussion, including:
- What was planned
- What was built
- What was modified
- What was added later
- What broke
- What must not be repeated
- What still needs to be built
- What order to build next

This is not a generic CRUD project.  
This is an enterprise-grade Contact Center Workforce Management platform comparable in purpose and depth to NICE, Verint, Calabrio, Genesys WFM, and other enterprise WFM systems.

---

# 1. Assistant Role

When working on this project, act as all of the following:

- Senior Workforce Management Director
- Contact Center Operations Director
- Product Manager
- Solution Architect
- Database Architect
- Senior Full Stack Engineer
- UI/UX Lead
- Forecasting Specialist
- Capacity Planning Specialist
- RTA Specialist
- QA / Code Reviewer
- Implementation Lead

Always prioritize:

1. Workforce Management best practices
2. Contact Center operational requirements
3. Real business logic
4. Scalability
5. User experience
6. Enterprise architecture
7. Auditability
8. Data accuracy
9. Operational transparency
10. Future integrations

Do not produce shallow UI-only features.
Do not create generic CRUD pages.
Do not fake completion.
Do not hide mock/demo data.
Do not restart the project.
Continue from the latest approved state.

---

# 2. Project Summary

The system is a full Workforce Management platform for Boutiqaat Contact Center.

It must support:
- 24/7 operations
- Omnichannel contact center functions
- Attendance
- Scheduling
- Auto schedule generation
- Shift rotation
- Shift fairness
- Employee shift-rate distribution
- Forecasting
- Capacity planning
- Erlang-C calculations
- HC planning
- Permission impact
- Requests and approvals
- Real-time monitoring
- RTA command center
- Outage management
- Technical issue workflow
- Scorecards
- Coaching
- Cross-skill management
- Workforce calendar
- Shrinkage
- Intraday management
- Break planning
- Internal chat
- Notifications
- Audit logs
- Reports and exports
- Future integrations

The system must become the single source of truth for WFM, Operations, HR, RTA, TLs, agents, and management.

---

# 3. Source of Truth Priority

Use this priority when requirements conflict:

1. Latest direct user clarification
2. Real uploaded schedule workbook structure
3. Timing sheet from real workbook
4. Requirements / project instructions
5. Earlier assumptions
6. Generic WFM assumptions

Important:
- Newer conversation updates override older requirements.
- Real workbook data overrides theoretical early shift assumptions.
- Never rely only on the first 8 shift codes if the real Timing sheet contains more.
- If a feature exists only as demo/mock, do not call it complete.

---

# 4. Technology Direction

The project previously used / planned:

## Backend
- NestJS
- TypeScript
- PostgreSQL
- TypeORM
- JWT authentication
- Rotating refresh tokens
- RBAC
- Audit logging
- Swagger/OpenAPI
- Modular monolith structure

## Frontend
- React
- TypeScript
- Vite
- Role-based routing
- Arabic / English
- RTL / LTR
- Light / Dark mode
- Enterprise dashboard UI
- Dynamic UI direction with animations

## Database
- PostgreSQL
- SQL migrations as source of truth
- TypeORM with `synchronize: false`
- Audit tables
- Attachment tables
- Approval workflow tables
- Request envelope + extension tables
- Headcount interval snapshots

## Important Technical Rule
Run build/test before adding new modules:
- `npm install`
- `npm run build`
- tests if available

Fix broken imports/types/runtime issues first.

---

# 5. Current Project State From Conversation

## Completed / Built Structurally

### Phase 0 — Planning
Completed:
- Product scope summary
- MVP scope
- Technical assumptions
- System architecture
- Main modules
- Development phases
- Risks and dependencies
- Recommended folder structure

### Phase 1 — Database + ERD
Completed:
- PostgreSQL schema
- Full ERD
- MVP migration
- About 33 MVP tables in focused migration
- Original broader schema around 45 tables across 18 domains
- PKs, FKs, indexes, constraints
- Audit log tables
- Attachment tables
- Approval workflow tables
- Technical tickets
- Versioned schedule grid
- Attendance capture
- Headcount interval snapshots

Important decisions:
- S/A suffix is derived from shift code + attendance marker.
- Requests use a base request envelope + extension tables.
- Audit and attachments are polymorphic.
- Dynamic lists should be tables, not hardcoded enums.
- `headcount_intervals` powers live Hour × Function before/after calculations.
- Audit log should be immutable / append-only.

### Phase 2 — Backend Foundation
Completed:
- NestJS backend foundation
- Auth module
- RBAC module
- Users module
- Employees module
- Org/function/team/role management
- Database connection
- Seed data
- Error handling
- Basic audit logging
- Swagger/OpenAPI docs

Caveat:
- Some code was generated but not fully compiled in the environment at the time.
- Claude Code must verify build before continuing.

### Phase 3 — Frontend Foundation
Completed:
- React + TypeScript Vite app
- Routing
- Login page
- Role-based layout
- Sidebar navigation
- Agent/WFM/Admin dashboard shells
- Arabic/English
- RTL/LTR
- Light/Dark
- API client
- Token refresh
- Dynamic visual direction

Caveat:
- Some dashboard numbers remain demo/mock until real APIs are connected.

### User Management
Completed:
- Manual user creation
- Role assignment
- Pending users
- Self-registration approval
- Excel/CSV bulk import
- Preview before commit
- Row-level validation
- Temporary password generation
- Frontend user management screen

### Real Workbook Analysis
Completed:
- Real workbook inspected.
- Monthly sheets, HC, Shifts, Timing, Outages existed.
- Timing sheet identified as official shift dictionary.
- More than basic 8 shift codes discovered.
- 20 codes identified as 8-hour responsible/supervisor shifts.
- R codes identified as Ramadan.
- WFH variants identified.
- Split shifts identified.
- Attendance/system/punch/OT columns identified.

### Employee Metrics
Partially built:
- Punch late count/duration
- System late count/duration
- Missing punch
- Missing system login
- OT hours
- OT count
- Early out
- Daily/weekly/monthly aggregation
- Office/WFH split added
- Agent page route planned/built
- Admin/team dashboard metrics planned/built

Caveat:
- Must be connected to real imported data, not demo data.

### Capacity Planning
Partially built:
- Erlang-C engine for voice
- Concurrency-adjusted model for chat/social/WhatsApp
- Backlog/throughput model for email
- Intern productivity factor
- 3 shrinkage/OT scenarios
- Interactive frontend page
- Chat/WhatsApp concurrency confirmed as 4
- Intern productivity assumed around 70%

Caveat:
- Needs real forecast/contact volume imports and saved scenarios.

### Schedule Generator
Partially built:
- Pure fair-scheduling generator
- Shift category helper
- Gender eligibility rule
- Morning/Late/Evening/Midnight classification
- Fairness-aware assignment
- Gender rule support
- Consecutive OFF / rest rotation issue discovered and improved
- Testing found real constraints around limited male night coverage

Caveat:
- Must be connected to UI, real employees, real shift dictionary, and schedule storage.
- Must show gaps honestly if coverage cannot be met.

### UI Single HTML / v3 Prototype
Built:
- Large HTML prototype
- 22 modules structurally rendered
- Scorecard
- Internal chat
- Outage
- Rotation
- Capacity
- Dynamic UI

Issue found:
- Single HTML script blocks broke due to duplicate top-level `let` / `const` declarations such as `CAP_VIEW`.
- In browser, top-level lexical declarations across script blocks share global scope.
- Future single-file prototypes must avoid duplicate global `let`/`const`.
- Use modules, closures, namespaces, or safe `var` patterns if absolutely necessary.

---

# 6. Critical Business Rules

## 6.1 Week Rule
- Workforce week starts Saturday.

## 6.2 Standard Shift Rule
- Regular agent shift = 9 hours including 1 hour break.
- Responsible/supervisor `20` shift codes = 8 hours.
- Ramadan shifts may be different and may include split shifts.
- Some shifts cross midnight.

## 6.3 Shift Code Source of Truth
The real Timing sheet is the official source of truth.

Do not hardcode only:
- M
- B
- C
- N
- E
- EE20
- MD
- MN

The system must import and understand all real codes from Timing.

Known rules from conversation:
- `20` = 8-hour responsible/supervisor shift.
- `9` or no suffix = regular 9-hour agent shift.
- `R` = Ramadan.
- Some Ramadan shifts are split shifts.
- `WFH`, `WFH-M`, `WFH-B`, `WFH-N`, `WFHM`, `WFHN` = work from home variants.
- `S` suffix = sick leave submitted.
- `A` suffix = absence.
- OFF = weekly rest day.
- H = official holiday.
- L = annual leave.
- SL = sick leave scheduled/pre-submitted.
- DL = death leave.
- RES = resignation.
- TER = termination.
- COMP = compensatory day.
- UPL / COV if present in workbook must be supported.
- AM is 8 hours and different from M9.

## 6.4 Female Shift Rule — Final Version
Final user clarification:
- Business coverage is the top priority.
- Female agents should normally work up to C shift only, ending at 20:00.
- Female agents may be assigned N shift only if operationally necessary.
- Female agents must not be assigned Midnight shifts MD/MN.
- Manual override by WFM/Supervisor is allowed, but the system must flag violations clearly.
- The rule must be configurable, not hardcoded.

## 6.5 Male Shift Rule
- Male agents can work any shift based on business needs.
- No restriction except rest/fairness/coverage rules.

## 6.6 Rest Rule
The system must calculate rest time between consecutive shifts, including cross-midnight shifts.

Minimum rest target:
- 10 hours minimum rest unless manually overridden.

Examples:
- MD ending 07:00 then M starting 07:00 = 0 rest, invalid.
- MD ending 07:00 then EE20 starting 18:00 = 11 hours rest, valid.

## 6.7 Publish / Lock Rule
Schedule states should include:
1. Draft
2. Generated
3. Reviewed
4. Published / Shared
5. Locked / Archived

Rules:
- A published schedule must not be overwritten by a new Generate action.
- Manual edits are allowed after publish by authorized users.
- Manual edits must create version history.
- Manual edits must show validation warnings.
- Manual edits must show before/after impact.

## 6.8 Manual Override Rule
WFM/Supervisor can manually edit schedule cells.

When manual edit happens:
- Recalculate coverage.
- Recalculate rest.
- Recalculate female shift rule.
- Recalculate shift-rate distribution.
- Recalculate HC by interval.
- Add audit log entry.
- Keep previous value in version history.
- Show warning if rule is violated.

---

# 7. Shift Rate % — Meaning and Rules

User clarified:
Shift Rate does NOT mean salary/pay rate.

Shift Rate = employee shift distribution from beginning of year until selected date.

For each employee, track:
- Morning/Day count
- N / Night count
- Evening count
- Midnight count
- WFH count if needed
- OFF / Leave counts separately

Show:
- Count
- Percentage
- Year-to-date
- Current month
- Selected period
- Before/after impact when edit or swap happens

Examples:
- Before edit: Morning 42, Night 8, Evening 5, Midnight 18
- After changing C to MD: Morning 41, Night 8, Evening 5, Midnight 19

For swap:
- Show before/after for both employees.

Classification should be configurable and based on Timing shift metadata.

Suggested:
- Morning/Day: M, B, C, AM, M20/B20/C20, WFH-M/WFHM/WFH-B
- Night/Late: N, N20, WFH-N/WFHN
- Evening: E, EE20
- Midnight: MD, MN, MDR, MNR and midnight equivalents
- Exclude OFF/H/L/S/A/COMP from working shift-rate distribution, but track them separately.

---

# 8. Attendance / Agent Metrics

Agent page and admin dashboard must show real attendance metrics from imported data.

## Agent Metrics
Per agent:
- Punch late count
- Punch late duration
- System late count
- System late duration
- Punch early out count/duration
- System early out count/duration
- Missing punch count
- Missing system login count
- OT hours
- OT count
- Office days
- WFH days
- Working days
- Absence count
- Sick count
- Leave count
- Daily / weekly / monthly / YTD views

## Admin Dashboard Metrics
For TL/WFM/Operations:
- Same metrics aggregated by team
- Same metrics aggregated by function
- Top late employees
- Missing punch ranking
- Missing system ranking
- OT ranking
- WFH/Office distribution
- Attendance compliance score
- Trend weekly/monthly

## Real Workbook Fields
Use fields like:
- Punch In
- Punch Out
- Login System Time
- Logout System Time
- Punch Late In
- Punch Early Out
- Late In System Duration
- Early Out System Duration
- OT
- Shift Start / End
- Shift Start 2 / End 2 for split shifts
- Function
- Team Manager
- Employee ID

Do not match employees only by name. Use Employee ID.

---

# 9. Real Workbook Import / Parser

This is a critical next foundation.

The workbook contains:
- Monthly schedule sheets
- HC sheets
- Shifts sheet
- Outages sheet
- Timing sheet

Build an import module with:

## 9.1 Import Batch
- Upload workbook
- Store file metadata
- Create import batch ID
- Preview rows
- Validate rows
- Show errors/warnings
- Commit only after confirmation
- Keep raw row data
- Audit import action

## 9.2 Timing Sheet Parser
Parse Timing sheet into:
- Shift code
- Start time
- End time
- Start time 2
- End time 2
- Working hours
- Break hours
- Is split shift
- Cross-midnight flag
- Category
- Is WFH
- Is Ramadan
- Is leave code
- Is absence/sick suffix
- Is supervisor/responsible shift
- Is working shift

## 9.3 Shifts Sheet Parser
Parse each row into:
- Employee ID
- Employee name
- Function
- Team/manager
- Date
- Shift code
- Shift timing
- Actual punch in/out
- System login/logout
- Late in punch
- Late in system
- Early out punch
- Early out system
- OT
- Permission if present
- Notes/status

## 9.4 Monthly Matrix Parser
If monthly schedule sheets are matrix format:
- Employee row
- Date columns
- Shift code cell
- Convert to normalized schedule rows

## 9.5 Validation
Validate:
- Unknown shift codes
- Missing employee ID
- Duplicate rows
- Invalid dates
- Invalid time formats
- Cross-midnight logic
- Split shift logic
- Missing Timing mapping
- Female midnight violations
- Rest violations
- Coverage gaps

## 9.6 Commit
When committed:
- Upsert shift code dictionary
- Upsert employees if allowed
- Create schedule records
- Create attendance records
- Create shift-rate snapshots if needed
- Create import audit logs

---

# 10. Schedule Management Module

Must include:
- Schedule grid
- Weekly view
- Monthly view
- Function filter
- Team filter
- Agent filter
- Shift code recognition
- Leave/attendance code recognition
- Manual cell edit
- Bulk edit
- Copy/paste support if possible
- Import Excel
- Export Excel
- Schedule versioning
- Schedule validation
- Cross-midnight shifts
- Split shifts
- Publish / lock
- Audit trail
- Compare versions
- Before/after HC impact
- Before/after shift-rate impact

Validation must include:
- Rest < 10 hours
- Female midnight violation
- Female N shift warning unless needed
- Missing OFF balance
- Too many consecutive working days
- Too many consecutive OFF days if policy applies
- Coverage shortage
- Unknown shift code
- Employee not skilled for function
- Employee unavailable/on leave

---

# 11. Auto Schedule Generator

The generator must support:
- One-click weekly schedule generation
- One-click monthly schedule generation
- Function coverage
- Skill coverage
- Gender rules
- Rest rules
- Split shifts
- Cross-midnight shifts
- OFF distribution
- Fairness
- Rotation
- Shift-rate balance
- Manual override after generation
- Coverage gap report
- Fairness report
- Schedule preview before publish
- Regenerate only draft/unpublished schedules
- No overwrite after publish

## Generator Logic
Inputs:
- Employees
- Functions
- Skills
- Availability
- Gender
- Current shift-rate distribution
- Required HC by interval
- Shift definitions from Timing
- Leave/absence
- OFF balance
- Historical assignments
- Rest constraints

Outputs:
- Proposed schedule
- Coverage met/gap
- Violations
- Fairness score
- Night distribution
- OFF distribution
- Shift-rate before/after
- Warnings

## Important Discovery
Testing found that male night coverage may be constrained if male pool is too small.  
Generator must not hide this.  
It must show:
- Coverage gap
- Reason
- Suggested solution
- Need more male coverage
- Need cross-skill movement
- Need OT
- Need exception approval

---

# 12. Rotation System

The system must support both automatic and manual/custom rotation.

Previously discussed:
- Rotation patterns like M → N → B → C
- Night group rotation
- Custom Rotation Builder
- Employee current shift + next week shift
- Night days count
- Fair distribution
- Avoid same people always getting midnight
- Show fairness metrics clearly

## Rotation Features
- Assign rotation group
- Define rotation sequence
- Define night group A/B if needed
- Define how many weeks cycle
- Define allowed shifts per group
- Find closest valid shift if target shift violates rules
- Respect function coverage
- Respect gender rules
- Respect rest rule
- Respect OFF days
- Show rotation history

## UI
Rotation page should show:
- Employee
- Current shift
- Current shift type
- Next shift recommendation
- Night count
- Midnight count
- OFF count
- Function
- Skill
- Rotation group
- Fairness status
- Manual override

---

# 13. Permission HC Impact

This must be a core WFM feature.

When someone requests permission:
- System must show before/after coverage.
- WFM/TL must see if approval causes undercoverage.

## Required Columns / Metrics
For each interval/function:
- Required HC
- Scheduled HC
- Permission HC
- Actual/Available HC
- Gap / Surplus

Suggested matrix:
- Hour / Interval
- Function
- Required
- Scheduled
- On permission
- Sick/Absent
- Available after approval
- Gap
- Risk level

## Permission Approval Flow
Before approving:
- Calculate impacted intervals.
- Calculate available HC after approval.
- Show red warning if gap occurs.
- Suggest alternate time if possible.
- Show affected SLA risk.
- Audit approval/rejection.

---

# 14. Erlang / Capacity Planning

This module must not be missing.

## Voice / Inbound
Use Erlang-C.

Inputs:
- Contact volume by interval
- AHT
- Target service level
- Target answer time
- Occupancy target
- Shrinkage
- Available HC
- Interval length

Outputs:
- Workload
- Required HC
- Required HC with shrinkage
- Occupancy
- SLA risk
- Staffing gap

## Chat / WhatsApp / Social
Use concurrency-adjusted workload.

Confirmed:
- Chat/WhatsApp concurrency = 4 conversations per employee.

Inputs:
- Volume
- AHT
- Concurrency
- Target response time
- Occupancy
- Shrinkage

Outputs:
- Required HC
- Gap
- Occupancy risk

## Email
Use backlog / throughput model.

Inputs:
- Backlog
- Incoming volume
- AHT
- SLA target
- Available hours
- Shrinkage

Outputs:
- Required HC
- Backlog clearance time
- SLA risk

## Intern Productivity
Interns are not equal to full-time employees.

Default assumption discussed:
- Intern productivity factor around 70%

The system must allow configuration.

## Scenarios
Capacity planning should show multiple scenarios:
1. Base scenario
2. Shrinkage scenario
3. OT scenario
4. Emergency scenario if needed

## UI
Capacity page should include:
- Inputs by function/channel
- Interval table
- Required vs Scheduled vs Actual
- Gap/surplus chart
- Scenario comparison
- Export
- Save scenario
- Notes/assumptions

---

# 15. HC Planning

HC planning must include:
- Required HC by function
- Scheduled HC
- Actual HC
- Available HC
- Permission impact
- Sick/leave impact
- OT impact
- WFH/Office split
- Forecasted demand
- Coverage by interval
- Gap/surplus
- Hiring gap
- Scenario planning

HC should be shown:
- Daily
- Weekly
- Monthly
- By interval
- By function
- By skill
- By team

---

# 16. RTA Command Center

RTA dashboard must include:
- Live adherence
- Planned vs actual
- Logged in agents
- Break status
- Permission status
- Late logins
- Early logouts
- Queue status
- SLA status
- Available HC
- Gap by interval
- Alerts
- Outages
- Technical issues
- Escalations
- Intraday changes

RTA should be able to:
- Validate technical issues
- Validate outage impact
- Monitor attendance
- Trigger alerts
- See staffing gaps
- See permission impact
- Export interval reports

---

# 17. Schedule Adherence Engine

Must compare:
- Scheduled shift
- Actual punch
- Actual system login
- Breaks
- Permissions
- Early out
- Late in
- Absence

Metrics:
- Adherence %
- Conformance %
- Late minutes
- Early out minutes
- Missing login
- Missing punch
- Unplanned absence
- Approved exception
- Non-approved exception

Views:
- Agent
- TL
- Function
- RTA
- WFM
- Daily/weekly/monthly

---

# 18. Shrinkage Management

Shrinkage should support:
- Planned shrinkage
- Unplanned shrinkage
- Sick leave
- Annual leave
- Official holiday
- Training
- Meeting
- Coaching
- Permission
- Absence
- WFH impact if needed
- Attrition if needed

Outputs:
- Shrinkage %
- Productive hours
- Lost hours
- Impact by function
- Impact by interval
- Trend

---

# 19. Requests & Approvals

Use request envelope + extension tables.

Request types include:
1. Permission
2. Sick Leave
3. Annual Leave
4. Death Leave
5. Comp Off
6. Shift Swap
7. OFF Swap
8. Overtime
9. Break Request
10. University Student Request
11. Technical Issue
12. Outage Escalation
13. Coaching / 1v1
14. WFH request if needed
15. Schedule exception

Each request must have:
- Requester
- Type
- Status
- Submitted at
- Approver chain
- SLA
- Impact before/after
- Attachments
- Comments
- Audit trail

## Shift Swap Special Rule
Shift Swap must include peer acceptance:
1. Employee requests swap with colleague.
2. Colleague accepts/rejects.
3. Then goes to TL/WFM approval.
4. System validates coverage/rest/gender/skills.
5. Approval updates schedule version.

---

# 20. Outage Management

Outage module must track:
- Outage type
- Function/channel impacted
- Start time
- End time
- Ongoing/resolved
- Severity
- Impacted intervals
- Available agents
- Escalated by
- Validated by RTA
- Owner
- Root cause
- Resolution
- SLA
- Email automation
- Attachments
- Comments
- Audit log

Outage categories may include:
- Inbound/IVR down
- Ameyo issue
- CRM issue
- Sprinklr issue
- Application slow
- Electricity
- Network
- Payment issue
- Exchange/return issue
- Other

Workflow:
1. Agent/TL/RTA reports outage.
2. RTA validates.
3. WFM/Operations sees impact.
4. IT/concerned team assigned.
5. SLA tracked.
6. Resolution recorded.
7. Impact calculated before/during/after.
8. Email automation sent if enabled.
9. Report generated.

---

# 21. Technical Issue Workflow

Technical issue example:
- Customer contacts us.
- Agent cannot complete request because CRM/system issue.
- Case status becomes internal hold.
- Reason: Technical Issue.
- Issue assigned to validation team/RTA.
- If valid, escalated to IT.
- Attach screenshots/videos.
- If same issue reason repeats for 20+ customers, flag as CX issue.
- SLA target: 48 hours.

Track:
- Original case ID
- Customer impact
- SKU if relevant
- Function/channel
- Issue reason
- Validated by
- Escalated to
- Status
- Resolution SLA
- Attachments
- Repeated count
- CX issue flag

---

# 22. Exceptions Tracker / CRM SKU Defect Reporting

Must support:
- Customer exception tracker
- Case exceptions
- Refund/exchange/return exceptions
- CRM integration future
- SKU defect reporting

If customer return/exchange issue relates to product:
- Track SKU
- Track reason
- Track defect type
- Track repeated SKU issues
- Build dashboard for most defective SKUs
- Support supplier/product quality reporting

---

# 23. Scorecard

Scorecard must support:
- Daily
- Weekly
- Monthly
- Agent level
- Function level
- TL view
- Agent view
- Wallboard ranking
- Coaching-needed flag
- Improvement vs previous period
- Export

KPIs include:
- AHT
- Quality
- Quiz
- FCR
- CTR
- Response Rate
- PRR/RR
- Email FRT
- Email AHT
- CSAT
- NPS
- Occupancy
- Adherence
- Attendance

Need:
- KPI weights
- Targets
- Score calculation
- Bar score
- Ranking
- Highlight below target
- Coaching button
- Trend comparison

---

# 24. Coaching

Coaching module should include:
- Coaching needed flags from scorecard
- 1v1 coaching form
- Feedback workflow
- Employee acknowledgement if needed
- TL comments
- Improvement action plan
- Follow-up date
- History
- Link to scorecard gaps

---

# 25. Cross-Skill Engine

Must support:
- Employee skills
- Skill proficiency
- Skill expiry
- Skill training status
- Cross-skill recommendation
- Coverage recommendation
- Move employee from function to cover another
- Impact analysis

Skills discussed:
- Voice
- Chat
- WhatsApp
- Email
- Social Media
- Customer Care
- Refund
- NPS

Need auto-alert:
- Skill expiry approaching
- Skill expired
- Employee needs refresh training

---

# 26. Internal Chat / Communication

Internal communication module should include:
- Team channels
- WFM channel
- RTA channel
- Outage channel
- TL channel
- Direct messages
- Online status
- Unread count
- Auto-post outage updates
- Auto-post technical issue alerts
- Search messages if possible

Important:
- This is not a replacement for Teams at first.
- It can be an internal operational communication layer.
- Future Teams integration can be added.

---

# 27. Notifications

Notification center should include:
- Request submitted
- Request approved/rejected
- Permission risk
- Schedule published
- Schedule changed
- Outage opened/resolved
- Technical issue SLA risk
- Coaching assigned
- Scorecard published
- Skill expiry
- Missing punch/system
- Late/early alerts

Channels:
- In-app
- Email future
- Teams Adaptive Card future
- Push future

---

# 28. Reports / Exports

Must support:
- Excel export
- PDF export future
- Attendance report
- Schedule report
- HC report
- Permission report
- OT report
- Outage report
- Technical issue report
- Scorecard report
- Agent history
- Audit log export

---

# 29. Security / Roles

Roles:
- Agent
- Team Leader
- RTA
- WFM Analyst
- WFM Supervisor
- Operations Manager
- HR
- IT Admin
- Admin
- Super Admin if needed

Rules:
- Role-based page access
- Role-based action access
- Audit all sensitive changes
- Password hashing must be real in production
- MFA future
- SSO future
- Admin-only settings
- Super Admin-only critical actions

---

# 30. Design / UI Expectations

The UI should be:
- Enterprise grade
- Dynamic but professional
- Arabic/English
- RTL/LTR
- Light/Dark
- Modern dashboard style
- Animated carefully
- Clear cards
- Live counters
- Charts
- Micro-interactions
- Hover states
- Clear status colors
- Clear warnings
- Not cluttered
- Not childish

Important:
- Existing visual direction was approved as initial direction.
- The user wants it more dynamic and polished.
- Do not break the whole app with unsafe script/global edits.
- In React, use components/state properly.
- Avoid single giant HTML files for production.

---

# 31. Audit Log

Audit log must be real.

Log:
- User creation
- User activation/deactivation
- Role change
- Schedule generated
- Schedule edited
- Schedule published
- Request approval/rejection
- Attendance edit
- Import commit
- Outage updates
- Technical issue updates
- Scorecard publish
- Settings changes

Fields:
- Actor
- Action
- Entity type
- Entity ID
- Old value
- New value
- Timestamp
- IP/device if available
- Reason/comment if applicable

---

# 32. Known Gaps From Conversation

These were identified as still missing or needing deeper completion:

1. Real audit log across all actions
2. Actual attendance engine connected to real data
3. Adherence engine scheduled vs actual
4. Attachment preview
5. Shift Swap peer acceptance
6. Schedule fairness metric displayed clearly
7. Skill expiry auto-alert
8. Outage email automation hook
9. Cloud deployment
10. Real employee import
11. Real password hashing if prototype used fake/simple logic
12. Future integrations:
    - Telephony
    - CRM
    - Teams
    - HR system
    - Push notifications

---

# 33. Development Roadmap — Full

## Stage 0 — Foundation
Status: Completed / verify
- Requirements
- Architecture
- RBAC
- Database
- Design direction

## Stage 1 — MVP Core
Status: Completed structurally / verify
- Backend
- Frontend
- Auth
- Users
- Employees
- Org
- Basic dashboard

## Stage 2 — User Management
Status: Completed / verify
- Manual creation
- Pending activation
- Bulk import
- Preview/validation/commit

## Stage 3 — Real Data Foundation
Status: Next critical priority
- Workbook import
- Timing parser
- Shifts parser
- Monthly matrix parser
- Import batch
- Validation
- Commit to DB
- Real metrics connection

## Stage 4 — Attendance & Adherence
Status: Pending/partial
- Actual attendance
- Punch/system comparison
- Missing logs
- Late/early
- Adherence
- Agent/admin views

## Stage 5 — Schedule Management
Status: Pending/partial
- Grid
- Weekly/monthly
- Manual edit
- Import/export
- Versioning
- Publish lock
- Validation

## Stage 6 — Auto Schedule Generator
Status: Partial engine / needs integration
- Generate weekly/monthly
- Fairness
- Coverage
- Rotation
- Gender/rest rules
- Shift-rate impact
- Gap analysis
- UI

## Stage 7 — Shift Rotation & Shift Rate
Status: Pending/partial
- Rotation groups
- Custom builder
- Shift distribution
- Before/after impact
- Fairness score

## Stage 8 — Permission HC Impact
Status: Pending
- Required/Scheduled/Permission/Actual
- Before/after
- Risk warnings

## Stage 9 — Erlang / Capacity / HC Planning
Status: Partial engine
- Save scenarios
- Real forecasts
- Real schedule comparison
- UI refinement

## Stage 10 — RTA / Live Monitoring / Intraday
Status: Pending/partial demo
- Live adherence
- Intraday gaps
- Queue status
- Alerts

## Stage 11 — Outage + Technical Issues
Status: Pending/partial demo
- Full workflow
- SLA
- Validations
- Email hook
- CX issue detection

## Stage 12 — Scorecard + Coaching
Status: Partial prototype
- Real KPI imports
- Weighting
- Trends
- Coaching workflow

## Stage 13 — Cross-Skill + Skills
Status: Partial
- Skill matrix
- Expiry alerts
- Coverage recommendation

## Stage 14 — Chat + Notifications
Status: Partial prototype
- Real notification system
- Chat persistence
- Teams integration future

## Stage 15 — Production Readiness
Status: Pending
- Cloud deploy
- Security hardening
- Real DB
- Backups
- Monitoring
- Integrations
- UAT
- Acceptance testing

---

# 34. Architecture Lessons Learned

## 34.1 Do not break working app with global script collisions
If working in single HTML prototype:
- Avoid duplicate top-level `let` / `const`
- Use namespaces
- Use closures
- Use modules
- Avoid redefining global variables like `CAP_VIEW`

## 34.2 Do not implement too many unrelated modules in one edit
Large jumps caused breakage.
Work module by module:
- Plan
- Implement
- Test
- Verify
- Package

## 34.3 Do not call prototype complete
If data is mock:
- Badge it as demo
- Clearly state what API is missing

## 34.4 Always test
Run:
- Syntax checks
- TypeScript build
- Import path checks
- Core logic tests
- Browser smoke test

## 34.5 Keep business logic pure where possible
Create pure functions for:
- Shift classification
- Rest calculation
- Gender eligibility
- Schedule generator
- Erlang calculations
- Attendance metrics
- Shift-rate calculation

Then connect to backend/UI.

---

# 35. Required First Message For New Claude Code Session

Use this prompt:

```text
You are continuing the Boutiqaat Contact Center WFM System.

Read these files first:
1. WFM_PROJECT_INSTRUCTIONS_FULL.md
2. PROJECT_CONTEXT.md
3. CLAUDE.md
4. WFM_Requirements_v2_0.md if available
5. Existing backend/frontend README files
6. Existing database migrations

Do not start coding immediately.

First:
- Inspect the current repository
- Identify backend/frontend structure
- Run install/build/tests if possible
- Tell me what actually works
- Tell me what is mock/demo
- Tell me what is broken
- Tell me what should be fixed first

Then continue from the latest approved state.

Do not restart the project.
Do not create a generic CRUD app.
Use the real workbook/Timing sheet logic as source of truth.
The next priority is to stabilize the current code, then build the real workbook import/parser and connect attendance/agent/admin metrics to real data.
```

---

# 36. Current Recommended Next Action

Before adding more features:

1. Put this file into project instructions.
2. Put the same file in repository root as `CLAUDE.md`.
3. Ask Claude Code to audit current repo.
4. Fix build/runtime issues.
5. Build real workbook parser.
6. Connect real attendance metrics.
7. Then continue phases.

Do not jump directly to new UI improvements before the data foundation is stable.