import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

/**
 * Attrition from the schedule's separation markers, over the canonical roster
 * (`roster_days`, deduped by person_no so an old↔new intern-id pair counts once).
 *
 *   RES = resignation (voluntary)      → attrition
 *   TER = termination (involuntary)    → attrition
 *   Transfer = INTERNAL move to another department → NOT attrition (the person
 *              stays with the company; surfaced separately as internal mobility).
 *
 * The day BEFORE the marker is the last working day; shifts go empty after it.
 * Attrition rate (period) = separations ÷ average headcount × 100; annualized =
 * period rate × (12 ÷ months)  (Bersin/SHRM).
 */
@ApiTags('Attrition')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: 'attrition', version: '1' })
@RequirePermissions('reports.view')
export class AttritionController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // a row's separation/transfer marker, regardless of which column carries it
  private readonly MARK = `UPPER(COALESCE(NULLIF(r.shift_code,''), r.attendance_code, ''))`;

  @Get()
  @ApiOperation({ summary: 'Attrition (RES/TER) + internal transfers from the roster, deduped by person' })
  async report(@CurrentUser() user: any, @Query('from') from?: string, @Query('to') to?: string) {
    const tid = user.tenantId;
    const MARK = this.MARK;

    // Default the window to the span of any separation/transfer marker we have.
    const [span] = await this.ds.query(
      `SELECT MIN(work_date)::text mn, MAX(work_date)::text mx
         FROM roster_days r
        WHERE r.tenant_id = $1 AND ${MARK} IN ('RES','TER','TRANSFER')`, [tid]).catch(() => [{}]);
    const fromD = from ?? span?.mn ?? new Date().toISOString().slice(0, 10);
    const toD   = to   ?? span?.mx ?? new Date().toISOString().slice(0, 10);

    // Separations: one per canonical person (is_active dedupes old↔new intern ids).
    // function = the person's last real function before they left (per-month aware).
    const separations = await this.ds.query(
      `WITH sep AS (
         SELECT r.person_no,
                MIN(r.work_date) AS sep_date,
                (ARRAY_AGG(${MARK} ORDER BY r.work_date))[1] AS code,
                MAX(r.clean_name) AS name
           FROM roster_days r
          WHERE r.tenant_id = $1 AND r.is_active AND ${MARK} IN ('RES','TER')
            AND r.work_date BETWEEN $2::date AND $3::date
          GROUP BY r.person_no)
       SELECT s.person_no AS employee_no, s.name,
              COALESCE((SELECT r2.role_function FROM roster_days r2
                         WHERE r2.tenant_id=$1 AND r2.person_no=s.person_no
                           AND r2.work_date < s.sep_date AND r2.role_function IS NOT NULL
                         ORDER BY r2.work_date DESC LIMIT 1), '—') AS function_name,
              s.code,
              s.sep_date::text AS separation_date,
              (SELECT MAX(w.work_date) FROM roster_days w
                WHERE w.tenant_id=$1 AND w.person_no=s.person_no
                  AND w.presence IN ('office','wfh') AND w.work_date < s.sep_date)::text AS last_working_day
         FROM sep s ORDER BY s.sep_date`,
      [tid, fromD, toD]).catch(() => []);

    // Internal transfers — NOT attrition. Surfaced so the move is visible.
    const transfers = await this.ds.query(
      `WITH tr AS (
         SELECT r.person_no, MIN(r.work_date) AS t_date, MAX(r.clean_name) AS name
           FROM roster_days r
          WHERE r.tenant_id = $1 AND r.is_active AND ${MARK} = 'TRANSFER'
            AND r.work_date BETWEEN $2::date AND $3::date
          GROUP BY r.person_no)
       SELECT t.person_no AS employee_no, t.name, t.t_date::text AS transfer_date,
              COALESCE((SELECT r2.role_function FROM roster_days r2
                         WHERE r2.tenant_id=$1 AND r2.person_no=t.person_no
                           AND r2.work_date < t.t_date AND r2.role_function IS NOT NULL
                         ORDER BY r2.work_date DESC LIMIT 1), '—') AS from_function
         FROM tr t ORDER BY t.t_date`,
      [tid, fromD, toD]).catch(() => []);

    // Average monthly headcount across the window (distinct canonical persons present).
    const [hc] = await this.ds.query(
      `SELECT COALESCE(ROUND(AVG(n)), 0)::int AS avg_hc, COUNT(*)::int AS months FROM (
         SELECT date_trunc('month', work_date) m, COUNT(DISTINCT person_no) n
           FROM roster_days
          WHERE tenant_id = $1 AND is_active AND presence IN ('office','wfh')
            AND work_date BETWEEN $2::date AND $3::date
          GROUP BY 1) x`, [tid, fromD, toD]).catch(() => [{ avg_hc: 0, months: 0 }]);

    const total = separations.length;
    const voluntary = separations.filter((s: any) => s.code === 'RES').length;
    const involuntary = separations.filter((s: any) => s.code === 'TER').length;
    const avgHc = hc?.avg_hc ?? 0;
    const months = Math.max(hc?.months ?? 1, 1);
    const ratePeriod = avgHc > 0 ? +((total / avgHc) * 100).toFixed(1) : 0;
    const rateAnnualized = +(ratePeriod * (12 / months)).toFixed(1);

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
        internalTransfers: transfers.length,   // moved internally — NOT counted in attrition
      },
      byFunction, byMonth, separations,
      transfers, // internal moves, shown separately
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
