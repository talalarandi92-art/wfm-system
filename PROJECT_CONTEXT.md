# PROJECT_CONTEXT.md

## Project
Boutiqaat Contact Center WFM System

## Purpose
Build a customized Workforce Management web platform for Boutiqaat Contact Center that supports real operational workflows, not a generic WFM system.

## Current Source of Truth
Use the latest conversation decisions and real uploaded schedule workbook analysis as the source of truth.

Older requirements are still useful, but if they conflict with later discoveries or user clarifications, the latest clarification wins.

## Core Modules
1. Authentication and RBAC
2. User Management
3. Employee Management
4. Organization Management
5. Attendance Management
6. Schedule Management
7. Auto Schedule Generator
8. Schedule Publishing and Versioning
9. Shift Rate Distribution
10. Real Workbook Import
11. Employee Metrics Page
12. Admin Metrics Dashboard
13. Requests and Approvals
14. Permission HC Impact
15. RTA Command Center
16. Live Monitoring
17. Schedule Adherence
18. Erlang Capacity Planning
19. HC Planning
20. Shrinkage
21. Outage Management
22. Technical Issue Workflow
23. Scorecard
24. Coaching
25. Internal Chat / Communication
26. Notifications
27. Audit Logs
28. Reports and Exports
29. Integrations

## Roles
- Agent
- Team Leader
- RTA
- WFM Analyst
- WFM Supervisor
- Operations Manager
- HR
- IT Admin
- Admin

## Business Rules

### Working Week
- Week starts on Saturday.

### Standard Working Hours
- Normal agent shift: 9 hours including 1 hour break.
- Responsible/supervisor shift codes with `20`: 8 hours.
- Ramadan shifts may be 7 hours or split based on Timing sheet.

### Shift Codes
The system must not rely only on hardcoded basic shifts.  
It must support the real shift-code dictionary from the uploaded workbook `Timing` sheet.

Known rules:
- `20` = 8-hour responsible/supervisor shifts.
- `9` or no suffix = 9-hour regular agent shifts.
- `R` = Ramadan shift.
- Some Ramadan shifts are split shifts.
- `WFH` variants mean work from home:
  - WFH
  - WFH-M / WFHM
  - WFH-B
  - WFH-N / WFHN
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
- UPL and COV must be supported if present in data.

### Female Shift Rule
Final rule:
- Business coverage is the highest priority.
- Female agents should normally be scheduled up to C shift only, ending at 20:00.
- Female agents may be assigned N shift only if operationally necessary.
- Female agents must not be assigned midnight shifts MD/MN.
- Manual override is allowed by WFM/Supervisor, but must create visible warning/violation.
- The rule must be configurable, not hardcoded.

### Male Shift Rule
- Male agents can work any shift based on operational needs.

### Schedule Generation
Must support:
- Weekly generation
- Monthly generation
- Function-based coverage
- Skill-based coverage
- Cross-skill agents
- Rest-time validation
- Female shift rules
- Cross-midnight shifts
- Split shifts
- Fairness distribution
- Shift-rate balance
- Manual override
- Schedule versioning
- Schedule publishing lock
- Excel import/export

### Publishing Rule
After schedule is published/shared:
- Do not overwrite it with a new generate action.
- Allow manual edits.
- Keep version history.
- Show before/after impact.

## Shift Rate %
Shift Rate means shift distribution per employee, not salary/pay rate.

Track from year start until selected date:
- Morning / Day count and percentage
- N / Night count and percentage
- Evening count and percentage
- Midnight count and percentage

Show before/after when:
- Manual schedule edit happens
- Shift swap happens
- OFF swap happens
- Overtime or schedule change affects distribution

## Attendance Metrics
Agent page and admin dashboard must show:
- Punch late count
- Punch late duration
- System late count
- System late duration
- Missing punch count
- Missing system login count
- Overtime hours
- Overtime count
- Early out count/duration
- Working days
- Daily / weekly / monthly aggregation

Use real workbook fields:
- Punch In
- Punch Out
- Login System Time
- Logout System Time
- Punch Late In
- Punch Early Out
- Late In System Duration
- Early Out System Duration
- OT

## Real Workbook Import
The real workbook contains:
- Monthly schedule sheets
- HC sheets
- Shifts sheet
- Outages sheet
- Timing sheet

Priority:
1. Parse Timing sheet into shift code dictionary.
2. Parse Shifts sheet into attendance/shift records.
3. Use Employee ID for matching.
4. Support split shift columns.
5. Support cross-midnight logic.
6. Store raw import batch and row-level errors.
7. Provide preview before commit.

## Requests & Approvals
Use one base request envelope with extension tables.

Request types include:
- Permission
- Sick leave
- Annual leave
- Comp off
- Shift swap
- OFF swap
- Overtime
- Break request
- University request
- Technical issue
- Outage escalation
- Coaching

Every request must show:
- Before/after HC impact
- Status
- SLA
- Approvers
- Audit trail
- Attachments where applicable

## Permission HC Impact
When permission is requested:
- Show current scheduled HC
- Show HC after approval
- Show impacted function
- Show impacted interval
- Show staffing gap
- Warn if approval causes undercoverage

## Outage Management
Track:
- Outage type
- Function/channel impacted
- Start time
- End time
- Ongoing/resolved status
- Escalated by
- Validated by RTA
- Available agents
- Impacted intervals
- Duration
- Root cause
- SLA
- Resolution owner
- Future email automation

## Technical Issue Workflow
Flow:
1. Customer contacts us.
2. Agent cannot complete request due to system issue.
3. Case goes internal hold.
4. Reason: Technical Issue.
5. Validation team/RTA validates.
6. If valid, escalate to IT.
7. Attach screenshots/videos.
8. If same issue repeats for 20+ customers, flag as CX issue.
9. SLA target: 48 hours.

## Scorecard
Build daily, weekly, monthly scorecards:
- Agent level
- Function level
- TL view
- Agent view
- Wallboard ranking
- Below-bar highlight
- Coaching-needed flag
- Improvement vs previous period

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
- Adherence
- Attendance

## UI Requirements
- Enterprise dashboard
- Dynamic but professional
- Arabic/English
- RTL/LTR
- Light/Dark
- Animated but not distracting
- Cards, charts, live counters
- Clear demo vs real-data badges
- Role-based navigation

## Engineering Rules
- Do not restart.
- Inspect existing code first.
- Run build/tests.
- Fix existing issues before adding modules.
- Keep schema as source of truth unless migration is needed.
- No silent mock data in production modules.
- Every major action must be audited.
- Every import must have preview, validation, error list, and commit step.