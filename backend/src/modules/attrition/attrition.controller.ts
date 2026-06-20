import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

/**
 * Attrition rate from the schedule's separation markers. A `RES` shift code =
 * resignation (voluntary), `TER` = termination (involuntary). The day BEFORE the
 * marker is the employee's last working day; their shifts go empty after it.
 *
 * Attrition rate (period)   = separations ÷ average headcount × 100
 * Annualized                = period rate × (12 ÷ months in period)   (Bersin/SHRM)
 */
@ApiTags('Attrition')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'attrition', version: '1' })
@RequirePermissions('reports.view')
export class AttritionController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Attrition rate + separations from RES/TER schedule markers' })
  async report(@CurrentUser() user: any, @Query('from') from?: string, @Query('to') to?: string) {
    const tid = user.tenantId;

    // Default the window to the full span of any RES/TER markers we have.
    const [span] = await this.ds.query(
      `SELECT MIN(a.attendance_date)::text mn, MAX(a.attendance_date)::text mx
         FROM attendance_records a JOIN shift_codes sc ON sc.id = a.scheduled_shift_code_id
        WHERE a.tenant_id = $1 AND sc.code IN ('RES','TER')`, [tid]).catch(() => [{}]);
    const fromD = from ?? span?.mn ?? new Date().toISOString().slice(0, 10);
    const toD   = to   ?? span?.mx ?? new Date().toISOString().slice(0, 10);

    // Each separated employee: first RES/TER date in window + last actual working day before it.
    const separations = await this.ds.query(
      `WITH sep AS (
         SELECT a.employee_id,
                MIN(a.attendance_date) AS sep_date,
                (ARRAY_AGG(sc.code ORDER BY a.attendance_date))[1] AS code
           FROM attendance_records a JOIN shift_codes sc ON sc.id = a.scheduled_shift_code_id
          WHERE a.tenant_id = $1 AND sc.code IN ('RES','TER')
            AND a.attendance_date BETWEEN $2::date AND $3::date
          GROUP BY a.employee_id)
       SELECT e.employee_no,
              (e.first_name_en || ' ' || COALESCE(e.last_name_en,'')) AS name,
              COALESCE(f.name,'—') AS function_name,
              s.code,
              s.sep_date::text AS separation_date,
              (SELECT MAX(w.attendance_date) FROM attendance_records w
                WHERE w.tenant_id = $1 AND w.employee_id = s.employee_id
                  AND w.scheduled_start IS NOT NULL AND w.attendance_date < s.sep_date)::text AS last_working_day
         FROM sep s
         JOIN employees e ON e.id = s.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
        ORDER BY s.sep_date`,
      [tid, fromD, toD]).catch(() => []);

    // Average monthly headcount across the window (distinct employees with a working shift).
    const [hc] = await this.ds.query(
      `SELECT COALESCE(ROUND(AVG(n)), 0)::int AS avg_hc, COUNT(*)::int AS months FROM (
         SELECT date_trunc('month', attendance_date) m, COUNT(DISTINCT employee_id) n
           FROM attendance_records
          WHERE tenant_id = $1 AND scheduled_start IS NOT NULL
            AND attendance_date BETWEEN $2::date AND $3::date
          GROUP BY 1) x`, [tid, fromD, toD]).catch(() => [{ avg_hc: 0, months: 0 }]);

    const total = separations.length;
    const voluntary = separations.filter((s: any) => s.code === 'RES').length;
    const involuntary = separations.filter((s: any) => s.code === 'TER').length;
    const avgHc = hc?.avg_hc ?? 0;
    const months = Math.max(hc?.months ?? 1, 1);
    const ratePeriod = avgHc > 0 ? +((total / avgHc) * 100).toFixed(1) : 0;
    const rateAnnualized = +(ratePeriod * (12 / months)).toFixed(1);

    // Breakdowns
    const byFunction = this.group(separations, (s: any) => s.function_name);
    const byMonth = this.group(separations, (s: any) => s.separation_date.slice(0, 7));

    return {
      from: fromD, to: toD, months,
      summary: {
        separations: total, voluntary, involuntary,
        avgHeadcount: avgHc,
        attritionRatePeriod: ratePeriod,
        attritionRateAnnualized: rateAnnualized,
        voluntaryRateAnnualized: avgHc > 0 ? +(((voluntary / avgHc) * 100) * (12 / months)).toFixed(1) : 0,
      },
      byFunction, byMonth, separations,
    };
  }

  private group(rows: any[], key: (r: any) => string) {
    const m = new Map<string, { key: string; total: number; voluntary: number; involuntary: number }>();
    for (const r of rows) {
      const k = key(r);
      const e = m.get(k) ?? { key: k, total: 0, voluntary: 0, involuntary: 0 };
      e.total++; if (r.code === 'RES') e.voluntary++; else e.involuntary++;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }
}
