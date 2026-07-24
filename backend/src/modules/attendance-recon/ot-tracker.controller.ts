import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { OtTrackerService, OT_RATES, OtTrackerReport } from './ot-tracker.service';
import { OtYearService, OtYearReport } from './ot-year.service';
import { DataSpanService, DataSpanReport } from './data-span.service';

/* MONTHLY OT TRACKER — the online replacement for the per-occasion overtime workbooks.
 * Read-only over roster_days; the export is shaped to be interchangeable with the
 * Director's own tracker (people down, days across, `hours/N|O|H` cells, four
 * multiplier totals on the right) so an exported month opens as the same sheet. */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class OtTrackerController {
  constructor(
    private readonly tracker: OtTrackerService,
    private readonly yearly: OtYearService,
    private readonly span: DataSpanService,
  ) {}

  /** WHERE THE DATA IS — every date-driven screen opens from this, never from a guess. */
  @Get('roster-v2/data-span')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Authoritative data coverage: latest day / week / month + feed freshness' })
  async dataSpan(@Req() req: any): Promise<DataSpanReport> {
    return this.span.build(req.user.tenantId);
  }

  private month(m?: string): string {
    const s = String(m || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new BadRequestException('month must be YYYY-MM');
    return s;
  }

  private parseYear(y?: string): number {
    const n = Number(String(y || '').trim());
    if (!Number.isInteger(n) || n < 2000 || n > 2100) throw new BadRequestException('year must be YYYY');
    return n;
  }

  /** Which months actually carry overtime — drives the page's month picker (no guessing). */
  @Get('roster-v2/ot-tracker/months')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Months that contain overtime, newest first' })
  async months(@Req() req: any) {
    return { months: await this.tracker.months(req.user.tenantId) };
  }

  @Get('roster-v2/ot-tracker')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Monthly overtime tracker — people × days, raw + paid hours' })
  async get(@Req() req: any, @Query('month') month?: string): Promise<OtTrackerReport> {
    return this.tracker.build(req.user.tenantId, this.month(month));
  }

  /** THE WHOLE YEAR IN ONE SHEET — every employee, all 365 days, same cells as the month. */
  @Get('roster-v2/ot-tracker/export-full-year')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Full-year daily overtime grid → .xlsx (one sheet, 365 day columns)' })
  async exportFullYear(@Req() req: any, @Res() res: Response, @Query('year') year?: string) {
    const y = this.parseYear(year);
    const d = await this.tracker.buildYearGrid(req.user.tenantId, y);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'WFM System';
    const colLetter = (i: number) => { let s = ''; let n = i; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

    const ws = wb.addWorksheet(`OT ${y}`);
    const ID_COLS = 3;                                   // name · id · function
    const firstDayCol = ID_COLS + 1;
    const lastDayCol = ID_COLS + d.days.length;
    const C = colLetter(firstDayCol), LAST = colLetter(lastDayCol);

    /* Two header rows: month names banded over their own days, then day numbers.
     * 365 bare numbers with nothing above them is a wall — the band is what makes
     * this readable as a year rather than a spill. */
    const monthRow = ws.addRow([]);
    const dayRow = ws.addRow([]);
    monthRow.getCell(1).value = `OVERTIME ${y}`;
    dayRow.getCell(1).value = 'Agent Name'; dayRow.getCell(2).value = 'ID'; dayRow.getCell(3).value = 'Function';

    const BAND = ['FFF3F4F6', 'FFE8EAF0'];               // alternating month tint
    d.days.forEach((x, i) => {
      const col = firstDayCol + i;
      dayRow.getCell(col).value = x.day;
      dayRow.getCell(col).alignment = { horizontal: 'center' };
      dayRow.getCell(col).font = { size: 8, bold: x.isWeekend };
      dayRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND[x.month % 2] } };
      monthRow.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND[x.month % 2] } };
      ws.getColumn(col).width = 4.2;
    });
    // one merged label per month
    let start = 0;
    for (let i = 1; i <= d.days.length; i++) {
      if (i === d.days.length || d.days[i].month !== d.days[start].month) {
        const a = firstDayCol + start, b = firstDayCol + i - 1;
        if (b > a) ws.mergeCells(1, a, 1, b);
        const cell = monthRow.getCell(a);
        cell.value = d.monthLabels[d.days[start].month - 1];
        cell.alignment = { horizontal: 'center' };
        cell.font = { bold: true, size: 10 };
        start = i;
      }
    }
    ws.getColumn(1).width = 26; ws.getColumn(2).width = 10; ws.getColumn(3).width = 20;

    // totals block, after the days
    const TOTALS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      .map((m) => `${m} hrs`)
      .concat(['Normal HRS', 'Off Day HRS', 'Holiday HRS', 'TOTAL HRS', 'TOTAL PAID HRS', 'OT days']);
    TOTALS.forEach((label, i) => {
      const col = lastDayCol + 1 + i;
      const cell = dayRow.getCell(col);
      cell.value = label;
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: 'center', wrapText: true };
      ws.getColumn(col).width = i < 12 ? 8 : 14;
    });
    monthRow.getCell(lastDayCol + 1).value = 'MONTHLY TOTALS';
    ws.mergeCells(1, lastDayCol + 1, 1, lastDayCol + 12);
    monthRow.getCell(lastDayCol + 1).alignment = { horizontal: 'center' };
    monthRow.getCell(lastDayCol + 1).font = { bold: true };
    monthRow.getCell(lastDayCol + 13).value = 'YEAR TOTALS';
    ws.mergeCells(1, lastDayCol + 13, 1, lastDayCol + 18);
    monthRow.getCell(lastDayCol + 13).alignment = { horizontal: 'center' };
    monthRow.getCell(lastDayCol + 13).font = { bold: true };
    dayRow.font = { bold: true };
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 2 }];

    /* The hidden type mirror again — same reason as the monthly sheet: visible cells
     * are plain hours, so the per-type totals need a place to read N/O/H from, and
     * SUMPRODUCT over it evaluates where the template's array formula did not. */
    const tw = wb.addWorksheet('_types');
    tw.state = 'veryHidden';
    tw.addRow(['type mirror — do not edit']); tw.addRow([]);

    const TINT: Record<string, string> = { N: 'FFFFF6D8', O: 'FFDDEEFF', H: 'FFFFE0E0' };
    const FONT: Record<string, string> = { N: 'FF8A6D00', O: 'FF14539A', H: 'FFA31515' };
    const dateCol = new Map(d.days.map((x, i) => [x.date, firstDayCol + i]));

    d.people.forEach((p) => {
      const row = ws.addRow([]);
      const r = row.number;
      row.getCell(1).value = p.name; row.getCell(2).value = p.personNo; row.getCell(3).value = p.functionName || '';
      const typeRow = tw.getRow(r);
      for (const [date, c] of Object.entries(p.cells)) {
        const col = dateCol.get(date); if (!col) continue;
        const cell = row.getCell(col);
        cell.value = c.hours;
        cell.numFmt = '0.##';
        cell.alignment = { horizontal: 'center' };
        cell.font = { color: { argb: FONT[c.type] }, bold: true, size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT[c.type] } };
        cell.note = [`${date} · ${c.type === 'H' ? 'Public holiday OT' : c.type === 'O' ? 'Off-day OT' : 'Normal-day OT'}`,
          c.pendingHours ? `${c.pendingHours}h awaiting review — not counted` : '',
          c.flag ? `Engine flag: ${c.flag}` : ''].filter(Boolean).join('\n');
        typeRow.getCell(col).value = c.type;
      }
      typeRow.commit?.();

      // monthly totals — live SUM over that month's own day columns
      let s = 0;
      for (let m = 0; m < 12; m++) {
        const idx = d.days.findIndex((x) => x.month === m + 1);
        const end = d.days.length - 1 - [...d.days].reverse().findIndex((x) => x.month === m + 1);
        const cell = row.getCell(lastDayCol + 1 + m);
        if (idx >= 0) {
          const a = colLetter(firstDayCol + idx), b = colLetter(firstDayCol + end);
          cell.value = { formula: `SUM(${a}${r}:${b}${r})`, result: p.monthHours[m] } as any;
        } else cell.value = 0;
        cell.numFmt = '0.##';
        s += p.monthHours[m];
      }
      // year totals per type, then the two headline numbers
      const f = (t: string) => `SUMPRODUCT((_types!${C}${r}:${LAST}${r}="${t}")*(${C}${r}:${LAST}${r}))`;
      row.getCell(lastDayCol + 13).value = { formula: f('N'), result: p.rawNormal } as any;
      row.getCell(lastDayCol + 14).value = { formula: f('O'), result: p.rawOffday } as any;
      row.getCell(lastDayCol + 15).value = { formula: f('H'), result: p.rawHoliday } as any;
      const L = (i: number) => colLetter(lastDayCol + i);
      row.getCell(lastDayCol + 16).value = { formula: `${L(13)}${r}+${L(14)}${r}+${L(15)}${r}`, result: p.rawTotal } as any;
      row.getCell(lastDayCol + 17).value = {
        formula: `${L(13)}${r}*${OT_RATES.normal}+${L(14)}${r}*${OT_RATES.offday}+${L(15)}${r}*${OT_RATES.holiday}`,
        result: p.paidTotal,
      } as any;
      row.getCell(lastDayCol + 18).value = p.days;
      for (let i = 13; i <= 17; i++) row.getCell(lastDayCol + i).numFmt = '0.##';
      row.getCell(lastDayCol + 16).font = { bold: true };
      row.getCell(lastDayCol + 17).font = { bold: true };
      void s;
    });

    // grand total row
    if (d.people.length) {
      const t = ws.addRow([]);
      t.getCell(1).value = 'TOTAL'; t.getCell(2).value = `${d.totals.people} people`;
      t.font = { bold: true };
      const first = 3, last = 2 + d.people.length;
      for (let i = 1; i <= 18; i++) {
        const L = colLetter(lastDayCol + i);
        const cell = t.getCell(lastDayCol + i);
        const known = i <= 12 ? d.totals.monthHours[i - 1]
          : i === 13 ? d.totals.rawNormal : i === 14 ? d.totals.rawOffday : i === 15 ? d.totals.rawHoliday
          : i === 16 ? d.totals.rawTotal : i === 17 ? d.totals.paidTotal : d.totals.days;
        cell.value = { formula: `SUM(${L}${first}:${L}${last})`, result: known } as any;
        cell.numFmt = '0.##';
      }
    }

    /* Legend + the honest footnotes. */
    ws.addRow([]);
    const lg = ws.addRow([]); lg.getCell(1).value = 'LEGEND'; lg.font = { bold: true };
    ([['Normal-day OT', 'N', OT_RATES.normal], ['Off-day OT', 'O', OT_RATES.offday], ['Public-holiday OT', 'H', OT_RATES.holiday]] as [string, string, number][])
      .forEach(([label, t, rate]) => {
        const row = ws.addRow([]);
        row.getCell(1).value = label;
        const c = row.getCell(2);
        c.value = `×${rate}`;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT[t] } };
        c.font = { color: { argb: FONT[t] }, bold: true };
        c.alignment = { horizontal: 'center' };
      });
    [`Cells are hours only, rounded to the nearest ${d.rounding.stepHours} h; the colour is the type. Totals are summed from the rounded days, so the sheet reconciles with its own cells.`,
     `Hourly pay base: monthly salary ÷ ${d.base.workDaysPerMonth} days ÷ ${d.base.hoursPerDay} hours.`,
     d.totals.pendingHours ? `${d.totals.pendingHours} h of before/after-shift overtime is still awaiting review and is NOT included.` : '',
     d.totals.roundedOutDays ? `${d.totals.roundedOutDays} day(s) (${d.totals.roundedOutHours} h) fell under the rounding step and carry no cell.` : '',
     d.provenance].filter(Boolean).forEach((text) => {
      const row = ws.addRow([]); row.getCell(1).value = text; row.font = { italic: true, size: 9 };
    });

    /* Sheet 2 — one row per OT day, for anyone who wants to pivot it. */
    const raw = wb.addWorksheet('Days');
    raw.columns = [
      { header: 'ID', key: 'id', width: 10 }, { header: 'Agent Name', key: 'name', width: 26 },
      { header: 'Function', key: 'fn', width: 20 }, { header: 'Date', key: 'date', width: 12 },
      { header: 'Month', key: 'month', width: 10 }, { header: 'Type', key: 'type', width: 7 },
      { header: 'Hours', key: 'hours', width: 9 }, { header: 'Rate', key: 'rate', width: 8 },
      { header: 'Paid hours', key: 'paid', width: 11 },
      { header: 'Pending (not paid)', key: 'pend', width: 17 }, { header: 'Engine flag', key: 'flag', width: 28 },
    ];
    const rateOf = { N: OT_RATES.normal, O: OT_RATES.offday, H: OT_RATES.holiday } as const;
    d.people.forEach((p) => Object.entries(p.cells).forEach(([date, c]) => raw.addRow({
      id: p.personNo, name: p.name, fn: p.functionName || '', date, month: date.slice(0, 7), type: c.type,
      hours: c.hours, rate: rateOf[c.type], paid: Math.round(c.hours * rateOf[c.type] * 100) / 100,
      pend: c.pendingHours || '', flag: c.flag || '',
    })));
    raw.getRow(1).font = { bold: true };
    raw.views = [{ state: 'frozen', ySplit: 1 }];

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Overtime_${y}_Full_Year.xlsx"`,
    });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  /* ══════════════════════════════════════════════════════════════════════════
   *  YEAR-TO-DATE over the Director's OWN overtime workbooks (ot_source_rows).
   *  A different question from the month tracker above: that one asks "what did
   *  the engine measure?", this one asks "what do my approved sheets add up to,
   *  per person, since January?" — with the overlap between those sheets removed.
   *  ══════════════════════════════════════════════════════════════════════════ */
  @Get('roster-v2/ot-year/years')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Years present in the ingested overtime workbooks' })
  async years(@Req() req: any) {
    return { years: await this.yearly.years(req.user.tenantId) };
  }

  @Get('roster-v2/ot-year')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Year-to-date overtime per employee from the source workbooks (months + days)' })
  async year(@Req() req: any, @Query('year') year?: string): Promise<OtYearReport> {
    return this.yearly.build(req.user.tenantId, this.parseYear(year));
  }

  /** → .xlsx: Year grid · every day · conflicts · sources · summary. */
  @Get('roster-v2/ot-year/export')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Year-to-date overtime → .xlsx' })
  async yearExport(@Req() req: any, @Res() res: Response, @Query('year') year?: string) {
    const y = this.parseYear(year);
    const d = await this.yearly.build(req.user.tenantId, y);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'WFM System';
    const bold = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };

    /* Sheet 1 — the year grid: one row per employee, twelve months across. */
    const ws = wb.addWorksheet(`OT ${y}`);
    ws.columns = [
      { header: 'Agent Name', key: 'name', width: 26 }, { header: 'ID', key: 'id', width: 10 },
      { header: 'Function', key: 'fn', width: 20 },
      ...d.monthLabels.map((m, i) => ({ header: m.slice(0, 3), key: `m${i}`, width: 9 })),
      { header: 'Undated', key: 'und', width: 10 },
      { header: 'TOTAL HRS', key: 'tot', width: 12 },
      { header: 'OT days', key: 'days', width: 9 },
      { header: 'Engine hrs (compare)', key: 'eng', width: 19 },
    ];
    d.people.forEach((p) => {
      const row: any = { name: p.name, id: p.personNo, fn: p.functionName || '', und: p.undatedTotal || '', tot: p.total, days: p.daysCount, eng: p.engineHours };
      p.months.forEach((h, i) => { row[`m${i}`] = h || ''; });
      const r = ws.addRow(row);
      r.getCell('tot').font = { bold: true };
      for (let i = 4; i <= 3 + 12 + 4; i++) r.getCell(i).numFmt = '0.00';
    });
    if (d.people.length) {
      const t: any = { name: 'TOTAL', id: `${d.totals.people} people`, und: d.totals.undated, tot: d.totals.total, days: d.totals.daysCount, eng: d.totals.engineHours };
      d.totals.months.forEach((h, i) => { t[`m${i}`] = h || ''; });
      const tr = ws.addRow(t); tr.font = { bold: true };
    }
    bold(ws);
    ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

    /* Sheet 2 — every day behind those totals. */
    const days = wb.addWorksheet('Days');
    days.columns = [
      { header: 'ID', key: 'id', width: 10 }, { header: 'Agent Name', key: 'name', width: 26 },
      { header: 'Function', key: 'fn', width: 20 }, { header: 'Date', key: 'date', width: 12 },
      { header: 'Month', key: 'month', width: 10 }, { header: 'Hours', key: 'hours', width: 9 },
      { header: 'Shift', key: 'shift', width: 9 }, { header: 'Occasion', key: 'occ', width: 34 },
      { header: 'Sheets disagreed?', key: 'cf', width: 17 },
    ];
    d.people.forEach((p) => p.days.forEach((c) => days.addRow({
      id: p.personNo, name: p.name, fn: p.functionName || '', date: c.date, month: c.date.slice(0, 7),
      hours: c.hours, shift: c.shiftCode || '', occ: c.occasion, cf: c.conflict ? 'YES — see Conflicts' : '',
    })));
    bold(days);

    /* Sheet 3 — the days the workbooks contradict each other on. */
    const cf = wb.addWorksheet('Conflicts');
    cf.columns = [
      { header: 'ID', key: 'id', width: 10 }, { header: 'Agent Name', key: 'name', width: 26 },
      { header: 'Date', key: 'date', width: 18 }, { header: 'Shown (largest)', key: 'chosen', width: 15 },
      { header: 'Candidate hours', key: 'h', width: 15 }, { header: 'From sheet', key: 'sheet', width: 26 },
      { header: 'From file', key: 'file', width: 52 },
    ];
    d.conflicts.forEach((c) => c.candidates.forEach((k, i) => cf.addRow({
      id: i === 0 ? c.personNo : '', name: i === 0 ? c.name : '', date: i === 0 ? c.date : '',
      chosen: i === 0 ? c.chosen : '', h: k.hours, sheet: k.sheet, file: k.file,
    })));
    bold(cf);

    /* Sheet 4 — which workbook contributed what. */
    const src = wb.addWorksheet('Sources');
    src.columns = [
      { header: 'Occasion', key: 'occ', width: 40 }, { header: 'File', key: 'file', width: 56 },
      { header: 'Rows', key: 'rows', width: 8 }, { header: 'People', key: 'people', width: 9 },
      { header: 'Hours as stacked', key: 'h', width: 17 }, { header: 'Undated rows', key: 'und', width: 13 },
      { header: 'Flagged rows', key: 'fl', width: 13 },
    ];
    d.sources.forEach((s) => src.addRow({ occ: s.occasion, file: s.file, rows: s.rows, people: s.people, h: s.stackedHours, und: s.undated, fl: s.flagged }));
    bold(src);

    /* Sheet 5 — the summary, including the double-count this page removes. */
    const sum = wb.addWorksheet('Summary');
    sum.columns = [{ header: 'Metric', key: 'm', width: 52 }, { header: 'Value', key: 'v', width: 60 }];
    ([
      ['Year', y], ['Employees with overtime', d.totals.people],
      ['TOTAL hours (what each person adds up to)', d.totals.total],
      ['  · placed on a specific day', d.totals.dated],
      ['  · month-level only (source gave no date)', d.totals.undated],
      ['Person-days counted', d.dedup.personDays],
      ['— WHY THIS IS NOT JUST THE SHEETS ADDED UP —', ''],
      ['Hours if every sheet row were stacked', d.dedup.stacked],
      ['Hours after one value per person-day', d.dedup.deduped],
      ['DOUBLE COUNT AVOIDED', d.dedup.avoided],
      ['Repeated person-days where sheets AGREE', d.dedup.agreed],
      ['Repeated person-days where sheets DISAGREE (see Conflicts)', d.dedup.disagreed],
      ['— COMPARISON —', ''],
      ['Engine-measured hours over the same year', d.totals.engineHours],
      ['Note', 'The engine detects; your sheets approve. They are not expected to match.'],
      ['— PROVENANCE —', ''],
      ['Workbooks ingested', d.sources.length],
      ['Last ingest', d.ingestedAt || '—'],
      ...(d.derivedDates || []).map((x) => [
        `Date resolved from evidence — ${x.occasion}`,
        `${x.date} · ${x.rows} rows · ${x.hours} h — ${x.why}`,
      ] as [string, any]),
      ['Source', d.provenance],
    ] as [string, any][]).forEach(([m, v]) => sum.addRow({ m, v }));
    bold(sum);
    sum.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Overtime_${y}_Year_Tracker.xlsx"`,
    });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  /** → .xlsx in the Director's own tracker layout (+ a Raw sheet and a Summary sheet). */
  @Get('roster-v2/ot-tracker/export')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Monthly overtime tracker → .xlsx (template layout)' })
  async export(@Req() req: any, @Res() res: Response, @Query('month') month?: string) {
    const m = this.month(month);
    const d = await this.tracker.build(req.user.tenantId, m);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'WFM System';

    /* ── Sheet 1: the tracker itself, cell-for-cell like the workbook he already uses.
     *  Columns: A Agent Name · B ID · C..(2+days) one per day · then the four totals.  */
    const ws = wb.addWorksheet(d.monthLabel.split(' ')[0].slice(0, 3));
    const colLetter = (i: number) => {  // 1 → A
      let s = ''; let n = i;
      while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
      return s;
    };
    const firstDayCol = 3;
    const lastDayCol = 2 + d.daysInMonth;
    const C = colLetter(firstDayCol), AG = colLetter(lastDayCol);

    ws.columns = [
      { key: 'name', width: 26 },
      { key: 'id', width: 10 },
      ...d.days.map((x) => ({ key: `d${x.day}`, width: 6 })),
      { key: 'tN', width: 20 }, { key: 'tO', width: 18 }, { key: 'tH', width: 18 }, { key: 'tP', width: 16 },
      { key: 'yH', width: 20 }, { key: 'yP', width: 22 },
    ];

    const header = ws.addRow([
      'Agent Name', 'ID', ...d.days.map((x) => x.day),
      'Total Normal Days HRS', 'Total Off Day HRS', 'Total Holiday HRS', 'Total Paid HRS',
      `YTD Hours (from ${d.ytdFrom})`, 'YTD Paid HRS (from 1 Jan)',
    ]);
    header.font = { bold: true };
    header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

    // Weekend day columns get a light tint so the OFF/holiday cells read at a glance.
    d.days.forEach((x, i) => {
      if (!x.isWeekend) return;
      header.getCell(firstDayCol + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    });

    /* A hidden mirror of the grid holding each day's TYPE letter. The visible cells are
     * now plain numbers (Director 2026-07-24: "بدي ساعات ما بدي أحرف"), so the per-type
     * totals need somewhere to read the type from. SUMPRODUCT over this mirror is a
     * normal formula — unlike the array formula the template used, which Excel evaluated
     * by implicit intersection when written programmatically and returned 0.00 for every
     * row. The sheet stays live: edit an hours cell and the totals still move. */
    const tw = wb.addWorksheet('_types');
    tw.state = 'veryHidden';
    tw.addRow(['type mirror — do not edit; drives the total columns on the tracker sheet']);

    const TINT: Record<string, string> = { N: 'FFFFF6D8', O: 'FFDDEEFF', H: 'FFFFE0E0' };
    const FONT: Record<string, string> = { N: 'FF8A6D00', O: 'FF14539A', H: 'FFA31515' };
    d.people.forEach((p) => {
      const row = ws.addRow({ name: p.name, id: p.personNo });
      const r = row.number;
      const typeRow = tw.getRow(r);
      for (const c of p.cells) {
        const cell = row.getCell(2 + c.day);
        cell.value = c.hours;                                     // hours only — the colour carries the type
        cell.numFmt = '0.##';
        cell.alignment = { horizontal: 'center' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT[c.type] } };
        cell.font = { color: { argb: FONT[c.type] }, bold: true };
        const tip = [
          c.type === 'H' ? 'Public holiday OT' : c.type === 'O' ? 'Off-day OT' : 'Normal-day OT',
          c.pendingHours ? `${c.pendingHours}h still awaiting review — not counted` : '',
          c.flag ? `Engine flag: ${c.flag}` : '',
        ].filter(Boolean).join('\n');
        cell.note = tip;
        typeRow.getCell(2 + c.day).value = c.type;
        if (c.pendingHours) cell.border = { top: { style: 'dashed', color: { argb: 'FFEF4444' } }, bottom: { style: 'dashed', color: { argb: 'FFEF4444' } }, left: { style: 'dashed', color: { argb: 'FFEF4444' } }, right: { style: 'dashed', color: { argb: 'FFEF4444' } } };
      }
      typeRow.commit?.();

      /* Live per-type totals that actually evaluate. */
      const f = (t: string, rate: number) =>
        `SUMPRODUCT((_types!${C}${r}:${AG}${r}="${t}")*(${C}${r}:${AG}${r}))*${rate}`;
      row.getCell(lastDayCol + 1).value = { formula: f('N', OT_RATES.normal), result: p.paidNormal } as any;
      row.getCell(lastDayCol + 2).value = { formula: f('O', OT_RATES.offday), result: p.paidOffday } as any;
      row.getCell(lastDayCol + 3).value = { formula: f('H', OT_RATES.holiday), result: p.paidHoliday } as any;
      const L = (i: number) => colLetter(lastDayCol + i);
      row.getCell(lastDayCol + 4).value = { formula: `${L(1)}${r}+${L(2)}${r}+${L(3)}${r}`, result: p.paidTotal } as any;
      // YTD is a value, not a formula — this sheet holds one month, the year lives outside it.
      row.getCell(lastDayCol + 5).value = p.ytdHours;
      row.getCell(lastDayCol + 6).value = p.ytdPaid;
      for (let i = 1; i <= 6; i++) row.getCell(lastDayCol + i).numFmt = '0.##';
      row.getCell(lastDayCol + 4).font = { bold: true };
      row.getCell(lastDayCol + 6).font = { bold: true };
    });

    // Grand total row — the number the payroll conversation actually starts from.
    if (d.people.length) {
      const t = ws.addRow({ name: 'TOTAL', id: `${d.totals.people} people` });
      t.font = { bold: true };
      const firstRow = 2, lastRow = 1 + d.people.length;
      [d.totals.paidNormal, d.totals.paidOffday, d.totals.paidHoliday, d.totals.paidTotal,
       d.totals.ytdHours, d.totals.ytdPaid].forEach((v, i) => {
        const L = colLetter(lastDayCol + 1 + i);
        const c = t.getCell(lastDayCol + 1 + i);
        c.value = { formula: `SUM(${L}${firstRow}:${L}${lastRow})`, result: v } as any;
        c.numFmt = '0.##';
      });
      // Day columns get a per-day total too, so a column can be checked at a glance.
      for (let i = 0; i < d.daysInMonth; i++) {
        const L = colLetter(firstDayCol + i);
        const dayTot = d.people.reduce((a, p) => a + (p.cells.find((c) => c.day === i + 1)?.hours || 0), 0);
        if (dayTot <= 0) continue;
        const c = t.getCell(firstDayCol + i);
        c.value = { formula: `SUM(${L}${firstRow}:${L}${lastRow})`, result: Math.round(dayTot * 100) / 100 } as any;
        c.numFmt = '0.##';
      }
    }

    /* A legend, because the colour is now the only thing carrying the type. */
    ws.addRow([]);
    const lg = ws.addRow(['LEGEND']);
    lg.font = { bold: true };
    ([['Normal-day OT', 'N'], ['Off-day OT', 'O'], ['Public-holiday OT', 'H']] as [string, string][])
      .forEach(([label, t]) => {
        const r = ws.addRow([label]);
        const c = r.getCell(2);
        c.value = `×${t === 'N' ? OT_RATES.normal : t === 'O' ? OT_RATES.offday : OT_RATES.holiday}`;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT[t] } };
        c.font = { color: { argb: FONT[t] }, bold: true };
        c.alignment = { horizontal: 'center' };
      });
    const note = ws.addRow([`Cells are hours only, rounded to the nearest ${d.rounding.stepHours} h; the colour is the type. A dashed red cell has hours still awaiting review that are NOT counted.`]);
    note.font = { italic: true, size: 9 };

    /* ── Sheet 2: Raw — one row per person-day, the audit trail behind every cell. */
    const raw = wb.addWorksheet('Raw');
    raw.columns = [
      { header: 'Person No', key: 'id', width: 12 }, { header: 'Agent Name', key: 'name', width: 26 },
      { header: 'Function', key: 'fn', width: 20 }, { header: 'Date', key: 'date', width: 12 },
      { header: 'Day', key: 'day', width: 6 }, { header: 'Type', key: 'type', width: 7 },
      { header: 'Detected hrs', key: 'detected', width: 13 }, { header: 'Review ack hrs', key: 'ack', width: 14 },
      { header: 'Payable hrs', key: 'hours', width: 12 }, { header: 'Rate', key: 'rate', width: 8 },
      { header: 'Money hrs', key: 'paid', width: 11 },
      { header: 'Pending (not paid)', key: 'pending', width: 17 }, { header: 'Engine flag', key: 'flag', width: 28 },
    ];
    const rateOf = { N: OT_RATES.normal, O: OT_RATES.offday, H: OT_RATES.holiday } as const;
    d.people.forEach((p) => p.cells.forEach((c) => raw.addRow({
      id: p.personNo, name: p.name, fn: p.functionName || '', day: c.day,
      date: `${d.month}-${String(c.day).padStart(2, '0')}`, type: c.type,
      detected: c.detected, ack: c.reviewHours, hours: c.hours, rate: rateOf[c.type],
      paid: Math.round(c.hours * rateOf[c.type] * 100) / 100,
      pending: c.pendingHours || '', flag: c.flag || '',
    })));
    raw.getRow(1).font = { bold: true };
    raw.views = [{ state: 'frozen', ySplit: 1 }];

    /* ── Sheet 3: Summary — totals, the rates in force, and where the numbers came from. */
    const sum = wb.addWorksheet('Summary');
    sum.columns = [{ header: 'Metric', key: 'm', width: 46 }, { header: 'Value', key: 'v', width: 46 }];
    ([
      ['Month', d.monthLabel], ['People with overtime', d.totals.people],
      ['— PAYABLE HOURS (buckets + acknowledged review) —', ''],
      ['Normal-day OT (hrs)', d.totals.rawNormal], ['Off-day OT (hrs)', d.totals.rawOffday],
      ['Public-holiday OT (hrs)', d.totals.rawHoliday], ['Total payable OT (hrs)', d.totals.rawTotal],
      ['— HOW PAYABLE WAS REACHED —', ''],
      ['Detected by the engine (hrs)', d.totals.detectedTotal],
      ['Released by review — acknowledged (hrs)', d.totals.reviewHours],
      ['Held by review — pending, NOT paid (hrs)', d.totals.pendingHours],
      ['Person-days waiting on review', d.totals.pendingDays],
      ['— MONEY HOURS (payable × rate) —', ''],
      [`Normal ×${OT_RATES.normal}`, d.totals.paidNormal], [`Off-day ×${OT_RATES.offday}`, d.totals.paidOffday],
      [`Holiday ×${OT_RATES.holiday}`, d.totals.paidHoliday], ['TOTAL PAID HRS', d.totals.paidTotal],
      ['— PAY BASE —', ''],
      ['Hourly base', `monthly salary ÷ ${d.base.workDaysPerMonth} days ÷ ${d.base.hoursPerDay} hours`],
      ['— YEAR TO DATE —', ''],
      [`Hours from ${d.ytdFrom} to the end of this month`, d.totals.ytdHours],
      ['Hours after rate, year to date', d.totals.ytdPaid],
      ['OT days year to date', d.totals.ytdDays],
      ['— ROUNDING —', ''],
      ['Each day rounded to the nearest', `${d.rounding.stepHours} h (${d.rounding.mode})`],
      ['Measured before rounding (hrs)', d.totals.detectedTotal],
      ['Days too short to survive rounding', `${d.totals.roundedOutDays} (${d.totals.roundedOutHours} h)`],
      ['— REVIEW —', ''],
      ['Person-days carrying an engine flag', d.totals.flaggedDays],
      ['Source', d.provenance],
    ] as [string, any][]).forEach(([m, v]) => sum.addRow({ m, v }));
    sum.getRow(1).font = { bold: true };
    sum.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Monthly_Overtime_Tracker_${d.monthLabel.replace(/\s+/g, '_')}.xlsx"`,
    });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }
}
