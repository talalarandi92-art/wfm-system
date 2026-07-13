import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AgentRunner } from '@common/agent-runner';

/**
 * Coaching trigger engine.
 * Scans attendance over a rolling window and raises coaching_flags for
 * employees with repeated issues (late / early-out / missing punch). Idempotent
 * via the partial unique index on open flags. Runs in the background daily and
 * on demand. Notifies the employee's reviewers.
 */
@Injectable()
export class CoachingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CoachingService.name);
  private timer?: NodeJS.Timeout;
  private static readonly THRESHOLD = 3;   // occurrences in window → flag
  private static readonly WINDOW    = 30;  // days

  // Late / early-out only count when NOT covered by an approved permission that
  // day (authorized permissions must not trigger coaching). `perm` is the
  // LATERAL join added in scan().
  private static readonly TRIGGERS = [
    { type: 'repeated_late',      col: 'CASE WHEN ar.punch_late_minutes > 0 AND NOT COALESCE(perm.perm_late, FALSE) THEN 1 ELSE 0 END',      ar: 'تأخّر متكرر' },
    { type: 'repeated_early_out', col: 'CASE WHEN ar.punch_early_out_minutes > 0 AND NOT COALESCE(perm.perm_early, FALSE) THEN 1 ELSE 0 END', ar: 'خروج مبكر متكرر' },
    { type: 'missing_punch',      col: 'CASE WHEN ar.is_missing_punch THEN 1 ELSE 0 END',            ar: 'بصمات ناقصة متكررة' },
  ];

  private readonly runner: AgentRunner;
  constructor(@InjectDataSource() private readonly ds: DataSource) {
    this.runner = new AgentRunner(this.ds, 'coaching-loop');
  }

  onModuleInit() {
    setTimeout(() => this.run(), 60_000);                 // first scan ~1 min after boot
    this.timer = setInterval(() => this.run(), 6 * 3600_000); // every 6h
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  // Advisory-lock exclusive so multi-instance never double-flags/double-notifies. The manual
  // per-tenant scan(tid) path (controller) is intentionally NOT gated.
  private run() {
    this.runner.runExclusive(() => this.scanAllTenants())
      .catch(e => this.logger.warn(`coaching scan failed: ${e.message}`));
  }

  private severityOf(n: number): string {
    return n >= CoachingService.THRESHOLD * 2 ? 'high' : n >= CoachingService.THRESHOLD + 1 ? 'medium' : 'low';
  }

  async scanAllTenants(): Promise<number> {
    const tenants = await this.ds.query(`SELECT id FROM tenants`).catch(() => []);
    let total = 0;
    for (const t of tenants) total += await this.scan(t.id);
    return total;
  }

  /** Scan one tenant; upsert flags for employees crossing the threshold. Returns flags touched. */
  async scan(tenantId: string): Promise<number> {
    const agg = await this.ds.query(
      `SELECT ar.employee_id,
              SUM(${CoachingService.TRIGGERS[0].col}) AS repeated_late,
              SUM(${CoachingService.TRIGGERS[1].col}) AS repeated_early_out,
              SUM(${CoachingService.TRIGGERS[2].col}) AS missing_punch
         FROM attendance_records ar
         LEFT JOIN LATERAL (
           SELECT COALESCE(bool_or(rp.permission_type = 'late_in'), FALSE) AS perm_late,
                  COALESCE(bool_or(rp.permission_type IN ('early_out','temp_out')), FALSE) AS perm_early
             FROM request_permissions rp JOIN requests rq ON rq.id = rp.request_id
            WHERE rq.tenant_id = ar.tenant_id AND rq.employee_id = ar.employee_id
              AND rq.status = 'approved' AND rp.permission_date = ar.attendance_date
         ) perm ON TRUE
        WHERE ar.tenant_id = $1 AND ar.attendance_date >= CURRENT_DATE - ($2 || ' days')::interval
        GROUP BY ar.employee_id`,
      [tenantId, CoachingService.WINDOW],
    ).catch(() => []);

    let touched = 0;
    for (const row of agg) {
      for (const trig of CoachingService.TRIGGERS) {
        const n = parseInt(row[trig.type], 10) || 0;
        if (n < CoachingService.THRESHOLD) continue;
        const detail = `${trig.ar}: ${n} مرة خلال ${CoachingService.WINDOW} يوم`;
        const [flag] = await this.ds.query(
          `INSERT INTO coaching_flags
             (tenant_id, employee_id, trigger_type, period_days, occurrences, detail, evidence, severity, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'open')
           ON CONFLICT (tenant_id, employee_id, trigger_type) WHERE status = 'open'
           DO UPDATE SET occurrences = EXCLUDED.occurrences, detail = EXCLUDED.detail,
                         evidence = EXCLUDED.evidence, severity = EXCLUDED.severity, updated_at = NOW()
           RETURNING id, (xmax = 0) AS inserted`,
          [tenantId, row.employee_id, trig.type, CoachingService.WINDOW, n, detail,
           JSON.stringify({ occurrences: n, windowDays: CoachingService.WINDOW }), this.severityOf(n)],
        ).catch(() => [null]);
        if (flag) {
          touched++;
          if (flag.inserted) await this.notifyNewFlag(tenantId, row.employee_id, detail);
        }
      }
    }
    if (touched) this.logger.log(`[${tenantId}] coaching scan: ${touched} flag(s) raised/refreshed`);
    return touched;
  }

  private async notifyNewFlag(tenantId: string, employeeId: string, detail: string) {
    const reviewers = await this.ds.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
        WHERE u.tenant_id = $1 AND r.code IN ('team_leader','wfm_analyst','wfm_supervisor','operations_manager','platform_admin')`,
      [tenantId],
    ).catch(() => []);
    const [emp] = await this.ds.query(
      `SELECT first_name_en || ' ' || COALESCE(last_name_en,'') AS name FROM employees WHERE id = $1`, [employeeId],
    ).catch(() => [{ name: '' }]);
    for (const rv of reviewers) {
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id)
         VALUES ($1,$2,'coaching.flag','Coaching needed','كوتشينج مطلوب', $3, $3, 'employee', $4)`,
        [tenantId, rv.id, `${String(emp?.name).trim()} — ${detail}`, employeeId],
      ).catch(() => {});
    }
  }

  /* ── Read / manage flags ──────────────────────────────────────────────── */
  async listFlags(tenantId: string, status = 'open') {
    const rows = await this.ds.query(
      `SELECT cf.id, cf.trigger_type, cf.occurrences, cf.detail, cf.severity, cf.status,
              cf.detected_at, cf.period_days, cf.coaching_session_id,
              e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              f.name AS function_name
         FROM coaching_flags cf
         JOIN employees e ON e.id = cf.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
        WHERE cf.tenant_id = $1 ${status === 'all' ? '' : 'AND cf.status = $2'}
        ORDER BY CASE cf.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, cf.detected_at DESC
        LIMIT 500`,
      status === 'all' ? [tenantId] : [tenantId, status],
    ).catch(() => []);
    return rows.map((r: any) => ({
      id: r.id, triggerType: r.trigger_type, occurrences: r.occurrences,
      detail: r.detail, severity: r.severity, status: r.status,
      detectedAt: r.detected_at, periodDays: r.period_days,
      coachingSessionId: r.coaching_session_id,
      employeeNo: r.employee_no, employeeName: (r.employee_name ?? '').trim(),
      function: r.function_name,
    }));
  }

  async resolveFlag(tenantId: string, id: string, status: 'addressed' | 'dismissed', userId: string) {
    await this.ds.query(
      `UPDATE coaching_flags SET status = $3, resolved_at = NOW(), resolved_by = $4, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'open'`,
      [id, tenantId, status, userId],
    );
    return { id, status };
  }

  /** Turn a coaching flag into a scheduled 1:1 (coaching_sessions) and close the flag. */
  async scheduleSession(
    tenantId: string, flagId: string, userId: string,
    opts: { scheduledAt?: string; durationMinutes?: number; notes?: string },
  ) {
    const [flag] = await this.ds.query(
      `SELECT id, employee_id, trigger_type, detail FROM coaching_flags
        WHERE id = $1 AND tenant_id = $2`,
      [flagId, tenantId],
    );
    if (!flag) return { error: 'flag_not_found' };

    // Default to tomorrow 10:00 if no time supplied.
    const when = opts.scheduledAt
      ? new Date(opts.scheduledAt)
      : (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; })();

    const [session] = await this.ds.query(
      `INSERT INTO coaching_sessions
         (tenant_id, employee_id, coach_id, scheduled_at, duration_minutes, status, focus_areas, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,'scheduled',$6,$7,$3)
       RETURNING id`,
      [tenantId, flag.employee_id, userId, when.toISOString(),
       opts.durationMinutes ?? 30, [flag.trigger_type], opts.notes ?? flag.detail],
    );

    await this.ds.query(
      `UPDATE coaching_flags
          SET coaching_session_id = $3, status = 'addressed', resolved_by = $4, resolved_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND tenant_id = $2`,
      [flagId, tenantId, session.id, userId],
    );

    // Notify the employee's linked user, if any.
    const [eu] = await this.ds.query(
      `SELECT id FROM users WHERE employee_id = $1 AND tenant_id = $2 LIMIT 1`,
      [flag.employee_id, tenantId],
    ).catch(() => [null]);
    if (eu) {
      const whenStr = when.toLocaleString('ar-KW', { dateStyle: 'short', timeStyle: 'short' });
      await this.ds.query(
        `INSERT INTO notifications (tenant_id, recipient_id, notification_type, title, title_ar, body, body_ar, entity_type, entity_id)
         VALUES ($1,$2,'coaching.session','Coaching session scheduled','جلسة كوتشينج مجدولة', $3, $4, 'coaching_session', $5)`,
        [tenantId, eu.id, `You have a coaching session — ${whenStr}`, `لديك جلسة كوتشينج — ${whenStr}`, session.id],
      ).catch(() => {});
    }

    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, action, module, entity_type, entity_id, notes)
       VALUES ($1,$2,'coaching.session_scheduled','coaching','coaching_flag',$3,$4)`,
      [tenantId, userId, flagId, `1:1 scheduled (${flag.trigger_type})`],
    ).catch(() => {});

    return { sessionId: session.id, scheduledAt: when.toISOString(), flagId };
  }

  /** List scheduled/recent coaching sessions. */
  async listSessions(tenantId: string) {
    const rows = await this.ds.query(
      `SELECT cs.id, cs.scheduled_at, cs.duration_minutes, cs.status, cs.focus_areas, cs.notes,
              cs.follow_up_date, cs.employee_acknowledged,
              e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              ${'COALESCE(NULLIF(TRIM(COALESCE(u.first_name,\'\')||\' \'||COALESCE(u.last_name,\'\')),\'\'), u.username, u.email)'} AS coach
         FROM coaching_sessions cs
         JOIN employees e ON e.id = cs.employee_id
         LEFT JOIN users u ON u.id = cs.coach_id
        WHERE cs.tenant_id = $1
        ORDER BY cs.scheduled_at DESC LIMIT 200`,
      [tenantId],
    ).catch(() => []);
    return rows.map((r: any) => ({
      id: r.id, scheduledAt: r.scheduled_at, durationMinutes: r.duration_minutes,
      status: r.status, focusAreas: r.focus_areas ?? [], notes: r.notes,
      followUpDate: r.follow_up_date, acknowledged: r.employee_acknowledged,
      employeeNo: r.employee_no, employeeName: (r.employee_name ?? '').trim(), coach: r.coach,
    }));
  }
}
