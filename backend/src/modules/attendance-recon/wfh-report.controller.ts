import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

/* WFH HR action report (JSON + Excel), split VERBATIM out of the monolithic
 * ReconController (2026-07-07, EXECUTION_BRIEF Phase-4). Same route prefix —
 * zero route renames. */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class WfhReportController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}
  /* ══════════════════════════════════════════════════════════════════════════
   *  WFH HR ACTION REPORT  (weekly HR ask: who worked from home late/short)
   *  WFH = scheduled shift + system login/logout (Ameyo/Sprinklr) + NO Odoo
   *  fingerprint + reasonable shift match. Send to HR ONLY a WFH agent who was
   *  late-in OR early-out, with no approved permission/COMP/OT, who did NOT cover
   *  the full scheduled shift span, shortage ≥ 5 min, and is not an excluded role.
   *  CONSERVATIVE: weak/ambiguous evidence → audit / data-quality, NEVER HR.
   *  Locked decision: "completed" = consolidated system span (earliest login →
   *  latest logout, cross-midnight aligned) ≥ scheduled GROSS shift duration.
   *  16 Jun 2026 = Hijri-New-Year public holiday → holiday work, no lateness action.
   *  Note: roster_days stores minutes → HH:MM:SS shows :00 seconds; raw-file run
   *  can preserve seconds. Permission/COMP read from the DB — validate vs the
   *  authoritative Odoo files before final HR submission. ══════════════════════ */
  private readonly WFH_EXCLUDE_RE = /team ?lead|leader|senior|\brta\b|customer\s*care|resolution|specialist|support/i;
  private readonly WFH_MOTHERS = ['haya', 'shaima', 'shaimaa'];
  private wfhHms(min: number | null): string {
    if (min == null || Number.isNaN(min)) return '';
    const neg = min < 0; const m = Math.abs(Math.round(min));
    return `${neg ? '-' : ''}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  }
  private wfhClk(min: number | null): string {
    if (min == null || Number.isNaN(min)) return '';
    const m = (((Math.round(min) % 1440) + 1440) % 1440);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  private async buildWfhReport(t: string, from: string, to: string, includeExcluded: boolean) {
    const rows = await this.ds.query(
      `SELECT work_date::text date, day_name, person_no, employee_no, clean_name,
              role_function, role_category, team_manager, shift_code, shift_start_min, shift_end_min,
              sys_login_min, sys_logout_min, login_src, presence, permission_type, permission_duration,
              comp_off, comp_worked_min, ot_min, ot_before_min, ot_after_min, offday_ot_min, holiday_ot_min, include_tardiness,
              data_quality
         FROM roster_days
        WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3
          AND punch_in_min IS NULL AND sys_login_min IS NOT NULL
          AND shift_start_min IS NOT NULL AND shift_end_min IS NOT NULL
        ORDER BY work_date, clean_name`, [t, from, to]);

    const alignTo = (v: number, ref: number) => { let x = v; while (x < ref - 720) x += 1440; while (x > ref + 720) x -= 1440; return x; };
    // official holidays come from the editable `holidays` table (synced from recon-config.json) — NOT a single
    // hardcoded date, so WFH work on Arafat/Eid/National-Day etc. is correctly treated as holiday work, never HR.
    const holSet = new Set((await this.ds.query(`SELECT holiday_date::text d FROM holidays WHERE tenant_id=$1`, [t]).catch(() => [])).map((x: any) => x.d));
    const out: any[] = [];
    for (const r of rows) {
      // wrap-correct cross-midnight ends (legacy raw rows store end<start) so gross isn't negative
      // and the cross-midnight fairness guard (crossMid) isn't bypassed for MD/E overnight shifts.
      const start = Number(r.shift_start_min); let end = Number(r.shift_end_min); if (end <= start) end += 1440;
      const code = (r.shift_code || '').toString();
      const nameLc = (r.clean_name || '').toLowerCase();
      const mother = /7$/.test(code.toLowerCase()) || this.WFH_MOTHERS.some(m => nameLc.includes(m));
      // mothers work a 7h shift even if the roster code reads a 9h one → measure
      // against a 7h window (6h net) so they aren't wrongly flagged for the last 2h.
      const gross = mother ? Math.min(end - start, 420) : end - start;
      const effEnd = start + gross;
      const breakMin = 60;
      const requiredNet = Math.max(0, gross - breakMin);
      /* `include_tardiness` is false for TWO different reasons and they must not share a
         label. A supervisory ROLE is a valid exclusion. A day the engine could not
         measure (2026-07-29 evidence arbitration — under 25% of the shift seen, or a
         full shift displaced from its window) is a DATA problem, and telling HR it was
         an "Excluded role" would misdescribe 17 July agents as supervisors. Weak
         evidence goes where this report has always sent it: data quality, never HR. */
      const excludedRole = this.WFH_EXCLUDE_RE.test(`${r.role_category || ''} ${r.role_function || ''}`);
      const unmeasured = !r.include_tardiness && !excludedRole ? (r.data_quality || 'Day not scored — evidence insufficient') : null;
      const holiday = holSet.has(r.date);
      // any presence other than a clean 'wfh' (sick/absent/leave/off/holiday/office…) +
      // no fingerprint is an internal contradiction → route to Data Quality, never HR.
      const onLeave = r.presence != null && r.presence !== 'wfh';
      const hasPerm = r.permission_type != null;
      const hasComp = r.comp_off != null || Number(r.comp_worked_min || 0) > 0;
      const hasOT = Number(r.ot_min || 0) > 0 || Number(r.ot_before_min || 0) > 0 || Number(r.ot_after_min || 0) > 0
        || Number(r.offday_ot_min || 0) > 0 || Number(r.holiday_ot_min || 0) > 0;

      const login = alignTo(Number(r.sys_login_min), start);
      const logout = r.sys_logout_min == null ? null : alignTo(Number(r.sys_logout_min), effEnd);
      let dq: string | null = null;
      if (logout == null) dq = 'Missing system logout';
      else if (logout <= login) dq = 'Incoherent session (logout ≤ login after midnight alignment)';
      else if (logout - login > gross + 720) dq = 'Implausible system span';

      const span = (logout != null && !dq) ? logout - login : null;
      const lateLogin = !dq ? Math.max(0, login - start) : null;
      const earlyLogout = (logout != null && !dq) ? Math.max(0, effEnd - logout) : null;
      const shortage = span != null ? Math.max(0, gross - span) : null;
      const completed = span != null ? span >= gross : false;
      // FAIRNESS GUARD: a genuine WFH lateness is minutes to ~2h. A >3h late-in /
      // early-out, or a tiny (<60min) session, is almost always a split or missing
      // overnight session in the daily roster (esp. cross-midnight MD/MN) — never
      // flag HR on that; send to data-quality to validate against the raw files.
      const crossMid = effEnd > 1440;
      if (!dq && span != null) {
        if (crossMid && !completed && ((lateLogin || 0) > 0 || (earlyLogout || 0) > 0)) {
          dq = 'Cross-midnight (MD/MN) — overnight session is split across days in the daily roster; validate vs raw Ameyo/Sprinklr before any HR action';
        } else if ((lateLogin || 0) > 180 || (earlyLogout || 0) > 180 || span < 60) {
          dq = 'Login/logout off by >3h or <1h session — likely missing/duplicate session — validate vs raw files';
        }
      }

      let bucket: string, hrAction = false, reason = '';
      if (dq) { bucket = 'data_quality'; reason = dq; }
      else if (unmeasured) { bucket = 'data_quality'; reason = unmeasured; }
      else if (onLeave) { bucket = 'data_quality'; reason = `Worked while ${r.presence} — review as exception`; }
      else if (excludedRole && !includeExcluded) { bucket = 'excluded_valid'; reason = 'Excluded role (TL / Senior / RTA / Customer Care / Resolution)'; }
      else if (holiday) { bucket = 'excluded_valid'; reason = 'Official holiday — holiday work, no lateness action'; }
      else if (hasPerm) { bucket = 'excluded_valid'; reason = `Approved permission${r.permission_type ? ': ' + r.permission_type : ''}`; }
      else if (hasComp) { bucket = 'excluded_valid'; reason = 'Approved COMP'; }
      else if (hasOT) { bucket = 'excluded_valid'; reason = 'Overtime / compensated same day'; }
      else if (completed) { bucket = 'excluded_valid'; reason = 'Completed full scheduled hours'; }
      else if ((lateLogin || 0) === 0 && (earlyLogout || 0) === 0) { bucket = 'excluded_valid'; reason = 'No lateness / early logout'; }
      else if ((shortage || 0) < 5) { bucket = 'excluded_valid'; reason = 'Shortage below 5 minutes'; }
      else { bucket = 'hr_action'; hrAction = true; reason = `Short ${this.wfhHms(shortage)} (late-in ${this.wfhHms(lateLogin)}, early-out ${this.wfhHms(earlyLogout)})`; }

      out.push({
        date: r.date, day: r.day_name, name: r.clean_name, employeeNo: r.employee_no, person: r.person_no,
        function: r.role_function || '—', role: r.role_category || '—', teamLeader: r.team_manager || '—', shiftCode: code,
        schedStart: this.wfhClk(start), schedEnd: this.wfhClk(effEnd), schedGross: this.wfhHms(gross), breakDeduct: this.wfhHms(breakMin),
        requiredNet: this.wfhHms(requiredNet), source: r.login_src || '', loginTime: this.wfhClk(login), logoutTime: this.wfhClk(logout),
        lateLogin: this.wfhHms(lateLogin), earlyLogout: this.wfhHms(earlyLogout), systemSpan: this.wfhHms(span), shortage: this.wfhHms(shortage),
        mother, holiday, permission: hasPerm ? (r.permission_type || 'yes') : '', permissionDur: r.permission_duration || '',
        comp: hasComp ? 'yes' : '', fingerprint: 'none', wfh: 'WFH', excludedRole, hrAction, bucket, reason,
        _shortageMin: shortage || 0, _lateMin: lateLogin || 0,
      });
    }

    const action = out.filter((r) => r.bucket === 'hr_action').sort((a, b) => b._shortageMin - a._shortageMin);
    const excludedValid = out.filter((r) => r.bucket === 'excluded_valid');
    const dataQuality = out.filter((r) => r.bucket === 'data_quality');
    const groupSum = (key: string) => { const m = new Map<string, any>();
      for (const r of out) { const k = r[key] || '—'; const g = m.get(k) || { key: k, total: 0, hr: 0, excluded: 0, dq: 0, shortageMin: 0 };
        g.total++; if (r.bucket === 'hr_action') { g.hr++; g.shortageMin += r._shortageMin; } else if (r.bucket === 'excluded_valid') g.excluded++; else g.dq++; m.set(k, g); }
      return [...m.values()].sort((a, b) => b.hr - a.hr || b.total - a.total); };
    const cnt = (re: RegExp) => excludedValid.filter((r) => re.test(r.reason)).length;
    const totals = {
      wfhRecords: out.length, hrAction: action.length, excludedValid: excludedValid.length, dataQuality: dataQuality.length,
      byReason: { completed: cnt(/Completed/), permission: cnt(/permission/i), comp: cnt(/COMP/), role: cnt(/Excluded role/),
        below5: cnt(/below 5/), ot: cnt(/Overtime/), holiday: cnt(/holiday/i), noLateness: cnt(/No lateness/) },
      topAgents: groupSum('name').filter((g) => g.hr > 0).slice(0, 10),
      topDates: groupSum('date').filter((g) => g.hr > 0).slice(0, 10),
    };
    return { from, to, includeExcluded, rows: out, action, excludedValid, dataQuality,
      summaryByAgent: groupSum('name'), summaryByTeamLeader: groupSum('teamLeader'),
      summaryByFunction: groupSum('function'), summaryByDate: groupSum('date'), totals };
  }

  /** WFH HR action report — JSON (8 views). Default range 1 May → 20 Jun 2026. */
  @Get('roster-v2/wfh-hr-report')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'WFH HR action report — conservative late/early-out WFH detection + 8 views' })
  async wfhHrReport(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('includeExcludedRoles') inc?: string) {
    return this.buildWfhReport(req.user.tenantId, from || '2026-05-01', to || '2026-06-20', inc === '1');
  }

  /** WFH HR report → Excel workbook (8 sheets). */
  @Get('roster-v2/wfh-hr-report/export')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'WFH HR report → .xlsx (HR_Action, Audit_All, Excluded_Valid, Data_Quality + 4 summaries)' })
  async wfhHrExport(@Req() req: any, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string, @Query('includeExcludedRoles') inc?: string) {
    const dFrom = from || '2026-05-01', dTo = to || '2026-06-20';
    const rep = await this.buildWfhReport(req.user.tenantId, dFrom, dTo, inc === '1');
    const wb = new ExcelJS.Workbook(); wb.creator = 'WFM System';
    const COLS = [
      { h: 'Day', k: 'day' }, { h: 'Date', k: 'date' }, { h: 'Employee', k: 'name', w: 20 }, { h: 'Emp ID', k: 'employeeNo' },
      { h: 'Function', k: 'function', w: 14 }, { h: 'Role', k: 'role', w: 14 }, { h: 'Team Leader', k: 'teamLeader', w: 16 }, { h: 'Shift', k: 'shiftCode' },
      { h: 'Sched Start', k: 'schedStart' }, { h: 'Sched End', k: 'schedEnd' }, { h: 'Source', k: 'source', w: 14 }, { h: 'Login', k: 'loginTime' },
      { h: 'Logout', k: 'logoutTime' }, { h: 'Late In', k: 'lateLogin' }, { h: 'Early Out', k: 'earlyLogout' }, { h: 'System Hours', k: 'systemSpan' },
      { h: 'Required Net', k: 'requiredNet' }, { h: 'Shortage', k: 'shortage' }, { h: 'Permission', k: 'permission', w: 14 }, { h: 'Perm Dur', k: 'permissionDur' },
      { h: 'COMP', k: 'comp' }, { h: 'Fingerprint', k: 'fingerprint' }, { h: 'WFH', k: 'wfh' }, { h: 'HR Action', k: 'hrAction' }, { h: 'Reason', k: 'reason', w: 44 },
    ];
    const sheet = (name: string, data: any[]) => { const ws = wb.addWorksheet(name);
      ws.columns = COLS.map((c) => ({ header: c.h, key: c.k, width: c.w || 11 }));
      data.forEach((r) => ws.addRow({ ...r, hrAction: r.hrAction ? 'Yes' : 'No' }));
      ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
    sheet('WFH_HR_Action', rep.action); sheet('WFH_Audit_All', rep.rows);
    sheet('WFH_Excluded_Valid', rep.excludedValid); sheet('WFH_Data_Quality', rep.dataQuality);
    const sumCols = [{ h: 'Name', k: 'key', w: 24 }, { h: 'Total', k: 'total' }, { h: 'HR Action', k: 'hr' }, { h: 'Excluded', k: 'excluded' }, { h: 'Data Quality', k: 'dq' }];
    const sumSheet = (name: string, label: string, data: any[]) => { const ws = wb.addWorksheet(name);
      ws.columns = sumCols.map((c) => ({ header: c.k === 'key' ? label : c.h, key: c.k, width: c.w || 12 }));
      data.forEach((r) => ws.addRow(r)); ws.getRow(1).font = { bold: true }; };
    sumSheet('Summary_By_Agent', 'Agent', rep.summaryByAgent); sumSheet('Summary_By_TeamLeader', 'Team Leader', rep.summaryByTeamLeader);
    sumSheet('Summary_By_Function', 'Function', rep.summaryByFunction); sumSheet('Summary_By_Date', 'Date', rep.summaryByDate);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="WFH_HR_Report_${dFrom}_${dTo}.xlsx"` });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

}
