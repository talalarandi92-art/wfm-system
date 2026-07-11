# Smart Break Management & Dynamic Auto-Scheduling Engine

Build a complete enterprise-grade Smart Break Management and Auto-Scheduling Engine inside the existing WFM project.

Do not treat this as a simple break request or approval feature.

## Current Operational Problem

- During high queue pressure, many employees request breaks at the same time.
- Supervisors must wait for one employee to return before approving the next employee.
- This creates a manual approval bottleneck.
- Agents complain that nobody responded to their break request.
- Some employees take breaks too frequently, while others wait too long.
- Some employees use reasons such as food orders or personal arrangements to pressure supervisors into approving an unsuitable break time.
- Entire groups or teams may try to go on break together, which creates a serious coverage risk.
- The current process is reactive, manual, unfair, and difficult to control.

The new solution must automatically generate, prioritize, release, delay, approve, and monitor breaks based on real-time operational conditions.

The highest priority must always be:

1. Function coverage.
2. Queue health.
3. Customer waiting time.
4. SLA and response-time protection.
5. Workload and backlog.
6. Fairness between employees.
7. Employee break entitlement.
8. Operational continuity.

The engine must be accurate, transparent, fair, configurable, and suitable for a 24/7 multi-function contact center.

---

# 1. Core Break Policy

Each employee has:

- Maximum 4 break sessions per working day.
- Total daily break entitlement: 60 minutes.
- The system must prevent the employee from exceeding:
  - 4 break sessions.
  - 60 total break minutes.
- Break entitlement must be configurable by:
  - Function.
  - Shift type.
  - Employment type.
  - Ramadan or special schedule.
  - Full-time, internship, part-time, or special contract.
  - Approved individual exception.

The default daily distribution may be configurable, for example:

- 15 + 15 + 15 + 15 minutes.
- 10 + 20 + 10 + 20 minutes.
- 15 + 30 + 15 minutes.
- Another approved configuration.

Do not hardcode one distribution.

The system must support a policy template for each function and shift.

---

# 2. Protected First and Last Hour

By default:

- No automatic break is allowed during the first hour of the employee’s shift.
- No automatic break is allowed during the final hour of the employee’s shift.

Example:

If an employee works from 09:00 to 18:00:

- Automatic breaks cannot be scheduled between 09:00 and 10:00.
- Automatic breaks cannot be scheduled between 17:00 and 18:00.

A break during these protected periods must require a manual exception request.

The request must:

- Show the employee’s reason.
- Show current function coverage.
- Show the operational impact.
- Require approval from the authorized role.
- Be recorded in the audit trail.
- Never automatically override critical coverage requirements.

Manual approval must not allow the employee to exceed the daily break entitlement unless a separate authorized exception is approved.

---

# 3. Dynamic Break Generation

The system must automatically generate planned break windows for each employee after the roster is generated.

Each employee must be able to see:

- Today’s total break entitlement.
- Number of breaks allowed.
- Breaks already completed.
- Break minutes already used.
- Remaining break minutes.
- Planned next break time.
- Planned break duration.
- Earliest possible release time.
- Latest safe break time.
- Current status of the next break.
- Reason for any delay.
- Estimated updated break time.

Generated break times are planned operational windows, not unconditional permission to leave the workstation.

Break release remains dependent on live operational conditions.

The employee should not need to repeatedly submit the same request or ask the supervisor when the break will be approved.

The break process must be fully dynamic:

- Generate a planned break time.
- Continuously recalculate the eligible window.
- Delay or advance the expected break time based on live queue and staffing conditions.
- Automatically release the next eligible employee when a safe slot becomes available.
- Update the employee immediately when the estimated time changes.

Example:

```text
Planned Break: 14:00
Current Status: Delayed due to queue pressure
Updated Expected Time: 14:12
Priority: High
Employees Ahead: 1
```

---

# 4. Function-Level Calculation

All break calculations must be performed separately for each function.

Functions may include:

- Inbound.
- Outbound.
- Live Chat.
- WhatsApp.
- Email.
- Social Media.
- Refund.
- Customer Care.
- OMT.
- NPS.
- Backoffice.
- Any future configurable function.

Do not use one global contact-center break calculation.

For every function, the system must evaluate its own:

- Required headcount.
- Scheduled headcount.
- Available headcount.
- Active working headcount.
- Employees currently on break.
- Employees about to return.
- Employees absent.
- Employees on sick leave.
- Employees on permission.
- Employees in coaching.
- Employees in meeting or training.
- Employees in outage or system issue status.
- Multi-skilled agents available to support.
- Queue waiting time.
- Queue volume.
- Oldest waiting contact.
- Backlog.
- SLA.
- Response time.
- Occupancy.
- AHT.
- Contact arrival rate.
- Forecast versus actual.
- Understaffing or overstaffing.
- Required buffer.
- Channel concurrency.

The engine must not assume that one agent has the same capacity in every function.

---

# 5. Queue-Aware and Workload-Aware Release

Break approval and release must be driven by live operational conditions.

The system must calculate whether releasing an employee now will keep the function within safe coverage.

A break may be automatically released only when all configured safety conditions are met.

Possible conditions include:

- Available headcount remains at or above minimum safe headcount.
- Coverage percentage remains above the configured threshold.
- Queue waiting time remains below the configured threshold.
- Oldest contact remains below the configured threshold.
- SLA remains protected.
- Occupancy remains below the critical threshold.
- Backlog remains manageable.
- Forecasted contact arrivals during the break window can be handled.
- Enough employees with the required skills remain available.
- No critical operational incident is active.
- No unexpected staffing loss has reduced capacity.
- The number of simultaneous breaks remains within the function limit.

Thresholds must be configurable by:

- Function.
- Channel.
- Day.
- Hour or interval.
- Peak versus non-peak.
- Campaign.
- Season.
- Emergency mode.
- Special event.

Do not use only the current queue count.

The decision should combine current state and near-term forecast.

---

# 6. Dynamic Break Capacity

For every interval, calculate:

- Maximum safe employees allowed on break.
- Employees already on break.
- Remaining available break slots.
- Employees scheduled to start break.
- Employees expected to return.
- Coverage before releasing the next break.
- Projected coverage after releasing the next break.
- Risk level after release.

Example:

```text
Required HC: 18
Working HC: 21
Minimum safety buffer: 2
Already on break: 1
Maximum safe simultaneous breaks: 1
Remaining break slots: 0
```

The system must not release another employee until:

- An employee returns.
- Additional capacity becomes available.
- Queue pressure decreases.
- Multi-skilled support becomes available.
- The supervisor activates an authorized exception.

The calculation must update in real time.

---

# 7. Fair Priority Engine

When multiple employees are waiting for a break, the system must use a transparent priority score.

Priority must not be first-come-first-served only.

The engine should prioritize employees based on factors such as:

1. Employee who has taken fewer break sessions today.
2. Employee who has used fewer total break minutes today.
3. Employee waiting the longest beyond the planned break window.
4. Employee with the longest continuous working time since the last break.
5. Employee whose last break was longest ago.
6. Employee whose break was previously delayed because of queue pressure.
7. Employee approaching the latest safe break deadline.
8. Employee whose shift ends sooner.
9. Fair rotation history over previous days.
10. Employees who did not receive their full entitlement on previous days, if company policy allows carry-forward fairness weighting.
11. Skill coverage impact.
12. Whether releasing the employee would remove a critical or unique skill from the function.

The following must reduce priority:

- Employee already took more break sessions than peers.
- Employee used more break minutes than peers.
- Employee recently returned from break.
- Employee repeatedly requests unscheduled breaks without an approved exception.
- Employee’s release would create a critical skill gap.
- Employee’s function is currently under pressure.
- Employee is assigned to a critical task or escalation.

The system must not permanently punish an employee.

Priority penalties must expire or reset based on clear policy.

---

# 8. Fairness Protections

The system must prevent:

- The same employee always receiving the earliest break.
- The same employee always receiving the latest break.
- Employees repeatedly taking breaks before others.
- Employees using multiple short breaks to bypass fairness.
- Supervisors favoring selected employees without an audit trail.
- Employees exceeding entitlement.
- Entire teams going on break together.
- A full skill group leaving together.
- All senior or escalation-capable employees leaving together.
- All employees of one language or specialization leaving together.
- Multiple employees from the same reporting group leaving simultaneously when this harms coverage.

Fairness must be measured over:

- The current day.
- The current week.
- The current month.
- Comparable shifts.
- Comparable functions.
- Comparable employee eligibility.

Create a fairness score and fairness dashboard.

---

# 9. Anti-Group and Anti-Clustering Controls

Do not allow complete groups, pods, teams, or skill clusters to go on break together.

The engine must understand organizational and skill relationships such as:

- Function.
- Team leader.
- Team.
- Skill.
- Channel.
- Language.
- Seniority.
- Escalation capability.
- Shift.
- Location.
- Work-from-home versus office.
- Critical assignment.

Configure limits such as:

- Maximum employees from the same team on break.
- Maximum percentage of one function on break.
- Maximum employees with the same critical skill on break.
- Minimum senior or escalation-capable employees remaining.
- Minimum agents remaining for each channel or queue.
- Minimum language coverage.

The engine must stagger break times automatically.

---

# 10. Planned Window Versus Actual Release

Each break must have:

- Planned start time.
- Planned end time.
- Earliest allowed start.
- Latest acceptable start.
- Actual release time.
- Actual return time.
- Planned duration.
- Actual duration.
- Delay duration.
- Delay reason.
- Release decision source.
- Approval source.
- Queue conditions at decision time.
- Coverage before and after release.

Use statuses such as:

- Planned.
- Upcoming.
- Eligible.
- Waiting for capacity.
- Temporarily delayed.
- Automatically released.
- Manually approved.
- On break.
- Return due.
- Returned.
- Overdue.
- Cancelled.
- Missed.
- Exception requested.
- Exception approved.
- Exception rejected.
- Rescheduled.

---

# 11. Delay Handling

When a planned break cannot be released because of operational pressure:

- Do not leave the employee without an update.
- Do not keep the request silently pending.
- Automatically change the status to “Delayed due to operational pressure.”
- Show the employee the current estimated new time.
- Preserve the employee’s priority.
- Increase priority gradually based on delay duration.
- Notify the employee when the break becomes close to release.
- Automatically release the break when a safe slot becomes available.
- Escalate if the break has been delayed beyond the maximum acceptable limit.

Configurable delay escalation examples:

- 10 minutes delayed: informational notice.
- 20 minutes delayed: priority increased.
- 30 minutes delayed: supervisor alert.
- 45 minutes delayed: manager or RTA escalation.
- Approaching latest safe break time: critical alert.

These values must be configurable.

---

# 12. Real-Time Event-Driven Reordering

The priority queue must recalculate whenever any important event happens, including:

- Employee starts break.
- Employee returns from break.
- Employee logs out unexpectedly.
- Absence or sick leave is recorded.
- Permission is approved.
- Queue volume increases.
- SLA drops.
- Waiting time increases.
- Backlog changes.
- New employee logs in.
- Multi-skilled support is moved.
- Outage starts or ends.
- Forecast changes.
- Supervisor changes staffing allocation.
- Roster or shift changes.
- Coaching or meeting begins or ends.

Do not require the supervisor to refresh the page manually.

Use real-time updates or the best available event mechanism in the project architecture.

---

# 13. Automatic Release Modes

Support configurable operating modes:

## Mode A — Fully Automatic

The system automatically releases the next eligible employee when all safety conditions are met.

## Mode B — Supervisor Confirmation

The system recommends the next employee, shows the impact, and the supervisor confirms.

## Mode C — Hybrid

The system automatically releases normal breaks but requires approval for:

- Protected first or last hour.
- Critical pressure.
- Manual exception.
- High-risk skill gap.
- Entitlement override.
- Emergency conditions.

## Mode D — Emergency Freeze

No new breaks are released except approved health or emergency exceptions.

Mode changes must be audited.

---

# 14. Employee Workflow

The employee experience must be simple.

The employee should see:

- Shift time.
- Planned break schedule.
- Next break countdown.
- Break eligibility.
- Number of employees ahead in the fair priority queue, without exposing unnecessary personal information.
- Current operational status.
- Any delay and reason.
- Estimated release time.
- Remaining break entitlement.
- Request exception button.
- Start break button only when released.
- Return from break button.
- Warning before break end.
- Overdue warning.

The employee must not be able to start an automatic break before the system releases it.

If technically required, unauthorized departure should be marked as:

- Unscheduled break.
- Unauthorized break.
- Adherence exception.

It must not silently count as an approved break.

---

# 15. Manual Exception Workflow

An employee may submit a manual request for cases such as:

- Urgent personal need.
- Health requirement.
- Prayer or approved religious need.
- Food delivery timing.
- Approved medical accommodation.
- Supervisor-directed operational reason.
- Other configurable reason.

The request must include:

- Requested time.
- Requested duration.
- Reason category.
- Optional comment.
- Optional attachment only where legally and operationally appropriate.
- Current entitlement.
- Operational impact.
- Coverage before and after approval.
- Queue status.
- Priority score.
- Previous exceptions today.

Approval roles may include:

- Team Leader.
- RTA.
- WFM.
- Operations Manager.

Approval must not be based only on the employee’s reason.

The system must show whether approving the exception creates:

- No risk.
- Low risk.
- Medium risk.
- High risk.
- Critical risk.

The approver must provide a reason when overriding a high or critical risk.

---

# 16. Supervisor and RTA Command Center

Create a real-time Break Command Center showing:

- Employees currently working.
- Employees currently on break.
- Employees waiting.
- Upcoming planned breaks.
- Delayed breaks.
- Overdue returns.
- Missed breaks.
- Exceptions.
- Function coverage.
- Required versus working HC.
- Maximum safe simultaneous breaks.
- Available break slots.
- Queue health.
- SLA.
- Waiting time.
- Backlog.
- Occupancy.
- Forecast versus actual.
- Pressure level.
- Employees recommended next.
- Priority score explanation.
- Projected operational impact.

The supervisor must be able to:

- View recommendations.
- Approve or delay.
- Activate emergency freeze.
- Release a selected employee with justification.
- Reschedule an upcoming break.
- Correct an incorrect status.
- View history and audit trail.
- Filter by function, shift, team, or location.

Do not allow silent manual reordering.

Any manual change must require a reason and be audited.

---

# 17. Break Optimization Engine

When generating the daily schedule, the system must optimize break timing based on:

- Forecasted workload.
- Required headcount by interval.
- Shift overlap.
- Employee skill.
- Function.
- Peak periods.
- Expected backlog.
- Historical arrival patterns.
- Expected AHT.
- Shrinkage.
- Planned meetings.
- Training.
- Coaching.
- Permissions.
- Approved leave.
- Multi-skill availability.
- Fairness history.

The optimizer must:

- Avoid peak intervals where possible.
- Spread breaks across the shift.
- Maintain reasonable spacing between breaks.
- Avoid clustering.
- Protect opening and closing hours.
- Prevent all employees from one group leaving together.
- Reserve some flexibility for real-time operational changes.
- Recalculate when the roster changes.

The generated schedule must be visible before publishing.

---

# 18. Recommended Spacing Rules

Create configurable controls such as:

- Minimum continuous work time before first break.
- Minimum time between two breaks.
- Maximum continuous work time without a break.
- Minimum time between returning from one break and requesting another.
- Maximum allowed delay beyond planned break.
- Minimum remaining shift time after final break.

Suggested examples must be configurable and not hardcoded.

The system should identify unhealthy or unfair patterns, such as:

- Four breaks taken early in the shift.
- Multiple breaks taken within a short period.
- All breaks delayed to the final part of the shift.
- Employee working too long continuously without a break.
- Employee repeatedly returning late.

---

# 19. Return Monitoring

The system must monitor actual return time.

For each break, calculate:

- Planned return time.
- Actual return time.
- Late return duration.
- Early return duration.
- Total consumed minutes.
- Remaining entitlement.
- Adherence impact.

Create reminders:

- 5 minutes before break end.
- 2 minutes before break end.
- At break end.
- After overdue threshold.

Repeated late returns must be reportable.

Do not automatically extend future breaks to compensate for late return.

---

# 20. Integration Requirements

The engine must integrate with the existing WFM components:

- Roster.
- Shift codes.
- Attendance.
- Real-time adherence.
- Live headcount.
- Forecasting.
- Capacity planning.
- Queue analytics.
- Sprinklr status where available.
- Login and logout status.
- Request management.
- Permissions.
- Sick leave.
- Absence.
- Coaching.
- Meetings.
- Training.
- Overtime.
- Outages.
- Notifications.
- Audit trail.
- Reporting.
- Excel export.

A change in one component must immediately reflect in all connected calculations.

Example:

If an employee becomes absent:

- Working HC decreases.
- Available break capacity recalculates.
- Upcoming breaks may be delayed.
- Priority queue updates.
- Command Center updates.
- Employees receive updated expected times.

---

# 21. Data Model

Design a clear data model covering at least:

## Break Policy

- Policy ID.
- Function.
- Shift type.
- Total entitlement.
- Maximum sessions.
- Allowed duration patterns.
- Protected first hour.
- Protected last hour.
- Minimum spacing.
- Maximum delay.
- Approval mode.
- Threshold configuration.

## Employee Daily Break Balance

- Employee ID.
- Date.
- Shift.
- Function.
- Entitled minutes.
- Used minutes.
- Remaining minutes.
- Sessions used.
- Sessions remaining.
- Continuous working time.
- Last break end time.
- Fairness score.

## Break Schedule

- Planned time.
- Earliest time.
- Latest time.
- Duration.
- Sequence number.
- Generated reason.
- Optimization version.

## Break Request and Execution

- Request time.
- Status.
- Priority.
- Delay.
- Actual start.
- Actual end.
- Approval source.
- Override reason.
- Coverage snapshot.
- Queue snapshot.

## Function Break Capacity

- Interval.
- Required HC.
- Working HC.
- Safe minimum HC.
- Maximum simultaneous breaks.
- Current breaks.
- Available slots.
- Risk level.

---

# 22. Priority Score Explainability

Do not create a hidden black-box priority score.

For every employee waiting, show an explanation such as:

```text
Priority score: 87

+25: No break taken during the last 3 hours
+20: Only 1 of 4 breaks used
+15: Planned break delayed by 22 minutes
+12: Shift ends in 2 hours
+10: Lowest break usage among eligible peers
+5: Previous break was delayed
-0: No critical skill coverage risk
```

The exact weights must be configurable.

Maintain a version history for scoring rules.

---

# 23. Risk Engine

Calculate a break release risk level:

- Green: Safe to release.
- Yellow: Release with caution.
- Orange: Supervisor confirmation required.
- Red: Do not release.
- Critical: Freeze breaks except authorized emergency.

Risk calculation should consider:

- Staffing gap.
- Coverage percentage.
- SLA.
- Waiting time.
- Oldest contact.
- Backlog.
- Occupancy.
- Forecasted arrivals.
- Skill gaps.
- Active outages.
- Employees expected to log out.
- Upcoming scheduled breaks.
- Return reliability.

Show why the current risk level was assigned.

---

# 24. Notifications

Create notifications for:

## Employee

- Break schedule generated.
- Break approaching.
- Break eligible.
- Break delayed.
- Updated expected time.
- Break released.
- Break ending soon.
- Break overdue.
- Exception approved or rejected.
- Entitlement nearly consumed.

## Supervisor, RTA, or WFM

- Break backlog increasing.
- Employee delayed beyond threshold.
- Employee overdue.
- Function has no safe break capacity.
- Too many manual exceptions.
- Repeated unauthorized breaks.
- High-risk override.
- Break fairness imbalance.
- Employees at risk of missing entitlement.

Avoid excessive notifications.

Use severity and escalation rules.

---

# 25. Reporting and Analytics

Build reports for:

- Break entitlement versus used.
- Average break approval or release time.
- Average delay.
- Employees whose breaks were delayed.
- Missed break entitlement.
- Breaks by function.
- Breaks by interval.
- Breaks by shift.
- Breaks by team.
- Breaks by supervisor.
- Manual versus automatic breaks.
- Exceptions.
- Unauthorized breaks.
- Late returns.
- Queue status at break release.
- Coverage before and after break.
- SLA impact.
- Fairness distribution.
- Employees taking frequent short breaks.
- Employees waiting too long.
- Peak break request times.
- Reasons for rejection or delay.
- Emergency freezes.
- Supervisor overrides.
- Break compliance.
- Historical pattern and trend.

Allow export to Excel.

---

# 26. Audit Trail

Every action must be auditable.

Record:

- Who generated the schedule.
- Generation time.
- Policy version.
- Forecast version.
- Original planned break.
- Every reschedule.
- Automatic decision.
- Manual decision.
- Approver.
- Override reason.
- Queue and coverage snapshot.
- Employee start and return.
- Delays.
- Notifications.
- Changes to entitlement.
- Changes to thresholds.
- Emergency mode activation.

Do not allow audit records to be overwritten.

---

# 27. User Interface Requirements

The UI must be modern, clear, responsive, and suitable for operational use.

Create:

1. Employee break card.
2. Daily break timeline.
3. Break Command Center.
4. Function coverage panel.
5. Priority waiting list.
6. Break capacity by interval.
7. Risk indicator.
8. Exception approval panel.
9. Fairness dashboard.
10. Break policy configuration.
11. Reports and analytics page.
12. Audit history view.

Use clear status colors, but do not rely on color alone.

Support Arabic and English.

Support desktop and mobile-responsive layouts.

---

# 28. Simulation and Preview

Before enabling the engine, create a simulation mode.

The user must be able to select:

- Date.
- Roster version.
- Function.
- Forecast.
- Policy.
- Pressure scenario.
- Absence scenario.
- Queue spike.
- Outage.
- Additional staffing.

The simulation must show:

- Generated break schedule.
- Coverage by interval.
- Break capacity.
- Employees delayed.
- Employees at risk of missing entitlement.
- Expected SLA impact.
- Fairness impact.
- Recommended adjustments.

The system must allow comparison between:

- Current manual process.
- Proposed automatic schedule.
- Alternative policy configurations.

---

# 29. Testing Requirements

Test at least these scenarios:

1. Normal low-pressure day.
2. High-pressure queue.
3. Many employees request simultaneously.
4. One employee has taken no breaks while another has taken several.
5. Employee requests during first shift hour.
6. Employee requests during final shift hour.
7. Full team attempts to go on break.
8. Critical skill group attempts to leave together.
9. Employee returns late.
10. Employee does not return.
11. Unexpected absence reduces coverage.
12. Queue spike after a break is planned.
13. Multi-skilled agent moves to another function.
14. Supervisor manually overrides priority.
15. Emergency freeze.
16. Ramadan or reduced-hours schedule.
17. Night shift crossing midnight.
18. Employee changes function during the shift.
19. Break entitlement configuration changes.
20. Roster is regenerated.
21. System receives delayed queue data.
22. Queue integration is unavailable.
23. Multiple employees have equal priority.
24. Employee risks missing all remaining breaks.
25. Entire function is understaffed all day.

Tests must confirm:

- No employee exceeds entitlement.
- No employee exceeds maximum sessions.
- Protected hours are enforced.
- Coverage is protected.
- Fairness works.
- Priority is explainable.
- Existing WFM modules remain connected.
- No duplicate or inconsistent break records are created.

---

# 30. Fail-Safe Behavior

If real-time queue data becomes unavailable:

- Do not assume the queue is safe.
- Use the most recent valid snapshot for a limited configurable time.
- Mark data as stale.
- Reduce automatic release confidence.
- Switch to supervisor-confirmation mode when required.
- Never silently continue full automation with invalid data.

If attendance or roster data is inconsistent:

- Flag the conflict.
- Prevent unsafe release.
- Show the source of inconsistency.

---

# 31. Implementation Approach

First audit the current WFM project and identify:

- Existing break management features.
- Existing request workflows.
- Roster integration.
- Live headcount logic.
- Queue data sources.
- Real-time update mechanism.
- Roles and permissions.
- Existing database models.
- Existing dashboards.
- Current audit logging.
- Current notification system.

Do not rebuild existing working components unnecessarily.

Reuse and improve the current architecture.

Then create:

1. Functional specification.
2. Business rules document.
3. Data model.
4. Priority scoring design.
5. Risk scoring design.
6. Scheduling algorithm.
7. Real-time decision flow.
8. UI design.
9. API design.
10. Permissions matrix.
11. Notification matrix.
12. Reporting catalogue.
13. Test plan.
14. Rollout and simulation plan.

After planning, implement the feature end-to-end.

Do not stop after writing documentation or mock screens.

---

# 32. Definition of Done

The task is complete only when:

- Break schedules are generated automatically.
- Each employee can see the next planned break.
- First and final shift hours are protected.
- Maximum 4 break sessions and 60 total minutes are enforced.
- Calculation is function-specific.
- Queue, workload, coverage, and pressure affect release decisions.
- Simultaneous break capacity is calculated dynamically.
- Fair priority is applied.
- Employees with fewer breaks receive higher priority.
- Groups and critical skills are protected from simultaneous breaks.
- Delayed employees receive updates automatically.
- The system releases the next safe eligible employee.
- Manual exceptions are supported and audited.
- Supervisor and RTA Command Center is available.
- Return and overdue monitoring work.
- Reports, dashboards, notifications, and Excel export work.
- All connected WFM calculations update in real time.
- Simulation mode works.
- Tests pass.
- Documentation is updated.
- No existing WFM feature is broken.

At the end, report:

- What already existed.
- What was missing.
- Root causes of the current bottleneck.
- Architecture implemented.
- Files created or modified.
- Database changes.
- APIs added.
- UI pages and components added.
- Priority and risk formulas.
- Tests executed and results.
- Remaining assumptions.
- Recommended rollout phases.
- Items requiring my approval.

Start by reading all project instructions and auditing the existing WFM break, roster, live headcount, queue, request, adherence, and reporting logic.

Then show the current-state flow, identify gaps, design the final architecture, implement it, test it, and document it completely.
