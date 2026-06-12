import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';

/* ─── Column indices (0-based from the first populated column B).
   XLSX sheet_to_json skips the empty column A, so B becomes index 0.
   ─────────────────────────────────────────────────────────────────────────── */

// Feb 26 / Results sheet (no Incidents / Attendance columns)
// B=0 C=1 D=2 E=3 F=4 G=5 H=6 I=7 J=8 K=9 L=10 M=11 N=12 O=13
// P=14 Q=15 R=16 S=17 T=18 U=19 V=20 W=21 X=22 Y=23 Z=24 AA=25 AB=26 AC=27
const COL = {
  name: 0, empNo: 1, loginId: 2, fn: 3, tl: 4,
  wdPct: 5, netPts: 6, week: 7,
  qualityAct: 8,  qualityScore: 9,
  responseRate: 10, prrRate: 11, prrPts: 12, prrBonus: 13,
  ahtAct: 14, ahtScore: 15,
  fcrAct: 16, fcrScore: 17,
  prodAct: 18, prodScore: 19,
  ctrAct: 20, ctrScore: 21,
  quizAct: 22, quizScore: 23,
  mistakesAct: 24, mistakesScore: 25,
  rtAct: 26, rtScore: 27,
};

// Feb SC 26 main sheet — headers at row 13 (0-based: 12).
// Extra columns: Incidents (AB=26, AC=27), Attendance (AD=28, AE=29),
// Response Time pushed to AF=30, AG=31.
const COL1 = {
  name: 0, empNo: 1, loginId: 2, fn: 3, tl: 4,
  wdPct: 5, netPts: 6, week: 7,
  qualityAct: 8,  qualityScore: 9,
  responseRate: 10, prrRate: 11, prrPts: 12, prrBonus: 13,
  ahtAct: 14, ahtScore: 15,
  fcrAct: 16, fcrScore: 17,
  prodAct: 18, prodScore: 19,
  ctrAct: 20, ctrScore: 21,
  quizAct: 22, quizScore: 23,
  mistakesAct: 24, mistakesScore: 25,
  incAct: 26, incScore: 27,
  attAct: 28, attScore: 29,
  rtAct: 30, rtScore: 31,
};

/* ─── Types ─────────────────────────────────────────────────────────────── */
export interface ScorecardEntryRaw {
  employeeNo: string;
  employeeName: string;
  loginId: string;
  functionName: string;
  teamLeader: string;
  weekLabel: string;
  workingDaysPct: number | null;
  netPoints: number | null;
  qualityActual: number | null;   qualityScore: number | null;
  responseRate: number | null;
  prrRate: number | null;         prrPoints: number | null; prrBonus: number;
  ahtActual: number | null;       ahtScore: number | null;
  fcrActual: number | null;       fcrScore: number | null;
  productivityActual: number | null; productivityScore: number | null;
  ctrActual: number | null;       ctrScore: number | null;
  quizActual: number | null;      quizScore: number | null;
  mistakesActual: number | null;  mistakesScore: number | null;
  incidentsActual: number | null; incidentsScore: number | null;
  attendanceActual: number | null; attendanceScore: number | null;
  responseTimeActual: number | null; responseTimeScore: number | null;
}

export interface ScorecardPreview {
  periodName: string;
  periodYear: number;
  periodMonth: number;
  totalEmployees: number;
  totalEntries: number;
  functions: string[];
  sampleRows: ScorecardEntryRaw[];
}

/* ─── Service ───────────────────────────────────────────────────────────── */
@Injectable()
export class ScorecardUploadService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /* ── Parse workbook buffer → preview (no DB write) ──────────────────── */
  parsePreview(buffer: Buffer, filename: string): ScorecardPreview {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });

    // Detect the right sheet and header row
    const { sheetName, headerRow, colMap } = this.detectSheet(wb);
    if (!sheetName) throw new BadRequestException('No scorecard sheet found. Expected "Feb SC 26", "Feb 26", "Results", or similar.');

    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    // Detect period from filename or sheet name
    const { name: periodName, year, month } = this.detectPeriod(filename, sheetName);

    const entries = this.parseRows(rows, headerRow, colMap);

    const employees = new Set(entries.map(e => e.employeeNo || e.loginId || e.employeeName));
    const functions = [...new Set(entries.map(e => e.functionName).filter(Boolean))];

    return {
      periodName,
      periodYear: year,
      periodMonth: month,
      totalEmployees: employees.size,
      totalEntries: entries.length,
      functions,
      sampleRows: entries.slice(0, 20),
    };
  }

  /* ── Commit upload to DB ─────────────────────────────────────────────── */
  async commitUpload(
    buffer: Buffer,
    filename: string,
    tenantId: string,
    userId: string,
    overrides?: { periodName?: string; periodYear?: number; periodMonth?: number; notes?: string },
  ): Promise<{ batchId: string; totalEntries: number }> {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const { sheetName, headerRow, colMap } = this.detectSheet(wb);
    if (!sheetName) throw new BadRequestException('No scorecard sheet found.');

    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    const { name: detectedName, year: detectedYear, month: detectedMonth } = this.detectPeriod(filename, sheetName);
    const periodName  = overrides?.periodName  ?? detectedName;
    const periodYear  = overrides?.periodYear  ?? detectedYear;
    const periodMonth = overrides?.periodMonth ?? detectedMonth;

    const entries = this.parseRows(rows, headerRow, colMap);
    if (!entries.length) throw new BadRequestException('No valid scorecard rows found in the file.');

    const employees = new Set(entries.map(e => e.employeeNo || e.loginId));

    return this.ds.transaction(async (mgr) => {
      // Upsert batch (replace if same period already exists)
      const existing = await mgr.query(
        `SELECT id FROM scorecard_batches WHERE tenant_id=$1 AND period_year=$2 AND period_month=$3`,
        [tenantId, periodYear, periodMonth],
      );
      let batchId: string;
      if (existing.length) {
        batchId = existing[0].id;
        // Delete old entries
        await mgr.query(`DELETE FROM scorecard_entries WHERE batch_id=$1`, [batchId]);
        await mgr.query(
          `UPDATE scorecard_batches SET period_name=$2, total_employees=$3, uploaded_by=$4, uploaded_at=NOW(), notes=$5, status='active' WHERE id=$1`,
          [batchId, periodName, employees.size, userId, overrides?.notes ?? null],
        );
      } else {
        const [row] = await mgr.query(
          `INSERT INTO scorecard_batches (tenant_id,period_name,period_year,period_month,total_employees,uploaded_by,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [tenantId, periodName, periodYear, periodMonth, employees.size, userId, overrides?.notes ?? null],
        );
        batchId = row.id;
      }

      // Bulk-insert entries then compute ranks
      for (const e of entries) {
        await mgr.query(
          `INSERT INTO scorecard_entries (
             tenant_id, batch_id, employee_no, employee_name, user_id_login,
             function_name, team_leader, week_label, working_days_pct, net_points,
             quality_actual, quality_score, response_rate, prr_rate, prr_points, prr_bonus,
             aht_actual, aht_score, fcr_actual, fcr_score,
             productivity_actual, productivity_score, ctr_actual, ctr_score,
             quiz_actual, quiz_score, mistakes_actual, mistakes_score,
             incidents_actual, incidents_score, attendance_actual, attendance_score,
             response_time_actual, response_time_score
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
             $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
           )`,
          [
            tenantId, batchId, e.employeeNo, e.employeeName, e.loginId,
            e.functionName, e.teamLeader, e.weekLabel, e.workingDaysPct, e.netPoints,
            e.qualityActual, e.qualityScore, e.responseRate, e.prrRate, e.prrPoints, e.prrBonus,
            e.ahtActual, e.ahtScore, e.fcrActual, e.fcrScore,
            e.productivityActual, e.productivityScore, e.ctrActual, e.ctrScore,
            e.quizActual, e.quizScore, e.mistakesActual, e.mistakesScore,
            e.incidentsActual, e.incidentsScore, e.attendanceActual, e.attendanceScore,
            e.responseTimeActual, e.responseTimeScore,
          ],
        );
      }

      // Rank only employees with net_points > 0; negative/null scores get NULL rank (not eligible for incentives or top performers)
      await mgr.query(
        `UPDATE scorecard_entries se
         SET function_rank = ranked.rn
         FROM (
           SELECT id, ROW_NUMBER() OVER (PARTITION BY function_name ORDER BY net_points DESC NULLS LAST) AS rn
           FROM scorecard_entries WHERE batch_id = $1 AND week_label = 'Final' AND net_points > 0
         ) ranked
         WHERE se.id = ranked.id AND se.batch_id = $1`,
        [batchId],
      );

      return { batchId, totalEntries: entries.length };
    });
  }

  /* ─── Private helpers ────────────────────────────────────────────────── */

  private detectSheet(wb: XLSX.WorkBook): { sheetName: string | null; headerRow: number; colMap: Record<string, number> } {
    // Try each sheet name pattern
    const candidates = [
      { pattern: /SC/i,       headerRow: 12, colMap: COL1 },
      { pattern: /Result/i,   headerRow: 0,  colMap: COL  },
      { pattern: /Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jan/i, headerRow: 0, colMap: COL },
    ];
    for (const { pattern, headerRow, colMap } of candidates) {
      const sheetName = wb.SheetNames.find(n => pattern.test(n));
      if (sheetName) return { sheetName, headerRow, colMap };
    }
    // fallback: first sheet
    if (wb.SheetNames.length) return { sheetName: wb.SheetNames[0], headerRow: 0, colMap: COL };
    return { sheetName: null, headerRow: 0, colMap: COL };
  }

  private detectPeriod(filename: string, sheetName: string): { name: string; year: number; month: number } {
    const MONTHS: Record<string, number> = {
      jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
      jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    };
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    const src = (filename + ' ' + sheetName).toLowerCase();
    let month = 0;
    let year  = new Date().getFullYear();

    for (const [abbr, m] of Object.entries(MONTHS)) {
      if (src.includes(abbr)) { month = m; break; }
    }
    const yearMatch = src.match(/20\d{2}/);
    if (yearMatch) year = parseInt(yearMatch[0], 10);

    if (!month) month = new Date().getMonth() + 1;
    const name = `${MONTH_NAMES[month - 1]} ${year}`;
    return { name, year, month };
  }

  private parseRows(rows: any[][], headerRow: number, colMap: Record<string, number>): ScorecardEntryRaw[] {
    const entries: ScorecardEntryRaw[] = [];

    for (let i = headerRow + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;

      const name    = this.str(r[colMap.name]);
      const empNo   = this.str(r[colMap.empNo]);
      const loginId = this.str(r[colMap.loginId]);
      const fn      = this.str(r[colMap.fn]);
      const weekRaw = r[colMap.week];

      if (!name && !loginId) continue;
      if (weekRaw === null || weekRaw === undefined || weekRaw === '') continue;

      const weekLabel = this.normalizeWeek(weekRaw);
      const netPts    = this.num(r[colMap.netPts]);
      // Skip completely empty rows (no scores, no net points, not Final)
      if (netPts === null && weekLabel !== 'Final') continue;

      const incAct  = 'incAct'  in colMap ? this.int(r[colMap['incAct']]) : null;
      const incScore = 'incScore' in colMap ? this.int(r[colMap['incScore']]) : null;
      const attAct  = 'attAct'  in colMap ? this.num(r[colMap['attAct']]) : null;
      const attScore = 'attScore' in colMap ? this.int(r[colMap['attScore']]) : null;

      entries.push({
        employeeNo:           empNo,
        employeeName:         name,
        loginId,
        functionName:         fn,
        teamLeader:           this.str(r[colMap.tl]),
        weekLabel,
        workingDaysPct:       this.num(r[colMap.wdPct]),
        netPoints:            netPts,
        qualityActual:        this.num(r[colMap.qualityAct]),
        qualityScore:         this.int(r[colMap.qualityScore]),
        responseRate:         this.num(r[colMap.responseRate]),
        prrRate:              this.num(r[colMap.prrRate]),
        prrPoints:            this.int(r[colMap.prrPts]),
        prrBonus:             this.int(r[colMap.prrBonus]) ?? 0,
        ahtActual:            this.num(r[colMap.ahtAct]),
        ahtScore:             this.int(r[colMap.ahtScore]),
        fcrActual:            this.num(r[colMap.fcrAct]),
        fcrScore:             this.int(r[colMap.fcrScore]),
        productivityActual:   this.num(r[colMap.prodAct]),
        productivityScore:    this.int(r[colMap.prodScore]),
        ctrActual:            this.num(r[colMap.ctrAct]),
        ctrScore:             this.int(r[colMap.ctrScore]),
        quizActual:           this.num(r[colMap.quizAct]),
        quizScore:            this.int(r[colMap.quizScore]),
        mistakesActual:       this.int(r[colMap.mistakesAct]),
        mistakesScore:        this.int(r[colMap.mistakesScore]),
        incidentsActual:      incAct,
        incidentsScore:       incScore,
        attendanceActual:     attAct,
        attendanceScore:      attScore,
        responseTimeActual:   this.num(r[colMap.rtAct]),
        responseTimeScore:    this.int(r[colMap.rtScore]),
      });
    }
    return entries;
  }

  private normalizeWeek(raw: any): string {
    if (raw === null || raw === undefined) return '';
    const s = String(raw).trim().toUpperCase();
    if (s === 'FINAL' || s === '5' || s === 'W5') return 'Final';
    if (s === '1' || s === 'W1') return 'W1';
    if (s === '2' || s === 'W2') return 'W2';
    if (s === '3' || s === 'W3') return 'W3';
    if (s === '4' || s === 'W4') return 'W4';
    return s;
  }

  private str(v: any): string {
    if (v === null || v === undefined) return '';
    return String(v).trim();
  }

  private num(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  private int(v: any): number | null {
    const n = this.num(v);
    return n === null ? null : Math.round(n);
  }
}
