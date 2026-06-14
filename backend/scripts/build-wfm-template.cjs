/**
 * Boutiqaat WFM Control Workbook — template generator.
 *
 * Produces a real, analyst-ready .xlsx with the architecture we designed:
 *   Reference/Raw layer  →  Calc (FACT) layer with live formulas  →  Dashboards.
 *
 * Example rows use real Excel time/date values so the formulas actually compute
 * when opened — they demonstrate the logic, not just the column names.
 *
 * Run:  node scripts/build-wfm-template.cjs
 */
'use strict';
const XLSX = require('xlsx');
const path = require('path');

// ── cell helpers ─────────────────────────────────────────────────────────────
// Formula cell. SheetJS DROPS formula cells with no cached value on write, so we
// always carry a placeholder `v`; Excel recalculates on open (fullCalcOnLoad).
const F  = (f, t = 'n') => (t === 'str' ? { t: 'str', f, v: '' } : { t: 'n', f, v: 0 });
const TIME = (h, m = 0) => ({ t: 'n', v: (h * 60 + m) / 1440, z: 'hh:mm' });   // Excel time
const DT = (y, mo, d, h = 0, mi = 0) => ({ t: 'n', v: Date.UTC(y, mo - 1, d, h, mi) / 864e5 + 25569, z: 'yyyy-mm-dd hh:mm' });
const N  = (v) => ({ t: 'n', v });
const S  = (v) => ({ t: 's', v });

// Build a worksheet from headers + plain data rows, then overlay special cells.
function sheet(headers, dataRows, cells) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
  for (const [addr, spec] of Object.entries(cells || {})) ws[addr] = spec;
  ws['!cols'] = headers.map((h) => ({ wch: Math.min(Math.max(String(h).length + 2, 11), 26) }));
  ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}1` };
  return ws;
}
function plain(headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.min(Math.max(String(h).length + 2, 12), 40) }));
  return ws;
}

const wb = XLSX.utils.book_new();
const add = (name, ws) => XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));

/* ═══════════════════════════ 0) README / GLOSSARY ═══════════════════════════ */
add('README_Glossary', plain(
  ['Boutiqaat WFM Control Workbook', ''],
  [
    ['Architecture', 'RAW/REF imports → FACT_* (calc + formulas) → DASH_* (role dashboards)'],
    ['', ''],
    ['DEFINITIONS (single source of truth — sign off Ops + HR + WFM)', ''],
    ['Late', 'Fingerprint or System login after Scheduled Start. System drives COVERAGE; Fingerprint drives PAYROLL.'],
    ['Present', 'Fingerprint IN exists for the scheduled day.'],
    ['Productive', 'System active minutes − approved breaks − exempt time.'],
    ['Adherent', 'In scheduled state during scheduled time, excluding EXEMPT time.'],
    ['Exempt time', 'Training, Meeting, Coaching, 1:1, System/Sprinklr/CRM downtime — NOT counted as non-adherence.'],
    ['Effective Capacity', 'Final HC × Concurrency (digital = 4) | Final HC (voice).'],
    ['', ''],
    ['POLICY (configure in REF_Policy)', ''],
    ['Permission quota', 'Max 3 per agent per week.'],
    ['Adherence target', '85–90%.'],
    ['Blackout calendar', 'Campaign / flash-sale days — requests auto-restricted.'],
    ['', ''],
    ['GOVERNANCE', ''],
    ['Data owner', 'WFM Analyst (FACT sheets) · Governance (Audit) · RTA (Interval).'],
    ['Refresh', 'RAW daily 06:00 (Power Query) + intraday pull for FACT_Interval / FACT_Request.'],
    ['Audit', 'Append-only — never edit historical rows.'],
    ['Build engine', 'Mirrors the platform /reports/workbook export. Replace example rows with Power Query loads.'],
  ],
));

/* ═══════════════════════════ REFERENCE LAYER ═══════════════════════════════ */
add('REF_AgentMaster', plain(
  ['AgentID', 'AgentName', 'Function', 'TeamLeader', 'Gender', 'EmploymentType', 'Skills', 'Concurrency'],
  [
    ['E1024', 'Sara Ahmad', 'Live Chat', 'TL Noura', 'F', 'Full-time', 'Chat;WhatsApp', 4],
    ['E1088', 'Omar Khaled', 'Voice', 'TL Faisal', 'M', 'Full-time', 'Voice;Refund', 1],
  ],
));
add('REF_RequiredHC', plain(
  ['Date', 'Interval', 'Function', 'RequiredHC', 'ForecastVolume', 'ForecastAHT', 'Basis'],
  [
    ['2026-06-10', '15:00-15:30', 'Live Chat', 8, 120, 360, 'P90 per weekday'],
    ['2026-06-10', '15:00-15:30', 'Voice', 6, 90, 300, 'P90 per weekday'],
  ],
));
add('REF_Policy', plain(
  ['PolicyKey', 'Value', 'Notes'],
  [
    ['PermissionPerWeek', 3, 'Max permission requests per agent per week'],
    ['AdherenceTarget', 0.88, 'Floor for green'],
    ['SLATarget_Permission_Min', 30, 'Approval SLA for permission'],
    ['SLATarget_Leave_Min', 240, 'Approval SLA for leave'],
    ['DigitalConcurrency', 4, 'Chat/WhatsApp simultaneous'],
    ['BlackoutDates', '2026-06-26;2026-07-01', 'Campaign days — restrict requests'],
    ['CoachingThreshold', 3, 'Repeated issues in 30 days → coaching'],
  ],
));

/* ═══════════════════════════ RAW LAYER (load targets) ══════════════════════ */
add('RAW_Requests', plain(
  ['RequestID', 'Type', 'AgentID', 'SubmittedDateTime', 'RequestedFrom', 'RequestedTo', 'Status', 'ApprovedBy', 'RejectedBy', 'ApprovalLevel', 'DecisionDateTime', 'Reason', 'Attachment'],
  [['(loaded via Power Query from the platform /reports/requests-detailed)', '', '', '', '', '', '', '', '', '', '', '', '']],
));
add('RAW_Schedule', plain(
  ['Date', 'AgentID', 'ShiftCode', 'SchedStart', 'SchedEnd', 'Function', 'TeamLeader'],
  [['(loaded from WFM schedule export)', '', '', '', '', '', '']],
));
add('RAW_Fingerprint', plain(
  ['Date', 'AgentID', 'FingerprintIn', 'FingerprintOut'],
  [['(loaded from fingerprint device export)', '', '', '']],
));
add('RAW_SystemLog', plain(
  ['Date', 'AgentID', 'SystemLogin', 'SystemLogout', 'SystemActiveMin', 'ExemptMin'],
  [['(loaded from Sprinklr/Ameyo state export)', '', '', '', '', '']],
));

/* ═══════════════════════ FACT_Attendance (flagship, formulas) ══════════════ */
{
  const h = [
    'Date', 'AgentID', 'AgentName', 'Function', 'TeamLeader', 'ShiftCode',         // A-F
    'SchedStart', 'SchedEnd', 'FingerprintIn', 'FingerprintOut',                   // G-J
    'SystemLogin', 'SystemLogout',                                                 // K-L
    'FP_LateMin', 'Sys_LateMin', 'FinalLateMin',                                   // M-O
    'FP_EarlyOutMin', 'Sys_EarlyOutMin', 'FinalEarlyOutMin',                       // P-R
    'ApprovedLate?', 'ApprovedEarly?', 'ExemptMin', 'ApprovedBreakMin', 'OverBreakMin', // S-W
    'SchedProductiveMin', 'SystemActiveMin', 'ProductiveMin',                      // X-Z
    'NonAdherenceMin', 'Adherence%', 'AttendanceStatus', 'RepeatedLate30', 'CoachingFlag', // AA-AE
  ];
  // two example rows of inputs (text + placeholder for time/formula cols filled below)
  // Only leading text cols in the AOA; everything else set via cells (no drift).
  const rows = [
    ['2026-06-10', 'E1024', 'Sara Ahmad', 'Live Chat', 'TL Noura', 'C'],
    ['2026-06-10', 'E1088', 'Omar Khaled', 'Voice', 'TL Faisal', 'C'],
  ];
  const cells = {};
  [2, 3].forEach((r, i) => {
    cells[`S${r}`] = S('N');  // ApprovedLate?
    cells[`T${r}`] = S('N');  // ApprovedEarly?
    // input times (row 2 = on-time-ish, row 3 = late+early)
    const startH = 13, endH = 22;
    cells[`G${r}`] = TIME(startH, 0);
    cells[`H${r}`] = TIME(endH, 0);
    cells[`I${r}`] = i === 0 ? TIME(13, 7)  : TIME(13, 25);  // fingerprint in
    cells[`J${r}`] = i === 0 ? TIME(22, 2)  : TIME(21, 40);  // fingerprint out
    cells[`K${r}`] = i === 0 ? TIME(13, 12) : TIME(13, 30);  // system login
    cells[`L${r}`] = i === 0 ? TIME(21, 50) : TIME(21, 35);  // system logout
    cells[`U${r}`] = N(0);   // ExemptMin
    cells[`V${r}`] = N(60);  // ApprovedBreakMin
    cells[`W${r}`] = N(0);   // OverBreakMin
    // formulas
    cells[`M${r}`] = F(`MAX(0,(I${r}-G${r})*1440)`);
    cells[`N${r}`] = F(`MAX(0,(K${r}-G${r})*1440)`);
    cells[`O${r}`] = F(`MAX(M${r},N${r})`);
    cells[`P${r}`] = F(`MAX(0,(H${r}-J${r})*1440)`);
    cells[`Q${r}`] = F(`MAX(0,(H${r}-L${r})*1440)`);
    cells[`R${r}`] = F(`MAX(P${r},Q${r})`);
    cells[`X${r}`] = F(`MOD(H${r}-G${r},1)*1440`);              // sched productive
    cells[`Y${r}`] = F(`MOD(L${r}-K${r},1)*1440`);              // system active
    cells[`Z${r}`] = F(`Y${r}-V${r}-U${r}`);                    // productive
    cells[`AA${r}`] = F(`IF(S${r}="N",O${r},0)+IF(T${r}="N",R${r},0)+W${r}`); // non-adherence
    cells[`AB${r}`] = F(`IF((X${r}-U${r})=0,0,(X${r}-U${r}-AA${r})/(X${r}-U${r}))`); // adherence %
    cells[`AB${r}`].z = '0.0%';
    cells[`AC${r}`] = F(`IF(I${r}="","Absent",IF(O${r}>0,"Late","On time"))`, 'str');
    cells[`AD${r}`] = F(`COUNTIFS($B$2:$B$10000,B${r},$O$2:$O$10000,">0",$A$2:$A$10000,">="&(A${r}-30))`);
    cells[`AE${r}`] = F(`IF(AD${r}>=VLOOKUP("CoachingThreshold",REF_Policy!$A:$B,2,FALSE),"Yes","")`, 'str');
  });
  add('FACT_Attendance', sheet(h, rows, cells));
}

/* ═══════════════════════ FACT_Interval (HC impact, formulas) ═══════════════ */
{
  const h = [
    'Date', 'Interval', 'Function', 'ShiftCode',                 // A-D
    'RequiredHC', 'ScheduledHC', 'Concurrency',                  // E-G
    'ApprovedPermEarly', 'Sick', 'Absent', 'NoShow', 'SystemDown', // H-L
    'ApprovedOT', 'CrossSkillCover',                             // M-N
    'FinalHC', 'EffectiveCapacity', 'Gap', 'RiskLevel', 'SLA_QueueImpact', 'Notes', // O-T
  ];
  const rows = [
    ['2026-06-10', '15:00-15:30', 'Live Chat', 'C', 8, 9, 4, 2, 1, 0, 0, 0, 0, 1, '', '', '', '', 'Watch', ''],
    ['2026-06-10', '20:00-20:30', 'Voice', 'N', 6, 6, 1, 1, 0, 1, 1, 0, 0, 0, '', '', '', '', 'Abandon risk', ''],
  ];
  const cells = {};
  [2, 3].forEach((r) => {
    cells[`O${r}`] = F(`F${r}-H${r}-I${r}-J${r}-K${r}-L${r}+M${r}+N${r}`);
    cells[`P${r}`] = F(`O${r}*G${r}`);
    cells[`Q${r}`] = F(`P${r}-E${r}`);
    cells[`R${r}`] = F(`IF(Q${r}>=0,"OK",IF(E${r}=0,"OK",IF(Q${r}/E${r}>=-0.1,"Watch",IF(Q${r}/E${r}>=-0.2,"High","Critical"))))`, 'str');
  });
  add('FACT_Interval', sheet(h, rows, cells));
}

/* ═══════════════════════ FACT_Request (SLA, formulas) ══════════════════════ */
{
  const h = [
    'RequestID', 'Type', 'AgentID', 'AgentName', 'Function', 'TeamLeader', 'ShiftCode', // A-G
    'SubmittedDateTime', 'RequestedFrom', 'RequestedTo', 'RequestedDurationMin',         // H-K
    'Status', 'PendingWith', 'ApprovedBy', 'RejectedBy', 'ApprovalLevel',                // L-P
    'DecisionDateTime', 'ResponseTimeMin', 'SLATargetMin', 'SLAStatus',                  // Q-T
    'Reason', 'Attachment', 'HCImpact', 'CoachingFlag', 'AuditNotes',                     // U-Y
  ];
  const rows = [
    ['REQ-1001', 'Permission', 'E1024', 'Sara Ahmad', 'Live Chat', 'TL Noura', 'C', '', '', '', '', 'Approved', '', 'TL Noura', '', 'L1', '', '', 30, '', 'Doctor', 'Yes', '-1', '', ''],
    ['REQ-1002', 'Early Out', 'E1088', 'Omar Khaled', 'Voice', 'TL Faisal', 'C', '', '', '', '', 'Rejected', '', '', 'WFM', 'L2', '', '', 30, '', 'Personal', 'No', '0', '', 'Coverage risk'],
  ];
  const cells = {};
  // row 2: approved within SLA
  cells['H2'] = DT(2026, 6, 10, 13, 5);  cells['I2'] = TIME(15, 0); cells['J2'] = TIME(16, 0); cells['Q2'] = DT(2026, 6, 10, 13, 20);
  // row 3: rejected, slower
  cells['H3'] = DT(2026, 6, 10, 18, 10); cells['I3'] = TIME(21, 0); cells['J3'] = TIME(22, 0); cells['Q3'] = DT(2026, 6, 10, 19, 5);
  [2, 3].forEach((r) => {
    cells[`K${r}`] = F(`MOD(J${r}-I${r},1)*1440`);
    cells[`R${r}`] = F(`IF(Q${r}="","",(Q${r}-H${r})*1440)`);
    cells[`T${r}`] = F(`IF(Q${r}="","Pending",IF(R${r}<=S${r},"Met","Breached"))`, 'str');
  });
  add('FACT_Request', sheet(h, rows, cells));
}

/* ═══════════════════════════ DASHBOARDS ════════════════════════════════════ */
const dash = (name, kpis) => {
  const ws = XLSX.utils.aoa_to_sheet([[name, ''], ['KPI', 'Value'], ...kpis.map(([l]) => [l, ''])]);
  kpis.forEach(([, f], i) => { if (f) ws[`B${i + 3}`] = F(f); });
  ws['!cols'] = [{ wch: 38 }, { wch: 16 }];
  add(name, ws);
};

dash('DASH_Exec', [
  ['Total Requests', 'COUNTA(FACT_Request!A2:A10000)'],
  ['Approved', 'COUNTIF(FACT_Request!L2:L10000,"Approved")'],
  ['Rejected', 'COUNTIF(FACT_Request!L2:L10000,"Rejected")'],
  ['Pending', 'COUNTIF(FACT_Request!L2:L10000,"Pending")'],
  ['Avg Approval Time (min)', 'IFERROR(AVERAGEIF(FACT_Request!R2:R10000,">0"),0)'],
  ['SLA Breached', 'COUNTIF(FACT_Request!T2:T10000,"Breached")'],
  ['Net HC Impact (intervals)', 'SUM(FACT_Interval!Q2:Q10000)'],
  ['Critical Intervals', 'COUNTIF(FACT_Interval!R2:R10000,"Critical")'],
  ['Coaching Required', 'COUNTIF(FACT_Attendance!AE2:AE10000,"Yes")'],
]);
dash('DASH_WFM', [
  ['Required HC (sum)', 'SUM(FACT_Interval!E2:E10000)'],
  ['Scheduled HC (sum)', 'SUM(FACT_Interval!F2:F10000)'],
  ['Effective Capacity (sum)', 'SUM(FACT_Interval!P2:P10000)'],
  ['Total Gap', 'SUM(FACT_Interval!Q2:Q10000)'],
  ['High-Risk Intervals', 'COUNTIF(FACT_Interval!R2:R10000,"High")'],
  ['Critical Intervals', 'COUNTIF(FACT_Interval!R2:R10000,"Critical")'],
  ['Pending Requests', 'COUNTIF(FACT_Request!L2:L10000,"Pending")'],
  ['Approved OT (sum)', 'SUM(FACT_Interval!M2:M10000)'],
]);
dash('DASH_TL', [
  ['Team Late Today', 'COUNTIF(FACT_Attendance!AC2:AC10000,"Late")'],
  ['Team Absent', 'COUNTIF(FACT_Attendance!AC2:AC10000,"Absent")'],
  ['Avg Team Adherence', 'IFERROR(AVERAGE(FACT_Attendance!AB2:AB10000),0)'],
  ['Pending Requests', 'COUNTIF(FACT_Request!L2:L10000,"Pending")'],
  ['Coaching Flags', 'COUNTIF(FACT_Attendance!AE2:AE10000,"Yes")'],
]);
dash('DASH_Agent', [
  ['My Requests', 'COUNTIF(FACT_Request!C2:C10000,"E1024")'],
  ['My Approved', 'COUNTIFS(FACT_Request!C2:C10000,"E1024",FACT_Request!L2:L10000,"Approved")'],
  ['My Late Days (30d)', 'COUNTIFS(FACT_Attendance!B2:B10000,"E1024",FACT_Attendance!O2:O10000,">0")'],
  ['My Adherence (avg)', 'IFERROR(AVERAGEIF(FACT_Attendance!B2:B10000,"E1024",FACT_Attendance!AB2:AB10000),0)'],
]);

/* ═══════════════════════════ WRITE ═════════════════════════════════════════ */
// Force Excel to recalculate every formula on open (placeholder cached values).
wb.Workbook = wb.Workbook || {};
wb.Workbook.CalcPr = { fullCalcOnLoad: true };

const out = path.join(__dirname, '..', '..', 'Boutiqaat_WFM_Control_Workbook.xlsx');
XLSX.writeFile(wb, out);
console.log('✓ Workbook written:', out);
console.log('  Sheets:', wb.SheetNames.length, '→', wb.SheetNames.join(', '));
