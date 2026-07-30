/* ── The inference chain ─────────────────────────────────────────────────────────────
   Every other roster surface answers "what is the number". This one answers "why", for a
   single person-day, in the order the engine actually decided it: what the schedule said,
   what each system witnessed, which witness governed, what the rules did to those inputs,
   and what came out.

   Two commitments make it worth trusting:

   1. It RE-DERIVES rather than re-states. Conformance, tardiness and worked minutes are
      recomputed here from the stored inputs and compared against the stored results. When
      the recomputation disagrees, the response says so out loud (`agrees: false`) instead
      of printing a tidy story over a number it cannot account for. An explanation that
      cannot fail is not evidence.

   2. It names the rule. Each step carries its BR-ID, so a disagreement about a number is
      immediately a conversation about a rule — which is the only kind of disagreement that
      can actually be settled.

   The arithmetic below deliberately mirrors recon-build.js line for line. If the engine
   changes, this must change with it; the `agrees` flag is what makes that drift visible
   the first time someone opens a row rather than a quarter later.  */
import { Controller, Get, Query, Req, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RequirePermissions } from '@common/decorators/permissions.decorator';

type Step = {
  id: string;
  title: string; titleAr: string;
  rule?: string;
  inputs: { k: string; kAr: string; v: string }[];
  text: string; textAr: string;
  result?: string;
  tone: 'plain' | 'good' | 'warn' | 'bad';
};

const MATERNITY = new Set(['12375', '12434']);
const MATERNITY_WINDOW = 420;
const TARDY_CEIL = 240;
const TOLERANCE = 6;             // BR-TRD-001: >6 minutes is where tardiness becomes credible

const hhmm = (m: number | null | undefined) =>
  m == null ? '—' : `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
const dur = (m: number | null | undefined) =>
  m == null ? '—' : m === 0 ? '0' : `${Math.floor(m / 60)}h ${m % 60}m`.replace(/^0h /, '');

@ApiTags('attendance-recon')
@Controller('attendance-recon')
export class ExplainController {
  constructor(@InjectDataSource() private ds: DataSource) {}

  @Get('roster-v2/explain')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'The full reasoning chain behind one person-day, re-derived and self-checked' })
  async explain(@Req() req: any, @Query('personNo') personNo?: string, @Query('date') date?: string) {
    if (!personNo || !date) throw new BadRequestException('personNo and date are required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');

    const [r] = await this.ds.query(
      `SELECT person_no, employee_no, clean_name, name, function_name, role_category, team_manager, gender,
              work_date::text AS work_date, day_name, shift_code, attendance_code, hr_code,
              shift_start_min, shift_end_min, crosses_midnight, is_7h, expected_hours,
              punch_in_min, punch_out_min, sys_login_min, sys_logout_min, login_src,
              worked_min, sys_late_min, sys_early_min, raw_sys_late_min, raw_sys_early_min,
              late_min, early_min, adherence_pct, presence, location, permission, permission_type,
              permission_status, comp_off, sick, ot_min, offday_ot_min, holiday_ot_min,
              include_tardiness, ot_record_only, data_quality, mismatch, status
         FROM roster_days
        WHERE tenant_id = $1 AND person_no = $2 AND work_date = $3 AND is_active
        LIMIT 1`,
      [req.user.tenantId, personNo, date]);
    if (!r) throw new NotFoundException(`no active roster row for ${personNo} on ${date}`);

    const steps: Step[] = [];
    const n = (v: any) => (v == null ? null : Number(v));
    const isMother = MATERNITY.has(String(r.person_no));

    /* ── 1. What was planned ────────────────────────────────────────────────── */
    const ss = n(r.shift_start_min);
    let se = n(r.shift_end_min);
    /* A cross-midnight row stores an end BEFORE its start. Every span below has to unwrap
       it first; forgetting to is how a 9-hour night shift becomes a negative number and
       silently drops out of an average. */
    const wrapped = ss != null && se != null && se <= ss;
    if (wrapped && se != null) se += 1440;
    const gross = ss != null && se != null ? se - ss : null;

    steps.push({
      id: 'planned', tone: 'plain',
      title: 'What the schedule asked for', titleAr: 'شو طلب الجدول',
      rule: 'BR-SHF-004/005/006',
      inputs: [
        { k: 'Shift code', kAr: 'كود الشفت', v: r.shift_code || '—' },
        { k: 'Window', kAr: 'الفترة', v: ss != null ? `${hhmm(ss)} → ${hhmm(se)}` : '—' },
        { k: 'Gross span', kAr: 'الطول الكامل', v: dur(gross) },
        ...(wrapped ? [{ k: 'Crosses midnight', kAr: 'بيعبر منتصف الليل', v: 'yes — owned by the START day (BR-TIM-003)' }] : []),
        ...(isMother ? [{ k: 'Maternity 7h', kAr: 'أمومة ٧ ساعات', v: 'yes — window capped at 7h (BR-MAT-001)' }] : []),
      ],
      text: gross == null
        ? 'No shift window on this row, so nothing downstream can be measured against a plan.'
        : `The sheet placed a ${r.shift_code} shift from ${hhmm(ss)} to ${hhmm(se)} — ${dur(gross)} gross, break included. Gross is the right yardstick: the agent stays logged in through the break, so the system span must cover the whole window, not the net hours.`,
      textAr: gross == null
        ? 'ما في فترة شفت بهالصف، فما في إشي ينقاس عليه.'
        : `الشيت حطّ شفت ${r.shift_code} من ${hhmm(ss)} لـ${hhmm(se)} — ${dur(gross)} كاملة مع البريك. الطول الكامل هو المسطرة الصح: الموظف بيضل داخل السيستم بالبريك، فلازم الجلسة تغطي الفترة كلها مش الساعات الصافية.`,
      result: r.shift_code || '—',
    });

    /* ── 2. Who witnessed the day ───────────────────────────────────────────── */
    /* Session times are stored modulo 1440, so on a cross-midnight shift the calendar day is
       gone and must be recovered from the shift window. Two wrong rules were tried first and
       both are instructive:

         "unwrap when logout < login" — misses the MD (22:00→07:00) worked late, where BOTH
         ends land after midnight, so no unwrap fires and a next-day session is compared to a
         previous-day start for an overlap of zero (55% against a stored 100%).

         "anything before the shift start belongs to tomorrow" — shoves EARLY ARRIVALS into
         the next day. Daoud Khatib logs in at 957 against a 960 start; he is three minutes
         early, not twenty-four hours late. 505 normal and 241 cross-midnight rows in one
         month have a login before their shift start, because arriving early is ordinary.

       The disambiguation is not a threshold but proximity: of the two candidates (t, t+1440)
       pick whichever sits nearer its anchor. Three minutes early beats twenty-four hours late
       on every real row, and it needs no special case for crossing midnight at all. */
    const nearest = (t: number | null, anchor: number | null) => {
      if (t == null || anchor == null) return t;
      return Math.abs(t - anchor) <= Math.abs(t + 1440 - anchor) ? t : t + 1440;
    };
    let login = nearest(n(r.sys_login_min), ss);
    let logout = nearest(n(r.sys_logout_min), se);
    if (login != null && logout != null && logout < login) logout += 1440;
    const hasSystem = login != null && logout != null;
    const hasPunch = n(r.punch_in_min) != null;

    steps.push({
      id: 'witness', tone: hasSystem || hasPunch ? 'plain' : 'bad',
      title: 'Who witnessed the day', titleAr: 'مين شهد على اليوم',
      rule: 'BR-ATT-001/002',
      inputs: [
        { k: 'System session', kAr: 'جلسة السيستم', v: hasSystem ? `${hhmm(login)} → ${hhmm(logout)}` : 'none' },
        { k: 'Source', kAr: 'المصدر', v: r.login_src || '—' },
        { k: 'Biometric punch', kAr: 'البصمة', v: hasPunch ? `${hhmm(n(r.punch_in_min))} → ${hhmm(n(r.punch_out_min))}` : 'none' },
      ],
      text: !hasSystem && !hasPunch
        ? 'Neither system saw this day. Nothing is inferred from that silence — the day is flagged for a human rather than scored or marked absent (BR-ATT-005).'
        : hasSystem
          ? `The ${r.login_src || 'system'} session governs the official late/early basis; the punch corroborates presence but is measured on a different ruler.`
          : 'Only a biometric punch exists. Presence is real, but punctuality here is measured against the punch, not a system login — a different ruler from most rows.',
      textAr: !hasSystem && !hasPunch
        ? 'ولا نظام شاف هاليوم. ما بننتج إشي من هالصمت — اليوم بينعلّم لمراجعة بشرية، لا بينحسب ولا بينحط غياب.'
        : hasSystem
          ? `جلسة ${r.login_src || 'السيستم'} هي الأساس الرسمي للتأخير والخروج المبكر؛ البصمة بتأكّد الحضور بس بمسطرة تانية.`
          : 'في بصمة بس بلا جلسة سيستم. الحضور حقيقي، بس الانضباط هون بينقاس على البصمة مش على اللوج-إن.',
      result: hasSystem ? (r.login_src || 'system') : hasPunch ? 'punch only' : 'no witness',
    });

    /* ── 3. Presence verdict ────────────────────────────────────────────────── */
    steps.push({
      id: 'presence', tone: 'plain',
      title: 'Office, home, or not a working day', titleAr: 'مكتب، بيت، ولا مش يوم دوام',
      rule: 'BR-WFH-001 · BR-LVE-002',
      inputs: [
        { k: 'Presence', kAr: 'الحضور', v: r.presence || '—' },
        { k: 'Location', kAr: 'الموقع', v: r.location || '—' },
        { k: 'HR code', kAr: 'كود HR', v: r.hr_code || '—' },
        { k: 'Attendance cell', kAr: 'خانة الحضور', v: r.attendance_code || '—' },
      ],
      text: `WFH is only ever concluded from a WFH shift code, an explicit WFH location, or an Odoo WFH status — never from "system login but no punch", which is an office day with a missing punch. This row reads ${r.presence || 'unknown'}.`,
      textAr: `العمل من البيت بينستنتج بس من كود WFH، أو موقع WFH صريح، أو حالة WFH بأودو — أبداً مش من «في لوج-إن بلا بصمة»، لأنه هاد يوم مكتب ببصمة ناقصة. هالصف بيقرا ${r.presence || 'غير معروف'}.`,
      result: r.presence || '—',
    });

    /* ── 4. Tardiness, before and after forgiveness ─────────────────────────── */
    const rawLate = n(r.raw_sys_late_min);
    const rawEarly = n(r.raw_sys_early_min);
    const storedLate = n(r.sys_late_min) || 0;
    const storedEarly = n(r.sys_early_min) || 0;
    /* Forgiveness must be read from the permission itself, not merely from "raw minutes that
       are no longer charged" — because two different mechanisms zero that number and only one
       of them earns conformance credit.

       An approved permission CREDITS the minutes back (BR-PRM-001). Maternity-7h stops the
       early-out being CHARGED (BR-MAT-001) but grants no credit; it shortens the paid window
       instead. Inferring forgiveness from the zero alone conflates them, and inferring it from
       the zero while excluding mothers gets the opposite case wrong: Shaima Saoud on
       2026-07-20 holds an HR-Approved Early Out Permission for 240 minutes, which the engine
       credits — reading her as "mother, therefore no credit" scored her 71% against a stored
       100%. Same shape as every other bug worth catching: two independent gates collapsed
       into one, and the person who loses is the one the rule was written to protect. */
    const covered = /approved/i.test(String(r.permission_status || r.permission || '')) || !!r.comp_off;
    const lateForgiven = rawLate != null && rawLate > 0 && storedLate === 0 && covered;
    const earlyForgiven = rawEarly != null && rawEarly > 0 && storedEarly === 0 && covered;
    const credLate = storedLate >= 7 && storedLate <= TARDY_CEIL;
    const credEarly = storedEarly >= 7 && storedEarly <= TARDY_CEIL && !isMother;

    steps.push({
      id: 'tardiness', tone: credLate || credEarly ? 'warn' : 'good',
      title: 'Late in, early out', titleAr: 'التأخير والخروج المبكر',
      rule: 'BR-TRD-001/002 · BR-PRM-001',
      inputs: [
        { k: 'Raw late', kAr: 'التأخير الخام', v: rawLate != null ? dur(rawLate) : dur(storedLate) },
        { k: 'Raw early-out', kAr: 'الخروج المبكر الخام', v: rawEarly != null ? dur(rawEarly) : dur(storedEarly) },
        { k: 'Permission', kAr: 'الإذن', v: r.permission ? `${r.permission_type || 'permission'} — ${r.permission_status || 'status unknown'}` : 'none' },
        { k: 'Charged late', kAr: 'التأخير المحتسب', v: dur(storedLate) },
        { k: 'Charged early-out', kAr: 'الخروج المحتسب', v: dur(storedEarly) },
      ],
      text: [
        `Tolerance is ${TOLERANCE} minutes: at or below it, nothing is counted.`,
        lateForgiven ? `The ${dur(rawLate)} late arrival was covered by an approved permission, so it is excused — but it stays on the record rather than disappearing.` : '',
        earlyForgiven ? `The ${dur(rawEarly)} early departure was likewise covered.` : '',
        isMother && rawEarly ? 'Maternity 7h: early-out is not counted against this person at all (BR-MAT-001).' : '',
        (storedLate > TARDY_CEIL || storedEarly > TARDY_CEIL) ? `Anything past ${TARDY_CEIL} minutes on a cross-midnight shift is logout bleed, not tardiness, and is capped and flagged rather than charged.` : '',
        !credLate && !credEarly && !lateForgiven && !earlyForgiven ? 'Nothing credible to charge on this day.' : '',
      ].filter(Boolean).join(' '),
      textAr: [
        `السماح ${TOLERANCE} دقايق: تحتها ما بينحسب إشي.`,
        lateForgiven ? `التأخير ${dur(rawLate)} كان مغطّى بإذن معتمد، فمعفيّ — بس بيضل مسجّل، ما بينمسح.` : '',
        earlyForgiven ? `والخروج المبكر ${dur(rawEarly)} كمان كان مغطّى.` : '',
        isMother && rawEarly ? 'أمومة ٧ ساعات: الخروج المبكر ما بينحسب على هالشخص أبداً.' : '',
        !credLate && !credEarly && !lateForgiven && !earlyForgiven ? 'ما في إشي معتبر ينحسب بهاليوم.' : '',
      ].filter(Boolean).join(' '),
      result: credLate || credEarly ? `${dur(storedLate)} late · ${dur(storedEarly)} early` : 'clean',
    });

    /* ── 5. Conformance, re-derived ─────────────────────────────────────────── */
    /* `verifiable` is separate from `agrees` on purpose. The raw_sys_* columns — the only
       record of what a permission forgave — were added on 2026-07-30, so every row before
       July lacks them. On such a row a forgiven day cannot be reconstructed: the credit is
       invisible, the recomputation lands low, and reporting that as "disagrees" would tell
       the reader a correct number is untrustworthy. Measured on the live table that is 14%
       of May and June (239 of 1,823 June days, 333 of 2,293 May), against 0% of July.
       "I cannot check this" and "this is wrong" must never share a message. */
    let confCheck: {
      recomputed: number | null; stored: number | null;
      agrees: boolean; verifiable: boolean; note: string;
    } = { recomputed: null, stored: n(r.adherence_pct), agrees: true, verifiable: true, note: 'not computable on this row' };
    const preAudit = r.raw_sys_late_min == null && r.raw_sys_early_min == null;

    if (hasSystem && ss != null && se != null && login != null && logout != null) {
      const paidRaw = se - ss;
      const paid = isMother ? Math.min(paidRaw, MATERNITY_WINDOW) : paidRaw;
      const effSchedEnd = isMother ? ss + paid : se;
      const overlap = Math.max(0, Math.min(logout, effSchedEnd) - Math.max(login, ss));
      const permitted = (lateForgiven ? (rawLate || 0) : 0) + (earlyForgiven ? (rawEarly || 0) : 0);
      const recomputed = paid > 0 ? Math.min(100, Math.round(100 * Math.min(overlap + permitted, paid) / paid)) : null;
      const stored = n(r.adherence_pct);
      /* One point of tolerance: the stored value was rounded at write time from the same
         formula, and a re-round of a re-read can legitimately land a point away. Anything
         wider is a real disagreement and must not be smoothed over. */
      const matches = recomputed == null || stored == null || Math.abs(recomputed - stored) <= 1;
      /* A pre-audit row that matches anyway is still a match worth reporting; only a MISS on
         such a row is unverifiable, because the missing credit is the one thing that could
         explain the gap. */
      const verifiable = matches || !preAudit;
      confCheck = {
        recomputed, stored, agrees: matches, verifiable,
        note: matches ? 'the re-derivation matches what is stored'
          : verifiable ? 'the re-derivation DISAGREES with the stored value — treat this number as unverified'
          : 'this row predates the audit columns, so a permission credit cannot be reconstructed — unverifiable here, not wrong',
      };

      steps.push({
        id: 'conformance', tone: matches ? (recomputed != null && recomputed >= 95 ? 'good' : 'warn') : verifiable ? 'bad' : 'warn',
        title: 'Conformance', titleAr: 'الالتزام',
        rule: 'BR-TRD-003',
        inputs: [
          { k: 'Paid window', kAr: 'الفترة المدفوعة', v: `${dur(paid)}${isMother && paid < paidRaw ? ' (capped at 7h — maternity)' : ''}` },
          { k: 'Overlap with schedule', kAr: 'التداخل مع الجدول', v: dur(overlap) },
          { k: 'Permitted credit', kAr: 'المعفى بإذن', v: dur(permitted) },
          { k: 'Stored', kAr: 'المخزّن', v: stored != null ? `${stored}%` : '—' },
          { k: 'Re-derived here', kAr: 'المعاد اشتقاقه', v: recomputed != null ? `${recomputed}%` : '—' },
        ],
        text: `100 × min(overlap ${overlap} + permitted ${permitted}, paid ${paid}) ÷ paid ${paid} = ${recomputed}%. ` +
          (matches
            ? 'This matches the stored value, so the number can be quoted.'
            : verifiable
              ? `The stored value is ${stored}%. The two do not agree, which means either this row or the engine changed since it was written — do not quote this number until that is resolved.`
              : `The stored value is ${stored}%. This row predates the columns that record what a permission forgave, so the credit cannot be reconstructed and the gap is expected. The stored figure is not contradicted here — it simply cannot be re-checked from this row.`),
        textAr: `١٠٠ × أقل من (تداخل ${overlap} + معفى ${permitted}، مدفوع ${paid}) ÷ ${paid} = ${recomputed}%. ` +
          (matches ? 'مطابق للمخزّن، فالرقم بينحكى فيه.'
            : verifiable
              ? `المخزّن ${stored}% — مش مطابقين، يعني إما الصف أو المحرّك تغيّر بعد ما انكتب. ما تحكي بهالرقم لحد ما ينحل.`
              : `المخزّن ${stored}%. هالصف أقدم من الأعمدة اللي بتسجّل شو أعفى الإذن، فما بنقدر نعيد بناء الرصيد والفرق متوقّع. الرقم المخزّن مش مكذَّب هون — بس ما بينفحص من هالصف.`),
        result: recomputed != null ? `${recomputed}%` : '—',
      });
    }

    /* ── 6. Overtime, in its three disjoint buckets ─────────────────────────── */
    const ot = n(r.ot_min) || 0, offOt = n(r.offday_ot_min) || 0, holOt = n(r.holiday_ot_min) || 0;
    const trueOt = ot + offOt + holOt;
    if (trueOt > 0 || r.ot_record_only) {
      steps.push({
        id: 'ot', tone: trueOt > 0 ? 'warn' : 'plain',
        title: 'Overtime', titleAr: 'الأوفر تايم',
        rule: 'BR-OT-001/003/004',
        inputs: [
          { k: 'Worked-day OT', kAr: 'أوفر تايم يوم دوام', v: dur(ot) },
          { k: 'Off-day OT', kAr: 'أوفر تايم يوم عطلة', v: dur(offOt) },
          { k: 'Holiday OT', kAr: 'أوفر تايم عيد', v: dur(holOt) },
          { k: 'TRUE_OT', kAr: 'الإجمالي الحقيقي', v: dur(trueOt) },
          ...(r.ot_record_only ? [{ k: 'Record-only role', kAr: 'دور للتسجيل فقط', v: 'yes — recorded, not deducted' }] : []),
        ],
        text: 'The three buckets are disjoint and are always SUMMED, never subtracted — reading ot_min alone undercounts by roughly a quarter. Off-day and holiday OT additionally require evidence: a system login with no punch is flagged rather than credited.',
        textAr: 'الثلاث خانات منفصلة وبتنجمع دايماً، ما بتنطرح — قراية ot_min لحاله بتنقّص حوالي الربع. وأوفر تايم العطلة والعيد بدهم دليل: لوج-إن بلا بصمة بينعلّم، ما بينحسب.',
        result: dur(trueOt),
      });
    }

    /* ── 7. Is this day allowed to count ───────────────────────────────────── */
    const dq: string[] = String(r.data_quality || '').split('|').map(s => s.trim()).filter(Boolean);
    /* A non-working day is not "scored" in any meaningful sense, whatever include_tardiness
       happens to hold — the flag is simply left at its default on the 1,072 OFF/leave rows in
       a month, and conformance is null on every one of them. Reporting "counts in conformance
       averages" for a rest day would be false, and the kind of false that sounds authoritative.
       The three states are genuinely distinct and are named as such. */
    const isWorkingDay = ss != null;
    const state = !isWorkingDay ? 'non-working' : r.include_tardiness ? 'scored' : 'unscored';
    steps.push({
      id: 'scoreable', tone: state === 'scored' ? 'good' : state === 'non-working' ? 'plain' : 'warn',
      title: 'Does this day count', titleAr: 'هل هاليوم بينحسب',
      rule: 'BR-ATT-005 · BR-ROL-002',
      inputs: [
        { k: 'Day kind', kAr: 'نوع اليوم', v: isWorkingDay ? 'working day' : `non-working (${r.hr_code || r.shift_code || 'OFF'})` },
        { k: 'Scored', kAr: 'مقيَّم', v: state === 'scored' ? 'yes' : 'no' },
        { k: 'Worked minutes', kAr: 'دقايق الشغل', v: dur(n(r.worked_min)) },
        { k: 'Expected hours', kAr: 'الساعات المتوقعة', v: r.expected_hours != null ? `${r.expected_hours}h` : '—' },
      ],
      text: state === 'non-working'
        ? `Not a working day — ${r.hr_code || r.shift_code || 'OFF'}. It carries no conformance figure and enters no punctuality average. Any system activity on it is overtime, not attendance.`
        : state === 'scored'
          ? 'This day carries enough evidence to be scored, so it counts in conformance and tardiness averages.'
          : `This day is recorded but deliberately not scored${dq.length ? `: ${dq.join(' · ')}` : '.'} Excluding it protects the person from being judged on evidence that is not there — and protects the average from being diluted by a day nobody measured.`,
      textAr: state === 'non-working'
        ? `مش يوم دوام — ${r.hr_code || r.shift_code || 'OFF'}. ما بيحمل نسبة التزام وما بيدخل بأي معدل انضباط. أي نشاط سيستم عليه بيكون أوفر تايم، مش حضور.`
        : state === 'scored'
          ? 'هاليوم عنده دليل كافي ليتقيّم، فبينحسب بمعدلات الالتزام والتأخير.'
          : `هاليوم مسجّل بس عن قصد مش مقيَّم${dq.length ? `: ${dq.join(' · ')}` : '.'} استثناؤه بيحمي الشخص من إنه ينحاكم على دليل مش موجود — وبيحمي المعدل من إنه يتمدّد بيوم ما حدا قاسه.`,
      result: state === 'non-working' ? 'not a working day' : state === 'scored' ? 'counts' : 'recorded, not scored',
    });

    return {
      who: {
        personNo: r.person_no, employeeNo: r.employee_no, name: r.clean_name || r.name,
        fn: r.function_name, roleCategory: r.role_category, tl: r.team_manager,
        date: r.work_date, day: r.day_name,
      },
      steps,
      /* The self-check travels with the answer. A drill-down that could never contradict
         itself would be decoration; this one can, and says so when it does. */
      selfCheck: confCheck,
      flags: dq,
    };
  }
}
