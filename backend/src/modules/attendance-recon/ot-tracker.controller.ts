import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { OtTrackerService, OT_RATES, OtTrackerReport } from './ot-tracker.service';

/* MONTHLY OT TRACKER — the online replacement for the per-occasion overtime workbooks.
 * Read-only over roster_days; the export is shaped to be interchangeable with the
 * Director's own tracker (people down, days across, `hours/N|O|H` cells, four
 * multiplier totals on the right) so an exported month opens as the same sheet. */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class OtTrackerController {
  constructor(private readonly tracker: OtTrackerService) {}

  private month(m?: string): string {
    const s = String(m || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new BadRequestException('month must be YYYY-MM');
    return s;
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
      ...d.days.map((x) => ({ key: `d${x.day}`, width: 7 })),
      { key: 'tN', width: 20 }, { key: 'tO', width: 18 }, { key: 'tH', width: 18 }, { key: 'tP', width: 16 },
    ];

    const header = ws.addRow([
      'Agent Name', 'ID', ...d.days.map((x) => x.day),
      'Total Normal Days HRS', 'Total Off Day HRS', 'Total Holiday HRS', 'Total Paid HRS',
    ]);
    header.font = { bold: true };
    header.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

    // Weekend day columns get a light tint so the OFF/holiday cells read at a glance.
    d.days.forEach((x, i) => {
      if (!x.isWeekend) return;
      ws.getColumn(firstDayCol + i).eachCell?.({ includeEmpty: true }, () => undefined);
      header.getCell(firstDayCol + i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
    });

    const TINT: Record<string, string> = { N: 'FFFFF6D8', O: 'FFDDEEFF', H: 'FFFFE0E0' };
    d.people.forEach((p) => {
      const row = ws.addRow({ name: p.name, id: p.personNo });
      const r = row.number;
      for (const c of p.cells) {
        const cell = row.getCell(2 + c.day);
        cell.value = `${c.hours}/${c.type}`;          // the template's own cell grammar
        cell.alignment = { horizontal: 'center' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINT[c.type] } };
        if (c.flag) cell.note = `Engine flag: ${c.flag}`;   // never hidden, never silently dropped
      }
      /* The four totals carry HIS formulas verbatim (so the sheet stays live and editable)
       * AND our computed result, so the numbers are right the moment it opens. */
      const f = (suffix: string, rate: number) =>
        `SUM(IFERROR(VALUE(LEFT(${C}${r}:${AG}${r},SEARCH("/${suffix}",${C}${r}:${AG}${r})-1)),0))*${rate}`;
      row.getCell(lastDayCol + 1).value = { formula: f('N', OT_RATES.normal), result: p.paidNormal } as any;
      row.getCell(lastDayCol + 2).value = { formula: f('O', OT_RATES.offday), result: p.paidOffday } as any;
      row.getCell(lastDayCol + 3).value = { formula: f('H', OT_RATES.holiday), result: p.paidHoliday } as any;
      const tp = `${colLetter(lastDayCol + 1)}${r}+${colLetter(lastDayCol + 2)}${r}+${colLetter(lastDayCol + 3)}${r}`;
      row.getCell(lastDayCol + 4).value = { formula: `SUM(${tp})`, result: p.paidTotal } as any;
      for (let i = 1; i <= 4; i++) row.getCell(lastDayCol + i).numFmt = '0.00';
      row.getCell(lastDayCol + 4).font = { bold: true };
    });

    // Grand total row — the number the payroll conversation actually starts from.
    if (d.people.length) {
      const t = ws.addRow({ name: 'TOTAL', id: `${d.totals.people} people` });
      t.font = { bold: true };
      const firstRow = 2, lastRow = 1 + d.people.length;
      const totals = [d.totals.paidNormal, d.totals.paidOffday, d.totals.paidHoliday, d.totals.paidTotal];
      totals.forEach((v, i) => {
        const L = colLetter(lastDayCol + 1 + i);
        const c = t.getCell(lastDayCol + 1 + i);
        c.value = { formula: `SUM(${L}${firstRow}:${L}${lastRow})`, result: v } as any;
        c.numFmt = '0.00';
      });
    }

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
