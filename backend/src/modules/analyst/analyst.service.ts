import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HealthGuardService } from '@modules/health-guard/health-guard.service';

/**
 * WFM / RTA Analyst guard.
 *
 * Assesses the live operation the way a senior WFM/RTA analyst would and returns
 * a structured verdict + best-decision recommendation per area:
 *   • coverage   — per-function required/scheduled/available/gap → approve | caution | danger
 *   • schedule   — rule integrity (female / rest / policy) via the Health Guard
 *   • queues     — Sprinklr queue flow (SLA breach / backlog / waiting)
 *   • compliance — who is late (punch & system), missing punch/login, early-out
 *
 * Recommendations are logged; operator accept/reject feedback nudges adaptive
 * thresholds (analyst_thresholds) so its judgement tunes to this operation over
 * time — the deterministic "learning" loop. Natural-language narration and
 * autonomous source-research are a later LLM layer on top of this same brain.
 */

type Verdict = 'approve' | 'caution' | 'danger';
type Severity = 'ok' | 'info' | 'caution' | 'risk';
type Lang = 'ar' | 'en';

@Injectable()
export class AnalystService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly health: HealthGuardService,
  ) {}

  // ── Adaptive thresholds ─────────────────────────────────────────────────────
  private async getThreshold(tid: string, key: string, def: number): Promise<number> {
    const [r] = await this.ds.query(
      `SELECT value::float v FROM analyst_thresholds WHERE tenant_id = $1 AND key = $2`, [tid, key],
    ).catch(() => []);
    return r ? Number(r.v) : def;
  }
  private async setThreshold(tid: string, key: string, value: number) {
    await this.ds.query(
      `INSERT INTO analyst_thresholds (tenant_id, key, value, samples, updated_at)
       VALUES ($1,$2,$3,1,NOW())
       ON CONFLICT (tenant_id, key)
       DO UPDATE SET value = $3, samples = analyst_thresholds.samples + 1, updated_at = NOW()`,
      [tid, key, value],
    ).catch(() => {});
  }

  private hoursCovered(ss?: string | null, se?: string | null): number[] {
    if (!ss || !se) return [];
    const a = parseInt(String(ss).slice(0, 2), 10);
    const b = parseInt(String(se).slice(0, 2), 10);
    if (isNaN(a) || isNaN(b)) return [];
    const out: number[] = [];
    if (b > a) for (let h = a; h < b; h++) out.push(h);
    else if (b === a) out.push(a);
    else { for (let h = a; h < 24; h++) out.push(h); for (let h = 0; h < b; h++) out.push(h); }
    return out;
  }

  // ── Main assessment ─────────────────────────────────────────────────────────
  async assess(tid: string, dateQ?: string, lang: Lang = 'ar') {
    const [ld] = await this.ds.query(
      // attendance_records runs ahead of real attendance (it carries the forward
      // SCHEDULE); default the assessment day to the latest day up to today, not
      // the furthest scheduled date, so the Chief's briefing date stays sensible.
      `SELECT MAX(attendance_date)::text d FROM attendance_records WHERE tenant_id = $1 AND attendance_date <= CURRENT_DATE`, [tid],
    ).catch(() => [{ d: null }]);
    const date = dateQ ?? ld?.d ?? new Date().toISOString().slice(0, 10);
    const surplusSafe = await this.getThreshold(tid, 'surplus_safe', 2);
    const slaTarget = await this.getThreshold(tid, 'queue_sla_target', 80);
    const backlogMax = await this.getThreshold(tid, 'queue_backlog_max', 20);

    const coverage = await this.assessCoverage(tid, date, surplusSafe);
    const schedule = await this.assessSchedule(tid);
    const queues = await this.assessQueues(tid, slaTarget, backlogMax);
    const compliance = await this.assessCompliance(tid, date);

    // Persist fresh pending recommendations (preserve already-decided ones),
    // then attach each rec's DB id so the UI can give feedback without re-matching.
    // Persistence + id-matching always use the canonical Arabic title so the dedup
    // key and saved accept/reject decisions stay stable across UI languages.
    const recs = [...coverage.recs, ...schedule.recs, ...queues.recs, ...compliance.recs];
    await this.logRecommendations(tid, date, recs);
    const idRows = await this.ds.query(
      `SELECT id, area, title, decision FROM analyst_recommendations WHERE tenant_id = $1 AND scope_date = $2::date`,
      [tid, date]).catch(() => []);
    const idMap = new Map<string, { id: string; decision: string }>(
      idRows.map((r: any) => [`${r.area}|${r.title}`, { id: r.id, decision: r.decision }] as [string, { id: string; decision: string }]));
    for (const r of recs) { const m = idMap.get(`${r.area}|${r.title}`); r.id = m?.id ?? null; r.decision = m?.decision ?? 'pending'; }

    // Now that persistence/matching is done, swap display text to the requested
    // language (mutates the same objects referenced by coverage/schedule/… .recs).
    if (lang === 'en') {
      for (const r of recs) {
        if (r.titleEn) r.title = r.titleEn;
        if (r.summaryEn) r.summary = r.summaryEn;
        if (r.recommendationEn) r.recommendation = r.recommendationEn;
      }
      for (const o of compliance.offenders) if (o.issuesEn) o.issues = o.issuesEn;
    }
    for (const r of recs) { delete r.titleEn; delete r.summaryEn; delete r.recommendationEn; }
    for (const o of compliance.offenders) delete o.issuesEn;

    // Headline = worst area.
    const order: Severity[] = ['risk', 'caution', 'info', 'ok'];
    const worst = [coverage.severity, schedule.severity, queues.severity, compliance.severity]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];

    return {
      date,
      headline: worst,
      thresholds: { surplusSafe, slaTarget, backlogMax },
      coverage, schedule, queues, compliance,
    };
  }

  // ── Coverage / capacity decision per function ───────────────────────────────
  private async assessCoverage(tid: string, date: string, surplusSafe: number) {
    const roster = await this.ds.query(
      `SELECT e.function_id, COALESCE(f.name,'—') fn,
              to_char(ar.scheduled_start,'HH24:MI') ss, to_char(ar.scheduled_end,'HH24:MI') se,
              ar.attendance_marker marker,
              ar.punch_late_minutes late, ar.punch_early_out_minutes early, ar.ot_minutes ot
         FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
        WHERE ar.tenant_id = $1 AND ar.attendance_date = $2::date
          AND ar.scheduled_start IS NOT NULL
          AND ar.attendance_marker IN ('present','absent','sick')`, [tid, date]).catch(() => []);
    const perms = await this.ds.query(
      `SELECT COALESCE(rp.function_id, e.function_id) function_id,
              to_char(rp.start_time,'HH24:MI') ss, to_char(rp.end_time,'HH24:MI') se
         FROM request_permissions rp JOIN requests r ON r.id = rp.request_id
         LEFT JOIN employees e ON e.id = r.employee_id
        WHERE r.tenant_id = $1 AND rp.permission_date = $2::date AND r.status IN ('approved','pending')`,
      [tid, date]).catch(() => []);
    const hist = await this.ds.query(
      `SELECT e.function_id, ar.attendance_date::text d,
              to_char(ar.scheduled_start,'HH24:MI') ss, to_char(ar.scheduled_end,'HH24:MI') se
         FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id
        WHERE ar.tenant_id = $1 AND ar.scheduled_start IS NOT NULL AND ar.attendance_marker = 'present'
          AND ar.attendance_date < $2::date
          AND EXTRACT(DOW FROM ar.attendance_date) = EXTRACT(DOW FROM $2::date)
          AND ar.attendance_date >= $2::date - INTERVAL '7 weeks'`, [tid, date]).catch(() => []);

    type Agg = { id: string; name: string; sched: number[]; down: number[]; reqSum: number[]; dates: Set<string> };
    const fns = new Map<string, Agg>();
    const get = (id: string, name: string) => {
      if (!fns.has(id)) fns.set(id, { id, name, sched: Array(24).fill(0), down: Array(24).fill(0), reqSum: Array(24).fill(0), dates: new Set() });
      return fns.get(id)!;
    };
    for (const r of roster) {
      const a = get(r.function_id ?? 'none', r.fn);
      const hrs = this.hoursCovered(r.ss, r.se);
      for (const h of hrs) {
        a.sched[h]++;
        if (r.marker === 'sick' || r.marker === 'absent') a.down[h]++;
      }
      if (r.marker === 'present') {
        const nl = Math.min(Math.ceil((r.late ?? 0) / 60), hrs.length);
        for (let i = 0; i < nl; i++) a.down[hrs[i]]++;
        const ne = Math.min(Math.ceil((r.early ?? 0) / 60), hrs.length);
        for (let i = 0; i < ne; i++) a.down[hrs[hrs.length - 1 - i]]++;
      }
    }
    for (const p of perms) { const a = fns.get(p.function_id ?? 'none'); if (a) for (const h of this.hoursCovered(p.ss, p.se)) a.down[h]++; }
    const hb = new Map<string, Map<string, number[]>>();
    for (const r of hist) {
      const id = r.function_id ?? 'none';
      if (!hb.has(id)) hb.set(id, new Map());
      const m = hb.get(id)!; if (!m.has(r.d)) m.set(r.d, Array(24).fill(0));
      for (const h of this.hoursCovered(r.ss, r.se)) m.get(r.d)![h]++;
    }
    for (const [id, m] of hb) { const a = fns.get(id); if (!a) continue; for (const d of [...m.keys()].sort().slice(-6)) { for (let h = 0; h < 24; h++) a.reqSum[h] += m.get(d)![h]; a.dates.add(d); } }

    const functions: any[] = [];
    const recs: any[] = [];
    for (const a of fns.values()) {
      const nH = Math.max(a.dates.size, 1);
      const opHours: { hour: number; required: number; available: number; gap: number }[] = [];
      for (let h = 0; h < 24; h++) {
        const required = Math.round(a.reqSum[h] / nH);
        const available = Math.max(0, a.sched[h] - a.down[h]);
        if (a.sched[h] > 0 || required > 0) opHours.push({ hour: h, required, available, gap: available - required });
      }
      if (!opHours.length) continue;
      const bottleneck = opHours.reduce((m, x) => x.gap < m.gap ? x : m, opHours[0]);
      const uncovered = opHours.filter(x => x.required > 0 && x.available === 0);
      const verdict: Verdict = bottleneck.gap < 0 ? 'danger' : bottleneck.gap < surplusSafe ? 'caution' : 'approve';
      const severity: Severity = verdict === 'danger' ? 'risk' : verdict === 'caution' ? 'caution' : 'ok';

      let summary: string, recommendation: string, summaryEn: string, recommendationEn: string;
      if (verdict === 'danger') {
        summary = `نقص تغطية: القسم ${a.name} يقصّر ${-bottleneck.gap} عند الساعة ${pad(bottleneck.hour)} (مطلوب ${bottleneck.required}, متاح ${bottleneck.available}).`;
        recommendation = `خطر — لا توافق على إجازات/استئذان بهالساعة. غطِّ النقص بأوفرتايم أو نقل cross-skill أو استدعاء، خصوصاً ${pad(bottleneck.hour)}.`;
        summaryEn = `Coverage shortfall: ${a.name} is short ${-bottleneck.gap} at ${pad(bottleneck.hour)} (required ${bottleneck.required}, available ${bottleneck.available}).`;
        recommendationEn = `Risk — don't approve leave/permission at this hour. Fill the gap with overtime, cross-skill transfer or call-in, especially ${pad(bottleneck.hour)}.`;
      } else if (verdict === 'caution') {
        summary = `تغطية محدودة: أضيق نقطة بالقسم ${a.name} فائض ${bottleneck.gap} فقط عند ${pad(bottleneck.hour)}.`;
        recommendation = `بحذر — تقدر توافق على ${bottleneck.gap} كحد أقصى بهالساعة، وراقب عن قرب.`;
        summaryEn = `Tight coverage: ${a.name}'s tightest point has only a ${bottleneck.gap} surplus at ${pad(bottleneck.hour)}.`;
        recommendationEn = `Caution — you can approve at most ${bottleneck.gap} at this hour; watch closely.`;
      } else {
        summary = `فائض آمن: القسم ${a.name} عنده فائض لا يقل عن ${bottleneck.gap} طوال اليوم.`;
        recommendation = `تقدر توافق على لغاية ${bottleneck.gap} استئذان/إجازة بأضيق ساعة (${pad(bottleneck.hour)}) أو تحرّر أوفرتايم/تنقل للنقص بقسم ثاني.`;
        summaryEn = `Safe surplus: ${a.name} keeps a surplus of at least ${bottleneck.gap} all day.`;
        recommendationEn = `You can approve up to ${bottleneck.gap} permission/leave at the tightest hour (${pad(bottleneck.hour)}), or free overtime / move to cover a shortfall elsewhere.`;
      }
      if (uncovered.length) {
        const hrsList = uncovered.map(x => pad(x.hour)).join(', ');
        recommendation += ` ⚠ ساعات بلا أي تغطية: ${hrsList}.`;
        recommendationEn += ` ⚠ Hours with no coverage at all: ${hrsList}.`;
      }

      functions.push({ functionId: a.id, functionName: a.name, verdict, bottleneck, uncovered: uncovered.map(x => x.hour), hours: opHours });
      recs.push({ area: 'coverage', functionId: a.id === 'none' ? null : a.id, functionName: a.name, severity, verdict, title: `التغطية — ${a.name}`, titleEn: `Coverage — ${a.name}`, summary, summaryEn, recommendation, recommendationEn, metrics: { bottleneckHour: bottleneck.hour, bottleneckGap: bottleneck.gap, required: bottleneck.required, available: bottleneck.available, uncovered: uncovered.map(x => x.hour) } });
    }
    functions.sort((a, b) => ({ danger: 0, caution: 1, approve: 2 } as any)[a.verdict] - ({ danger: 0, caution: 1, approve: 2 } as any)[b.verdict]);
    const severity: Severity = functions.some(f => f.verdict === 'danger') ? 'risk' : functions.some(f => f.verdict === 'caution') ? 'caution' : 'ok';
    return { severity, functions, recs };
  }

  // ── Schedule integrity (reuse Health Guard rule checks) ─────────────────────
  private async assessSchedule(tid: string) {
    const report = await this.health.run(tid).catch(() => null);
    const recs: any[] = [];
    let severity: Severity = 'ok';
    const findings = report ? report.checks.filter(c => c.category === 'calculation' && c.status !== 'pass' && c.status !== 'skip') : [];
    for (const c of findings) {
      const sev: Severity = c.status === 'fail' ? 'risk' : 'caution';
      if (sev === 'risk') severity = 'risk'; else if (severity === 'ok') severity = 'caution';
      recs.push({ area: 'schedule', functionId: null, functionName: null, severity: sev, verdict: null, title: `الجدول — ${c.labelAr}`, titleEn: `Schedule — ${c.label}`, summary: `${c.count} حالة: ${c.detail}`, summaryEn: `${c.count} case(s): ${c.detail}`, recommendation: c.status === 'fail' ? 'مخالفة قاعدة صارمة — عدّل الجدول قبل النشر.' : 'راجع وأكّد إن كان استثناء مقصود.', recommendationEn: c.status === 'fail' ? 'Hard-rule violation — fix the schedule before publishing.' : 'Review and confirm whether it is an intended exception.', metrics: { count: c.count, sample: c.sample ?? [] } });
    }
    return { severity, findings, recs };
  }

  // ── Queue flow (Sprinklr) ───────────────────────────────────────────────────
  private async assessQueues(tid: string, slaTarget: number, backlogMax: number) {
    const [snap] = await this.ds.query(
      `SELECT queues_json, captured_at FROM integration_snapshots
        WHERE tenant_id = $1 AND source = 'sprinklr' ORDER BY captured_at DESC LIMIT 1`, [tid]).catch(() => []);
    const recs: any[] = [];
    if (!snap?.queues_json) return { severity: 'info' as Severity, capturedAt: null, queues: [], recs };
    const arr: any[] = Array.isArray(snap.queues_json) ? snap.queues_json : (snap.queues_json.queues ?? []);
    const problems = arr.map(q => {
      const sla = Number(q.slaPct ?? 100), backlog = Number(q.backlog ?? 0), waiting = Number(q.waiting ?? 0), breached = Number(q.slaBreached ?? 0);
      const bad = sla < slaTarget || backlog > backlogMax || breached > 0;
      return { name: q.queueName ?? q.queueId, channel: q.channel, sla, backlog, waiting, breached, agentsAvailable: Number(q.agentsAvailable ?? 0), bad };
    }).filter(q => q.bad).sort((a, b) => a.sla - b.sla);
    const severity: Severity = problems.some(p => p.sla < slaTarget * 0.75 || p.breached > 0) ? 'risk' : problems.length ? 'caution' : 'ok';
    for (const p of problems.slice(0, 8)) {
      recs.push({ area: 'queues', functionId: null, functionName: p.name, severity: (p.sla < slaTarget * 0.75 || p.breached > 0 ? 'risk' : 'caution') as Severity, verdict: null,
        title: `الكيو — ${p.name}`,
        titleEn: `Queue — ${p.name}`,
        summary: `SLA ${p.sla}% · باكلوج ${p.backlog} · بالانتظار ${p.waiting} · متاح ${p.agentsAvailable}${p.breached ? ` · خرق SLA ${p.breached}` : ''}.`,
        summaryEn: `SLA ${p.sla}% · backlog ${p.backlog} · waiting ${p.waiting} · available ${p.agentsAvailable}${p.breached ? ` · SLA breached ${p.breached}` : ''}.`,
        recommendation: p.agentsAvailable === 0 ? 'لا يوجد متاح — حرّك cross-skill أو أنهِ بريكات أو أوفرتايم فوراً.' : 'وجّه المتاحين لهالكيو أو قلّل البريكات حتى ينزل الباكلوج.',
        recommendationEn: p.agentsAvailable === 0 ? 'No one available — move cross-skill, end breaks, or add overtime immediately.' : 'Route available agents to this queue or cut breaks until the backlog drops.',
        metrics: { sla: p.sla, backlog: p.backlog, waiting: p.waiting, breached: p.breached, agentsAvailable: p.agentsAvailable } });
    }
    return { severity, capturedAt: snap.captured_at, queues: problems, recs };
  }

  // ── Compliance / incidents (lateness, missing punch) ────────────────────────
  private async assessCompliance(tid: string, date: string) {
    const rows = await this.ds.query(
      `SELECT e.id, e.first_name_en, e.last_name_en, e.employee_no, COALESCE(f.name,'—') fn,
              ar.punch_late_minutes pl, ar.system_late_minutes sl,
              ar.punch_early_out_minutes pe, ar.system_early_out_minutes se,
              ar.is_missing_punch mp, ar.is_missing_system ms
         FROM attendance_records ar JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
        WHERE ar.tenant_id = $1 AND ar.attendance_date = $2::date
          AND ar.attendance_marker = 'present'
          AND ( ar.punch_late_minutes > 0 OR ar.system_late_minutes > 0
             OR ar.punch_early_out_minutes > 0 OR ar.system_early_out_minutes > 0
             OR ar.is_missing_punch = true OR ar.is_missing_system = true )`, [tid, date]).catch(() => []);
    const offenders = rows.map((r: any) => {
      const score = (r.pl ?? 0) + (r.sl ?? 0) + (r.pe ?? 0) + (r.se ?? 0) + (r.mp ? 30 : 0) + (r.ms ? 30 : 0);
      const issues: string[] = [];
      const issuesEn: string[] = [];
      if (r.pl) { issues.push(`تأخير بصمة ${r.pl}د`); issuesEn.push(`punch late ${r.pl}m`); }
      if (r.sl) { issues.push(`تأخير سيستم ${r.sl}د`); issuesEn.push(`system late ${r.sl}m`); }
      if (r.pe) { issues.push(`خروج مبكر ${r.pe}د`); issuesEn.push(`early out ${r.pe}m`); }
      if (r.se) { issues.push(`خروج سيستم مبكر ${r.se}د`); issuesEn.push(`system early out ${r.se}m`); }
      if (r.mp) { issues.push('بصمة ناقصة'); issuesEn.push('missing punch'); }
      if (r.ms) { issues.push('لوجين ناقص'); issuesEn.push('missing login'); }
      return { employeeId: r.id, name: `${r.first_name_en} ${r.last_name_en}`, employeeNo: r.employee_no, fn: r.fn, score, issues, issuesEn };
    }).sort((a, b) => b.score - a.score);

    const recs: any[] = [];
    let severity: Severity = offenders.length ? 'caution' : 'ok';
    // Recurring offenders (already coaching-flagged) → escalate to incident.
    const flagged: { employee_id: string; occurrences: number }[] = await this.ds.query(
      `SELECT employee_id, occurrences FROM coaching_flags WHERE tenant_id = $1 AND status = 'open'`, [tid]).catch(() => []);
    const flagMap = new Map(flagged.map(f => [f.employee_id, f.occurrences]));
    const repeat = offenders.filter(o => flagMap.has(o.employeeId));
    if (repeat.length) severity = 'risk';
    if (offenders.length) {
      const top = offenders.slice(0, 5).map(o => `${o.name} (${o.issues.join('، ')})`).join('؛ ');
      const topEn = offenders.slice(0, 5).map(o => `${o.name} (${o.issuesEn.join(', ')})`).join('; ');
      recs.push({ area: 'compliance', functionId: null, functionName: null, severity, verdict: null,
        title: `عدم الالتزام اليوم — ${offenders.length} موظف`,
        titleEn: `Non-compliance today — ${offenders.length} staff`,
        summary: `${offenders.length} غير ملتزمين. الأعلى: ${top}.`,
        summaryEn: `${offenders.length} non-compliant. Top: ${topEn}.`,
        recommendation: repeat.length
          ? `${repeat.length} منهم متكرّرين ومعلّمين بالكوتشينج — افتح إنسيدنت/جلسة كوتشينج لـ ${repeat.slice(0, 3).map(o => o.name).join('، ')}.`
          : 'وجّه تنبيه للأعلى تأخيراً؛ لو تكرّر يتحوّل لإنسيدنت كوتشينج تلقائياً.',
        recommendationEn: repeat.length
          ? `${repeat.length} of them are repeat, coaching-flagged offenders — open an incident/coaching session for ${repeat.slice(0, 3).map(o => o.name).join(', ')}.`
          : 'Warn the latest offenders; if it repeats it auto-escalates to a coaching incident.',
        metrics: { total: offenders.length, repeat: repeat.length, top: offenders.slice(0, 10) } });
    }
    return { severity, offenders: offenders.slice(0, 25), recs };
  }

  // ── Persist recommendations (fresh pending; keep decided ones) ──────────────
  private async logRecommendations(tid: string, date: string, recs: any[]) {
    await this.ds.query(
      `DELETE FROM analyst_recommendations WHERE tenant_id = $1 AND scope_date = $2::date AND decision = 'pending'`,
      [tid, date]).catch(() => {});
    for (const r of recs) {
      await this.ds.query(
        `INSERT INTO analyst_recommendations
           (tenant_id, scope_date, area, function_id, function_name, severity, verdict, title, summary, recommendation, metrics)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tenant_id, scope_date, area, title)
         DO NOTHING`,
        [tid, date, r.area, r.functionId, r.functionName, r.severity, r.verdict, r.title, r.summary, r.recommendation, JSON.stringify(r.metrics ?? {})],
      ).catch(() => {});
    }
  }

  // ── Operator feedback → adapt thresholds (the learning loop) ────────────────
  async feedback(tid: string, recId: string, decision: 'accepted' | 'rejected', userId: string, note?: string) {
    const res: any = await this.ds.query(
      `UPDATE analyst_recommendations SET decision = $3, decided_by = $4, decided_at = NOW(), note = $5
        WHERE id = $1 AND tenant_id = $2 RETURNING area, verdict`, [recId, tid, decision, userId, note ?? null]);
    // TypeORM returns [rows, affectedCount] for UPDATE…RETURNING (vs plain rows for INSERT).
    const rows = Array.isArray(res?.[0]) ? res[0] : res;
    const rec = rows?.[0];
    if (!rec) return { ok: false };
    // Coverage "approve" recommendations train the surplus-safety threshold.
    if (rec.area === 'coverage' && rec.verdict === 'approve') {
      const cur = await this.getThreshold(tid, 'surplus_safe', 2);
      // Accepted → trust slimmer surplus (lower, min 1). Rejected → demand more buffer (higher, max 5).
      const next = decision === 'accepted' ? Math.max(1, +(cur - 0.25).toFixed(2)) : Math.min(5, +(cur + 0.5).toFixed(2));
      await this.setThreshold(tid, 'surplus_safe', next);
      return { ok: true, learned: { key: 'surplus_safe', from: cur, to: next } };
    }
    return { ok: true };
  }

  async history(tid: string, limit = 50) {
    return this.ds.query(
      `SELECT id, scope_date, area, function_name, severity, verdict, title, summary, recommendation,
              decision, decided_at, note, created_at
         FROM analyst_recommendations WHERE tenant_id = $1
        ORDER BY COALESCE(decided_at, created_at) DESC LIMIT $2`, [tid, limit]).catch(() => []);
  }
}

function pad(h: number) { return `${String(h).padStart(2, '0')}:00`; }
