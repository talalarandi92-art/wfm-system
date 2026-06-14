import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { AnalystService } from '@modules/analyst/analyst.service';
import { HealthGuardService } from '@modules/health-guard/health-guard.service';

/**
 * Reporting bot — the third guard. Composes a daily WFM report from the Analyst
 * assessment + Health guard + core request/SLA metrics, on the schedule each
 * recipe defines. Runs are stored as JSONB payloads that drive both the on-screen
 * view and the Excel export. A background loop fires scheduled recipes once/day.
 */

const ALL_SECTIONS = ['coverage', 'compliance', 'queues', 'schedule', 'requests', 'health'] as const;
type Section = typeof ALL_SECTIONS[number];

@Injectable()
export class ReporterService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Reporter');
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly analyst: AnalystService,
    private readonly health: HealthGuardService,
  ) {}

  onModuleInit() {
    setTimeout(() => this.tick().catch(() => {}), 90_000);     // first check after 90s
    this.timer = setInterval(() => this.tick().catch(() => {}), 5 * 60_000); // every 5 min
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // Kuwait local HH:MM right now.
  private nowHHMM(): string {
    const d = new Date(Date.now() + 3 * 3600_000); // UTC+3
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
  private todayKW(): string {
    const d = new Date(Date.now() + 3 * 3600_000);
    return d.toISOString().slice(0, 10);
  }

  // ── Daily scheduler: fire enabled recipes whose time has arrived (once/day) ──
  private async tick() {
    const hhmm = this.nowHHMM();
    const day = this.todayKW();
    const due: any[] = await this.ds.query(
      `SELECT r.* FROM report_recipes r
        WHERE r.enabled = true AND r.schedule_time IS NOT NULL
          AND r.schedule_time <= $1
          AND NOT EXISTS (
            SELECT 1 FROM report_runs ru
             WHERE ru.recipe_id = r.id AND ru.run_date = $2::date AND ru.trigger = 'scheduled')`,
      [hhmm, day]).catch(() => []);
    for (const r of due) {
      const run = await this.generate(r.tenant_id, { recipe: r, trigger: 'scheduled' }).catch(() => null);
      if (run) await this.notifyRecipients(r.tenant_id, r, run).catch(() => {});
    }
  }

  private async notifyRecipients(tid: string, recipe: any, run: any) {
    const ids: string[] = Array.isArray(recipe.recipients) ? recipe.recipients : [];
    for (const uid of ids) {
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id, action_url, created_at)
         VALUES ($1,$2,'report_ready',$3,$4,$5,$6,'report_run',$7,$8,NOW())`,
        [tid, uid, `Report ready: ${recipe.name}`, `تقرير جاهز: ${recipe.name}`, run.summary, run.summary, run.id, `/reports-bot?run=${run.id}`],
      ).catch(() => {});
    }
  }

  // ── Compose a report ─────────────────────────────────────────────────────────
  async generate(
    tid: string,
    opts: { recipe?: any; sections?: string[]; date?: string; trigger?: 'manual' | 'scheduled'; recipeId?: string } = {},
  ) {
    const recipe = opts.recipe;
    const sections: Section[] = ((opts.sections ?? recipe?.sections ?? ALL_SECTIONS) as string[])
      .filter(s => (ALL_SECTIONS as readonly string[]).includes(s)) as Section[];
    const date = opts.date ?? this.todayKW();
    const trigger = opts.trigger ?? 'manual';

    const payload: any = { date, sections, blocks: {} };

    const assess = sections.some(s => ['coverage', 'compliance', 'queues', 'schedule'].includes(s))
      ? await this.analyst.assess(tid, date).catch(() => null) : null;

    if (sections.includes('coverage') && assess) {
      const fns = assess.coverage.functions;
      payload.blocks.coverage = {
        severity: assess.coverage.severity,
        danger: fns.filter((f: any) => f.verdict === 'danger').map((f: any) => ({ fn: f.functionName, gap: f.bottleneck.gap, hour: f.bottleneck.hour, uncovered: f.uncovered })),
        approve: fns.filter((f: any) => f.verdict === 'approve').map((f: any) => ({ fn: f.functionName, slack: f.bottleneck.gap })),
        all: fns.map((f: any) => ({ fn: f.functionName, verdict: f.verdict, bottleneckGap: f.bottleneck.gap, hour: f.bottleneck.hour, required: f.bottleneck.required, available: f.bottleneck.available })),
      };
    }
    if (sections.includes('compliance') && assess) {
      payload.blocks.compliance = { severity: assess.compliance.severity, total: assess.compliance.offenders.length, offenders: assess.compliance.offenders.map((o: any) => ({ name: o.name, fn: o.fn, issues: o.issues.join('، '), score: o.score })) };
    }
    if (sections.includes('queues') && assess) {
      payload.blocks.queues = { severity: assess.queues.severity, problems: assess.queues.queues.map((q: any) => ({ name: q.name, channel: q.channel, sla: q.sla, backlog: q.backlog, waiting: q.waiting, available: q.agentsAvailable })) };
    }
    if (sections.includes('schedule') && assess) {
      payload.blocks.schedule = { severity: assess.schedule.severity, findings: assess.schedule.findings.map((c: any) => ({ rule: c.labelAr, count: c.count, detail: c.detail, status: c.status })) };
    }
    if (sections.includes('requests')) {
      payload.blocks.requests = await this.requestsBlock(tid, date);
    }
    if (sections.includes('health')) {
      const h = await this.health.run(tid).catch(() => null);
      if (h) payload.blocks.health = { score: h.score, status: h.status, fails: h.checks.filter(c => c.status === 'fail').map(c => c.labelAr), warns: h.checks.filter(c => c.status === 'warn').map(c => c.labelAr) };
    }

    const summary = this.headline(payload);
    const [run] = await this.ds.query(
      `INSERT INTO report_runs (tenant_id, recipe_id, recipe_name, run_date, sections, payload, summary, trigger)
       VALUES ($1,$2,$3,$4::date,$5::jsonb,$6::jsonb,$7,$8)
       ON CONFLICT (tenant_id, recipe_id, run_date) WHERE (trigger = 'scheduled')
       DO UPDATE SET payload = EXCLUDED.payload, summary = EXCLUDED.summary, generated_at = NOW()
       RETURNING id, summary, generated_at`,
      [tid, recipe?.id ?? opts.recipeId ?? null, recipe?.name ?? 'تقرير يدوي', date, JSON.stringify(sections), JSON.stringify(payload), summary, trigger],
    ).catch(async () => {
      // The partial-index upsert can't always match; fall back to plain insert.
      return this.ds.query(
        `INSERT INTO report_runs (tenant_id, recipe_id, recipe_name, run_date, sections, payload, summary, trigger)
         VALUES ($1,$2,$3,$4::date,$5::jsonb,$6::jsonb,$7,$8) RETURNING id, summary, generated_at`,
        [tid, recipe?.id ?? opts.recipeId ?? null, recipe?.name ?? 'تقرير يدوي', date, JSON.stringify(sections), JSON.stringify(payload), summary, trigger]);
    }).then((r: any) => Array.isArray(r?.[0]) ? r[0] : r);

    return { id: run.id, summary: run.summary, generatedAt: run.generated_at, date, sections, payload };
  }

  private async requestsBlock(tid: string, date: string) {
    const [r] = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('pending','peer_pending'))::int AS pending,
         COUNT(*) FILTER (WHERE status IN ('pending','peer_pending') AND sla_due_at < NOW())::int AS overdue,
         COUNT(*) FILTER (WHERE status IN ('pending','peer_pending') AND escalated_at IS NOT NULL)::int AS escalated,
         COUNT(*) FILTER (WHERE status = 'approved' AND approved_l1_at::date = $2::date)::int AS approved_today,
         COUNT(*) FILTER (WHERE status = 'rejected' AND rejected_at::date = $2::date)::int AS rejected_today
       FROM requests WHERE tenant_id = $1`, [tid, date]).catch(() => [{}]);
    return { pending: r?.pending ?? 0, overdue: r?.overdue ?? 0, escalated: r?.escalated ?? 0, approvedToday: r?.approved_today ?? 0, rejectedToday: r?.rejected_today ?? 0 };
  }

  private headline(payload: any): string {
    const b = payload.blocks; const parts: string[] = [];
    if (b.coverage?.danger?.length) parts.push(`${b.coverage.danger.length} قسم بخطر تغطية`);
    if (b.queues?.problems?.length) parts.push(`${b.queues.problems.length} كيو متعثّر`);
    if (b.compliance?.total) parts.push(`${b.compliance.total} غير ملتزم`);
    if (b.schedule?.findings?.length) parts.push(`${b.schedule.findings.length} ملاحظة جدول`);
    if (b.requests?.overdue) parts.push(`${b.requests.overdue} طلب متأخّر`);
    if (b.health) parts.push(`صحّة ${b.health.score}%`);
    return parts.length ? parts.join(' · ') : 'لا مشاكل بارزة';
  }

  // ── Excel export from a stored run ───────────────────────────────────────────
  async excel(tid: string, runId: string): Promise<{ buffer: Buffer; name: string } | null> {
    const [run] = await this.ds.query(`SELECT * FROM report_runs WHERE id = $1 AND tenant_id = $2`, [runId, tid]).catch(() => []);
    if (!run) return null;
    const p = run.payload; const b = p.blocks;
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: any[]) => {
      if (!rows?.length) return;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
    };
    add('Summary', [{ Report: run.recipe_name, Date: p.date, Headline: run.summary, Generated: new Date(run.generated_at).toISOString() }]);
    if (b.coverage) add('Coverage', b.coverage.all);
    if (b.compliance) add('Compliance', b.compliance.offenders);
    if (b.queues) add('Queues', b.queues.problems);
    if (b.schedule) add('Schedule', b.schedule.findings);
    if (b.requests) add('Requests', [b.requests]);
    if (b.health) add('Health', [{ score: b.health.score, status: b.health.status, fails: (b.health.fails || []).join('; '), warns: (b.health.warns || []).join('; ') }]);
    const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return { buffer, name: `wfm-report-${p.date}.xlsx` };
  }

  // ── CRUD / listing ───────────────────────────────────────────────────────────
  async listRecipes(tid: string) {
    return this.ds.query(`SELECT * FROM report_recipes WHERE tenant_id = $1 ORDER BY created_at DESC`, [tid]).catch(() => []);
  }
  async saveRecipe(tid: string, userId: string, dto: any) {
    if (dto.id) {
      const [r] = await this.ds.query(
        `UPDATE report_recipes SET name=$3, sections=$4::jsonb, schedule_time=$5, recipients=$6::jsonb, enabled=$7, updated_at=NOW()
          WHERE id=$1 AND tenant_id=$2 RETURNING *`,
        [dto.id, tid, dto.name, JSON.stringify(dto.sections ?? ALL_SECTIONS), dto.scheduleTime ?? null, JSON.stringify(dto.recipients ?? []), dto.enabled !== false],
      ).then((r: any) => Array.isArray(r?.[0]) ? r[0] : r);
      return r;
    }
    const [r] = await this.ds.query(
      `INSERT INTO report_recipes (tenant_id, name, sections, schedule_time, recipients, enabled, created_by)
       VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7) RETURNING *`,
      [tid, dto.name, JSON.stringify(dto.sections ?? ALL_SECTIONS), dto.scheduleTime ?? null, JSON.stringify(dto.recipients ?? []), dto.enabled !== false, userId]);
    return r;
  }
  async deleteRecipe(tid: string, id: string) {
    await this.ds.query(`DELETE FROM report_recipes WHERE id=$1 AND tenant_id=$2`, [id, tid]).catch(() => {});
    return { ok: true };
  }
  async listRuns(tid: string, limit = 30) {
    return this.ds.query(
      `SELECT id, recipe_name, run_date, summary, trigger, generated_at, sections
         FROM report_runs WHERE tenant_id = $1 ORDER BY generated_at DESC LIMIT $2`, [tid, limit]).catch(() => []);
  }
  async getRun(tid: string, id: string) {
    const [r] = await this.ds.query(`SELECT * FROM report_runs WHERE id=$1 AND tenant_id=$2`, [id, tid]).catch(() => []);
    return r ?? null;
  }
}
