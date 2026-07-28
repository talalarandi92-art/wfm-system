/**
 * BUILDER v2 — DECLARATIVE DATA-SOURCE CATALOG (BLD-1, expanded BLD-2.6).
 *
 * ONE builder, MANY domains. Every domain below is a selectable Data Source that
 * exposes its dimensions (group-by) and metrics (measures) to the visual builder.
 * This file is STATIC config — the only allowlist the query compiler trusts. A dim
 * or metric that is NOT listed here for a source can NEVER reach the SQL (no raw
 * columns from the client → no injection surface).
 *
 * BLD-2.6 (Sprinklr-parity field picker): every source now carries a `category`
 * (sidebar grouping) + bilingual `description`, and every FIELD carries a
 * `category` (group inside the source), a `badge` (dimension / custom_dimension /
 * metric / calculated_metric) and a ONE-sentence bilingual description — exactly
 * what the picker UI renders. New sources: adherence_conformance, agent_ops,
 * scorecard_kpi, survey, requests_sla, shrinkage_leave, contacts_volume.
 *
 * Canonical metric definitions are REUSED from @common/wfm-metrics so a builder
 * number equals the dedicated report's number (TRUE_OT, credible late/early, etc.).
 * Columns were verified against information_schema on the live wfm_db (2026-07-11).
 */
import { TRUE_OT, CRED_LATE, CRED_EARLY, MATERNITY_7H,
         SC_MONTH_NET, SC_WEEKS_BEST, SC_WEEKS_WORST, SC_WEEKS_COUNT } from '@common/wfm-metrics';

export type ColType = 'string' | 'number' | 'time' | 'date' | 'bool';
export type MetricFormat = 'int' | 'minutes' | 'hours' | 'pct' | 'decimal' | 'count';
export type FieldBadge = 'dimension' | 'custom_dimension' | 'metric' | 'calculated_metric';

export interface Dimension {
  key: string;
  col: string;          // SQL expression (trusted, from this file only)
  label_en: string;
  label_ar: string;
  type: ColType;
  time?: boolean;       // render minutes-since-midnight as HH:MM
  category?: string;    // picker group inside the source (Identity / Time / …)
  description_en?: string;
  description_ar?: string;
  badge?: FieldBadge;   // default: dimension (custom_dimension when col is an expression)
}

export interface Metric {
  key: string;
  expr: string;         // FULL aggregate expression producing the measure value
  label_en: string;
  label_ar: string;
  format: MetricFormat;
  category?: string;    // picker group inside the source (Performance / Tardiness / …)
  description_en?: string;
  description_ar?: string;
  badge?: FieldBadge;   // default: metric (set calculated_metric for derived formulas)
}

export interface DataSourceDef {
  key: string;
  label_en: string;
  label_ar: string;
  group: string;                 // UI grouping (Attendance / Overtime / Scorecard …)
  category?: string;             // picker sidebar category (defaults to group)
  description_en?: string;       // one sentence: what this source reports on
  description_ar?: string;
  from: string;                  // FROM clause (may include a FIXED join)
  /** An invariant of the source itself, ANDed into every query and every drill —
   *  not a user filter and not overridable. Used for roster_days' canonical-dedup
   *  `is_active` (BR-ATT-008): without it a builder report double-counts anyone who
   *  has a folded second employee number. */
  baseWhere?: string;
  tenantCol: string;             // tenant scoping column
  dateCol: string;               // date column the dashboard date-range filters on
  dateGrain?: 'day' | 'month';   // 'month' → dateCol is a month BUCKET (first-of-month); the range
                                 // filter uses month-OVERLAP semantics so a partial-month range
                                 // includes the whole overlapping month instead of dropping it. Default 'day'.
  personCol?: string;            // if set, agents are auto-scoped to their own value here
  permission: string;            // RBAC code required to read this source
  dimensions: Dimension[];
  metrics: Metric[];
}

/** A dimension whose col is a derived SQL expression gets the custom badge. */
export function dimensionBadge(d: Dimension): FieldBadge {
  return d.badge ?? (d.col.includes('(') ? 'custom_dimension' : 'dimension');
}
export function metricBadge(m: Metric): FieldBadge {
  return m.badge ?? 'metric';
}
/** Map internal format/type to the picker contract's format token. */
export function contractFormat(m: Metric): 'hours' | 'minutes' | 'percent' | 'number' {
  switch (m.format) {
    case 'hours': return 'hours';
    case 'minutes': return 'minutes';
    case 'pct': return 'percent';
    default: return 'number';
  }
}
export function contractType(t: ColType): 'string' | 'number' | 'date' {
  if (t === 'number') return 'number';
  if (t === 'date') return 'date';
  return 'string';
}

// ── shared roster_days dimensions (the canonical daily fact) ────────────────
const RD_DIMS: Dimension[] = [
  { key: 'person',       col: 'COALESCE(person_no,employee_no)',        label_en: 'Agent ID',    label_ar: 'رقم الموظف', type: 'string', category: 'Identity',
    description_en: 'The canonical employee number identifying one person across ID changes.', description_ar: 'الرقم الوظيفي الموحّد الذي يعرّف الشخص حتى مع تغيّر الأرقام.' },
  { key: 'name',         col: 'COALESCE(clean_name,name)',              label_en: 'Agent',       label_ar: 'الموظف',     type: 'string', category: 'Identity',
    description_en: 'The employee’s clean display name from the identity layer.', description_ar: 'اسم الموظف المعتمد من طبقة الهوية.' },
  { key: 'function',     col: 'canon_fn(COALESCE(role_function,function_name))', label_en: 'Function', label_ar: 'الوظيفة', type: 'string', category: 'Organization',
    description_en: 'The canonical business function (interns folded into their parent function).', description_ar: 'الوظيفة المعتمدة (المتدرّبون مدمجون ضمن وظيفتهم الأساسية).' },
  { key: 'role',         col: 'role_category',                          label_en: 'Role',        label_ar: 'الدور',      type: 'string', category: 'Organization',
    description_en: 'Role category such as agent, responsible or intern.', description_ar: 'فئة الدور مثل موظف أو مسؤول أو متدرّب.' },
  { key: 'teamLeader',   col: 'team_manager',                           label_en: 'Team Leader', label_ar: 'المشرف',     type: 'string', category: 'Organization',
    description_en: 'The team leader / manager the employee reports to.', description_ar: 'قائد الفريق أو المدير المباشر للموظف.' },
  { key: 'team',         col: 'team_group',                             label_en: 'Team',        label_ar: 'الفريق',     type: 'string', category: 'Organization',
    description_en: 'The team group the employee belongs to.', description_ar: 'الفريق الذي ينتمي إليه الموظف.' },
  { key: 'gender',       col: 'gender',                                 label_en: 'Gender',      label_ar: 'الجنس',      type: 'string', category: 'Identity',
    description_en: 'Employee gender, used by female-shift business rules.', description_ar: 'جنس الموظف، تستخدمه قواعد ورديات الإناث.' },
  { key: 'shift',        col: 'shift_code',                             label_en: 'Shift',       label_ar: 'الوردية',    type: 'string', category: 'Schedule',
    description_en: 'The scheduled shift code from the official Timing dictionary.', description_ar: 'رمز الوردية المجدولة من قاموس المواعيد الرسمي.' },
  { key: 'presence',     col: 'presence',                               label_en: 'Presence',    label_ar: 'الحضور',     type: 'string', category: 'Schedule',
    description_en: 'The reconciled day outcome: office, wfh, off, leave, sick or absent.', description_ar: 'نتيجة اليوم بعد المطابقة: مكتب، منزل، راحة، إجازة، مرض أو غياب.' },
  { key: 'date',         col: 'work_date::text',                        label_en: 'Date',        label_ar: 'التاريخ',    type: 'date', category: 'Time',
    description_en: 'The calendar work date of the roster row.', description_ar: 'تاريخ يوم العمل في الجدول.' },
  { key: 'day',          col: 'day_name',                               label_en: 'Day',         label_ar: 'اليوم',      type: 'string', category: 'Time',
    description_en: 'The weekday name of the work date.', description_ar: 'اسم اليوم في الأسبوع لتاريخ العمل.' },
  { key: 'month',        col: 'month_name',                             label_en: 'Month',       label_ar: 'الشهر',      type: 'string', category: 'Time',
    description_en: 'The month name the work date falls in.', description_ar: 'اسم الشهر الذي يقع فيه تاريخ العمل.' },
];

export const DATA_SOURCES: DataSourceDef[] = [
  // ── OVERTIME ──────────────────────────────────────────────────────────────
  {
    key: 'overtime', label_en: 'Overtime', label_ar: 'العمل الإضافي', group: 'Overtime', category: 'Workforce',
    description_en: 'PAYABLE overtime per agent from the canonical roster, split into regular, off-day and holiday buckets. Excludes supervisory record-only OT, which is recorded but never paid — the OT & Exceptions report states that bucket separately.',
    description_ar: 'الإضافي المستحق للدفع لكل موظف من الجدول المعتمد، مقسّماً إلى عادي وإجازة وعطلة. لا يشمل الإضافي المسجّل للإشرافيين (مسجّل ولا يُدفع) — تقرير الإضافي والاستثناءات يعرضه لوحده.',
    /* PAYABLE, exactly like the OT report and the executive tile — `is_active`
       drops non-canonical duplicate identities (BR-ATT-008) and `ot_record_only`
       drops supervisory OT that is recorded but never paid (BR-ROL-002). Without
       the second filter this source answered 16,440.20h where every other OT
       surface answered 16,388.38h. Scoped to THIS source: supervisors' attendance
       is tracked normally, so the attendance/login sources must not inherit it. */
    from: 'roster_days', baseWhere: 'is_active AND NOT COALESCE(ot_record_only,false)',
    tenantCol: 'tenant_id', dateCol: 'work_date', personCol: 'COALESCE(person_no,employee_no)',
    permission: 'attendance.view_team',
    dimensions: RD_DIMS,
    metrics: [
      { key: 'trueOtMin',   expr: `SUM(${TRUE_OT})`,                                     label_en: 'True OT (min)',    label_ar: 'الإضافي (دقيقة)', format: 'minutes', category: 'Overtime', badge: 'calculated_metric',
        description_en: 'Total true overtime in minutes: regular + off-day + holiday OT combined (the canonical TRUE_OT).', description_ar: 'إجمالي الإضافي الحقيقي بالدقائق: مجموع الإضافي العادي وإضافي الإجازة وإضافي العطلة.' },
      { key: 'trueOtHrs',   expr: `ROUND(SUM(${TRUE_OT})/60.0,1)`,                        label_en: 'True OT (hrs)',    label_ar: 'الإضافي (ساعة)',  format: 'hours', category: 'Overtime', badge: 'calculated_metric',
        description_en: 'Total true overtime converted to hours (all three OT buckets).', description_ar: 'إجمالي الإضافي الحقيقي محوّلاً إلى ساعات (الأنواع الثلاثة).' },
      { key: 'regularOtMin',expr: 'SUM(COALESCE(ot_min,0))',                              label_en: 'Regular OT (min)', label_ar: 'إضافي عادي',      format: 'minutes', category: 'Overtime',
        description_en: 'Overtime minutes worked on a regular scheduled working day.', description_ar: 'دقائق الإضافي في يوم عمل مجدول عادي.' },
      { key: 'offdayOtMin', expr: 'SUM(COALESCE(offday_ot_min,0))',                       label_en: 'Off-day OT (min)', label_ar: 'إضافي إجازة',     format: 'minutes', category: 'Overtime',
        description_en: 'Overtime minutes worked on an OFF or leave day.', description_ar: 'دقائق الإضافي في يوم راحة أو إجازة.' },
      { key: 'holidayOtMin',expr: 'SUM(COALESCE(holiday_ot_min,0))',                      label_en: 'Holiday OT (min)', label_ar: 'إضافي عطلة',      format: 'minutes', category: 'Overtime',
        description_en: 'Overtime minutes worked on an official public holiday.', description_ar: 'دقائق الإضافي في عطلة رسمية.' },
      { key: 'offWorkedMin',expr: 'SUM(COALESCE(off_worked_min,0))',                      label_en: 'Off worked (min)', label_ar: 'عمل بالإجازة',    format: 'minutes', category: 'Overtime',
        description_en: 'Minutes actually worked while the schedule said OFF (pre-review).', description_ar: 'الدقائق المعمولة فعلياً بينما الجدول يقول راحة (قبل المراجعة).' },
      { key: 'otBeforeMin', expr: 'SUM(COALESCE(ot_before_min,0))',                       label_en: 'OT before shift',  label_ar: 'إضافي قبل',       format: 'minutes', category: 'Overtime',
        description_en: 'Overtime minutes worked before the scheduled shift start.', description_ar: 'دقائق الإضافي قبل بداية الوردية المجدولة.' },
      { key: 'otAfterMin',  expr: 'SUM(COALESCE(ot_after_min,0))',                        label_en: 'OT after shift',   label_ar: 'إضافي بعد',       format: 'minutes', category: 'Overtime',
        description_en: 'Overtime minutes worked after the scheduled shift end.', description_ar: 'دقائق الإضافي بعد نهاية الوردية المجدولة.' },
      { key: 'otDays',      expr: `COUNT(*) FILTER (WHERE (${TRUE_OT}) > 0)`,             label_en: 'OT days',          label_ar: 'أيام الإضافي',    format: 'count', category: 'Overtime', badge: 'calculated_metric',
        description_en: 'Number of days with any true overtime recorded.', description_ar: 'عدد الأيام التي سُجّل فيها أي إضافي حقيقي.' },
      { key: 'agents',      expr: 'COUNT(DISTINCT COALESCE(person_no,employee_no))',      label_en: 'Agents',           label_ar: 'الموظفون',        format: 'count', category: 'Headcount',
        description_en: 'Distinct number of people in the selected rows.', description_ar: 'عدد الأشخاص المختلفين في الصفوف المحددة.' },
    ],
  },

  // ── LOGIN / LOGOUT ────────────────────────────────────────────────────────
  {
    key: 'login_logout', label_en: 'Login / Logout', label_ar: 'الدخول والخروج', group: 'Attendance', category: 'Workforce',
    description_en: 'System login and logout behaviour per agent: worked time, average login/logout and credible late/early minutes.',
    description_ar: 'سلوك دخول وخروج النظام لكل موظف: وقت العمل ومتوسط الدخول/الخروج ودقائق التأخير/الخروج المبكر الموثوقة.',
    from: 'roster_days', baseWhere: 'is_active', tenantCol: 'tenant_id', dateCol: 'work_date', personCol: 'COALESCE(person_no,employee_no)',
    permission: 'attendance.view_team',
    dimensions: [...RD_DIMS, { key: 'loginSrc', col: 'login_src', label_en: 'Login Source', label_ar: 'مصدر الدخول', type: 'string', category: 'Data Quality',
      description_en: 'Which system supplied the login time (e.g. Sprinklr or punch).', description_ar: 'النظام الذي زوّد وقت الدخول (مثل سبرنكلر أو البصمة).' }],
    metrics: [
      { key: 'workedMin',    expr: 'SUM(COALESCE(worked_min,0))',                         label_en: 'Worked (min)',    label_ar: 'العمل (دقيقة)', format: 'minutes', category: 'Working Time',
        description_en: 'Total reconciled worked minutes.', description_ar: 'إجمالي دقائق العمل بعد المطابقة.' },
      { key: 'workedHrs',    expr: 'ROUND(SUM(COALESCE(worked_min,0))/60.0,1)',           label_en: 'Worked (hrs)',    label_ar: 'العمل (ساعة)',  format: 'hours', category: 'Working Time', badge: 'calculated_metric',
        description_en: 'Total reconciled worked time converted to hours.', description_ar: 'إجمالي وقت العمل محوّلاً إلى ساعات.' },
      { key: 'avgLoginMin',  expr: 'ROUND(AVG(sys_login_min))',                           label_en: 'Avg login',       label_ar: 'متوسط الدخول',  format: 'int', category: 'Working Time', badge: 'calculated_metric',
        description_en: 'Average system login time expressed in minutes since midnight.', description_ar: 'متوسط وقت دخول النظام بالدقائق منذ منتصف الليل.' },
      { key: 'avgLogoutMin', expr: 'ROUND(AVG(sys_logout_min))',                          label_en: 'Avg logout',      label_ar: 'متوسط الخروج',  format: 'int', category: 'Working Time', badge: 'calculated_metric',
        description_en: 'Average system logout time expressed in minutes since midnight.', description_ar: 'متوسط وقت خروج النظام بالدقائق منذ منتصف الليل.' },
      { key: 'credLateMin',  expr: `SUM(sys_late_min) FILTER (WHERE ${CRED_LATE})`,       label_en: 'Late (min)',      label_ar: 'التأخير (دقيقة)', format: 'minutes', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Credible late-in minutes (7–240 min; night-shift artifacts excluded).', description_ar: 'دقائق التأخير الموثوقة (7–240 دقيقة مع استبعاد أخطاء ورديات الليل).' },
      { key: 'credLateDays', expr: `COUNT(*) FILTER (WHERE ${CRED_LATE})`,                label_en: 'Late days',       label_ar: 'أيام التأخير',  format: 'count', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Number of days with a credible late-in.', description_ar: 'عدد الأيام التي حدث فيها تأخير موثوق.' },
      { key: 'credEarlyMin', expr: `SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY})`,     label_en: 'Early out (min)', label_ar: 'الخروج المبكر', format: 'minutes', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Credible early-out minutes (maternity 7-hour mothers excluded).', description_ar: 'دقائق الخروج المبكر الموثوقة (مع استبعاد أمهات نظام السبع ساعات).' },
      { key: 'credEarlyDays',expr: `COUNT(*) FILTER (WHERE ${CRED_EARLY})`,               label_en: 'Early-out days',  label_ar: 'أيام الخروج',   format: 'count', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Number of days with a credible early-out.', description_ar: 'عدد الأيام التي حدث فيها خروج مبكر موثوق.' },
      { key: 'haveLogin',    expr: 'COUNT(*) FILTER (WHERE sys_login_min IS NOT NULL)',   label_en: 'Days w/ login',   label_ar: 'أيام لها دخول', format: 'count', category: 'Data Quality', badge: 'calculated_metric',
        description_en: 'Days where a system login time was captured.', description_ar: 'الأيام التي التُقط فيها وقت دخول النظام.' },
      { key: 'missingSystem',expr: 'COUNT(*) FILTER (WHERE missing_system)',              label_en: 'Missing system',  label_ar: 'دخول ناقص',     format: 'count', category: 'Data Quality', badge: 'calculated_metric',
        description_en: 'Worked days with no system login recorded at all.', description_ar: 'أيام عمل بدون أي تسجيل دخول في النظام.' },
    ],
  },

  // ── ATTENDANCE / TARDINESS ────────────────────────────────────────────────
  {
    key: 'attendance', label_en: 'Attendance', label_ar: 'الحضور والانصراف', group: 'Attendance', category: 'Workforce',
    description_en: 'Day-type attendance counts per agent: worked, office, WFH, off, leave, sick, absent, late and permissions.',
    description_ar: 'عدّادات الحضور اليومية لكل موظف: عمل، مكتب، منزل، راحة، إجازة، مرض، غياب، تأخير واستئذانات.',
    from: 'roster_days', baseWhere: 'is_active', tenantCol: 'tenant_id', dateCol: 'work_date', personCol: 'COALESCE(person_no,employee_no)',
    permission: 'attendance.view_team',
    dimensions: [...RD_DIMS, { key: 'hrCode', col: 'hr_code', label_en: 'HR Code', label_ar: 'رمز HR', type: 'string', category: 'Schedule',
      description_en: 'The HR attendance code assigned to the day by the reconciliation matrix.', description_ar: 'رمز الحضور الذي عيّنته مصفوفة المطابقة لليوم.' }],
    metrics: [
      { key: 'scheduledDays', expr: 'COUNT(*)',                                                    label_en: 'Scheduled days', label_ar: 'أيام مجدولة', format: 'count', category: 'Days',
        description_en: 'Total roster days in the selection, of every presence type.', description_ar: 'إجمالي أيام الجدول في النطاق المحدد بجميع أنواعها.' },
      { key: 'workedDays',    expr: `COUNT(*) FILTER (WHERE presence IN ('office','wfh'))`,        label_en: 'Worked days',    label_ar: 'أيام العمل',  format: 'count', category: 'Days', badge: 'calculated_metric',
        description_en: 'Days actually worked, in the office or from home.', description_ar: 'الأيام المعمولة فعلياً من المكتب أو المنزل.' },
      { key: 'officeDays',    expr: `COUNT(*) FILTER (WHERE presence='office')`,                   label_en: 'Office days',    label_ar: 'أيام المكتب', format: 'count', category: 'Days', badge: 'calculated_metric',
        description_en: 'Days worked physically from the office.', description_ar: 'أيام العمل حضورياً من المكتب.' },
      { key: 'wfhDays',       expr: `COUNT(*) FILTER (WHERE presence='wfh')`,                      label_en: 'WFH days',       label_ar: 'أيام المنزل', format: 'count', category: 'Days', badge: 'calculated_metric',
        description_en: 'Days worked remotely from home.', description_ar: 'أيام العمل عن بُعد من المنزل.' },
      { key: 'offDays',       expr: `COUNT(*) FILTER (WHERE presence='off')`,                      label_en: 'OFF days',       label_ar: 'أيام الراحة', format: 'count', category: 'Days', badge: 'calculated_metric',
        description_en: 'Weekly rest (OFF) days in the selection.', description_ar: 'أيام الراحة الأسبوعية في النطاق.' },
      { key: 'leaveDays',     expr: `COUNT(*) FILTER (WHERE presence='leave')`,                    label_en: 'Leave days',     label_ar: 'أيام الإجازة',format: 'count', category: 'Days', badge: 'calculated_metric',
        description_en: 'Approved leave days (annual and other leave types).', description_ar: 'أيام الإجازات المعتمدة (سنوية وغيرها).' },
      { key: 'sickDays',      expr: `COUNT(*) FILTER (WHERE presence='sick')`,                     label_en: 'Sick days',      label_ar: 'أيام المرض',  format: 'count', category: 'Days', badge: 'calculated_metric',
        description_en: 'Sick leave days.', description_ar: 'أيام الإجازة المرضية.' },
      { key: 'absentDays',    expr: `COUNT(*) FILTER (WHERE presence='absent')`,                   label_en: 'Absent days',    label_ar: 'أيام الغياب', format: 'count', category: 'Days', badge: 'calculated_metric',
        description_en: 'Unplanned absence days with no approved cover.', description_ar: 'أيام الغياب غير المخطط بدون تغطية معتمدة.' },
      { key: 'lateDays',      expr: `COUNT(*) FILTER (WHERE ${CRED_LATE})`,                        label_en: 'Late days',      label_ar: 'أيام التأخير',format: 'count', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Days with a credible late-in (7–240 minutes).', description_ar: 'الأيام التي حدث فيها تأخير موثوق (7–240 دقيقة).' },
      { key: 'earlyDays',     expr: `COUNT(*) FILTER (WHERE ${CRED_EARLY})`,                       label_en: 'Early days',     label_ar: 'أيام مبكرة',  format: 'count', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Days with a credible early-out.', description_ar: 'الأيام التي حدث فيها خروج مبكر موثوق.' },
      { key: 'permissionDays',expr: 'COUNT(*) FILTER (WHERE permission_type IS NOT NULL)',         label_en: 'Permissions',    label_ar: 'الاستئذانات', format: 'count', category: 'Requests', badge: 'calculated_metric',
        description_en: 'Days that carry an approved permission of any type.', description_ar: 'الأيام التي تحمل استئذاناً معتمداً من أي نوع.' },
      { key: 'conformancePct',expr: 'ROUND(AVG(adherence_pct),1)',                                 label_en: 'Conformance %',  label_ar: 'المطابقة %',  format: 'pct', category: 'Performance', badge: 'calculated_metric',
        description_en: 'Average daily conformance score between schedule and actual (dashboard definition).', description_ar: 'متوسط درجة المطابقة اليومية بين الجدول والفعلي (تعريف لوحة القيادة).' },
      { key: 'shrinkageDays', expr: `COUNT(*) FILTER (WHERE presence IN ('absent','sick','leave'))`,label_en: 'Shrinkage days', label_ar: 'أيام الفاقد', format: 'count', category: 'Shrinkage', badge: 'calculated_metric',
        description_en: 'Days lost to absence, sickness or leave (unplanned + planned shrinkage).', description_ar: 'الأيام المفقودة بسبب الغياب أو المرض أو الإجازة (فاقد مخطط وغير مخطط).' },
    ],
  },

  // ── ADHERENCE / CONFORMANCE ───────────────────────────────────────────────
  {
    key: 'adherence_conformance', label_en: 'Adherence & Conformance', label_ar: 'الالتزام والمطابقة', group: 'Attendance', category: 'Workforce',
    description_en: 'Schedule adherence and conformance per agent: average adherence, conforming-day rate, credible tardiness bands and missing-log counts.',
    description_ar: 'التزام ومطابقة الجدول لكل موظف: متوسط الالتزام ونسبة الأيام المطابقة وفئات التأخير الموثوقة وعدّادات السجلات الناقصة.',
    from: 'roster_days', baseWhere: 'is_active', tenantCol: 'tenant_id', dateCol: 'work_date', personCol: 'COALESCE(person_no,employee_no)',
    permission: 'attendance.view_team',
    dimensions: RD_DIMS,
    metrics: [
      { key: 'avgAdherencePct', expr: 'ROUND(AVG(adherence_pct),1)',                     label_en: 'Adherence %',     label_ar: 'الالتزام %',   format: 'pct', category: 'Performance', badge: 'calculated_metric',
        description_en: 'Average daily adherence between scheduled and actual times — the same formula the roster dashboard shows as Conformance %.', description_ar: 'متوسط الالتزام اليومي بين الأوقات المجدولة والفعلية — نفس معادلة لوحة الجدول.' },
      { key: 'conformancePct',  expr: 'ROUND(100.0*COUNT(*) FILTER (WHERE conforming)/NULLIF(COUNT(*) FILTER (WHERE conforming IS NOT NULL),0),1)', label_en: 'Conforming days %', label_ar: 'نسبة الأيام المطابقة', format: 'pct', category: 'Performance', badge: 'calculated_metric',
        description_en: 'Share of evaluated days flagged as conforming (conforming days ÷ evaluated days).', description_ar: 'نسبة الأيام المصنّفة مطابقة من الأيام المقيَّمة (أيام مطابقة ÷ أيام مقيَّمة).' },
      { key: 'conformingDays',  expr: 'COUNT(*) FILTER (WHERE conforming)',              label_en: 'Conforming days', label_ar: 'أيام مطابقة',  format: 'count', category: 'Performance', badge: 'calculated_metric',
        description_en: 'Days where actual attendance conformed to the schedule.', description_ar: 'الأيام التي طابق فيها الحضور الفعلي الجدول.' },
      { key: 'credLateMin',     expr: `SUM(sys_late_min) FILTER (WHERE ${CRED_LATE})`,   label_en: 'Late (min)',      label_ar: 'التأخير (دقيقة)', format: 'minutes', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Credible late-in minutes (7–240 min window).', description_ar: 'دقائق التأخير الموثوقة (نافذة 7–240 دقيقة).' },
      { key: 'credLateDays',    expr: `COUNT(*) FILTER (WHERE ${CRED_LATE})`,            label_en: 'Late days',       label_ar: 'أيام التأخير', format: 'count', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Number of days with a credible late-in.', description_ar: 'عدد الأيام التي حدث فيها تأخير موثوق.' },
      { key: 'credEarlyMin',    expr: `SUM(sys_early_min) FILTER (WHERE ${CRED_EARLY})`, label_en: 'Early out (min)', label_ar: 'الخروج المبكر (دقيقة)', format: 'minutes', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Credible early-out minutes (maternity 7-hour mothers excluded).', description_ar: 'دقائق الخروج المبكر الموثوقة (مع استبعاد أمهات السبع ساعات).' },
      { key: 'credEarlyDays',   expr: `COUNT(*) FILTER (WHERE ${CRED_EARLY})`,           label_en: 'Early-out days',  label_ar: 'أيام الخروج المبكر', format: 'count', category: 'Tardiness', badge: 'calculated_metric',
        description_en: 'Number of days with a credible early-out.', description_ar: 'عدد الأيام التي حدث فيها خروج مبكر موثوق.' },
      { key: 'late7to15',       expr: 'COUNT(*) FILTER (WHERE sys_late_min BETWEEN 7 AND 15)',   label_en: 'Late 7-15 min',  label_ar: 'تأخير 7-15 د',  format: 'count', category: 'Tardiness Bands', badge: 'calculated_metric',
        description_en: 'Days late by 7 to 15 minutes.', description_ar: 'الأيام المتأخرة من 7 إلى 15 دقيقة.' },
      { key: 'late16to30',      expr: 'COUNT(*) FILTER (WHERE sys_late_min BETWEEN 16 AND 30)',  label_en: 'Late 16-30 min', label_ar: 'تأخير 16-30 د', format: 'count', category: 'Tardiness Bands', badge: 'calculated_metric',
        description_en: 'Days late by 16 to 30 minutes.', description_ar: 'الأيام المتأخرة من 16 إلى 30 دقيقة.' },
      { key: 'late31to60',      expr: 'COUNT(*) FILTER (WHERE sys_late_min BETWEEN 31 AND 60)',  label_en: 'Late 31-60 min', label_ar: 'تأخير 31-60 د', format: 'count', category: 'Tardiness Bands', badge: 'calculated_metric',
        description_en: 'Days late by 31 to 60 minutes.', description_ar: 'الأيام المتأخرة من 31 إلى 60 دقيقة.' },
      { key: 'late60plus',      expr: 'COUNT(*) FILTER (WHERE sys_late_min BETWEEN 61 AND 240)', label_en: 'Late 60+ min',   label_ar: 'تأخير +60 د',   format: 'count', category: 'Tardiness Bands', badge: 'calculated_metric',
        description_en: 'Days late by more than an hour (credible window, night-shift artifacts excluded).', description_ar: 'الأيام المتأخرة أكثر من ساعة (ضمن النافذة الموثوقة مع استبعاد أخطاء ورديات الليل).' },
      { key: 'missingPunchDays',expr: 'COUNT(*) FILTER (WHERE missing_punch)',           label_en: 'Missing punch',   label_ar: 'بصمة ناقصة',   format: 'count', category: 'Data Quality', badge: 'calculated_metric',
        description_en: 'Worked days with no punch record captured.', description_ar: 'أيام عمل بدون سجل بصمة.' },
      { key: 'missingSystemDays',expr: 'COUNT(*) FILTER (WHERE missing_system)',         label_en: 'Missing system',  label_ar: 'دخول نظام ناقص',format: 'count', category: 'Data Quality', badge: 'calculated_metric',
        description_en: 'Worked days with no system login captured.', description_ar: 'أيام عمل بدون تسجيل دخول في النظام.' },
    ],
  },

  // ── AGENT OPS (Sprinklr daily productivity) ───────────────────────────────
  {
    key: 'agent_ops', label_en: 'Agent Operations (Sprinklr)', label_ar: 'عمليات الموظف (سبرنكلر)', group: 'Operations', category: 'Operations',
    description_en: 'Daily Sprinklr productivity per agent: contacts handled, AHT, first-response time, busy/idle/break minutes and occupancy.',
    description_ar: 'إنتاجية سبرنكلر اليومية لكل موظف: جهات الاتصال المعالجة ومتوسط وقت المعالجة وزمن أول رد ودقائق الانشغال/الخمول/الاستراحة والإشغال.',
    from: 'agent_daily_stats a', tenantCol: 'a.tenant_id', dateCol: 'a.stat_date',
    personCol: '(SELECT m.person_no FROM employee_identity_map m WHERE m.tenant_id=a.tenant_id AND (lower(m.email)=lower(a.agent_email) OR lower(m.sprinklr_email)=lower(a.agent_email)) LIMIT 1)',
    permission: 'reports.view',
    dimensions: [
      { key: 'agentEmail', col: 'a.agent_email', label_en: 'Agent Email', label_ar: 'بريد الموظف', type: 'string', category: 'Identity',
        description_en: 'The Sprinklr agent email — the native identity of this dataset.', description_ar: 'بريد الموظف في سبرنكلر — الهوية الأصلية لهذه البيانات.' },
      { key: 'agentName',  col: 'a.agent_name',  label_en: 'Agent',       label_ar: 'الموظف',      type: 'string', category: 'Identity',
        description_en: 'The agent display name as reported by Sprinklr.', description_ar: 'اسم الموظف كما يظهر في سبرنكلر.' },
      { key: 'person',     col: '(SELECT m.person_no FROM employee_identity_map m WHERE m.tenant_id=a.tenant_id AND (lower(m.email)=lower(a.agent_email) OR lower(m.sprinklr_email)=lower(a.agent_email)) LIMIT 1)',
        label_en: 'Agent ID', label_ar: 'رقم الموظف', type: 'string', category: 'Identity', badge: 'custom_dimension',
        description_en: 'The canonical employee number resolved from the email via the identity map (blank when unresolved).', description_ar: 'الرقم الوظيفي المعتمد المستنتج من البريد عبر خريطة الهوية (فارغ إن لم يُحل).' },
      { key: 'date',       col: 'a.stat_date::text', label_en: 'Date',    label_ar: 'التاريخ',     type: 'date', category: 'Time',
        description_en: 'The statistics day.', description_ar: 'يوم الإحصائية.' },
    ],
    metrics: [
      { key: 'contacts',      expr: 'SUM(COALESCE(a.contacts_received,0))',    label_en: 'Contacts',        label_ar: 'جهات الاتصال', format: 'count', category: 'Volume',
        description_en: 'Total contacts received by the agent — awaiting Sprinklr capture; this column is currently empty, so a total here is not yet real.', description_ar: 'إجمالي جهات الاتصال المستلمة من الموظف — بانتظار مزامنة سبرنكلر؛ العمود فارغ حالياً، فالإجمالي غير حقيقي بعد.' },
      { key: 'ahtSec',        expr: 'ROUND(AVG(a.aht_seconds))',               label_en: 'AHT (sec)',       label_ar: 'متوسط المعالجة (ث)', format: 'int', category: 'Performance', badge: 'calculated_metric',
        description_en: 'Average handling time in seconds — awaiting Sprinklr capture; this column is currently empty, so any value shown is not yet real.', description_ar: 'متوسط وقت المعالجة بالثواني — بانتظار مزامنة سبرنكلر؛ العمود فارغ حالياً، فأي قيمة تظهر غير حقيقية بعد.' },
      { key: 'frtSec',        expr: 'ROUND(AVG(a.avg_response_seconds))',      label_en: 'First response (sec)', label_ar: 'أول رد (ث)', format: 'int', category: 'Performance', badge: 'calculated_metric',
        description_en: 'Average first-response time in seconds — awaiting Sprinklr capture; this column is currently empty, so any value shown is not yet real.', description_ar: 'متوسط زمن أول رد بالثواني — بانتظار مزامنة سبرنكلر؛ العمود فارغ حالياً، فأي قيمة تظهر غير حقيقية بعد.' },
      { key: 'workingMin',    expr: 'SUM(COALESCE(a.total_working_minutes,0))',label_en: 'Working (min)',   label_ar: 'العمل (دقيقة)', format: 'minutes', category: 'Time in Status',
        description_en: 'Total minutes logged into Sprinklr.', description_ar: 'إجمالي دقائق تسجيل الدخول في سبرنكلر.' },
      { key: 'busyMin',       expr: 'SUM(COALESCE(a.busy_minutes,0))',         label_en: 'Busy (min)',      label_ar: 'مشغول (دقيقة)', format: 'minutes', category: 'Time in Status',
        description_en: 'Minutes spent in busy (handling) status — awaiting Sprinklr capture; this column is near-empty today, so a total is not yet representative.', description_ar: 'الدقائق في حالة مشغول (معالجة) — بانتظار مزامنة سبرنكلر؛ العمود شبه فارغ حالياً، فالإجمالي غير ممثِّل بعد.' },
      { key: 'idleNoCaseMin', expr: 'SUM(COALESCE(a.idle_no_case_minutes,0))', label_en: 'Idle no-case (min)', label_ar: 'خمول بلا حالة', format: 'minutes', category: 'Time in Status',
        description_en: 'Idle minutes with no case assigned.', description_ar: 'دقائق الخمول بدون حالة مسندة.' },
      { key: 'idleWithCaseMin',expr: 'SUM(COALESCE(a.idle_with_case_minutes,0))', label_en: 'Idle with case (min)', label_ar: 'خمول مع حالة', format: 'minutes', category: 'Time in Status',
        description_en: 'Idle minutes while holding an open case.', description_ar: 'دقائق الخمول مع وجود حالة مفتوحة.' },
      { key: 'breakMin',      expr: 'SUM(COALESCE(a.break_minutes,0))',        label_en: 'Break (min)',     label_ar: 'استراحة (دقيقة)', format: 'minutes', category: 'Time in Status',
        description_en: 'Minutes spent in break status.', description_ar: 'الدقائق في حالة الاستراحة.' },
      { key: 'offlineMin',    expr: 'SUM(COALESCE(a.offline_minutes,0))',      label_en: 'Offline (min)',   label_ar: 'غير متصل (دقيقة)', format: 'minutes', category: 'Time in Status',
        description_en: 'Minutes marked offline during the day window.', description_ar: 'الدقائق غير المتصلة خلال نافذة اليوم.' },
      // Occupancy = busy ÷ (busy + idle). Idle time is still awaiting Sprinklr capture, so the
      // denominator can be near-empty; without a guard, a group with busy time but NO idle capture
      // collapses to busy/busy = a misleading precise 100%. The trailing `* CASE …` voids the result
      // (→ NULL, renders "—") whenever idle coverage is effectively zero for the group, so the tile
      // reads "no data" instead of a fake percentage. The numerator SUM(busy) stays the FIRST
      // aggregate so drill base-component extraction still resolves num=busy, den=busy+idle.
      { key: 'occupancyPct',  expr: `ROUND(100.0*SUM(COALESCE(a.busy_minutes,0))/NULLIF(SUM(COALESCE(a.busy_minutes,0)+COALESCE(a.idle_no_case_minutes,0)+COALESCE(a.idle_with_case_minutes,0)),0),1) * CASE WHEN SUM(COALESCE(a.idle_no_case_minutes,0)+COALESCE(a.idle_with_case_minutes,0)) = 0 THEN NULL ELSE 1 END`, label_en: 'Occupancy %', label_ar: 'الإشغال %', format: 'pct', category: 'Performance', badge: 'calculated_metric',
        description_en: 'Busy as a share of busy + idle — awaiting Sprinklr capture; returns empty (not a precise %) when idle coverage is effectively zero, so a near-empty denominator cannot read as a real occupancy.', description_ar: 'الانشغال كنسبة من الانشغال + الخمول — بانتظار مزامنة سبرنكلر؛ يعود فارغاً (لا نسبة دقيقة) عندما تكون تغطية الخمول شبه معدومة، كي لا يظهر مقام شبه فارغ كإشغال حقيقي.' },
      { key: 'agents',        expr: 'COUNT(DISTINCT a.agent_email)',           label_en: 'Agents',          label_ar: 'الموظفون', format: 'count', category: 'Headcount',
        description_en: 'Distinct agents present in the selected rows.', description_ar: 'عدد الموظفين المختلفين في الصفوف المحددة.' },
    ],
  },

  // ── SCORECARD (monthly rollup) ────────────────────────────────────────────
  {
    key: 'scorecard', label_en: 'Scorecard', label_ar: 'بطاقة الأداء', group: 'Scorecard', category: 'Performance',
    description_en: 'Monthly scorecard rollup per agent: average Net Points, best and worst weeks and how many weeks were scored.',
    description_ar: 'ملخص بطاقة الأداء الشهري لكل موظف: متوسط صافي النقاط وأفضل وأسوأ أسبوع وعدد الأسابيع المقيَّمة.',
    from: 'scorecard_monthly', tenantCol: 'tenant_id', dateCol: 'make_date(year, month, 1)', dateGrain: 'month', personCol: 'employee_no',
    permission: 'reports.view',
    dimensions: [
      { key: 'person',     col: 'employee_no',                      label_en: 'Agent ID',    label_ar: 'رقم الموظف', type: 'string', category: 'Identity',
        description_en: 'The employee number the scorecard month belongs to.', description_ar: 'الرقم الوظيفي الذي يعود إليه شهر بطاقة الأداء.' },
      { key: 'name',       col: 'name',                             label_en: 'Agent',       label_ar: 'الموظف',     type: 'string', category: 'Identity',
        description_en: 'The agent name on the scorecard.', description_ar: 'اسم الموظف في بطاقة الأداء.' },
      { key: 'function',   col: 'function_name',                    label_en: 'Function',    label_ar: 'الوظيفة',    type: 'string', category: 'Organization',
        description_en: 'The business function the agent was scored under that month.', description_ar: 'الوظيفة التي قُيّم عليها الموظف في ذلك الشهر.' },
      { key: 'teamLeader', col: 'team_manager',                     label_en: 'Team Leader', label_ar: 'المشرف',     type: 'string', category: 'Organization',
        description_en: 'The team leader on record for the scored month.', description_ar: 'قائد الفريق المسجّل لشهر التقييم.' },
      { key: 'year',       col: 'year::text',                       label_en: 'Year',        label_ar: 'السنة',      type: 'string', category: 'Time',
        description_en: 'The scorecard year.', description_ar: 'سنة بطاقة الأداء.' },
      { key: 'month',      col: `to_char(make_date(year,month,1),'YYYY-MM')`, label_en: 'Month', label_ar: 'الشهر',   type: 'string', category: 'Time', badge: 'custom_dimension',
        description_en: 'The scorecard month in YYYY-MM form.', description_ar: 'شهر بطاقة الأداء بصيغة سنة-شهر.' },
    ],
    metrics: [
      { key: 'avgNetPoints', expr: `ROUND(AVG(${SC_MONTH_NET}),2)`,             label_en: 'Net Points',    label_ar: 'صافي النقاط', format: 'decimal', category: 'Score', badge: 'calculated_metric',
        description_en: 'Average official Net Points score across the selected months.', description_ar: 'متوسط صافي النقاط الرسمي عبر الأشهر المحددة.' },
      { key: 'bestNet',      expr: `ROUND(MAX(${SC_WEEKS_BEST}),1)`,            label_en: 'Best net',      label_ar: 'أفضل نقاط',   format: 'decimal', category: 'Score', badge: 'calculated_metric',
        description_en: 'The best weekly Net Points achieved in the range.', description_ar: 'أفضل صافي نقاط أسبوعي محقق في النطاق.' },
      { key: 'worstNet',     expr: `ROUND(MIN(${SC_WEEKS_WORST}),1)`,           label_en: 'Worst net',     label_ar: 'أدنى نقاط',   format: 'decimal', category: 'Score', badge: 'calculated_metric',
        description_en: 'The worst weekly Net Points recorded in the range.', description_ar: 'أدنى صافي نقاط أسبوعي مسجّل في النطاق.' },
      { key: 'weeksScored',  expr: `SUM(${SC_WEEKS_COUNT})`,                    label_en: 'Weeks scored',  label_ar: 'أسابيع مقيّمة',format: 'count', category: 'Score',
        description_en: 'How many scorecard weeks were evaluated.', description_ar: 'عدد أسابيع بطاقة الأداء التي جرى تقييمها.' },
      { key: 'agents',       expr: 'COUNT(DISTINCT employee_no)',               label_en: 'Agents',        label_ar: 'الموظفون',    format: 'count', category: 'Headcount',
        description_en: 'Distinct agents scored in the selection.', description_ar: 'عدد الموظفين المقيَّمين في النطاق.' },
    ],
  },

  // ── SCORECARD KPI DETAIL (weekly entries — every KPI value + points) ──────
  {
    key: 'scorecard_kpi', label_en: 'Scorecard KPIs (weekly)', label_ar: 'مؤشرات بطاقة الأداء (أسبوعي)', group: 'Scorecard', category: 'Performance',
    description_en: 'Weekly scorecard entries with every KPI actual and its points: quality, AHT, FCR, CTR, quiz, productivity, PRR, mistakes, incidents and rank.',
    description_ar: 'إدخالات بطاقة الأداء الأسبوعية مع قيمة كل مؤشر ونقاطه: الجودة ومتوسط المعالجة وFCR وCTR والاختبار والإنتاجية وPRR والأخطاء والحوادث والترتيب.',
    from: 'scorecard_entries e JOIN scorecard_batches b ON b.id = e.batch_id',
    tenantCol: 'e.tenant_id', dateCol: 'make_date(b.period_year, b.period_month, 1)', dateGrain: 'month', personCol: 'e.employee_no',
    permission: 'reports.view',
    dimensions: [
      { key: 'person',     col: 'e.employee_no',    label_en: 'Agent ID',    label_ar: 'رقم الموظف', type: 'string', category: 'Identity',
        description_en: 'The employee number on the scorecard entry.', description_ar: 'الرقم الوظيفي في إدخال بطاقة الأداء.' },
      { key: 'name',       col: 'e.employee_name',  label_en: 'Agent',       label_ar: 'الموظف',     type: 'string', category: 'Identity',
        description_en: 'The agent name on the scorecard entry.', description_ar: 'اسم الموظف في إدخال بطاقة الأداء.' },
      { key: 'function',   col: 'e.function_name',  label_en: 'Function',    label_ar: 'الوظيفة',    type: 'string', category: 'Organization',
        description_en: 'The function whose KPI bands scored this entry.', description_ar: 'الوظيفة التي قُيّم الإدخال وفق نطاقات مؤشراتها.' },
      { key: 'teamLeader', col: 'e.team_leader',    label_en: 'Team Leader', label_ar: 'المشرف',     type: 'string', category: 'Organization',
        description_en: 'The team leader recorded on the entry.', description_ar: 'قائد الفريق المسجّل في الإدخال.' },
      { key: 'week',       col: 'e.week_label',     label_en: 'Week',        label_ar: 'الأسبوع',    type: 'string', category: 'Time',
        description_en: 'The scorecard week label the entry covers.', description_ar: 'تسمية أسبوع بطاقة الأداء الذي يغطيه الإدخال.' },
      { key: 'period',     col: 'b.period_name',    label_en: 'Batch period',label_ar: 'فترة الدفعة', type: 'string', category: 'Time',
        description_en: 'The scorecard batch (upload period) the week belongs to.', description_ar: 'دفعة بطاقة الأداء (فترة الرفع) التي يتبعها الأسبوع.' },
    ],
    metrics: [
      { key: 'netPoints',        expr: 'ROUND(AVG(e.net_points),1)',           label_en: 'Net Points',        label_ar: 'صافي النقاط',   format: 'decimal', category: 'Score', badge: 'calculated_metric',
        description_en: 'Average Net Points across the selected weeks.', description_ar: 'متوسط صافي النقاط عبر الأسابيع المحددة.' },
      { key: 'qualityActual',    expr: 'ROUND(AVG(e.quality_actual),1)',       label_en: 'Quality (actual)',  label_ar: 'الجودة (فعلي)', format: 'decimal', category: 'KPI Actuals', badge: 'calculated_metric',
        description_en: 'Average quality evaluation score achieved.', description_ar: 'متوسط درجة تقييم الجودة المحققة.' },
      { key: 'qualityScore',     expr: 'ROUND(AVG(e.quality_score),1)',        label_en: 'Quality (points)',  label_ar: 'الجودة (نقاط)', format: 'decimal', category: 'KPI Points', badge: 'calculated_metric',
        description_en: 'Average points the quality band awarded.', description_ar: 'متوسط النقاط الممنوحة من نطاق الجودة.' },
      { key: 'ahtActual',        expr: 'ROUND(AVG(e.aht_actual),1)',           label_en: 'AHT (actual)',      label_ar: 'المعالجة (فعلي)', format: 'decimal', category: 'KPI Actuals', badge: 'calculated_metric',
        description_en: 'Average handling time actually achieved.', description_ar: 'متوسط وقت المعالجة المحقق فعلياً.' },
      { key: 'ahtScore',         expr: 'ROUND(AVG(e.aht_score),1)',            label_en: 'AHT (points)',      label_ar: 'المعالجة (نقاط)', format: 'decimal', category: 'KPI Points', badge: 'calculated_metric',
        description_en: 'Average points the AHT band awarded.', description_ar: 'متوسط النقاط الممنوحة من نطاق المعالجة.' },
      { key: 'fcrActual',        expr: 'ROUND(AVG(e.fcr_actual),1)',           label_en: 'FCR (actual)',      label_ar: 'FCR (فعلي)',    format: 'decimal', category: 'KPI Actuals', badge: 'calculated_metric',
        description_en: 'Average first-contact-resolution rate achieved.', description_ar: 'متوسط نسبة الحل من أول تواصل المحققة.' },
      { key: 'fcrScore',         expr: 'ROUND(AVG(e.fcr_score),1)',            label_en: 'FCR (points)',      label_ar: 'FCR (نقاط)',    format: 'decimal', category: 'KPI Points', badge: 'calculated_metric',
        description_en: 'Average points the FCR band awarded.', description_ar: 'متوسط النقاط الممنوحة من نطاق FCR.' },
      { key: 'ctrActual',        expr: 'ROUND(AVG(e.ctr_actual),1)',           label_en: 'CTR (actual)',      label_ar: 'CTR (فعلي)',    format: 'decimal', category: 'KPI Actuals', badge: 'calculated_metric',
        description_en: 'Average contact-to-transaction (CTR) rate achieved.', description_ar: 'متوسط معدل التحويل CTR المحقق.' },
      { key: 'ctrScore',         expr: 'ROUND(AVG(e.ctr_score),1)',            label_en: 'CTR (points)',      label_ar: 'CTR (نقاط)',    format: 'decimal', category: 'KPI Points', badge: 'calculated_metric',
        description_en: 'Average points the CTR band awarded.', description_ar: 'متوسط النقاط الممنوحة من نطاق CTR.' },
      { key: 'quizActual',       expr: 'ROUND(AVG(e.quiz_actual),1)',          label_en: 'Quiz (actual)',     label_ar: 'الاختبار (فعلي)', format: 'decimal', category: 'KPI Actuals', badge: 'calculated_metric',
        description_en: 'Average weekly quiz result achieved.', description_ar: 'متوسط نتيجة الاختبار الأسبوعي المحققة.' },
      { key: 'quizScore',        expr: 'ROUND(AVG(e.quiz_score),1)',           label_en: 'Quiz (points)',     label_ar: 'الاختبار (نقاط)', format: 'decimal', category: 'KPI Points', badge: 'calculated_metric',
        description_en: 'Average points the quiz band awarded.', description_ar: 'متوسط النقاط الممنوحة من نطاق الاختبار.' },
      { key: 'productivityActual', expr: 'ROUND(AVG(e.productivity_actual),1)', label_en: 'Productivity (actual)', label_ar: 'الإنتاجية (فعلي)', format: 'decimal', category: 'KPI Actuals', badge: 'calculated_metric',
        description_en: 'Average productivity percentage achieved.', description_ar: 'متوسط نسبة الإنتاجية المحققة.' },
      { key: 'productivityScore', expr: 'ROUND(AVG(e.productivity_score),1)',  label_en: 'Productivity (points)', label_ar: 'الإنتاجية (نقاط)', format: 'decimal', category: 'KPI Points', badge: 'calculated_metric',
        description_en: 'Average points the productivity band awarded.', description_ar: 'متوسط النقاط الممنوحة من نطاق الإنتاجية.' },
      { key: 'prrRate',          expr: 'ROUND(AVG(e.prr_rate),1)',             label_en: 'PRR rate',          label_ar: 'معدل PRR',      format: 'decimal', category: 'KPI Actuals', badge: 'calculated_metric',
        description_en: 'Average positive-response (PRR) rate achieved.', description_ar: 'متوسط معدل الاستجابة الإيجابية PRR المحقق.' },
      { key: 'prrPoints',        expr: 'ROUND(AVG(e.prr_points),1)',           label_en: 'PRR (points)',      label_ar: 'PRR (نقاط)',    format: 'decimal', category: 'KPI Points', badge: 'calculated_metric',
        description_en: 'Average points the PRR band awarded.', description_ar: 'متوسط النقاط الممنوحة من نطاق PRR.' },
      { key: 'responseRate',     expr: 'ROUND(AVG(e.response_rate),1)',        label_en: 'Response rate',     label_ar: 'معدل الاستجابة', format: 'decimal', category: 'KPI Actuals', badge: 'calculated_metric',
        description_en: 'Average survey response rate achieved.', description_ar: 'متوسط معدل الاستجابة للاستبيان المحقق.' },
      { key: 'mistakes',         expr: 'SUM(COALESCE(e.mistakes_actual,0))',   label_en: 'Mistakes',          label_ar: 'الأخطاء',       format: 'count', category: 'Discipline',
        description_en: 'Total mistakes recorded on scorecard entries.', description_ar: 'إجمالي الأخطاء المسجّلة في الإدخالات.' },
      { key: 'incidents',        expr: 'SUM(COALESCE(e.incidents_actual,0))',  label_en: 'Incidents',         label_ar: 'الحوادث',       format: 'count', category: 'Discipline',
        description_en: 'Total incidents recorded on scorecard entries.', description_ar: 'إجمالي الحوادث المسجّلة في الإدخالات.' },
      { key: 'attendanceScore',  expr: 'ROUND(AVG(e.attendance_score),1)',     label_en: 'Attendance (points)', label_ar: 'الحضور (نقاط)', format: 'decimal', category: 'KPI Points', badge: 'calculated_metric',
        description_en: 'Average points the attendance band awarded.', description_ar: 'متوسط النقاط الممنوحة من نطاق الحضور.' },
      { key: 'bestRank',         expr: 'MIN(e.function_rank)',                 label_en: 'Best rank',         label_ar: 'أفضل ترتيب',    format: 'int', category: 'Score', badge: 'calculated_metric',
        description_en: 'The best (lowest) rank achieved inside the function.', description_ar: 'أفضل ترتيب (الأدنى رقماً) محقق داخل الوظيفة.' },
      { key: 'entries',          expr: 'COUNT(*)',                             label_en: 'Entries',           label_ar: 'الإدخالات',     format: 'count', category: 'Score',
        description_en: 'Number of weekly scorecard entries in the selection.', description_ar: 'عدد إدخالات بطاقة الأداء الأسبوعية في النطاق.' },
    ],
  },

  // ── SURVEY / FCR (monthly per agent per channel) ──────────────────────────
  {
    key: 'survey', label_en: 'Survey & FCR', label_ar: 'الاستبيان وFCR', group: 'Scorecard', category: 'Performance',
    description_en: 'Monthly customer-survey resolution results per agent and channel: yes/no counts, FCR percentage and the PRR ratio.',
    description_ar: 'نتائج استبيان العملاء الشهرية لكل موظف وقناة: عدّادات نعم/لا ونسبة FCR ومعدل PRR.',
    from: 'survey_fcr_monthly', tenantCol: 'tenant_id', dateCol: 'year_month', dateGrain: 'month',
    permission: 'reports.view',
    dimensions: [
      { key: 'agentEmail', col: 'agent_email', label_en: 'Agent Email', label_ar: 'بريد الموظف', type: 'string', category: 'Identity',
        description_en: 'The agent email the survey responses are attributed to.', description_ar: 'بريد الموظف الذي تُنسب إليه ردود الاستبيان.' },
      { key: 'agentName',  col: 'agent_name',  label_en: 'Agent',       label_ar: 'الموظف',      type: 'string', category: 'Identity',
        description_en: 'The agent display name on the survey rollup.', description_ar: 'اسم الموظف في ملخص الاستبيان.' },
      { key: 'channel',    col: 'channel',     label_en: 'Channel',     label_ar: 'القناة',      type: 'string', category: 'Channel',
        description_en: 'The contact channel the survey was sent on (whatsapp, email, instagram, …).', description_ar: 'قناة التواصل التي أُرسل عليها الاستبيان (واتساب، بريد، إنستغرام...).' },
      { key: 'month',      col: `to_char(year_month,'YYYY-MM')`, label_en: 'Month', label_ar: 'الشهر', type: 'string', category: 'Time', badge: 'custom_dimension',
        description_en: 'The survey month in YYYY-MM form.', description_ar: 'شهر الاستبيان بصيغة سنة-شهر.' },
      { key: 'source',     col: 'source',      label_en: 'Source',      label_ar: 'المصدر',      type: 'string', category: 'Data Quality',
        description_en: 'Which upload or ingest produced the survey rows.', description_ar: 'ملف الرفع أو المزامنة التي أنتجت صفوف الاستبيان.' },
    ],
    metrics: [
      { key: 'resolvedYes', expr: 'SUM(COALESCE(resolved_yes,0))', label_en: 'Resolved: Yes', label_ar: 'تم الحل: نعم', format: 'count', category: 'Survey',
        description_en: 'Customers who answered YES, their issue was resolved.', description_ar: 'العملاء الذين أجابوا بنعم، حُلّت مشكلتهم.' },
      { key: 'resolvedNo',  expr: 'SUM(COALESCE(resolved_no,0))',  label_en: 'Resolved: No',  label_ar: 'تم الحل: لا',  format: 'count', category: 'Survey',
        description_en: 'Customers who answered NO, their issue was not resolved.', description_ar: 'العملاء الذين أجابوا بلا، لم تُحل مشكلتهم.' },
      { key: 'responses',   expr: 'SUM(COALESCE(total,0))',        label_en: 'Responses',     label_ar: 'الردود',       format: 'count', category: 'Survey',
        description_en: 'Total survey responses received.', description_ar: 'إجمالي ردود الاستبيان المستلمة.' },
      { key: 'prrPct',      expr: 'ROUND(100.0*SUM(COALESCE(resolved_yes,0))/NULLIF(SUM(COALESCE(resolved_yes,0)+COALESCE(resolved_no,0)),0),1)', label_en: 'PRR %', label_ar: 'PRR %', format: 'pct', category: 'Survey', badge: 'calculated_metric',
        description_en: 'Positive-response ratio: Yes answers divided by Yes plus No answers.', description_ar: 'معدل الاستجابة الإيجابية: نعم مقسومة على مجموع نعم ولا.' },
      { key: 'fcrPct',      expr: 'ROUND(AVG(fcr_pct),1)',         label_en: 'FCR %',         label_ar: 'FCR %',        format: 'pct', category: 'Survey', badge: 'calculated_metric',
        description_en: 'Average first-contact-resolution percentage across the selected months.', description_ar: 'متوسط نسبة الحل من أول تواصل عبر الأشهر المحددة.' },
      { key: 'agents',      expr: 'COUNT(DISTINCT agent_email)',   label_en: 'Agents',        label_ar: 'الموظفون',     format: 'count', category: 'Headcount',
        description_en: 'Distinct agents with survey results in the selection.', description_ar: 'عدد الموظفين الذين لديهم نتائج استبيان في النطاق.' },
    ],
  },

  // ── PERMISSION / استئذان (request_permissions joined to requests for tenant) ─
  {
    key: 'permission', label_en: 'Permissions', label_ar: 'الاستئذانات', group: 'Requests', category: 'Requests',
    description_en: 'Approved and pending permission requests: counts, total and average permission minutes by type, status and date.',
    description_ar: 'طلبات الاستئذان المعتمدة والمعلّقة: العدد وإجمالي ومتوسط دقائق الاستئذان حسب النوع والحالة والتاريخ.',
    from: 'request_permissions rp JOIN requests r ON r.id = rp.request_id',
    tenantCol: 'r.tenant_id', dateCol: 'rp.permission_date',
    permission: 'attendance.view_team',
    dimensions: [
      { key: 'permissionType', col: 'rp.permission_type::text', label_en: 'Permission Type', label_ar: 'نوع الاستئذان', type: 'string', category: 'Request',
        description_en: 'The kind of permission requested (late-in, early-out, during-shift, …).', description_ar: 'نوع الاستئذان المطلوب (تأخير، خروج مبكر، أثناء الوردية...).' },
      { key: 'status',         col: 'r.status::text',           label_en: 'Status',          label_ar: 'الحالة',        type: 'string', category: 'Request',
        description_en: 'The approval status of the request.', description_ar: 'حالة اعتماد الطلب.' },
      { key: 'date',           col: 'rp.permission_date::text', label_en: 'Date',            label_ar: 'التاريخ',       type: 'date', category: 'Time',
        description_en: 'The day the permission applies to.', description_ar: 'اليوم الذي يسري عليه الاستئذان.' },
    ],
    metrics: [
      { key: 'permissionCount', expr: 'COUNT(*)',                                  label_en: 'Permissions',   label_ar: 'الاستئذانات', format: 'count', category: 'Volume',
        description_en: 'Number of permission requests in the selection.', description_ar: 'عدد طلبات الاستئذان في النطاق.' },
      { key: 'totalMinutes',    expr: 'SUM(COALESCE(rp.duration_minutes,0))',      label_en: 'Total (min)',   label_ar: 'الإجمالي (دقيقة)', format: 'minutes', category: 'Duration',
        description_en: 'Total permission minutes requested.', description_ar: 'إجمالي دقائق الاستئذان المطلوبة.' },
      { key: 'totalHours',      expr: 'ROUND(SUM(COALESCE(rp.duration_minutes,0))/60.0,1)', label_en: 'Total (hrs)', label_ar: 'الإجمالي (ساعة)', format: 'hours', category: 'Duration', badge: 'calculated_metric',
        description_en: 'Total permission time converted to hours.', description_ar: 'إجمالي وقت الاستئذان محوّلاً إلى ساعات.' },
      { key: 'avgMinutes',      expr: 'ROUND(AVG(rp.duration_minutes))',           label_en: 'Avg (min)',     label_ar: 'المتوسط (دقيقة)', format: 'int', category: 'Duration', badge: 'calculated_metric',
        description_en: 'Average permission duration in minutes.', description_ar: 'متوسط مدة الاستئذان بالدقائق.' },
    ],
  },

  // ── REQUESTS & APPROVAL SLA ───────────────────────────────────────────────
  {
    key: 'requests_sla', label_en: 'Requests & SLA', label_ar: 'الطلبات واتفاقية الخدمة', group: 'Requests', category: 'Requests',
    description_en: 'The full request-approval workflow: volumes by type and status, average decision time in hours and SLA breaches.',
    description_ar: 'سير اعتماد الطلبات كاملاً: الأحجام حسب النوع والحالة ومتوسط زمن القرار بالساعات وخروقات اتفاقية الخدمة.',
    from: 'requests r JOIN request_types rt ON rt.id = r.request_type_id',
    tenantCol: 'r.tenant_id', dateCol: 'r.submitted_at',
    permission: 'attendance.view_team',
    dimensions: [
      { key: 'type',    col: 'rt.code',                     label_en: 'Request Type', label_ar: 'نوع الطلب', type: 'string', category: 'Request',
        description_en: 'The request type code (permission, sick_leave, shift_swap, …).', description_ar: 'رمز نوع الطلب (استئذان، إجازة مرضية، تبديل وردية...).' },
      { key: 'typeName',col: 'rt.name',                     label_en: 'Type Name',    label_ar: 'اسم النوع', type: 'string', category: 'Request',
        description_en: 'The human-readable request type name.', description_ar: 'الاسم المقروء لنوع الطلب.' },
      { key: 'status',  col: 'r.status::text',              label_en: 'Status',       label_ar: 'الحالة',    type: 'string', category: 'Request',
        description_en: 'The current workflow status of the request.', description_ar: 'حالة سير العمل الحالية للطلب.' },
      { key: 'urgent',  col: `CASE WHEN r.is_urgent THEN 'urgent' ELSE 'normal' END`, label_en: 'Urgency', label_ar: 'الاستعجال', type: 'string', category: 'Request', badge: 'custom_dimension',
        description_en: 'Whether the request was flagged urgent.', description_ar: 'هل عُلّم الطلب على أنه عاجل.' },
      { key: 'date',    col: 'r.submitted_at::date::text',  label_en: 'Submitted',    label_ar: 'تاريخ التقديم', type: 'date', category: 'Time', badge: 'custom_dimension',
        description_en: 'The day the request was submitted.', description_ar: 'يوم تقديم الطلب.' },
    ],
    metrics: [
      { key: 'requests',    expr: 'COUNT(*)',                                              label_en: 'Requests',   label_ar: 'الطلبات',  format: 'count', category: 'Volume',
        description_en: 'Number of requests in the selection.', description_ar: 'عدد الطلبات في النطاق.' },
      { key: 'approved',    expr: `COUNT(*) FILTER (WHERE r.status::text = 'approved')`,   label_en: 'Approved',   label_ar: 'معتمدة',   format: 'count', category: 'Outcome', badge: 'calculated_metric',
        description_en: 'Requests fully approved.', description_ar: 'الطلبات المعتمدة بالكامل.' },
      { key: 'rejected',    expr: `COUNT(*) FILTER (WHERE r.status::text = 'rejected')`,   label_en: 'Rejected',   label_ar: 'مرفوضة',   format: 'count', category: 'Outcome', badge: 'calculated_metric',
        description_en: 'Requests rejected by an approver.', description_ar: 'الطلبات المرفوضة من معتمد.' },
      { key: 'pending',     expr: `COUNT(*) FILTER (WHERE r.status::text IN ('pending','peer_pending','in_review'))`, label_en: 'Pending', label_ar: 'معلّقة', format: 'count', category: 'Outcome', badge: 'calculated_metric',
        description_en: 'Requests still waiting for a decision (including peer acceptance).', description_ar: 'الطلبات التي ما زالت بانتظار قرار (بما فيها موافقة الزميل).' },
      { key: 'approvalRatePct', expr: `ROUND(100.0*COUNT(*) FILTER (WHERE r.status::text='approved')/NULLIF(COUNT(*) FILTER (WHERE r.status::text IN ('approved','rejected')),0),1)`, label_en: 'Approval rate %', label_ar: 'نسبة الاعتماد %', format: 'pct', category: 'Outcome', badge: 'calculated_metric',
        description_en: 'Approved share of all decided requests (approved ÷ (approved + rejected)).', description_ar: 'نسبة الطلبات المعتمدة من الطلبات المحسومة (معتمدة ÷ (معتمدة + مرفوضة)).' },
      { key: 'avgDecisionHours', expr: `ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(r.approved_l2_at, r.approved_l1_at, r.rejected_at) - r.submitted_at))/3600.0)::numeric,1)`, label_en: 'Avg decision (hrs)', label_ar: 'متوسط القرار (ساعة)', format: 'hours', category: 'SLA', badge: 'calculated_metric',
        description_en: 'Average hours between submission and the final decision.', description_ar: 'متوسط الساعات بين تقديم الطلب والقرار النهائي.' },
      { key: 'slaBreached', expr: `COUNT(*) FILTER (WHERE r.sla_due_at IS NOT NULL AND COALESCE(r.approved_l2_at, r.approved_l1_at, r.rejected_at, now()) > r.sla_due_at)`, label_en: 'SLA breached', label_ar: 'خرق الاتفاقية', format: 'count', category: 'SLA', badge: 'calculated_metric',
        description_en: 'Requests decided (or still open) past their SLA due time.', description_ar: 'الطلبات التي حُسمت (أو ما زالت مفتوحة) بعد موعد اتفاقية الخدمة.' },
      { key: 'escalated',   expr: 'COUNT(*) FILTER (WHERE r.escalated_at IS NOT NULL)',    label_en: 'Escalated',  label_ar: 'مصعّدة',   format: 'count', category: 'SLA', badge: 'calculated_metric',
        description_en: 'Requests auto-escalated for exceeding their SLA.', description_ar: 'الطلبات المصعّدة تلقائياً لتجاوز اتفاقية الخدمة.' },
    ],
  },

  // ── SHRINKAGE & LEAVE ─────────────────────────────────────────────────────
  {
    key: 'shrinkage_leave', label_en: 'Shrinkage & Leave', label_ar: 'الفاقد والإجازات', group: 'Attendance', category: 'Workforce',
    description_en: 'Lost-time view of the roster: leave, sick, absence, WFH and OFF days plus the shrinkage percentage of scheduled time.',
    description_ar: 'عرض الوقت المفقود من الجدول: أيام الإجازة والمرض والغياب والمنزل والراحة ونسبة الفاقد من الوقت المجدول.',
    from: 'roster_days', baseWhere: 'is_active', tenantCol: 'tenant_id', dateCol: 'work_date', personCol: 'COALESCE(person_no,employee_no)',
    permission: 'attendance.view_team',
    dimensions: RD_DIMS,
    metrics: [
      { key: 'leaveDays',    expr: `COUNT(*) FILTER (WHERE presence='leave')`,  label_en: 'Leave days',  label_ar: 'أيام الإجازة', format: 'count', category: 'Lost Days', badge: 'calculated_metric',
        description_en: 'Approved leave days (planned shrinkage).', description_ar: 'أيام الإجازة المعتمدة (فاقد مخطط).' },
      { key: 'sickDays',     expr: `COUNT(*) FILTER (WHERE presence='sick')`,   label_en: 'Sick days',   label_ar: 'أيام المرض',   format: 'count', category: 'Lost Days', badge: 'calculated_metric',
        description_en: 'Sick leave days (unplanned shrinkage).', description_ar: 'أيام الإجازة المرضية (فاقد غير مخطط).' },
      { key: 'absentDays',   expr: `COUNT(*) FILTER (WHERE presence='absent')`, label_en: 'Absent days', label_ar: 'أيام الغياب',  format: 'count', category: 'Lost Days', badge: 'calculated_metric',
        description_en: 'Unplanned absence days.', description_ar: 'أيام الغياب غير المخطط.' },
      { key: 'wfhDays',      expr: `COUNT(*) FILTER (WHERE presence='wfh')`,    label_en: 'WFH days',    label_ar: 'أيام المنزل',  format: 'count', category: 'Presence', badge: 'calculated_metric',
        description_en: 'Days worked from home (worked, not lost).', description_ar: 'أيام العمل من المنزل (معمولة وليست مفقودة).' },
      { key: 'offDays',      expr: `COUNT(*) FILTER (WHERE presence='off')`,    label_en: 'OFF days',    label_ar: 'أيام الراحة',  format: 'count', category: 'Presence', badge: 'calculated_metric',
        description_en: 'Weekly rest days.', description_ar: 'أيام الراحة الأسبوعية.' },
      { key: 'workedDays',   expr: `COUNT(*) FILTER (WHERE presence IN ('office','wfh'))`, label_en: 'Worked days', label_ar: 'أيام العمل', format: 'count', category: 'Presence', badge: 'calculated_metric',
        description_en: 'Days actually worked (office + WFH).', description_ar: 'الأيام المعمولة فعلياً (مكتب + منزل).' },
      { key: 'shrinkageDays',expr: `COUNT(*) FILTER (WHERE presence IN ('absent','sick','leave'))`, label_en: 'Shrinkage days', label_ar: 'أيام الفاقد', format: 'count', category: 'Shrinkage', badge: 'calculated_metric',
        description_en: 'Total lost days: absence + sick + leave.', description_ar: 'إجمالي الأيام المفقودة: غياب + مرض + إجازة.' },
      { key: 'shrinkagePct', expr: `ROUND(100.0*COUNT(*) FILTER (WHERE presence IN ('absent','sick','leave'))/NULLIF(COUNT(*) FILTER (WHERE presence <> 'off'),0),1)`, label_en: 'Shrinkage %', label_ar: 'نسبة الفاقد %', format: 'pct', category: 'Shrinkage', badge: 'calculated_metric',
        description_en: 'Lost days as a share of scheduled (non-OFF) days.', description_ar: 'الأيام المفقودة كنسبة من الأيام المجدولة (غير أيام الراحة).' },
    ],
  },

  // ── BREAKS ────────────────────────────────────────────────────────────────
  {
    key: 'breaks', label_en: 'Breaks', label_ar: 'الاستراحات', group: 'Breaks', category: 'Operations',
    description_en: 'Smart break-engine slots: break counts, late and missed breaks and average release delay per day and slot.',
    description_ar: 'فترات محرك الاستراحات الذكي: عدد الاستراحات والمتأخرة والفائتة ومتوسط تأخير الإطلاق حسب اليوم والفترة.',
    from: 'break_slots', tenantCol: 'tenant_id', dateCol: 'schedule_date',
    permission: 'attendance.view_team',
    dimensions: [
      { key: 'status',        col: 'status',              label_en: 'Status',        label_ar: 'الحالة',       type: 'string', category: 'Break',
        description_en: 'The lifecycle status of the break slot.', description_ar: 'حالة دورة حياة فترة الاستراحة.' },
      { key: 'releaseSource', col: 'release_source',      label_en: 'Release Source',label_ar: 'مصدر الإطلاق', type: 'string', category: 'Break',
        description_en: 'What released the break: the live engine, a supervisor or the plan.', description_ar: 'الجهة التي أطلقت الاستراحة: المحرك المباشر أو المشرف أو الخطة.' },
      { key: 'date',          col: 'schedule_date::text', label_en: 'Date',          label_ar: 'التاريخ',      type: 'date', category: 'Time',
        description_en: 'The schedule day of the break slot.', description_ar: 'يوم الجدول لفترة الاستراحة.' },
      { key: 'slot',          col: 'slot_number::text',   label_en: 'Slot',          label_ar: 'الفترة',       type: 'string', category: 'Break',
        description_en: 'Which break of the day this is (1st, 2nd, …).', description_ar: 'ترتيب الاستراحة في اليوم (الأولى، الثانية...).' },
    ],
    metrics: [
      { key: 'breakCount',   expr: 'COUNT(*)',                                    label_en: 'Breaks',        label_ar: 'الاستراحات',  format: 'count', category: 'Volume',
        description_en: 'Number of break slots in the selection.', description_ar: 'عدد فترات الاستراحة في النطاق.' },
      { key: 'lateCount',    expr: 'COUNT(*) FILTER (WHERE late_minutes > 0)',    label_en: 'Late breaks',   label_ar: 'متأخرة',      format: 'count', category: 'Compliance', badge: 'calculated_metric',
        description_en: 'Breaks started later than their released time.', description_ar: 'الاستراحات التي بدأت بعد وقت إطلاقها.' },
      { key: 'missedCount',  expr: 'COUNT(*) FILTER (WHERE is_missed)',           label_en: 'Missed',        label_ar: 'فائتة',       format: 'count', category: 'Compliance', badge: 'calculated_metric',
        description_en: 'Breaks never taken at all.', description_ar: 'الاستراحات التي لم تؤخذ إطلاقاً.' },
      { key: 'totalLateMin', expr: 'SUM(COALESCE(late_minutes,0))',              label_en: 'Late (min)',    label_ar: 'التأخير (دقيقة)', format: 'minutes', category: 'Compliance',
        description_en: 'Total minutes of late break starts.', description_ar: 'إجمالي دقائق التأخير في بدء الاستراحات.' },
      { key: 'avgDelayMin',  expr: 'ROUND(AVG(delay_min))',                       label_en: 'Avg delay',     label_ar: 'متوسط التأخير',format: 'int', category: 'Compliance', badge: 'calculated_metric',
        description_en: 'Average delay between the planned and released break time.', description_ar: 'متوسط الفارق بين وقت الاستراحة المخطط والمُطلق.' },
    ],
  },

  // ── COVERAGE / HC ─────────────────────────────────────────────────────────
  {
    key: 'coverage', label_en: 'Coverage / HC', label_ar: 'التغطية', group: 'Coverage', category: 'Operations',
    description_en: 'Hourly headcount snapshots: required vs scheduled vs actual vs available staff and the resulting gap per hour.',
    description_ar: 'لقطات القوى العاملة الساعية: المطلوب مقابل المجدول مقابل الفعلي مقابل المتاح والعجز الناتج لكل ساعة.',
    from: 'headcount_intervals', tenantCol: 'tenant_id', dateCol: 'snapshot_date',
    permission: 'attendance.view_team',
    dimensions: [
      { key: 'date', col: 'snapshot_date::text', label_en: 'Date', label_ar: 'التاريخ', type: 'date', category: 'Time',
        description_en: 'The snapshot day of the headcount interval.', description_ar: 'يوم لقطة فترة القوى العاملة.' },
      { key: 'hour', col: `to_char(interval_start,'HH24:00')`, label_en: 'Hour', label_ar: 'الساعة', type: 'string', category: 'Time', badge: 'custom_dimension',
        description_en: 'The hour of day the interval covers.', description_ar: 'ساعة اليوم التي تغطيها الفترة.' },
    ],
    metrics: [
      { key: 'requiredHc',  expr: 'SUM(COALESCE(required_hc,0))',      label_en: 'Required HC',  label_ar: 'المطلوب',   format: 'int', category: 'Headcount',
        description_en: 'Staff required by the demand forecast for the interval.', description_ar: 'القوى العاملة المطلوبة حسب توقع الطلب للفترة.' },
      { key: 'scheduledHc', expr: 'SUM(COALESCE(scheduled_hc,0))',     label_en: 'Scheduled HC', label_ar: 'المجدول',   format: 'int', category: 'Headcount',
        description_en: 'Staff scheduled on shift during the interval.', description_ar: 'القوى العاملة المجدولة في الوردية خلال الفترة.' },
      { key: 'actualHc',    expr: 'SUM(COALESCE(actual_hc,0))',        label_en: 'Actual HC',    label_ar: 'الفعلي',    format: 'int', category: 'Headcount',
        description_en: 'Staff actually present during the interval.', description_ar: 'القوى العاملة الحاضرة فعلياً خلال الفترة.' },
      { key: 'availableHc', expr: 'SUM(COALESCE(available_hc,0))',     label_en: 'Available HC', label_ar: 'المتاح',    format: 'int', category: 'Headcount',
        description_en: 'Staff available after permissions and shrinkage.', description_ar: 'القوى العاملة المتاحة بعد الاستئذانات والفاقد.' },
      { key: 'gapHc',       expr: 'SUM(COALESCE(gap_hc,0))',           label_en: 'Gap HC',       label_ar: 'العجز',     format: 'int', category: 'Gap',
        description_en: 'Shortfall between required and available staff.', description_ar: 'الفجوة بين القوى المطلوبة والمتاحة.' },
      { key: 'onPermission',expr: 'SUM(COALESCE(on_permission_hc,0))', label_en: 'On permission',label_ar: 'باستئذان',  format: 'int', category: 'Gap',
        description_en: 'Staff away on an approved permission during the interval.', description_ar: 'الموظفون الغائبون باستئذان معتمد خلال الفترة.' },
    ],
  },

  // ── CONTACTS VOLUME (ops_contacts — the real contact stream) ──────────────
  {
    key: 'contacts_volume', label_en: 'Contacts Volume', label_ar: 'حجم جهات الاتصال', group: 'Operations', category: 'Operations',
    description_en: 'The raw contact stream: volumes by channel, hour, reason and agent, plus survey send and click counts.',
    description_ar: 'تدفق جهات الاتصال الخام: الأحجام حسب القناة والساعة والسبب والموظف، مع عدّادات إرسال ونقر الاستبيان.',
    from: 'ops_contacts', tenantCol: 'tenant_id', dateCol: 'contact_date',
    permission: 'reports.view',
    dimensions: [
      { key: 'channel',   col: 'channel',              label_en: 'Channel',        label_ar: 'القناة',       type: 'string', category: 'Channel',
        description_en: 'The channel the contact arrived on (voice, chat, whatsapp, …).', description_ar: 'القناة التي وصل عبرها التواصل (هاتف، محادثة، واتساب...).' },
      { key: 'reason',    col: 'contact_reason',       label_en: 'Contact Reason', label_ar: 'سبب التواصل',  type: 'string', category: 'Contact',
        description_en: 'The tagged reason for the customer contact.', description_ar: 'السبب المصنّف لتواصل العميل.' },
      { key: 'agentName', col: 'agent_name',           label_en: 'Agent',          label_ar: 'الموظف',       type: 'string', category: 'Identity',
        description_en: 'The agent who handled the contact.', description_ar: 'الموظف الذي عالج التواصل.' },
      { key: 'date',      col: 'contact_date::text',   label_en: 'Date',           label_ar: 'التاريخ',      type: 'date', category: 'Time',
        description_en: 'The calendar date of the contact.', description_ar: 'تاريخ التواصل.' },
      { key: 'hour',      col: `lpad(contact_hour::text,2,'0') || ':00'`, label_en: 'Hour', label_ar: 'الساعة', type: 'string', category: 'Time', badge: 'custom_dimension',
        description_en: 'The hour of day the contact arrived.', description_ar: 'ساعة اليوم التي وصل فيها التواصل.' },
      { key: 'paymentMethod', col: 'payment_method',   label_en: 'Payment Method', label_ar: 'طريقة الدفع',  type: 'string', category: 'Contact',
        description_en: 'The payment method tied to the contact, when captured.', description_ar: 'طريقة الدفع المرتبطة بالتواصل إن وُجدت.' },
    ],
    metrics: [
      { key: 'contacts',       expr: 'COUNT(*)',                                    label_en: 'Contacts',       label_ar: 'جهات الاتصال', format: 'count', category: 'Volume',
        description_en: 'Total number of contacts in the selection.', description_ar: 'إجمالي عدد جهات الاتصال في النطاق.' },
      { key: 'surveysSent',    expr: 'COUNT(*) FILTER (WHERE survey_sent)',         label_en: 'Surveys sent',   label_ar: 'استبيانات مرسلة', format: 'count', category: 'Survey', badge: 'calculated_metric',
        description_en: 'Contacts where a satisfaction survey was sent — awaiting survey capture; this flag is currently empty, so a zero here is not yet real.', description_ar: 'التواصلات التي أُرسل بعدها استبيان رضا — بانتظار مزامنة الاستبيان؛ العلامة فارغة حالياً، فالصفر غير حقيقي بعد.' },
      { key: 'surveysClicked', expr: 'COUNT(*) FILTER (WHERE survey_clicked)',      label_en: 'Surveys clicked',label_ar: 'استبيانات منقورة', format: 'count', category: 'Survey', badge: 'calculated_metric',
        description_en: 'Sent surveys the customer opened or answered — awaiting survey capture; this flag is currently empty, so a zero here is not yet real.', description_ar: 'الاستبيانات المرسلة التي فتحها العميل أو أجاب عليها — بانتظار مزامنة الاستبيان؛ العلامة فارغة حالياً، فالصفر غير حقيقي بعد.' },
      { key: 'surveyClickRatePct', expr: 'ROUND(100.0*COUNT(*) FILTER (WHERE survey_clicked)/NULLIF(COUNT(*) FILTER (WHERE survey_sent),0),1)', label_en: 'Survey click rate %', label_ar: 'نسبة نقر الاستبيان %', format: 'pct', category: 'Survey', badge: 'calculated_metric',
        description_en: 'Clicked surveys as a share of sent — awaiting survey capture; the sent/clicked flags are currently empty, so a 0% here is NOT a real click-rate (returns empty when nothing was sent).', description_ar: 'الاستبيانات المنقورة كنسبة من المرسلة — بانتظار مزامنة الاستبيان؛ علامتا الإرسال/النقر فارغتان حالياً، فنسبة 0% ليست معدل نقر حقيقياً (تعود فارغة عند عدم إرسال شيء).' },
      { key: 'agents',         expr: 'COUNT(DISTINCT agent_name)',                  label_en: 'Agents',         label_ar: 'الموظفون', format: 'count', category: 'Headcount',
        description_en: 'Distinct agents who handled contacts in the selection.', description_ar: 'عدد الموظفين المختلفين الذين عالجوا التواصلات في النطاق.' },
    ],
  },
];

export const SOURCE_BY_KEY: Record<string, DataSourceDef> =
  Object.fromEntries(DATA_SOURCES.map(s => [s.key, s]));

// Suppress unused-import lint when MATERNITY_7H is only referenced transitively via CRED_EARLY.
void MATERNITY_7H;
