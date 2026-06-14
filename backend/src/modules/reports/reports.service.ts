import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';

/**
 * Detailed, audit-grade reporting.
 *
 * Every method returns plain row objects so the controller can ship them as
 * JSON (preview), CSV, or a real multi-sheet .xlsx workbook. The goal: a full
 * paper-trail of WHO did WHAT, WHEN, WHY — for requests, approvals, permissions,
 * breaks, overtime, and audit — that the WFM team can download and analyse.
 */

// Readable actor/approver name: "First Last" → username → email.
const USER_NAME = (alias: string) =>
  `COALESCE(NULLIF(TRIM(COALESCE(${alias}.first_name,'')||' '||COALESCE(${alias}.last_name,'')),''), ${alias}.username, ${alias}.email)`;

const HH = (t?: string | null) => (t ? String(t).slice(0, 5) : '');

// "HH:MM[:SS]" → minutes since midnight
function toMin(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  if (isNaN(h)) return null;
  return h * 60 + (m || 0);
}

const fmtDur = (min?: number | null) => {
  if (min == null || min <= 0) return '0h 0m';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m}m`;
};

const fmtDateTime = (v: any) =>
  v ? new Date(v).toISOString().slice(0, 16).replace('T', ' ') : '';
const fmtDate = (v: any) =>
  v ? (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10)) : '';

@Injectable()
export class ReportsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // Latest attendance date (used as default report end)
  private async latestDate(tid: string): Promise<string> {
    const [r] = await this.ds.query(
      `SELECT MAX(attendance_date) AS d FROM attendance_records WHERE tenant_id = $1`, [tid],
    ).catch(() => [{ d: null }]);
    const d = r?.d ? (r.d instanceof Date ? r.d.toISOString() : String(r.d)) : new Date().toISOString();
    return d.slice(0, 10);
  }

  async resolveRange(tid: string, from?: string, to?: string) {
    const latest = await this.latestDate(tid);
    const toDate = to ?? latest;
    const fromDate = from ?? (toDate.slice(0, 7) + '-01');
    return { fromDate, toDate };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   *  1) REQUESTS — full approval chain, SLA, rejection reason, type detail
   * ═══════════════════════════════════════════════════════════════════════ */
  async requestsDetailed(tid: string, from: string, to: string, type?: string, status?: string) {
    const params: any[] = [tid, from, to];
    const conds: string[] = [];
    if (status) { params.push(status); conds.push(`r.status = $${params.length}`); }
    if (type)   { params.push(type);   conds.push(`rt.code = $${params.length}`); }
    const extra = conds.length ? 'AND ' + conds.join(' AND ') : '';

    const rows = await this.ds.query(
      `SELECT r.id, r.submitted_at, r.status, r.is_urgent, r.sla_due_at,
              r.approved_l1_at, r.approved_l2_at, r.rejected_at, r.rejection_reason, r.notes,
              rt.code AS type_code, rt.name AS type_name,
              e.employee_no,
              e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              f.name AS function_name,
              ${USER_NAME('requ')} AS requester_name,
              ${USER_NAME('a1')}  AS approver_l1,
              ${USER_NAME('a2')}  AS approver_l2,
              ${USER_NAME('rej')} AS rejected_by,
              ${USER_NAME('cur')} AS current_approver,
              -- permission detail
              rp.permission_type, rp.start_time AS p_start, rp.end_time AS p_end,
              rp.duration_minutes AS p_dur, rp.permission_date AS p_date, rp.reason AS p_reason,
              -- leave detail
              rl.leave_type, rl.start_date AS l_start, rl.end_date AS l_end, rl.duration_days AS l_days,
              -- overtime detail
              ro.ot_date, ro.start_time AS o_start, ro.end_time AS o_end, ro.duration_minutes AS o_dur, ro.ot_reason,
              -- swap detail
              rs.swap_type, rs.requester_date AS s_req_date, rs.target_date AS s_tgt_date,
              rs.peer_accepted_at, rs.peer_rejected_at, rs.peer_rejection_reason,
              te.first_name_en || ' ' || COALESCE(te.last_name_en,'') AS swap_target_name
         FROM requests r
         JOIN request_types rt ON rt.id = r.request_type_id
         LEFT JOIN employees e ON e.id = r.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         LEFT JOIN users requ ON requ.id = r.requester_id
         LEFT JOIN users a1  ON a1.id  = r.approver_l1_id
         LEFT JOIN users a2  ON a2.id  = r.approver_l2_id
         LEFT JOIN users rej ON rej.id = r.rejected_by
         LEFT JOIN users cur ON cur.id = r.current_approver_id
         LEFT JOIN request_permissions rp ON rp.request_id = r.id
         LEFT JOIN request_leaves rl      ON rl.request_id = r.id
         LEFT JOIN request_overtimes ro   ON ro.request_id = r.id
         LEFT JOIN request_shift_swaps rs ON rs.request_id = r.id
         LEFT JOIN employees te ON te.id = rs.target_employee_id
        WHERE r.tenant_id = $1 AND r.submitted_at::date BETWEEN $2 AND $3 ${extra}
        ORDER BY r.submitted_at DESC
        LIMIT 10000`,
      params,
    ).catch(() => []);

    return rows.map((r: any) => {
      const decidedAt = r.rejected_at ?? r.approved_l2_at ?? r.approved_l1_at ?? null;
      const decisionHrs = decidedAt
        ? +(((new Date(decidedAt).getTime() - new Date(r.submitted_at).getTime()) / 3.6e6)).toFixed(1)
        : null;
      const slaMet = r.sla_due_at && decidedAt
        ? (new Date(decidedAt) <= new Date(r.sla_due_at) ? 'Met' : 'Breached')
        : (r.sla_due_at && !decidedAt && new Date() > new Date(r.sla_due_at) ? 'Breached (open)' : '');
      // type-specific human detail
      let detail = '';
      if (r.type_code?.includes('permission') || r.permission_type) {
        detail = `${r.permission_type ?? ''} ${fmtDate(r.p_date)} ${HH(r.p_start)}-${HH(r.p_end)} (${fmtDur(r.p_dur)})`.trim();
      } else if (r.leave_type) {
        detail = `${r.leave_type} ${fmtDate(r.l_start)}→${fmtDate(r.l_end)} (${r.l_days}d)`;
      } else if (r.ot_date) {
        detail = `OT ${fmtDate(r.ot_date)} ${HH(r.o_start)}-${HH(r.o_end)} (${fmtDur(r.o_dur)})`;
      } else if (r.swap_type) {
        detail = `${r.swap_type} ${fmtDate(r.s_req_date)}↔${fmtDate(r.s_tgt_date)} w/ ${r.swap_target_name ?? '—'}`;
      }
      return {
        requestId:       r.id,
        type:            r.type_name,
        typeCode:        r.type_code,
        employeeNo:      r.employee_no ?? '',
        employee:        (r.employee_name ?? '').trim(),
        function:        r.function_name ?? '',
        detail,
        reason:          (r.p_reason ?? r.ot_reason ?? '').trim(),
        submittedAt:     fmtDateTime(r.submitted_at),
        requestedBy:     r.requester_name ?? '',
        status:          r.status,
        urgent:          r.is_urgent ? 'Yes' : 'No',
        approverL1:      r.approver_l1 ?? '',
        approvedL1At:    fmtDateTime(r.approved_l1_at),
        approverL2:      r.approver_l2 ?? '',
        approvedL2At:    fmtDateTime(r.approved_l2_at),
        currentApprover: r.current_approver ?? '',
        rejectedBy:      r.rejected_by ?? '',
        rejectedAt:      fmtDateTime(r.rejected_at),
        rejectionReason: (r.rejection_reason ?? '').trim(),
        peerAcceptedAt:  fmtDateTime(r.peer_accepted_at),
        peerRejectedAt:  fmtDateTime(r.peer_rejected_at),
        slaDueAt:        fmtDateTime(r.sla_due_at),
        slaStatus:       slaMet,
        decisionHours:   decisionHrs,
        notes:           (r.notes ?? '').trim(),
      };
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
   *  2) PERMISSIONS (استئذان) — hours, type, intervals with early/late
   * ═══════════════════════════════════════════════════════════════════════ */
  async permissionsDetailed(tid: string, from: string, to: string) {
    const rows = await this.ds.query(
      `SELECT rp.permission_date, rp.permission_type, rp.start_time, rp.end_time,
              rp.duration_minutes, rp.reason,
              r.status, r.submitted_at, r.approved_l1_at, r.approved_l2_at, r.sla_due_at,
              r.rejection_reason,
              e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              f.name AS function_name,
              ${USER_NAME('a1')} AS approver_l1, ${USER_NAME('a2')} AS approver_l2,
              ${USER_NAME('rej')} AS rejected_by
         FROM request_permissions rp
         JOIN requests r ON r.id = rp.request_id
         LEFT JOIN employees e ON e.id = r.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         LEFT JOIN users a1  ON a1.id  = r.approver_l1_id
         LEFT JOIN users a2  ON a2.id  = r.approver_l2_id
         LEFT JOIN users rej ON rej.id = r.rejected_by
        WHERE r.tenant_id = $1 AND rp.permission_date BETWEEN $2 AND $3
        ORDER BY rp.permission_date DESC, rp.start_time`,
      [tid, from, to],
    ).catch(() => []);

    const detail = rows.map((r: any) => ({
      date:           fmtDate(r.permission_date),
      employeeNo:     r.employee_no ?? '',
      employee:       (r.employee_name ?? '').trim(),
      function:       r.function_name ?? '',
      permissionType: r.permission_type ?? '',
      start:          HH(r.start_time),
      end:            HH(r.end_time),
      durationMin:    r.duration_minutes ?? 0,
      durationHrs:    +(((r.duration_minutes ?? 0) / 60).toFixed(2)),
      reason:         (r.reason ?? '').trim(),
      status:         r.status,
      approvedBy:     r.approver_l2 || r.approver_l1 || '',
      approvedAt:     fmtDateTime(r.approved_l2_at ?? r.approved_l1_at),
      rejectedBy:     r.rejected_by ?? '',
      rejectionReason:(r.rejection_reason ?? '').trim(),
      slaDueAt:       fmtDateTime(r.sla_due_at),
    }));

    // Interval breakdown: for each hour 0-23, count permissions overlapping it,
    // split by early_out vs late_in (and temp_out).
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      interval: `${String(h).padStart(2, '0')}:00-${String((h + 1) % 24).padStart(2, '0')}:00`,
      lateIn: 0, earlyOut: 0, tempOut: 0, returnDuring: 0, total: 0, totalMinutes: 0,
    }));
    for (const r of rows) {
      const s = toMin(r.start_time), e = toMin(r.end_time);
      if (s == null || e == null) continue;
      const endAdj = e <= s ? e + 1440 : e;
      for (let m = s; m < endAdj; m += 60) {
        const h = Math.floor((m % 1440) / 60);
        const b = buckets[h];
        b.total++;
        b.totalMinutes += Math.min(60, endAdj - m);
        if (r.permission_type === 'late_in') b.lateIn++;
        else if (r.permission_type === 'early_out') b.earlyOut++;
        else if (r.permission_type === 'return_during_shift') b.returnDuring++;
        else b.tempOut++;
      }
    }
    const intervals = buckets.filter(b => b.total > 0);

    // Per-employee summary
    const byEmp = new Map<string, any>();
    for (const d of detail) {
      const k = d.employeeNo || d.employee;
      const cur = byEmp.get(k) ?? {
        employeeNo: d.employeeNo, employee: d.employee, function: d.function,
        count: 0, totalMinutes: 0, lateIn: 0, earlyOut: 0, tempOut: 0,
      };
      cur.count++;
      cur.totalMinutes += d.durationMin;
      if (d.permissionType === 'late_in') cur.lateIn++;
      else if (d.permissionType === 'early_out') cur.earlyOut++;
      else cur.tempOut++;
      byEmp.set(k, cur);
    }
    const summary = [...byEmp.values()]
      .map(s => ({ ...s, totalHours: +(s.totalMinutes / 60).toFixed(2) }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);

    return { detail, intervals, summary };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   *  3) BREAKS — count, duration, shift window, approver
   * ═══════════════════════════════════════════════════════════════════════ */
  async breaksDetailed(tid: string, from: string, to: string) {
    const rows = await this.ds.query(
      `SELECT bs.schedule_date, bs.planned_start, bs.planned_end, bs.actual_start, bs.actual_end,
              bs.status, bs.late_minutes, bs.early_end_minutes, bs.is_missed, bs.slot_number,
              bt.name AS break_type, bt.duration_minutes AS break_default_min,
              e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              f.name AS function_name,
              ar.scheduled_start AS shift_start, ar.scheduled_end AS shift_end,
              br.requested_start, br.requested_end, br.reason AS req_reason, br.status AS req_status,
              br.reviewed_at, br.review_comment, ${USER_NAME('rv')} AS reviewed_by
         FROM break_slots bs
         JOIN break_types bt ON bt.id = bs.break_type_id
         LEFT JOIN employees e ON e.id = bs.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
         LEFT JOIN attendance_records ar
                ON ar.employee_id = bs.employee_id AND ar.attendance_date = bs.schedule_date
         LEFT JOIN break_requests br ON br.resulting_slot_id = bs.id
         LEFT JOIN users rv ON rv.id = br.reviewed_by_id
        WHERE bs.tenant_id = $1 AND bs.schedule_date BETWEEN $2 AND $3
        ORDER BY bs.schedule_date DESC, e.first_name_en, bs.slot_number`,
      [tid, from, to],
    ).catch(() => []);

    const durOf = (s?: string | null, e?: string | null) => {
      const a = toMin(s), b = toMin(e);
      if (a == null || b == null) return 0;
      return (b <= a ? b + 1440 : b) - a;
    };

    const detail = rows.map((r: any) => {
      const planned = durOf(r.planned_start, r.planned_end);
      const actual  = durOf(r.actual_start, r.actual_end);
      return {
        date:        fmtDate(r.schedule_date),
        employeeNo:  r.employee_no ?? '',
        employee:    (r.employee_name ?? '').trim(),
        function:    r.function_name ?? '',
        breakType:   r.break_type ?? '',
        slot:        r.slot_number ?? 1,
        shift:       r.shift_start ? `${HH(r.shift_start)}-${HH(r.shift_end)}` : '',
        plannedStart:HH(r.planned_start),
        plannedEnd:  HH(r.planned_end),
        plannedMin:  planned,
        actualStart: HH(r.actual_start),
        actualEnd:   HH(r.actual_end),
        actualMin:   actual,
        status:      r.status,
        lateMin:     r.late_minutes ?? 0,
        earlyEndMin: r.early_end_minutes ?? 0,
        missed:      r.is_missed ? 'Yes' : 'No',
        requestStatus: r.req_status ?? '',
        approvedBy:  r.reviewed_by ?? '',
        approvedAt:  fmtDateTime(r.reviewed_at),
        reviewComment: (r.review_comment ?? '').trim(),
        reason:      (r.req_reason ?? '').trim(),
      };
    });

    // Per-employee summary: how many breaks, total duration
    const byEmp = new Map<string, any>();
    for (const d of detail) {
      const k = d.employeeNo || d.employee;
      const cur = byEmp.get(k) ?? {
        employeeNo: d.employeeNo, employee: d.employee, function: d.function,
        breakCount: 0, totalPlannedMin: 0, totalActualMin: 0, lateCount: 0, missedCount: 0,
      };
      cur.breakCount++;
      cur.totalPlannedMin += d.plannedMin;
      cur.totalActualMin  += d.actualMin;
      if (d.lateMin > 0) cur.lateCount++;
      if (d.missed === 'Yes') cur.missedCount++;
      byEmp.set(k, cur);
    }
    const summary = [...byEmp.values()].sort((a, b) => b.breakCount - a.breakCount);

    return { detail, summary };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   *  4) AUDIT — who changed what, when, why
   * ═══════════════════════════════════════════════════════════════════════ */
  async auditDetailed(tid: string, from: string, to: string, module?: string) {
    const params: any[] = [tid, from, to];
    let extra = '';
    if (module) { params.push(module); extra = `AND al.module = $${params.length}`; }
    const rows = await this.ds.query(
      `SELECT al.created_at, al.action, al.module, al.entity_type, al.entity_id,
              al.actor_email, ${USER_NAME('u')} AS actor_name,
              al.old_value, al.new_value, al.metadata, al.notes, al.ip_address
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_id
        WHERE al.tenant_id = $1 AND al.created_at::date BETWEEN $2 AND $3 ${extra}
        ORDER BY al.created_at DESC
        LIMIT 10000`,
      params,
    ).catch(() => []);

    const summarizeVal = (v: any) => {
      if (v == null) return '';
      try {
        const o = typeof v === 'string' ? JSON.parse(v) : v;
        return Object.entries(o).slice(0, 8).map(([k, val]) =>
          `${k}=${typeof val === 'object' ? JSON.stringify(val) : val}`).join('; ').slice(0, 300);
      } catch { return String(v).slice(0, 300); }
    };
    const reasonOf = (r: any) => {
      if (r.notes) return String(r.notes);
      try {
        const m = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
        return m?.reason ?? m?.comment ?? '';
      } catch { return ''; }
    };

    const detail = rows.map((r: any) => ({
      when:       fmtDateTime(r.created_at),
      actor:      r.actor_name ?? r.actor_email ?? '',
      action:     r.action,
      module:     r.module,
      entityType: r.entity_type,
      entityId:   r.entity_id ?? '',
      reason:     String(reasonOf(r) ?? '').slice(0, 300),
      oldValue:   summarizeVal(r.old_value),
      newValue:   summarizeVal(r.new_value),
      ip:         r.ip_address ?? '',
    }));

    // Summary by actor + action
    const byActor = new Map<string, number>();
    const byAction = new Map<string, number>();
    for (const d of detail) {
      byActor.set(d.actor, (byActor.get(d.actor) ?? 0) + 1);
      byAction.set(d.action, (byAction.get(d.action) ?? 0) + 1);
    }
    const summary = {
      byActor:  [...byActor.entries()].map(([actor, count]) => ({ actor, count })).sort((a, b) => b.count - a.count),
      byAction: [...byAction.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
    };
    return { detail, summary };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   *  5) OVERTIME — before/after shift split + % of working hours
   * ═══════════════════════════════════════════════════════════════════════ */
  async overtimeDetailed(tid: string, from: string, to: string) {
    const rows = await this.ds.query(
      `SELECT ar.attendance_date, ar.scheduled_start, ar.scheduled_end, ar.ot_minutes,
              to_char(ar.punch_in  AT TIME ZONE 'Asia/Kuwait', 'HH24:MI') AS punch_in_t,
              to_char(ar.punch_out AT TIME ZONE 'Asia/Kuwait', 'HH24:MI') AS punch_out_t,
              ar.attendance_marker,
              e.employee_no, e.first_name_en || ' ' || COALESCE(e.last_name_en,'') AS employee_name,
              e.gender, f.name AS function_name
         FROM attendance_records ar
         JOIN employees e ON e.id = ar.employee_id
         LEFT JOIN functions f ON f.id = e.function_id
        WHERE ar.tenant_id = $1 AND ar.attendance_date BETWEEN $2 AND $3
        ORDER BY ar.attendance_date DESC, e.first_name_en`,
      [tid, from, to],
    ).catch(() => []);

    const CAP = 600; // ignore absurd OT (data noise) over 10h on one side
    const detail: any[] = [];
    // accumulator per employee
    const acc = new Map<string, any>();

    for (const r of rows) {
      const ss = toMin(r.scheduled_start);
      let se = toMin(r.scheduled_end);
      const pin = toMin(r.punch_in_t);
      let pout = toMin(r.punch_out_t);
      const crossMid = ss != null && se != null && se <= ss;
      if (crossMid && se != null) se += 1440;
      if (pin != null && pout != null && pout < pin) pout += 1440;

      let otBefore = 0, otAfter = 0;
      if (ss != null && pin != null) otBefore = Math.min(CAP, Math.max(0, ss - pin));
      if (se != null && pout != null) otAfter = Math.min(CAP, Math.max(0, pout - se));
      const stored = r.ot_minutes ?? 0;
      const totalOt = stored > 0 ? stored : otBefore + otAfter;

      // scheduled work minutes (for % base) — only present days
      const schedMin = ss != null && se != null && r.attendance_marker === 'present'
        ? se - ss : 0;

      const k = r.employee_no || r.employee_name;
      const a = acc.get(k) ?? {
        employeeNo: r.employee_no ?? '', employee: (r.employee_name ?? '').trim(),
        function: r.function_name ?? '', gender: r.gender,
        otDays: 0, otBeforeMin: 0, otAfterMin: 0, totalOtMin: 0, scheduledMin: 0,
      };
      a.scheduledMin += schedMin;
      if (totalOt > 0) {
        a.otDays++;
        a.otBeforeMin += otBefore;
        a.otAfterMin += otAfter;
        a.totalOtMin += totalOt;
      }
      acc.set(k, a);

      if (totalOt > 0) {
        detail.push({
          date:        fmtDate(r.attendance_date),
          employeeNo:  r.employee_no ?? '',
          employee:    (r.employee_name ?? '').trim(),
          function:    r.function_name ?? '',
          shift:       r.scheduled_start ? `${HH(r.scheduled_start)}-${HH(r.scheduled_end)}` : '',
          punchIn:     r.punch_in_t ?? '',
          punchOut:    r.punch_out_t ?? '',
          otBeforeMin: otBefore,
          otAfterMin:  otAfter,
          totalOtMin:  totalOt,
          totalOtHrs:  +(totalOt / 60).toFixed(2),
        });
      }
    }

    const ranking = [...acc.values()]
      .filter(a => a.totalOtMin > 0)
      .map(a => ({
        employeeNo:  a.employeeNo,
        employee:    a.employee,
        function:    a.function,
        gender:      a.gender,
        otDays:      a.otDays,
        otBeforeMin: a.otBeforeMin,
        otBeforeHrs: +(a.otBeforeMin / 60).toFixed(2),
        otAfterMin:  a.otAfterMin,
        otAfterHrs:  +(a.otAfterMin / 60).toFixed(2),
        totalOtMin:  a.totalOtMin,
        totalOtHrs:  +(a.totalOtMin / 60).toFixed(2),
        scheduledHrs:+(a.scheduledMin / 60).toFixed(1),
        otPctOfWork: a.scheduledMin > 0 ? +((a.totalOtMin / a.scheduledMin) * 100).toFixed(1) : 0,
      }))
      .sort((a, b) => b.totalOtMin - a.totalOtMin)
      .map((r, i) => ({ rank: i + 1, ...r }));

    return { detail, ranking };
  }

  /* ═══════════════════════════════════════════════════════════════════════
   *  MASTER WORKBOOK — every report in one multi-sheet .xlsx
   * ═══════════════════════════════════════════════════════════════════════ */
  async buildWorkbook(tid: string, from: string, to: string): Promise<Buffer> {
    const [requests, perms, breaks, audit, ot] = await Promise.all([
      this.requestsDetailed(tid, from, to),
      this.permissionsDetailed(tid, from, to),
      this.breaksDetailed(tid, from, to),
      this.auditDetailed(tid, from, to),
      this.overtimeDetailed(tid, from, to),
    ]);

    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: any[]) => {
      const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'No data in this period' }]);
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    };

    add('Requests', requests);
    add('Permissions', perms.detail);
    add('Permission Intervals', perms.intervals);
    add('Permission Summary', perms.summary);
    add('Breaks', breaks.detail);
    add('Break Summary', breaks.summary);
    add('Overtime Daily', ot.detail);
    add('OT Ranking', ot.ranking);
    add('Audit Log', audit.detail);
    add('Audit by Actor', audit.summary.byActor);
    add('Audit by Action', audit.summary.byAction);

    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  // Single-sheet xlsx for one report (used by per-report download)
  sheetToXlsx(rows: any[], sheetName: string): Buffer {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'No data' }]);
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }
}
