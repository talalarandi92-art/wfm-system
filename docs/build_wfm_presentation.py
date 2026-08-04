"""
Build the combined request-and-presentation document: the requirement, the rule, the live
evidence, and a screenshot of the working system for each.

Screenshots are read from Desktop/WFM Screenshots by filename. Any shot that is absent is
skipped with no gap in the narrative — the document is complete without images and richer
with them, so it can be circulated at any stage of capture.
"""
import os
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

SHOTS = r'C:\Users\t.bassam\Desktop\WFM Screenshots'
ACCENT = RGBColor(0x1F, 0x3B, 0x73)
MARK = RGBColor(0xB0, 0x30, 0x10)
MUTED = RGBColor(0x55, 0x5F, 0x6D)
GOOD = RGBColor(0x0B, 0x6B, 0x4A)

doc = Document()
st = doc.styles['Normal']; st.font.name = 'Calibri'; st.font.size = Pt(10.5)
for s in doc.sections:
    s.left_margin = s.right_margin = Inches(0.7)
    s.top_margin = s.bottom_margin = Inches(0.6)

missing = []


def h1(t):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(18); p.paragraph_format.space_after = Pt(4)
    r = p.add_run(t); r.bold = True; r.font.size = Pt(15); r.font.color.rgb = ACCENT


def h2(t):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(12); p.paragraph_format.space_after = Pt(3)
    r = p.add_run(t); r.bold = True; r.font.size = Pt(11.5); r.font.color.rgb = ACCENT


def para(t, bold=False, italic=False, size=10.5, color=None, space=3):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(space)
    r = p.add_run(t); r.bold = bold; r.italic = italic; r.font.size = Pt(size)
    if color: r.font.color.rgb = color


def mono(t):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(4); p.paragraph_format.left_indent = Inches(0.2)
    r = p.add_run(t); r.font.name = 'Consolas'; r.font.size = Pt(9)


def bullets(items):
    for it in items:
        p = doc.add_paragraph(style='List Bullet'); p.paragraph_format.space_after = Pt(1.5)
        p.add_run(it).font.size = Pt(10.5)


def table(headers, rows, widths=None, small=False):
    t = doc.add_table(rows=1, cols=len(headers)); t.style = 'Light Grid Accent 1'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    fs = Pt(8.5) if small else Pt(9.5)
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]; c.text = ''
        r = c.paragraphs[0].add_run(str(h)); r.bold = True; r.font.size = fs
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


def ask(txt):
    """The request — what IT is being asked to deliver."""
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(5); p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.left_indent = Inches(0.14)
    r = p.add_run('WHAT WE NEED  '); r.bold = True; r.font.size = Pt(8.5); r.font.color.rgb = ACCENT
    p.add_run(txt).font.size = Pt(10.5)


def rule(txt):
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(4); p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.left_indent = Inches(0.14)
    r = p.add_run('THE RULE  '); r.bold = True; r.font.size = Pt(8.5); r.font.color.rgb = MARK
    r2 = p.add_run(txt); r2.font.size = Pt(10.5); r2.bold = True


def evidence(txt):
    p = doc.add_paragraph(); p.paragraph_format.space_after = Pt(6); p.paragraph_format.left_indent = Inches(0.14)
    r = p.add_run('IN PRACTICE  '); r.bold = True; r.font.size = Pt(8.5); r.font.color.rgb = GOOD
    p.add_run(txt).font.size = Pt(10.5)


def shot(filename, caption, width=6.7):
    """Place a screenshot with its caption. Absent files are skipped silently in the
       document and reported on the console, so an incomplete capture never leaves a hole."""
    path = os.path.join(SHOTS, filename)
    if not os.path.exists(path):
        for ext in ('.png', '.jpg', '.jpeg', '.PNG', '.JPG'):
            alt = os.path.splitext(path)[0] + ext
            if os.path.exists(alt):
                path = alt
                break
        else:
            missing.append(filename)
            return
    p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(6); p.paragraph_format.space_after = Pt(2)
    try:
        p.add_run().add_picture(path, width=Inches(width))
    except Exception as e:
        missing.append(filename + ' (' + str(e)[:40] + ')')
        return
    c = doc.add_paragraph(); c.alignment = WD_ALIGN_PARAGRAPH.CENTER
    c.paragraph_format.space_after = Pt(11)
    r = c.add_run(caption); r.italic = True; r.font.size = Pt(9); r.font.color.rgb = MUTED


def pagebreak():
    doc.add_page_break()


# ══════════════════════════════ COVER ══════════════════════════════
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_before = Pt(40)
r = p.add_run('INTEGRATED WORKFORCE MANAGEMENT')
r.bold = True; r.font.size = Pt(24); r.font.color.rgb = ACCENT
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run('Business Requirements — with the working system as evidence')
r.font.size = Pt(13); r.font.color.rgb = MUTED
p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.space_after = Pt(24)
r = p.add_run('Odoo  ·  Sprinklr  ·  Biometric Attendance  ·  Outlook / Teams Calendar')
r.font.size = Pt(11); r.font.color.rgb = MUTED

table(['', ''],
      [['Prepared by', 'Talal — Workforce Management Directorate'],
       ['Document type', 'Business and Functional Requirements'],
       ['Version', '3.0 — illustrated'],
       ['Date', 'August 2026'],
       ['Purpose', 'To establish one centralized, automated and auditable WFM solution connecting the '
                   'planned roster, employee requests, biometric attendance, Sprinklr activity, real-time '
                   'staffing, calendar activities and payroll validation.']],
      widths=[1.4, 5.6])

para('How to read this document', bold=True, size=11.5, space=4)
para('Each requirement is presented in four parts: what we need, the rule that governs it, what the rule '
     'produces in practice on live data, and a screenshot of that behaviour in the working process today.')
para('The screenshots are not mock-ups. They are the current WFM process operating on live contact-centre '
     'data. They are included because the fastest way to remove ambiguity from a requirement is to show the '
     'behaviour it is asking for. Employee names are anonymised in every worked example.', space=8)

callout_p = doc.add_paragraph(); callout_p.paragraph_format.left_indent = Inches(0.15)
r = callout_p.add_run('Governing principle.  '); r.bold = True; r.font.color.rgb = MARK; r.font.size = Pt(10.5)
r2 = callout_p.add_run('Where the system cannot determine what happened, it flags the day for a person to '
                       'decide. It does not guess, and it never records an absence by inference. Every rule '
                       'in this document serves that principle.')
r2.font.size = Pt(10.5)

pagebreak()

# ══════════════════════════════ 1 ══════════════════════════════
h1('1.  The reconciled record')
ask('One record per employee per day that holds the plan and both measurements side by side — the scheduled '
    'shift, the biometric punch, the system session, and the variance between them.')
rule('The system login is the official basis for lateness and early departure. The biometric punch '
     'corroborates physical presence and is a different measurement — the two are never interchangeable.')
evidence('Across July 2026, of 1,964 scheduled working days: 710 carried both a session and a punch, 858 a '
         'session only, 107 a punch only, and 289 neither. Only a record that keeps both sources visible can '
         'tell those four situations apart.')
shot('01-roster-grid.png',
     'The reconciled roster. Each row carries the plan and both measurements, so a disagreement between '
     'systems is visible rather than averaged away.')

h1('2.  Every number explains itself')
ask('Any figure the system publishes must be traceable to the inputs and the rule that produced it, on demand '
    'and without an export.')
rule('A number that cannot be re-derived from its own inputs is not published. Where verification is not '
     'possible, the system says so rather than implying confidence.')
evidence('Conformance is recomputed from the stored inputs and compared with the stored result on every '
         'scored day. For July 2026 that is 1,404 of 1,404 days re-deriving exactly. Where a day predates the '
         'columns needed to verify it, the drill-down reports it as unverifiable — which is a different '
         'statement from wrong, and is shown differently.')
shot('02-why-these-numbers.png',
     'The reasoning chain behind a single day: what the schedule asked for, who witnessed it, tardiness '
     'before and after forgiveness, the conformance arithmetic, and whether the day counts — each step '
     'carrying the rule that governed it.')

pagebreak()

h1('3.  The system states how far to trust itself')
ask('A standing view of data confidence: how much of the record rests on strong evidence, how much on '
    'partial evidence, and what remains unresolved.')
rule('Ambiguous evidence never becomes an accusation. Unresolved days are a normal operating state, and they '
     'are reported rather than hidden.')
evidence('The trust view reports the share of scored days measured across three quarters of the shift or '
         'more, alongside the count of days deliberately left unscored and the reason for each.')
shot('03-data-trust.png',
     'Data confidence as a first-class figure. Every other screen reports what happened; this one reports '
     'how much of it to believe, and exactly where the confidence runs out.')

h1('4.  Unresolved days go to a person')
ask('Where two sources disagree, the day must reach a named human with the full evidence attached — not be '
    'resolved by whichever source the code happens to read first.')
rule('Where the schedule states the employee worked and the HR record states the day was off, neither source '
     'wins automatically. A recorded decision settles WHICH SOURCE was correct. It does not, and cannot, '
     'supply evidence of how the employee performed — a day confirmed as worked but carrying no evidence '
     'leaves the queue and remains unscored.')
evidence('In July 2026, 289 of 1,964 scheduled working days — 14.7% — reached this state. Any system that '
         'resolves them automatically will be wrong on roughly one working day in seven.')
shot('04-decision-queue.png',
     'Each open item states its case before it offers the buttons: what the schedule said, what each system '
     'saw, what was counted, and the engine\u2019s own reason for refusing to decide.')

pagebreak()

h1('5.  The HR Matrix')
ask('The month grid HR reads for payroll: one row per employee, one column per day, one code per cell — '
    'reconciled, not typed.')
rule('The cell resolves in a fixed precedence: the HR system\u2019s determination first, then the raw '
     'operational code, then the planned shift, then OFF. Sick is always SL and absence is always A — no '
     'invented codes. The original raw entry is preserved underneath even when a higher source overrides '
     'the displayed cell.')
evidence('Annual leave landing on an official holiday reads as the holiday and returns the leave day to the '
         'employee\u2019s balance. This single rule is worth several days a year to every employee it touches.')
shot('05-hr-matrix.png',
     'The month view HR reads. Every cell is derived from the reconciled record rather than entered by hand, '
     'so the grid and the attendance detail cannot disagree.')

h1('6.  Demand-driven schedule generation')
ask('Weekly generation from the forecast — required headcount by hour and function first, shift mix derived '
    'from it, and an honest verdict on what the roster does and does not cover.')
rule('Where coverage cannot be met, the shortfall is published: interval, function, size, cause and the '
     'available remedies. A schedule that looks complete when it is not is a false statement.')
evidence('Midnight coverage can be mathematically impossible when the eligible pool is too small. Publishing '
         'the gap is what turns it into a hiring or cross-skill decision instead of a surprise at 22:00.')
shot('06-schedule-generator.png',
     'Generation with its coverage verdict per function and hour — including where demand is not met, and why.')

pagebreak()

h1('7.  Fairness, measured rather than assumed')
ask('Night, midnight, weekend and OFF distribution tracked per employee, with the imbalance visible at the '
    'moment an assignment is made rather than at the end of the year.')
rule('fairness = 100 \u2212 the standard deviation of night and midnight load across the fair pool. Employees '
     'permanently assigned to a night team are excluded from that pool; fairness is measured on the '
     'pre-swap schedule; and female employees rotate WITHIN their eligible shift set rather than being '
     'frozen on one.')
evidence('The last clause is the one learned the hard way: in an earlier generator the female shift rule '
         'narrowed the eligible set and the fairness pass then had nothing left to rotate. The people the '
         'rule exists to protect became the only ones who never rotated. Protection and rotation are '
         'separate mechanisms and must not collapse into one.')
shot('07-fairness.png',
     'Night and midnight load per employee against the pool. An unfair pattern is visible while it can still '
     'be corrected.')

h1('8.  Headcount by the hour')
ask('Required, Scheduled, Available, Actual and Productive headcount per interval and function, with every '
    'approved request reflected automatically.')
rule('A cross-midnight shift contributes to the intervals it actually covers, while remaining owned by its '
     'start day for all accounting. A partial permission removes the employee only from the intervals it '
     'touches.')
evidence('This is the view that turns an approval into a decision: the approver sees the gap the approval '
         'creates before confirming it, and the figure they were shown is stored with the decision.')
shot('08-hourly-headcount.png',
     'Coverage by interval and function — the difference between what was needed and what was actually on '
     'the floor.')

pagebreak()

h1('9.  Required headcount from forecast volume')
ask('The staffing requirement calculated from forecast workload rather than from last month\u2019s roster.')
rule('Voice uses Erlang-C. Chat, WhatsApp and social use a concurrency-adjusted model at four concurrent '
     'conversations per agent. Email uses a backlog-and-throughput model. Each is then adjusted for '
     'shrinkage and for intern productivity, which is configurable with a working default near 70%.')
evidence('The output is an hourly requirement curve per function, and the shift mix is derived from that '
         'curve — the generator does not start from a fixed pattern of shifts and fit demand to it.')
shot('09-capacity-erlang.png',
     'From forecast volume to required headcount per hour, with the calculation exposed rather than assumed.')

h1('10.  Real-time operations')
ask('A live view of coverage, staffing gaps, agent state and alerts — sourced from the same reconciled '
    'record as the reporting, not from a parallel calculation.')
rule('One definition per concept, estate-wide. Two screens that disagree about what "late" means is worse '
     'than neither screen existing.')
shot('10-live-monitoring.png',
     'Live coverage and alerts. The figures reconcile with the end-of-month report because they are the same '
     'figures.')

pagebreak()

h1('11.  Requests, approvals — and what is still undecided')
ask('Every request tracked end to end, including the item nobody has answered.')
rule('Pending age is tracked and SLA breach is flagged. The coverage figure shown to the approver is stored '
     'with the decision, so a later review judges it on what was known at the time. A shift swap requires '
     'peer acceptance before it reaches approval.')
evidence('The Directorate must be able to answer two questions daily for each RTA team member: what did they '
         'decide and how quickly, and what is sitting with them undecided and for how long. A request nobody '
         'answers has the same operational effect as a refusal but appears in no decision report unless '
         'pending age is tracked explicitly.')
shot('11-requests-approvals.png',
     'The approval trail, including items still awaiting a decision and how long they have waited.')

h1('12.  Overtime — evidence-backed and in three buckets')
ask('Overtime requested, assigned, acknowledged, approved, worked and payroll-validated — calculated, not '
    'declared.')
rule('TRUE_OT = worked-day OT + off-day OT + holiday OT. Three disjoint buckets, always summed and never '
     'subtracted. Off-day and holiday overtime must be evidence-backed: a system login with no biometric '
     'punch is flagged for review, not credited. A scheduled shift worked on an official holiday becomes '
     'wholly holiday overtime, capped at the scheduled net.')
evidence('Approved OT window + biometric presence + Sprinklr activity = validated payable overtime. Reading '
         'only the worked-day bucket under-reports total overtime by roughly a quarter.')
shot('12-ot-tracker.png',
     'Overtime by bucket with its supporting evidence — the figure that reaches payroll and the record behind it.')

pagebreak()

# ══════════════════════════════ CLOSING ══════════════════════════════
h1('13.  How correctness will be verified')
para('The current process is held to six automated gates, run against live data. They are offered as '
     'ready-made acceptance tests for the integrated solution.')
table(['Gate', 'What it proves', 'Current result'],
      [['Integrity audit', '18 checks across the reconciled roster', '16 of 18 clean, 0 high severity'],
       ['Calculation verification', 'Every stored metric recomputed independently from raw inputs', '7 of 7 formulas reproduce'],
       ['Derivation self-check', 'Every scored day re-derives to its stored conformance', '1,404 of 1,404 days'],
       ['Cross-check', 'Independent screens report the same figure for the same concept', '31 of 31 agree'],
       ['Golden master', 'Pay-affecting rules unchanged on a fixed dataset', 'Pass'],
       ['Source-truth verification', 'The database compared cell by cell against the original workbook', '100% on codes, times and punches']],
      widths=[1.55, 3.6, 1.75])
para('The last is the strongest and the simplest to adopt: re-open the source file and compare it field by '
     'field against what the system stored. A solution that passes it cannot be quietly wrong.',
     italic=True, color=MUTED)

h1('14.  What we are asking for')
bullets([
    'A feasibility and access review for Odoo and Sprinklr — is a supported API available, and under what '
    'authentication?',
    'A written data contract per feed: field names, types, enumerated values, refresh frequency, and a '
    'commitment that the contract will not change without notice.',
    'An effort estimate per section, so delivery can be sequenced against operational priority.',
    'A named technical owner per integration, for the edge cases that will certainly arise.',
])
para('Sections 1 and 2 carry the majority of the operational benefit and are the priority. The measurement '
     'rules must be delivered with them rather than deferred — an integration that reports attendance '
     'without them produces figures that cannot be reconciled, and has to be rebuilt.', space=8)
para('The full rule set, the exact column contracts and ten worked examples on live data are in the '
     'accompanying annex.', italic=True, color=MUTED)

out = r'C:\Users\t.bassam\Desktop\WFM_Requirements_Illustrated.docx'
doc.save(out)
print('saved:', out)
if missing:
    print('\nscreenshots not found (sections rendered without them):')
    for m in missing:
        print('   -', m)
    print('\nDrop them into:', SHOTS)
    print('then re-run:  python docs/build_wfm_presentation.py')
else:
    print('all screenshots placed.')
