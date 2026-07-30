import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
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

  /* ── The open items themselves, with enough context to judge without leaving ─────
     A queue that only shows counts is a report. To decide "was this person meant to
     work?" you need the two claims side by side: what the schedule said, what Odoo said,
     and what evidence exists. That is what this returns — one row per open question. */
  @Get('roster-v2/data-trust/queue')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'The open decisions in one queue, each with the evidence needed to settle it' })
  async queue(@Req() req: any, @Query('queue') queue?: string, @Query('from') from?: string,
              @Query('to') to?: string, @Query('limit') limit?: string) {
    const t = req.user.tenantId;
    const MATCH: Record<string, string> = {
      schedule_vs_hr: '%SCHEDULE vs HR CONFLICT%',
      displaced_shift: '%SCHEDULE REVIEW%',
      thin_evidence: '%Evidence covers only%',
      unknown: '%genuinely unknown%',
    };
    const like = MATCH[queue || ''];
    if (!like) throw new BadRequestException(`queue must be one of ${Object.keys(MATCH).join(', ')}`);
    const range = (await this.ds.query(
      `SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1 AND is_active`, [t]))[0];
    const dTo = to || range?.b, dFrom = from || range?.a;
    const G = DataTrustController.GROSS;
    const rows = await this.ds.query(
      `SELECT rd.person_no, rd.employee_no, rd.clean_name AS name, rd.function_name AS fn,
              rd.team_manager AS tl, rd.work_date::text AS date, rd.day_name AS day,
              rd.shift_code, rd.attendance_code, rd.shift_start_min AS ss, rd.shift_end_min AS se, ${G} AS gross,
              rd.sys_login_min AS login, rd.sys_logout_min AS logout, rd.punch_in_min AS punch,
              rd.worked_min AS worked, rd.data_quality AS reason, rd.login_src,
              d.decision, d.decided_by, d.decided_at, d.note
         FROM roster_days rd
         LEFT JOIN roster_decisions d
           ON d.tenant_id = rd.tenant_id AND d.person_no = rd.person_no
          AND d.work_date = rd.work_date AND d.queue = $4
        WHERE rd.tenant_id = $1 AND rd.is_active AND rd.work_date BETWEEN $2 AND $3
          AND rd.data_quality ILIKE $5
        ORDER BY rd.work_date DESC, rd.clean_name
        LIMIT $6`,
      [t, dFrom, dTo, queue, like, Math.min(Number(limit) || 300, 1000)]);
    return {
      queue, from: dFrom, to: dTo, count: rows.length,
      /* Decided items stay in the response, marked. Hiding them would make the queue look
         like it shrank by magic and give no way to review or reverse a call. */
      open: rows.filter((r: any) => !r.decision).length,
      rows,
    };
  }

  /* ── Recording the answer ────────────────────────────────────────────────────────
     The decision is stored, never applied to roster_days directly: the rules live in the
     engine, and a value written straight into the data is overwritten by the next rebuild
     (BR-ING-005). The next refresh reads this table and applies it — which also means the
     decision is re-applied every time, rather than being a one-off edit that decays. */
  @Post('roster-v2/data-trust/decide')
  @RequirePermissions('schedule.publish')
  @ApiOperation({ summary: 'Record a human decision on one open item; applied by the next rebuild' })
  async decide(@Req() req: any, @Body() body: { personNo: string; date: string; queue: string; decision: string; note?: string }) {
    const t = req.user.tenantId;
    const ALLOWED: Record<string, string[]> = {
      schedule_vs_hr: ['schedule', 'hr'],
      displaced_shift: ['schedule_wrong', 'keep'],
      thin_evidence: ['worked', 'not_worked', 'keep'],
      unknown: ['worked', 'not_worked', 'keep'],
    };
    const opts = ALLOWED[body?.queue];
    if (!opts) throw new BadRequestException(`unknown queue "${body?.queue}"`);
    if (!opts.includes(body?.decision)) throw new BadRequestException(`decision for ${body.queue} must be one of ${opts.join(' | ')}`);
    if (!body?.personNo || !/^\d{4}-\d{2}-\d{2}$/.test(body?.date || '')) throw new BadRequestException('personNo and date (YYYY-MM-DD) are required');
    /* The item must actually be open — otherwise a stale screen could decide a day that
       has since been resolved by a rebuild, and nobody would know the answer no longer
       applies to anything. */
    const [exists] = await this.ds.query(
      `SELECT 1 FROM roster_days WHERE tenant_id=$1 AND person_no=$2 AND work_date=$3::date AND is_active LIMIT 1`,
      [t, body.personNo, body.date]);
    if (!exists) throw new BadRequestException(`no active roster day for ${body.personNo} on ${body.date}`);

    const who = req.user?.email || req.user?.username || req.user?.sub || 'unknown';
    await this.ds.query(
      `INSERT INTO roster_decisions (tenant_id, person_no, work_date, queue, decision, note, decided_by)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, person_no, work_date, queue)
       DO UPDATE SET decision=EXCLUDED.decision, note=EXCLUDED.note,
                     decided_by=EXCLUDED.decided_by, decided_at=now()`,
      [t, body.personNo, body.date, body.queue, body.decision, body.note || null, who]);
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_email, action, module, entity_type, new_value, notes)
       VALUES ($1,$2,'decide','attendance-recon','roster_day',$3,$4)`,
      [t, who, JSON.stringify({ person_no: body.personNo, date: body.date, queue: body.queue, decision: body.decision }),
       `Data Trust decision — takes effect on the next roster rebuild.`]).catch(() => {});
    return { ok: true, appliedOn: 'next rebuild', personNo: body.personNo, date: body.date, queue: body.queue, decision: body.decision };
  }
}
