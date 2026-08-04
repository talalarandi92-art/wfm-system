"""
Build the companion annex: every rule shown working on live data.

Employees are anonymised throughout. The document will be circulated by email; the whole
premise of the rules it documents is that no one is judged unfairly, and that premise does
not survive attaching a named person's attendance record to a distributed file. The dates,
times and arithmetic are exactly as they occurred — only the names are replaced.
"""
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

ACCENT = RGBColor(0x1F, 0x3B, 0x73)
MARK = RGBColor(0xB0, 0x30, 0x10)
MUTED = RGBColor(0x55, 0x5F, 0x6D)
GOOD = RGBColor(0x0B, 0x6B, 0x4A)

doc = Document()
st = doc.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(10.5)
for s in doc.sections:
    s.left_margin = s.right_margin = Inches(0.8)
    s.top_margin = s.bottom_margin = Inches(0.65)


def h1(t):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(16); p.paragraph_format.space_after = Pt(4)
    r = p.add_run(t); r.bold = True; r.font.size = Pt(14); r.font.color.rgb = ACCENT


def h2(t):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(11); p.paragraph_format.space_after = Pt(3)
    r = p.add_run(t); r.bold = True; r.font.size = Pt(11.5); r.font.color.rgb = ACCENT


def para(t, bold=False, italic=False, size=10.5, color=None, space=3):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(space)
    r = p.add_run(t); r.bold = bold; r.italic = italic; r.font.size = Pt(size)
    if color: r.font.color.rgb = color


def mono(t, color=None):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.left_indent = Inches(0.2)
    r = p.add_run(t); r.font.name = 'Consolas'; r.font.size = Pt(9)
    r.font.color.rgb = color or RGBColor(0x22, 0x2A, 0x36)


def bullets(items):
    for it in items:
        p = doc.add_paragraph(style='List Bullet'); p.paragraph_format.space_after = Pt(1.5)
        p.add_run(it).font.size = Pt(10.5)


def table(headers, rows, widths=None, small=False):
    t = doc.add_table(rows=1, cols=len(headers)); t.style = 'Light Grid Accent 1'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    fs = Pt(8.5) if small else Pt(9.5)
    for i, htxt in enumerate(headers):
        c = t.rows[0].cells[i]; c.text = ''
        r = c.paragraphs[0].add_run(str(htxt)); r.bold = True; r.font.size = fs
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ''
            cells[i].paragraphs[0].add_run(str(v)).font.size = fs
    if widths:
        for r_ in t.rows:
            for i, w in enumerate(widths):
                r_.cells[i].width = Inches(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def rule(txt):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(5); p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.left_indent = Inches(0.15)
    r = p.add_run('RULE  '); r.bold = True; r.font.size = Pt(9); r.font.color.rgb = MARK
    r2 = p.add_run(txt); r2.font.size = Pt(10.5); r2.bold = True


def result(txt):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(9)
    p.paragraph_format.left_indent = Inches(0.15)
    r = p.add_run('RESULT  '); r.bold = True; r.font.size = Pt(9); r.font.color.rgb = GOOD
    r2 = p.add_run(txt); r2.font.size = Pt(10.5)


# ────────────────────────────── COVER ──────────────────────────────
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run('ANNEX A — WORKED EXAMPLES AND DATA CONTRACTS')
r.bold = True; r.font.size = Pt(18); r.font.color.rgb = ACCENT
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run('Companion to the Integrated WFM Business Requirements Document')
r.font.size = Pt(11.5); r.font.color.rgb = MUTED

para('Every rule in the main document is shown here operating on live data from the current WFM process, '
     'with the exact inputs, the rule applied, and the resulting figure. The purpose is to remove '
     'interpretation: an implementation that reproduces the outputs in this annex is correct, and one that '
     'does not is not.', space=6)
para('Employee names are replaced throughout with letters. Dates, times, durations and arithmetic are '
     'exactly as they occurred.', italic=True, color=MUTED, space=8)

h2('A.0  Scale of the current dataset')
table(['Measure', 'Value'],
      [['Reconciled person-days on record', '21,588'],
       ['Distinct employees', '140'],
       ['Period covered', '2026-01-01 to 2026-08-01'],
       ['Functions', '18'],
       ['Typical weekly volume', '~104 employees × 7 days ≈ 730 person-days'],
       ['Typical weekly source volume', '~1,100 biometric rows · ~700 Sprinklr sessions · ~75 permission rows']],
      widths=[2.9, 3.9])
para('These figures size the integration: the feeds are small, and the difficulty is entirely in the rules, '
     'not the volume.', italic=True, color=MUTED)

# ────────────────────────────── 1 DATA CONTRACTS ──────────────────────────────
h1('A.1  Data contracts — the exact shape of each feed')
para('Below are the column headers as they appear in the current exports. The integrated solution must '
     'deliver at least these fields, with stable names.')

h2('A.1.1  Schedule — "Shift" sheet (the tall format, one row per person per day)')
mono('Date | Day | Campaign | Name | ID | User ID | Team | Email | Team Manager | Gender |\n'
     'Location | Function | Shift Time | Shift | Shift Start Time | Shift End Time |\n'
     'Shift Start Time 2 | Shift End Time 2 | Punch In | Punch Out')
para('The matrix view (one column per date) is useful for humans but is NOT sufficient as a feed: it carries '
     'the shift code only — no email, no exact shift times, no gender, no manager. Email is the key that '
     'joins Sprinklr sessions to employees; without it no session can be matched.', space=7)

h2('A.1.2  Biometric attendance — Odoo fingerprint export')
mono('Code | Date | In | Out | Total | Late In | Early Out | OT | Status')
para('"Code" is the employee ID. Absent values must be transmitted as empty, never as zero — a zero punch '
     'time is 00:00, which is a valid midnight punch.', space=7)

h2('A.1.3  Permissions and compensatory days — Odoo export')
mono('Employee | id | Date | Type | Time From | Time To | Total Hours | Status')
para('"Status" is the field that must become an enumerated value. Its current distribution across the live '
     'dataset is shown in section A.3.', space=7)

h2('A.1.4  System sessions — Sprinklr Login and Logout')
mono('Agent Email ID | Login Timestamp | Logout Timestamp | Logged In Time (SUM)')
para('Two shape variations have already been encountered in production exports, and both must be handled or '
     'prevented by a stable contract:', space=3)
bullets(['The header row is not always the first row — widget exports prefix the sheet with title and '
          'date-interval banner rows.',
          'The login has appeared both as a "Login Date" + "Login Time" pair and as a single "Login '
          'Timestamp" cell. Reading the wrong shape produced zero sessions from a file containing 704 rows.'])

# ────────────────────────────── 2 WORKED EXAMPLES ──────────────────────────────
h1('A.2  Worked examples — each rule, on real data')

h2('A.2.1  Tolerance and the credible range')
rule('Tolerance 6 minutes. A credible late arrival is 7 to 240 minutes.')
table(['Case', 'Scheduled start', 'System login', 'Difference', 'Recorded as'],
      [['Employee A', '09:00', '09:04', '4 min', 'Nothing — within tolerance'],
       ['Employee B', '09:00', '09:11', '11 min', 'Late, 11 minutes'],
       ['Employee C', '13:00', '13:06', '6 min', 'Nothing — at the tolerance boundary']],
      widths=[1.25, 1.35, 1.3, 1.1, 1.85])
result('An implementation without the tolerance would report Employee A and Employee C as late. Over a month '
       'that alone produces hundreds of false exceptions and destroys confidence in the report.')

h2('A.2.2  Cross-midnight shift — the whole calculation')
rule('A cross-midnight shift is owned entirely by the day it started; the session must be unwrapped against '
     'the shift, not against the calendar.')
para('Employee D, 2026-07-14, MD shift.', bold=True)
table(['Input', 'Value'],
      [['Scheduled window', '22:00 → 07:00 the following morning (9 hours gross)'],
       ['System login', '02:56 — four hours 56 minutes after the shift start'],
       ['System logout', '07:00'],
       ['Permission', 'Approved, covering the late arrival (296 minutes)'],
       ['Overlap with the scheduled window', '244 minutes'],
       ['Permitted credit', '296 minutes']],
      widths=[2.5, 4.3])
mono('conformance = 100 × min(overlap 244 + permitted 296, paid 540) ÷ paid 540\n'
     '            = 100 × min(540, 540) ÷ 540\n'
     '            = 100%')
result('100%. The employee arrived late with an approved permission; the permission credits the minutes back '
       'and conformance is unaffected. Note that BOTH the session start and end fall after midnight — an '
       'implementation that unwraps the session only when logout precedes login will compute an overlap of '
       'zero here and report 55%.')

h2('A.2.3  Early arrival must not be misread as a next-day session')
rule('Session times are stored as time-of-day. Recovering the correct calendar day requires choosing the '
     'candidate nearest the shift anchor — not applying a threshold.')
para('Employee E, 2026-07-03, E shift.', bold=True)
table(['Input', 'Value'],
      [['Scheduled window', '16:00 → 01:00 (cross-midnight)'],
       ['System login', '15:57 — three minutes BEFORE the shift start'],
       ['System logout', '01:04'],
       ['Overlap', '540 minutes — the full shift']],
      widths=[2.5, 4.3])
result('100%. A rule of "anything before the shift start belongs to the next day" would place this login 24 '
       'hours later and return 0%. Across two months, 505 ordinary and 241 cross-midnight sessions began '
       'before their shift start — arriving early is normal behaviour, not an anomaly.')

h2('A.2.4  Protected employee — permission credit and the maternity window are different mechanisms')
rule('An approved permission CREDITS minutes back. The maternity rule stops them being CHARGED but grants no '
     'credit — it shortens the measured window instead.')
para('Employee F, maternity-protected, two days in the same month:', bold=True)
table(['Date', 'Shift', 'Permission', 'Raw early-out', 'Paid window', 'Conformance'],
      [['2026-07-20', 'B 09:00–18:00', 'Early Out Permission — HR Approved', '240 min', '420 min (capped at 7h)', '100%'],
       ['2026-07-23', 'B 09:00–18:00', 'Late In Permission — Waiting 2nd Approval', '110 min', '420 min (capped at 7h)', '70%']],
      widths=[1.1, 1.5, 2.1, 0.95, 1.35, 0.95])
result('On 20 July the approved permission credits 240 minutes and conformance is 100%. On 23 July the '
       'permission is still PENDING, so nothing is credited and the late arrival is charged — 70%. Treating '
       '"Waiting 2nd Approval" as an approval would have produced 100% on both days and excused a lateness '
       'that no one had approved.')

h2('A.2.5  A day with no evidence')
rule('A working day with neither a punch nor a system session is FLAGGED for review. Worked minutes are '
     'zero. It is never recorded automatically as an absence.')
para('Employee G, 2026-07-23, N shift (13:00–22:00).', bold=True)
table(['Source', 'What it shows'],
      [['Schedule', 'N shift scheduled'],
       ['Biometric punch', 'None'],
       ['Sprinklr session', 'None'],
       ['Odoo status', 'Off Day']],
      widths=[2.2, 4.6])
result('The schedule and the HR record contradict each other, and there is no evidence to settle it. The day '
       'is placed in a decision queue for a human. It is NOT recorded as an absence, and it is NOT counted as '
       'a worked day. In July 2026, 289 of 1,964 scheduled working days fell into this state — 14.7%. Any '
       'system that resolves these automatically will be wrong on roughly one working day in seven.')

h2('A.2.6  A human decision settles the source, not the evidence')
rule('A recorded decision settles WHICH SOURCE was correct about whether the day was worked. It does not and '
     'cannot supply evidence of how the employee performed.')
para('Continuing the case above — a reviewer confirms the schedule was right and the day was a working day.',
     bold=True)
table(['Before the decision', 'After the decision'],
      [['Flagged as an unresolved schedule-vs-HR conflict', 'Conflict resolved — leaves the queue'],
       ['Not scored', 'Still not scored'],
       ['worked = 0', 'worked = 0']],
      widths=[3.4, 3.4])
result('The conflict is answered; the measurement is not. Confirming that someone was meant to work does not '
       'create a record of when they logged in. A system that scores the day after the decision has '
       'manufactured evidence out of an opinion.')

h2('A.2.7  Overtime — three buckets')
rule('TRUE_OT = worked-day OT + off-day OT + holiday OT. Three disjoint buckets, always summed.')
table(['Bucket', 'July 2026', 'Note'],
      [['Worked-day OT', '376 hours', 'Time beyond the scheduled shift end'],
       ['Off-day OT', '0 hours', 'None recorded in this period'],
       ['Holiday OT', '0 hours', 'No official holiday fell in the period'],
       ['TRUE_OT', '376 hours', 'The figure that reaches payroll']],
      widths=[1.6, 1.4, 3.8])
result('In a month containing an official holiday the three buckets diverge sharply, and reading only the '
       'first under-reports total overtime by roughly a quarter. The reporting must always present the sum '
       'and must never subtract one bucket from another.')

h2('A.2.8  Work from home is a status, not an inference')
rule('WFH is concluded from a WFH shift code, an explicit WFH location, or an Odoo WFH status — never from '
     '"system login but no punch".')
table(['July 2026 — how each working day was witnessed', 'Days'],
      [['System session AND biometric punch', '710'],
       ['System session only', '858'],
       ['Biometric punch only', '107'],
       ['Neither — flagged for review', '289']],
      widths=[4.6, 2.2])
result('858 days carry a system session and no punch. Inferring WFH from that pattern would reclassify '
       'roughly 44% of all working days as home working. The actual WFH figure for the month, taken from the '
       'declared status, is 954 days out of 3,277 — and they are not the same days.')

h2('A.2.9  OFF-day rule and current compliance')
rule('Each employee receives exactly 2 OFF days per Saturday-to-Friday week; deviation requires an '
     'authorised exception.')
table(['OFF days in the week', 'Share of person-weeks'],
      [['2 — compliant', '74.7%'],
       ['1', '15.4%'],
       ['0', '6.2%'],
       ['3', '3.8%']],
      widths=[2.6, 4.2])
result('A quarter of person-weeks currently deviate from the rule, because the spreadsheet cannot enforce it. '
       'This is a concrete example of what the integrated system is for: the rule already exists, and only '
       'automation can hold it.')

h2('A.2.10  Which days are the weekend')
table(['Day', 'Share of OFF days', ''],
      [['Friday', '32.7%', 'Weekend'],
       ['Saturday', '27.8%', 'Weekend'],
       ['Monday', '26.9%', ''],
       ['Thursday', '26.8%', ''],
       ['Wednesday', '26.0%', ''],
       ['Tuesday', '22.9%', ''],
       ['Sunday', '22.5%', '']],
      widths=[1.5, 2.0, 3.3])
result('Friday and Saturday carry the weekend load. The distribution is otherwise flat, which is expected in '
       'a 24/7 operation — and is exactly why weekend-OFF fairness has to be counted per person rather than '
       'assumed.')

# ────────────────────────────── 3 ENUM ──────────────────────────────
h1('A.3  Permission status — why it must be an enumerated value')
para('The live distribution of the status field, and what a partial text match on "approv" does to each:')
table(['Status text', 'Rows', 'Contains "approv"', 'Correct meaning'],
      [['HR Approved', '1,381', 'Yes', 'APPROVED'],
       ['Approval Refused', '55', 'Yes — but it is a REFUSAL', 'REFUSED'],
       ['HR Refused', '42', 'No', 'REFUSED'],
       ['Waiting 2nd Approval', '21', 'Yes — but it is PENDING', 'PENDING'],
       ['Waiting 1st Approval', '8', 'Yes — but it is PENDING', 'PENDING'],
       ['HR Pending', '5', 'No', 'PENDING'],
       ['HR Cancelled', '1', 'No', 'CANCELLED']],
      widths=[1.75, 0.7, 2.3, 1.4])
result('84 of 1,513 rows — 5.6% — would be read as approved when they are not, and 55 of those are outright '
       'refusals. Only an APPROVED permission excuses lateness, so this single field determines whether an '
       'employee is charged for a late arrival that management declined to authorise.')

# ────────────────────────────── 4 CODES ──────────────────────────────
h1('A.4  Shift code dictionary as currently used')
para('Verified against live roster data. Any implementation must import the full dictionary rather than a '
     'fixed subset — this list changes as the operation changes.')
table(['Code', 'Window', 'Hours', 'Usage (from June 2026)'],
      [['N', '13:00–22:00', '9', '956 days'],
       ['B', '09:00–18:00', '9', '843'],
       ['M', '07:00–16:00', '9', '672'],
       ['MD', '22:00–07:00', '9', '568 — cross-midnight'],
       ['E', '16:00–01:00', '9', '430 — cross-midnight'],
       ['C', '11:00–20:00', '9', '350 — latest shift normally assigned to female employees'],
       ['N20', '14:00–22:00', '8', '103 — supervisory series'],
       ['M7-3', '07:00–15:00', '8', '59'],
       ['B20', '10:00–18:00', '8', '56 — supervisory series'],
       ['CCNO', '09:00–17:00', '8', '44'],
       ['B7', '09:00–16:00', '7', '17 — seven-hour family'],
       ['WFH-M', '08:00–16:00', '8', '11 — note: NOT 07:00, WFH variants carry their own windows'],
       ['C20', '11:00–20:00', '8', '9 — supervisory series'],
       ['M20', '08:00–16:00', '8', '5 — supervisory series'],
       ['WFH-N', '14:00–22:00', '8', '5'],
       ['WFH-B', '10:00–18:00', '8', '5'],
       ['C7 / N7 / M7', '11:00–18:00 / 15:00–22:00 / 07:00–14:00', '7', 'Seven-hour family'],
       ['EE20', '18:00–03:00 agent / 18:00–02:00 admin', '9 / 8', 'ROLE-DEPENDENT — cross-midnight']],
      widths=[1.15, 2.4, 0.6, 2.65], small=True)
para('Two data-quality observations from the live set: the same shift appears as both "WFH-B" and "WFHB", '
     'which the new system must prevent; and no legitimate shift ends at 21:00, so a 21:00 end should be '
     'rejected at entry as a typing error.', italic=True, color=MUTED)

# ────────────────────────────── 5 ACCEPTANCE ──────────────────────────────
h1('A.5  How correctness will be verified')
para('The current process is held to six automated gates, run against live data. The integrated solution '
     'will be accepted against the same bar, and these are offered as ready-made acceptance tests.')
table(['Gate', 'What it proves', 'Current result'],
      [['Integrity audit', '18 checks across the reconciled roster', '16 of 18 clean, 0 high severity'],
       ['Calculation verification', 'Every stored metric recomputed independently from raw inputs and compared', '7 of 7 formulas reproduce exactly'],
       ['Derivation self-check', 'Every scored day re-derives to its stored conformance, or is reported as unverifiable', '1,404 of 1,404 days'],
       ['Cross-check', 'Independent screens must report the same figure for the same concept', '31 of 31 agree'],
       ['Golden master', 'Pay-affecting rules produce unchanged results on a fixed dataset', 'Pass'],
       ['Source-truth verification', 'The database compared cell by cell against the original workbook', '100% on codes, times and punches']],
      widths=[1.5, 3.6, 1.7])
para('The last of these is the strongest and the simplest to adopt: re-open the source file and compare it, '
     'field by field, against what the system stored. A solution that passes it cannot be quietly wrong.',
     italic=True, color=MUTED)

h1('A.6  Summary — what this annex asks of the implementation')
bullets([
    'Reproduce the outputs in section A.2. Each example states its inputs, its rule and its result; matching '
    'them is the definition of correct.',
    'Deliver the feeds in section A.1 with stable field names, and the permission status as an enumerated '
    'value per section A.3.',
    'Import the full shift dictionary rather than a fixed subset, and enforce one canonical spelling per code.',
    'Adopt the gates in section A.5 as acceptance tests, in particular the source-truth comparison.',
    'Where evidence is absent, flag for review. Never infer an absence, and never score a day that nothing '
    'was measured on.',
])

out = r'C:\Users\t.bassam\Desktop\Annex_A_Worked_Examples_and_Data_Contracts.docx'
doc.save(out)
print('saved:', out)
