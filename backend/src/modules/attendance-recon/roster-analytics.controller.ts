import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { TRUE_OT, CRED_LATE, CRED_EARLY, SC_MONTH_NET, scMonthNet } from '@common/wfm-metrics';
import { SHIFT_CAT } from './roster-shared.service';

/** Pure per-function-per-month KPI point (Stage-3A trends). Percentages are derived
 *  from the raw roster_days counts; `partial` marks a month not fully covered by the
 *  data range (min-date after the 1st, or max-date before the month-end capped at the
 *  latest data day / today). Exported so the math is unit-tested independently of SQL. */
export function monthKpiPoint(r: any, capMax: string) {
  const daysInMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
  const monthStart = `${r.ym}-01`, monthEnd = `${r.ym}-${String(daysInMonth(r.ym)).padStart(2, '0')}`;
  const partial = r.mn > monthStart || r.mx < (monthEnd < capMax ? monthEnd : capMax);
  const pctOf = (n: number, d: number) => d ? Math.round((1000 * n) / d) / 10 : 0;
  return { ym: r.ym, workedDays: r.worked, agents: r.agents, otHours: r.ot_hrs,
    tardyPct: pctOf(r.latedays, r.tardy_base), conformancePct: r.conf,
    wfhPct: pctOf(r.wfh, r.worked), absencePct: pctOf(r.absent, r.worked + r.absent + r.sick),
    resTer: r.res_ter, transfers: r.transfers, partial };
}

/* Agent/team analytics (agent-360, team-progress, trends, scores, insights,
 * team-360, scorecard board, agent progress/performance/period-compare) and the
 * Executive Summary export that reuses those engines — split VERBATIM out of the
 * monolithic ReconController (2026-07-07, EXECUTION_BRIEF Phase-4). Same route
 * prefix — zero route renames. */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class RosterAnalyticsController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}
  /** Agent 360 — one agent's complete WFM card from the clean roster_days:
   *  attendance mix, tardiness bands, OT detail, shift-rate distribution, monthly
   *  trend, and recent days. Resolve by person_no or name search. */
  @Get('roster-v2/agent-360')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Agent 360 profile — attendance, tardiness bands, OT, shift-rate, monthly trend' })
  async agent360(@Req() req: any, @Query('person') person?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    if (!person) throw new BadRequestException('person (no or name) is required');
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const [emp] = await this.ds.query(
      `SELECT person_no, clean_name, function_name, role_category, expected_hours, include_tardiness, is_active, is_supervisor, gender, team_leader, team_group, employment_type
         FROM employee_identity WHERE tenant_id=$1 AND is_canonical AND (person_no=$2 OR lower(clean_name) LIKE lower($3)) ORDER BY (person_no=$2) DESC LIMIT 1`,
      [t, person, `%${person}%`]);
    if (!emp) throw new BadRequestException('No such agent');
    const pn = emp.person_no; const p = [t, pn, dFrom, dTo];
    const W = `tenant_id=$1 AND person_no=$2 AND work_date BETWEEN $3 AND $4`;
    const [summary] = await this.ds.query(`
      SELECT COUNT(*)::int "scheduledDays",
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int "workedDays",
             COUNT(*) FILTER (WHERE presence='office')::int "officeDays", COUNT(*) FILTER (WHERE presence='wfh')::int "wfhDays",
             COUNT(*) FILTER (WHERE presence='off')::int "offDays", COUNT(*) FILTER (WHERE presence='leave')::int "leaveDays",
             COUNT(*) FILTER (WHERE presence='sick')::int "sickDays", COUNT(*) FILTER (WHERE presence='absent')::int "absenceDays",
             COUNT(*) FILTER (WHERE presence='holiday')::int "holidayDays",
             COUNT(*) FILTER (WHERE comp_off IS NOT NULL OR comp_worked_min>0)::int "compDays",
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int "lateDays", COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int "totalLateMin",
             COUNT(*) FILTER (WHERE ${CRED_EARLY})::int "earlyDays", COALESCE(SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY}),0)::int "totalEarlyMin",
             COALESCE(SUM(ot_before_min),0)::int "otBefore", COALESCE(SUM(ot_after_min),0)::int "otAfter",
             COALESCE(SUM(${TRUE_OT}),0)::int "otTotal", COALESCE(SUM(offday_ot_min),0)::int "offdayOt", COALESCE(SUM(holiday_ot_min),0)::int "holidayOt",
             ROUND(AVG(adherence_pct),1) conformance,
             COUNT(*) FILTER (WHERE missing_punch)::int "missingPunch", COUNT(*) FILTER (WHERE missing_system)::int "missingSystem",
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions
        FROM roster_days WHERE ${W}`, p);
    const tardinessBands = await this.ds.query(`SELECT COALESCE(late_category,'On time') band, COUNT(*)::int n FROM roster_days WHERE ${W} AND presence IN ('office','wfh') GROUP BY 1`, p);
    const sr = await this.ds.query(`SELECT ${SHIFT_CAT} cat, COUNT(*)::int n FROM roster_days WHERE ${W} AND presence IN ('office','wfh','sick','absent') GROUP BY 1`, p);
    const shiftRate: Record<string, number> = { Morning: 0, Night: 0, Evening: 0, Midnight: 0, Other: 0 };
    for (const r of sr) shiftRate[r.cat] = r.n;
    const byMonth = await this.ds.query(`
      SELECT month_name "month", COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int "lateMin", COALESCE(SUM(${TRUE_OT}),0)::int "otMin", ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days WHERE ${W} GROUP BY month_name ORDER BY MIN(work_date)`, p);
    const recent = await this.ds.query(`
      SELECT work_date::text date, day_name, shift_code, attendance_status, presence,
             sys_login_min, sys_logout_min, sys_late_min, late_category, ot_before_min, ot_after_min, adherence_pct, data_quality
        FROM roster_days WHERE ${W} ORDER BY work_date DESC LIMIT 40`, p);
    return { from: dFrom, to: dTo, employee: emp, summary, tardinessBands, shiftRate, byMonth, recent };
  }

  /** Team Progress — month-over-month for a whole team (team leader): is the team
   *  improving or declining? Mirrors agent-progress but aggregated across the team. */
  @Get('roster-v2/team-progress')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Team month-over-month progress + improving/declining verdict' })
  async teamProgress(@Req() req: any, @Query('teamLeader') tl?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const tlName = tl || (await this.ds.query(`SELECT team_manager FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' GROUP BY team_manager ORDER BY COUNT(*) DESC LIMIT 1`, [t]))[0]?.team_manager;
    if (!tlName) throw new BadRequestException('No team leaders found');
    const dFrom = from || range?.a, dTo = to || range?.b;
    const rosterM = await this.ds.query(`
      SELECT EXTRACT(YEAR FROM work_date)::int yr, EXTRACT(MONTH FROM work_date)::int mo, MIN(month_name) month_name,
             COUNT(DISTINCT person_no)::int agents, COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conf,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
             COALESCE(SUM(${TRUE_OT}),0)::int otmin, COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='sick')::int sick
        FROM roster_days WHERE tenant_id=$1 AND team_manager=$2 AND work_date BETWEEN $3 AND $4 AND is_active
        GROUP BY 1,2 ORDER BY 1,2`, [t, tlName, dFrom, dTo]);
    const netM = await this.ds.query(`
      SELECT year yr, month mo, ROUND(AVG(${SC_MONTH_NET}::numeric),1) net FROM scorecard_monthly
        WHERE tenant_id=$1 AND team_manager=$2 AND make_date(year,month,1) BETWEEN date_trunc('month',$3::date) AND $4::date
        GROUP BY year,month`, [t, tlName, dFrom, dTo]);
    const netMap = new Map<string, number>(netM.map((r: any) => [`${r.yr}-${r.mo}`, Number(r.net)]));
    const months = rosterM.map((r: any) => ({ yr: r.yr, mo: r.mo, label: `${r.month_name || r.mo} ${String(r.yr).slice(2)}`,
      agents: r.agents, worked: r.worked, conf: r.conf == null ? null : Number(r.conf), lateDays: r.latedays, lateMin: r.latemin,
      otMin: r.otmin, absent: r.absent, sick: r.sick, net: netMap.has(`${r.yr}-${r.mo}`) ? netMap.get(`${r.yr}-${r.mo}`) : null }));
    months.forEach((m: any, i: number) => { const pr: any = i > 0 ? months[i - 1] : null;
      m.d = pr ? { conf: m.conf != null && pr.conf != null ? Math.round((m.conf - pr.conf) * 10) / 10 : null,
        net: m.net != null && pr.net != null ? Math.round((m.net - pr.net) * 10) / 10 : null,
        lateDays: m.lateDays - pr.lateDays, absent: m.absent - pr.absent } : null; });
    const fl = (key: string) => { const v = months.filter((m: any) => m[key] != null); return v.length >= 2 ? { first: v[0][key], last: v[v.length - 1][key], change: Math.round((v[v.length - 1][key] - v[0][key]) * 10) / 10 } : null; };
    const confV = fl('conf'), netV = fl('net');
    const dir = (c: number | null | undefined, th = 2) => c == null ? 'flat' : c > th ? 'up' : c < -th ? 'down' : 'flat';
    let overall = 'stable'; const cd = confV ? dir(confV.change) : null, nd = netV ? dir(netV.change, 3) : null;
    if (cd === 'up' || nd === 'up') overall = (cd === 'down' || nd === 'down') ? 'mixed' : 'improving';
    if ((cd === 'down' || nd === 'down') && overall !== 'mixed' && overall !== 'improving') overall = 'declining';
    return { teamLeader: tlName, from: dFrom, to: dTo, months, verdict: { conformance: confV && { ...confV, dir: dir(confV.change) }, net: netV && { ...netV, dir: dir(netV.change, 3) }, overall } };
  }

  /** Trends — center-wide KPI movement over weeks or months (conformance, tardiness,
   *  OT, absence, headcount), filterable by function / team leader.
   *  `months=N` (Stage-3A): anchor the window to the last N calendar months (capped
   *  <= today) and additionally return the month-over-month per-FUNCTION KPI matrix
   *  (`functionTrends`) + a center-wide `overall` MoM line + attrition markers, so
   *  the Director sees DIRECTION per function, not just a snapshot. All added fields
   *  are additive — the existing `points`/`filterOptions` shape is unchanged. */
  @Get('roster-v2/trends')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'KPI trends: weekly/monthly points + (months=N) per-function month-over-month matrix (worked, TRUE_OT, tardy%, conformance%, WFH%, absence%, RES/TER)' })
  async trends(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string,
    @Query('function') fn?: string, @Query('teamLeader') tl?: string, @Query('interval') interval = 'week',
    @Query('months') monthsRaw?: string) {
    const t = req.user.tenantId;
    // date anchors capped <= CURRENT_DATE (roster_days is reconciled history; defensive cap)
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, LEAST(MAX(work_date), CURRENT_DATE)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    // months=N → window = first-of-month(maxMonth - (N-1)) .. maxDate (both capped <= today)
    const months = monthsRaw ? Math.max(1, Math.min(36, Number(monthsRaw) || 6)) : null;
    let dFrom = from || range?.a; const dTo = (to && to <= range?.b ? to : range?.b);
    if (months && !from && dTo) { const d = new Date(dTo + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (months - 1)); dFrom = d.toISOString().slice(0, 10); }
    const p: any[] = [t, dFrom, dTo]; let w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND work_date <= CURRENT_DATE AND is_active`;
    if (fn) { p.push(fn); w += ` AND canon_fn(role_function)=canon_fn($${p.length})`; }
    if (tl) { p.push(tl); w += ` AND team_manager=$${p.length}`; }
    const bucket = interval === 'month' ? 'month_name' : 'week_number';
    // RES/TER attrition marker (voluntary + involuntary); TRANSFER is an internal move, NOT attrition
    const MARK = `UPPER(COALESCE(NULLIF(r.shift_code,''), r.attendance_code, ''))`;
    const rows = await this.ds.query(
      `SELECT ${bucket} bucket, MIN(work_date)::text start, MAX(work_date)::text "end",
              COUNT(DISTINCT person_no)::int agents,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
              COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='sick')::int sick,
              COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
              COALESCE(SUM(${TRUE_OT}),0)::int otmin, ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conf
         FROM roster_days r WHERE ${w} GROUP BY ${bucket} ORDER BY MIN(work_date)`, p);

    // ── Month-over-month per-function KPI matrix (Stage-3A). Grouped by canonical
    //    function × calendar month; percentages computed in JS from the raw counts.
    const fnRows = await this.ds.query(
      `SELECT canon_fn(role_function) fn, to_char(work_date,'YYYY-MM') ym,
              MIN(work_date)::text mn, MAX(work_date)::text mx,
              COUNT(DISTINCT person_no)::int agents,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
              COUNT(*) FILTER (WHERE presence='wfh')::int wfh,
              COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='sick')::int sick,
              COUNT(*) FILTER (WHERE ${CRED_LATE} AND include_tardiness)::int latedays,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND include_tardiness)::int tardy_base,
              ROUND(SUM(${TRUE_OT})/60.0,1)::float ot_hrs,
              ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1)::float conf,
              COUNT(*) FILTER (WHERE ${MARK} IN ('RES','TER'))::int res_ter,
              COUNT(*) FILTER (WHERE ${MARK}='TRANSFER')::int transfers
         FROM roster_days r WHERE ${w} AND canon_fn(role_function) IS NOT NULL
         GROUP BY 1,2 ORDER BY 1,2`, p);
    const today = range?.b; // capped max = today-or-last-data-day
    const fnMap = new Map<string, any[]>();
    for (const r of fnRows) { if (!fnMap.has(r.fn)) fnMap.set(r.fn, []); fnMap.get(r.fn)!.push(monthKpiPoint(r, today)); }
    const dir = (a: number | null, b: number | null, eps = 0.5) => (a == null || b == null) ? 'flat' : (b - a > eps ? 'up' : b - a < -eps ? 'down' : 'flat');
    const functionTrends = [...fnMap.entries()].map(([f, months2]) => {
      const first = months2[0], last = months2[months2.length - 1];
      return { function: f, months: months2,
        trend: { conformance: dir(first.conformancePct, last.conformancePct), tardiness: dir(last.tardyPct, first.tardyPct), ot: dir(first.otHours, last.otHours, 1) },
        totalResTer: months2.reduce((s: number, m: any) => s + m.resTer, 0) };
    }).sort((a, b) => a.function.localeCompare(b.function));

    // center-wide MoM line (all functions folded)
    const overallMap = new Map<string, any>();
    for (const r of fnRows) { const g = overallMap.get(r.ym) || { ym: r.ym, worked: 0, wfh: 0, absent: 0, sick: 0, latedays: 0, tardy_base: 0, ot_hrs: 0, res_ter: 0, confNum: 0, confDen: 0 };
      g.worked += r.worked; g.wfh += r.wfh; g.absent += r.absent; g.sick += r.sick; g.latedays += r.latedays; g.tardy_base += r.tardy_base;
      g.ot_hrs += r.ot_hrs; g.res_ter += r.res_ter; if (r.conf != null) { g.confNum += r.conf * r.tardy_base; g.confDen += r.tardy_base; } overallMap.set(r.ym, g); }
    const overall = [...overallMap.values()].sort((a, b) => a.ym.localeCompare(b.ym)).map((g: any) => {
      const pctOf = (n: number, d: number) => d ? Math.round((1000 * n) / d) / 10 : 0;
      return { ym: g.ym, workedDays: g.worked, otHours: Math.round(g.ot_hrs * 10) / 10, tardyPct: pctOf(g.latedays, g.tardy_base),
        conformancePct: g.confDen ? Math.round((10 * g.confNum) / g.confDen) / 10 : null, wfhPct: pctOf(g.wfh, g.worked),
        absencePct: pctOf(g.absent, g.worked + g.absent + g.sick), resTer: g.res_ter };
    });

    // options for the filters
    const [functions, teamLeaders] = await Promise.all([
      this.ds.query(`SELECT DISTINCT canon_fn(role_function) v FROM roster_days WHERE tenant_id=$1 AND role_function IS NOT NULL ORDER BY 1`, [t]),
      this.ds.query(`SELECT DISTINCT team_manager v FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' ORDER BY 1`, [t]),
    ]);
    const label = (r: any) => interval === 'month' ? r.bucket : `W${r.bucket}`;
    return { from: dFrom, to: dTo, interval, months, range,
             points: rows.map((r: any) => ({ ...r, label: label(r) })),
             overall, functionTrends,
             filterOptions: { functions: functions.map((x: any) => x.v), teamLeaders: teamLeaders.map((x: any) => x.v) },
             note: 'functionTrends/overall are month-over-month; a month flagged partial:true is not fully covered by the data range (verify before reading direction). Attrition = RES/TER markers (TRANSFER excluded).' };
  }

  /** Attendance & Adherence Score — a transparent composite (0-100, grade A-D) per
   *  agent from conformance + absence + tardiness. NOT the official performance
   *  scorecard (which uses AHT/quality/quiz) — this is attendance/adherence only.
   *  Default: tardiness-eligible roles with >=5 worked days. */
  @Get('roster-v2/agent-scores')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Composite attendance/adherence score + grade per agent (ranked leaderboard)' })
  async agentScores(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('includeExcludedRoles') incRoles?: string, @Query('person') person?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo]; let w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`;
    if (incRoles !== '1') w += ` AND include_tardiness`;
    if (person) { p.push(person); w += ` AND person_no=$${p.length}`; }
    const rows = await this.ds.query(
      `SELECT person_no, mode() WITHIN GROUP (ORDER BY clean_name) name, mode() WITHIN GROUP (ORDER BY role_function) fn,
              mode() WITHIN GROUP (ORDER BY role_category) role, mode() WITHIN GROUP (ORDER BY team_manager) tl,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh')) worked,
              COUNT(*) FILTER (WHERE presence='absent') absent, COUNT(*) FILTER (WHERE presence='sick') sick,
              COUNT(*) FILTER (WHERE ${CRED_LATE}) latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
              COUNT(*) FILTER (WHERE missing_system) misssys, ROUND(AVG(adherence_pct),1) conf, COALESCE(SUM(${TRUE_OT}),0)::int otmin
         FROM roster_days r WHERE ${w} AND person_no IS NOT NULL
         GROUP BY person_no HAVING COUNT(*) FILTER (WHERE presence IN ('office','wfh'))>=5`, p);
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    const scored = rows.map((r: any) => {
      const worked = r.worked, scheduled = worked + r.absent + r.sick;
      const conf = r.conf == null ? 0 : Number(r.conf);
      const attend = clamp(100 - (scheduled ? (r.absent / scheduled) * 100 : 0));      // absence reliability
      const punct = clamp(100 - (worked ? (r.latedays / worked) * 100 : 0));            // punctuality
      const score = Math.round(0.55 * conf + 0.30 * attend + 0.15 * punct);
      const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : 'D';
      return { person_no: r.person_no, name: r.name, fn: r.fn, role: r.role, tl: r.tl, worked, absent: r.absent, sick: r.sick,
               lateDays: r.latedays, lateMin: r.latemin, missSys: r.misssys, otMin: r.otmin, conf, attend, punct, score, grade };
    }).sort((a: any, b: any) => b.score - a.score).map((r: any, i: number) => ({ rank: i + 1, ...r }));
    // attach each person's latest official Net Points (scorecard), alias-aware
    const netRows = await this.ds.query(
      `SELECT DISTINCT ON (i.person_no) i.person_no, ${scMonthNet('sm')}::numeric net, sm.year, sm.month
         FROM scorecard_monthly sm JOIN employee_identity i ON i.tenant_id=sm.tenant_id AND i.employee_no=sm.employee_no
        WHERE sm.tenant_id=$1 ORDER BY i.person_no, sm.year DESC, sm.month DESC`, [t]);
    const netMap = new Map<string, { net: number; period: string }>(netRows.map((r: any) => [r.person_no, { net: Number(r.net), period: `${r.year}-${String(r.month).padStart(2, '0')}` }] as [string, { net: number; period: string }]));
    for (const a of scored) { const n = netMap.get(a.person_no); a.netPoints = n ? n.net : null; a.netPeriod = n ? n.period : null; }
    const dist = { A: 0, B: 0, C: 0, D: 0 } as Record<string, number>; for (const r of scored) dist[r.grade]++;
    const avg = scored.length ? Math.round(scored.reduce((a: number, r: any) => a + r.score, 0) / scored.length) : 0;
    return { from: dFrom, to: dTo, count: scored.length, average: avg, distribution: dist,
             formula: 'score = 0.55×conformance + 0.30×attendance(absence) + 0.15×punctuality(lateness); grades A≥85 B≥70 C≥55 D<55',
             agents: person ? scored : scored.slice(0, 200) };
  }

  /** WFM Insights — auto-prioritized, actionable findings over the clean roster_days:
   *  coaching candidates (low conformance), tardiness/absence outliers, coverage-risk
   *  functions, OT concentration, conformance trend vs the previous period, and data
   *  quality. Each insight carries a severity + a deep-link target. */
  @Get('roster-v2/insights')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Auto-prioritized WFM insights/alerts (coaching, coverage, OT, trend, data quality)' })
  async insights(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0, 7)}-01` : range?.a), dTo = to || range?.b;
    const days = Math.max(1, Math.round((+new Date(dTo) - +new Date(dFrom)) / 86400000) + 1);
    const prevTo = new Date(new Date(dFrom).getTime() - 86400000).toISOString().slice(0, 10);
    const prevFrom = new Date(new Date(dFrom).getTime() - days * 86400000).toISOString().slice(0, 10);
    const out: any[] = [];
    const push = (severity: string, kind: string, title: string, detail: string, link?: string, value?: any) => out.push({ severity, kind, title, detail, link, value });

    // 1) coaching candidates — low conformance, enough working days, tardiness-eligible roles
    const lowConf = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY clean_name) name, ROUND(AVG(adherence_pct),1) conf, COUNT(*) FILTER (WHERE presence IN ('office','wfh')) wd
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness AND adherence_pct IS NOT NULL
         GROUP BY person_no HAVING AVG(adherence_pct)<70 AND COUNT(*) FILTER (WHERE presence IN ('office','wfh'))>=10 ORDER BY conf ASC LIMIT 6`, [t, dFrom, dTo]);
    if (lowConf.length) push('critical', 'coaching', `${lowConf.length} ${lowConf.length === 1 ? 'agent needs' : 'agents need'} coaching (conformance < 70%)`,
      lowConf.map((r: any) => `${r.name} ${r.conf}%`).join(' · '), '/data-quality');

    // 1b) DECLINING agents — conformance dropped sharply in the 2nd half of the period (proactive coaching)
    const mid = new Date(new Date(dFrom).getTime() + Math.floor(days / 2) * 86400000).toISOString().slice(0, 10);
    const declining = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY clean_name) name,
              ROUND(AVG(adherence_pct) FILTER (WHERE work_date < $4),1) h1,
              ROUND(AVG(adherence_pct) FILTER (WHERE work_date >= $4),1) h2
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness AND adherence_pct IS NOT NULL
         GROUP BY person_no
        HAVING COUNT(*) FILTER (WHERE work_date < $4) >= 5 AND COUNT(*) FILTER (WHERE work_date >= $4) >= 5
           AND AVG(adherence_pct) FILTER (WHERE work_date >= $4) - AVG(adherence_pct) FILTER (WHERE work_date < $4) < -15
        ORDER BY AVG(adherence_pct) FILTER (WHERE work_date >= $4) - AVG(adherence_pct) FILTER (WHERE work_date < $4) ASC LIMIT 6`, [t, dFrom, dTo, mid]);
    if (declining.length) push('warning', 'declining', `${declining.length} agent(s) declining (conformance dropped ≥15 pts)`,
      declining.map((r: any) => `${r.name} ${r.h1}%→${r.h2}%`).join(' · '), '/agent-360');

    // 2) tardiness outliers
    const late = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY clean_name) name, COUNT(*) FILTER (WHERE ${CRED_LATE}) ld, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int lm
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness
         GROUP BY person_no HAVING COUNT(*) FILTER (WHERE ${CRED_LATE})>=10 ORDER BY ld DESC LIMIT 5`, [t, dFrom, dTo]);
    if (late.length) push('warning', 'tardiness', `${late.length} agent(s) late ≥ 10 days`, late.map((r: any) => `${r.name} (${r.ld}d)`).join(' · '), '/roster-dashboard');

    // 3) absence outliers
    const abs = await this.ds.query(
      `SELECT mode() WITHIN GROUP (ORDER BY clean_name) name, COUNT(*) FILTER (WHERE presence='absent') ab
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active
         GROUP BY person_no HAVING COUNT(*) FILTER (WHERE presence='absent')>=5 ORDER BY ab DESC LIMIT 5`, [t, dFrom, dTo]);
    if (abs.length) push('warning', 'absence', `${abs.length} agent(s) absent ≥ 5 days`, abs.map((r: any) => `${r.name} (${r.ab})`).join(' · '), '/roster-dashboard');

    // 4) coverage-risk functions — high sick+absent share of planned-working
    const cov = await this.ds.query(
      `SELECT canon_fn(role_function) fn,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh') OR presence IN ('sick','absent')) planned,
              COUNT(*) FILTER (WHERE presence IN ('sick','absent')) lost
         FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND role_function IS NOT NULL
         GROUP BY canon_fn(role_function) HAVING COUNT(*) FILTER (WHERE presence IN ('office','wfh') OR presence IN ('sick','absent'))>=20
         AND COUNT(*) FILTER (WHERE presence IN ('sick','absent'))::float / NULLIF(COUNT(*) FILTER (WHERE presence IN ('office','wfh') OR presence IN ('sick','absent')),0) > 0.12
         ORDER BY COUNT(*) FILTER (WHERE presence IN ('sick','absent'))::float / NULLIF(COUNT(*) FILTER (WHERE presence IN ('office','wfh') OR presence IN ('sick','absent')),0) DESC LIMIT 4`, [t, dFrom, dTo]);
    for (const r of cov) push('warning', 'coverage', `${r.fn}: ${Math.round(100 * r.lost / r.planned)}% of planned days lost to sick/absent`, `${r.lost} of ${r.planned} planned days`, '/interval-headcount');

    // 5) OT concentration — top shift by OT
    const ot = await this.ds.query(
      `SELECT shift_code, COALESCE(SUM(${TRUE_OT}),0)::int otm FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND shift_code IS NOT NULL GROUP BY shift_code ORDER BY otm DESC LIMIT 1`, [t, dFrom, dTo]);
    if (ot[0]?.otm > 0) push('info', 'overtime', `OT concentrated on the ${ot[0].shift_code} shift`, `${Math.round(ot[0].otm / 60)}h total overtime`, '/report-builder');

    // 6) conformance trend vs previous equal-length period
    const [cur] = await this.ds.query(`SELECT ROUND(AVG(adherence_pct),1) v FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness`, [t, dFrom, dTo]);
    const [prev] = await this.ds.query(`SELECT ROUND(AVG(adherence_pct),1) v FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND include_tardiness`, [t, prevFrom, prevTo]);
    if (cur?.v != null && prev?.v != null) { const delta = Math.round((cur.v - prev.v) * 10) / 10;
      push(delta < -3 ? 'warning' : 'info', 'trend', `Conformance ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)} pts vs previous period`, `${prev.v}% → ${cur.v}%`, '/roster-dashboard', delta); }

    // 7) data quality
    const [dq] = await this.ds.query(`SELECT COUNT(*) FILTER (WHERE data_quality IS NOT NULL)::int flagged FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3`, [t, dFrom, dTo]);
    if (dq?.flagged) push('info', 'quality', `${dq.flagged.toLocaleString()} rows carry a data-quality flag`, 'Review in System Audit', '/system-audit');

    const rank: Record<string, number> = { critical: 3, warning: 2, info: 1 };
    out.sort((a, b) => (rank[b.severity] - rank[a.severity]));
    return { from: dFrom, to: dTo, count: out.length, insights: out };
  }

  /** Team 360 — a whole team's WFM card for a team leader: team aggregate KPIs +
   *  per-agent breakdown + shift distribution. Excludes hidden TLs' scrubbed labels. */
  @Get('roster-v2/team-360')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Team 360 — team-leader aggregate + per-agent breakdown + shift distribution' })
  async team360(@Req() req: any, @Query('teamLeader') tl?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    // default to the team leader with the most reports if none given
    const tlName = tl || (await this.ds.query(`SELECT team_manager FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' GROUP BY team_manager ORDER BY COUNT(*) DESC LIMIT 1`, [t]))[0]?.team_manager;
    if (!tlName) throw new BadRequestException('No team leaders found');
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p = [t, tlName, dFrom, dTo]; const W = `tenant_id=$1 AND team_manager=$2 AND work_date BETWEEN $3 AND $4 AND is_active`;
    const [summary] = await this.ds.query(`
      SELECT COUNT(DISTINCT person_no)::int agents, COUNT(*)::int records,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int workedDays,
             COUNT(*) FILTER (WHERE presence='off')::int offDays,
             COUNT(*) FILTER (WHERE presence='sick')::int sick, COUNT(*) FILTER (WHERE presence='absent')::int absent,
             COUNT(*) FILTER (WHERE presence='leave')::int leave,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int lateDays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int lateMin,
             COUNT(*) FILTER (WHERE ${CRED_EARLY})::int earlyDays,
             COALESCE(SUM(ot_before_min),0)::int otBefore, COALESCE(SUM(ot_after_min),0)::int otAfter, COALESCE(SUM(${TRUE_OT}),0)::int otTotal,
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
             ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days WHERE ${W}`, p);
    const agents = await this.ds.query(`
      SELECT person_no, mode() WITHIN GROUP (ORDER BY clean_name) name, mode() WITHIN GROUP (ORDER BY role_function) function_name,
             mode() WITHIN GROUP (ORDER BY role_category) role,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int lateDays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int lateMin,
             COALESCE(SUM(${TRUE_OT}),0)::int otMin, COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE presence='absent')::int absent, ROUND(AVG(adherence_pct),1) conformance
        FROM roster_days WHERE ${W} AND person_no IS NOT NULL GROUP BY person_no ORDER BY conformance ASC NULLS LAST`, p);
    const byShift = await this.ds.query(`SELECT shift_code k, COUNT(*)::int n FROM roster_days WHERE ${W} AND presence IN ('office','wfh') GROUP BY shift_code ORDER BY n DESC`, p);
    // team-leader picker options (verified, non-hidden)
    const tlOpts = await this.ds.query(`SELECT DISTINCT team_manager v FROM roster_days WHERE tenant_id=$1 AND team_manager IS NOT NULL AND team_manager<>'' ORDER BY 1`, [t]);
    return { teamLeader: tlName, from: dFrom, to: dTo, range, summary, agents, byShift, teamLeaders: tlOpts.map((r: any) => r.v) };
  }

  /** Scorecard Board — official scorecard, board VIEW over scorecard_entries at
   *  agent × week grain (same source as the scorecard module; a VIEW, not an
   *  independent score). By-agent = avg across the agent's WEEKS for every KPI;
   *  pass ?person= for the W1–W5 weekly drill. Alias-aware via employee_identity.
   *
   *  TWO CORRECTNESS RULES THIS ENDPOINT NOW HOLDS — both were being violated:
   *
   *  1. ONE PERIOD AT A TIME. It read every scorecard_entries row the tenant has
   *     ever had, so a second uploaded month would silently average two months
   *     into one board while the page caption named a single month. Now scoped to
   *     a batch (`?period=`, default = the newest), and the period is RETURNED so
   *     the caption states the period actually being shown.
   *
   *  2. `Final` IS NOT A WEEK. Each agent has W1..W4 plus a `Final` summary row
   *     carrying the official month result. AVG over all five folded the official
   *     answer into its own average of weeks — for person 12648 that turned an
   *     official Net of 125 into 113. The weekly average now covers weeks only,
   *     and the official Final is returned ALONGSIDE it as `final_net`/`rank`,
   *     so both numbers are visible and neither is silently blended. */
  @Get('roster-v2/scorecard')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Official scorecard board — per-agent (avg of weeks) + official Final + weekly drill, one period' })
  async scorecardBoard(@Req() req: any, @Query('function') fn?: string, @Query('teamLeader') tl?: string, @Query('person') person?: string, @Query('period') period?: string) {
    const t = req.user.tenantId;

    /* Period scoping. Batches are the upload unit and carry the real period name. */
    const batches = await this.ds.query(
      `SELECT id, period_name, period_year, period_month FROM scorecard_batches
        WHERE tenant_id=$1 AND status <> 'archived'
        ORDER BY period_year DESC NULLS LAST, period_month DESC NULLS LAST, uploaded_at DESC`, [t]);
    const batch = (period ? batches.find((b: any) => b.period_name === period || b.id === period) : null) ?? batches[0] ?? null;
    if (!batch) {
      return { period: null, periodOptions: [], kpiMeta: [], agents: [], avgNet: null, count: 0,
               filterOptions: { functions: [], teamLeaders: [] },
               note: 'No scorecard batch has been uploaded yet.' };
    }
    const bid = batch.id;
    const WEEKS_ONLY = `se.week_label IS DISTINCT FROM 'Final'`;   // `Final` is the month result, not a week

    // KPI metadata + max points (cap = top observed score per KPI, within THIS period)
    const [mx] = await this.ds.query(
      `SELECT MAX(quality_score) quality, MAX(aht_score) aht, MAX(fcr_score) fcr, MAX(productivity_score) productivity,
              MAX(ctr_score) ctr, MAX(quiz_score) quiz, MAX(prr_points) prr, MAX(response_time_score) resptime,
              MAX(mistakes_score) mistakes, MAX(incidents_score) incidents, MAX(attendance_score) attendance
         FROM scorecard_entries WHERE tenant_id=$1 AND batch_id=$2`, [t, bid]);
    const kpiMeta = [
      ['quality', 'Quality', 'pct'], ['fcr', 'FCR', 'pct'], ['productivity', 'Productivity', 'pct'], ['mistakes', 'Mistakes', 'count'], ['resptime', 'Response Time', 'min'],
      ['ctr', 'CTR', 'pct'], ['quiz', 'Quiz', 'pct'], ['aht', 'AHT', 'min'], ['prr', 'PRR', 'pct'], ['incidents', 'Incidents', 'count'], ['attendance', 'Attendance', 'pct'],
    ].map(([k, l, unit]) => ({ key: k, label: l, unit, max: mx?.[k] != null ? Number(mx[k]) : null }))
      .filter((m) => m.max != null && m.max > 0);   // hide KPIs with no data this period (e.g. Incidents/Attendance)
    // actual measure per KPI (alongside points): pct ×100, AHT in minutes, response-time day-fraction ×1440 = minutes, counts as-is
    const ACT = `ROUND(AVG(se.quality_actual::numeric)*100,1) quality_act, ROUND(AVG(se.aht_actual::numeric),2) aht_act,
      ROUND(AVG(se.fcr_actual::numeric)*100,1) fcr_act, ROUND(AVG(se.productivity_actual::numeric)*100,1) productivity_act,
      ROUND(AVG(se.ctr_actual::numeric)*100,1) ctr_act, ROUND(AVG(se.quiz_actual::numeric)*100,1) quiz_act,
      ROUND(AVG(se.prr_rate::numeric)*100,1) prr_act, ROUND(AVG(se.response_time_actual::numeric)*1440,1) resptime_act,
      ROUND(AVG(se.mistakes_actual::numeric),1) mistakes_act`;

    if (person) { // weekly drill for one agent
      const ids = (await this.ds.query(`SELECT employee_no FROM employee_identity WHERE tenant_id=$1 AND person_no=$2`, [t, person])).map((r: any) => r.employee_no);
      const weeks = await this.ds.query(
        `SELECT week_label, net_points net, function_rank rank, quality_score quality, aht_score aht, fcr_score fcr,
                productivity_score productivity, ctr_score ctr, quiz_score quiz, prr_points prr, response_time_score resptime,
                mistakes_score mistakes, incidents_score incidents, attendance_score attendance,
                ROUND(quality_actual::numeric*100,1) quality_act, ROUND(aht_actual::numeric,2) aht_act, ROUND(fcr_actual::numeric*100,1) fcr_act,
                ROUND(productivity_actual::numeric*100,1) productivity_act, ROUND(ctr_actual::numeric*100,1) ctr_act, ROUND(quiz_actual::numeric*100,1) quiz_act,
                ROUND(prr_rate::numeric*100,1) prr_act, ROUND(response_time_actual::numeric*1440,1) resptime_act, ROUND(mistakes_actual::numeric,1) mistakes_act,
                ROUND(response_rate::numeric*100,1) res, ROUND(working_days_pct::numeric*100,1) wd
           FROM scorecard_entries WHERE tenant_id=$1 AND batch_id=$3 AND employee_no = ANY($2) ORDER BY week_label`, [t, ids.length ? ids : [person], bid]);
      return { person, period: batch.period_name, kpiMeta, weeks };
    }

    const p: any[] = [t, bid]; let w = `se.tenant_id=$1 AND se.batch_id=$2`;
    if (fn) { p.push(fn); w += ` AND se.function_name=$${p.length}`; }
    if (tl) { p.push(tl); w += ` AND se.team_leader=$${p.length}`; }
    /* Averages over WEEKS only; the official `Final` row is joined back separately
       so the board shows the month result next to the weekly trend. */
    const agents = await this.ds.query(
      `WITH wk AS (
         SELECT i.person_no, mode() WITHIN GROUP (ORDER BY i.clean_name) name, mode() WITHIN GROUP (ORDER BY se.function_name) fn,
                mode() WITHIN GROUP (ORDER BY se.team_leader) tl, COUNT(*)::int weeks,
                ROUND(AVG(se.net_points),1) net,
                ROUND(AVG(se.quality_score),1) quality, ROUND(AVG(se.aht_score),1) aht, ROUND(AVG(se.fcr_score),1) fcr,
                ROUND(AVG(se.productivity_score),1) productivity, ROUND(AVG(se.ctr_score),1) ctr, ROUND(AVG(se.quiz_score),1) quiz,
                ROUND(AVG(se.prr_points),1) prr, ROUND(AVG(se.response_time_score),1) resptime, ROUND(AVG(se.mistakes_score),1) mistakes,
                ROUND(AVG(se.incidents_score),1) incidents, ROUND(AVG(se.attendance_score),1) attendance,
                ROUND(AVG(se.response_rate::numeric)*100,1) res, ${ACT}
           FROM scorecard_entries se JOIN employee_identity i ON i.tenant_id=se.tenant_id AND i.employee_no=se.employee_no
          WHERE ${w} AND ${WEEKS_ONLY} GROUP BY i.person_no
       ), fin AS (
         SELECT i.person_no, MAX(se.net_points) final_net, MAX(se.function_rank) rank
           FROM scorecard_entries se JOIN employee_identity i ON i.tenant_id=se.tenant_id AND i.employee_no=se.employee_no
          WHERE ${w} AND se.week_label = 'Final' GROUP BY i.person_no
       )
       SELECT wk.*, fin.final_net, fin.rank FROM wk LEFT JOIN fin USING (person_no)
        ORDER BY COALESCE(fin.final_net, wk.net) DESC NULLS LAST`, p);
    // "where short" — the KPI losing the most points vs its max (biggest gap)
    for (const a of agents) { let worst: any = null;
      for (const k of kpiMeta) { const v = a[k.key] == null ? null : Number(a[k.key]); if (v == null || !k.max) continue; const gap = Math.round((k.max - v) * 10) / 10; if (gap > 0 && (!worst || gap > worst.gap)) worst = { key: k.key, label: k.label, gap, score: v, max: k.max }; }
      a.weakest = worst; }
    const fnOpts = await this.ds.query(`SELECT DISTINCT function_name v FROM scorecard_entries WHERE tenant_id=$1 AND batch_id=$2 AND function_name IS NOT NULL ORDER BY 1`, [t, bid]);
    const tlOpts = await this.ds.query(`SELECT DISTINCT team_leader v FROM scorecard_entries WHERE tenant_id=$1 AND batch_id=$2 AND team_leader IS NOT NULL ORDER BY 1`, [t, bid]);
    /* Average over agents who HAVE a score. `Number(r.net || 0)` counted an agent
       with no score as a zero and dragged the centre average down. */
    const nets = agents.map((r: any) => (r.net == null ? null : Number(r.net))).filter((v: number | null): v is number => v != null);
    const avgNet = nets.length ? Math.round((nets.reduce((a: number, b: number) => a + b, 0) / nets.length) * 10) / 10 : null;
    return {
      period: batch.period_name,
      periodOptions: batches.map((b: any) => b.period_name),
      kpiMeta, agents, avgNet, count: agents.length,
      unscored: agents.length - nets.length,
      basis: 'Per-agent KPI columns = average of that agent\'s WEEKLY rows in this period; final_net/rank = the official Final row. Weeks and Final are never blended.',
      filterOptions: { functions: fnOpts.map((r: any) => r.v), teamLeaders: tlOpts.map((r: any) => r.v) },
    };
  }

  /** Agent Progress — month-over-month self-comparison: did this agent improve or
   *  decline? Merges roster KPIs (conformance/late/OT/absence) with official Net
   *  Points per month, computes deltas vs the prior month, and a verdict. */
  @Get('roster-v2/agent-progress')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Per-agent month-over-month progress + improving/declining verdict' })
  async agentProgress(@Req() req: any, @Query('person') person?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    if (!person) throw new BadRequestException('person is required');
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const ids = (await this.ds.query(`SELECT employee_no FROM employee_identity WHERE tenant_id=$1 AND person_no=$2`, [t, person])).map((r: any) => r.employee_no);
    const idList = ids.length ? ids : [person];
    const rosterM = await this.ds.query(`
      SELECT EXTRACT(YEAR FROM work_date)::int yr, EXTRACT(MONTH FROM work_date)::int mo, MIN(month_name) month_name,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conf,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
             COUNT(*) FILTER (WHERE ${CRED_EARLY})::int earlydays, COALESCE(SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY}),0)::int earlymin,
             COALESCE(SUM(${TRUE_OT}),0)::int otmin,
             COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE missing_punch)::int missingpunch, COUNT(*) FILTER (WHERE missing_system)::int missingsystem,
             COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions
        FROM roster_days WHERE tenant_id=$1 AND person_no=$2 AND work_date BETWEEN $3 AND $4
        GROUP BY 1,2 ORDER BY 1,2`, [t, person, dFrom, dTo]);
    const netM = await this.ds.query(`
      SELECT year yr, month mo, ROUND(AVG(${SC_MONTH_NET}::numeric),1) net
        FROM scorecard_monthly WHERE tenant_id=$1 AND employee_no = ANY($2)
          AND make_date(year,month,1) BETWEEN date_trunc('month',$3::date) AND $4::date
        GROUP BY year,month`, [t, idList, dFrom, dTo]);
    const netMap = new Map(netM.map((r: any) => [`${r.yr}-${r.mo}`, Number(r.net)]));
    const months = rosterM.map((r: any) => ({ yr: r.yr, mo: r.mo, label: `${r.month_name || r.mo} ${String(r.yr).slice(2)}`,
      worked: r.worked, conf: r.conf == null ? null : Number(r.conf), lateDays: r.latedays, lateMin: r.latemin,
      earlyDays: r.earlydays, earlyMin: r.earlymin, otMin: r.otmin, absent: r.absent, sick: r.sick,
      missingPunch: r.missingpunch, missingSystem: r.missingsystem, permissions: r.permissions,
      net: netMap.has(`${r.yr}-${r.mo}`) ? netMap.get(`${r.yr}-${r.mo}`) : null }));
    // deltas vs previous month — every customizable metric, so the UI can pick any column
    const DKEYS = ['conf', 'net', 'worked', 'lateDays', 'lateMin', 'earlyDays', 'earlyMin', 'otMin', 'absent', 'sick', 'missingPunch', 'missingSystem', 'permissions'];
    months.forEach((m: any, i: number) => { const p: any = i > 0 ? months[i - 1] : null;
      m.d = p ? Object.fromEntries(DKEYS.map((k) => [k, m[k] != null && p[k] != null ? Math.round((m[k] - p[k]) * 10) / 10 : null])) : null; });
    // verdict: first vs last non-null
    const firstLast = (key: string) => { const vals = months.filter((m: any) => m[key] != null); return vals.length >= 2 ? { first: vals[0][key], last: vals[vals.length - 1][key], change: Math.round((vals[vals.length - 1][key] - vals[0][key]) * 10) / 10 } : null; };
    const confV = firstLast('conf'), netV = firstLast('net');
    const dir = (c: number | null | undefined, th = 2) => c == null ? 'flat' : c > th ? 'up' : c < -th ? 'down' : 'flat';
    let overall = 'stable';
    const cd = confV ? dir(confV.change) : null, nd = netV ? dir(netV.change, 3) : null;
    if (cd === 'up' || nd === 'up') overall = (cd === 'down' || nd === 'down') ? 'mixed' : 'improving';
    if ((cd === 'down' || nd === 'down') && overall !== 'mixed' && overall !== 'improving') overall = 'declining';
    return { person, ids: idList, from: dFrom, to: dTo, months,
             verdict: { conformance: confV && { ...confV, dir: dir(confV.change) }, net: netV && { ...netV, dir: dir(netV.change, 3) }, overall } };
  }

  /** Agent Performance — joins the official monthly scorecard (Net Points), Ameyo
   *  productivity (AHT / occupancy / calls from talk+ACW) and FCR to the roster
   *  identity (alias-aware: old+new IDs). Complements the attendance/adherence score. */
  @Get('roster-v2/agent-performance')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Agent performance: official Net Points + AHT/occupancy + FCR joined to roster identity' })
  async agentPerformance(@Req() req: any, @Query('person') person?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    if (!person) throw new BadRequestException('person is required');
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    // every raw id this person has had (old intern + new full-time)
    const ids = (await this.ds.query(`SELECT employee_no FROM employee_identity WHERE tenant_id=$1 AND person_no=$2`, [t, person])).map((r: any) => r.employee_no);
    const idList = ids.length ? ids : [person];
    // official scorecard — monthly Net Points
    const scorecard = await this.ds.query(
      `SELECT year, month, ROUND(AVG(${SC_MONTH_NET}::numeric),1) net, ROUND(AVG(best_net::numeric),0) best, ROUND(AVG(worst_net::numeric),0) worst, SUM(weeks_scored)::int weeks
         FROM scorecard_monthly WHERE tenant_id=$1 AND employee_no = ANY($2) GROUP BY year, month ORDER BY year, month`, [t, idList]);
    // Ameyo productivity → AHT / occupancy / calls
    const [prod] = await this.ds.query(
      `SELECT COALESCE(SUM(talk_seconds),0)::bigint talk, COALESCE(SUM(acw_seconds),0)::bigint acw,
              COALESCE(SUM(staffed_seconds),0)::bigint staffed, COALESCE(SUM(ready_seconds),0)::bigint ready,
              COALESCE(SUM(wrapped_calls),0)::int calls, COALESCE(SUM(inbound_received),0)::int received,
              COUNT(DISTINCT work_date)::int days
         FROM agent_productivity_daily WHERE tenant_id=$1 AND employee_no = ANY($2) AND work_date BETWEEN $3 AND $4`, [t, idList, dFrom, dTo]);
    const handled = prod.calls > 0 ? prod.calls : prod.received;
    const ahtSec = handled > 0 ? Math.round((Number(prod.talk) + Number(prod.acw)) / handled) : null;
    const occupancy = Number(prod.staffed) > 0 ? Math.round(100 * (Number(prod.talk) + Number(prod.acw)) / Number(prod.staffed)) : null;
    const productivity = { ahtSec, occupancy, calls: handled, days: prod.days, talkH: Math.round(Number(prod.talk) / 360) / 10, acwH: Math.round(Number(prod.acw) / 360) / 10, staffedH: Math.round(Number(prod.staffed) / 360) / 10, hasData: prod.days > 0 };
    // FCR (best-effort match by employee id)
    const [fcr] = await this.ds.query(
      `SELECT ROUND(AVG(fcr_pct::numeric),1) pct, COALESCE(SUM(total),0)::int total FROM survey_fcr_monthly WHERE tenant_id=$1 AND employee_id = ANY($2)`, [t, idList]).catch(() => [{ pct: null, total: 0 }]);
    // detailed scorecard KPIs (per-week breakdown averaged) from scorecard_entries
    const [sc] = await this.ds.query(
      `SELECT COUNT(*)::int weeks, ROUND(AVG(net_points),1) net, ROUND(AVG(function_rank),1) rank,
              ROUND(AVG(quality_score),1) quality_s, ROUND(AVG(quality_actual::numeric),4) quality_a,
              ROUND(AVG(aht_score),1) aht_s, ROUND(AVG(aht_actual::numeric),4) aht_a,
              ROUND(AVG(fcr_score),1) fcr_s, ROUND(AVG(fcr_actual::numeric),4) fcr_a,
              ROUND(AVG(productivity_score),1) prod_s, ROUND(AVG(productivity_actual::numeric),4) prod_a,
              ROUND(AVG(ctr_score),1) ctr_s, ROUND(AVG(ctr_actual::numeric),4) ctr_a,
              ROUND(AVG(quiz_score),1) quiz_s, ROUND(AVG(quiz_actual::numeric),4) quiz_a,
              ROUND(AVG(prr_points),1) prr_s, ROUND(AVG(prr_rate::numeric),4) prr_a,
              ROUND(AVG(response_time_score),1) rt_s, ROUND(AVG(response_time_actual::numeric),5) rt_a,
              ROUND(AVG(mistakes_score),1) mist_s, ROUND(AVG(mistakes_actual::numeric),1) mist_a,
              ROUND(AVG(attendance_score),1) att_s, ROUND(AVG(working_days_pct::numeric),4) wd_a
         FROM scorecard_entries WHERE tenant_id=$1 AND employee_no = ANY($2)`, [t, idList]);
    // unit: pct (actual is a 0-1 fraction → ×100), min (minutes → m:ss), count.
    // AHT actual is already minutes; Response Time actual is an Excel day-fraction → ×1440 = minutes.
    const num = (v: any) => v == null ? null : Number(v);
    const kpiList = sc && sc.weeks > 0 ? [
      { key: 'quality', label: 'Quality', score: sc.quality_s, actual: num(sc.quality_a), unit: 'pct' },
      { key: 'aht', label: 'AHT', score: sc.aht_s, actual: num(sc.aht_a), unit: 'min' },
      { key: 'fcr', label: 'FCR', score: sc.fcr_s, actual: num(sc.fcr_a), unit: 'pct' },
      { key: 'productivity', label: 'Productivity', score: sc.prod_s, actual: num(sc.prod_a), unit: 'pct' },
      { key: 'ctr', label: 'CTR', score: sc.ctr_s, actual: num(sc.ctr_a), unit: 'pct' },
      { key: 'quiz', label: 'Quiz', score: sc.quiz_s, actual: num(sc.quiz_a), unit: 'pct' },
      { key: 'prr', label: 'PRR', score: sc.prr_s, actual: num(sc.prr_a), unit: 'pct' },
      { key: 'responseTime', label: 'Response Time', score: sc.rt_s, actual: sc.rt_a == null ? null : Math.round(Number(sc.rt_a) * 1440 * 100) / 100, unit: 'min' },
      { key: 'mistakes', label: 'Mistakes', score: sc.mist_s, actual: num(sc.mist_a), unit: 'count' },
      { key: 'attendance', label: 'Attendance', score: sc.att_s, actual: num(sc.wd_a), unit: 'pct' },
    ].filter(k => k.score != null) : [];
    const latest = scorecard.length ? scorecard[scorecard.length - 1] : null;
    return { person, ids: idList, from: dFrom, to: dTo,
             scorecard, latestNet: latest?.net ?? null, scorecardMonths: scorecard.length,
             scorecardDetail: sc && sc.weeks > 0 ? { weeks: sc.weeks, net: sc.net, rank: sc.rank, kpis: kpiList } : null,
             productivity, fcr: { pct: fcr?.pct ?? null, total: fcr?.total ?? 0 } };
  }

  /** Agent Period Compare — "compare the agent to himself" across two ARBITRARY
   *  periods A and B (e.g. last month vs the prior 3 months). The periods may be
   *  different lengths, so every compared metric is a RATE or an AVERAGE
   *  (length-independent) — never a raw count, which would just track period length.
   *  Returns both snapshots, per-metric deltas with an improved/declined/flat trend,
   *  and an overall verdict the TL can read out to the agent. Alias-aware. */
  @Get('roster-v2/agent-period-compare')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Self-comparison across two arbitrary periods (improvement/decline verdict)' })
  async agentPeriodCompare(@Req() req: any, @Query('person') person?: string,
    @Query('aFrom') aFrom?: string, @Query('aTo') aTo?: string, @Query('bFrom') bFrom?: string, @Query('bTo') bTo?: string) {
    const t = req.user.tenantId;
    if (!person) throw new BadRequestException('person is required');
    if (!aFrom || !aTo || !bFrom || !bTo) throw new BadRequestException('aFrom, aTo, bFrom, bTo are all required');
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
    if (![aFrom, aTo, bFrom, bTo].every(isDate)) throw new BadRequestException('dates must be YYYY-MM-DD');
    if (aFrom > aTo) throw new BadRequestException('aFrom must be on or before aTo');
    if (bFrom > bTo) throw new BadRequestException('bFrom must be on or before bTo');
    const [emp] = await this.ds.query(
      `SELECT person_no, clean_name, function_name, role_category, team_leader, is_active
         FROM employee_identity WHERE tenant_id=$1 AND is_canonical AND (person_no=$2 OR lower(clean_name) LIKE lower($3)) ORDER BY (person_no=$2) DESC LIMIT 1`,
      [t, person, `%${person}%`]);
    if (!emp) throw new BadRequestException('No such agent');
    const pn = emp.person_no;
    const ids = (await this.ds.query(`SELECT employee_no FROM employee_identity WHERE tenant_id=$1 AND person_no=$2`, [t, pn])).map((r: any) => r.employee_no);
    const idList = ids.length ? ids : [pn];

    // one period snapshot → raw aggregates + length-independent rates/averages
    const snap = async (f: string, to: string) => {
      const [a] = await this.ds.query(`
        SELECT COUNT(*)::int "scheduledDays",
               COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int "workedDays",
               COUNT(*) FILTER (WHERE presence='sick')::int "sickDays",
               COUNT(*) FILTER (WHERE presence='absent')::int "absenceDays",
               COUNT(*) FILTER (WHERE ${CRED_LATE})::int "lateDays", COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int "totalLateMin",
               COUNT(*) FILTER (WHERE ${CRED_EARLY})::int "earlyDays", COALESCE(SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY}),0)::int "totalEarlyMin",
               COALESCE(SUM(${TRUE_OT}),0)::int "otTotal",
               COUNT(*) FILTER (WHERE missing_punch)::int "missingPunch", COUNT(*) FILTER (WHERE missing_system)::int "missingSystem",
               COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
               ROUND(AVG(adherence_pct),1) conformance
          FROM roster_days WHERE tenant_id=$1 AND person_no=$2 AND work_date BETWEEN $3 AND $4`, [t, pn, f, to]);
      const [net] = await this.ds.query(`
        SELECT ROUND(AVG(${SC_MONTH_NET}::numeric),1) net, COUNT(*)::int months
          FROM scorecard_monthly WHERE tenant_id=$1 AND employee_no = ANY($2)
            AND make_date(year,month,1) BETWEEN date_trunc('month',$3::date) AND $4::date`, [t, idList, f, to]);
      const [prod] = await this.ds.query(`
        SELECT COALESCE(SUM(talk_seconds),0)::bigint talk, COALESCE(SUM(acw_seconds),0)::bigint acw,
               COALESCE(SUM(staffed_seconds),0)::bigint staffed, COALESCE(SUM(wrapped_calls),0)::int calls,
               COALESCE(SUM(inbound_received),0)::int received, COUNT(DISTINCT work_date)::int days
          FROM agent_productivity_daily WHERE tenant_id=$1 AND employee_no = ANY($2) AND work_date BETWEEN $3 AND $4`, [t, idList, f, to]);
      const handled = prod.calls > 0 ? prod.calls : prod.received;
      const ahtSec = handled > 0 ? Math.round((Number(prod.talk) + Number(prod.acw)) / handled) : null;
      const occupancy = Number(prod.staffed) > 0 ? Math.round(100 * (Number(prod.talk) + Number(prod.acw)) / Number(prod.staffed)) : null;
      const [fcr] = await this.ds.query(`
        SELECT ROUND(AVG(fcr_pct::numeric),1) pct, COALESCE(SUM(total),0)::int total FROM survey_fcr_monthly
          WHERE tenant_id=$1 AND employee_id IN (SELECT id FROM employees WHERE tenant_id=$1 AND employee_no = ANY($2))
            AND year_month BETWEEN date_trunc('month',$3::date) AND $4::date`, [t, idList, f, to]).catch(() => [{ pct: null, total: 0 }]);
      const sched = a.scheduledDays || 0, worked = a.workedDays || 0;
      const rate = (n: number, d: number) => d > 0 ? Math.round(1000 * n / d) / 10 : null;
      return { from: f, to, lengthDays: Math.round((Date.parse(to) - Date.parse(f)) / 86400000) + 1,
        scheduledDays: sched, workedDays: worked, otTotal: a.otTotal, permissions: a.permissions,
        absenceDays: a.absenceDays, sickDays: a.sickDays, lateDays: a.lateDays, calls: handled, prodDays: prod.days, netMonths: net.months,
        // length-independent comparison metrics:
        conformance: a.conformance == null ? null : Number(a.conformance),
        lateRate: rate(a.lateDays, sched), lateMinPerDay: sched > 0 ? Math.round(10 * a.totalLateMin / sched) / 10 : null,
        earlyRate: rate(a.earlyDays, sched), absenceRate: rate(a.absenceDays, sched), sickRate: rate(a.sickDays, sched),
        missingPunchRate: rate(a.missingPunch, worked), missingSystemRate: rate(a.missingSystem, worked),
        otPerDay: worked > 0 ? Math.round(10 * a.otTotal / worked) / 10 : null,
        netPoints: net.net == null ? null : Number(net.net), ahtSec, occupancy, fcr: fcr?.pct == null ? null : Number(fcr.pct) };
    };

    const [A, B] = await Promise.all([snap(aFrom, aTo), snap(bFrom, bTo)]);
    // metric catalogue — up=true means higher is better. flat = threshold below which a change is "no real change".
    // up=true → higher is better; up=false → lower is better; up=null → context only
    // (shown for awareness but NOT judged as improved/declined — e.g. sickness isn't a
    // coachable performance failing, and OT volume is a workload signal, not a verdict).
    const M: { key: string; label: string; labelAr: string; unit: string; up: boolean | null; flat: number }[] = [
      { key: 'conformance', label: 'Conformance', labelAr: 'الكونفورمانس', unit: 'pct', up: true, flat: 1 },
      { key: 'netPoints', label: 'Net Points', labelAr: 'Net Points', unit: 'pts', up: true, flat: 1 },
      { key: 'lateRate', label: 'Late-day rate', labelAr: 'نسبة أيام التأخير', unit: 'pct', up: false, flat: 1 },
      { key: 'lateMinPerDay', label: 'Late min / day', labelAr: 'دقائق التأخير/يوم', unit: 'min', up: false, flat: 0.5 },
      { key: 'earlyRate', label: 'Early-out rate', labelAr: 'نسبة الخروج المبكر', unit: 'pct', up: false, flat: 1 },
      { key: 'absenceRate', label: 'Absence rate', labelAr: 'نسبة الغياب', unit: 'pct', up: false, flat: 1 },
      { key: 'missingPunchRate', label: 'Missing-punch rate', labelAr: 'نسبة البصمة الناقصة', unit: 'pct', up: false, flat: 1 },
      { key: 'missingSystemRate', label: 'Missing-system rate', labelAr: 'نسبة السيستم الناقص', unit: 'pct', up: false, flat: 1 },
      { key: 'ahtSec', label: 'AHT', labelAr: 'متوسط المعالجة (AHT)', unit: 'sec', up: false, flat: 3 },
      { key: 'occupancy', label: 'Occupancy', labelAr: 'الإشغال', unit: 'pct', up: true, flat: 1 },
      { key: 'fcr', label: 'FCR', labelAr: 'FCR', unit: 'pct', up: true, flat: 1 },
      { key: 'sickRate', label: 'Sick-day rate', labelAr: 'نسبة أيام المرض', unit: 'pct', up: null, flat: 1 },
      { key: 'otPerDay', label: 'OT min / worked day', labelAr: 'دقائق OT/يوم عمل', unit: 'min', up: null, flat: 1 },
    ];
    let improved = 0, declined = 0;
    const metrics = M.map((m) => { const av = (A as any)[m.key], bv = (B as any)[m.key];
      const delta = (av != null && bv != null) ? Math.round((av - bv) * 10) / 10 : null;
      let trend: 'improved' | 'declined' | 'flat' | 'context' | 'na' = 'na';
      if (delta != null) {
        if (m.up === null) trend = 'context';                       // displayed, not judged
        else if (Math.abs(delta) < m.flat) trend = 'flat';
        else { const good = m.up ? delta > 0 : delta < 0; trend = good ? 'improved' : 'declined'; if (good) improved++; else declined++; }
      }
      return { key: m.key, label: m.label, labelAr: m.labelAr, unit: m.unit, goodWhenUp: m.up, context: m.up === null, a: av ?? null, b: bv ?? null, delta, trend };
    });
    const overall = improved > 0 && declined > 0 ? 'mixed' : improved > 0 ? 'improving' : declined > 0 ? 'declining' : 'stable';
    return { person: pn, employee: emp, a: A, b: B, metrics,
      verdict: { improvements: metrics.filter((x) => x.trend === 'improved'), declines: metrics.filter((x) => x.trend === 'declined'), improved, declined, overall } };
  }


  /** Executive Summary export — ONE management-ready Excel combining the headline
   *  KPIs, prioritized insights, the score leaderboard, monthly trends and a
   *  by-function summary. Reuses the insights/score/trend engines. */
  @Get('roster-v2/executive-export')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Executive Summary Excel — KPIs + Insights + Leaderboard + Trends + by-function' })
  async executiveExport(@Req() req: any, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0, 7)}-01` : range?.a), dTo = to || range?.b;
    // reuse the engines
    const [ins, scores, trend] = await Promise.all([
      this.insights(req, dFrom, dTo), this.agentScores(req, dFrom, dTo), this.trends(req, dFrom, dTo, undefined, undefined, 'month'),
    ]);
    const [kpi] = await this.ds.query(`
      SELECT COUNT(DISTINCT person_no)::int agents, COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             COUNT(*) FILTER (WHERE presence='off')::int off, COUNT(*) FILTER (WHERE presence='sick')::int sick,
             COUNT(*) FILTER (WHERE presence='absent')::int absent, COUNT(*) FILTER (WHERE presence='leave')::int leave,
             COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays, COALESCE(SUM(sys_late_min) FILTER (WHERE ${CRED_LATE}),0)::int latemin,
             COALESCE(SUM(${TRUE_OT}),0)::int otmin, COUNT(*) FILTER (WHERE permission_type IS NOT NULL)::int permissions,
             ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conformance
        FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`, [t, dFrom, dTo]);
    const byFn = await this.ds.query(`
      SELECT canon_fn(role_function) fn, COUNT(DISTINCT person_no)::int agents, COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
             ROUND(AVG(adherence_pct) FILTER (WHERE include_tardiness),1) conformance, COUNT(*) FILTER (WHERE ${CRED_LATE})::int latedays,
             COALESCE(SUM(${TRUE_OT}),0)::int otmin, COUNT(*) FILTER (WHERE presence='sick')::int sick, COUNT(*) FILTER (WHERE presence='absent')::int absent
        FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND role_function IS NOT NULL
        GROUP BY canon_fn(role_function) ORDER BY agents DESC`, [t, dFrom, dTo]);

    const wb = new ExcelJS.Workbook(); wb.creator = 'WFM System';
    const hrs = (m: number) => Math.round((m || 0) / 60);
    const sheet = (name: string, cols: any[], rows: any[], color = 'FF4F46E5') => {
      const ws = wb.addWorksheet(name); ws.columns = cols.map((c: any) => ({ ...c, width: c.width || 18 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      ws.views = [{ state: 'frozen', ySplit: 1 }]; rows.forEach(r => ws.addRow(r)); return ws;
    };

    // 1) Executive Summary cover
    const cover = wb.addWorksheet('Executive Summary');
    cover.columns = [{ width: 30 }, { width: 22 }, { width: 22 }, { width: 22 }];
    cover.mergeCells('A1:D1'); cover.getCell('A1').value = `WFM Executive Summary — ${dFrom} → ${dTo}`;
    cover.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } }; cover.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    cover.addRow([]);
    const kv = (k: string, v: any) => { const r = cover.addRow([k, v]); r.getCell(1).font = { bold: true, color: { argb: 'FF94A3B8' } }; };
    cover.addRow(['HEADLINE KPIs']).getCell(1).font = { bold: true, size: 12 };
    kv('Active agents', kpi.agents); kv('Conformance %', kpi.conformance); kv('Worked days', kpi.worked);
    kv('Late days', `${kpi.latedays} (${hrs(kpi.latemin)}h)`); kv('Overtime (hrs)', hrs(kpi.otmin));
    kv('Sick days', kpi.sick); kv('Absence days', kpi.absent); kv('Permissions', kpi.permissions);
    cover.addRow([]);
    cover.addRow(['SCORE OVERVIEW']).getCell(1).font = { bold: true, size: 12 };
    kv('Average score', scores.average); kv('Grade A / B / C / D', `${scores.distribution.A} / ${scores.distribution.B} / ${scores.distribution.C} / ${scores.distribution.D}`);
    const top = scores.agents.slice(0, 3).map((a: any) => `${a.name} (${a.score})`).join(', ');
    const bot = scores.agents.slice(-3).map((a: any) => `${a.name} (${a.score})`).join(', ');
    kv('Top performers', top); kv('Needs attention', bot);
    cover.addRow([]);
    cover.addRow(['KEY INSIGHTS']).getCell(1).font = { bold: true, size: 12 };
    for (const i of ins.insights.slice(0, 8)) { const r = cover.addRow([`[${i.severity.toUpperCase()}] ${i.title}`, i.detail]); r.getCell(1).font = { color: { argb: i.severity === 'critical' ? 'FFDC2626' : i.severity === 'warning' ? 'FFD97706' : 'FF0EA5E9' } }; }

    // 2) Insights, 3) Leaderboard, 4) Trends, 5) By function
    sheet('Insights', [{ header: 'Severity', key: 'severity' }, { header: 'Title', key: 'title', width: 50 }, { header: 'Detail', key: 'detail', width: 60 }], ins.insights, 'FF7C3AED');
    sheet('Leaderboard', [
      { header: 'Rank', key: 'rank', width: 6 }, { header: 'Agent', key: 'name', width: 24 }, { header: 'Role', key: 'role' }, { header: 'Team Leader', key: 'tl', width: 18 },
      { header: 'Score', key: 'score', width: 8 }, { header: 'Grade', key: 'grade', width: 7 }, { header: 'Conf %', key: 'conf' }, { header: 'Worked', key: 'worked' },
      { header: 'Late days', key: 'lateDays' }, { header: 'Absent', key: 'absent' }, { header: 'Sick', key: 'sick' },
    ], scores.agents, 'FFF59E0B');
    sheet('Trends (Monthly)', [
      { header: 'Period', key: 'label' }, { header: 'From', key: 'start' }, { header: 'Agents', key: 'agents' }, { header: 'Worked', key: 'worked' },
      { header: 'Conformance %', key: 'conf' }, { header: 'Late days', key: 'latedays' }, { header: 'Late (min)', key: 'latemin' },
      { header: 'OT (hrs)', key: 'othrs' }, { header: 'Sick', key: 'sick' }, { header: 'Absent', key: 'absent' },
    ], trend.points.map((p: any) => ({ ...p, othrs: hrs(p.otmin) })), 'FF059669');
    sheet('By Function', [
      { header: 'Function', key: 'fn', width: 22 }, { header: 'Agents', key: 'agents' }, { header: 'Worked', key: 'worked' }, { header: 'Conformance %', key: 'conformance' },
      { header: 'Late days', key: 'latedays' }, { header: 'OT (hrs)', key: 'othrs' }, { header: 'Sick', key: 'sick' }, { header: 'Absent', key: 'absent' },
    ], byFn.map((r: any) => ({ ...r, othrs: hrs(r.otmin) })), 'FF0EA5E9');

    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="WFM_Executive_${dFrom}_${dTo}.xlsx"` });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }
}
