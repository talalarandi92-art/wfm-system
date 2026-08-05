import { BadRequestException, Body, Controller, Get, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { shiftCategoryCaseSql } from '@common/shift-category';

/* Shift-fairness endpoints, split VERBATIM out of the monolithic ReconController
 * (2026-07-07, EXECUTION_BRIEF Phase-4). Same route prefix — zero route renames. */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class RosterFairnessController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}
  /** Shift FAIRNESS over the canonical roster (roster_days): per-person morning/
   *  evening/night/midnight load + weekend-OFF fairness, with an optional dedicated
   *  NIGHT TEAM carve-out (the user's choice — fixed team vs fair distribution), and a
   *  rebalance proposal for the fair-rotation pool (female-midnight aware). Source =
   *  the uploaded schedule (roster_days), deduped by person_no via is_active. */
  @Get('roster-v2/fairness')
  @RequirePermissions('attendance.view_team')
  async fairness(
    @Req() req: any, @Query('from') from?: string, @Query('to') to?: string,
    @Query('function') functionName?: string, @Query('teamLeader') teamLeader?: string,
  ) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo];
    let w = `r.tenant_id=$1 AND r.work_date BETWEEN $2 AND $3 AND r.is_active`;
    const add = (cond: string, val: any) => { p.push(val); return cond.replace('$$', `$${p.length}`); };
    if (functionName) w += ` AND ${add('canon_fn(r.role_function)=canon_fn($$)', functionName)}`;
    if (teamLeader)   w += ` AND ${add('r.team_manager=$$', teamLeader)}`;

    // THE ONE canonical shift-category mapping (rules §3, common/shift-category.ts) —
    // was a local CASE that mis-bucketed C into evening (canonical: morning/day).
    const catExpr = shiftCategoryCaseSql('shift_category,shift_code');
    const work = `r.presence IN ('office','wfh')`;
    const rows: any[] = await this.ds.query(`
      WITH r AS (SELECT *, ${catExpr} cat FROM roster_days)
      SELECT r.person_no, MAX(r.clean_name) name, MAX(r.role_function) fn, MAX(r.gender) gender,
             COUNT(*) FILTER (WHERE ${work})::int wd,
             COUNT(*) FILTER (WHERE ${work} AND cat='morning')::int morning,
             COUNT(*) FILTER (WHERE ${work} AND cat='evening')::int evening,
             COUNT(*) FILTER (WHERE ${work} AND cat='night')::int night,
             COUNT(*) FILTER (WHERE ${work} AND cat='midnight')::int midnight,
             COUNT(*) FILTER (WHERE r.presence='off')::int off_days,
             COUNT(*) FILTER (WHERE r.presence='off' AND EXTRACT(DOW FROM r.work_date) IN (4,5,6))::int weekend_off,
             COUNT(*) FILTER (WHERE r.presence='off' AND EXTRACT(DOW FROM r.work_date) NOT IN (4,5,6))::int weekday_off,
             (nt.person_no IS NOT NULL) night_team
        FROM r LEFT JOIN fairness_night_team nt ON nt.tenant_id=$1 AND nt.person_no=r.person_no
       WHERE ${w}
       GROUP BY r.person_no, nt.person_no
      HAVING COUNT(*) FILTER (WHERE ${work}) >= 1`, p);

    const mean = (a: number[]) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
    const sdev = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
    // currently-employed persons (employee_identity.is_active = any employee row active) — used to
    // keep the FORWARD rebalance proposal to schedulable staff while the report keeps full history.
    const activeNow = new Set((await this.ds.query(`SELECT person_no FROM employee_identity WHERE tenant_id=$1 AND is_active`, [t])).map((x: any) => x.person_no));
    // total weekend (THU/FRI/SAT — Director's ruling 2026-08-05) dates in the window — the denominator for "what share of
    // available weekends did this person actually get off".
    const totalWeekendDays = Number((await this.ds.query(
      `SELECT COUNT(DISTINCT work_date)::int n FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND EXTRACT(DOW FROM work_date) IN (4,5,6)`, [t, dFrom, dTo]))[0]?.n || 0);
    const agents = rows.map(r => {
      const wd = r.wd || 1, nm = r.night + r.midnight, off = r.off_days || 0;
      // dominant shift category + how "stuck" on it (never rotates) — rotation health
      const cats: [string, number][] = [['morning', r.morning], ['evening', r.evening], ['night', r.night], ['midnight', r.midnight]];
      const dom = cats.reduce((a, b) => b[1] > a[1] ? b : a, ['none', 0] as [string, number]);
      const distinctCats = cats.filter(c => c[1] > 0).length;
      return {
        personNo: r.person_no, name: r.name, fn: r.fn, gender: r.gender, nightTeam: r.night_team,
        currentlyActive: activeNow.has(r.person_no),
        workedDays: r.wd, morning: r.morning, evening: r.evening, night: r.night, midnight: r.midnight,
        // shift mix (% of working days) — for the per-person distribution / heatmap bar
        morningPct: Math.round(100 * r.morning / wd), eveningPct: Math.round(100 * r.evening / wd),
        nightPct: Math.round(100 * r.night / wd), midOnlyPct: Math.round(100 * r.midnight / wd),
        // rotation health: which category dominates, by how much, and how many categories they touch
        dominantCat: dom[0], dominantPct: Math.round(100 * dom[1] / wd), distinctCats,
        nightMidPct: Math.round(100 * nm / wd), midnightPct: Math.round(100 * r.midnight / wd),
        // OFF distribution: weekday vs weekend split + share of all weekends in the period
        off, weekdayOff: r.weekday_off, weekendOff: r.weekend_off,
        weekdayOffPct: off ? Math.round(100 * r.weekday_off / off) : 0,
        weekendOffPct: off ? Math.round(100 * r.weekend_off / off) : 0,
        weekendOffShare: totalWeekendDays ? Math.round(100 * r.weekend_off / totalWeekendDays) : 0,
      };
    }).sort((a, b) => b.nightMidPct - a.nightMidPct);

    const fairPool = agents.filter(a => !a.nightTeam);
    const team = agents.filter(a => a.nightTeam);
    const poolPcts = fairPool.map(a => a.nightMidPct);
    const poolAvg = Math.round(mean(poolPcts) * 10) / 10;
    const sd = sdev(poolPcts);
    const woff = agents.map(a => a.weekendOff);
    const woffSd = sdev(woff);

    // The rebalance proposal is FORWARD-looking → only currently-employed people
    // (a leaver's historical load stays in the report, but we won't propose re-balancing them).
    const withDelta = fairPool.filter(a => a.currentlyActive).map(a => ({ ...a, delta: Math.round(a.nightMidPct - poolAvg) }));
    const reduceNights = withDelta.filter(a => a.delta >= 15).sort((a, b) => b.delta - a.delta).slice(0, 10)
      .map(a => ({ name: a.name, fn: a.fn, nightMidPct: a.nightMidPct, midnight: a.midnight, over: a.delta }));
    const addNights = withDelta.filter(a => a.delta <= -15).sort((a, b) => a.delta - b.delta).slice(0, 10)
      .map(a => ({ name: a.name, fn: a.fn, gender: a.gender, nightMidPct: a.nightMidPct, under: -a.delta, canMidnight: String(a.gender || '').toLowerCase().startsWith('m') }));
    const weekendOffDeprived = agents.filter(a => a.off > 0 && activeNow.has(a.personNo)).sort((a, b) => a.weekendOff - b.weekendOff).slice(0, 8)
      .map(a => ({ name: a.name, fn: a.fn, weekendOff: a.weekendOff, off: a.off, weekendOffPct: a.weekendOffPct, weekendOffShare: a.weekendOffShare }));

    // OFF distribution — weekday vs weekend split per current person, most weekend-deprived first.
    const poolWeekendShares = fairPool.filter(a => a.currentlyActive).map(a => a.weekendOffShare);
    const weekendShareAvg = Math.round(mean(poolWeekendShares) * 10) / 10;
    const offDistribution = agents.filter(a => a.currentlyActive && a.off > 0)
      .sort((a, b) => a.weekendOffShare - b.weekendOffShare)
      .map(a => ({ name: a.name, fn: a.fn, nightTeam: a.nightTeam, off: a.off, weekdayOff: a.weekdayOff, weekendOff: a.weekendOff, weekdayOffPct: a.weekdayOffPct, weekendOffPct: a.weekendOffPct, weekendOffShare: a.weekendOffShare }));

    // JUSTICE INDEX — who deserves relief in the NEXT schedule: carrying MORE night/mid than the fair
    // average AND getting FEWER weekends off than average. Higher debt = compensate first.
    const justice = fairPool.filter(a => a.currentlyActive).map(a => {
      const nightExcess = Math.max(0, a.nightMidPct - poolAvg);
      const weekendDeficit = Math.max(0, weekendShareAvg - a.weekendOffShare);
      return { name: a.name, fn: a.fn, nightMidPct: a.nightMidPct, weekendOffShare: a.weekendOffShare, nightExcess: Math.round(nightExcess), weekendDeficit: Math.round(weekendDeficit), debt: Math.round(nightExcess + weekendDeficit) };
    }).filter(a => a.debt > 0).sort((a, b) => b.debt - a.debt).slice(0, 12);

    // ROTATION HEALTH — fair-pool current staff stuck ≥80% on ONE shift category (rarely rotate).
    const stuckOnOneShift = fairPool.filter(a => a.currentlyActive && a.dominantPct >= 80)
      .sort((a, b) => b.dominantPct - a.dominantPct)
      .map(a => ({ name: a.name, fn: a.fn, dominantCat: a.dominantCat, dominantPct: a.dominantPct, distinctCats: a.distinctCats, workedDays: a.workedDays }));

    // REBALANCE PLAN — concrete "apply" suggestion: pair the most over-loaded with the most under-loaded
    // (night/mid), female-aware (females take NIGHT only), and pair weekend-deprived with weekend-rich.
    const over = fairPool.filter(a => a.currentlyActive && a.nightMidPct - poolAvg >= 15).sort((a, b) => b.nightMidPct - a.nightMidPct);
    const under = fairPool.filter(a => a.currentlyActive && poolAvg - a.nightMidPct >= 15).sort((a, b) => a.nightMidPct - b.nightMidPct);
    const nightMoves = Array.from({ length: Math.min(over.length, under.length, 8) }, (_, i) => {
      const o = over[i], u = under[i];
      const female = !String(u.gender || '').toLowerCase().startsWith('m');
      // suggested # of night/mid days to shift = half the gap between them, in working-day terms
      const shifts = Math.max(1, Math.round((o.nightMidPct - u.nightMidPct) / 100 * Math.min(o.workedDays, u.workedDays) / 2));
      return { fromName: o.name, fromFn: o.fn, fromPct: o.nightMidPct, toName: u.name, toFn: u.fn, toPct: u.nightMidPct, take: female ? 'night-only' : 'night/midnight', shifts };
    });
    const wkRich = fairPool.filter(a => a.currentlyActive && a.weekendOffShare > weekendShareAvg).sort((a, b) => b.weekendOffShare - a.weekendOffShare);
    const weekendMoves = weekendOffDeprived.slice(0, 6).map((dep: any, i: number) => ({
      giveName: dep.name, giveFn: dep.fn, giveShare: dep.weekendOffShare,
      fromName: wkRich[i]?.name || null, fromShare: wkRich[i]?.weekendOffShare ?? null,
    })).filter((m: any) => m.fromName);
    const rebalancePlan = { nightMoves, weekendMoves };

    return {
      from: dFrom, to: dTo,
      summary: {
        activeAgents: agents.length, nightTeamCount: team.length, fairPoolCount: fairPool.length,
        fairPoolAvgNightMidPct: poolAvg, nightMidStdev: Math.round(sd * 10) / 10,
        fairnessScore: Math.max(0, Math.round(100 - sd)),               // lower spread = fairer
        weekendOffAvg: Math.round(mean(woff) * 10) / 10,
        weekendOffMin: woff.length ? Math.min(...woff) : 0, weekendOffMax: woff.length ? Math.max(...woff) : 0,
        weekendFairnessScore: Math.max(0, Math.round(100 - woffSd * 3)),
        totalWeekendDays, weekendShareAvg,                              // weekend-OFF share denominators
      },
      agents, nightTeam: team,
      proposal: { poolAvgNightMidPct: poolAvg, weekendShareAvg, reduceNights, addNights, weekendOffDeprived },
      offDistribution, justice, stuckOnOneShift, rebalancePlan,
    };
  }

  /** List the designated night-team members. */
  @Get('roster-v2/fairness/night-team')
  @RequirePermissions('attendance.view_team')
  async fairnessNightTeamList(@Req() req: any) {
    const rows = await this.ds.query(`SELECT person_no, clean_name FROM fairness_night_team WHERE tenant_id=$1 ORDER BY clean_name`, [req.user.tenantId]);
    return { members: rows };
  }

  /** Add/remove a person from the night team (the user's choice: fixed team vs fair pool). */
  @Put('roster-v2/fairness/night-team')
  @RequirePermissions('attendance.view_team')
  async fairnessNightTeamSet(@Req() req: any, @Body() body: { personNo: string; name?: string; member: boolean }) {
    const t = req.user.tenantId;
    if (!body?.personNo) throw new BadRequestException('personNo required');
    if (body.member)
      await this.ds.query(`INSERT INTO fairness_night_team(tenant_id,person_no,clean_name) VALUES($1,$2,$3)
        ON CONFLICT (tenant_id,person_no) DO UPDATE SET clean_name=EXCLUDED.clean_name`, [t, body.personNo, body.name || null]);
    else
      await this.ds.query(`DELETE FROM fairness_night_team WHERE tenant_id=$1 AND person_no=$2`, [t, body.personNo]);
    return { ok: true };
  }

  /** Excel export of the full shift-fairness picture (reuses the fairness() compute):
   *  per-agent load+mix+OFF split, relief priority, stuck-on-one-shift, night team. */
  @Get('roster-v2/fairness/export')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'Shift Fairness → multi-sheet Excel (load/mix/OFF split + relief + stuck + night team)' })
  async fairnessExport(
    @Req() req: any, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string,
    @Query('function') functionName?: string, @Query('teamLeader') teamLeader?: string,
  ) {
    const d: any = await this.fairness(req, from, to, functionName, teamLeader);
    const wb = new ExcelJS.Workbook(); wb.creator = 'WFM System';
    const sheet = (name: string, cols: { header: string; key: string; width?: number }[], rows: any[], color = 'FF6366F1') => {
      const ws = wb.addWorksheet(name); ws.columns = cols.map(c => ({ ...c, width: c.width || 14 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
      ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
      rows.forEach(r => ws.addRow(r));
    };
    sheet('Shift_Fairness', [
      { header: 'Employee', key: 'name', width: 24 }, { header: 'Function', key: 'fn', width: 20 },
      { header: 'Active', key: 'currentlyActive', width: 8 }, { header: 'Night Team', key: 'nightTeam', width: 10 },
      { header: 'Worked', key: 'workedDays', width: 8 }, { header: 'Morning%', key: 'morningPct' }, { header: 'Evening%', key: 'eveningPct' },
      { header: 'Night%', key: 'nightPct' }, { header: 'Midnight%', key: 'midOnlyPct' }, { header: 'Night+Mid%', key: 'nightMidPct' },
      { header: 'Dominant', key: 'dominantCat' }, { header: 'Dominant%', key: 'dominantPct' }, { header: '#Cats', key: 'distinctCats' },
      { header: 'OFF', key: 'off' }, { header: 'Weekday OFF', key: 'weekdayOff' }, { header: 'Weekend OFF', key: 'weekendOff' },
      { header: 'Weekday OFF%', key: 'weekdayOffPct' }, { header: 'Weekend OFF%', key: 'weekendOffPct' }, { header: 'Weekend Share%', key: 'weekendOffShare' },
    ], d.agents);
    sheet('Relief_Priority', [
      { header: 'Rank', key: 'rank', width: 6 }, { header: 'Employee', key: 'name', width: 24 }, { header: 'Function', key: 'fn', width: 20 },
      { header: 'Night+Mid%', key: 'nightMidPct' }, { header: 'Weekend Share%', key: 'weekendOffShare' },
      { header: 'Night Excess', key: 'nightExcess' }, { header: 'Weekend Deficit', key: 'weekendDeficit' }, { header: 'Debt', key: 'debt' },
    ], d.justice.map((r: any, i: number) => ({ ...r, rank: i + 1 })), 'FFA78BFA');
    sheet('Stuck_On_One_Shift', [
      { header: 'Employee', key: 'name', width: 24 }, { header: 'Function', key: 'fn', width: 20 },
      { header: 'Stuck On', key: 'dominantCat', width: 12 }, { header: 'Share%', key: 'dominantPct' }, { header: '#Cats', key: 'distinctCats' }, { header: 'Worked', key: 'workedDays' },
    ], d.stuckOnOneShift, 'FFF59E0B');
    sheet('Night_Team', [
      { header: 'Employee', key: 'name', width: 24 }, { header: 'Function', key: 'fn', width: 20 }, { header: 'Night+Mid%', key: 'nightMidPct' }, { header: 'Midnight days', key: 'midnight' },
    ], d.nightTeam, 'FF0EA5E9');
    sheet('Summary', [{ header: 'Metric', key: 'k', width: 32 }, { header: 'Value', key: 'v', width: 18 }],
      Object.entries(d.summary).map(([k, v]) => ({ k, v })), 'FF22C55E');

    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="Shift_Fairness_${d.from}_${d.to}.xlsx"` });
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }
}
