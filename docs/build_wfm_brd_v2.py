"""
Build Integrated_WFM_Business_Requirements_v2.docx from the Director's v1.0.

Keeps his structure and numbering verbatim. Six corrections and the missing rule
sections are marked [REVISED] / [NEW] so he can review every change before sending,
and can strip the markers with a find-and-replace once approved.
"""
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
import re

# Review markers exist only while the Director is comparing against v1.0. The circulated
# copy carries none of them, so nothing in the text refers to a version the reader of this
# document has never seen.
_MARK = re.compile(r'\s*\[(NEW|REVISED)(\s*[—-][^\]]*)?\]')
def C(t):
    return _MARK.sub('', str(t)).rstrip() if t is not None else t

ACCENT = RGBColor(0x1F, 0x3B, 0x73)
MARK = RGBColor(0xB0, 0x30, 0x10)
MUTED = RGBColor(0x55, 0x5F, 0x6D)

doc = Document()
st = doc.styles['Normal']
st.font.name = 'Calibri'
st.font.size = Pt(10.5)
for s in doc.sections:
    s.left_margin = s.right_margin = Inches(0.85)
    s.top_margin = s.bottom_margin = Inches(0.7)


def h1(t, mark=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(5)
    r = p.add_run(C(t)); r.bold = True; r.font.size = Pt(14); r.font.color.rgb = ACCENT
    _ = mark   # review marker: not rendered in the circulated copy


def h2(t, mark=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(11)
    p.paragraph_format.space_after = Pt(3)
    r = p.add_run(C(t)); r.bold = True; r.font.size = Pt(11.5); r.font.color.rgb = ACCENT
    _ = mark   # review marker: not rendered in the circulated copy


def para(t, bold=False, italic=False, size=10.5, color=None, space=3):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space)
    r = p.add_run(C(t)); r.bold = bold; r.italic = italic; r.font.size = Pt(size)
    if color: r.font.color.rgb = color
    return p


def bullets(items):
    for it in items:
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_after = Pt(1.5)
        if isinstance(it, tuple):
            r = p.add_run(C(it[0])); r.bold = True; r.font.size = Pt(10.5)
            r2 = p.add_run(C(it[1])); r2.font.size = Pt(10.5)
        else:
            p.add_run(C(it)).font.size = Pt(10.5)


def numbers(items):
    for it in items:
        p = doc.add_paragraph(style='List Number')
        p.paragraph_format.space_after = Pt(1.5)
        p.add_run(C(it)).font.size = Pt(10.5)


def table(headers, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Light Grid Accent 1'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, htxt in enumerate(headers):
        c = t.rows[0].cells[i]
        c.text = ''
        r = c.paragraphs[0].add_run(C(htxt)); r.bold = True; r.font.size = Pt(9.5)
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ''
            run = cells[i].paragraphs[0].add_run(C(v)); run.font.size = Pt(9.5)
    if widths:
        for r_ in t.rows:
            for i, w in enumerate(widths):
                r_.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def callout(title, body):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6); p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.left_indent = Inches(0.18)
    r = p.add_run(C(title).rstrip('.') + '.  '); r.bold = True; r.font.size = Pt(10.5); r.font.color.rgb = MARK
    r2 = p.add_run(C(body)); r2.font.size = Pt(10.5)


# ─────────────────────────── COVER ───────────────────────────
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run('INTEGRATED WORKFORCE MANAGEMENT (WFM)\nBUSINESS REQUIREMENTS DOCUMENT')
r.bold = True; r.font.size = Pt(19); r.font.color.rgb = ACCENT
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run('Odoo + Sprinklr + Biometric Attendance + Outlook / Teams Calendar')
r.font.size = Pt(11.5); r.font.color.rgb = MUTED

table(['Field', 'Value'],
      [['Prepared by', 'Talal — Workforce Management Directorate'],
       ['Document type', 'Business and Functional Requirements'],
       ['Version', '2.0'],
       ['Date', 'August 2026'],
       ['Purpose', 'To establish one centralized, automated and auditable WFM solution connecting the '
                   'planned roster, employee requests, biometric attendance, Sprinklr activity, real-time '
                   'staffing, calendar activities and payroll validation.']],
      widths=[1.4, 5.4])

# ─────────────────────────── 1 ───────────────────────────
h1('1. Executive Summary')
para('The proposed solution will replace fragmented Excel and manual tracking with a unified WFM platform. '
     'It will generate fair, demand-based rosters; manage employee requests and approvals; reconcile Odoo '
     'schedules, biometric attendance and Sprinklr activity; calculate adherence, conformance and validated '
     'overtime; and provide real-time headcount by function, skill, queue and interval.')
para('The solution will also coordinate breaks, meetings, training, coaching and temporary cross-skill '
     'assignments through a centralized Workforce Calendar with Outlook / Microsoft Teams invitations and '
     'notifications. Every approval or schedule change will show its staffing impact before confirmation and '
     'will be retained in a complete audit trail.')
para('Target operating model:  Plan → Generate → Validate → Publish → Execute → Monitor → Reconcile → '
     'Report → Improve', bold=True)
callout('Governing principle. [NEW]',
        'Where the system cannot determine what happened, it flags the day for a person to decide. It does '
        'not guess, and it never records an absence by inference. Section 4.6 and Section 9.1 make this '
        'operational; it is stated here because it governs every calculation in this document.')

# ─────────────────────────── 2 ───────────────────────────
h1('2. Scope at a Glance')
table(['Area', 'Requirement Summary'],
      [['Roster and Scheduling', 'Weekly automated schedule generation, shift rules, OFF-day controls, fairness, versioning and publish lock.'],
       ['Attendance Integration', 'Odoo schedule and requests reconciled with biometric punch records and Sprinklr login, logout, queues and statuses.'],
       ['Measurement Rules  [NEW]', 'Tolerance thresholds, credible-range limits, evidence requirements and the arbitration path when sources disagree.'],
       ['Real-Time WFM', 'Required, scheduled, available, actual and productive headcount by day and interval with staffing gaps and alerts.'],
       ['Requests and Approvals', 'Shift/OFF swaps, permissions, leave, WFH, breaks, overtime, meetings, training, coaching and schedule changes.'],
       ['Calendar and Notifications', 'Automatic employee, leader, RTA and trainer calendar entries, invitations, reminders and change notifications.'],
       ['Skill Management', 'Primary and cross-skill matrix, queue eligibility, temporary assignments and gap coverage tracking.'],
       ['Data Quality  [NEW]', 'A first-class exception queue: what is unresolved, why, who decides, and what the number does until it is settled.'],
       ['Analytics and Audit', 'Conformance, adherence, shrinkage, fairness, OT, approval turnaround, Excel export and complete audit history.']],
      widths=[1.9, 4.9])

# ─────────────────────────── 3 ───────────────────────────
h1('3. Users and Approval Roles')
bullets([('Agent: ', 'views roster and calendar, submits requests, acknowledges assigned overtime, accepts or rejects swaps and receives notifications.'),
         ('Team Leader: ', 'reviews employee requests, schedules coaching, assigns or requests overtime, monitors attendance and team performance.'),
         ('RTA: ', 'validates real-time coverage, approves operational requests, manages breaks and temporary cross-skill movements, and protects SLA.'),
         ('WFM: ', 'owns forecasting, roster generation, final schedule control, policy rules, final operational approvals and reporting.'),
         ('Training / QA: ', 'schedules bulk training or coaching activities and records attendance, outcomes and follow-up actions.'),
         ('HR / Payroll: ', 'validates attendance and approved overtime outputs before payroll processing.'),
         ('Administrator: ', 'configures shifts, codes, workflows, thresholds, roles, integrations and access rights.')])
callout('Record-only roles. [NEW]',
        'Team Leader, Senior, RTA, Resolution Specialist and WFM are record-only for deductions. Their '
        'attendance is tracked and visible in all reporting, but no deduction is computed from it. They are '
        'accountable for coverage, not for a clock.')

# ─────────────────────────── 4 ───────────────────────────
h1('4. Weekly Roster and Shift Rules')
h2('4.1 Roster Cycle and Core Rules', '[REVISED]')
bullets([
    'The weekly roster starts on Saturday and ends on Friday.',
    'Friday and Saturday are the weekend days. Operational data for June–July 2026 shows Friday at 32.7% OFF and Saturday at 27.8%, while Thursday sits at 26.8% — level with Monday and Wednesday.',
    'The standard agent shift is 9 hours including a total of 1 hour break (8 hours net).',
    'Supervisory roles and the "20"-series codes are 8 hours. Ramadan shifts are 7 hours and some are split shifts.  [REVISED]',
    'A minimum of 10 hours rest must be maintained between shifts, calculated across midnight.',
    'The system must prevent overlapping shifts and night-to-morning assignments without sufficient rest.',
    'Each employee receives exactly 2 OFF days per week. Three or more consecutive OFF days must be blocked or flagged, and any deviation from two per week requires an authorized exception.  [REVISED]',
    'OFF days, weekend duties, night shifts, preferred shifts and overtime must be distributed fairly among eligible employees, measured by the formula in Section 5.4.',
    'Overnight and cross-midnight shifts belong entirely to the day the shift STARTED — for attendance, overtime, permissions, leave and swaps.  [REVISED]',
    'Special roster cycles and OFF-day entitlements must remain configurable for exceptional operational periods.',
])
callout('Female shift rule — corrected. [REVISED]',
        'Female employees are normally assigned up to the C shift, ending 20:00. The N shift may be assigned '
        'where operationally necessary, and every such assignment is flagged. MD and MN are never assigned '
        'except through an explicit manual override that is logged, audited and attributed to a named '
        'approver. The rule must be configurable and must never be hard-coded — an absolute prohibition '
        'in software removes the exception path the operation relies on when night coverage is short.')
callout('Rest rule — worked examples. [NEW]',
        'MD ending 07:00 followed by M starting 07:00 = 0 hours rest → invalid. '
        'MD ending 07:00 followed by EE20 starting 18:00 = 11 hours rest → valid.')

h2('4.2 Standard Shift Codes and Times', '[REVISED]')
para('The workbook Timing sheet is the only shift-code dictionary. The table below lists the codes currently '
     'in operational use, verified against live roster data for June–August 2026. The system must import the '
     'full dictionary and must never be built against a fixed subset.', italic=True, color=MUTED)
table(['Code', 'Time', 'Hours', 'Notes'],
      [['M', '07:00–16:00', '9', 'Morning'],
       ['B', '09:00–18:00', '9', 'Business'],
       ['C', '11:00–20:00', '9', 'Latest shift normally assigned to female employees'],
       ['N', '13:00–22:00', '9', 'Late shift'],
       ['E', '16:00–01:00', '9', 'Cross-midnight'],
       ['EE20', '18:00–03:00 (agent) / 18:00–02:00 (admin)', '9 / 8', 'ROLE-DEPENDENT — cross-midnight  [REVISED]'],
       ['MD', '22:00–07:00', '9', 'Night / cross-midnight'],
       ['MN', '23:00–08:00', '9', 'Night / cross-midnight'],
       ['M20', '08:00–16:00', '8', 'Supervisory series  [NEW]'],
       ['B20', '10:00–18:00', '8', 'Supervisory series  [NEW]'],
       ['C20', '11:00–20:00', '8', 'Supervisory series  [NEW]'],
       ['N20', '14:00–22:00', '8', 'Supervisory series  [NEW]'],
       ['M7-3', '07:00–15:00', '8', '[NEW]'],
       ['CCNO', '09:00–17:00', '8', '[NEW]'],
       ['M7 / B7 / C7 / N7', '07:00–14:00 / 09:00–16:00 / 11:00–18:00 / 15:00–22:00', '7', 'Seven-hour family — Ramadan and protected windows  [NEW]'],
       ['WFH-M', '08:00–16:00', '8', 'WFH variants carry their OWN times — WFH-M is not M from home  [NEW]'],
       ['WFH-B', '10:00–18:00', '8', '[NEW]'],
       ['WFH-N', '14:00–22:00', '8', '[NEW]'],
       ['MDR / MNR', 'Per Timing sheet', '7', 'Ramadan night variants  [NEW]']],
      widths=[1.15, 2.45, 0.65, 2.55])
callout('Two data-quality rules. [NEW]',
        'First: no real shift ends at 21:00 — a 21:00 end is a data error and must be rejected at entry. '
        'Second: one code, one spelling. Live data currently contains both "WFH-B" and "WFHB" for the same '
        'shift. The system must enforce a single canonical spelling per code.')

h2('4.3 Attendance and Roster Codes', '[REVISED]')
table(['Code', 'Definition'],
      [['OFF', 'Weekly OFF day.'],
       ['H', 'Official holiday.'],
       ['L', 'Annual leave.'],
       ['SL', 'Sick leave recorded before roster publication. Sick is always SL — never "P" or any other invented code.  [REVISED]'],
       ['A', 'Absence.  [NEW]'],
       ['COMP', 'Compensation day.'],
       ['DL', 'Death leave.'],
       ['RES / TER', 'Resignation / termination — affects headcount and attrition reporting.  [NEW]'],
       ['WFH-M / WFH-B / WFH-N / WFH-MD', 'Work-from-home shifts, each with its own window (see 4.2).'],
       ['Shift suffix A', 'Absence after schedule publication, e.g. MA, BA, NA, EA, EE20A, MDA.'],
       ['Shift suffix S', 'Sick leave submitted after publication, e.g. MS, BS, NS, ES, EES, MDS.']],
      widths=[1.9, 4.9])

h2('4.4 Attendance Measurement Thresholds', '[NEW]')
para('These thresholds determine whether an event is recorded against an employee at all. They are the most '
     'consequential rules in this document: without them an implementation will treat every minute as an '
     'exception, and its figures will never reconcile with WFM reporting.')
table(['Rule', 'Value', 'Reason'],
      [['Tolerance', '6 minutes', 'At or below the tolerance, nothing is counted.'],
       ['Credible late-in / early-out', '7 to 240 minutes', 'The range within which a reading is treated as real tardiness.'],
       ['Above 240 minutes on a cross-midnight shift', 'Capped and flagged, not charged', 'A logout signal left open overnight would otherwise be recorded as a four-hour late arrival.'],
       ['Completed-shift yardstick', 'GROSS span including the break (9h), not net (8h)', 'The agent remains logged in through the break. Measuring against 8 hours marks every complete shift as an hour short.'],
       ['Official basis for lateness', 'The SYSTEM login/logout', 'The biometric punch corroborates physical presence and is a different measurement — the two are not interchangeable.']],
      widths=[2.2, 1.9, 2.7])

h2('4.5 Identity, Time and Period Conventions', '[NEW]')
table(['#', 'Rule', 'Reason'],
      [['4.5.1', 'The employee ID is the only join key. Never match on name.', 'Names repeat, change, and transliterate inconsistently between Arabic and English.'],
       ['4.5.2', 'An intern ID (6xxxx) later becomes a full-time ID (1xxxx). Both must resolve to ONE person across the whole history.', 'Without the fold, an employee\'s record is split in two and their tenure, fairness history and balances all reset.'],
       ['4.5.3', 'Sprinklr timestamps are LOCAL Kuwait time. Do not convert to or from UTC.', 'A UTC assumption shifts every login by three hours and turns punctual staff into late arrivals.'],
       ['4.5.4', 'Accounting cut-off cycles are not calendar months: full-time 15→14, interns 1→end of month, Bahrain 25→24.', 'Overtime and permission balances settle by cycle. Reporting them by calendar month produces figures payroll cannot use.'],
       ['4.5.5', 'Permission approval status must be delivered as a discrete enumerated value: APPROVED / REFUSED / PENDING / CANCELLED.', 'The current export returns "HR Approved", "Approval Refused", "Waiting 1st Approval" and others. Three of these contain the letters "approv" while meaning the opposite of approval — any partial text match reads a REFUSAL as an APPROVAL.'],
       ['4.5.6', 'Feed column names and order are frozen. Any change is communicated before it ships.', 'A renamed or moved column is the most common cause of a silent data fault. Two such incidents produced zero sessions from a file containing 704 rows.']],
      widths=[0.55, 3.1, 3.15])

h2('4.6 Protective Rules — Absence, WFH and Evidence', '[NEW]')
callout('The absolute rule.',
        'A working day with neither a biometric punch NOR a system session is FLAGGED for human review. '
        'Worked minutes are recorded as zero. It is NEVER automatically recorded as an absence, and this '
        'applies to every role without exception. Missing evidence is a gap in measurement, not proof of '
        'behaviour.')
bullets([
    ('Work-from-home determination: ', 'WFH is concluded from a WFH shift code, an explicit WFH location, or an Odoo WFH status — never inferred from "system login but no punch". That pattern describes an office day with a missing punch, which is an entirely different situation.'),
    ('Maternity-protected employees: ', 'measured against a 7-hour window. The protection must apply in the early-out count, in the conformance denominator AND in expected hours — all three. Honouring it in one metric and omitting it from the next makes a protected employee appear to be the worst performer on the team.'),
    ('Approved permission: ', 'only an APPROVED permission excuses lateness or an early departure; the minutes it covers are credited back and it never lowers conformance. A PENDING permission routes to manual review, never to automatic forgiveness.'),
    ('Permission credit is not the maternity rule: ', 'an approved permission CREDITS minutes back; the maternity rule stops them being CHARGED but grants no credit — it shortens the measured window instead. The two mechanisms are independent and must not be merged.'),
])

# ─────────────────────────── 5 ───────────────────────────
h1('5. Automated Roster Generation and Fairness')
h2('5.1 Generator Inputs and Validation')
bullets([
    'Generate a weekly draft using required headcount by hour or configured interval, function, skill, queue and channel.',
    'Consider forecasted workload, backlog, campaigns, promotions, SLA, shrinkage, employee availability and approved requests.',
    'Respect employee function, skill eligibility, gender restrictions, minimum rest, shift rules and non-overlap controls.',
    'Use historical assignments to rotate shifts, weekends, OFF days, night duties and overtime fairly.',
    'Allow WFM to re-run a draft while rotating assignments fairly without changing a published roster.',
    'Show all rule violations, uncovered intervals and operational risks before publication.',
    'Allow authorized manual adjustments and immediately recalculate headcount, coverage and fairness impact.',
    'Freeze automatic regeneration after publication; preserve all roster versions and manual changes in the audit trail.',
])
h2('5.1.1 Demand Models Behind Required Headcount', '[NEW]')
table(['Channel', 'Model', 'Key inputs'],
      [['Voice / inbound', 'Erlang-C', 'Volume, AHT, target service level, target answer time, occupancy ceiling'],
       ['Chat / WhatsApp / social', 'Concurrency-adjusted workload — concurrency = 4 conversations per agent', 'Volume, AHT, concurrency, target response time, occupancy'],
       ['Email', 'Backlog and throughput', 'Backlog, incoming volume, AHT, SLA target, available hours']],
      widths=[1.7, 2.6, 2.5])
para('Each result is then adjusted for shrinkage and for intern productivity — interns are not equivalent to '
     'full-time agents; the factor is configurable, with a working default of approximately 70%. The output is '
     'an hourly requirement curve per function, and the shift mix is DERIVED from that curve. The generator '
     'does not begin from a fixed pattern of shifts and attempt to fit demand to it.')

h2('5.2 Pre-Publication Decision View')
bullets([
    'Required, Scheduled and Available Headcount after planned shrinkage.',
    'Projected Actual / Productive Headcount where historical or live data is available.',
    'Coverage percentage and under/overstaffing by interval, function, skill and queue.',
    'Uncovered intervals, rest-rule conflicts, gender restrictions and other business-rule violations.',
    'Headcount and coverage before and after every manual roster adjustment.',
])
callout('Honest gaps. [NEW]',
        'Where coverage cannot be met, the generator publishes the shortfall — interval, function, size, cause '
        'and the available remedies (cross-skill movement, overtime, shift-mix change, approved exception). '
        'Midnight coverage can be mathematically impossible when the eligible pool is too small; a schedule '
        'that looked complete would be a false statement, and the visible gap is what triggers a hiring or '
        'cross-skill decision instead.')

h2('5.3 Shift Rate and Fairness Metrics', '[REVISED]')
callout('Definition.',
        'Shift Rate is the DISTRIBUTION of shift types an employee has worked from the start of the year to a '
        'selected date. It is a fairness instrument and is NOT a pay rate.')
table(['Category', 'Codes'],
      [['Morning / Day', 'M, B, C, AM, their 20-series variants, WFH-M, WFH-B, M7-3, B7'],
       ['Evening', 'E, EE20'],
       ['Night', 'N, N20, WFH-N'],
       ['Midnight', 'MD, MN, MDR, MNR']],
      widths=[1.6, 5.2])
para('OFF, holiday, annual leave, sick leave and absence are EXCLUDED from the working distribution and '
     'tracked separately.  [NEW]')
bullets([
    'Number and percentage of each assigned shift code per employee.',
    'Morning, evening and night-shift allocation rate.',
    'Weekend-duty rate, OFF-day distribution and consecutive working / OFF-day patterns.',
    'Preferred versus non-preferred shift allocation.',
    'Overtime allocation rate and fairness.',
    'Scheduled shifts versus completed shifts.',
    'Employee allocation compared with the team and function average.',
    'Weekly and monthly rotation history with alerts for repeated or unfair assignments.',
    'Before/after impact on the distribution shown on every edit and on BOTH employees in a swap.  [NEW]',
])

h2('5.4 How Fairness Is Measured', '[NEW]')
para('The metrics above state what fairness must report. This section states how it is calculated — '
     'without a formula the measure cannot be built consistently across systems.')
callout('Formula.',
        'fairness = 100 − standard deviation of (night + midnight) load across the FAIR POOL')
table(['#', 'Rule', 'Reason'],
      [['5.4.1', 'The fair pool EXCLUDES employees permanently assigned to a night team.', 'Including them inflates the deviation, makes a fair rotation appear unfair, and pushes the generator to "correct" an arrangement that is contractual rather than accidental.'],
       ['5.4.2', 'Fairness is measured on the PRE-SWAP schedule. An approved swap never rewrites fairness history.', 'Otherwise two colleagues can swap repeatedly to move night load off the record.'],
       ['5.4.3', 'Female employees rotate WITHIN their eligible shift set — they are never frozen on a single shift.', 'In an earlier generator the shift rule narrowed their eligible set and the fairness pass then had nothing left to rotate. The people the rule exists to protect became the only ones who never rotated. Protection and rotation are separate mechanisms and must not collapse into one.'],
       ['5.4.4', 'Night work is assigned in blocks of 2–3 consecutive days, each followed by a full OFF block — not as scattered single nights.', 'A single night between day shifts costs more sleep disruption than three consecutive nights. This is deliberately humane rather than mathematically optimal.'],
       ['5.4.5', 'OFF placement is decided BEFORE shift assignment.', 'An OFF day removes a person from the coverage pool, and every subsequent calculation depends on knowing who is available.'],
       ['5.4.6', 'Weekend OFF distribution is counted per person across the rotation window and converged.', 'Friday and Saturday are the desirable days. Without an explicit count the same people absorb every mid-week OFF and it goes unnoticed for a year.']],
      widths=[0.55, 3.1, 3.15])

# ─────────────────────────── 6 ───────────────────────────
h1('6. Requests, Approvals and Operational Impact')
h2('6.1 Supported Request Types')
bullets(['Shift swap and OFF-day swap.', 'Permission and early-out requests.',
         'Annual leave, sick leave, absence and compensation day.', 'Break request.',
         'Work-from-home request.', 'Overtime request or management-assigned overtime.',
         'Meeting, training and coaching request.', 'Temporary cross-skill assignment.',
         'Schedule-change request.'])
h2('6.2 Mandatory Request Information')
bullets([
    'Submission date/time, requested date/time, duration, type and reason.',
    'Employee, team, Team Leader, function, shift, skill, queue and location.',
    'Current workflow level, status, approver name and approval/rejection timestamp.',
    'Acknowledgement and response time where employee action is required.',
    'Approval turnaround time at each step and total turnaround time.',
    'PENDING AGE and SLA-breach flag for any request not yet decided.  [NEW]',
    'Cancellation, modification or rejection reason.',
    'Required, available and projected headcount before and after approval.',
    'The headcount figure shown to the approver, stored WITH the decision.  [NEW]',
    'Impacted intervals, function, skill, queue, coverage percentage and expected SLA risk.',
])
callout('Who has NOT approved. [NEW]',
        'The Directorate must be able to answer two questions daily for each RTA team member: what did they '
        'decide and how quickly, and what is sitting with them undecided and for how long. A request nobody '
        'answers has the same operational effect as a refusal but appears in no decision report unless '
        'pending age is tracked explicitly.')

h2('6.3 Headcount Impact Before Approval')
bullets([
    'Every approval screen must show the current headcount and the projected headcount after approval.',
    'The preview must show Required HC, Available HC, staffing gap and coverage percentage before and after the request.',
    'Pending requests affecting the same intervals must be included in the risk preview.',
    'The system should warn, require an additional approval, recommend another time, suggest a cross-skilled replacement or block the request based on configurable risk thresholds.',
    'After approval, the roster, interval headcount, calendar, shrinkage, breaks, conformance, adherence and reports must update automatically.',
])
table(['Scenario', 'Required HC', 'Available HC', 'Gap', 'Coverage'],
      [['Before Approval', '12', '13', '+1', '108%'],
       ['After Approval', '12', '11', '−1', '92%']],
      widths=[1.8, 1.25, 1.25, 1.0, 1.5])
para('The purpose of the preview is not to block the approver — operational judgement remains theirs. The '
     'purpose is that the decision is made with its cost visible, and that both the decision and the figure '
     'shown at that moment are recorded.', italic=True, color=MUTED)

# ─────────────────────────── 7 ───────────────────────────
h1('7. Shift Swap Workflow')
numbers([
    'Employee 1 submits the swap request and selects Employee 2.',
    'The system validates that both employees belong to the same function and have the required skills and queue access.',
    'The system validates schedules, minimum rest, overlaps, gender restrictions, approved requests and operational eligibility.',
    'Employee 2 receives a notification and accepts or rejects the request.',
    'After acceptance, the request is routed to RTA for headcount, queue, SLA and interval coverage validation.',
    'The Team Leader reviews the request when required by the configured workflow.',
    'WFM provides final approval.',
    'The system automatically exchanges both shifts and updates roster, headcount, breaks, attendance expectations, Sprinklr conformance, fairness history and reporting.',
])
callout('Automatic block conditions.',
        'Understaffing, skill gap, insufficient rest, overlapping shifts, gender-rule violation, conflict with '
        'approved activities, or unacceptable SLA / coverage risk.')
para('Fairness history is recorded on the PRE-SWAP basis (see 5.4.2), so a swap cannot be used to move night '
     'load off the record.  [NEW]', italic=True, color=MUTED)

# ─────────────────────────── 8 ───────────────────────────
h1('8. Odoo, Sprinklr and Biometric Integration')
h2('8.1 Integrated Data Sources')
table(['Source', 'Primary Data', 'WFM Use'],
      [['Odoo / WFM', 'Roster, employee requests and approvals', 'Planned schedule and approved exceptions.'],
       ['Biometric System', 'First punch-in and last punch-out', 'Physical attendance and presence.'],
       ['Sprinklr', 'Login/logout, queues, Ready/Break/Offline/Not Ready statuses', 'Actual system activity, productive time and queue assignment.'],
       ['Outlook / Teams', 'Meetings, training, coaching and calendar invitations', 'Planned activities, reminders and attendance expectations.'],
       ['WFM Validation Layer', 'Reconciled and approved records', 'Final attendance, conformance, adherence, OT and payroll export.']],
      widths=[1.5, 2.6, 2.7])
h2('8.2 Required Captured Data')
bullets([
    'Scheduled shift, function, team, skill, queue and channel.',
    'Biometric first punch-in and last punch-out.',
    'Sprinklr first login, final logout, queue login/logout and all agent-status durations.',
    'Ready, Break, Offline, Not Ready, disconnection, inactive and unaccounted durations.',
    'Missing punch, missing login/logout, duplicate records, delayed sync and cross-midnight activity.',
    'Source system and extraction timestamp on every payload.  [NEW]',
])
h2('8.3 Automatic Reconciliation')
bullets([
    'Scheduled shift versus biometric attendance.',
    'Scheduled shift versus Sprinklr login and logout.',
    'Biometric attendance versus Sprinklr system activity.',
    'Planned working hours versus actual logged-in and productive hours.',
    'Scheduled function / queue versus actual Sprinklr queue.',
    'Scheduled activity versus actual agent status.',
    'Approved requests and calendar activities versus actual absence or offline time.',
])
h2('8.4 Feed Integrity Requirements', '[NEW]')
bullets([
    'Every feed must be re-runnable without side effects and must replace ONLY its own date range. A re-import that reaches outside its range silently erases live attendance history.',
    'A visible last-sync timestamp per source, with alerts on failed, delayed or partial synchronisation.',
    'A partial final day must be identifiable. An export taken mid-shift will show most staff with no logout; reconciling it as though the day were complete records the entire floor as leaving early.',
])

# ─────────────────────────── 9 ───────────────────────────
h1('9. Conformance, Adherence and Exceptions')
bullets([
    'Calculate shift-start and shift-end compliance.',
    'Measure scheduled hours versus actual logged-in hours and biometric presence.',
    'Measure scheduled activity versus actual Sprinklr status by interval.',
    'Validate break timing and duration against approved plans.',
    'Exclude approved permission, WFH, leave, meeting, coaching, training and outage periods from unauthorized-time calculations.',
    'Calculate productive, non-productive, approved and unauthorized time.',
    'Identify late arrival, delayed system login, early punch-out, early logout, missing activity and wrong queue login.',
    'Provide results by employee, team, leader, function, skill, queue, shift, day, week and month.',
    'Every exception must have a reason, status, owner, resolution action and audit history.',
])
h2('9.1 Conformance Formula and Source Arbitration', '[NEW]')
callout('Formula.',
        'conformance = 100 × min(overlap + permitted, paid) ÷ paid  —  where "paid" is the scheduled window '
        '(capped at 7 hours for maternity-protected employees), "overlap" is the part of the system session '
        'falling inside that window, and "permitted" is the raw time forgiven by an approved permission.')
para('Both the raw (pre-forgiveness) and the charged (post-forgiveness) tardiness must be stored, so that a '
     '100% day resting on a late login can be re-derived and explained rather than merely asserted.')
callout('Arbitration when sources disagree.',
        'Where the schedule states the employee worked and the HR system states the day was off, NEITHER '
        'source wins automatically. The day enters a decision queue for a human. A recorded decision settles '
        'WHICH SYSTEM was correct about whether the day was worked; it does not and cannot supply evidence of '
        'HOW the employee performed. A day confirmed as a working day but carrying no evidence leaves the '
        'queue and remains unscored.')

# ─────────────────────────── 10 ───────────────────────────
h1('10. Break Management')
bullets([
    'Support four breaks totaling 60 minutes per 9-hour shift; the structure and duration must remain configurable.',
    'Do not schedule breaks during the first or final hour of the shift.',
    'Distribute breaks based on required coverage, queue volume, SLA, staffing gaps and employee priority.',
    'Prevent too many employees from the same function, skill or queue from taking a break simultaneously.',
    'Show the employee position in the break queue and expected break time.',
    'Capture request time, requested start/duration, approver, approval timestamp and approval turnaround time.',
    'Compare planned break start/end and duration with actual Sprinklr break status.',
    'Identify late break start, early return, exceeded duration and unapproved break.',
    'Recalculate interval headcount before and after approval and automatically update conformance, adherence and reports.',
])

# ─────────────────────────── 11 ───────────────────────────
h1('11. Overtime Management and Automatic Calculation')
h2('11.1 Request, Assignment and Agent Acknowledgement')
bullets([
    'An employee may request overtime, or RTA, Team Leader, WFM or another authorized user may assign overtime to one or multiple eligible employees.',
    'Employee selection should consider function, skill, queue access, shift, availability, rest compliance, staffing gap and overtime fairness.',
    'The employee must receive the date, start/end time, duration, function, queue, reason, requester and response deadline.',
    'The employee can Acknowledge, Accept or Decline; a decline reason may be mandatory.',
    'The system must track Sent, Delivered, Viewed, Acknowledged, Accepted, Declined, Expired, Approved, Completed and Payroll-Validated statuses.',
    'Accepted overtime must be added automatically to the employee roster and calendar after final approval.',
])
h2('11.2 Automatic OT Validation and Payroll Calculation')
bullets([
    'Compare the scheduled shift, approved OT window, biometric punch-in/out, Sprinklr login/logout and actual productive / status durations.',
    'Calculate eligible overtime only within the approved period and only when supported by valid biometric presence and Sprinklr activity.',
    'Calculate overtime before or after the regular shift and on OFF days or official holidays.',
    'Handle overnight and cross-midnight overtime correctly.',
    'Deduct unpaid breaks, unauthorized offline time and non-working durations.',
    'Separate approved overtime from unapproved additional working time.',
    'Flag missing biometric or Sprinklr records as exceptions and prevent automatic payroll confirmation until reviewed.',
    'Allow authorized manual correction only with a mandatory reason and full audit trail.',
    'Update roster, calendar, headcount, attendance, conformance, adherence, capacity and payroll export automatically.',
])
callout('Validated overtime principle.',
        'Approved OT Window + Biometric Presence + Sprinklr Actual Activity = Validated Payable Overtime')
h2('11.3 Overtime Structure and Limits', '[NEW]')
table(['#', 'Rule', 'Reason'],
      [['11.3.1', 'Overtime lives in THREE DISJOINT buckets — worked-day OT, off-day OT and holiday OT — which are always SUMMED and never subtracted.', 'Reading worked-day OT alone under-counts total overtime by roughly a quarter.'],
       ['11.3.2', 'A scheduled shift worked on an official holiday becomes WHOLLY holiday overtime, capped at the scheduled net hours. Regular OT for that day is zero.', 'Prevents the same hours being paid twice under two headings.'],
       ['11.3.3', 'Off-day and holiday overtime must be evidence-backed. A system login with no biometric punch is flagged for review, not credited.', 'Off-day pay is the highest-value claim in the system and needs two witnesses.'],
       ['11.3.4', 'Ceiling of 5 hours per occasion. Anything above 2 hours requires review before payment.', 'Bounds the impact of a session left open.'],
       ['11.3.5', 'Absence, sickness and separation suppress ALL overtime buckets for that day.', '']],
      widths=[0.65, 3.2, 2.95])

# ─────────────────────────── 12 ───────────────────────────
h1('12. Daily and Hourly Headcount Management')
bullets([
    'Provide daily headcount by function with configurable 60-, 30- or 15-minute intervals.',
    'Allow filtering by team, Team Leader, function, skill, queue, channel, location, shift and employee.',
    'For every interval show Required HC, Scheduled HC, Available HC, Actual HC, Productive HC, Shrinkage HC, staffing gap and coverage percentage.',
    'Automatically reflect late arrival, delayed Sprinklr login, permission, early out, absence, no-show, sick leave, annual leave, breaks, meetings, training, coaching, overtime, WFH, cross-skill movements, outages and wrong-queue login.',
    'When a partial permission is approved, deduct the employee only from the impacted intervals.',
    'When biometric or Sprinklr activity changes, update Actual and Productive HC automatically.',
    'Display the before/after staffing impact of every approval and manual change in real time.',
    'A cross-midnight shift contributes to the intervals it actually covers, while remaining owned by its start day for all accounting.  [NEW]',
])

# ─────────────────────────── 13 ───────────────────────────
h1('13. Meetings, Training, Coaching and Workforce Calendar')
h2('13.1 Employee Requests')
bullets([
    'Employees may request a meeting or training by selecting the type, subject, reason, preferred date/time, duration and responsible leader or trainer.',
    'After approval, the activity must appear in the employee and responsible attendees calendars with automatic notification and reminders.',
    'The employee must see the request status, final time, location or meeting link and any updates.',
])
h2('13.2 Leader Coaching')
bullets([
    'Team Leaders may schedule coaching for one employee and select KPI / performance area, reason, objectives, date, time and duration.',
    'The session must appear in both calendars and send notifications and reminders.',
    'Capture attendance, completion, coaching notes, action plan, employee feedback and follow-up date.',
    'Treat approved coaching time as planned shrinkage and exclude it from unauthorized offline time.',
    'Where a scorecard exists, a coaching session must be linkable to the specific KPI gap that triggered it, so coaching is driven by a measured shortfall rather than an impression.  [NEW]',
])
h2('13.3 Bulk Training Scheduling')
bullets([
    'RTA, WFM, Training or authorized users may select employees in bulk by name, function, team, leader, shift, skill, queue or location.',
    'Before confirmation, show Required and Available HC, queue coverage, staffing gaps, SLA risk, breaks and other planned activities.',
    'Warn or block the training if it creates an unacceptable operational gap.',
    'After confirmation, send calendar invitations and notifications to employees, leaders and trainers and update roster, shrinkage, headcount, conformance and attendance expectations.',
])
h2('13.4 Calendar and Notification Controls')
bullets([
    'Use one centralized Workforce Calendar and integrate with Outlook / Microsoft Teams where technically possible.',
    'Send invitation, acknowledgement, approval, rejection, modification, cancellation and reminder notifications.',
    'Prevent double-booking and conflicting breaks, meetings, training, coaching, leave or other activities.',
    'Automatically update all calendars when the time, duration or attendee list changes.',
])

# ─────────────────────────── 14 ───────────────────────────
h1('14. Skill Matrix and Temporary Cross-Skill Assignment')
h2('14.1 Skill Matrix')
bullets([
    'Maintain primary function, secondary functions and cross-skilled functions for every employee.',
    'Maintain authorized Sprinklr queues/channels, proficiency level, training status, certification date, expiry date and last-used date.',
    'Only employees with an active approved skill may be assigned to the related function or queue.',
    'Alert before a skill expires, and again when it has expired, so a lapse is prevented rather than discovered.  [NEW]',
])
h2('14.2 Temporary Cross-Skill Coverage')
bullets([
    'RTA, WFM or authorized users may temporarily assign a cross-skilled agent to another function or queue for a defined start and end time.',
    'Capture employee, original function/queue, receiving function/queue, reason, required skill, requester, approver and headcount before/after.',
    'Notify the employee immediately and place the assignment in the employee, RTA and Team Leader calendars.',
    'Update the WFM roster and interval headcount to show which function the employee covered and for how long.',
    'Update or validate Sprinklr queue access where technically possible.',
    'Measure conformance and adherence against the temporary assignment during that period and return the employee automatically to the original function at the end time.',
    'Validate that the original function will not become understaffed, the receiving function has a genuine gap, and the assignment does not conflict with other activities.',
    'Block or warn against moving a staffing gap from one function to another.',
])

# ─────────────────────────── 15 ───────────────────────────
h1('15. Real-Time Dashboard and Alerts')
bullets([
    'Required, Scheduled, Available, Actual and Productive HC by interval and function.',
    'Forecast versus actual workload, queue coverage, staffing gap, SLA and operational risk.',
    'Employees logged in, late, absent, on break, offline, in training/coaching/meeting or working another function.',
    'Pending permission, break, swap, OT, training and other requests.',
    'Employees exceeding approved break duration or logged into the wrong queue/function.',
    'Missing biometric or Sprinklr activity and active integration failures.',
    'Active outages and technical issues affecting capacity.',
])
h2('15.1 Automatic Alerts')
bullets([
    'Late arrival or delayed Sprinklr login.', 'Early punch-out or early system logout.',
    'Missing biometric punch or no Sprinklr login.',
    'Unauthorized break/offline status or exceeded break duration.',
    'Wrong queue or function login.', 'Understaffing or insufficient skill coverage.',
    'Rest-rule, overlap or schedule violation.',
    'Failed, delayed or incomplete data synchronization.',
    'Requests aged beyond their approval SLA and still undecided.  [NEW]',
])

# ─────────────────────────── 16 ───────────────────────────
h1('16. Reporting, Audit Trail and Payroll Output')
h2('16.1 Required Reports')
bullets([
    'Roster, schedule versions and manual changes.',
    'Attendance, biometric records, Sprinklr login/logout and actual working hours.',
    'Conformance, adherence, productive and non-productive time.',
    'Break requests, approvals, actual usage and compliance.',
    'Request volumes, approval stages, turnaround time and undecided-request ageing.  [REVISED]',
    'Shrinkage, leave, permission, absence, no-show and WFH.',
    'Overtime requested, assigned, acknowledged, accepted, approved, worked and payroll-validated — split by worked-day, off-day and holiday buckets.  [REVISED]',
    'Shift rate, night/weekend/OFF distribution and fairness.',
    'Headcount by interval, function, team, skill and queue.',
    'Meetings, training, coaching attendance, duration and planned shrinkage.',
    'Cross-skill assignments, hours covered, receiving/original headcount impact and skill utilization.',
    'Outages, mismatches, exceptions and resolution status.',
    'Attrition — resignations and terminations, with effect on headcount.  [NEW]',
    'Daily, weekly and monthly exports to Excel and validated payroll output.',
])
h2('16.2 Audit Trail')
bullets([
    'Creator, requester, selected employees, submission time and all approvers.',
    'Acknowledgement, acceptance, rejection and approval timestamps.',
    'Previous value, updated value, change user, date/time and mandatory reason.',
    'Roster version before and after the change.',
    'Headcount, coverage and SLA impact before and after approval.',
    'Manual corrections must never overwrite original source records.',
    'The audit log is append-only.  [NEW]',
])

# ─────────────────────────── 17 ───────────────────────────
h1('17. Data, Security and Administration Controls')
bullets([
    'Match employees across Odoo, Sprinklr, biometric and calendar systems using one unique employee ID, and fold an intern ID into its later full-time ID so one person keeps one history.  [REVISED]',
    'Use real-time or near-real-time synchronization and define a visible last-sync timestamp.',
    'Process overnight shifts and cross-midnight attendance correctly, owned by the start day.',
    'Generate alerts for failed or delayed integrations and support controlled mismatch resolution.',
    'Apply role-based access control according to Agent, TL, RTA, WFM, HR, Training and Admin authority.',
    'Keep historical records and all roster versions available for audit and analysis.',
    'Make shift codes, timings, workflows, approval levels, interval length, limits and risk thresholds configurable without system redevelopment.',
    'Support SSO / MFA readiness and secure data export according to company access policies.',
])

# ─────────────────────────── 18 ───────────────────────────
h1('18. Key Acceptance Criteria', '[REVISED]')
numbers([
    'No day is recorded as an absence without either evidence or a documented human decision.',
    'Every employee receives exactly 2 OFF days per week; any deviation is blocked or flagged with an authorized exception. (Live data for June–July 2026 shows only 74.7% of person-weeks currently carry exactly two — 15.4% carry one, 6.2% carry none and 3.8% carry three.)  [NEW]',
    'The system can generate a Saturday-to-Friday roster using all configured rules and show coverage before publishing.',
    'No schedule can create less than 10 hours rest, an overlap or three consecutive OFF days without an authorized exception.',
    'Lateness and early departure are measured against the system session, with a 6-minute tolerance and a 7–240 minute credible range; readings beyond 240 minutes on a cross-midnight shift are capped and flagged.  [NEW]',
    'Every request shows headcount and coverage before and after approval, and the figure shown is stored with the decision.  [REVISED]',
    'Shift swap follows Employee 1 → Employee 2 → RTA → TL if required → WFM final approval and updates all impacted records, with fairness recorded on the pre-swap basis.  [REVISED]',
    'Odoo, biometric and Sprinklr records reconcile by unique employee ID, including cross-midnight shifts and folded intern identities.  [REVISED]',
    'Actual and Productive HC change automatically when lateness, permission, early out, breaks or system activity occur.',
    'Assigned overtime reaches the employee for acknowledgement/acceptance and is calculated automatically from approved OT + biometric + Sprinklr activity, across all three overtime buckets.  [REVISED]',
    'Meetings, training, coaching and cross-skill assignments appear in calendars and notifications and update shrinkage/headcount.',
    'Cross-skilled employees can be temporarily assigned only when eligible and without creating a new gap in the original function.',
    'For any RTA team member, the system reports both what they decided and what remains undecided with them, and for how long.  [NEW]',
    'All changes and approvals are reportable, exportable and retained in an immutable audit trail.',
])

# ─────────────────────────── 19 ───────────────────────────
h1('19. Data Quality and Exception Management', '[NEW]')
para('Because the platform deliberately refuses to guess, unresolved items are a normal operating state '
     'rather than a failure — and they therefore need an owner, a lifecycle and a stated effect on the '
     'figures they touch.')
table(['Requirement', 'Detail'],
      [['Single exception queue', 'Every unresolved item in one place: the person, the day, the reason, the evidence available, and who is expected to decide.'],
       ['Stated effect on the number', 'Each open item must state what the affected metric does while it is unresolved — excluded, flagged, or provisional. A number must never change silently.'],
       ['Decision, not correction', 'A human decision is recorded as a decision and re-applied on every rebuild. It must never be written directly over the source data, which would be erased by the next refresh and would leave the rule still wrong.'],
       ['Decision scope', 'A decision settles which source was correct. It does not create evidence. A day confirmed as worked but carrying no evidence remains unscored.'],
       ['Ageing', 'Open items age visibly and are reported by owner, in the same way as undecided requests.']],
      widths=[1.9, 4.9])

# ─────────────────────────── 20 ───────────────────────────
h1('20. Outage and Technical Issue Management', '[NEW]')
h2('20.1 Outage Workflow')
numbers([
    'Agent, Team Leader or RTA reports an outage: type, function/channel affected, start time, severity.',
    'RTA validates the outage and confirms the impacted intervals and affected agents.',
    'WFM and Operations see the coverage and SLA impact.',
    'The concerned team (IT, telephony, CRM, vendor) is assigned an owner.',
    'SLA is tracked to resolution; root cause and resolution are recorded.',
    'Impact is calculated before, during and after, and the affected time is excluded from unauthorized-offline calculations.',
])
para('Categories should include at minimum: inbound/IVR, Sprinklr, CRM, application performance, network, '
     'electricity, payment, and other.')
h2('20.2 Technical Issue Workflow')
bullets([
    'Where an agent cannot complete a customer request due to a system fault, the case is placed on internal hold with reason "Technical Issue".',
    'The issue is routed to the validation team / RTA, and escalated to IT when confirmed. Screenshots and recordings may be attached.',
    'Target resolution SLA: 48 hours.',
    'Where the same issue reason recurs for 20 or more customers, it is automatically flagged as a CX issue for escalation.',
    'Track original case ID, customer impact, SKU where relevant, function/channel, issue reason, validator, escalation target, status, repeat count and CX flag.',
])

# ─────────────────────────── 21 ───────────────────────────
h1('21. Recommended Implementation Phases')
table(['Phase', 'Focus', 'Key Deliverables'],
      [['Phase 1', 'Foundation and Visibility',
        'Employee ID mapping and intern-ID folding, integrations with agreed data contracts, roster, attendance reconciliation with the Section 4.4 thresholds, daily/hourly headcount and core dashboards.'],
       ['Phase 2', 'Workflow Automation',
        'Requests, swaps, breaks, overtime acknowledgement and calculation across all three buckets, calendar activities, approval-impact preview and undecided-request ageing.'],
       ['Phase 3', 'Optimization and Analytics',
        'Fairness engine per Section 5.4, cross-skill optimization, advanced conformance/adherence, exception queue, outage management, predictive staffing risks and full reporting suite.']],
      widths=[0.85, 1.75, 4.2])
para('Phase 1 carries the majority of the operational benefit and is the priority. The measurement rules in '
     'Sections 4.4 to 4.6 must be delivered WITH Phase 1 rather than deferred — an integration that reports '
     'attendance without them will produce figures that cannot be reconciled with WFM and will have to be '
     'rebuilt.', italic=True, color=MUTED)

# ─────────────────────────── 22 ───────────────────────────
h1('22. What the Platform Must Refuse to Do', '[NEW]')
para('These constraints are as much a part of the requirement as the formulas. They exist because the '
     'alternative was tried and produced a wrong statement about a real employee.')
table(['Refusal', 'Reason'],
      [['Never mark an employee absent by inference.', 'Missing evidence is a gap in measurement, not proof of behaviour.'],
       ['Never present a modelled or estimated figure as a measured one.', 'Estimated values must be labelled wherever they are displayed.'],
       ['Never conceal a coverage gap behind a complete-looking schedule.', 'An unmet requirement is information that triggers a decision.'],
       ['Never let a hand-edited value stand in place of a rule.', 'It is erased on the next rebuild and the rule remains wrong.'],
       ['Never publish a figure that cannot be re-derived from its inputs.', 'Where verification is impossible, the system must say so rather than imply confidence.']],
      widths=[2.9, 3.9])

# ─────────────────────────── 23 ───────────────────────────
h1('23. Suggested Cover Email')
para('Subject: Integrated WFM Business Requirements — Odoo, Sprinklr and Biometric Integration', bold=True)
para('Dear Maged,')
para('Further to my previous email, please find attached the consolidated WFM Business Requirements Document '
     'It covers roster generation, scheduling rules, real-time headcount, attendance and '
     'Sprinklr integration, requests and approvals, breaks, overtime, calendar activities, coaching, training, '
     'cross-skills, reporting and audit controls.')
para('It also sets out the operating rules that govern how each figure is calculated — measurement '
     'thresholds, evidence requirements, the fairness formula, overtime structure and the data contract for '
     'each feed. These rules are already applied in our current WFM process; they are stated explicitly so '
     'that the integrated solution produces figures identical to the ones the Directorate reports today.')
para('I would highlight two items that affect the data contract itself and are worth reviewing early: '
     'permission approval status must be delivered as a discrete value rather than free text, and a working '
     'day with no punch and no system login must be flagged for review rather than recorded as an absence.')
para('The objective is to review the full operational requirements, assess technical feasibility and agree on '
     'the most suitable implementation phases. I would appreciate scheduling a meeting with the relevant '
     'teams to walk through the document and confirm the next steps.')
para('Thanks & Regards,')
para('Talal')

out = r'C:\Users\t.bassam\Desktop\Integrated_WFM_Business_Requirements.docx'
doc.save(out)
print('saved:', out)
