import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

/* ══════════════════════════════════════════════════════════════════════════════
 *  DATA TRUST — the system auditing itself, on screen.
 *
 *  Every other surface answers "what happened?". This one answers "how much of that
 *  should you believe, and where exactly does the confidence run out?" — which is the
 *  question a Director actually has to answer when the numbers go to HR or to payroll.
 *
 *  It exists because the 2026-07-29 accuracy work produced findings with nowhere to
 *  live: 147 days where the schedule and Odoo disagree about whether someone was even
 *  meant to work, days scored on a sliver of evidence, full shifts worked hours from
 *  their scheduled window. Those are decisions waiting for a human, and a decision
 *  waiting in a JSON file is a decision nobody makes.
 *
 *  DESIGN RULE, inherited from the dashboard principles: verified data only. Every
 *  number here is computed live from roster_days at request time — none is cached,
 *  estimated, or carried over. A panel with nothing to show says so rather than
 *  rendering an encouraging zero.
 * ═══════════════════════════════════════════════════════════════════════════════ */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class DataTrustController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Wrap-corrected scheduled span: cross-midnight rows store an end BEFORE their start. */
  private static readonly GROSS =
    `(CASE WHEN shift_end_min<=shift_start_min THEN shift_end_min+1440-shift_start_min ELSE shift_end_min-shift_start_min END)`;

  @Get('roster-v2/data-trust')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Data-trust panel: evidence coverage, open review queues, and the confidence behind every scored day' })
  async dataTrust(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(
      `SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1 AND is_active`, [t]))[0];
    // default to the last complete month of data rather than an arbitrary window
    const dTo = to || range?.b;
    const dFrom = from || (dTo ? new Date(Date.parse(`${dTo}T00:00:00Z`) - 27 * 86400000).toISOString().slice(0, 10) : range?.a);
    const G = DataTrustController.GROSS;
    const P: any[] = [t, dFrom, dTo];

    /* ── The headline: of the days we DREW A CONCLUSION about, how many were measured
       well enough to support it? Not "how many rows do we have" — that number always
       looks good and means nothing. */
    const [cov] = await this.ds.query(
      `SELECT COUNT(*)::int total,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh'))::int worked,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND include_tardiness)::int scored,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND include_tardiness
                               AND worked_min >= ${G}*0.75)::int strong,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND include_tardiness
                               AND worked_min < ${G}*0.75)::int partial,
              COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND NOT include_tardiness)::int not_scored,
              COUNT(DISTINCT person_no)::int people
         FROM roster_days WHERE tenant_id=$1 AND is_active AND work_date BETWEEN $2 AND $3`, P);

    /* ── The open decisions. Each row here is a human judgement the engine deliberately
       refused to make on its own — never a silent default. */
    const queues = await this.ds.query(
      `SELECT CASE
                WHEN data_quality ILIKE '%SCHEDULE vs HR CONFLICT%'  THEN 'schedule_vs_hr'
                WHEN data_quality ILIKE '%SCHEDULE REVIEW%'          THEN 'displaced_shift'
                WHEN data_quality ILIKE '%Evidence covers only%'     THEN 'thin_evidence'
                WHEN data_quality ILIKE '%genuinely unknown%'        THEN 'unknown'
                WHEN data_quality ILIKE '%no biometric expected%'    THEN 'wfh_no_session'
                WHEN data_quality ILIKE '%Odoo says%'                THEN 'odoo_resolved'
                ELSE NULL END AS queue,
              COUNT(*)::int days, COUNT(DISTINCT person_no)::int people
         FROM roster_days
        WHERE tenant_id=$1 AND is_active AND work_date BETWEEN $2 AND $3 AND data_quality IS NOT NULL
        GROUP BY 1 HAVING CASE
                WHEN data_quality ILIKE '%SCHEDULE vs HR CONFLICT%'  THEN 'schedule_vs_hr'
                WHEN data_quality ILIKE '%SCHEDULE REVIEW%'          THEN 'displaced_shift'
                WHEN data_quality ILIKE '%Evidence covers only%'     THEN 'thin_evidence'
                WHEN data_quality ILIKE '%genuinely unknown%'        THEN 'unknown'
                WHEN data_quality ILIKE '%no biometric expected%'    THEN 'wfh_no_session'
                WHEN data_quality ILIKE '%Odoo says%'                THEN 'odoo_resolved'
                ELSE NULL END IS NOT NULL`, P);

    /* Each queue carries what it MEANS and what it costs to leave it open — a count with
       no consequence attached is a number people learn to scroll past. */
    const META: Record<string, { title: string; why: string; action: string; tone: string }> = {
      schedule_vs_hr: {
        title: 'Schedule says work, HR says off',
        why: 'The roster sheet scheduled a shift; Odoo records the day as an Off Day. One of the two is wrong and neither is allowed to win automatically.',
        action: 'Confirm which system is right for these days', tone: 'amber',
      },
      displaced_shift: {
        title: 'Full shift worked at the wrong hour',
        why: 'The person worked their whole shift, hours away from the window they were scheduled for. That is a schedule error, not a late arrival, and must never be recorded as lateness.',
        action: 'Correct the schedule for these days', tone: 'amber',
      },
      thin_evidence: {
        title: 'Too little seen to judge',
        why: 'Under a quarter of the shift has any system or punch evidence. Punctuality cannot be scored from a three-minute session, so these days are excluded rather than guessed.',
        action: 'Verify against the raw exports', tone: 'slate',
      },
      wfh_no_session: {
        title: 'Working from home, no session',
        why: 'Odoo records WFH and no biometric punch is expected. Legitimate, but the day carries no measurable hours.',
        action: 'No action — recorded, not scored', tone: 'slate',
      },
      odoo_resolved: {
        title: 'Resolved from HR records',
        why: 'No session and no punch, but Odoo names the day: leave, absence or sick. Presence follows the HR system of record.',
        action: 'No action — resolved automatically', tone: 'emerald',
      },
      unknown: {
        title: 'Genuinely unknown',
        why: 'No system session, no punch, and no Odoo status. Nothing anywhere records what happened. These cannot be recovered by any calculation.',
        action: 'Only a person can answer these', tone: 'rose',
      },
    };

    /* ── Where the month's evidence came from. A roster resting on one witness is a
       different proposition from one corroborated twice, and the difference should be
       visible rather than buried in a methodology note. */
    const [wit] = await this.ds.query(
      `SELECT COUNT(*) FILTER (WHERE sys_login_min IS NOT NULL AND punch_in_min IS NOT NULL)::int both,
              COUNT(*) FILTER (WHERE sys_login_min IS NOT NULL AND punch_in_min IS NULL)::int system_only,
              COUNT(*) FILTER (WHERE sys_login_min IS NULL AND punch_in_min IS NOT NULL)::int punch_only,
              COUNT(*) FILTER (WHERE sys_login_min IS NULL AND punch_in_min IS NULL)::int neither
         FROM roster_days
        WHERE tenant_id=$1 AND is_active AND work_date BETWEEN $2 AND $3 AND presence IN ('office','wfh')`, P);

    /* ── The people carrying the most unresolved days. Named, because "17 open items"
       is a statistic and "Aya Wahab, 7 days" is something someone can act on. */
    const people = await this.ds.query(
      `SELECT clean_name AS name, person_no, MIN(function_name) AS fn, MIN(team_manager) AS tl,
              COUNT(*)::int days,
              COUNT(*) FILTER (WHERE data_quality ILIKE '%SCHEDULE vs HR CONFLICT%')::int conflicts,
              COUNT(*) FILTER (WHERE data_quality ILIKE '%Evidence covers only%')::int thin,
              COUNT(*) FILTER (WHERE data_quality ILIKE '%SCHEDULE REVIEW%')::int displaced
         FROM roster_days
        WHERE tenant_id=$1 AND is_active AND work_date BETWEEN $2 AND $3
          AND (data_quality ILIKE '%SCHEDULE vs HR CONFLICT%' OR data_quality ILIKE '%Evidence covers only%'
               OR data_quality ILIKE '%SCHEDULE REVIEW%')
        GROUP BY clean_name, person_no ORDER BY days DESC LIMIT 12`, P);

    /* ── Conformance, stated with its own confidence. The average alone invites a
       comparison it cannot support if half the days behind it were barely measured. */
    const [conf] = await this.ds.query(
      `SELECT ROUND(AVG(adherence_pct)::numeric,1)::float mean,
              ROUND(AVG(adherence_pct) FILTER (WHERE worked_min >= ${G}*0.75)::numeric,1)::float mean_strong,
              COUNT(*) FILTER (WHERE conforming)::int conforming, COUNT(*)::int n
         FROM roster_days
        WHERE tenant_id=$1 AND is_active AND work_date BETWEEN $2 AND $3
          AND include_tardiness AND adherence_pct IS NOT NULL`, P);

    const trustPct = cov.scored ? Math.round((100 * cov.strong) / cov.scored) : null;
    return {
      from: dFrom, to: dTo, dataThrough: range?.b,
      coverage: { ...cov, trustPct },
      witnesses: wit,
      conformance: conf,
      queues: queues
        .map((q: any) => ({ key: q.queue, days: q.days, people: q.people, ...(META[q.queue] || {}) }))
        .sort((a: any, b: any) => b.days - a.days),
      people,
      /* Stated on the page, not in a footnote: what this panel cannot see. */
      caveats: [
        cov.not_scored ? `${cov.not_scored} worked days are recorded but not scored — each carries its reason on the row.` : null,
        `Evidence is judged against the scheduled span including the break, the same basis a completed shift uses.`,
      ].filter(Boolean),
    };
  }
}
