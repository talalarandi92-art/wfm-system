import {
  Injectable, BadRequestException, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface MergeResult {
  survivorId: string;
  mergedId: string;
  oldEmployeeNo: string;
  moved: {
    attendanceRecords: number;
    attendanceConflictsDropped: number;
    scheduleEntries: number;
    scheduleConflictsDropped: number;
    skills: number;
    requests: number;
    swapTargets: number;
    usersRelinked: number;
    usersUnlinked: number;
    managerRefs: number;
    rotationMemberships: number;
  };
}

@Injectable()
export class EmployeeMergeService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  // ── 1. Suspected duplicates ─────────────────────────────────────────────────
  //
  // Name matching is SUGGESTION ONLY — every merge needs explicit human
  // confirmation of a specific (survivor, merged) pair of employee ids.

  async listDuplicates(tenantId: string) {
    const rows = await this.ds.query(`
      WITH named AS (
        SELECT
          e.*,
          LOWER(TRIM(regexp_replace(
            e.first_name_en || ' ' || COALESCE(e.last_name_en, ''),
            '\\s+', ' ', 'g'
          ))) AS norm_name
        FROM employees e
        WHERE e.tenant_id = $1
          -- already-merged duplicates are excluded from new suggestions
          AND NOT EXISTS (
            SELECT 1 FROM employee_aliases a
            WHERE a.old_employee_id = e.id AND a.tenant_id = e.tenant_id
          )
      ),
      dup_names AS (
        SELECT norm_name FROM named GROUP BY norm_name HAVING COUNT(*) > 1
      )
      SELECT
        n.norm_name,
        n.id,
        n.employee_no,
        n.first_name_en || ' ' || COALESCE(n.last_name_en, '') AS full_name,
        n.gender,
        n.status,
        n.hire_date,
        n.created_at,
        f.name AS function_name,
        t.name AS team_name,
        (SELECT COUNT(*)::int FROM attendance_records ar WHERE ar.employee_id = n.id) AS attendance_count,
        (SELECT MIN(ar.attendance_date)::text FROM attendance_records ar WHERE ar.employee_id = n.id) AS attendance_from,
        (SELECT MAX(ar.attendance_date)::text FROM attendance_records ar WHERE ar.employee_id = n.id) AS attendance_to,
        (SELECT COUNT(*)::int FROM schedule_entries se WHERE se.employee_id = n.id)  AS schedule_count,
        (SELECT COUNT(*)::int FROM requests r WHERE r.employee_id = n.id)            AS request_count,
        EXISTS (SELECT 1 FROM users u WHERE u.employee_id = n.id)                    AS has_user
      FROM named n
      JOIN dup_names d ON d.norm_name = n.norm_name
      LEFT JOIN functions f ON f.id = n.function_id
      LEFT JOIN teams     t ON t.id = n.team_id
      ORDER BY n.norm_name, n.created_at
    `, [tenantId]);

    // Group flat rows into duplicate groups
    const groups = new Map<string, any>();
    for (const r of rows) {
      if (!groups.has(r.norm_name)) {
        groups.set(r.norm_name, {
          normName: r.norm_name,
          sameFunction: true,
          employees: [],
        });
      }
      const g = groups.get(r.norm_name);
      g.employees.push({
        id: r.id,
        employeeNo: r.employee_no,
        fullName: (r.full_name ?? '').trim(),
        gender: r.gender,
        status: r.status,
        hireDate: r.hire_date,
        createdAt: r.created_at,
        functionName: r.function_name,
        teamName: r.team_name,
        attendanceCount: r.attendance_count,
        attendanceFrom: r.attendance_from,
        attendanceTo: r.attendance_to,
        scheduleCount: r.schedule_count,
        requestCount: r.request_count,
        hasUser: r.has_user,
      });
    }

    const result = [...groups.values()];
    for (const g of result) {
      const fns = new Set(g.employees.map((e: any) => e.functionName ?? ''));
      g.sameFunction = fns.size === 1;
    }
    return { total: result.length, groups: result };
  }

  // ── 2. Merge two confirmed records ──────────────────────────────────────────
  //
  // Re-points every FK reference from the merged (losing) employee to the
  // survivor, stores the old employee_no as an alias, deactivates the losing
  // record, and writes an immutable audit log entry — all in one transaction.

  async merge(
    tenantId: string,
    actor: { id: string; email?: string },
    survivorId: string,
    mergedId: string,
    reason?: string,
  ): Promise<MergeResult> {
    if (!survivorId || !mergedId) {
      throw new BadRequestException('survivorId and mergedId are required');
    }
    if (survivorId === mergedId) {
      throw new BadRequestException('survivorId and mergedId must be different employees');
    }

    return this.ds.transaction(async (em) => {
      const emps = await em.query(
        `SELECT id, employee_no, first_name_en, last_name_en, gender, status,
                function_id, team_id, hire_date, notes
           FROM employees
          WHERE tenant_id = $1 AND id = ANY($2::uuid[])
          FOR UPDATE`,
        [tenantId, [survivorId, mergedId]],
      );
      const survivor = emps.find((e: any) => e.id === survivorId);
      const merged   = emps.find((e: any) => e.id === mergedId);
      if (!survivor) throw new NotFoundException('Surviving employee not found in this tenant');
      if (!merged)   throw new NotFoundException('Employee to merge not found in this tenant');

      const [already] = await em.query(
        `SELECT 1 FROM employee_aliases WHERE tenant_id = $1 AND old_employee_id = ANY($2::uuid[]) LIMIT 1`,
        [tenantId, [survivorId, mergedId]],
      );
      if (already) {
        throw new BadRequestException('One of these employees was already part of a merge');
      }

      // TypeORM's raw query() on Postgres returns [rows, rowCount] for
      // UPDATE/DELETE statements — the affected count is the second element.
      const count = (r: any) =>
        (Array.isArray(r) && typeof r[1] === 'number' ? r[1] : Array.isArray(r) ? r.length : 0);

      // attendance_records — UNIQUE (tenant_id, employee_id, attendance_date):
      // when both records hold the same date, keep the survivor's row.
      const attDropped = await em.query(
        `DELETE FROM attendance_records a
          WHERE a.employee_id = $1
            AND EXISTS (SELECT 1 FROM attendance_records s
                         WHERE s.tenant_id = a.tenant_id
                           AND s.employee_id = $2
                           AND s.attendance_date = a.attendance_date)
          RETURNING 1`,
        [mergedId, survivorId],
      );
      const attMoved = await em.query(
        `UPDATE attendance_records SET employee_id = $2 WHERE employee_id = $1 RETURNING 1`,
        [mergedId, survivorId],
      );

      // schedule_entries — UNIQUE (schedule_version_id, employee_id, entry_date)
      const schedDropped = await em.query(
        `DELETE FROM schedule_entries e
          WHERE e.employee_id = $1
            AND EXISTS (SELECT 1 FROM schedule_entries s
                         WHERE s.schedule_version_id = e.schedule_version_id
                           AND s.employee_id = $2
                           AND s.entry_date = e.entry_date)
          RETURNING 1`,
        [mergedId, survivorId],
      );
      const schedMoved = await em.query(
        `UPDATE schedule_entries SET employee_id = $2 WHERE employee_id = $1 RETURNING 1`,
        [mergedId, survivorId],
      );

      // employee_skills — UNIQUE (employee_id, skill_id)
      await em.query(
        `DELETE FROM employee_skills es
          WHERE es.employee_id = $1
            AND EXISTS (SELECT 1 FROM employee_skills s
                         WHERE s.employee_id = $2 AND s.skill_id = es.skill_id)`,
        [mergedId, survivorId],
      );
      const skillsMoved = await em.query(
        `UPDATE employee_skills SET employee_id = $2 WHERE employee_id = $1 RETURNING 1`,
        [mergedId, survivorId],
      );

      // requests + shift-swap targets
      const reqMoved = await em.query(
        `UPDATE requests SET employee_id = $2 WHERE employee_id = $1 RETURNING 1`,
        [mergedId, survivorId],
      );
      const swapMoved = await em.query(
        `UPDATE request_shift_swaps SET target_employee_id = $2 WHERE target_employee_id = $1 RETURNING 1`,
        [mergedId, survivorId],
      );

      // users — relink only if the survivor has no linked user yet
      const usersRelinked = await em.query(
        `UPDATE users SET employee_id = $2
          WHERE employee_id = $1
            AND NOT EXISTS (SELECT 1 FROM users s WHERE s.employee_id = $2)
          RETURNING 1`,
        [mergedId, survivorId],
      );
      const usersUnlinked = await em.query(
        `UPDATE users SET employee_id = NULL WHERE employee_id = $1 RETURNING 1`,
        [mergedId],
      );

      // manager references
      const mgrTeams = await em.query(
        `UPDATE teams SET manager_id = $2 WHERE manager_id = $1 RETURNING 1`,
        [mergedId, survivorId],
      );
      const mgrEmps = await em.query(
        `UPDATE employees SET direct_manager_id = $2 WHERE direct_manager_id = $1 RETURNING 1`,
        [mergedId, survivorId],
      );

      // rotation_group_members — UNIQUE (tenant_id, employee_id)
      await em.query(
        `DELETE FROM rotation_group_members m
          WHERE m.employee_id = $1
            AND EXISTS (SELECT 1 FROM rotation_group_members s
                         WHERE s.tenant_id = m.tenant_id AND s.employee_id = $2)`,
        [mergedId, survivorId],
      );
      const rotMoved = await em.query(
        `UPDATE rotation_group_members SET employee_id = $2 WHERE employee_id = $1 RETURNING 1`,
        [mergedId, survivorId],
      );

      // Record the retired employee_no as an alias of the survivor
      await em.query(
        `INSERT INTO employee_aliases
           (tenant_id, employee_id, old_employee_no, old_employee_id, merged_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, survivorId, merged.employee_no, mergedId, actor.id, reason ?? null],
      );

      // Deactivate the losing record (kept for traceability)
      await em.query(
        `UPDATE employees
            SET status = 'inactive',
                notes  = TRIM(COALESCE(notes, '') || E'\n' ||
                         'Merged into employee_no ' || $3 || ' on ' || NOW()::date),
                updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2`,
        [mergedId, tenantId, survivor.employee_no],
      );

      // Backfill survivor hire_date from the (usually older) merged record
      await em.query(
        `UPDATE employees s
            SET hire_date = LEAST(COALESCE(s.hire_date, m.hire_date), COALESCE(m.hire_date, s.hire_date)),
                updated_at = NOW()
           FROM employees m
          WHERE s.id = $1 AND m.id = $2 AND m.hire_date IS NOT NULL`,
        [survivorId, mergedId],
      );

      const result: MergeResult = {
        survivorId,
        mergedId,
        oldEmployeeNo: merged.employee_no,
        moved: {
          attendanceRecords: count(attMoved),
          attendanceConflictsDropped: count(attDropped),
          scheduleEntries: count(schedMoved),
          scheduleConflictsDropped: count(schedDropped),
          skills: count(skillsMoved),
          requests: count(reqMoved),
          swapTargets: count(swapMoved),
          usersRelinked: count(usersRelinked),
          usersUnlinked: count(usersUnlinked),
          managerRefs: count(mgrTeams) + count(mgrEmps),
          rotationMemberships: count(rotMoved),
        },
      };

      // Immutable audit entry
      await em.query(
        `INSERT INTO audit_logs
           (tenant_id, actor_id, actor_email, action, module, entity_type, entity_id,
            old_value, new_value, metadata, notes)
         VALUES ($1, $2, $3, 'employee.merged', 'employees', 'employee', $4, $5, $6, $7, $8)`,
        [
          tenantId,
          actor.id,
          actor.email ?? null,
          survivorId,
          JSON.stringify({ mergedEmployee: merged }),
          JSON.stringify({ survivor, aliasedEmployeeNo: merged.employee_no }),
          JSON.stringify({ counts: result.moved, reason: reason ?? null }),
          reason ?? null,
        ],
      );

      return result;
    });
  }
}
