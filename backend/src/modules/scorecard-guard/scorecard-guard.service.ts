import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AgentRunner } from '@common/agent-runner';

/**
 * Scorecard Guard — builds and reviews the performance scorecard from real KPI
 * entries (scorecard_entries). It summarizes per function / team-leader, ranks
 * performers, finds who is below the function average + their weakest KPI, tracks
 * the weekly trend, and surfaces coaching candidates (and can flag repeat
 * under-performers into coaching_flags). Deterministic — no AI key.
 */

const SCORE_FIELDS: { f: string; ar: string }[] = [
  { f: 'quality_score', ar: 'الجودة' }, { f: 'aht_score', ar: 'AHT' }, { f: 'fcr_score', ar: 'FCR' },
  { f: 'productivity_score', ar: 'الإنتاجية' }, { f: 'ctr_score', ar: 'CTR' }, { f: 'quiz_score', ar: 'الكويز' },
  { f: 'mistakes_score', ar: 'الأخطاء' }, { f: 'incidents_score', ar: 'الإنسيدنت' },
  { f: 'attendance_score', ar: 'الحضور' }, { f: 'response_time_score', ar: 'زمن الرد' },
];

@Injectable()
export class ScorecardGuardService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ScorecardGuard');
  private timer?: NodeJS.Timeout;

  private readonly runner: AgentRunner;
  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.runner = new AgentRunner(this.ds, 'scorecard-guard-loop');
  }

  onModuleInit() {
    setTimeout(() => this.scanAllExclusive(), 110_000);
    this.timer = setInterval(() => this.scanAllExclusive(), 6 * 3600_000); // every 6h
  }

  // Advisory-lock exclusive so multi-instance never double-writes coaching_flags. The manual
  // per-tenant scan(tid) path (controller) is intentionally NOT gated.
  private scanAllExclusive() {
    this.runner.runExclusive(() => this.scanAll()).catch(() => {});
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async latestWeek(tid: string, functionId?: string): Promise<string | null> {
    const [r] = await this.ds.query(
      `SELECT week_label FROM scorecard_entries WHERE tenant_id = $1
        GROUP BY week_label ORDER BY (week_label = 'Final') DESC, MAX(created_at) DESC LIMIT 1`, [tid]).catch(() => []);
    return r?.week_label ?? null;
  }

  async weeks(tid: string) {
    return this.ds.query(
      `SELECT week_label, COUNT(*)::int n FROM scorecard_entries WHERE tenant_id = $1 GROUP BY week_label ORDER BY week_label`, [tid]).catch(() => []);
  }

  async review(tid: string, week?: string, functionName?: string) {
    const wk = week || await this.latestWeek(tid);
    if (!wk) return { week: null, empty: true };
    const fnFilter = functionName ? 'AND function_name = $3' : '';
    const params: any[] = functionName ? [tid, wk, functionName] : [tid, wk];
    const rows: any[] = await this.ds.query(
      `SELECT employee_no, employee_name, function_name, team_leader, net_points, function_rank,
              ${SCORE_FIELDS.map(s => s.f).join(', ')}
         FROM scorecard_entries WHERE tenant_id = $1 AND week_label = $2 ${fnFilter}`, params).catch(() => []);
    if (!rows.length) return { week: wk, empty: true };

    /* ── NOT SCORED ≠ SCORED ZERO ──────────────────────────────────────────
       `net_points ?? 0` treated an agent who was never scored that week as one
       who scored zero. That agent then fell below every function average, landed
       in `bottom` and `belowTarget`, and `scan()` wrote them a REAL open
       coaching_flags row with a notification. An HR action, created from the
       absence of evidence — the one thing this platform must never do.
       Unscored rows are excluded from every aggregate and every judgement, and
       reported separately so they are visible rather than silently dropped. */
    const scored = rows.filter(r => r.net_points != null);
    const unscored = rows.length - scored.length;
    if (!scored.length) return { week: wk, empty: true, unscored };

    const pts = (r: any) => Number(r.net_points);
    const overall = {
      count: scored.length,
      avg: +(scored.reduce((s, r) => s + pts(r), 0) / scored.length).toFixed(1),
      max: Math.max(...scored.map(pts)), min: Math.min(...scored.map(pts)),
    };

    // Per-function averages (used as the "target" each member is compared to).
    const fnAvg = new Map<string, number>(); const fnCount = new Map<string, number>();
    for (const r of scored) { fnAvg.set(r.function_name, (fnAvg.get(r.function_name) ?? 0) + pts(r)); fnCount.set(r.function_name, (fnCount.get(r.function_name) ?? 0) + 1); }
    const byFunction = [...fnAvg.entries()].map(([f, sum]) => ({ functionName: f, avg: +(sum / fnCount.get(f)!).toFixed(1), count: fnCount.get(f)! })).sort((a, b) => b.avg - a.avg);

    // Per-team-leader.
    const tlAgg = new Map<string, { sum: number; n: number }>();
    for (const r of scored) { const k = r.team_leader || '—'; const a = tlAgg.get(k) ?? { sum: 0, n: 0 }; a.sum += pts(r); a.n++; tlAgg.set(k, a); }
    const byTeamLeader = [...tlAgg.entries()].map(([tl, a]) => ({ teamLeader: tl, avg: +(a.sum / a.n).toFixed(1), count: a.n })).sort((a, b) => b.avg - a.avg);

    /* Column maxes to normalise "weakest KPI" — over EVALUATED values only.
       `Number(r[f] ?? 0) / max` gave a NULL KPI a ratio of 0, so a KPI that was
       never evaluated always won "weakest". Offline and Internship Offline carry
       no QA evaluation by rule (kpi-seed.ts), so every Offline agent was reported
       as "weakest: Quality" — and that sentence was written into their coaching
       flag. A KPI that does not apply cannot be someone's weakness. */
    const maxes: Record<string, number> = {};
    for (const s of SCORE_FIELDS) maxes[s.f] = Math.max(1, ...scored.map(r => Number(r[s.f] ?? 0)));
    const weakest = (r: any) => {
      let best: { ar: string; ratio: number } | null = null;
      for (const s of SCORE_FIELDS) {
        if (r[s.f] == null) continue;                       // not evaluated → not a weakness
        const ratio = Number(r[s.f]) / maxes[s.f];
        if (best === null || ratio < best.ratio) best = { ar: s.ar, ratio };
      }
      return best?.ar ?? '—';
    };

    const ranked = [...scored].sort((a, b) => pts(b) - pts(a));
    const top = ranked.slice(0, 5).map(r => ({ name: r.employee_name, fn: r.function_name, points: pts(r) }));
    const bottom = ranked.slice(-5).reverse().map(r => ({ name: r.employee_name, fn: r.function_name, points: pts(r), weakest: weakest(r) }));

    // Below the function average → coaching candidates.
    const belowTarget = scored.filter(r => pts(r) < (fnAvg.get(r.function_name)! / fnCount.get(r.function_name)!))
      .map(r => ({ name: r.employee_name, employeeNo: r.employee_no, fn: r.function_name, tl: r.team_leader, points: pts(r), funcAvg: +((fnAvg.get(r.function_name)! / fnCount.get(r.function_name)!)).toFixed(1), weakest: weakest(r) }))
      .sort((a, b) => a.points - b.points);

    // Weekly trend (avg net_points per week, same function filter).
    const trend: any[] = await this.ds.query(
      `SELECT week_label, AVG(net_points)::numeric(10,1) avg FROM scorecard_entries
        WHERE tenant_id = $1 ${functionName ? 'AND function_name = $2' : ''}
        GROUP BY week_label ORDER BY week_label`, functionName ? [tid, functionName] : [tid]).catch(() => []);

    return { week: wk, empty: false, unscored, overall, byFunction, byTeamLeader, top, bottom, belowTarget, coachingCandidates: belowTarget.length, trend };
  }

  async summary(tid: string) {
    const r: any = await this.review(tid).catch(() => null);
    if (!r || r.empty) return { week: null, avg: 0, belowTarget: 0, worstFunction: null };
    const worst = r.byFunction[r.byFunction.length - 1];
    return { week: r.week, avg: r.overall.avg, belowTarget: r.coachingCandidates, topPerformer: r.top[0]?.name ?? null, worstFunction: worst ? `${worst.functionName} (${worst.avg})` : null };
  }

  // Background: repeat below-average performers → coaching flags.
  private async scanAll() {
    const tenants: { id: string }[] = await this.ds.query('SELECT id FROM tenants').catch(() => []);
    for (const t of tenants) await this.scan(t.id).catch(() => {});
  }
  async scan(tid: string) {
    // Employees below their function average in the latest week, mapped to a real employee id.
    const r: any = await this.review(tid).catch(() => null);
    if (!r || r.empty || !r.belowTarget.length) return { flagged: 0 };
    let flagged = 0;
    for (const cand of r.belowTarget.slice(0, 50)) {
      const [emp] = await this.ds.query(`SELECT id FROM employees WHERE tenant_id = $1 AND employee_no = $2 LIMIT 1`, [tid, cand.employeeNo]).catch(() => []);
      if (!emp) continue;
      await this.ds.query(
        `INSERT INTO coaching_flags (tenant_id, employee_id, trigger_type, period_days, occurrences, detail, severity, status, detected_at, updated_at)
         VALUES ($1,$2,'low_scorecard',30,1,$3,'medium','open',NOW(),NOW())
         ON CONFLICT (tenant_id, employee_id, trigger_type) WHERE (status = 'open')
         DO UPDATE SET detail = $3, updated_at = NOW()`,
        [tid, emp.id, `سكور ${cand.points} تحت متوسط ${cand.fn} (${cand.funcAvg}) — الأضعف: ${cand.weakest}`]).catch(() => {});
      flagged++;
    }
    if (flagged) this.log.log(`tenant ${tid}: ${flagged} low-scorecard coaching flag(s)`);
    return { flagged };
  }
}
