import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/** SQL classifier: a shift code → broad category (for shift-rate distribution). */
export const SHIFT_CAT = `CASE
      WHEN upper(coalesce(original_shift_code, shift_code)) ~ '^(MD|MN)' THEN 'Midnight'
      WHEN upper(coalesce(original_shift_code, shift_code)) ~ '^(EE|E)' THEN 'Evening'
      WHEN upper(coalesce(original_shift_code, shift_code)) ~ '^N' THEN 'Night'
      WHEN upper(coalesce(original_shift_code, shift_code)) ~ '^(M|B|C|AM)' THEN 'Morning'
      ELSE 'Other' END`;

/** Helpers shared by the attendance-recon controllers (split from the monolithic
 *  ReconController, 2026-07-07 — EXECUTION_BRIEF Phase-4). Bodies moved VERBATIM:
 *  behavior must not change. */
@Injectable()
export class RosterSharedService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /* ── Approved-schedule SOFT LOCK ───────────────────────────────────────────
   *  The uploaded schedule is the authoritative baseline. Inside its date range,
   *  manual cell edits are blocked for everyone EXCEPT a supervisor with the
   *  `schedule.publish` permission (who may edit, fully audited). The only normal
   *  way to change it is re-uploading the schedule. Range auto-set on upload;
   *  stored in tenant_settings (no migration). Future dates stay editable. */
  async getScheduleLock(t: string): Promise<{ from: string; to: string; lockedAt?: string; lockedBy?: string } | null> {
    const [r] = await this.ds.query(`SELECT setting_value FROM tenant_settings WHERE tenant_id=$1 AND setting_key='schedule_lock'`, [t]);
    const v = r?.setting_value; return v ? (typeof v === 'string' ? JSON.parse(v) : v) : null;
  }
  async setScheduleLock(t: string, val: any) {
    await this.ds.query(
      `INSERT INTO tenant_settings (tenant_id, setting_key, setting_value, setting_group, updated_at)
         VALUES ($1,'schedule_lock',$2::jsonb,'schedule', now())
       ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value=$2::jsonb, updated_at=now()`,
      [t, JSON.stringify(val)]);
  }

  /** Team-leader resolution driven by the editable `team_leader_status` table.
   *  status: active | director | left ; hidden ⇒ suppressed everywhere. Falls back
   *  to matching an active Team-Leader employee (spelling-tolerant) for unlisted labels. */
  async tlResolver(t: string) {
    const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, '');
    const TL_ALIAS: Record<string, string> = { 'fatmehassan': 'fatma hasan' };
    const statusRows = await this.ds.query(`SELECT name, status, hidden, note FROM team_leader_status WHERE tenant_id=$1`, [t]);
    const byName = new Map<string, any>(statusRows.map((r: any) => [norm(r.name), r]));
    const hidden = new Set<string>(statusRows.filter((r: any) => r.hidden).map((r: any) => norm(r.name)));
    const tlActive = new Set((await this.ds.query(
      `SELECT clean_name FROM employee_identity WHERE tenant_id=$1 AND is_canonical AND role_category='Team Leader' AND is_active`, [t]
    )).map((r: any) => norm(r.clean_name)));
    const tlStatus = (name: string, matchedActive?: boolean) => {
      const n = norm(name); const st = byName.get(n);
      if (st) {
        if (st.hidden) return { verified: false, status: 'left', hidden: true, note: st.note || 'removed' };
        if (st.status === 'director') return { verified: true, status: 'director', hidden: false, note: st.note || 'director / management (present)' };
        if (st.status === 'left') return { verified: false, status: 'left', hidden: false, note: st.note || 'left' };
        return { verified: true, status: 'current', hidden: false, note: null };
      }
      const active = !!matchedActive || tlActive.has(n) || tlActive.has(norm(TL_ALIAS[n] || ''));
      return { verified: active, status: active ? 'current' : 'unverified', hidden: false, note: active ? null : 'team label not matched to an active Team-Leader employee — verify if this person left' };
    };
    return { tlActive, tlStatus, hidden, norm };
  }
}
