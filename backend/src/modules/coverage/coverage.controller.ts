import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

/**
 * Per-function hourly coverage for a date.
 * Required vs Scheduled vs Available vs Gap, hour by hour, per function — where
 * Available reflects the live erosion from sick / absence / permission, plus OT.
 * Required is derived from the same-weekday history (no forecast table populated).
 */
@ApiTags('Coverage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@RequirePermissions('hc.view')   // WFM coverage planning — not an agent self-view
@Controller({ path: 'coverage', version: '1' })
export class CoverageController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // Which hours [0..23] does a shift ss→se cover (handles cross-midnight)?
  private hoursCovered(ss?: string | null, se?: string | null): number[] {
    if (!ss || !se) return [];
    const a = parseInt(String(ss).slice(0, 2), 10);
    let b = parseInt(String(se).slice(0, 2), 10);
    if (isNaN(a) || isNaN(b)) return [];
    const out: number[] = [];
    if (b > a) { for (let h = a; h < b; h++) out.push(h); }
    else if (b === a) { out.push(a); }
    else { for (let h = a; h < 24; h++) out.push(h); for (let h = 0; h < b; h++) out.push(h); }
    return out;
  }

  @Get('hourly')
  @ApiOperation({ summary: 'Per-function hourly coverage (required/scheduled/available/gap) for a date' })
  async hourly(
    @CurrentUser() user: any,
    @Query('date') dateQ?: string,
    @Query('functionId') functionId?: string,
  ) {
    const tid = user.tenantId;
    const [ld] = await this.ds.query(
      `SELECT MAX(attendance_date)::text AS d FROM attendance_records WHERE tenant_id = $1`, [tid],
    ).catch(() => [{ d: null }]);
    const date = dateQ ?? ld?.d ?? new Date().toISOString().slice(0, 10);

    const fnFilter = functionId ? 'AND e.function_id = $3' : '';
    const baseParams: any[] = functionId ? [tid, date, functionId] : [tid, date];

    // ── Target-date roster (scheduled shifts + attendance markers) ──────────
    const roster = await this.ds.query(
      `SELECT e.function_id, COALESCE(f.name,'—') AS function_name,
              to_char(ar.scheduled_start,'HH24:MI') AS ss,
              to_char(ar.scheduled_end,'HH24:MI')   AS se,
              ar.attendance_marker AS marker,
              ar.punch_late_minutes AS late, ar.punch_early_out_minutes AS early, ar.ot_minutes AS ot
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
        WHERE ar.tenant_id = $1 AND ar.attendance_date = $2::date
          AND ar.scheduled_start IS NOT NULL
          AND ar.attendance_marker IN ('present','absent','sick') ${fnFilter}`,
      baseParams,
    ).catch(() => []);

    // ── Permissions overlapping the date ────────────────────────────────────
    const perms = await this.ds.query(
      `SELECT COALESCE(rp.function_id, e.function_id) AS function_id,
              to_char(rp.start_time,'HH24:MI') AS ss, to_char(rp.end_time,'HH24:MI') AS se
         FROM request_permissions rp
         JOIN requests r ON r.id = rp.request_id
         LEFT JOIN employees e ON e.id = r.employee_id
        WHERE r.tenant_id = $1 AND rp.permission_date = $2::date
          AND r.status IN ('approved','pending')`,
      [tid, date],
    ).catch(() => []);

    // ── Required from history: same weekday, prior 6 occurrences ────────────
    const hist = await this.ds.query(
      `SELECT e.function_id, ar.attendance_date::text AS d,
              to_char(ar.scheduled_start,'HH24:MI') AS ss, to_char(ar.scheduled_end,'HH24:MI') AS se
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
        WHERE ar.tenant_id = $1
          AND ar.scheduled_start IS NOT NULL
          AND ar.attendance_marker = 'present'
          AND ar.attendance_date < $2::date
          AND EXTRACT(DOW FROM ar.attendance_date) = EXTRACT(DOW FROM $2::date)
          AND ar.attendance_date >= $2::date - INTERVAL '7 weeks' ${fnFilter}`,
      baseParams,
    ).catch(() => []);

    // ── Aggregate per function ──────────────────────────────────────────────
    type FnAgg = {
      functionId: string; functionName: string;
      scheduled: number[]; sick: number[]; absent: number[]; permission: number[];
      late: number[]; earlyOut: number[]; ot: number[];
      reqSum: number[]; histDates: Set<string>;
      lateCount: number; otCount: number; earlyCount: number; sickCount: number; absentCount: number; permCount: number;
    };
    const fns = new Map<string, FnAgg>();
    const getFn = (id: string, name: string): FnAgg => {
      if (!fns.has(id)) fns.set(id, {
        functionId: id, functionName: name,
        scheduled: Array(24).fill(0), sick: Array(24).fill(0), absent: Array(24).fill(0),
        permission: Array(24).fill(0), late: Array(24).fill(0), earlyOut: Array(24).fill(0), ot: Array(24).fill(0),
        reqSum: Array(24).fill(0), histDates: new Set(),
        lateCount: 0, otCount: 0, earlyCount: 0, sickCount: 0, absentCount: 0, permCount: 0,
      });
      return fns.get(id)!;
    };

    for (const r of roster) {
      const a = getFn(r.function_id ?? 'none', r.function_name);
      const hrs = this.hoursCovered(r.ss, r.se);
      for (const h of hrs) {
        a.scheduled[h]++;
        if (r.marker === 'sick')   a.sick[h]++;
        if (r.marker === 'absent') a.absent[h]++;
      }
      if (r.marker === 'sick')   a.sickCount++;
      if (r.marker === 'absent') a.absentCount++;
      if (r.marker === 'present') {
        const lateMin = r.late ?? 0, earlyMin = r.early ?? 0, otMin = r.ot ?? 0;
        // Late arrival → unavailable for the first ceil(late/60) hours of the shift.
        if (lateMin > 0 && hrs.length) {
          a.lateCount++;
          const nl = Math.min(Math.ceil(lateMin / 60), hrs.length);
          for (let i = 0; i < nl; i++) a.late[hrs[i]]++;
        }
        // Early out → unavailable for the last ceil(early/60) hours of the shift.
        if (earlyMin > 0 && hrs.length) {
          a.earlyCount++;
          const ne = Math.min(Math.ceil(earlyMin / 60), hrs.length);
          for (let i = 0; i < ne; i++) a.earlyOut[hrs[hrs.length - 1 - i]]++;
        }
        // OT → extra availability for ceil(ot/60) hours from scheduled_end onward.
        if (otMin > 0) {
          a.otCount++;
          const seH = parseInt(String(r.se).slice(0, 2), 10);
          const no = Math.ceil(otMin / 60);
          if (!isNaN(seH)) for (let i = 0; i < no; i++) a.ot[(seH + i) % 24]++;
        }
      }
    }
    for (const p of perms) {
      const id = p.function_id ?? 'none';
      const a = fns.get(id); if (!a) continue;
      for (const h of this.hoursCovered(p.ss, p.se)) a.permission[h]++;
      a.permCount++;
    }
    // Required = average present-roster per hour across the historical same-weekdays
    const histByFn = new Map<string, { perDate: Map<string, number[]> }>();
    for (const r of hist) {
      const id = r.function_id ?? 'none';
      if (!histByFn.has(id)) histByFn.set(id, { perDate: new Map() });
      const hb = histByFn.get(id)!;
      if (!hb.perDate.has(r.d)) hb.perDate.set(r.d, Array(24).fill(0));
      const arr = hb.perDate.get(r.d)!;
      for (const h of this.hoursCovered(r.ss, r.se)) arr[h]++;
    }
    for (const [id, hb] of histByFn) {
      const a = fns.get(id); if (!a) continue;
      const dates = [...hb.perDate.keys()].sort().slice(-6); // last 6 same-weekdays
      for (const d of dates) { const arr = hb.perDate.get(d)!; for (let h = 0; h < 24; h++) a.reqSum[h] += arr[h]; a.histDates.add(d); }
    }

    const functions = [...fns.values()].map(a => {
      const nHist = Math.max(a.histDates.size, 1);
      const hours = Array.from({ length: 24 }, (_, h) => {
        const required  = Math.round(a.reqSum[h] / nHist);
        const scheduled = a.scheduled[h];
        const available = Math.max(0,
          scheduled - a.sick[h] - a.absent[h] - a.permission[h] - a.late[h] - a.earlyOut[h] + a.ot[h]);
        return {
          hour: h,
          required, scheduled, available,
          onSick: a.sick[h], onAbsent: a.absent[h], onPermission: a.permission[h],
          late: a.late[h], earlyOut: a.earlyOut[h], ot: a.ot[h],
          gap: available - required,
        };
      }).filter(x => x.scheduled > 0 || x.required > 0); // only operating hours
      return {
        functionId: a.functionId, functionName: a.functionName,
        hours,
        summary: {
          late: a.lateCount, overtime: a.otCount, earlyOut: a.earlyCount, sick: a.sickCount,
          absent: a.absentCount, permissions: a.permCount,
          worstGap: hours.length ? Math.min(...hours.map(x => x.gap)) : 0,
        },
      };
    }).filter(f => f.hours.length > 0)
      .sort((a, b) => a.functionName.localeCompare(b.functionName));

    return { date, basis: 'required = avg of same-weekday history (last 6); available = scheduled − sick − absent − permission', functions };
  }
}
