/**
 * BUILDER v2 — DECLARATIVE DATA-SOURCE CATALOG (BLD-1).
 *
 * ONE builder, MANY domains. Every domain below is a selectable Data Source that
 * exposes its dimensions (group-by) and metrics (measures) to the visual builder.
 * This file is STATIC config — the only allowlist the query compiler trusts. A dim
 * or metric that is NOT listed here for a source can NEVER reach the SQL (no raw
 * columns from the client → no injection surface).
 *
 * Canonical metric definitions are REUSED from @common/wfm-metrics so a builder
 * number equals the dedicated report's number (TRUE_OT, credible late/early, etc.).
 * Columns were verified against information_schema on the live wfm_db (2026-07-11).
 */
import { TRUE_OT, CRED_LATE, CRED_EARLY, MATERNITY_7H } from '@common/wfm-metrics';

export type ColType = 'string' | 'number' | 'time' | 'date' | 'bool';
export type MetricFormat = 'int' | 'minutes' | 'hours' | 'pct' | 'decimal' | 'count';

export interface Dimension {
  key: string;
  col: string;          // SQL expression (trusted, from this file only)
  label_en: string;
  label_ar: string;
  type: ColType;
  time?: boolean;       // render minutes-since-midnight as HH:MM
}

export interface Metric {
  key: string;
  expr: string;         // FULL aggregate expression producing the measure value
  label_en: string;
  label_ar: string;
  format: MetricFormat;
}

export interface DataSourceDef {
  key: string;
  label_en: string;
  label_ar: string;
  group: string;                 // UI grouping (Attendance / Overtime / Scorecard …)
  from: string;                  // FROM clause (may include a FIXED join)
  tenantCol: string;             // tenant scoping column
  dateCol: string;               // date column the dashboard date-range filters on
  personCol?: string;            // if set, agents are auto-scoped to their own value here
  permission: string;            // RBAC code required to read this source
  dimensions: Dimension[];
  metrics: Metric[];
}

// ── shared roster_days dimensions (the canonical daily fact) ────────────────
const RD_DIMS: Dimension[] = [
  { key: 'person',       col: 'COALESCE(person_no,employee_no)',        label_en: 'Agent ID',    label_ar: 'رقم الموظف', type: 'string' },
  { key: 'name',         col: 'COALESCE(clean_name,name)',              label_en: 'Agent',       label_ar: 'الموظف',     type: 'string' },
  { key: 'function',     col: 'canon_fn(COALESCE(role_function,function_name))', label_en: 'Function', label_ar: 'الوظيفة', type: 'string' },
  { key: 'role',         col: 'role_category',                          label_en: 'Role',        label_ar: 'الدور',      type: 'string' },
  { key: 'teamLeader',   col: 'team_manager',                           label_en: 'Team Leader', label_ar: 'المشرف',     type: 'string' },
  { key: 'team',         col: 'team_group',                             label_en: 'Team',        label_ar: 'الفريق',     type: 'string' },
  { key: 'gender',       col: 'gender',                                 label_en: 'Gender',      label_ar: 'الجنس',      type: 'string' },
  { key: 'shift',        col: 'shift_code',                             label_en: 'Shift',       label_ar: 'الوردية',    type: 'string' },
  { key: 'presence',     col: 'presence',                               label_en: 'Presence',    label_ar: 'الحضور',     type: 'string' },
  { key: 'date',         col: 'work_date::text',                        label_en: 'Date',        label_ar: 'التاريخ',    type: 'date' },
  { key: 'day',          col: 'day_name',                               label_en: 'Day',         label_ar: 'اليوم',      type: 'string' },
  { key: 'month',        col: 'month_name',                             label_en: 'Month',       label_ar: 'الشهر',      type: 'string' },
];

export const DATA_SOURCES: DataSourceDef[] = [
  // ── OVERTIME ──────────────────────────────────────────────────────────────
  {
    key: 'overtime', label_en: 'Overtime', label_ar: 'العمل الإضافي', group: 'Overtime',
    from: 'roster_days', tenantCol: 'tenant_id', dateCol: 'work_date', personCol: 'COALESCE(person_no,employee_no)',
    permission: 'attendance.view_team',
    dimensions: RD_DIMS,
    metrics: [
      { key: 'trueOtMin',   expr: `SUM(${TRUE_OT})`,                                     label_en: 'True OT (min)',    label_ar: 'الإضافي (دقيقة)', format: 'minutes' },
      { key: 'trueOtHrs',   expr: `ROUND(SUM(${TRUE_OT})/60.0,1)`,                        label_en: 'True OT (hrs)',    label_ar: 'الإضافي (ساعة)',  format: 'hours' },
      { key: 'regularOtMin',expr: 'SUM(COALESCE(ot_min,0))',                              label_en: 'Regular OT (min)', label_ar: 'إضافي عادي',      format: 'minutes' },
      { key: 'offdayOtMin', expr: 'SUM(COALESCE(offday_ot_min,0))',                       label_en: 'Off-day OT (min)', label_ar: 'إضافي إجازة',     format: 'minutes' },
      { key: 'holidayOtMin',expr: 'SUM(COALESCE(holiday_ot_min,0))',                      label_en: 'Holiday OT (min)', label_ar: 'إضافي عطلة',      format: 'minutes' },
      { key: 'offWorkedMin',expr: 'SUM(COALESCE(off_worked_min,0))',                      label_en: 'Off worked (min)', label_ar: 'عمل بالإجازة',    format: 'minutes' },
      { key: 'otBeforeMin', expr: 'SUM(COALESCE(ot_before_min,0))',                       label_en: 'OT before shift',  label_ar: 'إضافي قبل',       format: 'minutes' },
      { key: 'otAfterMin',  expr: 'SUM(COALESCE(ot_after_min,0))',                        label_en: 'OT after shift',   label_ar: 'إضافي بعد',       format: 'minutes' },
      { key: 'otDays',      expr: `COUNT(*) FILTER (WHERE (${TRUE_OT}) > 0)`,             label_en: 'OT days',          label_ar: 'أيام الإضافي',    format: 'count' },
      { key: 'agents',      expr: 'COUNT(DISTINCT COALESCE(person_no,employee_no))',      label_en: 'Agents',           label_ar: 'الموظفون',        format: 'count' },
    ],
  },

  // ── LOGIN / LOGOUT ────────────────────────────────────────────────────────
  {
    key: 'login_logout', label_en: 'Login / Logout', label_ar: 'الدخول والخروج', group: 'Attendance',
    from: 'roster_days', tenantCol: 'tenant_id', dateCol: 'work_date', personCol: 'COALESCE(person_no,employee_no)',
    permission: 'attendance.view_team',
    dimensions: [...RD_DIMS, { key: 'loginSrc', col: 'login_src', label_en: 'Login Source', label_ar: 'مصدر الدخول', type: 'string' }],
    metrics: [
      { key: 'workedMin',    expr: 'SUM(COALESCE(worked_min,0))',                         label_en: 'Worked (min)',    label_ar: 'العمل (دقيقة)', format: 'minutes' },
      { key: 'workedHrs',    expr: 'ROUND(SUM(COALESCE(worked_min,0))/60.0,1)',           label_en: 'Worked (hrs)',    label_ar: 'العمل (ساعة)',  format: 'hours' },
      { key: 'avgLoginMin',  expr: 'ROUND(AVG(sys_login_min))',                           label_en: 'Avg login',       label_ar: 'متوسط الدخول',  format: 'int' },
      { key: 'avgLogoutMin', expr: 'ROUND(AVG(sys_logout_min))',                          label_en: 'Avg logout',      label_ar: 'متوسط الخروج',  format: 'int' },
      { key: 'credLateMin',  expr: `SUM(sys_late_min) FILTER (WHERE ${CRED_LATE})`,       label_en: 'Late (min)',      label_ar: 'التأخير (دقيقة)', format: 'minutes' },
      { key: 'credLateDays', expr: `COUNT(*) FILTER (WHERE ${CRED_LATE})`,                label_en: 'Late days',       label_ar: 'أيام التأخير',  format: 'count' },
      { key: 'credEarlyMin', expr: `SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY})`,     label_en: 'Early out (min)', label_ar: 'الخروج المبكر', format: 'minutes' },
      { key: 'credEarlyDays',expr: `COUNT(*) FILTER (WHERE ${CRED_EARLY})`,               label_en: 'Early-out days',  label_ar: 'أيام الخروج',   format: 'count' },
      { key: 'haveLogin',    expr: 'COUNT(*) FILTER (WHERE sys_login_min IS NOT NULL)',   label_en: 'Days w/ login',   label_ar: 'أيام لها دخول', format: 'count' },
      { key: 'missingSystem',expr: 'COUNT(*) FILTER (WHERE missing_system)',              label_en: 'Missing system',  label_ar: 'دخول ناقص',     format: 'count' },
    ],
  },

  // ── ATTENDANCE / TARDINESS ────────────────────────────────────────────────
  {
    key: 'attendance', label_en: 'Attendance', label_ar: 'الحضور والانصراف', group: 'Attendance',
    from: 'roster_days', tenantCol: 'tenant_id', dateCol: 'work_date', personCol: 'COALESCE(person_no,employee_no)',
    permission: 'attendance.view_team',
    dimensions: [...RD_DIMS, { key: 'hrCode', col: 'hr_code', label_en: 'HR Code', label_ar: 'رمز HR', type: 'string' }],
    metrics: [
      { key: 'scheduledDays', expr: 'COUNT(*)',                                                    label_en: 'Scheduled days', label_ar: 'أيام مجدولة', format: 'count' },
      { key: 'workedDays',    expr: `COUNT(*) FILTER (WHERE presence IN ('office','wfh'))`,        label_en: 'Worked days',    label_ar: 'أيام العمل',  format: 'count' },
      { key: 'officeDays',    expr: `COUNT(*) FILTER (WHERE presence='office')`,                   label_en: 'Office days',    label_ar: 'أيام المكتب', format: 'count' },
      { key: 'wfhDays',       expr: `COUNT(*) FILTER (WHERE presence='wfh')`,                      label_en: 'WFH days',       label_ar: 'أيام المنزل', format: 'count' },
      { key: 'offDays',       expr: `COUNT(*) FILTER (WHERE presence='off')`,                      label_en: 'OFF days',       label_ar: 'أيام الراحة', format: 'count' },
      { key: 'leaveDays',     expr: `COUNT(*) FILTER (WHERE presence='leave')`,                    label_en: 'Leave days',     label_ar: 'أيام الإجازة',format: 'count' },
      { key: 'sickDays',      expr: `COUNT(*) FILTER (WHERE presence='sick')`,                     label_en: 'Sick days',      label_ar: 'أيام المرض',  format: 'count' },
      { key: 'absentDays',    expr: `COUNT(*) FILTER (WHERE presence='absent')`,                   label_en: 'Absent days',    label_ar: 'أيام الغياب', format: 'count' },
      { key: 'lateDays',      expr: `COUNT(*) FILTER (WHERE ${CRED_LATE})`,                        label_en: 'Late days',      label_ar: 'أيام التأخير',format: 'count' },
      { key: 'earlyDays',     expr: `COUNT(*) FILTER (WHERE ${CRED_EARLY})`,                       label_en: 'Early days',     label_ar: 'أيام مبكرة',  format: 'count' },
      { key: 'permissionDays',expr: 'COUNT(*) FILTER (WHERE permission_type IS NOT NULL)',         label_en: 'Permissions',    label_ar: 'الاستئذانات', format: 'count' },
      { key: 'conformancePct',expr: 'ROUND(AVG(adherence_pct),1)',                                 label_en: 'Conformance %',  label_ar: 'المطابقة %',  format: 'pct' },
      { key: 'shrinkageDays', expr: `COUNT(*) FILTER (WHERE presence IN ('absent','sick','leave'))`,label_en: 'Shrinkage days', label_ar: 'أيام الفاقد', format: 'count' },
    ],
  },

  // ── SCORECARD / KPI ───────────────────────────────────────────────────────
  {
    key: 'scorecard', label_en: 'Scorecard', label_ar: 'بطاقة الأداء', group: 'Scorecard',
    from: 'scorecard_monthly', tenantCol: 'tenant_id', dateCol: 'make_date(year, month, 1)', personCol: 'employee_no',
    permission: 'reports.view',
    dimensions: [
      { key: 'person',     col: 'employee_no',                      label_en: 'Agent ID',    label_ar: 'رقم الموظف', type: 'string' },
      { key: 'name',       col: 'name',                             label_en: 'Agent',       label_ar: 'الموظف',     type: 'string' },
      { key: 'function',   col: 'function_name',                    label_en: 'Function',    label_ar: 'الوظيفة',    type: 'string' },
      { key: 'teamLeader', col: 'team_manager',                     label_en: 'Team Leader', label_ar: 'المشرف',     type: 'string' },
      { key: 'year',       col: 'year::text',                       label_en: 'Year',        label_ar: 'السنة',      type: 'string' },
      { key: 'month',      col: `to_char(make_date(year,month,1),'YYYY-MM')`, label_en: 'Month', label_ar: 'الشهر',   type: 'string' },
    ],
    metrics: [
      { key: 'avgNetPoints', expr: 'ROUND(AVG(avg_net_points),2)',              label_en: 'Net Points',    label_ar: 'صافي النقاط', format: 'decimal' },
      { key: 'bestNet',      expr: 'ROUND(MAX(best_net),1)',                    label_en: 'Best net',      label_ar: 'أفضل نقاط',   format: 'decimal' },
      { key: 'worstNet',     expr: 'ROUND(MIN(worst_net),1)',                   label_en: 'Worst net',     label_ar: 'أدنى نقاط',   format: 'decimal' },
      { key: 'weeksScored',  expr: 'SUM(weeks_scored)',                         label_en: 'Weeks scored',  label_ar: 'أسابيع مقيّمة',format: 'count' },
      { key: 'agents',       expr: 'COUNT(DISTINCT employee_no)',               label_en: 'Agents',        label_ar: 'الموظفون',    format: 'count' },
    ],
  },

  // ── PERMISSION / استئذان (request_permissions joined to requests for tenant) ─
  {
    key: 'permission', label_en: 'Permissions', label_ar: 'الاستئذانات', group: 'Requests',
    from: 'request_permissions rp JOIN requests r ON r.id = rp.request_id',
    tenantCol: 'r.tenant_id', dateCol: 'rp.permission_date',
    permission: 'attendance.view_team',
    dimensions: [
      { key: 'permissionType', col: 'rp.permission_type::text', label_en: 'Permission Type', label_ar: 'نوع الاستئذان', type: 'string' },
      { key: 'status',         col: 'r.status::text',           label_en: 'Status',          label_ar: 'الحالة',        type: 'string' },
      { key: 'date',           col: 'rp.permission_date::text', label_en: 'Date',            label_ar: 'التاريخ',       type: 'date' },
    ],
    metrics: [
      { key: 'permissionCount', expr: 'COUNT(*)',                                  label_en: 'Permissions',   label_ar: 'الاستئذانات', format: 'count' },
      { key: 'totalMinutes',    expr: 'SUM(COALESCE(rp.duration_minutes,0))',      label_en: 'Total (min)',   label_ar: 'الإجمالي (دقيقة)', format: 'minutes' },
      { key: 'totalHours',      expr: 'ROUND(SUM(COALESCE(rp.duration_minutes,0))/60.0,1)', label_en: 'Total (hrs)', label_ar: 'الإجمالي (ساعة)', format: 'hours' },
      { key: 'avgMinutes',      expr: 'ROUND(AVG(rp.duration_minutes))',           label_en: 'Avg (min)',     label_ar: 'المتوسط (دقيقة)', format: 'int' },
    ],
  },

  // ── BREAKS ────────────────────────────────────────────────────────────────
  {
    key: 'breaks', label_en: 'Breaks', label_ar: 'الاستراحات', group: 'Breaks',
    from: 'break_slots', tenantCol: 'tenant_id', dateCol: 'schedule_date',
    permission: 'attendance.view_team',
    dimensions: [
      { key: 'status',        col: 'status',              label_en: 'Status',        label_ar: 'الحالة',       type: 'string' },
      { key: 'releaseSource', col: 'release_source',      label_en: 'Release Source',label_ar: 'مصدر الإطلاق', type: 'string' },
      { key: 'date',          col: 'schedule_date::text', label_en: 'Date',          label_ar: 'التاريخ',      type: 'date' },
      { key: 'slot',          col: 'slot_number::text',   label_en: 'Slot',          label_ar: 'الفترة',       type: 'string' },
    ],
    metrics: [
      { key: 'breakCount',   expr: 'COUNT(*)',                                    label_en: 'Breaks',        label_ar: 'الاستراحات',  format: 'count' },
      { key: 'lateCount',    expr: 'COUNT(*) FILTER (WHERE late_minutes > 0)',    label_en: 'Late breaks',   label_ar: 'متأخرة',      format: 'count' },
      { key: 'missedCount',  expr: 'COUNT(*) FILTER (WHERE is_missed)',           label_en: 'Missed',        label_ar: 'فائتة',       format: 'count' },
      { key: 'totalLateMin', expr: 'SUM(COALESCE(late_minutes,0))',              label_en: 'Late (min)',    label_ar: 'التأخير (دقيقة)', format: 'minutes' },
      { key: 'avgDelayMin',  expr: 'ROUND(AVG(delay_min))',                       label_en: 'Avg delay',     label_ar: 'متوسط التأخير',format: 'int' },
    ],
  },

  // ── COVERAGE / HC ─────────────────────────────────────────────────────────
  {
    key: 'coverage', label_en: 'Coverage / HC', label_ar: 'التغطية', group: 'Coverage',
    from: 'headcount_intervals', tenantCol: 'tenant_id', dateCol: 'snapshot_date',
    permission: 'attendance.view_team',
    dimensions: [
      { key: 'date', col: 'snapshot_date::text', label_en: 'Date', label_ar: 'التاريخ', type: 'date' },
      { key: 'hour', col: `to_char(interval_start,'HH24:00')`, label_en: 'Hour', label_ar: 'الساعة', type: 'string' },
    ],
    metrics: [
      { key: 'requiredHc',  expr: 'SUM(COALESCE(required_hc,0))',      label_en: 'Required HC',  label_ar: 'المطلوب',   format: 'int' },
      { key: 'scheduledHc', expr: 'SUM(COALESCE(scheduled_hc,0))',     label_en: 'Scheduled HC', label_ar: 'المجدول',   format: 'int' },
      { key: 'actualHc',    expr: 'SUM(COALESCE(actual_hc,0))',        label_en: 'Actual HC',    label_ar: 'الفعلي',    format: 'int' },
      { key: 'availableHc', expr: 'SUM(COALESCE(available_hc,0))',     label_en: 'Available HC', label_ar: 'المتاح',    format: 'int' },
      { key: 'gapHc',       expr: 'SUM(COALESCE(gap_hc,0))',           label_en: 'Gap HC',       label_ar: 'العجز',     format: 'int' },
      { key: 'onPermission',expr: 'SUM(COALESCE(on_permission_hc,0))', label_en: 'On permission',label_ar: 'باستئذان',  format: 'int' },
    ],
  },
];

export const SOURCE_BY_KEY: Record<string, DataSourceDef> =
  Object.fromEntries(DATA_SOURCES.map(s => [s.key, s]));

// Suppress unused-import lint when MATERNITY_7H is only referenced transitively via CRED_EARLY.
void MATERNITY_7H;
