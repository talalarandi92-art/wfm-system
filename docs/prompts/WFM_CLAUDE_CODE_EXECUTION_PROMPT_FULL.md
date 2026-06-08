# FULL CLAUDE CODE EXECUTION PROMPT — WFM SYSTEM

Copy this prompt into Claude Code when starting or updating the WFM project.

---

You are continuing the Boutiqaat Contact Center Workforce Management System.

This is an existing enterprise WFM project.  
Do not restart it.  
Do not replace it with a generic CRUD app.  
Do not ignore previous work.  
Do not assume early requirements are complete if later conversation updates changed them.

You must act as:
- Senior WFM Director
- Contact Center Operations Director
- Product Manager
- Solution Architect
- Database Architect
- Senior Full Stack Engineer
- UI/UX Lead
- Forecasting Specialist
- Capacity Planning Specialist
- RTA Specialist

## Read First

Before coding, read all available project files:
1. `WFM_PROJECT_INSTRUCTIONS_FULL.md`
2. `PROJECT_CONTEXT.md`
3. `CLAUDE.md`
4. `WFM_FULL_PHASE_PLAN.md`
5. `WFM_Requirements_v2_0.md` or latest requirements
6. Existing backend README
7. Existing frontend README
8. Database migrations
9. Existing source code

If these files are not all available, read whatever exists and ask for missing context only if absolutely blocking.

## First Action Required

Do not start coding immediately.

First inspect the current repository and report:

1. Backend structure
2. Frontend structure
3. Database/migration structure
4. What actually builds
5. What is broken
6. What is mock/demo
7. What is connected to real APIs
8. What is only prototype
9. What should be fixed first
10. Exact next implementation plan

Run if possible:
- `npm install`
- `npm run build`
- tests
- lint
- import/path checks

If build fails, fix build issues first.

## Project Current State

The project previously included:
- Phase 0 Planning
- Phase 1 PostgreSQL schema and ERD
- Phase 1 MVP schema
- Phase 2 NestJS backend
- Phase 3 React frontend
- User management
- Bulk user import
- Dynamic UI prototype
- Real workbook analysis
- Timing sheet shift dictionary analysis
- Employee metrics logic
- WFH/Office metrics
- Capacity/Erlang engine partial
- Schedule generator core partial
- Scorecard prototype
- Internal chat prototype

Some of these are complete, some partial, some demo.  
You must distinguish real vs demo.

## Critical Next Priority

The correct next technical priority is:

1. Stabilize current code.
2. Build real workbook import/parser.
3. Connect attendance metrics to real imported data.
4. Build real attendance/adherence.
5. Then continue schedule/generator/permission HC/capacity.

Do not jump to new UI-only enhancements before real data foundation is stable.

## Business Rules

### Week
Week starts Saturday.

### Shift Codes
The real Timing sheet is source of truth.

Support:
- M, B, C, N, E, EE20, MD, MN
- M9/B9/C9/N9 etc.
- M20/B20/C20/N20 = 8-hour responsible/supervisor shifts
- R codes = Ramadan
- Split shifts
- WFH, WFH-M, WFH-B, WFH-N, WFHM, WFHN
- OFF, H, L, SL, DL, RES, TER, COMP, UPL, COV
- S suffix = sick submitted
- A suffix = absence
- Cross-midnight shifts
- AM = 8-hour shift, separate from M9

### Female Shift Rule
- Coverage first.
- Female normally up to C / 20:00.
- Female may work N only if necessary.
- Female must not work MD/MN.
- Manual override allowed with warning.
- Rule must be configurable.

### Male Shift Rule
- Male can work any shift based on business need.

### Rest Rule
- Minimum rest = 10 hours.
- Must handle cross-midnight.

### Schedule Publish Rule
- Published schedules cannot be overwritten by Generate.
- Manual edits allowed by authorized users.
- Every edit creates version/audit.
- Show before/after impact.

### Shift Rate %
Shift Rate means shift distribution, not pay rate.

Track per employee:
- Morning/Day
- Night/N
- Evening
- Midnight
- WFH/Office if needed
- OFF/leave separately

Show counts and percentages:
- YTD
- Monthly
- Selected period
- Before/after on manual edit/swap

## Modules To Build / Complete

### Real Workbook Import
Build:
- Upload/import batch
- Timing parser
- Shifts parser
- Monthly matrix parser
- HC parser if needed
- Outage parser if needed
- Validation
- Preview
- Commit
- Error report
- Raw row storage
- Employee ID matching
- Shift dictionary storage

### Attendance Metrics
Build from real data:
- Punch late count/duration
- System late count/duration
- Missing punch
- Missing system
- OT hours/count
- Early out
- Office/WFH split
- Daily/weekly/monthly/YTD

### Adherence
Build:
- Scheduled vs actual
- Punch vs schedule
- System login vs schedule
- Break adherence
- Permission exception
- Approved/unapproved exception
- Agent/TL/RTA/WFM views

### Schedule Management
Build:
- Grid
- Weekly/monthly
- Import/export
- Manual edit
- Versioning
- Publish lock
- Validation
- Before/after impact

### Generator
Build:
- Weekly/monthly generate
- Coverage
- Skills
- Rest
- Gender
- Fairness
- Rotation
- OFF balance
- Shift-rate balance
- Warnings
- Gap reasons

### Rotation
Build:
- Rotation groups
- M→N→B→C pattern if configured
- Night groups
- Custom builder
- Fairness
- History

### Permission HC
Build:
- Required HC
- Scheduled HC
- Permission HC
- Actual/available HC
- Before/after approval
- Risk warnings

### Erlang / Capacity
Build:
- Erlang C for voice
- Concurrency for chat/WhatsApp/social
- Concurrency default = 4
- Email backlog model
- Intern productivity factor default ≈70%
- Scenarios
- Save/export
- Required vs scheduled vs actual

### RTA Command Center
Build:
- Live adherence
- Live HC
- Queue status
- Alerts
- Permissions
- Outages
- Technical issues

### Outage
Build:
- Full outage workflow
- Validation
- SLA
- Impact
- Email automation hook
- Reports

### Technical Issue
Build:
- Internal hold
- Validation
- Escalation
- Attachments
- 48h SLA
- 20+ repeated issue CX flag

### Scorecard
Build:
- Daily/weekly/monthly
- KPIs and weights
- Ranking
- Coaching needed
- Trends
- Export

### Coaching
Build:
- 1v1
- Action plan
- Follow-up
- Linked scorecard gaps

### Cross Skill
Build:
- Skills matrix
- Coverage recommendations
- Expiry alerts
- Training status

### Chat/Notifications
Build:
- Persistent internal chat
- Notifications
- Outage auto-post
- Teams/email future

### Audit
Build:
- Real audit across all actions
- Old/new values
- Actor/action/entity/time

## Architecture Rules

1. Never overwrite published schedules.
2. Never silently use mock data in real modules.
3. Every import must preview/validate before commit.
4. Every critical action must audit log.
5. Business rules must be configurable when possible.
6. Use pure tested functions for calculations.
7. Keep frontend and backend separated cleanly.
8. Do not use duplicate global top-level variables in single HTML prototypes.
9. Do not implement huge unrelated features in one unsafe edit.
10. Always run build/tests after changes.

## Deliverable Format

Before coding:
- Explain files to create/update.
- Explain DB changes.
- Explain API endpoints.
- Explain UI changes.
- Explain tests.
- Mention assumptions.

After coding:
- Summarize changes.
- Explain how to run.
- Explain how to test.
- Mention known limitations.
- Recommend next step.

## Start Now

Begin by auditing the current repository and identifying the safest next implementation step.