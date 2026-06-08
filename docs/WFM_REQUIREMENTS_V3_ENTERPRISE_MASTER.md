# WFM REQUIREMENTS V3 — ENTERPRISE MASTER REQUIREMENTS

## Executive Introduction

The purpose of this document is to define the complete requirements, architecture principles, business rules, workflows, calculations, and operational expectations for an Enterprise Workforce Management (WFM) Platform designed specifically for a large-scale 24/7 omnichannel contact center operation.

This platform is intended to become the single source of truth for workforce planning, forecasting, scheduling, attendance, adherence, shrinkage management, overtime management, real-time monitoring, workforce requests, approvals, outage management, reporting, and operational decision-making.

The system must support thousands of employees, multiple business functions, complex workforce rules, real-time staffing calculations, and future integrations with external platforms including telephony systems, CRM systems, HR systems, attendance systems, and identity providers.

The primary objectives of this platform are:
- Improve workforce efficiency.
- Increase scheduling fairness and transparency.
- Optimize staffing and service levels.
- Reduce manual workforce management activities.
- Improve operational visibility and decision-making.
- Provide real-time workforce intelligence.
- Support business continuity and emergency workforce planning.
- Deliver enterprise-grade reporting, forecasting, and workforce analytics.

This document serves as the official requirements baseline for the project and must be treated as the authoritative reference throughout design, development, testing, deployment, and future enhancements.

Any implementation must comply with the business rules, calculations, workflows, security requirements, and acceptance criteria defined within this specification.

The final platform should be capable of replacing multiple standalone workforce management, scheduling, attendance, forecasting, and workforce request systems while providing a unified experience for employees, supervisors, operations leaders, workforce management teams, HR teams, and executive stakeholders.

You are not a generic coding assistant.

You are acting as:
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

Always prioritize:
1. Workforce Management best practices.
2. Contact Center operational requirements.
3. Scalability.
4. Real business logic.
5. User experience.
6. Enterprise architecture.

Do not create generic CRUD applications.

Build a modern enterprise-grade Workforce Management platform comparable to NICE, Verint, Calabrio, and Genesys WFM.

---

# 1. Project Scope

The platform must include:

1. Authentication and role management
2. User and employee management
3. Schedule management
4. Auto schedule generator
5. Attendance management
6. Adherence
7. Real-time monitoring
8. RTA command center
9. Forecasting
10. Erlang capacity planning
11. HC planning
12. Shrinkage
13. Requests and approvals
14. Permission HC impact
15. Shift rotation
16. Shift rate distribution
17. Cross-skill engine
18. Outage management
19. Technical issue workflow
20. Exceptions tracker
21. CRM/SKU defect reporting
22. Scorecard
23. Coaching
24. Internal chat
25. Notifications
26. Audit log
27. Reports and exports
28. Workforce calendar
29. Intraday management
30. Break planning
31. Scenario planning
32. Future integrations

---

# 2. Users and Roles

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

Each role must have its own access rules.

Agents should see:
- Their schedule
- Their attendance
- Their scorecard
- Their requests
- Their overtime
- Their shift-rate distribution
- Their coaching
- Their notifications

TLs should see:
- Team schedule
- Team attendance
- Team requests
- Team scorecards
- Team adherence
- Coaching

RTA should see:
- Live monitoring
- Adherence
- Technical issues
- Outages
- HC gaps
- Permission impact

WFM should see:
- Scheduling
- Generator
- Capacity planning
- HC planning
- Shrinkage
- Forecasting
- Reports

Operations should see:
- Executive dashboards
- SLA risk
- Staffing risk
- Scorecards
- Outages
- Performance

HR should see:
- Users
- Attendance compliance
- Leaves
- Policy-related reports

Admin/Super Admin should manage:
- Settings
- Roles
- Permissions
- System configuration
- Integrations

---

# 3. Real Workforce Data

The system must support importing the real Boutiqaat schedule workbook.

Workbook sheets may include:
- Monthly schedules
- HC sheets
- Shifts
- Timing
- Outages

The Timing sheet is the official shift dictionary.

The system must parse and store:
- Shift codes
- Shift start/end
- Split shift start/end 2
- Working hours
- WFH flags
- Ramadan flags
- Cross-midnight flags
- Leave/absence codes
- Supervisor/responsible shift codes
- Shift categories

Employee matching must use employee ID.

---

# 4. Business Rules

## 4.1 Week
Week starts Saturday.

## 4.2 Shift Hours
- Regular agent shift = 9 hours including 1 hour break.
- Responsible/supervisor `20` shifts = 8 hours.
- Ramadan shifts may be 7 hours or split.
- Split shifts must be supported.
- Cross-midnight shifts must be supported.

## 4.3 Shift Codes
Support all real codes from Timing sheet.

Known:
- M, B, C, N, E, EE20, MD, MN
- M9/B9/C9/N9 etc.
- M20/B20/C20/N20
- AM
- R codes
- WFH variants
- OFF/H/L/SL/DL/RES/TER/COMP/UPL/COV
- S/A suffixes

## 4.4 Gender Rules
- Coverage first.
- Females normally up to C / 20:00.
- Females may work N if necessary.
- Females must not work MD/MN.
- Males can work any shift.
- Manual override allowed with warning.
- Rules configurable.

## 4.5 Rest
Minimum rest: 10 hours.

## 4.6 Published Schedule
Published schedule must not be overwritten.

---

# 5. Scheduling

Must include:
- Schedule grid
- Weekly/monthly views
- Manual editing
- Import/export
- Versioning
- Publish lock
- Validation
- Before/after impact
- Cross-midnight support
- Split shift support
- WFH support
- Ramadan support
- Fairness

---

# 6. Auto Schedule Generator

The generator must:
- Generate weekly/monthly
- Use real shift dictionary
- Meet coverage
- Respect skills
- Respect gender rules
- Respect rest
- Distribute OFF fairly
- Balance night/midnight
- Balance shift-rate
- Show gaps
- Show warnings
- Preview before publish

---

# 7. Shift Rate Distribution

Shift Rate = distribution of shift types.

For each employee:
- Morning/Day
- N/Night
- Evening
- Midnight
- WFH
- OFF/leave separately

Show:
- Count
- Percentage
- YTD
- Monthly
- Before/after edit
- Before/after swap

---

# 8. Attendance and Adherence

Must show:
- Punch late
- System late
- Early out
- Missing punch
- Missing system
- Overtime
- WFH/Office
- Working days
- Absence/sick/leave
- Daily/weekly/monthly/YTD
- Scheduled vs actual
- Adherence %

---

# 9. Requests and Approvals

Requests:
- Permission
- Sick
- Annual Leave
- Death Leave
- Comp Off
- Shift Swap
- OFF Swap
- Overtime
- Break
- University
- Technical Issue
- Outage
- Coaching

Every request must include:
- Before/after impact
- Approval chain
- SLA
- Audit
- Attachments if needed

Shift swap must include peer acceptance before TL/WFM approval.

---

# 10. Permission HC Impact

Every permission approval must calculate:
- Required HC
- Scheduled HC
- Permission HC
- Actual/Available HC
- Gap/surplus
- Impacted interval
- Risk level

---

# 11. Erlang and Capacity Planning

Voice:
- Erlang-C

Chat/WhatsApp/Social:
- Concurrency model
- Default concurrency = 4

Email:
- Backlog/throughput model

Interns:
- Productivity factor, default about 70%

Scenarios:
- Base
- Shrinkage
- OT
- Emergency

---

# 12. RTA and Live Monitoring

Must include:
- Live HC
- Queue status
- SLA risk
- Adherence
- Late/early
- Breaks
- Permissions
- Outages
- Technical issues
- Alerts

---

# 13. Outage Management

Track:
- Type
- Function/channel
- Start/end
- Duration
- Status
- Escalated by
- Validated by
- Owner
- Root cause
- Impact
- SLA
- Email automation

---

# 14. Technical Issue Workflow

Track:
- Case
- Customer impact
- Reason
- Validation
- Escalation
- IT owner
- Attachments
- SLA 48h
- CX issue if 20+ repeated

---

# 15. Scorecard and Coaching

Scorecard:
- Daily/weekly/monthly
- Agent/function/TL views
- Ranking
- KPI weights
- Coaching-needed flag
- Export

KPIs:
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

Coaching:
- 1v1
- Action plan
- Follow-up
- History

---

# 16. Cross-Skill

Skills:
- Voice
- Chat
- WhatsApp
- Email
- Social Media
- Customer Care
- Refund
- NPS

Need:
- Skill matrix
- Expiry alerts
- Coverage recommendations
- Training status

---

# 17. Chat and Notifications

Internal chat:
- Channels
- DMs
- Online status
- Outage auto-post

Notifications:
- Requests
- Schedule
- Attendance
- Outage
- Technical issue
- Coaching
- Scorecard
- Skill expiry

---

# 18. Audit and Compliance

Must audit all sensitive actions:
- User changes
- Schedule changes
- Approvals
- Imports
- Attendance edits
- Outage updates
- Technical issue updates
- Scorecard publish
- Settings changes

---

# 19. Acceptance Criteria

1. System builds without errors.
2. Authentication works.
3. Role-based navigation works.
4. Users can be imported with preview.
5. Real workbook can be imported.
6. Timing sheet populates shift dictionary.
7. Shifts sheet populates attendance.
8. Agent metrics use real data.
9. Admin metrics use real data.
10. Schedule grid supports manual edit.
11. Publish lock prevents overwrite.
12. Generator shows gaps honestly.
13. Female midnight rule enforced/warned.
14. Rest rule validated.
15. Shift-rate before/after works.
16. Permission HC impact works.
17. Erlang capacity works.
18. RTA dashboard shows live gaps.
19. Outage workflow works.
20. Technical issue SLA works.
21. Scorecard calculates correctly.
22. Coaching links to scorecard gaps.
23. Audit log records actions.
24. Attachments preview works.
25. Reports export.
26. Arabic/English works.
27. RTL/LTR works.
28. Light/Dark works.
29. No hidden mock data.
30. Production deployment ready.

---

# 20. Roadmap

1. Stabilize code
2. Real workbook parser
3. Attendance/adherence
4. Schedule management
5. Generator
6. Shift-rate/rotation
7. Permission HC
8. Capacity/Erlang
9. RTA
10. Outage/technical
11. Scorecard/coaching
12. Cross-skill
13. Chat/notifications
14. Audit/attachments
15. Deployment/integrations