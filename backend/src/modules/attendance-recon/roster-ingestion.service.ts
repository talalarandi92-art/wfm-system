import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Workbook } from 'exceljs';
import { ReconService } from './recon.service';

/** Support / management roles (not frontline contact agents): RTA, team leaders,
 *  specialists, customer care, support. Excluded from agent metrics by default. */
const isSupportFunc = (f: any) => /\b(rta|leader|specialist|customer\s*care|support)\b/i.test(String(f || ''));

/**
 * Roster ingestion: parses the heavy source exports ONCE (Ameyo 72MB CSV +
 * Sprinklr + Odoo + schedule) via ReconService, then persists the per-employee /
 * per-day result into an indexed table. The roster UI and reports then QUERY the
 * table (filtered by date range) instead of re-parsing files on every load — this
 * is what lets the system scale to years of history: queries stay sub-second and
 * memory stays bounded, while the expensive parse runs only when new data lands.
 */
@Injectable()
export class RosterIngestionService {
  private readonly logger = new Logger(RosterIngestionService.name);
  private ready = false;
  // Concurrency guard: the parse is heavy (~30s, blocks while running). With many
  // users hitting an empty roster at once we must NOT launch N parallel parses —
  // they all await the single in-flight one. Read queries never touch this.
  private inFlight: Promise<{ rows: number; ms: number }> | null = null;

  constructor(private readonly dataSource: DataSource, private readonly recon: ReconService) {}

  /** Create the storage table + indexes if missing (matches the codebase's raw-SQL pattern). */
  async ensureTable(): Promise<void> {
    if (this.ready) return;
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS roster_daily (
        tenant_id        uuid    NOT NULL,
        employee_no      text    NOT NULL,
        name             text,
        func             text,
        work_date        date    NOT NULL,
        shift_start_min  int,
        shift_end_min    int,
        presence         text,
        system_late_min  int,
        punch_late_min   int,
        system_early_min int,
        ot_after_min     int,
        ot_rounded_min   int,
        conformance_pct  int,
        flags            jsonb,
        computed_at      timestamptz DEFAULT now(),
        PRIMARY KEY (tenant_id, employee_no, work_date)
      );
      CREATE INDEX IF NOT EXISTS idx_roster_daily_date ON roster_daily (tenant_id, work_date);
      CREATE INDEX IF NOT EXISTS idx_roster_daily_emp  ON roster_daily (tenant_id, employee_no);
      ALTER TABLE roster_daily ADD COLUMN IF NOT EXISTS payload jsonb;
      ALTER TABLE roster_daily ADD COLUMN IF NOT EXISTS manager_note text;
    `);
    this.ready = true;
  }

  /** Parse the sources once and upsert every (employee, day) row. Concurrency-safe:
   *  parallel callers share the single in-flight parse instead of stampeding. */
  async ingest(tenantId: string, dir: string, scheduleFile: string): Promise<{ rows: number; ms: number }> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doIngest(tenantId, dir, scheduleFile).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async doIngest(tenantId: string, dir: string, scheduleFile: string): Promise<{ rows: number; ms: number }> {
    await this.ensureTable();
    const t0 = Date.now();
    const result = this.recon.run(dir, scheduleFile);   // heavy parse (cached in ReconService)
    const rows = result.rows;
    // The recompute is the source of truth — a day that is no longer produced (e.g. an
    // off-day whose OT we now reject as bleed) must DISAPPEAR, not linger. Upsert alone
    // leaves orphans, so clear the tenant's rows first. Manager notes are preserved
    // across the wipe (they're re-applied below) so annotations are never lost.
    const notes = await this.dataSource.query(
      `SELECT employee_no, work_date::text AS d, manager_note FROM roster_daily WHERE tenant_id=$1 AND manager_note IS NOT NULL AND manager_note <> ''`, [tenantId]);
    await this.dataSource.query(`DELETE FROM roster_daily WHERE tenant_id=$1`, [tenantId]);
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const vals: any[] = []; const ph: string[] = [];
      slice.forEach((r, j) => {
        const b = j * 15;
        ph.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14}::jsonb,$${b + 15}::jsonb)`);
        vals.push(tenantId, r.employeeId, r.name, r.func, r.date, r.shiftStartMin, r.shiftEndMin, r.presence,
          r.systemLateMin, r.punchLateMin, (r as any).systemEarlyOutMin ?? null, r.otAfterMin, r.otRoundedMin, JSON.stringify(r.flags || []),
          JSON.stringify(r));   // full ReconRow so the UI gets every field (effective late, OT before/after, etc.)
      });
      await this.dataSource.query(
        `INSERT INTO roster_daily
           (tenant_id, employee_no, name, func, work_date, shift_start_min, shift_end_min, presence,
            system_late_min, punch_late_min, system_early_min, ot_after_min, ot_rounded_min, flags, payload)
         VALUES ${ph.join(',')}
         ON CONFLICT (tenant_id, employee_no, work_date) DO UPDATE SET
           name=EXCLUDED.name, func=EXCLUDED.func, shift_start_min=EXCLUDED.shift_start_min,
           shift_end_min=EXCLUDED.shift_end_min, presence=EXCLUDED.presence,
           system_late_min=EXCLUDED.system_late_min, punch_late_min=EXCLUDED.punch_late_min,
           system_early_min=EXCLUDED.system_early_min, ot_after_min=EXCLUDED.ot_after_min,
           ot_rounded_min=EXCLUDED.ot_rounded_min, flags=EXCLUDED.flags, payload=EXCLUDED.payload, computed_at=now()`,
        vals,
      );
    }
    // Re-apply preserved manager notes onto the freshly inserted rows.
    for (const nt of notes) {
      await this.dataSource.query(
        `UPDATE roster_daily SET manager_note=$4 WHERE tenant_id=$1 AND employee_no=$2 AND work_date=$3`,
        [tenantId, nt.employee_no, nt.d, nt.manager_note]);
    }
    const ms = Date.now() - t0;
    this.logger.log(`[${tenantId}] ingested ${rows.length} roster rows in ${ms}ms (notes preserved: ${notes.length})`);
    return { rows: rows.length, ms };
  }

  /** Fast indexed query for the roster UI — no file parsing. */
  async query(tenantId: string, f: { from?: string; to?: string; q?: string; func?: string; presence?: string; limit?: number; sort?: string }) {
    await this.ensureTable();
    const where: string[] = ['tenant_id = $1']; const p: any[] = [tenantId];
    if (f.from) { p.push(f.from); where.push(`work_date >= $${p.length}`); }
    if (f.to) { p.push(f.to); where.push(`work_date <= $${p.length}`); }
    if (f.func) { p.push(f.func); where.push(`func = $${p.length}`); }
    if (f.presence) { p.push(f.presence); where.push(`presence = $${p.length}`); }
    if (f.q) { p.push(`%${f.q.toLowerCase()}%`); where.push(`(lower(name) LIKE $${p.length} OR employee_no LIKE $${p.length})`); }
    // Whitelisted sort (never interpolate user input directly into SQL)
    const ORDER: Record<string, string> = {
      name_asc: 'lower(name) ASC, work_date DESC',
      name_desc: 'lower(name) DESC, work_date DESC',
      date_desc: 'work_date DESC, lower(name) ASC',
      date_asc: 'work_date ASC, lower(name) ASC',
    };
    const orderBy = ORDER[f.sort ?? 'date_desc'] ?? ORDER.date_desc;
    const lim = Math.min(f.limit ?? 500, 5000);
    // Return the full stored ReconRow (payload) so the UI has every field; override
    // date with the clean text date to avoid timezone shifts. Falls back to the
    // indexed columns for any pre-payload rows.
    const raw = await this.dataSource.query(
      `SELECT work_date::text AS date, payload, manager_note AS "managerNote",
              employee_no AS "employeeId", name, func, shift_start_min AS "shiftStartMin",
              shift_end_min AS "shiftEndMin", presence, system_late_min AS "systemLateMin",
              punch_late_min AS "punchLateMin", ot_after_min AS "otAfterMin", ot_rounded_min AS "otRoundedMin", flags
       FROM roster_daily WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy} LIMIT ${lim}`, p);
    const rows = raw.map((x: any) => ({ ...(x.payload ? { ...x.payload, date: x.date } : { date: x.date, employeeId: x.employeeId, name: x.name, func: x.func, shiftStartMin: x.shiftStartMin, shiftEndMin: x.shiftEndMin, presence: x.presence, systemLateMin: x.systemLateMin, punchLateMin: x.punchLateMin, otAfterMin: x.otAfterMin, otRoundedMin: x.otRoundedMin, flags: x.flags }), managerNote: x.managerNote || '' }));
    // Rich summary for the KPI cards — presence breakdown + late/deduction, computed
    // over the WHOLE filtered set (not just the returned page). Late/deduction live in
    // the payload jsonb; presence is an indexed column.
    const [tot] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS "totalDays", COUNT(DISTINCT employee_no)::int AS employees,
              COALESCE(SUM(ot_rounded_min),0)::int AS "otMinutes",
              COUNT(*) FILTER (WHERE presence='office')::int  AS office,
              COUNT(*) FILTER (WHERE presence='wfh')::int     AS wfh,
              COUNT(*) FILTER (WHERE presence='anomaly')::int AS anomaly,
              COUNT(*) FILTER (WHERE presence='absent')::int  AS absent,
              COUNT(*) FILTER (WHERE (payload->>'effectiveLateMin')::numeric > 0)::int AS "lateDays",
              COUNT(*) FILTER (WHERE (payload->>'deductionApplies')::boolean)::int      AS "deductionDays"
       FROM roster_daily WHERE ${where.join(' AND ')}`, p);
    return { summary: tot, total: tot.totalDays, rows };
  }

  /** Save/clear a manager note on one (employee, day). Survives re-ingestion — the
   *  ingest upsert never touches manager_note, so annotations are never lost. */
  async setNote(tenantId: string, employeeId: string, date: string, note: string): Promise<void> {
    await this.ensureTable();
    await this.dataSource.query(
      `UPDATE roster_daily SET manager_note = NULLIF($4,'') WHERE tenant_id=$1 AND employee_no=$2 AND work_date=$3`,
      [tenantId, employeeId, date, note ?? ''],
    );
  }

  /** Annual OT cap (180h/employee/year): YTD OT hours per employee with an alert
   *  status — EXCEEDED (≥180) / APPROACHING (≥150) / OK. */
  async otCap(tenantId: string, year = '2026', cap = 180, warn = 150) {
    await this.ensureTable();
    const rows = await this.dataSource.query(
      `SELECT employee_no AS "employeeId", max(name) AS name, max(func) AS func,
              ROUND(SUM(ot_rounded_min) / 60.0, 1)::float AS "otHours", COUNT(*) FILTER (WHERE ot_rounded_min > 0) AS "otDays"
       FROM roster_daily WHERE tenant_id=$1 AND work_date >= $2 AND work_date <= $3
       GROUP BY employee_no HAVING SUM(ot_rounded_min) > 0
       ORDER BY SUM(ot_rounded_min) DESC`,
      [tenantId, `${year}-01-01`, `${year}-12-31`],
    );
    const employees = rows.map((r: any) => ({
      ...r,
      status: r.otHours >= cap ? 'EXCEEDED' : r.otHours >= warn ? 'APPROACHING' : 'OK',
      remaining: +(cap - r.otHours).toFixed(1),
    }));
    return {
      year, cap, warn,
      totals: { exceeded: employees.filter((e: any) => e.status === 'EXCEEDED').length, approaching: employees.filter((e: any) => e.status === 'APPROACHING').length, employees: employees.length },
      employees,
    };
  }

  /** Deep analytics dashboard computed from the stored roster (payload jsonb).
   *  All metrics derive from the SAME reconciled rows the grid shows, so the
   *  dashboard can never disagree with the roster. Aggregated in-process over the
   *  range (≈11k rows for the full year — well within memory). */
  async dashboard(tenantId: string, from?: string, to?: string, func?: string, includeSupport = false) {
    await this.ensureTable();
    const where: string[] = ['tenant_id = $1']; const p: any[] = [tenantId];
    if (from) { p.push(from); where.push(`work_date >= $${p.length}`); }
    if (to) { p.push(to); where.push(`work_date <= $${p.length}`); }
    if (func) { p.push(func); where.push(`func = $${p.length}`); }
    const raw = await this.dataSource.query(
      `SELECT work_date::text AS date, payload FROM roster_daily WHERE ${where.join(' AND ')}`, p);
    let rows = raw.map((x: any) => ({ ...(x.payload || {}), date: x.date }));
    // Support/management roles (RTA, leaders, specialists, customer care, support) are
    // not frontline-attendance-evaluated and aren't reliably on the systems — exclude
    // them by default so they don't distort the agent metrics. They reappear when the
    // user explicitly filters to one, or toggles "include support".
    if (!func && !includeSupport) rows = rows.filter((r: any) => !isSupportFunc(r.func));

    const n = (v: any) => Number(v) || 0;
    const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];           // JS getUTCDay order
    const WEEK_ORDER = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];   // WFM week starts Saturday
    const weekday = (d: string) => WD[new Date(`${d}T00:00:00Z`).getUTCDay()];
    const baseCode = (c: string) => String(c || '').toUpperCase().replace(/[SA]$/, '').replace(/R$/, '') || '(none)';
    const isScheduled = (r: any) => r.shiftStartMin != null;                 // a real working-branch shift
    const isAbsent = (r: any) => r.presence === 'absent';
    const isLate = (r: any) => n(r.effectiveLateMin) > 0;
    const isEarly = (r: any) => n(r.effectiveEarlyOutMin) > 0;

    // ── headline KPIs ──
    const emp = new Set<string>();
    let workedDays = 0, otMin = 0, otBeforeMin = 0, otAfterMin = 0, lateDays = 0, lateMin = 0, earlyDays = 0, earlyMin = 0,
        lateExcusedDays = 0, earlyExcusedDays = 0,
        absences = 0, sickDays = 0, deductionDays = 0, confSum = 0, confCnt = 0,
        permApproved = 0, permRefused = 0, permPending = 0, permTotal = 0;

    const mk = () => ({ employees: new Set<string>(), days: 0, worked: 0, otMin: 0, lateDays: 0, lateMin: 0, earlyDays: 0, earlyMin: 0, absences: 0, sick: 0, confSum: 0, confCnt: 0 });
    const byFunc = new Map<string, ReturnType<typeof mk>>();
    const byShift = new Map<string, { code: string; total: number; lateDays: number; lateMin: number; earlyDays: number; absences: number; otMin: number }>();
    const byDayType = new Map<string, number>();
    const perEmp = new Map<string, { id: string; name: string; func: string; lateDays: number; lateMin: number; earlyDays: number; earlyMin: number; absences: number; otMin: number; worked: number }>();
    const absByWd = new Map<string, number>(); const lateByWd = new Map<string, number>();
    const permByType = new Map<string, number>();
    const byMonth = new Map<string, { lateMin: number; absences: number; otMin: number; confSum: number; confCnt: number; worked: number }>();

    for (const r of rows) {
      emp.add(r.employeeId);
      const worked = r.presence === 'office' || r.presence === 'wfh';
      if (worked) workedDays++;
      otMin += n(r.otRoundedMin); otBeforeMin += n(r.otBeforeMin); otAfterMin += n(r.otAfterMin);
      if (isLate(r)) { lateDays++; lateMin += n(r.effectiveLateMin); }              // late WITHOUT approved permission
      else if ((r.flags || []).includes('late_covered_by_permission')) lateExcusedDays++;  // late, but excused
      if (isEarly(r)) { earlyDays++; earlyMin += n(r.effectiveEarlyOutMin); }        // early-out WITHOUT permission
      else if ((r.flags || []).includes('early_covered_by_permission')) earlyExcusedDays++;
      if (isAbsent(r)) absences++;
      if (r.dayType === 'Sick Leave') sickDays++;
      if (r.deductionApplies) deductionDays++;
      if (isScheduled(r)) { confSum += n(r.conformancePct); confCnt++; }
      if (r.permissionType) {
        permTotal++;
        const st = String(r.permissionStatus || '').toLowerCase();
        if (st.includes('approv')) permApproved++; else if (st.includes('refus') || st.includes('reject')) permRefused++; else permPending++;
        permByType.set(r.permissionType, (permByType.get(r.permissionType) || 0) + 1);
      }

      // by function
      const fk = r.func || '(none)';
      if (!byFunc.has(fk)) byFunc.set(fk, mk());
      const F = byFunc.get(fk)!; F.employees.add(r.employeeId); F.days++; if (worked) F.worked++;
      F.otMin += n(r.otRoundedMin); if (isLate(r)) { F.lateDays++; F.lateMin += n(r.effectiveLateMin); }
      if (isEarly(r)) { F.earlyDays++; F.earlyMin += n(r.effectiveEarlyOutMin); } if (isAbsent(r)) F.absences++;
      if (r.dayType === 'Sick Leave') F.sick++; if (isScheduled(r)) { F.confSum += n(r.conformancePct); F.confCnt++; }

      // by shift (only real scheduled shifts)
      if (isScheduled(r)) {
        const sc = baseCode(r.shiftCode);
        if (!byShift.has(sc)) byShift.set(sc, { code: sc, total: 0, lateDays: 0, lateMin: 0, earlyDays: 0, absences: 0, otMin: 0 });
        const S = byShift.get(sc)!; S.total++; if (isLate(r)) { S.lateDays++; S.lateMin += n(r.effectiveLateMin); }
        if (isEarly(r)) S.earlyDays++; if (isAbsent(r)) S.absences++; S.otMin += n(r.otRoundedMin);
      }

      byDayType.set(r.dayType || 'Normal', (byDayType.get(r.dayType || 'Normal') || 0) + 1);

      // per employee (for top lists)
      if (!perEmp.has(r.employeeId)) perEmp.set(r.employeeId, { id: r.employeeId, name: r.name, func: r.func, lateDays: 0, lateMin: 0, earlyDays: 0, earlyMin: 0, absences: 0, otMin: 0, worked: 0 });
      const E = perEmp.get(r.employeeId)!; if (worked) E.worked++;
      if (isLate(r)) { E.lateDays++; E.lateMin += n(r.effectiveLateMin); }
      if (isEarly(r)) { E.earlyDays++; E.earlyMin += n(r.effectiveEarlyOutMin); }
      if (isAbsent(r)) E.absences++; E.otMin += n(r.otRoundedMin);

      // weekday distribution
      const wd = weekday(r.date);
      if (isAbsent(r)) absByWd.set(wd, (absByWd.get(wd) || 0) + 1);
      if (isLate(r)) lateByWd.set(wd, (lateByWd.get(wd) || 0) + 1);

      // monthly trend
      const mo = r.date.slice(0, 7);
      if (!byMonth.has(mo)) byMonth.set(mo, { lateMin: 0, absences: 0, otMin: 0, confSum: 0, confCnt: 0, worked: 0 });
      const M = byMonth.get(mo)!; M.lateMin += n(r.effectiveLateMin); if (isAbsent(r)) M.absences++;
      M.otMin += n(r.otRoundedMin); if (worked) M.worked++; if (isScheduled(r)) { M.confSum += n(r.conformancePct); M.confCnt++; }
    }

    const h1 = (m: number) => Math.round(m / 60 * 10) / 10;
    const sortDesc = (arr: any[], k: string) => arr.sort((a, b) => b[k] - a[k]);
    return {
      range: { from: from || null, to: to || null, func: func || null },
      kpis: {
        employees: emp.size, totalRows: rows.length, workedDays,
        otHours: h1(otMin), otBeforeHours: h1(otBeforeMin), otAfterHours: h1(otAfterMin),
        lateDays, lateMin, lateHours: h1(lateMin), lateExcusedDays,
        earlyDays, earlyMin, earlyExcusedDays, absences, sickDays, deductionDays,
        avgConformance: confCnt ? Math.round(confSum / confCnt) : 0,
        permissions: { total: permTotal, approved: permApproved, refused: permRefused, pending: permPending },
      },
      byFunction: [...byFunc.entries()].map(([k, v]) => ({
        func: k, employees: v.employees.size, days: v.days, workedDays: v.worked,
        otHours: h1(v.otMin), lateDays: v.lateDays, lateMin: v.lateMin, earlyDays: v.earlyDays,
        earlyMin: v.earlyMin, absences: v.absences, sickDays: v.sick,
        avgConformance: v.confCnt ? Math.round(v.confSum / v.confCnt) : 0,
      })).sort((a, b) => b.days - a.days),
      byShift: [...byShift.values()].map(s => ({ ...s, otHours: h1(s.otMin) })).sort((a, b) => b.total - a.total),
      byDayType: [...byDayType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      topLate: sortDesc([...perEmp.values()].filter(e => e.lateMin > 0).map(e => ({ id: e.id, name: e.name, func: e.func, lateDays: e.lateDays, lateMin: e.lateMin, lateHours: h1(e.lateMin) })), 'lateMin').slice(0, 15),
      topAbsent: sortDesc([...perEmp.values()].filter(e => e.absences > 0).map(e => ({ id: e.id, name: e.name, func: e.func, absences: e.absences, worked: e.worked })), 'absences').slice(0, 15),
      topOt: sortDesc([...perEmp.values()].filter(e => e.otMin > 0).map(e => ({ id: e.id, name: e.name, func: e.func, otHours: h1(e.otMin) })), 'otHours').slice(0, 15),
      topEarly: sortDesc([...perEmp.values()].filter(e => e.earlyMin > 0).map(e => ({ id: e.id, name: e.name, func: e.func, earlyDays: e.earlyDays, earlyMin: e.earlyMin })), 'earlyMin').slice(0, 15),
      absencesByWeekday: WEEK_ORDER.map(d => ({ day: d, count: absByWd.get(d) || 0 })),
      lateByWeekday: WEEK_ORDER.map(d => ({ day: d, count: lateByWd.get(d) || 0 })),
      permissionsByType: [...permByType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      trend: [...byMonth.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([month, v]) => ({
        month, lateMin: v.lateMin, lateHours: h1(v.lateMin), absences: v.absences,
        otHours: h1(v.otMin), workedDays: v.worked, avgConformance: v.confCnt ? Math.round(v.confSum / v.confCnt) : 0,
      })),
    };
  }

  /** Per-employee performance + commitment profile over a date range. Matches by
   *  employee no / name / email. Returns a transparent rating (Good/Average/Poor),
   *  OT% of actual worked time, OT before/after split and a per-day breakdown with
   *  the OT window (from→to). Built for "keep or let-go" decisions on interns. */
  async employeeProfile(tenantId: string, q: string, from?: string, to?: string, func?: string) {
    await this.ensureTable();
    const where: string[] = ['tenant_id = $1']; const p: any[] = [tenantId];
    if (from) { p.push(from); where.push(`work_date >= $${p.length}`); }
    if (to) { p.push(to); where.push(`work_date <= $${p.length}`); }
    if (func) { p.push(func); where.push(`func = $${p.length}`); }
    // q is optional when func is given (bulk-rate a whole function)
    if (q && q.trim()) {
      p.push(`%${q.toLowerCase()}%`); const qi = p.length;
      where.push(`(employee_no = $${qi + 1} OR lower(name) LIKE $${qi} OR lower(payload->>'email') LIKE $${qi})`);
      p.push(q);
    } else if (!func) {
      return { matched: 0, employees: [] };
    }
    const raw = await this.dataSource.query(
      `SELECT work_date::text AS date, payload FROM roster_daily WHERE ${where.join(' AND ')} ORDER BY work_date ASC`, p);
    const rows = raw.map((x: any) => ({ ...(x.payload || {}), date: x.date }));
    if (!rows.length) return { matched: 0, employees: [] };

    // group by employeeId (a query may match >1 person)
    const groups = new Map<string, any[]>();
    for (const r of rows) { if (!groups.has(r.employeeId)) groups.set(r.employeeId, []); groups.get(r.employeeId)!.push(r); }
    const n = (v: any) => Number(v) || 0;
    const hm = (m: number | null | undefined) => { if (m == null) return null; const t = ((m % 1440) + 1440) % 1440; let h = Math.floor(t / 60); const mm = t % 60; const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, '0')} ${ap}`; };
    const shiftDurMin = (s: number | null, e: number | null) => (s == null || e == null) ? 0 : ((e < s ? e + 1440 : e) - s);

    const employees = [...groups.entries()].map(([id, rs]) => {
      let scheduled = 0, worked = 0, absent = 0, sick = 0, lateDays = 0, lateMin = 0, earlyDays = 0, earlyMin = 0,
          deductionDays = 0, otMin = 0, otBefore = 0, otAfter = 0, baseWorkedMin = 0, confSum = 0, confCnt = 0;
      const days = rs.map((r: any) => {
        const present = r.presence === 'office' || r.presence === 'wfh';
        const sd = shiftDurMin(r.shiftStartMin, r.shiftEndMin);
        if (r.shiftStartMin != null) { scheduled++; confSum += n(r.conformancePct); confCnt++; }
        if (present) worked++;
        if (r.presence === 'absent') absent++;
        if (r.dayType === 'Sick Leave') sick++;
        if (n(r.effectiveLateMin) > 0) { lateDays++; lateMin += n(r.effectiveLateMin); }
        if (n(r.effectiveEarlyOutMin) > 0) { earlyDays++; earlyMin += n(r.effectiveEarlyOutMin); }
        if (r.deductionApplies) deductionDays++;
        otMin += n(r.otRoundedMin); otBefore += n(r.otBeforeMin); otAfter += n(r.otAfterMin);
        // base paid worked minutes (shift minus 1h break, minus lost late/early) only when present
        const breakAdj = sd >= 5 * 60 ? 60 : 0;
        const base = present ? Math.max(0, sd - breakAdj - n(r.effectiveLateMin) - n(r.effectiveEarlyOutMin)) : 0;
        baseWorkedMin += base;
        // OT window
        let otFrom: string | null = null, otTo: string | null = null;
        if (n(r.otAfterMin) > 0 && r.shiftEndMin != null) { otFrom = hm(r.shiftEndMin); otTo = hm(r.shiftEndMin + n(r.otAfterMin)); }
        else if (n(r.otBeforeMin) > 0 && r.shiftStartMin != null) { otFrom = hm(r.shiftStartMin - n(r.otBeforeMin)); otTo = hm(r.shiftStartMin); }
        return {
          date: r.date, shiftCode: r.shiftCode || r.attendanceCode, dayType: r.dayType, presence: r.presence,
          shiftStart: hm(r.shiftStartMin), shiftEnd: hm(r.shiftEndMin),
          inAt: hm(r.systemStartMin ?? r.punchInMin), outAt: hm(r.systemEndMin ?? r.punchOutMin),
          lateMin: n(r.effectiveLateMin), earlyMin: n(r.effectiveEarlyOutMin), conformance: n(r.conformancePct),
          otMin: n(r.otRoundedMin), otBeforeMin: n(r.otBeforeMin), otAfterMin: n(r.otAfterMin), otFrom, otTo,
        };
      });
      const workedMin = baseWorkedMin + otMin;
      const avgConf = confCnt ? Math.round(confSum / confCnt) : 0;
      const absenceRate = scheduled ? absent / scheduled : 0;
      const lateRate = worked ? lateDays / worked : 0;
      const earlyRate = worked ? earlyDays / worked : 0;
      const attendanceScore = Math.max(0, 100 * (1 - absenceRate));
      const punctualityScore = Math.max(0, 100 * (1 - lateRate));
      const earlyScore = Math.max(0, 100 * (1 - earlyRate));
      const score = Math.round(0.45 * avgConf + 0.25 * attendanceScore + 0.15 * punctualityScore + 0.15 * earlyScore);
      const rating = score >= 80 ? 'Good' : score >= 60 ? 'Average' : 'Poor';
      const r0 = rs[0];
      return {
        employeeId: id, name: r0.name, func: r0.func, email: r0.email || '', gender: r0.gender, teamManager: r0.teamManager,
        rating, score,
        components: { conformance: avgConf, attendanceScore: Math.round(attendanceScore), punctualityScore: Math.round(punctualityScore), earlyScore: Math.round(earlyScore) },
        stats: {
          scheduledDays: scheduled, workedDays: worked, absentDays: absent, sickDays: sick,
          lateDays, lateHours: Math.round(lateMin / 60 * 10) / 10, earlyDays, earlyHours: Math.round(earlyMin / 60 * 10) / 10,
          deductionDays, otHours: Math.round(otMin / 60 * 10) / 10, otBeforeHours: Math.round(otBefore / 60 * 10) / 10,
          otAfterHours: Math.round(otAfter / 60 * 10) / 10, workedHours: Math.round(workedMin / 60 * 10) / 10,
          otPercent: workedMin > 0 ? Math.round(otMin / workedMin * 1000) / 10 : 0,
          absenceRate: Math.round(absenceRate * 1000) / 10, avgConformance: avgConf,
        },
        days,
      };
    }).sort((a, b) => b.score - a.score);
    // Bulk (a whole function) → strip the heavy per-day arrays to keep the payload light;
    // the UI fetches days on demand when you drill into one person.
    const light = employees.length > 1;
    const out = light ? employees.map(({ days, ...rest }) => rest) : employees;
    return { matched: employees.length, mode: light ? 'list' : 'single', range: { from: from || null, to: to || null }, employees: out };
  }

  /** Employees who worked ≥ minHours OT on a SINGLE day — for the manager's bonus
   *  list. Each row: who, day, OT hours, before/after split and the OT window. */
  async otBonus(tenantId: string, from?: string, to?: string, minHours = 5, q?: string) {
    await this.ensureTable();
    const where: string[] = ['tenant_id = $1']; const p: any[] = [tenantId];
    if (from) { p.push(from); where.push(`work_date >= $${p.length}`); }
    if (to) { p.push(to); where.push(`work_date <= $${p.length}`); }
    p.push(minHours * 60); where.push(`ot_rounded_min >= $${p.length}`);
    if (q && q.trim()) {
      p.push(`%${q.toLowerCase()}%`); const qi = p.length;
      where.push(`(employee_no = $${qi + 1} OR lower(name) LIKE $${qi} OR lower(payload->>'email') LIKE $${qi})`);
      p.push(q.trim());
    }
    const raw = await this.dataSource.query(
      `SELECT work_date::text AS date, payload FROM roster_daily WHERE ${where.join(' AND ')} ORDER BY ot_rounded_min DESC`, p);
    const n = (v: any) => Number(v) || 0;
    const hm = (m: number | null | undefined) => { if (m == null) return null; const t = ((m % 1440) + 1440) % 1440; let h = Math.floor(t / 60); const mm = t % 60; const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, '0')} ${ap}`; };
    const rows = raw.map((x: any) => {
      const r = { ...(x.payload || {}), date: x.date };
      const after = n(r.otAfterMin) >= n(r.otBeforeMin);
      const inAt = hm(r.systemStartMin ?? r.punchInMin), outAt = hm(r.systemEndMin ?? r.punchOutMin);
      // OFF/holiday OT is punch-based → show the PUNCH window (the basis of the credit).
      const offDay = r.shiftStartMin == null;
      const otFrom = offDay ? hm(r.punchInMin ?? r.systemStartMin) : (after && r.shiftEndMin != null ? hm(r.shiftEndMin) : hm(r.shiftStartMin - n(r.otBeforeMin)));
      const otTo = offDay ? hm(r.punchOutMin ?? r.systemEndMin) : (after && r.shiftEndMin != null ? hm(r.shiftEndMin + n(r.otAfterMin)) : hm(r.shiftStartMin));
      const isHoliday = String(r.dayType || '').toLowerCase().includes('holiday');
      return {
        employeeId: r.employeeId, name: r.name, func: r.func, date: r.date, shiftCode: r.shiftCode || r.attendanceCode,
        dayType: r.dayType,
        otHours: Math.round(n(r.otRoundedMin) / 60 * 10) / 10, otBeforeMin: n(r.otBeforeMin), otAfterMin: n(r.otAfterMin),
        position: offDay ? (isHoliday ? 'holiday' : 'off-day') : (after ? 'after' : 'before'), otFrom, otTo,
        shiftStart: hm(r.shiftStartMin), shiftEnd: hm(r.shiftEndMin), inAt, outAt,
      };
    });
    const totalHours = Math.round(rows.reduce((s: number, r: any) => s + r.otHours, 0) * 10) / 10;
    const people = new Set(rows.map((r: any) => r.employeeId)).size;
    return { minHours, count: rows.length, people, totalHours, rows };
  }

  /** Generic detailed metric view (late / early / absence / conformance / sick).
   *  Returns one common envelope — summary KPIs, by function, monthly trend, top
   *  employees and filterable detail rows — so a single UI panel renders any metric. */
  async metricDetail(tenantId: string, metric: string, from?: string, to?: string, func?: string, q?: string) {
    await this.ensureTable();
    const base: string[] = ['tenant_id = $1']; const p: any[] = [tenantId];
    if (from) { p.push(from); base.push(`work_date >= $${p.length}`); }
    if (to) { p.push(to); base.push(`work_date <= $${p.length}`); }
    if (func) { p.push(func); base.push(`func = $${p.length}`); }
    if (q && q.trim()) {
      p.push(`%${q.toLowerCase()}%`); const qi = p.length;
      base.push(`(employee_no = $${qi + 1} OR lower(name) LIKE $${qi} OR lower(payload->>'email') LIKE $${qi})`);
      p.push(q.trim());
    }
    // metric-specific row filter (keeps the query light)
    const filt: Record<string, string> = {
      late: `(payload->>'effectiveLateMin')::numeric > 0`,
      early: `(payload->>'effectiveEarlyOutMin')::numeric > 0`,
      absence: `presence = 'absent'`,
      sick: `payload->>'dayType' = 'Sick Leave'`,
      conformance: `shift_start_min IS NOT NULL`,   // all scheduled days (for avg + distribution)
    };
    const rowFilter = filt[metric] || filt.late;
    const raw = await this.dataSource.query(
      `SELECT work_date::text AS date, payload FROM roster_daily WHERE ${[...base, rowFilter].join(' AND ')} ORDER BY work_date DESC`, p);
    const rows = raw.map((x: any) => ({ ...(x.payload || {}), date: x.date }));
    const n = (v: any) => Number(v) || 0;
    const h1 = (m: number) => Math.round(m / 60 * 10) / 10;
    const hm = (m: number | null | undefined) => { if (m == null) return null; const t = ((m % 1440) + 1440) % 1440; let hh = Math.floor(t / 60); const mm = t % 60; const ap = hh < 12 ? 'AM' : 'PM'; hh = hh % 12 || 12; return `${hh}:${String(mm).padStart(2, '0')} ${ap}`; };

    const byFunc = new Map<string, { v: number; c: number; emp: Set<string> }>();
    const byMonth = new Map<string, { v: number; c: number }>();
    const perEmp = new Map<string, { id: string; name: string; func: string; v: number; c: number }>();
    // value(r) per metric, plus how the "top"/aggregate is summarised
    const val = (r: any) => metric === 'late' ? n(r.effectiveLateMin)
      : metric === 'early' ? n(r.effectiveEarlyOutMin)
      : metric === 'conformance' ? n(r.conformancePct)
      : 1;   // absence / sick → count days
    for (const r of rows) {
      const v = val(r);
      const fk = r.func || '(none)'; if (!byFunc.has(fk)) byFunc.set(fk, { v: 0, c: 0, emp: new Set() }); const F = byFunc.get(fk)!; F.v += v; F.c++; F.emp.add(r.employeeId);
      const mo = r.date.slice(0, 7); if (!byMonth.has(mo)) byMonth.set(mo, { v: 0, c: 0 }); const M = byMonth.get(mo)!; M.v += v; M.c++;
      if (!perEmp.has(r.employeeId)) perEmp.set(r.employeeId, { id: r.employeeId, name: r.name, func: r.func, v: 0, c: 0 });
      const E = perEmp.get(r.employeeId)!; E.v += v; E.c++;
    }
    const avgMode = metric === 'conformance';
    const agg = (v: number, c: number) => avgMode ? (c ? Math.round(v / c) : 0) : (metric === 'late' || metric === 'early' ? h1(v) : v);

    // summary KPIs
    let summary: Array<{ label: string; labelAr: string; value: any; color: string }> = [];
    if (metric === 'late') {
      const totalMin = rows.reduce((s, r) => s + n(r.effectiveLateMin), 0);
      const ded = rows.filter(r => r.deductionApplies).length;
      const excused = await this.countFlag(tenantId, base, p, 'late_covered_by_permission');
      summary = [
        { label: 'Late days (no perm)', labelAr: 'أيام تأخير (بدون إذن)', value: rows.length, color: '#f97316' },
        { label: 'Late hours', labelAr: 'ساعات التأخير', value: h1(totalMin), color: '#f97316' },
        { label: 'Deduction days', labelAr: 'أيام خصم (>20د)', value: ded, color: '#ef4444' },
        { label: 'Excused (permission)', labelAr: 'بإذن', value: excused, color: '#22c55e' },
        { label: 'People', labelAr: 'موظفين', value: perEmp.size, color: '#6366f1' },
      ];
    } else if (metric === 'early') {
      const totalMin = rows.reduce((s, r) => s + n(r.effectiveEarlyOutMin), 0);
      const excused = await this.countFlag(tenantId, base, p, 'early_covered_by_permission');
      summary = [
        { label: 'Early-out days (no perm)', labelAr: 'أيام خروج مبكر (بدون إذن)', value: rows.length, color: '#eab308' },
        { label: 'Early hours', labelAr: 'ساعات الخروج المبكر', value: h1(totalMin), color: '#eab308' },
        { label: 'Excused (permission)', labelAr: 'بإذن', value: excused, color: '#22c55e' },
        { label: 'People', labelAr: 'موظفين', value: perEmp.size, color: '#6366f1' },
      ];
    } else if (metric === 'absence') {
      summary = [
        { label: 'Absences (confirmed)', labelAr: 'غياب مؤكد', value: rows.length, color: '#ef4444' },
        { label: 'People', labelAr: 'موظفين', value: perEmp.size, color: '#6366f1' },
        { label: 'Avg per person', labelAr: 'متوسط/فرد', value: perEmp.size ? Math.round(rows.length / perEmp.size * 10) / 10 : 0, color: '#f97316' },
      ];
    } else if (metric === 'sick') {
      summary = [
        { label: 'Sick days', labelAr: 'أيام مرضية', value: rows.length, color: '#0ea5e9' },
        { label: 'People', labelAr: 'موظفين', value: perEmp.size, color: '#6366f1' },
      ];
    } else if (metric === 'conformance') {
      const avg = rows.length ? Math.round(rows.reduce((s, r) => s + n(r.conformancePct), 0) / rows.length) : 0;
      const below70 = rows.filter(r => n(r.conformancePct) < 70).length;
      const below50 = rows.filter(r => n(r.conformancePct) < 50).length;
      summary = [
        { label: 'Avg conformance', labelAr: 'متوسط التوافق', value: avg + '%', color: avg >= 85 ? '#22c55e' : avg >= 70 ? '#f59e0b' : '#ef4444' },
        { label: 'Days below 70%', labelAr: 'أيام تحت 70%', value: below70, color: '#f59e0b' },
        { label: 'Days below 50%', labelAr: 'أيام تحت 50%', value: below50, color: '#ef4444' },
        { label: 'Scheduled days', labelAr: 'أيام مجدولة', value: rows.length, color: '#6366f1' },
      ];
    }

    // top employees (most for offence metrics; LOWEST for conformance)
    let top = [...perEmp.values()].map(e => ({ id: e.id, name: e.name, func: e.func, value: agg(e.v, e.c), days: e.c }));
    top = avgMode ? top.sort((a, b) => a.value - b.value).slice(0, 30) : top.sort((a, b) => b.value - a.value).slice(0, 30);

    // detail rows (metric-specific extra fields)
    const detail = rows.slice(0, 1500).map((r: any) => {
      const common = { date: r.date, employeeId: r.employeeId, name: r.name, func: r.func, shiftCode: r.shiftCode || r.attendanceCode, shiftStart: hm(r.shiftStartMin), shiftEnd: hm(r.shiftEndMin) };
      if (metric === 'late') return { ...common, minutes: n(r.effectiveLateMin), inAt: hm(r.systemStartMin ?? r.punchInMin), deduction: !!r.deductionApplies };
      if (metric === 'early') return { ...common, minutes: n(r.effectiveEarlyOutMin), outAt: hm(r.systemEndMin ?? r.punchOutMin) };
      if (metric === 'conformance') return { ...common, conformance: n(r.conformancePct), inAt: hm(r.systemStartMin ?? r.punchInMin), outAt: hm(r.systemEndMin ?? r.punchOutMin) };
      // absence / sick
      return { ...common, dayType: r.dayType, presence: r.presence };
    });

    return {
      metric, range: { from: from || null, to: to || null, func: func || null, q: q || null },
      summary, avgMode,
      byFunction: [...byFunc.entries()].map(([f, v]) => ({ func: f, value: agg(v.v, v.c), days: v.c, people: v.emp.size })).sort((a, b) => avgMode ? a.value - b.value : b.value - a.value),
      byMonth: [...byMonth.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([month, v]) => ({ month, value: agg(v.v, v.c) })),
      top, rows: detail,
    };
  }

  /** Count rows in range carrying a given flag (for excused late/early). */
  private async countFlag(tenantId: string, base: string[], baseParams: any[], flag: string): Promise<number> {
    const p = [...baseParams, flag];
    const [r] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS c FROM roster_daily WHERE ${base.join(' AND ')} AND flags ? $${p.length}`, p);
    return r?.c ?? 0;
  }

  /** Detailed overtime view: summary (before/after/holiday/off split), by function,
   *  by month, top employees (with 180h/yr cap status) and filterable detail rows.
   *  Filter by date range, function and name/ID/email. */
  async overtime(tenantId: string, from?: string, to?: string, func?: string, q?: string) {
    await this.ensureTable();
    const where: string[] = ['tenant_id = $1', 'ot_rounded_min > 0']; const p: any[] = [tenantId];
    if (from) { p.push(from); where.push(`work_date >= $${p.length}`); }
    if (to) { p.push(to); where.push(`work_date <= $${p.length}`); }
    if (func) { p.push(func); where.push(`func = $${p.length}`); }
    if (q && q.trim()) {
      p.push(`%${q.toLowerCase()}%`); const qi = p.length;
      where.push(`(employee_no = $${qi + 1} OR lower(name) LIKE $${qi} OR lower(payload->>'email') LIKE $${qi})`);
      p.push(q.trim());
    }
    const raw = await this.dataSource.query(
      `SELECT work_date::text AS date, payload FROM roster_daily WHERE ${where.join(' AND ')} ORDER BY ot_rounded_min DESC`, p);
    const rows = raw.map((x: any) => ({ ...(x.payload || {}), date: x.date }));
    const n = (v: any) => Number(v) || 0;
    const h1 = (m: number) => Math.round(m / 60 * 10) / 10;
    const hm = (m: number | null | undefined) => { if (m == null) return null; const t = ((m % 1440) + 1440) % 1440; let hh = Math.floor(t / 60); const mm = t % 60; const ap = hh < 12 ? 'AM' : 'PM'; hh = hh % 12 || 12; return `${hh}:${String(mm).padStart(2, '0')} ${ap}`; };

    let totalMin = 0, beforeMin = 0, afterMin = 0, holidayMin = 0, offMin = 0, workingMin = 0;
    const byFunc = new Map<string, { min: number; emp: Set<string> }>();
    const byMonth = new Map<string, number>();
    const perEmp = new Map<string, { id: string; name: string; func: string; min: number; before: number; after: number; holiday: number; days: number }>();
    const detail = rows.map((r: any) => {
      const ot = n(r.otRoundedMin); totalMin += ot; beforeMin += n(r.otBeforeMin); afterMin += n(r.otAfterMin);
      const dt = String(r.dayType || '').toLowerCase();
      const isHoliday = dt.includes('holiday'); const isOff = dt.includes('off') || r.shiftStartMin == null;
      if (isHoliday) holidayMin += ot; else if (isOff && r.shiftStartMin == null) offMin += ot; else workingMin += ot;
      const fk = r.func || '(none)'; if (!byFunc.has(fk)) byFunc.set(fk, { min: 0, emp: new Set() }); const F = byFunc.get(fk)!; F.min += ot; F.emp.add(r.employeeId);
      const mo = r.date.slice(0, 7); byMonth.set(mo, (byMonth.get(mo) || 0) + ot);
      if (!perEmp.has(r.employeeId)) perEmp.set(r.employeeId, { id: r.employeeId, name: r.name, func: r.func, min: 0, before: 0, after: 0, holiday: 0, days: 0 });
      const E = perEmp.get(r.employeeId)!; E.min += ot; E.before += n(r.otBeforeMin); E.after += n(r.otAfterMin); if (isHoliday) E.holiday += ot; E.days++;
      // position + window
      const offDay = r.shiftStartMin == null;
      const after = n(r.otAfterMin) >= n(r.otBeforeMin);
      const otFrom = offDay ? hm(r.punchInMin ?? r.systemStartMin) : (after && r.shiftEndMin != null ? hm(r.shiftEndMin) : hm(r.shiftStartMin - n(r.otBeforeMin)));
      const otTo = offDay ? hm(r.punchOutMin ?? r.systemEndMin) : (after && r.shiftEndMin != null ? hm(r.shiftEndMin + n(r.otAfterMin)) : hm(r.shiftStartMin));
      return {
        date: r.date, employeeId: r.employeeId, name: r.name, func: r.func, shiftCode: r.shiftCode || r.attendanceCode,
        shiftStart: hm(r.shiftStartMin), shiftEnd: hm(r.shiftEndMin),
        otHours: h1(ot), otBeforeMin: n(r.otBeforeMin), otAfterMin: n(r.otAfterMin),
        position: offDay ? (isHoliday ? 'holiday' : 'off-day') : (after ? 'after' : 'before'),
        otFrom, otTo, flags: (r.flags || []).filter((f: string) => /bleed|capped|maternity|holiday/.test(f)),
      };
    });

    // 180h/yr cap status per employee (whole-year, regardless of the filter window)
    const year = (to || from || '2026').slice(0, 4);
    const capRows = await this.dataSource.query(
      `SELECT employee_no, ROUND(SUM(ot_rounded_min)/60.0,1)::float AS yr FROM roster_daily
       WHERE tenant_id=$1 AND work_date >= $2 AND work_date <= $3 GROUP BY employee_no`,
      [tenantId, `${year}-01-01`, `${year}-12-31`]);
    const capMap = new Map<string, number>(capRows.map((r: any) => [r.employee_no, r.yr]));

    const topEmployees = [...perEmp.values()].map(e => ({
      id: e.id, name: e.name, func: e.func, hours: h1(e.min), beforeHours: h1(e.before), afterHours: h1(e.after),
      holidayHours: h1(e.holiday), days: e.days, ytdHours: capMap.get(e.id) ?? 0,
      capStatus: (capMap.get(e.id) ?? 0) >= 180 ? 'EXCEEDED' : (capMap.get(e.id) ?? 0) >= 150 ? 'APPROACHING' : 'OK',
    })).sort((a, b) => b.hours - a.hours);

    return {
      range: { from: from || null, to: to || null, func: func || null, q: q || null },
      summary: {
        totalHours: h1(totalMin), beforeHours: h1(beforeMin), afterHours: h1(afterMin),
        holidayHours: h1(holidayMin), offHours: h1(offMin), workingHours: h1(workingMin),
        people: perEmp.size, days: rows.length, avgPerPerson: perEmp.size ? h1(totalMin / perEmp.size) : 0,
      },
      byFunction: [...byFunc.entries()].map(([f, v]) => ({ func: f, hours: h1(v.min), people: v.emp.size })).sort((a, b) => b.hours - a.hours),
      byMonth: [...byMonth.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([month, m]) => ({ month, hours: h1(m) })),
      topEmployees: topEmployees.slice(0, 30),
      rows: detail.slice(0, 1500),
    };
  }

  /** Permission details: every (employee, day) that has a permission — type, window
   *  (from→to), status (Approved/Refused/Pending) and whether it actually covered a
   *  late/early. Filter by date range and name/ID/email. */
  async permissionDetails(tenantId: string, from?: string, to?: string, q?: string, status?: string) {
    await this.ensureTable();
    const where: string[] = ['tenant_id = $1', `payload->>'permissionType' IS NOT NULL`, `payload->>'permissionType' <> ''`];
    const p: any[] = [tenantId];
    if (from) { p.push(from); where.push(`work_date >= $${p.length}`); }
    if (to) { p.push(to); where.push(`work_date <= $${p.length}`); }
    if (q && q.trim()) {
      p.push(`%${q.toLowerCase()}%`); const qi = p.length;
      where.push(`(employee_no = $${qi + 1} OR lower(name) LIKE $${qi} OR lower(payload->>'email') LIKE $${qi})`);
      p.push(q.trim());
    }
    const raw = await this.dataSource.query(
      `SELECT work_date::text AS date, payload FROM roster_daily WHERE ${where.join(' AND ')} ORDER BY work_date DESC`, p);
    let rows = raw.map((x: any) => {
      const r = { ...(x.payload || {}), date: x.date };
      const fl: string[] = r.flags || [];
      return {
        date: r.date, employeeId: r.employeeId, name: r.name, func: r.func,
        type: r.permissionType, from: r.permissionFrom, to: r.permissionTo,
        status: r.permissionStatus || 'Pending',
        covered: fl.includes('late_covered_by_permission') || fl.includes('early_covered_by_permission'),
        shiftCode: r.shiftCode,
      };
    });
    if (status) rows = rows.filter((r: any) => String(r.status).toLowerCase().includes(status.toLowerCase()));
    const counts = { total: rows.length, approved: 0, refused: 0, pending: 0 };
    for (const r of rows) {
      const s = String(r.status).toLowerCase();
      if (s.includes('approv')) counts.approved++; else if (s.includes('refus') || s.includes('reject')) counts.refused++; else counts.pending++;
    }
    const byType: Record<string, number> = {};
    for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
    return { counts, byType: Object.entries(byType).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count), rows: rows.slice(0, 1000) };
  }

  /** Half-hourly headcount by function for one date: scheduled vs actually-present,
   *  unplanned shrinkage and how many are in OT (before/after their shift) per bucket. */
  async coverageIntervals(tenantId: string, date: string, func?: string, q?: string) {
    await this.ensureTable();
    const where: string[] = ['tenant_id = $1', 'work_date = $2']; const p: any[] = [tenantId, date];
    if (func) { p.push(func); where.push(`func = $${p.length}`); }
    const raw = await this.dataSource.query(`SELECT payload FROM roster_daily WHERE ${where.join(' AND ')}`, p);
    let rows = raw.map((x: any) => x.payload || {});
    // Optional single-agent filter (name / ID / email).
    if (q && q.trim()) {
      const s = q.trim().toLowerCase();
      rows = rows.filter((r: any) => String(r.name || '').toLowerCase().includes(s) || String(r.employeeId || '').includes(s) || String(r.email || '').toLowerCase().includes(s));
    }
    const n = (v: any) => Number(v) || 0;
    const covers = (s: number | null, e: number | null, t: number) => {
      if (s == null || e == null) return false;
      return s <= e ? (t >= s && t < e) : (t >= s || t < e);   // cross-midnight
    };
    const BUCKETS = 48;
    const label = (b: number) => `${String(Math.floor(b / 2)).padStart(2, '0')}:${b % 2 ? '30' : '00'}`;
    const byFunc = new Map<string, any[]>();
    for (const r of rows) { const f = r.func || '(none)'; if (!byFunc.has(f)) byFunc.set(f, []); byFunc.get(f)!.push(r); }

    const functions = [...byFunc.entries()].map(([f, rs]) => {
      const buckets = Array.from({ length: BUCKETS }, (_, b) => {
        const t = b * 30;
        let scheduled = 0, present = 0, inOt = 0;
        for (const r of rs) {
          const sched = r.shiftStartMin != null && covers(r.shiftStartMin, r.shiftEndMin, t);
          if (sched) scheduled++;
          const isPresent = (r.presence === 'office' || r.presence === 'wfh');
          const actStart = [r.systemStartMin, r.punchInMin].filter((x: any) => x != null).sort((a: number, c: number) => a - c)[0];
          const actEndCands = [r.systemEndMin, r.punchOutMin].filter((x: any) => x != null);
          const actEnd = actEndCands.length ? Math.max(...actEndCands) : null;
          if (isPresent && actStart != null && actEnd != null && covers(actStart, actEnd, t)) {
            present++;
            // in OT if this bucket is beyond shift end (after) or before shift start (before)
            if (r.shiftEndMin != null && n(r.otAfterMin) > 0 && covers(r.shiftEndMin, (r.shiftEndMin + n(r.otAfterMin)) % 1440, t)) inOt++;
            else if (r.shiftStartMin != null && n(r.otBeforeMin) > 0 && covers((r.shiftStartMin - n(r.otBeforeMin) + 1440) % 1440, r.shiftStartMin, t)) inOt++;
          }
        }
        return { t: label(b), scheduled, present, shrinkage: Math.max(0, scheduled - present), inOt };
      });
      const peakSched = Math.max(0, ...buckets.map(x => x.scheduled));
      const otHours = Math.round(rs.reduce((s, r) => s + n(r.otRoundedMin), 0) / 60 * 10) / 10;
      const otPeople = rs.filter(r => n(r.otRoundedMin) > 0).length;
      return { func: f, employees: rs.length, peakScheduled: peakSched, otHours, otPeople, buckets };
    }).sort((a, b) => b.employees - a.employees);

    return { date, func: func || null, q: q || null, functions };
  }

  /** Weekly attendance for HR. Per (employee, day): the HR shift code —
   *  punched→normal code · system-only→WFH · sick-approved→SL · absent→A · else schedule
   *  code — plus shift2, punch/system in-out, late and working hours for the late/incomplete. */
  async hrWeekly(tenantId: string, from: string, to: string) {
    const { rows } = await this.query(tenantId, { from, to, limit: 5000, sort: 'date_asc' });
    const hm = (m: number | null | undefined) => { if (m == null) return ''; const t = ((m % 1440) + 1440) % 1440; let h = Math.floor(t / 60); const mm = t % 60; const ap = h < 12 ? 'AM' : 'PM'; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, '0')} ${ap}`; };
    const dur = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null) ? '' : (((b < a ? b + 1440 : b) - a) / 60).toFixed(1) + 'h';
    return rows.map((r: any) => {
      const fl: string[] = r.flags || [];
      let code: string;
      if (r.dayType === 'Sick Leave' || fl.includes('sick_leave')) code = 'SL';
      else if (r.presence === 'office') code = r.shiftCode || '';
      else if (r.presence === 'wfh') code = 'WFH';
      else if (r.presence === 'absent') code = (r.attendanceCode && /[A]$/.test(r.attendanceCode)) ? r.attendanceCode : 'A';
      else code = r.shiftCode || '';
      const incomplete = fl.includes('system_incomplete');
      return {
        Date: r.date, 'Employee No': r.employeeId, Name: r.name, Function: r.func, Team: r.teamGroup || '', 'Team Manager': r.teamManager || '',
        'Shift Code': code,
        Shift: r.shiftStartMin != null ? `${hm(r.shiftStartMin)}–${hm(r.shiftEndMin)}` : '',
        'Shift 2': r.shiftStart2Min != null ? `${hm(r.shiftStart2Min)}–${hm(r.shiftEnd2Min)}` : '',
        'Punch In': hm(r.punchInMin), 'Punch Out': hm(r.punchOutMin),
        'System In': incomplete ? '(incomplete)' : hm(r.systemStartMin), 'System Out': incomplete ? '' : hm(r.systemEndMin),
        'System In 2': hm(r.systemStart2Min), 'System Out 2': hm(r.systemEnd2Min),
        'Sys Late (min)': r.systemLateMin || 0, 'Punch Late (min)': r.punchLateMin || 0, 'Late (min)': r.effectiveLateMin || 0,
        'Sys Early (min)': r.systemEarlyOutMin || 0, 'Punch Early (min)': r.punchEarlyOutMin || 0, 'Early Out (min)': r.effectiveEarlyOutMin || 0,
        'Working Hrs': incomplete ? '' : (dur(r.systemStartMin, r.systemEndMin) || dur(r.punchInMin, r.punchOutMin)),
        Permission: r.permissionType ? `${r.permissionType} ${r.permissionStatus || ''} ${r.permissionFrom || ''}-${r.permissionTo || ''}`.trim() : '',
        Note: r.managerNote || '',
      };
    });
  }

  /** HR attendance MATRIX workbook (employee rows × date columns). Two sheets:
   *  "Update" = past week ACTUAL codes (WFH/SL/A/normal/OFF), "Advance" = next week
   *  PLANNED schedule codes. Returns an .xlsx buffer. */
  async hrMatrix(tenantId: string, ref: string, from?: string, to?: string): Promise<Buffer> {
    const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, dd + n)); return x.toISOString().slice(0, 10); };
    let past: string[], adv: string[];
    if (from && to && from <= to) {
      // Custom range for the "Update" sheet; "Advance" = the 7 days after `to`.
      past = []; let d = from; while (d <= to && past.length < 92) { past.push(d); d = addDays(d, 1); }
      adv = Array.from({ length: 7 }, (_, i) => addDays(to, 1 + i));
    } else {
      past = Array.from({ length: 7 }, (_, i) => addDays(ref, -6 + i));
      adv = Array.from({ length: 7 }, (_, i) => addDays(ref, 1 + i));
    }
    const rows = await this.dataSource.query(
      `SELECT employee_no, max(name) AS name, work_date::text AS d, (array_agg(payload))[1] AS payload
       FROM roster_daily WHERE tenant_id=$1 AND work_date = ANY($2::date[]) GROUP BY employee_no, work_date`,
      [tenantId, [...past, ...adv]],
    );
    const emp = new Map<string, { name: string; byDate: Record<string, { actual: string; planned: string }> }>();
    for (const r of rows) {
      if (!emp.has(r.employee_no)) emp.set(r.employee_no, { name: r.name, byDate: {} });
      const p = r.payload || {}; const fl: string[] = p.flags || []; const code = p.shiftCode || ''; let actual: string;
      if (p.dayType === 'Sick Leave' || fl.includes('sick_leave')) actual = 'SL';
      else if (p.presence === 'office') actual = code;
      else if (p.presence === 'wfh') actual = 'WFH';
      else if (p.presence === 'absent') actual = (p.attendanceCode && /A$/.test(p.attendanceCode)) ? p.attendanceCode : 'A';
      else actual = code;
      emp.get(r.employee_no)!.byDate[r.d] = { actual, planned: code };
    }
    const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fmt = (d: string) => `${d.slice(8)}-${MON[+d.slice(5, 7)]}`;
    const sorted = [...emp.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
    const wb = new Workbook();
    const mk = (title: string, dates: string[], pick: (c: any) => string) => {
      const ws = wb.addWorksheet(title);
      ws.addRow(['Name', 'ID', ...dates.map(fmt)]);
      ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
      ws.columns = [{ width: 22 }, { width: 9 }, ...dates.map(() => ({ width: 9 }))];
      for (const [id, e] of sorted) {
        const row = ws.addRow([e.name, id, ...dates.map(d => pick(e.byDate[d]))]);
        row.eachCell((cell, col) => { if (col > 2) { const v = String(cell.value || ''); if (/^OFF/.test(v)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; else if (/A$/.test(v) || v === 'SL') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8CBAD' } }; else if (/WFH/.test(v)) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }; cell.alignment = { horizontal: 'center' }; } });
      }
      ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
    };
    mk('Update (past week)', past, c => c ? c.actual : '');
    mk('Advance (next week)', adv, c => c ? c.planned : '');
    return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
  }

  /** Has any data been ingested for this tenant? (UI shows "ingest now" if empty.) */
  async count(tenantId: string): Promise<number> {
    await this.ensureTable();
    const [r] = await this.dataSource.query(`SELECT COUNT(*)::int AS c FROM roster_daily WHERE tenant_id=$1`, [tenantId]);
    return r.c;
  }
}
