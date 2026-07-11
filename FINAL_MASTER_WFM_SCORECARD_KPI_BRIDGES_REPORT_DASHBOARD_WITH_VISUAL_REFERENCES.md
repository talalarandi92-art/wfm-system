# FINAL MASTER PROMPT — Automated WFM Scorecard, KPI, Sprinklr/Odoo Bridges, and Bridge Repair

> This is the final authoritative prompt for this project.
>
> It replaces all earlier scorecard, KPI, Sprinklr Bridge, Odoo Bridge, integration, and bridge-repair prompt versions.
>
> The Smart Break Management project remains separate and must not be merged into this scope.

## Non-Negotiable Execution Rule

Do not stop after analysis, documentation, recommendations, database design, API design, or UI mockups.

You must:

1. Audit the current project.
2. Preserve working functionality.
3. Identify gaps and root causes.
4. Design the final architecture.
5. Implement the approved local code changes.
6. Add tests.
7. Run the tests.
8. Fix failures.
9. Re-test.
10. Document the final implementation.
11. Update project indexes and knowledge files.
12. Provide exact remaining items that require real API details or user approval.

Do not claim completion for anything that was not implemented and tested.

---

Build a complete enterprise-grade automated performance, attendance, adherence, KPI, and scorecard engine inside the existing WFM project.

This is a separate project request from the Smart Break Management feature.

Do not merge this scope into the break-management module.

The goal is to eliminate manual daily report downloading, uploading, copying, consolidation, and scorecard preparation.

The system must automatically retrieve, validate, reconcile, calculate, store, aggregate, and present all required employee, team, function, attendance, adherence, survey, and performance data from Sprinklr and Odoo.

---

# 1. Source-of-Truth Files

Treat the following historical scorecard workbooks as the primary business reference for current KPIs, scoring grids, formulas, points, deductions, bonuses, rankings, and incentive logic:

- `1.Jan 26 SC..xlsx`
- `2.Feb 26 SC..xlsx`
- `3.Mar 26 SC..xlsx`
- `4.April 26 SC..xlsx`

Read every worksheet, formula, named range, lookup table, hidden sheet, supporting table, and monthly variation.

Do not rely only on visible column headers.

Extract and document:

- KPIs used by each function.
- KPI targets.
- Maximum points.
- Minimum points.
- Score grids.
- Negative points.
- Bonus points.
- Caps.
- Thresholds.
- Ranking logic.
- Incentive logic.
- Working Days percentage logic.
- Net Points logic.
- Function-specific scorecards.
- Weekly and monthly calculation differences.
- Changes between January, February, March, and April 2026.
- Broken formulas, `#N/A`, invalid references, duplicate columns, formatting errors, or scores incorrectly displayed as dates.

Do not overwrite the historical files.

Use them as test and validation references.

---

# 2. Known KPI Areas

The historical workbooks may include KPIs and fields such as:

- Working Days %.
- Net Points.
- Quality.
- Quality Score.
- Response Rate.
- PRR Rate.
- PRR Points.
- PRR Bonus.
- AHT.
- AHT Score.
- Success %.
- FCR.
- FCR Score.
- Productivity.
- Productivity Score.
- Call-to-Ticket Ratio.
- Call-to-Ticket Ratio Score.
- Quiz.
- Quiz Score.
- Common Mistakes.
- Mistakes Score.
- Response Time.
- Response Time Score.
- Contacts Handled.
- Attendance Commitment.
- Adherence.
- Unauthorized duration.
- Incidents.
- Ranking.
- Incentive Reward.

Do not assume this list is complete.

Discover the exact KPIs and formulas from the uploaded workbooks.

---

# 3. Function-Specific Scorecards

The engine must support different KPI structures by function.

Functions may include:

- Inbound.
- Outbound.
- Chat.
- WhatsApp.
- Email.
- Social Media.
- Refund.
- Customer Care.
- OMT.
- NPS.
- Backoffice.
- Other configurable future functions.

Do not force the same KPIs or weights on every function.

Examples:

## Inbound

May use:

- AHT.
- Talk Time.
- Hold Time.
- ACW.
- FCR.
- Contacts Handled.
- Occupancy.
- Quality.
- Quiz.
- Attendance.
- Adherence.
- Unauthorized status.

## Chat and WhatsApp

May use:

- First Response Time.
- Average Response Time.
- Concurrency.
- Contacts Handled.
- Resolution Time.
- FCR.
- Productivity.
- Quality.
- Adherence.

## Email and Social Media

May use:

- First Response Time.
- Response Rate.
- Resolved Rate.
- Resolution Time.
- Backlog.
- Handled Volume.
- Quality.
- Productivity.
- Survey results.
- Adherence.

## Refund, OMT, and Backoffice

May use:

- Productivity.
- Task completion.
- Aging.
- SLA.
- Backlog.
- Accuracy.
- Quality.
- Quiz.
- Attendance.
- Adherence.

The final KPI configuration must be derived from the actual scorecard files and approved business rules.

---

# 4. Sprinklr Agent Data Integration

Automatically retrieve agent-level data from Sprinklr through approved methods, including:

- Official API.
- Reporting API.
- Scheduled report API.
- Approved export endpoint.
- Existing Sprinklr Bridge.
- Approved data pipeline.

The user may provide Sprinklr report API details or report identifiers.

Retrieve where available:

- Agent ID.
- Sprinklr User ID.
- Employee ID.
- Agent name.
- Function.
- Team.
- Team Leader.
- Queue.
- Skill.
- Channel.
- Scheduled shift.
- System status.
- Login time.
- Logout time.
- First login.
- Last logout.
- All login sessions.
- Total logged-in duration.
- Productive time.
- Available time.
- Idle Time.
- Talk Time.
- Hold Time.
- ACW.
- Break Duration.
- Break Count.
- Ready Time.
- Not Ready Time.
- Auxiliary Status Time.
- Unauthorized Status Time.
- Contacts Offered.
- Contacts Accepted.
- Contacts Handled.
- Contacts Transferred.
- Contacts Resolved.
- Contacts Reopened.
- First Response Time.
- Average Response Time.
- Resolution Time.
- AHT.
- FCR.
- SLA.
- Response Rate.
- Resolved Rate.
- Productivity.
- Occupancy.
- Utilization.
- Adherence.
- Schedule Adherence.
- Conformance.
- Late Login.
- Early Logout.
- Missing Logout.
- Excessive ACW.
- Excessive Hold.
- Excessive Idle.
- Unauthorized Break.
- Daily Performance.

---

# 5. Daily Sprinklr Login and Logout

Automatically retrieve daily agent login and logout data from Sprinklr Reports.

The integration must:

- Pull the report automatically every day.
- Support intraday refresh where available.
- Store first login and last logout.
- Preserve all sessions.
- Calculate total logged-in duration.
- Handle multiple sessions.
- Handle missing logout.
- Handle night shifts crossing midnight.
- Handle duplicate records.
- Use the correct timezone.
- Use operational-day logic rather than calendar date only.
- Compare actual login and logout with scheduled shift.
- Retain source report and refresh metadata.

The user must not need to download and upload the report manually.

---

# 6. Odoo Attendance Integration

Use the existing Odoo Bridge or approved Odoo APIs to retrieve:

- Employee ID.
- Fingerprint check-in.
- Fingerprint check-out.
- First daily check-in.
- Last daily check-out.
- Multiple check-in and check-out records.
- Missing check-in.
- Missing check-out.
- Attendance corrections.
- Approved manual attendance.
- Work location.
- Work-from-home attendance.
- Employment status.
- Department.
- Manager.

Audit the existing Odoo Bridge before changing or rebuilding it.

---

# 7. Odoo Request Integration

Automatically retrieve approved and pending Odoo requests, including:

- Permission.
- Comp-off.
- Annual Leave.
- Sick Leave.
- Absence.
- Shift Change.
- Shift Swap.
- Off-Day Swap.
- Work From Home.
- Overtime.
- Coaching.
- Meeting.
- Training.
- University Schedule.
- Attendance Correction.
- Manual Check-In or Check-Out Correction.
- Approved Exception.

When a request is approved, automatically reflect it in:

- Roster.
- Attendance.
- Live Headcount.
- Adherence.
- Shrinkage.
- Daily Performance.
- Weekly Scorecard.
- Monthly Scorecard.
- Reports.
- Audit Trail.

Example:

If permission is approved from 14:00 to 15:00:

- Update the roster automatically.
- Reduce working headcount for the affected interval.
- Mark the time as authorized.
- Do not classify the approved time as unauthorized.
- Exclude or adjust the KPI impact according to policy.
- Show the request in the employee's daily attendance record.
- Update scorecard calculations automatically.

---

# 8. Authorized and Unauthorized Status Engine

Before classifying any period as unauthorized, compare:

- Sprinklr status timeline.
- Roster.
- Odoo attendance.
- Approved break.
- Approved permission.
- Approved comp-off.
- Approved leave.
- Approved sick leave.
- Approved coaching.
- Approved meeting.
- Approved training.
- Approved outage.
- Approved technical issue.
- Approved work from home.
- Approved operational assignment.
- Approved manual exception.

Unauthorized examples may include:

- Break without approval or system release.
- Extended break.
- Unapproved Not Ready or auxiliary status.
- Excessive Idle Time without approved activity.
- Late login without approval.
- Early logout without approval.
- Missing system login.
- Unscheduled logout.
- Missing working time without an approved request.
- System status not mapped to an approved request.

Each unauthorized record must show:

- Employee.
- Date.
- Start time.
- End time.
- Duration.
- Sprinklr status.
- Odoo request check result.
- Roster status.
- Reason.
- Rule version.
- Source records.
- Review status.
- Approver or reviewer.

---

# 9. Attendance and Source Reconciliation

For every employee and operational day, compare:

- Roster.
- Scheduled start and end.
- Sprinklr first login.
- Sprinklr last logout.
- Sprinklr status timeline.
- Odoo first check-in.
- Odoo last check-out.
- Odoo approved requests.
- Break records.
- Permission.
- Comp-off.
- Leave.
- Sick leave.
- Coaching.
- Meeting.
- Training.
- Outage.
- Work from home.
- Attendance correction.
- Manual adjustment.

Create reconciliation statuses:

- Fully Matched.
- Matched with Approved Exception.
- Source Data Delayed.
- Missing Sprinklr Data.
- Missing Odoo Data.
- Conflicting Records.
- Supervisor Review Required.
- Unauthorized Variance Confirmed.

Do not overwrite raw source records.

---

# 10. Employee Identity Mapping

Create a reliable identity mapping between:

- Odoo Employee ID.
- WFM Employee ID.
- Sprinklr Agent ID.
- Sprinklr User ID.
- Email.
- Function.
- Team.
- Team Leader.

Create:

- Identity Mapping Table.
- Unresolved Identity Queue.
- Duplicate Identity Warning.
- Historical Identity Mapping.
- Function Transfer History.

Do not merge employees based on name only.

---

# 11. Automated Daily Performance Table

Create one automatically populated daily performance record per employee.

Include at least:

- Date.
- Employee ID.
- Agent ID.
- Sprinklr User ID.
- Employee Name.
- Function.
- Team.
- Team Leader.
- Shift.
- Scheduled Start.
- Scheduled End.
- Odoo Check-In.
- Odoo Check-Out.
- Sprinklr First Login.
- Sprinklr Last Logout.
- Total Logged-In Time.
- Productive Time.
- Available Time.
- Idle Time.
- Break Time.
- Approved Break Time.
- Unauthorized Break Time.
- Talk Time.
- Hold Time.
- ACW.
- AHT.
- Contacts Offered.
- Contacts Accepted.
- Contacts Handled.
- Contacts Resolved.
- Contacts Transferred.
- First Response Time.
- Average Response Time.
- Resolution Time.
- FCR.
- SLA.
- Response Rate.
- Resolved Rate.
- Productivity.
- Occupancy.
- Utilization.
- Adherence.
- Schedule Adherence.
- Approved Permission Duration.
- Comp-Off Duration.
- Leave Duration.
- Coaching Duration.
- Meeting Duration.
- Training Duration.
- Outage Duration.
- Unauthorized Duration.
- Survey Yes Count.
- Survey No Count.
- Total Survey Responses.
- Survey Yes Percentage.
- Survey No Percentage.
- Quality.
- Quiz.
- Common Mistakes.
- Daily KPI Points.
- Daily Net Points.
- Data Completeness.
- Reconciliation Status.
- Review Status.

Do not require manual daily report upload.

---

# 12. Survey Yes and No Integration

Automatically retrieve Survey data from the approved Sprinklr Survey Report or API.

Calculate:

- Total Survey Responses.
- Yes Count.
- No Count.
- Yes Percentage.
- No Percentage.
- Positive Response Rate.
- Negative Response Rate.
- Daily Trend.
- Weekly Trend.
- Monthly Trend.

Verify how survey responses are attributed.

Possible attribution models:

- Handling Agent.
- Resolving Agent.
- Last Assigned Agent.
- Case Owner.
- Queue.
- Function.
- Team.

Do not include survey performance in an agent score until the attribution method is verified and documented.

Version the attribution rule.

---

# 13. KPI Registry

Create a central KPI Registry.

For every KPI, store:

- KPI ID.
- KPI Name.
- Function.
- Description.
- Source System.
- Source Report.
- Source Field.
- Formula.
- Unit.
- Target.
- Minimum Threshold.
- Maximum Threshold.
- Maximum Points.
- Minimum Points.
- Bonus Rule.
- Deduction Rule.
- Cap.
- Weight.
- Effective Start Date.
- Effective End Date.
- Formula Version.
- Scorecard Version.
- Approval Status.
- Owner.
- Notes.

Historical KPI rules must remain available.

Do not silently replace old formulas.

---

# 14. Automated Scorecard Engine

Automatically generate:

- Daily Scorecards.
- Weekly Scorecards.
- Monthly Scorecards.
- Employee Scorecards.
- Function Scorecards.
- Team Scorecards.
- Team Leader Scorecards.
- Ranking Reports.
- Incentive Reports.

The engine must support:

- Function-specific KPIs.
- Configurable weights.
- Configurable score grids.
- Positive points.
- Negative points.
- Bonus points.
- Maximum caps.
- Minimum thresholds.
- KPI exclusions.
- Approved exception treatment.
- Unauthorized status penalties.
- Working Days percentage.
- Net Points.
- Ranking.
- Incentive eligibility.
- Scorecard versioning.
- Formula versioning.
- Historical result preservation.
- Full explainability.
- Data completeness warnings.

---

# 15. Weekly and Monthly Aggregation

Automatically aggregate daily records into weekly and monthly periods.

Support the configured business week.

Default business week:

- Saturday to Friday.

Calculate:

- Scheduled Days.
- Working Days.
- Working Days %.
- Total Logged-In Time.
- Total Productive Time.
- Total Contacts Handled.
- Total Contacts Resolved.
- Weighted AHT.
- Weighted First Response Time.
- Weighted Response Time.
- Weighted SLA.
- FCR.
- Productivity.
- Occupancy.
- Adherence.
- Quality.
- Quiz.
- Common Mistakes.
- Survey Yes.
- Survey No.
- Total Unauthorized Duration.
- Total Approved Permission.
- Total Comp-Off.
- Total Break Time.
- Break Compliance.
- KPI Points.
- Bonus Points.
- Deductions.
- Net Points.
- Final Score.
- Ranking.
- Incentive Result.
- Data Completeness.
- Days Pending Reconciliation.

Do not use simple averages where weighted calculations are required.

---

# 16. Scorecard Explainability

Every scorecard result must show:

- KPI.
- Raw Value.
- Target.
- Calculation Grid.
- Points Earned.
- Maximum Points.
- Bonus.
- Deduction.
- Weight.
- Weighted Score.
- Source System.
- Source Report.
- Source Refresh Time.
- Included Records.
- Excluded Records.
- Approved Exception Impact.
- Unauthorized Impact.
- Formula Version.
- Scorecard Version.

Example:

```text
AHT: 04:12
Target: ≤ 04:00
Points: 5 / 10
Source: Sprinklr Agent Performance Daily
Handled Contacts: 184
Approved Outage Excluded: 32 minutes
Formula Version: Inbound Scorecard v3
```

---

# 17. Historical Workbook Reverse Engineering

For each historical workbook:

1. List every worksheet.
2. Identify function-specific sheets.
3. Identify weekly sheets.
4. Identify raw data sheets.
5. Identify supporting lookup tables.
6. Identify incentive sheets.
7. Identify ranking sheets.
8. Identify hidden sheets.
9. Extract formulas.
10. Extract scoring grids.
11. Extract thresholds.
12. Extract bonus and deduction rules.
13. Identify cross-sheet dependencies.
14. Identify broken references.
15. Identify month-to-month changes.
16. Recalculate sample employees.
17. Compare Excel output with system-calculated output.

Create a documented scorecard rulebook.

Do not copy spreadsheet errors into the new system without flagging them.

---

# 18. Historical Validation

Use January, February, March, and April 2026 as test periods.

For selected employees and functions:

- Reproduce the Excel KPI values.
- Reproduce KPI points.
- Reproduce Net Points.
- Reproduce Ranking.
- Reproduce Incentive Result.
- Explain any variance.
- Identify whether the variance comes from:
  - Data source difference.
  - Formula difference.
  - Missing records.
  - Spreadsheet error.
  - Rounding.
  - Weighting.
  - Monthly rule change.
  - Manual adjustment.

Do not activate automated scoring until validation reaches an approved accuracy threshold.

---

# 19. Data Quality Rules

Before scoring, validate:

- Employee identity matched.
- Required columns available.
- Timestamps valid.
- Timezone valid.
- Date range valid.
- Duplicate rows removed.
- Function mapping valid.
- Queue mapping valid.
- Metric unit valid.
- Duration is not negative.
- Cross-midnight logic applied.
- Approved requests not duplicated.
- Survey attribution valid.
- Daily aggregation complete.
- Weekly aggregation complete.
- Monthly aggregation complete.
- Formula version active.
- Scorecard version active.

Use statuses:

- Complete.
- Complete with Warning.
- Partial.
- Delayed.
- Invalid.
- Blocked from Scoring.

Do not silently score materially incomplete data.

---

# 20. Automated Refresh

Support:

- Near-real-time agent status where available.
- Intraday Sprinklr performance refresh.
- Daily Sprinklr login/logout refresh.
- Daily Odoo attendance refresh.
- Odoo request refresh after approval.
- End-of-day reconciliation.
- Weekly aggregation.
- Monthly aggregation.
- Historical backfill.
- Manual re-sync for authorized administrators.

For every source, store:

- Last Successful Refresh.
- Last Attempted Refresh.
- Data Freshness.
- Records Received.
- Records Accepted.
- Records Rejected.
- Validation Errors.
- Retry Count.
- Next Refresh.
- Source Health.
- API Status.

Use retry and backoff logic.

All imports must be idempotent.

---

# 21. API and Report Configuration

Create secure configuration for Sprinklr and Odoo integrations.

Allow configuration of:

- Connection Name.
- Source System.
- Report Name.
- Report ID.
- API Endpoint.
- Authentication Method.
- Refresh Frequency.
- Date Range Parameters.
- Pagination.
- Incremental Cursor.
- Expected Columns.
- Field Mapping.
- Metric Mapping.
- Function Mapping.
- Timezone.
- Data Owner.
- Active Status.
- Test Connection.
- Last Successful Pull.

Do not hardcode or expose:

- API Tokens.
- Session Cookies.
- Authentication Headers.
- Client Secrets.
- Passwords.

Use secure secret storage.

---

# 22. Integration Health Dashboard

Create a dashboard showing:

- Sprinklr API Health.
- Sprinklr Bridge Health.
- Odoo API Health.
- Odoo Bridge Health.
- Agent Status Feed.
- Login/Logout Report Freshness.
- Attendance Freshness.
- Request Freshness.
- Survey Freshness.
- Scorecard Refresh Status.
- Failed Records.
- Unmatched Employees.
- Missing Fields.
- Duplicate Records.
- Scorecards Pending Data.
- Retry Status.
- Current Incidents.
- Last Successful Synchronization.

Authorized users must be able to:

- Re-run Synchronization.
- Reprocess a Date.
- Resolve Identity Mapping.
- Review Rejected Records.
- Test API Connection.
- Pause Broken Integration.
- Resume Integration.
- Download Sanitized Error Report.

---

# 23. Historical Backfill

Support historical backfill by:

- Date Range.
- Employee.
- Function.
- Team.
- Report Source.
- Data Type.
- Scorecard Version.

Allow:

- Preview.
- Reconciliation.
- Recalculation.
- Variance Comparison.
- Preserve Historical Result.
- Authorized Replacement.

Backfill must not create duplicate daily records.

---

# 24. Audit Trail

Audit:

- Source Refresh.
- File Import.
- API Pull.
- Data Correction.
- Identity Mapping.
- KPI Rule Change.
- Scorecard Version Change.
- Formula Change.
- Manual Adjustment.
- Recalculation.
- Approval.
- Ranking Change.
- Incentive Change.
- Historical Backfill.

Audit records must be immutable.

---

# 25. User Interface

Create:

1. Daily Performance Page.
2. Employee Scorecard Page.
3. Weekly Scorecard Page.
4. Monthly Scorecard Page.
5. Function Scorecard Page.
6. Team Scorecard Page.
7. KPI Registry.
8. KPI Rule Builder.
9. Scorecard Version Manager.
10. Attendance Reconciliation Page.
11. Unauthorized Status Review Page.
12. Survey Dashboard.
13. Ranking Dashboard.
14. Incentive Dashboard.
15. Integration Health Dashboard.
16. Data Quality Dashboard.
17. Historical Comparison Page.
18. Audit History.

Support Arabic and English.

Support Excel export.

---

# 26. Required Tests

Test at least:

1. Valid Sprinklr daily performance report.
2. Sprinklr pagination.
3. Duplicate Sprinklr records.
4. Missing Sprinklr columns.
5. Delayed Sprinklr report.
6. Valid Odoo attendance.
7. Multiple Odoo check-ins and check-outs.
8. Missing checkout.
9. Night shift crossing midnight.
10. Approved permission explaining a gap.
11. Approved comp-off.
12. Approved WFH without fingerprint.
13. Unauthorized break.
14. Unauthorized system status.
15. Sprinklr login without Odoo fingerprint.
16. Odoo fingerprint without Sprinklr login.
17. Identity mismatch.
18. Survey Yes and No attribution.
19. Weighted AHT.
20. Weighted Response Time.
21. Weekly Scorecard.
22. Monthly Scorecard.
23. Function-specific KPI.
24. Formula Versioning.
25. Scorecard Versioning.
26. Historical Backfill.
27. Duplicate Prevention.
28. Retry and Stale Data.
29. Scorecard Blocked by Incomplete Data.
30. January Excel Validation.
31. February Excel Validation.
32. March Excel Validation.
33. April Excel Validation.
34. Net Points Validation.
35. Ranking Validation.
36. Incentive Validation.
37. Existing WFM Features Remain Functional.

---

# 27. Implementation Approach

Start by auditing:

- Existing WFM Performance module.
- Existing KPI logic.
- Existing Scorecard logic.
- Existing Sprinklr Bridge.
- Existing Odoo Bridge.
- Existing Attendance module.
- Existing Adherence module.
- Existing Roster integration.
- Existing Reporting.
- Existing Database schema.
- Existing API configuration.
- Existing Audit Trail.
- Existing User Roles.

Then:

1. Reverse engineer the historical workbooks.
2. Build the KPI Registry.
3. Build identity mapping.
4. Build source connectors.
5. Build raw staging.
6. Build normalization.
7. Build reconciliation.
8. Build daily performance records.
9. Build weekly and monthly aggregation.
10. Build scorecard calculation.
11. Build ranking and incentive logic.
12. Build reports and dashboards.
13. Build data-quality checks.
14. Build historical validation.
15. Test end to end.
16. Document everything.

Do not stop after documentation or UI mockups.

Implement the feature end to end.

---

# 28. Definition of Done

This project is complete only when:

- Historical scorecard files are fully analyzed.
- KPIs and formulas are documented.
- Function-specific scorecards are supported.
- Sprinklr performance data is pulled automatically.
- Sprinklr login/logout is pulled automatically.
- Odoo fingerprint data is pulled automatically.
- Odoo requests synchronize automatically.
- Approved requests update roster and calculations automatically.
- Unauthorized time is calculated only after approved-request checks.
- Daily performance records populate automatically.
- Survey Yes and No populate automatically.
- Weekly scorecards generate automatically.
- Monthly scorecards generate automatically.
- KPI rules are versioned.
- Scorecards are explainable.
- Ranking is automated.
- Incentive logic is automated.
- Data Quality is visible.
- Historical backfill works.
- January to April Excel results are validated.
- No manual daily report download or upload is required.
- Tests pass.
- Documentation and project indexes are updated.
- Existing WFM modules are not broken.

At the end, report:

- Historical files inspected.
- Sheets and formulas discovered.
- KPIs by function.
- Month-to-month rule changes.
- Broken spreadsheet logic found.
- Sprinklr Reports and APIs connected.
- Odoo APIs and Bridge components used.
- Source-to-field mappings.
- Identity mapping method.
- Refresh schedules.
- Reconciliation rules.
- Unauthorized-status rules.
- Daily performance schema.
- Weekly and monthly formulas.
- Survey attribution rule.
- KPI Registry.
- Scorecard versions.
- Ranking and incentive formulas.
- Historical validation results.
- Data Quality checks.
- Security controls.
- Tests and results.
- Remaining API details required from me.

Start by reading all project instructions and auditing the uploaded historical scorecard workbooks, current Sprinklr integration, current Odoo integration, current KPI logic, and current scorecard implementation.

---

# Mandatory KPI Calculation Clarifications

These rules are mandatory and override generic KPI assumptions.

## PRR — Positive Response Rate

```text
PRR % = Survey Yes Count ÷ Total Contacts × 100
```

Store:

- Total Contacts.
- Survey Yes Count.
- Survey No Count.
- Total Survey Responses.
- PRR %.
- PRR Points.
- PRR Bonus.

Do not calculate PRR as Yes divided by total survey responses unless a separately approved scorecard version explicitly requires it.

## Survey Response Rate

```text
Survey Response Rate % =
(Survey Yes Count + Survey No Count)
÷ Total Contacts × 100
```

Equivalent:

```text
Survey Response Rate % =
Total Survey Responses ÷ Total Contacts × 100
```

PRR and Survey Response Rate are separate KPIs and must never be mixed.

## QA

QA is received as a ready percentage from the approved Quality report.

The system must:

- Import the final QA percentage.
- Validate the period and employee.
- Validate minimum sample count if required.
- Detect duplicates.
- Convert QA percentage to points using the exact calculation grids in the January–April historical scorecards.

Do not invent a new QA formula.

## AHT

AHT scoring is function-specific.

The system must extract the exact duration bands and points from the historical scorecard sheets for each function.

Retain:

- Total Handle Time.
- Contacts Handled.
- Talk Time.
- Hold Time.
- ACW.
- AHT.
- Function.
- Target.
- Score Band.
- Points.
- Formula Version.

Do not apply one AHT target or scoring grid to every function.

## CTR — Contact-to-Ticket Ratio

Business definition supplied:

```text
CTR % = Total Contacts ÷ Total Tickets × 100
```

Store both raw values and the calculated percentage.

Because the ratio direction materially changes the result, compare this definition with the formulas in all historical scorecard sheets.

If a historical sheet uses Tickets ÷ Contacts, document the discrepancy and require approval before activation.

Never hide or silently reverse the ratio.

## FCR

```text
FCR % = Closed Tickets ÷ Total Tickets × 100
```

Store:

- Total Tickets.
- Closed Tickets.
- Open Tickets.
- Reopened Tickets where available.
- FCR %.
- FCR Points.

Verify from the historical scorecards and business process:

- What qualifies as closed.
- Whether reopened tickets affect FCR.
- Whether the same agent must close the ticket.
- Whether the denominator is created, assigned, or handled tickets.
- Whether function-specific rules exist.

## Quiz

Quiz is received as a ready score or percentage.

Convert it to points using the exact scoring grids in the historical scorecard sheets.

Do not create a new Quiz points table unless approved.

## Productivity

The current Productivity formula and points must be reverse-engineered from the historical scorecard files.

Study:

- Numerator.
- Denominator.
- Function differences.
- Approved shrinkage treatment.
- Logged-in time.
- Productive time.
- Scheduled time.
- Contacts or tasks handled.
- Target volume.
- Meetings, coaching, training, permission, outage, leave, and system issue exclusions.

Deliver:

1. Current formula by function.
2. Existing percentage bands and points.
3. Weaknesses or unfairness.
4. Recommended formula.
5. January–April historical impact simulation.
6. Approval requirement before replacing the active rule.

Do not activate a redesigned Productivity formula automatically.

## Conformance %

Add Conformance as a formal KPI and daily metric.

Recommended base definition:

```text
Conformance % =
Actual Accounted Working Time
÷ Scheduled Required Working Time
× 100
```

Actual Accounted Working Time may include:

- Productive Sprinklr time.
- Approved operational work.
- Approved coaching.
- Approved meeting.
- Approved training.
- Approved outage or technical issue time.
- Other approved paid activity.

It must exclude or separately classify:

- Unauthorized break.
- Unauthorized idle.
- Unapproved Not Ready.
- Missing login time.
- Unapproved late login.
- Unapproved early logout.
- Unapproved absence.

Show:

- Gross Conformance.
- Adjusted Conformance after approved exceptions.

Conformance must be configurable, explainable, and versioned.

## Adherence %

Adherence measures whether the employee followed the scheduled activity at the correct time.

Recommended base definition:

```text
Adherence % =
Time in Adherent Status
÷ Scheduled Time Requiring Adherence
× 100
```

Adherence must compare:

- Roster.
- Shift.
- Planned breaks.
- Approved requests.
- Approved activities.
- Sprinklr status timeline.
- Login and logout.
- Odoo attendance.

Attendance, Adherence, Conformance, and Productivity must remain separate metrics.

---

# Unified Roster and Daily Performance View

Create one connected view showing roster, attendance, approved requests, system activity, performance, and automatic scoring together.

For every employee and date, show:

## Employee and Roster

- Employee ID.
- Name.
- Function.
- Team.
- Team Leader.
- Shift Code.
- Scheduled Start.
- Scheduled End.
- Work Mode.
- Roster Status.
- Leave or Request Code.

## Attendance and System

- Odoo First Check-In.
- Odoo Last Check-Out.
- Sprinklr First Login.
- Sprinklr Last Logout.
- Late Login.
- Early Logout.
- Missing Login.
- Missing Logout.
- Scheduled Time.
- Actual Accounted Time.
- Attendance Status.

## Approved Activities

- Permission.
- Comp-Off.
- Leave.
- Sick Leave.
- Coaching.
- Meeting.
- Training.
- Outage.
- Technical Issue.
- Approved Break.
- Manual Adjustment.

## Daily Performance and KPI

- Total Contacts.
- Survey Yes.
- Survey No.
- Total Survey Responses.
- PRR %.
- Survey Response Rate %.
- QA %.
- AHT.
- CTR %.
- Total Tickets.
- Closed Tickets.
- FCR %.
- Quiz %.
- Productivity %.
- Adherence %.
- Conformance %.
- Unauthorized Duration.
- KPI Points.
- Net Points.
- Daily Score.

## Data Status

- Data Completeness.
- Reconciliation Status.
- Source Freshness.
- Review Required.
- Last Update.
- Calculation Version.

Support:

- Daily, weekly, and monthly views.
- Function, team, Team Leader, shift, and employee filters.
- Unauthorized and exception filters.
- Formula drill-down.
- Source drill-down.
- Excel export.

The roster, performance, and score must update together when any connected Sprinklr or Odoo data changes.

---

# Automatic Daily, Weekly, and Monthly Calculation

Generate the daily score automatically after all required data is validated.

Use statuses:

- Preliminary.
- Pending QA.
- Pending Quiz.
- Pending Survey.
- Pending Attendance Reconciliation.
- Complete.
- Complete with Warning.
- Blocked.
- Final.

Do not treat missing data as zero.

For weekly and monthly aggregation, recalculate ratios from period totals.

Use:

```text
Period PRR % =
Total Survey Yes ÷ Total Contacts × 100
```

```text
Period Survey Response Rate % =
(Total Survey Yes + Total Survey No)
÷ Total Contacts × 100
```

```text
Period FCR % =
Total Closed Tickets ÷ Total Tickets × 100
```

```text
Weighted AHT =
Total Handle Time ÷ Total Contacts Handled
```

Do not average daily percentages where total-based weighted calculations are required.

---

# Additional Definition of Done

The system is not complete until:

- PRR uses Yes ÷ Total Contacts.
- Survey Response Rate uses Yes + No ÷ Total Contacts.
- Both metrics remain separate.
- QA points match the historical sheets.
- AHT points are function-specific and match historical sheets.
- CTR formula direction is verified and versioned.
- FCR uses Closed Tickets ÷ Total Tickets with verified ticket rules.
- Quiz points match the historical sheets.
- Productivity is studied before redesign.
- Conformance is added.
- Adherence and Conformance remain separate.
- Roster and daily performance are shown in one connected view.
- Daily score is automatic.
- Weekly and monthly scorecards are automatic.
- Ratio metrics aggregate from period totals.
- All calculations are explainable and source-backed.

---

# Mandatory Bridge Architecture and Existing Bridge Reuse

The existing Sprinklr Bridge and Odoo Bridge are part of this same scorecard and KPI project.

Do not treat the bridges as separate future work.

Audit and reuse the current bridges before creating new connectors.

## Sprinklr Bridge

The Sprinklr Bridge must be used or improved to retrieve approved operational data automatically, including where available:

- Agent identity.
- Agent status timeline.
- Queue and function mapping.
- Daily first login.
- Daily last logout.
- Multiple login sessions.
- Total logged-in duration.
- Talk Time.
- Hold Time.
- ACW.
- Idle Time.
- Break Duration.
- Contacts Handled.
- Tickets Created.
- Tickets Closed.
- First Response Time.
- AHT.
- FCR.
- Occupancy.
- Productivity.
- Adherence.
- Conformance.
- Survey Yes.
- Survey No.
- Survey Response Count.
- Additional agent-performance fields exposed by Sprinklr Reports or APIs.

The user may provide approved Sprinklr Report APIs.

The system must support:

- Official report APIs.
- Scheduled report endpoints.
- Existing Bridge interception or approved retrieval.
- Secure API configuration.
- Pagination.
- Incremental refresh.
- Daily and intraday synchronization.
- Data freshness monitoring.
- Retry and backoff.
- Duplicate prevention.
- Raw staging.
- Normalization.
- Source lineage.

Do not store authentication tokens, cookies, session secrets, message content, or sensitive customer data.

## Odoo Bridge

The Odoo Bridge must be used or improved to retrieve automatically:

- Employee master data.
- Employee ID.
- Fingerprint check-in.
- Fingerprint check-out.
- First check-in.
- Last check-out.
- Multiple attendance sessions.
- Permission.
- Comp-Off.
- Annual Leave.
- Sick Leave.
- Absence.
- Shift Change.
- Shift Swap.
- Off-Day Swap.
- Work From Home.
- Overtime.
- Coaching.
- Meeting.
- Training.
- Attendance Correction.
- Approved Exception.
- Request approval status.
- Request start and end time.
- Department.
- Manager.
- Work location.

The Odoo Bridge must synchronize approved requests into:

- Roster.
- Attendance.
- Daily Performance.
- Adherence.
- Conformance.
- Unauthorized Status.
- Live Headcount.
- Shrinkage.
- Weekly Scorecard.
- Monthly Scorecard.
- Reports.
- Audit Trail.

## Bridge Identity Mapping

Create one bridge identity map linking:

- Odoo Employee ID.
- WFM Employee ID.
- Sprinklr Agent ID.
- Sprinklr User ID.
- Email.
- Function.
- Team.
- Team Leader.

Do not merge records by employee name only.

Create:

- Identity Mapping Table.
- Unresolved Mapping Queue.
- Duplicate Mapping Warning.
- Historical Mapping.
- Function Transfer History.

## Bridge Health and Monitoring

Create a Bridge Health Dashboard showing:

- Sprinklr Bridge status.
- Odoo Bridge status.
- Last successful sync.
- Last attempted sync.
- Data freshness.
- Records received.
- Records accepted.
- Records rejected.
- Duplicate records.
- Unmatched employees.
- Missing required fields.
- Retry count.
- Current errors.
- Scorecards waiting for data.
- Daily performance records waiting for reconciliation.

Authorized users must be able to:

- Test a connection.
- Re-run synchronization.
- Reprocess a date.
- Resolve identity mapping.
- Review rejected records.
- Pause a broken connector.
- Resume a connector.
- Download a sanitized diagnostic report.

## Bridge-to-Scorecard Data Flow

The final data flow must be:

```text
Sprinklr Reports / Sprinklr Bridge
                +
Odoo APIs / Odoo Bridge
                +
Historical Scorecard Rules
                +
Roster and Approved Requests
                ↓
Raw Staging
                ↓
Validation
                ↓
Identity Mapping
                ↓
Normalization
                ↓
Attendance and Status Reconciliation
                ↓
Daily Performance Record
                ↓
KPI Calculation
                ↓
Daily Score
                ↓
Weekly and Monthly Aggregation
                ↓
Ranking and Incentive
                ↓
Unified Roster and Performance View
```

Do not require manual downloading or uploading of daily reports after the integrations are activated.

## Bridge Definition of Done

The bridge scope is complete only when:

- Sprinklr data is pulled automatically.
- Odoo data is pulled automatically.
- Approved requests synchronize automatically.
- Daily login and logout are available.
- Fingerprint check-in and check-out are available.
- Employee identity is matched reliably.
- Unauthorized time is calculated only after checking approved requests.
- Daily performance is automatically populated.
- KPI values use source-backed raw data.
- Weekly and monthly scorecards update automatically.
- Bridge health and data freshness are visible.
- Failed mappings and rejected records are reviewable.
- No manual daily report download or upload is required.

---

# Mandatory Sprinklr Bridge Repair

Repair the existing Sprinklr Bridge as part of this same KPI and Scorecard project.

This repair is mandatory and must not be treated as separate future work.

## Known Issue

- Agent discovery works and detects approximately 126 agents.
- Queue discovery is broken and always returns 0 queues.
- Sprinklr may use both the legacy Assignment Engine and Unified Routing.
- The current Bridge may depend on outdated GraphQL operation names, fixed JSON paths, incorrect filters, broken storage, or failed message passing.

The goal is to identify the exact root cause, repair queue discovery, preserve agent discovery, and make the Bridge reliable enough to feed the WFM, KPI, attendance, adherence, conformance, and scorecard modules.

## Inspect the Entire Bridge

Audit:

- `manifest.json`
- Background service worker or `background.js`
- `content.js`
- Injected scripts
- `popup.js`
- Fetch interception
- XMLHttpRequest interception
- GraphQL request and response parsing
- Queue extraction
- Queue filtering
- Queue normalization
- Queue deduplication
- Agent discovery
- Chrome storage
- Message passing
- Popup rendering
- Debug logging
- Permissions
- Content Security Policy

Document the current data flow before changing code.

## Find the Root Cause

Check whether:

1. Queue-related GraphQL traffic is intercepted.
2. The Bridge watches outdated operation names.
3. Queue data arrives through `fetch`, `XMLHttpRequest`, WebSocket, or another transport.
4. Responses are cloned before parsing.
5. Parsing errors are swallowed silently.
6. Queue data is located under:
   - `data.queues`
   - `data.records`
   - `data.items`
   - `data.edges[].node`
   - `data.routingQueues`
   - `data.workQueues`
   - `data.assignmentQueues`
   - another nested structure.
7. Pagination prevents full discovery.
8. Queues only load after opening a specific Sprinklr page.
9. Filters remove valid queues.
10. Legacy Assignment Engine queues are unsupported.
11. Unified Routing queues are unsupported.
12. Voice, digital, case, inactive, or work queues are incorrectly excluded.
13. Normalization produces empty IDs or names.
14. Deduplication removes all queues.
15. Message passing fails between injected script, content script, service worker, and popup.
16. Manifest V3 service-worker suspension causes data loss.
17. Popup reads the wrong storage key.
18. Workspace or environment filtering is incorrect.

## Required Repair

Do not implement a one-path hardcoded fix.

Build a resilient queue-discovery architecture.

### Network Capture

Support safely:

- `window.fetch`
- `XMLHttpRequest`

Clone responses before reading.

Do not break Sprinklr network behavior.

Capture only safe metadata:

- Request URL
- GraphQL operation name
- Response top-level keys
- Current page
- Timestamp
- Detection source

Do not store:

- Tokens
- Cookies
- Authentication headers
- Session secrets
- Customer content
- Sensitive employee content

### Flexible Queue Extraction

Use bounded recursive extraction instead of relying on one fixed path.

Support:

- Arrays
- Nested objects
- `edges/node`
- `records`
- `items`
- Legacy Assignment Engine
- Unified Routing

Use safeguards:

- Maximum recursion depth
- Maximum object count
- Response-size limit
- Processing time limit

Identify likely queue records using combinations of:

- `id`
- `queueId`
- `name`
- `queueName`
- `displayName`
- `queueType`
- `routingType`
- `workQueueType`
- `channel`
- `channelType`
- `status`
- `active`
- `workspaceId`

Do not require every field.

### Queue Normalization

Normalize detected queues into:

```javascript
{
  id: "",
  name: "",
  routingEngine: "legacy | unified | unknown",
  queueType: "",
  channel: "",
  status: "",
  workspaceId: "",
  sourceOperation: "",
  sourcePath: "",
  detectedAt: "",
  rawFieldNames: []
}
```

### Deduplication

Deduplicate by:

1. Queue ID.
2. Workspace ID + name + channel + routing engine.
3. Stable fallback fingerprint.

Do not remove different queues only because they share a display name.

### Storage and UI

Ensure:

- Queue data survives service-worker suspension.
- Storage keys are consistent.
- Queue count updates.
- Popup reads the latest data.
- Refresh and clear work.
- Error states are different from a valid zero result.

Display:

- Total queues
- Legacy queues
- Unified Routing queues
- Unknown routing-type queues
- Queue name
- Queue ID
- Channel
- Status
- Source operation
- Last detected time

Add diagnostic states:

- No queue traffic captured
- Queue traffic captured but no candidates found
- Candidates found but rejected
- Queues detected successfully
- Parsing error
- Storage error
- Message-passing error
- Popup rendering error

## Safe Debug Mode

Create a debug mode disabled by default.

When enabled, log only:

- GraphQL operation names
- Candidate paths
- Candidate scores
- Rejection reasons
- Counts before and after deduplication
- Storage results
- Message-passing results

Do not log full responses or sensitive values.

## Tests

Create sanitized tests for:

1. Direct `data.queues`
2. Nested `records`
3. `edges[].node`
4. Legacy queue
5. Unified Routing queue
6. Multiple channels
7. Duplicate names with different IDs
8. Same queue from multiple operations
9. Missing optional fields
10. Empty response
11. Invalid JSON
12. Large nested response
13. Pagination
14. Storage persistence
15. Popup count
16. Message passing
17. Agent discovery regression
18. Valid zero-result state
19. Rejected-candidate state
20. Queue and agent data together

Do not use production data in fixtures.

## Manual Verification

Prepare a checklist showing:

1. How to reload the unpacked extension.
2. Which Sprinklr pages may trigger queue traffic.
3. How to enable diagnostics.
4. How to confirm queue operations were captured.
5. How to distinguish:
   - no network request
   - extraction failure
   - filter failure
   - storage failure
   - popup failure
6. How to export a sanitized diagnostic summary.
7. How to confirm agent discovery still works.
8. How to confirm legacy and Unified Routing queues.

Do not request tokens, cookies, or complete production responses.

## Bridge Repair Definition of Done

The repair is complete only when:

- The exact root cause of 0 queues is documented.
- Queue traffic is detected.
- Queues are extracted from multiple response shapes.
- Legacy and Unified Routing queues are distinguished where possible.
- Queue data is normalized and deduplicated.
- Storage and popup display work.
- Diagnostics identify the failure stage.
- Tests pass.
- Existing agent discovery still works.
- No sensitive production data is stored.
- Bridge documentation is updated.
- The repaired Bridge feeds the WFM and Scorecard pipeline automatically.

At the end, report:

- Root cause
- Files inspected
- Files modified
- Queue-discovery architecture
- Tests and results
- Manual verification steps
- Remaining assumptions
- Items requiring approval

---

# Final Completeness and Execution Controls

The following controls are mandatory and must be applied across the entire implementation.

## A. Source-to-Field Mapping Catalogue

Create a permanent mapping catalogue for every connected report and API.

For every source, document:

- Source system.
- Bridge or connector.
- Report name.
- Report ID.
- API endpoint alias.
- Authentication type.
- Refresh frequency.
- Pagination method.
- Incremental key or cursor.
- Source timezone.
- Operational-day rule.
- Raw column name.
- Normalized field name.
- Data type.
- Unit.
- Function applicability.
- KPI usage.
- Required or optional status.
- Null handling.
- Duplicate key.
- Validation rule.
- Transformation rule.
- Historical availability.
- Data owner.
- Last verified date.

Create mappings at minimum for:

- Sprinklr agent performance.
- Sprinklr login and logout.
- Sprinklr agent status timeline.
- Sprinklr queue data.
- Sprinklr contacts handled.
- Sprinklr tickets created and closed.
- Sprinklr survey Yes and No.
- Sprinklr QA report, if available there.
- Odoo employee master.
- Odoo fingerprint attendance.
- Odoo permissions.
- Odoo comp-off.
- Odoo leave and sick leave.
- Odoo WFH.
- Odoo attendance corrections.
- Odoo coaching, meetings, and training.
- Historical scorecard workbooks.

Do not activate a connector before its mapping has been validated.

## B. Raw, Normalized, and Calculated Data Separation

Maintain three clear data layers:

### Raw Layer

Store the original source records in a secure staging structure.

Raw records must include:

- Source.
- Report or API identifier.
- Pull timestamp.
- Source record identifier.
- Source period.
- Raw payload reference or approved sanitized fields.
- Hash or idempotency key.
- Import batch ID.

Do not mutate raw records after ingestion.

### Normalized Layer

Store standardized records for:

- Employee identity.
- Attendance.
- System sessions.
- Status intervals.
- Contacts.
- Tickets.
- Surveys.
- QA.
- Quiz.
- Requests.
- Approved activities.
- Daily performance.

### Calculated Layer

Store:

- KPI results.
- Points.
- Bonuses.
- Deductions.
- Daily score.
- Weekly score.
- Monthly score.
- Ranking.
- Incentive results.
- Formula version.
- Scorecard version.
- Calculation timestamp.

Do not mix raw and calculated values in the same source field.

## C. Operational-Day and Cross-Midnight Rules

Use operational-day logic for all shifts.

The system must correctly handle:

- Evening shifts ending after midnight.
- MD and MN shifts.
- Login before midnight and logout after midnight.
- Multiple sessions across two calendar dates.
- Odoo fingerprint records crossing midnight.
- Requests spanning midnight.
- Scorecard attribution to the scheduled shift date.
- Duplicate date allocation prevention.

Document the final operational-day rule and test it.

## D. Employee Function and Transfer History

Preserve employee history.

When an employee transfers between functions or teams:

- Do not rewrite historical performance.
- Apply the correct function and scorecard version by effective date.
- Preserve previous Team Leader and function attribution.
- Recalculate only the affected period when authorized.
- Show mixed-function periods clearly.
- Prevent one function’s KPI grid from being applied to another function’s historical data.

## E. KPI Missing-Data Rules

For every KPI, define the difference between:

- Genuine zero.
- No activity.
- Missing source data.
- Source delayed.
- Not applicable.
- Excluded by approved policy.
- Below minimum sample.
- Pending review.
- Invalid.

Never convert missing data automatically into zero points unless the approved business rule explicitly requires it.

## F. Minimum Sample and Eligibility Rules

Support minimum eligibility rules such as:

- Minimum Working Days %.
- Minimum handled contacts.
- Minimum ticket count.
- Minimum QA evaluations.
- Minimum survey responses.
- Minimum quiz participation.
- Minimum logged-in duration.
- Employee active status.
- New joiner or training period.
- Function transfer period.
- Leave or extended absence.

Ranking and incentive calculations must show whether an employee is eligible.

## G. Manual Adjustment Governance

Allow manual correction only for authorized roles.

Every manual adjustment must require:

- Employee.
- Period.
- KPI or source record.
- Original value.
- New value.
- Reason.
- Evidence reference.
- Requester.
- Approver.
- Timestamp.
- Expiration or permanence.
- Recalculation impact.

Never overwrite the original value.

Store adjustments as a separate auditable layer.

## H. Scorecard Publication and Freeze

Support scorecard lifecycle statuses:

- Draft.
- Calculating.
- Waiting for Data.
- Waiting for Review.
- Preliminary.
- Approved.
- Published.
- Frozen.
- Reopened.
- Corrected.

After publication:

- Preserve the published version.
- Do not silently change historical results after a late API refresh.
- Show late-arriving data separately.
- Require authorized reopen and republish.
- Keep both previous and corrected versions.

## I. Ranking and Incentive Controls

Ranking must support:

- Function-level ranking.
- Team-level ranking.
- Overall ranking only when KPIs are comparable.
- Tie-breaking rules.
- Eligibility rules.
- Minimum Working Days %.
- Data completeness.
- Approved exclusions.
- Function transfers.
- New joiners.
- Employees with disciplinary or policy exclusions, only where approved.
- Published scorecard version.

Do not rank incomparable functions together without a normalized approved method.

Incentive calculation must be separate from KPI scoring and fully auditable.

## J. Privacy and Access Control

Apply least-privilege access.

At minimum:

- Agent: own performance and scorecard.
- Team Leader: assigned team.
- RTA: operational attendance, adherence, status, and authorized performance views.
- WFM: roster, attendance, adherence, conformance, reconciliation, and scorecard operations.
- Quality: QA-related data.
- HR: authorized attendance and employee records.
- Operations Manager: authorized function and overall views.
- Integration Admin: connector health and mappings, not unrestricted business data.
- System Admin: configuration access.

Mask secrets and sensitive raw data.

Do not expose customer content or unnecessary personal data.

## K. API Failure and Stale-Data Behavior

If an API, Bridge, or report fails:

- Mark the source as stale.
- Show last valid refresh time.
- Do not assume missing data is zero.
- Pause affected final scoring where necessary.
- Continue unaffected KPIs where safe.
- Retry with controlled backoff.
- Alert the authorized owner.
- Preserve the failed batch and diagnostic reason.
- Allow safe reprocessing.

## L. Performance and Scale

Design for:

- Daily agent-level records.
- Multiple functions.
- Multiple years of history.
- Intraday refreshes.
- Weekly and monthly aggregation.
- Backfill.
- Recalculation.
- Concurrent dashboard usage.

Use:

- Indexed queries.
- Incremental pulls.
- Idempotent upserts.
- Background jobs.
- Batch processing.
- Cached aggregates where appropriate.
- Pagination.
- Processing limits.
- Monitoring.

Do not repeatedly recalculate all historical data for one new daily record.

## M. Mandatory Implementation Phases

Execute in phases, but continue through implementation unless a real credential, production permission, or business approval is required.

### Phase 1 — Audit and Reverse Engineering

- Audit current code.
- Audit Sprinklr Bridge.
- Audit Odoo Bridge.
- Audit historical scorecards.
- Document existing data flow.
- Identify missing and broken components.
- Identify security risks.
- Identify duplicated logic.

### Phase 2 — Bridge Repair

- Repair Sprinklr queue discovery.
- Confirm agent discovery regression safety.
- Validate storage and message passing.
- Add safe diagnostics.
- Test legacy and Unified Routing queue structures.

### Phase 3 — Connector and Mapping Foundation

- Build secure API/report configuration.
- Build source mapping catalogue.
- Build identity mapping.
- Build raw staging.
- Build normalization.
- Build refresh monitoring.

### Phase 4 — Attendance and Reconciliation

- Odoo fingerprint.
- Sprinklr sessions.
- Roster.
- Approved requests.
- Status timeline.
- Unauthorized classification.
- Adherence.
- Conformance.
- Daily reconciliation.

### Phase 5 — KPI Engine

- PRR.
- Survey Response Rate.
- QA.
- AHT.
- CTR.
- FCR.
- Quiz.
- Productivity current rule.
- Productivity proposed study.
- Attendance.
- Adherence.
- Conformance.
- Function-specific rules.

### Phase 6 — Daily, Weekly, and Monthly Scorecards

- Daily performance.
- Daily score.
- Weekly aggregation.
- Monthly aggregation.
- Net Points.
- Ranking.
- Incentive.
- Explainability.
- Publication and freeze.

### Phase 7 — Unified UI and Reporting

- Roster and daily performance combined view.
- Scorecards.
- KPI registry.
- Reconciliation.
- Unauthorized review.
- Bridge health.
- Integration health.
- Data quality.
- Historical comparison.
- Excel export.

### Phase 8 — Historical Validation and Hardening

- January validation.
- February validation.
- March validation.
- April validation.
- Variance explanation.
- Load and failure testing.
- Security review.
- Documentation.
- Final regression testing.

## N. Final Acceptance Checklist

Before declaring completion, explicitly verify every item:

### Bridge Repair

- [ ] Sprinklr agent discovery still works.
- [ ] Queue discovery no longer incorrectly returns zero.
- [ ] Legacy and Unified Routing detection is supported.
- [ ] Queue normalization and deduplication work.
- [ ] Storage and popup/message flow work.
- [ ] Safe diagnostics work.
- [ ] No secrets or full sensitive responses are stored.

### Sprinklr Integration

- [ ] Agent performance pulls automatically.
- [ ] Login/logout pulls automatically.
- [ ] Multiple sessions and cross-midnight are handled.
- [ ] Status timeline is available.
- [ ] Contacts and tickets are available.
- [ ] Survey Yes and No are available.
- [ ] Refresh health is visible.

### Odoo Integration

- [ ] Fingerprint attendance pulls automatically.
- [ ] Approved permissions pull automatically.
- [ ] Comp-off pulls automatically.
- [ ] Leave, sick leave, WFH, and corrections pull automatically.
- [ ] Approved requests update the roster.
- [ ] Approved requests update adherence, conformance, and unauthorized logic.

### KPI Rules

- [ ] PRR = Yes ÷ Total Contacts.
- [ ] Survey Response Rate = (Yes + No) ÷ Total Contacts.
- [ ] QA uses imported percentage and historical points grid.
- [ ] AHT is function-specific.
- [ ] CTR direction is verified and approved.
- [ ] FCR uses verified Closed Tickets ÷ Total Tickets logic.
- [ ] Quiz uses historical points grid.
- [ ] Productivity current formula is documented.
- [ ] Productivity proposed formula is simulated but not activated without approval.
- [ ] Conformance is implemented.
- [ ] Adherence and Conformance are separate.
- [ ] Missing data is not treated as zero.

### Scorecards

- [ ] Daily performance records populate automatically.
- [ ] Daily score calculates automatically.
- [ ] Weekly scorecard calculates automatically.
- [ ] Monthly scorecard calculates automatically.
- [ ] Period ratios are recalculated from totals.
- [ ] Net Points match approved rules.
- [ ] Ranking works with eligibility controls.
- [ ] Incentive works separately and audibly.
- [ ] Formula and scorecard versions are preserved.
- [ ] Publication and freeze controls work.

### Unified View

- [ ] Roster and daily performance are in one connected view.
- [ ] Odoo and Sprinklr timestamps are visible.
- [ ] Approved requests are visible.
- [ ] KPI raw values and scores are visible.
- [ ] Adherence, Conformance, and Unauthorized Duration are visible.
- [ ] Data completeness and source freshness are visible.
- [ ] Drill-down and Excel export work.

### Validation

- [ ] January workbook is validated.
- [ ] February workbook is validated.
- [ ] March workbook is validated.
- [ ] April workbook is validated.
- [ ] Variances are explained.
- [ ] Regression tests pass.
- [ ] Security checks pass.
- [ ] Documentation and indexes are updated.

If any item is incomplete, report it clearly and do not label the full project complete.

## O. Final Required Report

At completion, provide:

1. Current-state architecture found.
2. Root cause of the broken Sprinklr queue discovery.
3. Files inspected.
4. Files created.
5. Files modified.
6. Database migrations.
7. APIs and reports configured.
8. Bridge changes.
9. Source-to-field mappings.
10. Identity mapping results.
11. KPI rules by function.
12. Historical workbook findings.
13. January–April validation results.
14. Daily, weekly, and monthly calculation results.
15. Ranking and incentive logic.
16. UI pages delivered.
17. Tests executed.
18. Test failures found and fixed.
19. Security and privacy controls.
20. Remaining credentials, report IDs, API details, or approvals required from me.
21. Exact next safe production rollout step.

---

# Employee Weekly Improvement and Monthly Comparison Engine

The project already contains parts of employee improvement tracking and performance comparison.

Do not rebuild existing working functionality from zero.

First audit the current implementation, identify what already exists, complete missing logic, fix broken calculations, improve the user experience, and connect it fully to the automated KPI, attendance, roster, adherence, conformance, and scorecard data.

## Weekly Employee Improvement Analysis

For every employee, automatically generate a weekly improvement analysis.

The analysis must compare:

- Current week versus previous week.
- Current week versus 4-week average.
- Current week versus monthly target.
- Current week versus function average.
- Current week versus team average.
- Current week versus the employee’s best historical week.
- Current week versus the employee’s lowest historical week.

Track all relevant metrics, including:

- Final score.
- Net Points.
- Quality.
- AHT.
- FCR.
- CTR.
- Productivity.
- Quiz.
- PRR.
- Survey Response Rate.
- Contacts Handled.
- First Response Time.
- Response Time.
- Adherence.
- Conformance.
- Attendance.
- Late Login.
- Early Logout.
- Unauthorized Duration.
- Break Compliance.
- Idle Time.
- ACW.
- Hold Time.
- Talk Time.
- Survey Yes.
- Survey No.
- Working Days %.
- Incidents.
- Any function-specific KPI.

For every KPI, show:

- Previous value.
- Current value.
- Absolute change.
- Percentage change.
- Direction:
  - Improved.
  - Declined.
  - Stable.
- Impact on score.
- Impact on ranking.
- Root-cause indicators.
- Recommended action.
- Whether supervisor review is required.

Example:

```text
AHT
Previous Week: 05:10
Current Week: 04:35
Change: -00:35
Status: Improved
Score Impact: +5 points
```

```text
Adherence
Previous Week: 94%
Current Week: 88%
Change: -6%
Status: Declined
Primary Cause: 42 minutes unauthorized Not Ready
```

## Attendance Trend Analysis

Attendance analysis must include:

- Late occurrences.
- Total late minutes.
- Average late minutes.
- Maximum late incident.
- Early logout occurrences.
- Total early logout minutes.
- Missing login.
- Missing logout.
- Attendance corrections.
- Approved permissions.
- Unauthorized time.
- Working Days %.
- Attendance score impact.
- Adherence impact.
- Conformance impact.

Compare:

- Week over week.
- Month over month.
- Current month versus 3-month average.
- Current month versus target.
- Current employee versus team average.
- Current employee versus function average.

Show clearly:

- Where lateness increased.
- Where lateness decreased.
- Which shifts have the most lateness.
- Which days have the most lateness.
- Which intervals are affected.
- Whether the lateness was approved, compensated, or unauthorized.
- Score impact.
- Salary or policy impact only where approved business rules exist.

## Monthly Employee Comparison

For every employee, generate an automatic month-to-month comparison.

Compare:

- Current month versus previous month.
- Current month versus 3-month average.
- Current month versus 6-month average.
- Current month versus target.
- Current month versus team average.
- Current month versus function average.

For every KPI, show:

- Previous month.
- Current month.
- Change.
- Trend.
- Score contribution.
- Ranking impact.
- Incentive impact.
- Whether the change is statistically or operationally meaningful.
- Root-cause evidence.
- Recommended action.

Create a monthly summary such as:

```text
Overall Score
April: 92
May: 101
Change: +9
Status: Improved

Main Improvements:
- Quality +5 points
- FCR +4 points
- Adherence +3 points

Main Declines:
- AHT -2 points
- Late Login -1 point
```

## Improvement Classification

Automatically classify employees into configurable categories:

- Strong Improvement.
- Moderate Improvement.
- Stable.
- Early Decline.
- Significant Decline.
- Data Incomplete.
- New Joiner.
- Function Transfer.
- Needs Coaching.
- High Performer.
- Attendance Risk.
- Adherence Risk.
- Productivity Risk.
- Quality Risk.

The classification must be explainable.

Do not use hidden AI-only reasoning.

Show which KPI changes caused the classification.

## Improvement Recommendations

Generate practical recommendations based on verified data.

Examples:

- AHT coaching.
- Hold reduction.
- ACW reduction.
- Attendance coaching.
- Adherence review.
- Productivity plan.
- Quality calibration.
- Quiz refresh.
- FCR improvement.
- Survey engagement.
- Break adherence.
- Shift reassignment review.
- Workload balancing.
- Function-specific refresher training.

Recommendations must be:

- Specific.
- KPI-linked.
- Evidence-based.
- Time-bound.
- Assigned to an owner.
- Trackable.
- Reviewable in the next week.

## Coaching and Action Plan Tracking

Allow Team Leaders and authorized managers to create an action plan from the improvement analysis.

Include:

- KPI.
- Current value.
- Target value.
- Gap.
- Action.
- Owner.
- Start date.
- Due date.
- Review date.
- Status.
- Employee feedback.
- Manager comments.
- Evidence.
- Outcome.
- Before and after value.

The next weekly comparison must automatically show whether the action plan improved the KPI.

## Weekly and Monthly Employee Summary Pages

Create:

1. Employee Weekly Improvement Summary.
2. Employee Monthly Comparison.
3. Team Weekly Improvement Summary.
4. Team Monthly Comparison.
5. Function Improvement Dashboard.
6. Attendance Trend Dashboard.
7. Adherence and Conformance Trend Dashboard.
8. Coaching and Action Plan Tracker.
9. Improvement Ranking.
10. Decline Risk Dashboard.

Support:

- Employee filter.
- Team Leader filter.
- Function filter.
- Shift filter.
- Date range.
- KPI filter.
- Improvement category.
- Risk category.
- Export to Excel.
- PDF export where supported.
- Scheduled report delivery where supported.

---

# Enterprise Report Builder

Build a configurable Report Builder similar in flexibility and usability to the Sprinklr reporting experience shown in the provided screenshots.

The existing reporting module must be audited first.

Complete and improve what already exists.

Do not replace working reporting features unnecessarily.

## Report Builder Core Experience

Authorized users must be able to:

1. Create a new report.
2. Name the report.
3. Add a description.
4. Select a data source.
5. Select one or more report categories.
6. Add dimensions.
7. Add metrics.
8. Add calculated metrics.
9. Add filters.
10. Add date-range controls.
11. Select aggregation.
12. Select sorting.
13. Select grouping.
14. Preview data.
15. Save as draft.
16. Save and publish.
17. Duplicate.
18. Edit.
19. Archive.
20. Export.
21. Schedule delivery.
22. Share according to permissions.

## Supported Data Sources

The Report Builder must support approved normalized data from:

- Roster.
- Attendance.
- Odoo Fingerprint.
- Odoo Requests.
- Sprinklr Agent Performance.
- Sprinklr Login and Logout.
- Sprinklr Agent Status.
- Sprinklr Queue Performance.
- Sprinklr Contacts.
- Sprinklr Tickets.
- Sprinklr Surveys.
- Quality.
- Quiz.
- Daily Performance.
- Weekly Scorecards.
- Monthly Scorecards.
- Adherence.
- Conformance.
- Unauthorized Status.
- Shrinkage.
- Productivity.
- Ranking.
- Incentive.
- Coaching and Action Plans.
- Bridge Health.
- Data Quality.
- Integration Health.

## Dimension and Metric Library

Create a searchable metric and dimension library.

Organize it into categories such as:

- Employee.
- Team.
- Team Leader.
- Function.
- Shift.
- Date and Time.
- Roster.
- Attendance.
- Sprinklr Status.
- Queue.
- Channel.
- Contact.
- Ticket.
- Survey.
- Quality.
- Quiz.
- Productivity.
- Adherence.
- Conformance.
- Unauthorized Status.
- Scorecard.
- Ranking.
- Incentive.
- Improvement.
- Coaching.
- Integration Health.

Each metric and dimension must show:

- Name.
- Description.
- Data type.
- Unit.
- Source.
- Applicable functions.
- Formula where applicable.
- Aggregation behavior.
- Data freshness.
- Availability.
- Security classification.

## Calculated Metrics

Allow authorized users to create calculated metrics.

Support:

- Sum.
- Count.
- Distinct Count.
- Average.
- Weighted Average.
- Minimum.
- Maximum.
- Median where supported.
- Percentage.
- Ratio.
- Duration.
- Difference.
- Percentage Change.
- Week-over-Week Change.
- Month-over-Month Change.
- Rolling Average.
- Cumulative Total.
- Target Variance.
- Score Contribution.

Examples:

```text
PRR % = Survey Yes ÷ Total Contacts × 100
```

```text
Survey Response Rate % =
(Survey Yes + Survey No) ÷ Total Contacts × 100
```

```text
FCR % = Closed Tickets ÷ Total Tickets × 100
```

```text
Weighted AHT = Total Handle Time ÷ Contacts Handled
```

Calculated metrics must be:

- Named.
- Described.
- Validated.
- Versioned.
- Permission-controlled.
- Previewable.
- Reusable.

## Filters

Support:

- Quick Filters.
- Standard Filters.
- Advanced Filters.
- Saved Filters.
- Report-Level Filters.
- Widget-Level Filters.
- User-Level Filters.

Filter types must include:

- Employee.
- Team.
- Team Leader.
- Function.
- Channel.
- Queue.
- Shift.
- Status.
- KPI.
- Scorecard Version.
- Date.
- Time.
- Working Days %.
- Attendance Status.
- Unauthorized Status.
- Improvement Category.
- Ranking Range.
- Score Range.
- Data Completeness.
- Source Freshness.

Support operators:

- Equals.
- Not Equals.
- Contains.
- Does Not Contain.
- In.
- Not In.
- Greater Than.
- Less Than.
- Between.
- Is Empty.
- Is Not Empty.
- Relative Date.
- Custom Date Range.

## Date Range Controls

Provide date controls similar to the screenshots.

Support:

- Today.
- Yesterday.
- Day Before Yesterday.
- Last 1 Hour.
- Last 12 Hours.
- Last 24 Hours.
- This Week.
- Last Week.
- Last 7 Days.
- Last 14 Days.
- This Month.
- Last Month.
- Current Quarter.
- Previous Quarter.
- Year to Date.
- Last 30 Days.
- Last 90 Days.
- Custom Range.
- Rolling Start Date.
- Rolling End Date.

Allow:

- Start Date.
- Start Time.
- End Date.
- End Time.
- Timezone.
- Operational Day.
- Shift Date.
- Event Date.
- Case Creation Date.
- Login Date.
- Roster Date.

The selected date field must be visible to the user.

## Report Visualization

Support:

- Table.
- Pivot Table.
- KPI Card.
- Score Card.
- Bar Chart.
- Column Chart.
- Line Chart.
- Area Chart.
- Donut Chart.
- Pie Chart.
- Funnel.
- Heatmap.
- Trend Indicator.
- Gauge.
- Stacked Chart.
- Scatter Plot where appropriate.
- Calendar View.
- Timeline.
- Ranking Table.
- Conditional Formatting Table.

Allow users to configure:

- Column order.
- Column label.
- Format.
- Decimal places.
- Duration display.
- Percentage display.
- Totals.
- Subtotals.
- Index column.
- Sorting.
- Grouping.
- Conditional formatting.
- Threshold colors.
- Trend arrows.
- Auto refresh.

Do not rely only on color.

## Report Preview and Validation

Before saving, show:

- Data preview.
- Row count.
- Time range.
- Filters.
- Source freshness.
- Missing fields.
- Invalid formula.
- Unsupported aggregation.
- Permission issue.
- Estimated query cost.
- Warning if result is too large.

## Report Templates

Provide reusable templates for:

- Daily Agent Performance.
- Weekly Employee Improvement.
- Monthly Employee Comparison.
- Attendance and Lateness.
- Adherence and Conformance.
- Unauthorized Status.
- Function Performance.
- Team Performance.
- Queue Performance.
- Survey PRR and Response Rate.
- QA.
- AHT.
- FCR.
- Productivity.
- Ranking.
- Incentive.
- Scorecard.
- Bridge Health.
- Data Quality.

---

# Enterprise Dashboard Builder

Build a configurable Dashboard Builder similar to the Sprinklr dashboard experience shown in the provided screenshots.

## Dashboard Management

Authorized users must be able to:

- Create Dashboard.
- Name Dashboard.
- Add Description.
- Select Folder.
- Create Folder.
- Duplicate Dashboard.
- Edit Dashboard.
- Publish Dashboard.
- Archive Dashboard.
- Favorite Dashboard.
- Share Dashboard.
- Restrict Dashboard.
- Export Dashboard.
- Schedule Dashboard delivery.

## Dashboard Sections and Tabs

Support:

- Multiple Sections.
- Multiple Tabs.
- Tab names.
- Tab order.
- Add Tab.
- Rename Tab.
- Duplicate Tab.
- Delete Tab.
- Hide Tab.
- Function-specific tabs.
- Team-specific tabs.
- Role-specific tabs.

Example tabs:

- Queue Performance.
- Agent Performance.
- Productivity.
- Attendance.
- Adherence.
- Conformance.
- QA.
- Survey.
- Weekly Improvement.
- Monthly Comparison.
- Scorecards.
- Integration Health.

## Add Widget Experience

Provide an Add Widget flow similar to the screenshots.

The user must be able to:

1. Select Add Widget.
2. Choose Widget Library or Create Custom Widget.
3. Enter Widget Name.
4. Add Description.
5. Select Data Source.
6. Select Visualization.
7. Add Metrics.
8. Add Dimensions.
9. Add Filters.
10. Add Date Field.
11. Configure Sorting.
12. Configure Totals.
13. Configure Auto Refresh.
14. Preview.
15. Add to Dashboard.
16. Save Dashboard.

## Widget Library

Create reusable widgets for:

- Total Contacts.
- Contacts Handled.
- Number of Agents.
- Open Tickets.
- Closed Tickets.
- Backlog.
- Queue Waiting.
- Oldest Contact.
- SLA.
- AHT.
- FCR.
- Quality.
- Productivity.
- PRR.
- Survey Response Rate.
- Attendance.
- Late Login.
- Early Logout.
- Adherence.
- Conformance.
- Unauthorized Duration.
- Weekly Improvement.
- Monthly Score Change.
- Ranking.
- Incentive.
- Data Freshness.
- Bridge Health.

## Custom Widget Builder

Allow users to select:

- Data Source.
- Metric.
- Dimension.
- Visualization.
- Filters.
- Date Range.
- Aggregation.
- Grouping.
- Sorting.
- Display format.
- Conditional formatting.
- Drill-down destination.
- Auto refresh.

Support bulk addition of metrics and dimensions.

## Dashboard-Level Filters

Support dashboard-level filters that affect all compatible widgets.

Examples:

- Date Range.
- Function.
- Team.
- Team Leader.
- Employee.
- Shift.
- Channel.
- Queue.
- KPI.
- Scorecard Version.
- Improvement Category.

Widgets must clearly show whether they inherit or override dashboard filters.

## Widget-Level Filters

Every widget may have its own filters.

Show an indicator when widget filters are active.

Allow:

- View Filters.
- Edit Filters.
- Clear Filters.
- Copy Filters.
- Inherit Dashboard Filters.

## Widget Actions

Provide:

- Refresh.
- Edit.
- Duplicate.
- Move.
- Resize.
- Delete.
- Export.
- View Data.
- Drill Down.
- Full Screen.
- Save as Report.
- Add Note.
- Configure Alert.

## Dashboard Layout

Support:

- Drag and Drop.
- Resize.
- Grid alignment.
- Responsive design.
- Desktop.
- Tablet.
- Mobile.
- Full-screen wallboard.
- Saved layout.
- Personal layout where permitted.
- Published shared layout.

## Drill-Down

Users must be able to drill from:

- Function to Team.
- Team to Employee.
- Monthly score to weekly score.
- Weekly score to daily performance.
- KPI score to raw numerator and denominator.
- Attendance summary to attendance incidents.
- Unauthorized duration to status intervals.
- Queue summary to queue records.
- Survey summary to response counts.
- Scorecard result to formula details.

## Dashboard Auto Refresh

Allow configurable auto refresh:

- Manual.
- 1 minute.
- 5 minutes.
- 15 minutes.
- 30 minutes.
- Hourly.
- Daily.
- Custom approved interval.

Show:

- Last Updated.
- Data Source Freshness.
- Next Refresh.
- Stale Data Warning.

## Dashboard Builder Permissions

Control:

- Who can create.
- Who can edit.
- Who can publish.
- Who can share.
- Who can see employee-level data.
- Who can see raw attendance.
- Who can see ranking and incentives.
- Who can configure APIs.
- Who can create calculated metrics.

## Dashboard and Report Audit

Audit:

- Dashboard creation.
- Dashboard modification.
- Widget addition.
- Widget removal.
- Filter change.
- Formula change.
- Metric change.
- Publication.
- Sharing.
- Permission change.
- Scheduled delivery.
- Export.

---

# Report and Dashboard Builder Completion Rules

The reporting and dashboard scope is complete only when:

- Existing reporting and dashboard functionality is audited.
- Existing working features are preserved.
- Missing features are identified.
- Broken features are repaired.
- Report Builder supports metrics, dimensions, filters, date ranges, calculated metrics, preview, export, and scheduling.
- Dashboard Builder supports folders, tabs, sections, widgets, filters, drag-and-drop, resize, auto refresh, and drill-down.
- Weekly employee improvement reports exist.
- Monthly employee comparison reports exist.
- Attendance and lateness trend reports exist.
- Roster, daily performance, and score remain connected.
- Reports use the same KPI formulas and scorecard versions as the main engine.
- Missing data is not shown as zero.
- Source freshness is visible.
- Permissions are enforced.
- Tests pass.
- Documentation and project indexes are updated.

## Mandatory Tests

Test at least:

1. Create report.
2. Add dimension.
3. Add metric.
4. Add calculated metric.
5. Add report filter.
6. Add custom date range.
7. Preview report.
8. Save report.
9. Export report.
10. Schedule report.
11. Create dashboard.
12. Create folder.
13. Add tab.
14. Add widget.
15. Select data source.
16. Select visualization.
17. Add metrics and dimensions.
18. Apply dashboard filter.
19. Apply widget filter.
20. Auto refresh.
21. Drag and resize widget.
22. Drill down from monthly to weekly.
23. Drill down from weekly to daily.
24. Drill down from KPI to raw data.
25. Weekly improvement comparison.
26. Monthly score comparison.
27. Attendance lateness comparison.
28. Missing-data behavior.
29. Role-based access.
30. Existing dashboard regression.

At the end, report:

- Existing report and dashboard features found.
- Missing features.
- Broken features repaired.
- New pages and components.
- Report Builder capabilities.
- Dashboard Builder capabilities.
- Weekly improvement logic.
- Monthly comparison logic.
- Attendance trend logic.
- Templates created.
- Tests and results.
- Remaining approvals required.

---

# Mandatory Visual Reference Instructions — `wfm system` Images

I will add the Sprinklr reference screenshots inside a project folder named:

```text
wfm system
```

The folder may contain screenshots showing:

- Reporting dashboard list.
- Create Dashboard.
- Add Widget.
- Widget Library.
- Create Custom Widget.
- Data Source selection.
- Metric and Dimension selection.
- Bulk metric and dimension selection.
- Dashboard tabs and sections.
- Quick Filters.
- Widget-level filters.
- Date Range picker.
- Custom date and time selection.
- Timezone selection.
- Widget actions.
- Dashboard layout and controls.
- Report and dashboard building flows.

Before designing or modifying the Report Builder and Dashboard Builder:

1. Locate the `wfm system` folder.
2. Inventory all screenshots and reference files inside it.
3. Open and inspect every relevant image.
4. Document which user experience, interaction pattern, or functional behavior each screenshot demonstrates.
5. Compare those references with the existing WFM Report Builder and Dashboard Builder.
6. Preserve any stronger existing WFM functionality.
7. Implement the missing or weaker capabilities.
8. Do not copy Sprinklr visually or technically.

The screenshots are reference evidence only.

They are not instructions to reproduce Sprinklr exactly.

## Original WFM Design Requirement

Build an original design language for our WFM system.

The final experience must have our own identity and design touch.

Do not copy:

- Sprinklr branding.
- Sprinklr logo.
- Sprinklr colors exactly.
- Sprinklr typography exactly.
- Sprinklr icons exactly.
- Sprinklr spacing exactly.
- Sprinklr button styling exactly.
- Sprinklr labels where a clearer WFM-specific label is possible.
- Sprinklr proprietary layouts pixel-for-pixel.
- Sprinklr source code or implementation.

Use the screenshots only to understand useful concepts such as:

- Clear dashboard organization.
- Folder structure.
- Dashboard tabs.
- Add Widget flow.
- Custom Widget creation.
- Metric and Dimension library.
- Data Source selection.
- Filter construction.
- Date Range handling.
- Widget preview.
- Drag, resize, and layout control.
- Auto Refresh.
- Drill-down.
- User-friendly report construction.

Then redesign those concepts into an original WFM-native experience.

## Our Design Direction

The WFM system design must feel:

- Modern.
- Premium.
- Operational.
- Clear.
- Fast.
- Accurate.
- Enterprise-grade.
- Easy for non-technical users.
- Suitable for daily RTA, WFM, Team Leader, Operations, QA, HR, and agent use.
- Consistent across all WFM modules.
- Responsive on desktop and tablet.
- Arabic and English ready.
- Accessible.
- Information-rich without looking crowded.

Create a unified design system covering:

- Page layout.
- Navigation.
- Header.
- Sidebar.
- Cards.
- Tables.
- Forms.
- Filters.
- Date pickers.
- Drawers.
- Modals.
- Tabs.
- Charts.
- KPI cards.
- Widget containers.
- Status badges.
- Empty states.
- Error states.
- Loading states.
- Tooltips.
- Alerts.
- Audit history.
- Mobile and tablet behavior.

## WFM-Specific Design Improvements

The design must go beyond the screenshots and include WFM-specific intelligence such as:

- Function coverage indicators.
- Required versus Scheduled versus Actual headcount.
- Understaffing and overstaffing signals.
- Queue pressure.
- SLA risk.
- Data freshness.
- Source health.
- Approved versus unauthorized time.
- Adherence and Conformance.
- Daily, weekly, and monthly trends.
- Score contribution.
- Root-cause drill-down.
- Employee improvement and decline indicators.
- Missing-data warnings.
- Function-specific KPI context.
- Role-based views.
- Operational alerts.

## Report Builder Design

The Report Builder must retain the flexibility demonstrated in the screenshots, but use our own WFM design.

The user flow should include:

1. Create Report.
2. Name and describe the report.
3. Select a normalized WFM data source.
4. Select Metrics and Dimensions.
5. Search and browse by category.
6. Add multiple fields.
7. Build calculated metrics.
8. Apply filters.
9. Select the report date field.
10. Select relative or custom date range.
11. Select timezone and operational-day behavior.
12. Select visualization.
13. Configure columns, totals, grouping, sorting, and formatting.
14. Preview the result.
15. Validate data freshness and completeness.
16. Save as Draft.
17. Publish.
18. Export.
19. Schedule.
20. Add to Dashboard.

Improve the experience with:

- Clear step progress.
- Smart defaults.
- Metric descriptions.
- Formula previews.
- Data-source warnings.
- Empty-state guidance.
- Search.
- Recently used fields.
- Favorite metrics.
- Reusable calculated metrics.
- Saved filter sets.
- Validation before saving.
- Undo and redo where feasible.

## Dashboard Builder Design

The Dashboard Builder must be inspired by the flexibility of the screenshots but remain original.

Support:

- Dashboard folders.
- Create Dashboard.
- Dashboard templates.
- Tabs.
- Sections.
- Add Widget.
- Widget Library.
- Custom Widget Builder.
- Drag and drop.
- Resize.
- Duplicate.
- Move.
- Delete.
- Full Screen.
- Auto Refresh.
- Dashboard-level filters.
- Widget-level filters.
- Drill-down.
- Notes.
- Alerts.
- Save as Report.
- Share.
- Publish.
- Role restrictions.
- Export.
- Scheduled delivery.

Improve beyond the reference screenshots by adding:

- Alignment guides.
- Responsive grid.
- Layout presets.
- Duplicate tab.
- Copy widget between dashboards.
- Widget dependency warning.
- Filter compatibility indicator.
- Data freshness indicator.
- Formula version indicator.
- Scorecard version indicator.
- Missing-data state.
- Stale-data state.
- Permission-preview mode.
- Role-preview mode.
- Mobile preview.
- Wallboard preview.

## Visual Comparison and Design Documentation

Create documentation that includes:

- Screenshot inventory.
- Useful patterns identified from each image.
- Existing WFM capabilities.
- Missing capabilities.
- Improvements selected.
- Patterns deliberately not copied.
- Original WFM design decisions.
- Design-system tokens.
- Component inventory.
- User flows.
- Accessibility decisions.
- Responsive behavior.
- Before-and-after comparison.

Do not include or reproduce proprietary Sprinklr code.

## Image Handling Rules

- Treat all images in `wfm system` as read-only reference material.
- Do not modify or delete the original screenshots.
- Do not publish them in the WFM application.
- Do not use them as production assets.
- Do not embed Sprinklr branding in our product.
- Do not infer hidden technical implementation from visuals alone.
- Clearly separate what is visually observed from what is technically verified.

## Visual Acceptance Criteria

The Report Builder and Dashboard Builder are not complete until:

- Every relevant screenshot in `wfm system` has been reviewed.
- The useful interaction patterns have been documented.
- The existing WFM implementation has been audited first.
- Working WFM features are preserved.
- Missing capabilities are implemented.
- The final design is visibly original.
- The final UI does not look like a Sprinklr copy.
- The final UI uses one consistent WFM design system.
- Report creation is understandable without technical knowledge.
- Dashboard and Widget creation are easy to discover.
- Metrics, Dimensions, Filters, and Date Range are clearly organized.
- Data freshness and missing data are visible.
- Arabic and English layouts work.
- Responsive layouts work.
- Role permissions work.
- Accessibility checks pass.
- Visual regression tests are added where supported.
- Functional tests pass.
- Documentation and project indexes are updated.

At the end, report:

- Images found in `wfm system`.
- Images reviewed.
- UX patterns extracted.
- Existing WFM features preserved.
- Missing features implemented.
- Design ideas rejected to avoid copying.
- Original WFM design system created.
- Report Builder changes.
- Dashboard Builder changes.
- Widget Builder changes.
- Responsive and bilingual results.
- Accessibility results.
- Tests and results.
- Remaining design decisions requiring my approval.

