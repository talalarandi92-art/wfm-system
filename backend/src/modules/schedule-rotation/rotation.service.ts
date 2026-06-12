import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  EmployeeShiftRate,
  RotationGroup,
  ShiftRatesSummary,
  ShiftRatesResponse,
  CreateGroupDto,
  AssignMembersDto,
} from './rotation.types';

// Re-use the same shift catalog from the generator
const SHIFT_CATALOG: Record<string, { category: string; code: string }> = {
  M:   { code: 'M',   category: 'morning'   },
  B:   { code: 'B',   category: 'morning'   },
  C:   { code: 'C',   category: 'afternoon' },
  E:   { code: 'E',   category: 'evening'   },
  N:   { code: 'N',   category: 'night'     },
  N2:  { code: 'N2',  category: 'night'     },
  MD:  { code: 'MD',  category: 'midnight'  },
  MN:  { code: 'MN',  category: 'midnight'  },
  OFF: { code: 'OFF', category: 'off'       },
};

// Derive category from start hour
function categoryFromHour(h: number): string {
  if (h >= 6  && h < 10) return 'morning';
  if (h >= 10 && h < 12) return 'morning';
  if (h >= 12 && h < 14) return 'afternoon';
  if (h >= 14 && h < 17) return 'evening';
  if (h >= 17 && h < 20) return 'night';
  if (h >= 20 && h < 23) return 'night';
  return 'midnight';
}

function categoryFromStartTime(startTime: string | null): string {
  if (!startTime) return 'off';
  const h = parseInt(startTime.split(':')[0], 10);
  return categoryFromHour(h);
}

// Recommended next shift based on fairness + rotation
function recommendNext(
  current: EmployeeShiftRate,
  avgNightMidnightPct: number,
): { code: string; reason: string } {
  const { nightMidnightPct, lastShiftCode, rotationGroupId } = current;

  // If employee is below average on night/midnight → offer night
  if (nightMidnightPct < avgNightMidnightPct * 0.7) {
    return { code: 'N', reason: 'نسبة الليل منخفضة — يُفضَّل التوزيع العادل' };
  }
  // If employee is way above average → offer morning
  if (nightMidnightPct > avgNightMidnightPct * 1.4) {
    return { code: 'M', reason: 'نسبة الليل مرتفعة — يُفضَّل تخفيف وردية الليل' };
  }

  // Default rotation based on last shift
  const rotMap: Record<string, string> = {
    M: 'B', B: 'C', C: 'E', E: 'N', N: 'M', N2: 'M', MD: 'M', OFF: 'M',
  };
  const next = rotMap[lastShiftCode] ?? 'M';
  return { code: next, reason: 'الدوران الطبيعي للورديات' };
}

@Injectable()
export class RotationService implements OnModuleInit {
  private readonly logger = new Logger(RotationService.name);

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ── Create tables on startup ────────────────────────────────────────────────
  async onModuleInit() {
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS rotation_groups (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id   UUID NOT NULL,
          name        VARCHAR(100) NOT NULL,
          rotation_sequence  TEXT[] NOT NULL DEFAULT '{}',
          color       VARCHAR(20)  NOT NULL DEFAULT '#6366f1',
          description TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS rotation_group_members (
          id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tenant_id           UUID NOT NULL,
          rotation_group_id   UUID NOT NULL REFERENCES rotation_groups(id) ON DELETE CASCADE,
          employee_id         UUID NOT NULL,
          joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, employee_id)
        );
      `);
      this.logger.log('Rotation tables ready');
    } catch (err) {
      this.logger.warn('Could not create rotation tables (may already exist): ' + err.message);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  private fmtDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private calcFairnessScore(nightPcts: number[]): number {
    if (nightPcts.length < 2) return 100;
    const avg = nightPcts.reduce((a, b) => a + b, 0) / nightPcts.length;
    if (avg === 0) return 100;
    const variance = nightPcts.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / nightPcts.length;
    const stddev = Math.sqrt(variance);
    const cv = stddev / avg; // coefficient of variation
    // cv=0 → score=100; cv=1 → score=0
    return Math.round(Math.max(0, Math.min(100, (1 - cv) * 100)));
  }

  // ── Load shift rates ─────────────────────────────────────────────────────────
  async getShiftRates(
    tenantId: string,
    year: number,
    functionId?: string,
  ): Promise<ShiftRatesResponse> {
    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year}-12-31`;

    // ── Load all active employees ──────────────────────────────────────────────
    const empRows = await this.ds.query(
      `SELECT e.id, e.employee_no, e.first_name_en, e.last_name_en,
              e.gender, f.id AS fn_id, f.name AS fn_name
       FROM employees e
       LEFT JOIN functions f ON e.function_id = f.id
       WHERE e.tenant_id = $1 AND e.status = 'active'
         ${functionId ? 'AND e.function_id = $2' : ''}
       ORDER BY f.name, e.first_name_en`,
      functionId ? [tenantId, functionId] : [tenantId],
    );

    if (!empRows.length) {
      return {
        summary:   { totalEmployees: 0, avgNightPct: 0, avgMidnightPct: 0, avgMorningPct: 0, fairnessScore: 100, rotationGroupCount: 0, periodLabel: `${year}`, dataSource: 'none' },
        employees: [],
        groups:    [],
      };
    }

    const empIds = empRows.map((r: any) => r.id);

    // ── Load rotation group membership ────────────────────────────────────────
    const groupMembers = await this.ds.query(
      `SELECT rgm.employee_id, rg.id AS group_id, rg.name AS group_name, rg.color AS group_color
       FROM rotation_group_members rgm
       JOIN rotation_groups rg ON rgm.rotation_group_id = rg.id
       WHERE rgm.tenant_id = $1 AND rgm.employee_id = ANY($2::uuid[])`,
      [tenantId, empIds],
    );
    const groupMap = new Map<string, { id: string; name: string; color: string }>();
    for (const gm of groupMembers) {
      groupMap.set(gm.employee_id, { id: gm.group_id, name: gm.group_name, color: gm.group_color });
    }

    // ── Load YTD attendance data ───────────────────────────────────────────────
    const attRows = await this.ds.query(
      `SELECT ar.employee_id, ar.attendance_marker, ar.scheduled_start, ar.attendance_date
       FROM attendance_records ar
       WHERE ar.tenant_id = $1
         AND ar.employee_id = ANY($2::uuid[])
         AND ar.attendance_date BETWEEN $3 AND $4`,
      [tenantId, empIds, yearStart, yearEnd],
    );

    // ── Load YTD from schedule_entries (generator output) ─────────────────────
    const schedRows = await this.ds.query(
      `SELECT se.employee_id, se.shift_code_display, se.entry_date, se.attendance_marker
       FROM schedule_entries se
       WHERE se.tenant_id = $1
         AND se.employee_id = ANY($2::uuid[])
         AND se.entry_date BETWEEN $3 AND $4`,
      [tenantId, empIds, yearStart, yearEnd],
    );

    // ── Load last shift per employee ──────────────────────────────────────────
    const lastShiftRows = await this.ds.query(
      `SELECT DISTINCT ON (ar.employee_id)
         ar.employee_id, ar.scheduled_start, ar.attendance_marker, ar.attendance_date
       FROM attendance_records ar
       WHERE ar.tenant_id = $1
         AND ar.employee_id = ANY($2::uuid[])
       ORDER BY ar.employee_id, ar.attendance_date DESC`,
      [tenantId, empIds],
    );
    const lastShiftMap = new Map<string, { code: string; date: string }>();
    for (const r of lastShiftRows) {
      let code = 'M';
      if (r.attendance_marker === 'off') code = 'OFF';
      else if (r.scheduled_start) {
        const h = parseInt(r.scheduled_start.split(':')[0], 10);
        if (h >= 6  && h < 10) code = 'M';
        else if (h >= 10 && h < 12) code = 'B';
        else if (h >= 12 && h < 14) code = 'C';
        else if (h >= 14 && h < 17) code = 'E';
        else if (h >= 17 && h < 20) code = 'N';
        else if (h >= 20 && h < 23) code = 'N2';
        else code = 'MD';
      }
      lastShiftMap.set(r.employee_id, { code, date: r.attendance_date });
    }

    // ── Aggregate counts per employee ─────────────────────────────────────────
    type Counts = { morning: number; afternoon: number; evening: number; night: number; midnight: number; off: number; leave: number };
    const countMap = new Map<string, Counts>();
    const init = (): Counts => ({ morning: 0, afternoon: 0, evening: 0, night: 0, midnight: 0, off: 0, leave: 0 });

    const processRecord = (empId: string, marker: string, startTime: string | null) => {
      if (!countMap.has(empId)) countMap.set(empId, init());
      const c = countMap.get(empId)!;

      if (marker === 'off')                                     { c.off++; return; }
      if (['leave','sick','comp','holiday'].includes(marker))   { c.leave++; return; }
      if (marker === 'absent')                                   { return; } // don't count
      if (!startTime)                                            { return; }

      const cat = categoryFromStartTime(startTime);
      if (cat === 'morning')   c.morning++;
      else if (cat === 'afternoon') c.afternoon++;
      else if (cat === 'evening')   c.evening++;
      else if (cat === 'night')     c.night++;
      else if (cat === 'midnight')  c.midnight++;
    };

    // Process attendance records
    for (const r of attRows) {
      processRecord(r.employee_id, r.attendance_marker, r.scheduled_start);
    }

    // Process schedule entries (merge — avoid double-counting dates)
    const attendanceDates = new Set<string>();
    for (const r of attRows) {
      attendanceDates.add(`${r.employee_id}:${r.attendance_date?.toString()?.slice(0,10)}`);
    }
    for (const r of schedRows) {
      const dateKey = `${r.employee_id}:${r.entry_date?.toString()?.slice(0,10)}`;
      if (attendanceDates.has(dateKey)) continue; // already counted
      // map shift_code_display to category
      const shiftCat = SHIFT_CATALOG[r.shift_code_display]?.category;
      if (!shiftCat) continue;
      processRecord(r.employee_id, r.attendance_marker ?? 'present',
        shiftCat === 'off' ? null :
        shiftCat === 'morning'   ? '07:00' :
        shiftCat === 'afternoon' ? '12:00' :
        shiftCat === 'evening'   ? '14:00' :
        shiftCat === 'night'     ? '17:00' : '23:00',
      );
    }

    // ── Build employee shift-rate objects ─────────────────────────────────────
    const employees: EmployeeShiftRate[] = empRows.map((e: any) => {
      const counts = countMap.get(e.id) ?? init();
      const working = counts.morning + counts.afternoon + counts.evening + counts.night + counts.midnight;
      const pct = (n: number) => working > 0 ? Math.round((n / working) * 100) : 0;

      const morningPct   = pct(counts.morning);
      const afternoonPct = pct(counts.afternoon);
      const eveningPct   = pct(counts.evening);
      const nightPct     = pct(counts.night);
      const midnightPct  = pct(counts.midnight);
      const nightMidnightPct = nightPct + midnightPct;

      const grp = groupMap.get(e.id);
      const lastShift = lastShiftMap.get(e.id);

      return {
        employeeId:         e.id,
        employeeNo:         e.employee_no,
        name:               `${e.first_name_en ?? ''} ${e.last_name_en ?? ''}`.trim(),
        gender:             e.gender ?? 'male',
        functionId:         e.fn_id ?? '',
        functionName:       e.fn_name ?? '—',
        rotationGroupId:    grp?.id ?? null,
        rotationGroupName:  grp?.name ?? null,
        rotationGroupColor: grp?.color ?? null,
        morning:   counts.morning,
        afternoon: counts.afternoon,
        evening:   counts.evening,
        night:     counts.night,
        midnight:  counts.midnight,
        off:       counts.off,
        leave:     counts.leave,
        workingTotal:  working,
        morningPct, afternoonPct, eveningPct, nightPct, midnightPct, nightMidnightPct,
        relativeNightScore: 100, // calculated below after we have avg
        lastShiftCode: lastShift?.code ?? 'M',
        lastShiftDate: lastShift?.date ? new Date(lastShift.date).toISOString().slice(0,10) : null,
        recommendedNextShift: 'M',
        recommendationReason: '—',
      } as EmployeeShiftRate;
    });

    // ── Calculate averages and relative scores ────────────────────────────────
    const avgNightMidnight = employees.length > 0
      ? employees.reduce((a, e) => a + e.nightMidnightPct, 0) / employees.length
      : 0;

    for (const e of employees) {
      e.relativeNightScore = avgNightMidnight > 0
        ? Math.round((e.nightMidnightPct / avgNightMidnight) * 100)
        : 100;

      const rec = recommendNext(e, avgNightMidnight);
      e.recommendedNextShift = rec.code;
      e.recommendationReason = rec.reason;
    }

    // ── Fairness score ────────────────────────────────────────────────────────
    const nightPcts = employees.map((e) => e.nightMidnightPct);
    const fairnessScore = this.calcFairnessScore(nightPcts);

    // ── Load rotation groups ──────────────────────────────────────────────────
    const groups = await this.getGroups(tenantId);

    const avgNightPct    = employees.length > 0 ? Math.round(employees.reduce((a, e) => a + e.nightPct,    0) / employees.length) : 0;
    const avgMidnightPct = employees.length > 0 ? Math.round(employees.reduce((a, e) => a + e.midnightPct, 0) / employees.length) : 0;
    const avgMorningPct  = employees.length > 0 ? Math.round(employees.reduce((a, e) => a + e.morningPct,  0) / employees.length) : 0;

    const hasData = attRows.length > 0 || schedRows.length > 0;

    return {
      summary: {
        totalEmployees:     employees.length,
        avgNightPct,
        avgMidnightPct,
        avgMorningPct,
        fairnessScore,
        rotationGroupCount: groups.length,
        periodLabel:        `${year}`,
        dataSource:         hasData ? (attRows.length > 0 ? 'attendance_records' : 'schedule_entries') : 'none',
      },
      employees,
      groups,
    };
  }

  // ── Rotation groups CRUD ──────────────────────────────────────────────────────
  async getGroups(tenantId: string): Promise<RotationGroup[]> {
    const rows = await this.ds.query(
      `SELECT rg.id, rg.name, rg.rotation_sequence, rg.color, rg.description,
              COUNT(rgm.id)::int AS member_count
       FROM rotation_groups rg
       LEFT JOIN rotation_group_members rgm ON rgm.rotation_group_id = rg.id
       WHERE rg.tenant_id = $1
       GROUP BY rg.id
       ORDER BY rg.name`,
      [tenantId],
    );
    return rows.map((r: any) => ({
      id:               r.id,
      name:             r.name,
      rotationSequence: r.rotation_sequence ?? [],
      color:            r.color ?? '#6366f1',
      description:      r.description,
      memberCount:      r.member_count ?? 0,
    }));
  }

  async createGroup(tenantId: string, dto: CreateGroupDto): Promise<RotationGroup> {
    const [row] = await this.ds.query(
      `INSERT INTO rotation_groups (tenant_id, name, rotation_sequence, color, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, rotation_sequence, color, description`,
      [tenantId, dto.name, dto.rotationSequence, dto.color ?? '#6366f1', dto.description ?? null],
    );
    return { ...row, rotationSequence: row.rotation_sequence ?? [], memberCount: 0 };
  }

  async updateGroup(tenantId: string, groupId: string, dto: Partial<CreateGroupDto>): Promise<RotationGroup> {
    const sets: string[] = [];
    const params: any[] = [tenantId, groupId];
    let idx = 3;
    if (dto.name !== undefined)             { sets.push(`name = $${idx++}`);              params.push(dto.name); }
    if (dto.rotationSequence !== undefined) { sets.push(`rotation_sequence = $${idx++}`); params.push(dto.rotationSequence); }
    if (dto.color !== undefined)            { sets.push(`color = $${idx++}`);             params.push(dto.color); }
    if (dto.description !== undefined)      { sets.push(`description = $${idx++}`);       params.push(dto.description); }
    sets.push('updated_at = NOW()');

    const [row] = await this.ds.query(
      `UPDATE rotation_groups SET ${sets.join(', ')}
       WHERE id = $2 AND tenant_id = $1
       RETURNING id, name, rotation_sequence, color, description`,
      params,
    );
    const [cnt] = await this.ds.query(
      `SELECT COUNT(*)::int AS c FROM rotation_group_members WHERE rotation_group_id = $1`, [groupId],
    );
    return { ...row, rotationSequence: row.rotation_sequence ?? [], memberCount: cnt.c ?? 0 };
  }

  async deleteGroup(tenantId: string, groupId: string): Promise<void> {
    await this.ds.query(
      `DELETE FROM rotation_groups WHERE id = $1 AND tenant_id = $2`,
      [groupId, tenantId],
    );
  }

  async assignMembers(tenantId: string, groupId: string, dto: AssignMembersDto): Promise<void> {
    for (const empId of dto.employeeIds) {
      await this.ds.query(
        `INSERT INTO rotation_group_members (tenant_id, rotation_group_id, employee_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, employee_id)
         DO UPDATE SET rotation_group_id = $2, joined_at = NOW()`,
        [tenantId, groupId, empId],
      );
    }
  }

  async removeMember(tenantId: string, groupId: string, employeeId: string): Promise<void> {
    await this.ds.query(
      `DELETE FROM rotation_group_members
       WHERE tenant_id = $1 AND rotation_group_id = $2 AND employee_id = $3`,
      [tenantId, groupId, employeeId],
    );
  }
}
