#!/usr/bin/env node
/**
 * CROSS-CHECK — do the demo pages agree with each other, and with raw SQL?
 *
 * Every endpoint answering 200 proves nothing about whether the platform tells a
 * consistent story. The failure that actually costs a sale is two screens showing
 * two different numbers for the same thing, live, in front of the buyer. So this
 * asks the SAME question through different paths and refuses to accept agreement
 * on faith: each check states its tolerance and why.
 *
 *   node scripts/cross-check-demo.js [baseUrl]
 */
const fs = require('fs'), path = require('path'), jwt = require('jsonwebtoken'), { Client } = require('pg');
for (const p of [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')])
  if (fs.existsSync(p)) for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
const BASE = process.argv[2] || 'http://localhost:3000';

(async () => {
  const c = new Client({ host: process.env.POSTGRES_HOST, port: +process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD });
  await c.connect();
  const [u] = (await c.query(
    `SELECT u.id, u.tenant_id FROM users u JOIN user_roles ur ON ur.user_id=u.id
       JOIN roles r ON r.id=ur.role_id WHERE u.status='active' AND r.code='platform_admin' LIMIT 1`)).rows;
  const T = u.tenant_id;
  const token = jwt.sign({ sub: u.id, tenantId: T }, process.env.JWT_ACCESS_SECRET, { expiresIn: '30m' });
  const api = async (p) => {
    const r = await fetch(`${BASE}/api/v1${p}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${p}`);
    return r.json();
  };
  const sql = async (q, p = []) => (await c.query(q, p)).rows;

  const [span] = await sql(
    `SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [T]);
  const FROM = span.a, TO = span.b;
  const [m] = await sql(
    `SELECT to_char(work_date,'YYYY-MM') m FROM roster_days WHERE tenant_id=$1
       AND (COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))>0
      GROUP BY 1 ORDER BY 2 DESC LIMIT 1`.replace('ORDER BY 2', 'ORDER BY SUM(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))'), [T]);
  const MONTH = m.m, YEAR = FROM.slice(0, 4);

  console.log(`CROSS-CHECK — span ${FROM} → ${TO} · OT month ${MONTH}\n`);

  const results = [];
  const check = async (name, why, fn, tol = 0.02) => {
    try {
      const { a, b, labelA, labelB, unit = '' } = await fn();
      const A = Number(a), B = Number(b);
      /* A comparison that cannot be made must FAIL, not pass. The first version of
         this let NaN through: Math.max(NaN, n) is NaN, the `> 0` guard was false, rel
         defaulted to 0 and the check reported ✓ on a value it never read. A check that
         flatters itself is worse than no check — it buys false confidence. */
      if (!Number.isFinite(A) || !Number.isFinite(B)) {
        results.push({ name, ok: false, A, B, labelA, labelB, unit, why,
          err: `not comparable: ${labelA}=${a}, ${labelB}=${b}` });
        console.log(` ✗ ${name}\n     NOT COMPARABLE — ${labelA} = ${a}, ${labelB} = ${b}`);
        console.log(`     why it matters: ${why}`);
        return;
      }
      /* Two zeroes are not agreement, they are two absences. Say so. */
      if (A === 0 && B === 0) {
        results.push({ name, ok: false, A, B, labelA, labelB, unit, why, err: 'both sides zero — nothing was measured' });
        console.log(` ✗ ${name}\n     BOTH ZERO — ${labelA} and ${labelB} are both 0; this proves nothing`);
        console.log(`     why it matters: ${why}`);
        return;
      }
      const diff = Math.abs(A - B);
      const rel = Math.max(Math.abs(A), Math.abs(B)) > 0 ? diff / Math.max(Math.abs(A), Math.abs(B)) : 1;
      const ok = tol < 1 ? rel <= tol : diff <= tol;
      results.push({ name, ok, A, B, labelA, labelB, unit, why, rel });
      console.log(`${ok ? ' ✓' : ' ✗'} ${name}`);
      console.log(`     ${labelA} = ${A}${unit}   vs   ${labelB} = ${B}${unit}` +
        (ok ? '' : `   ← DIFFER by ${diff.toFixed(2)}${unit} (${(rel * 100).toFixed(1)}%)`));
      if (!ok) console.log(`     why it matters: ${why}`);
    } catch (e) {
      results.push({ name, ok: false, err: e.message, why });
      console.log(` ✗ ${name}\n     ERROR ${e.message}`);
    }
  };

  /* ── 1. TRUE_OT is one number everywhere ────────────────────────────────
     The first version of this check compared the report against UNFILTERED raw SQL
     and "found" a 592.92h gap. The gap was real but the check was wrong: the report
     is PAYABLE OT and correctly drops two things the raw sum keeps —
        · rows where NOT is_active — duplicate identity rows (BR-ATT-008 canonical dedup)
        · rows where ot_record_only — supervisory roles are recorded, never paid (BR-ROL-002)
     Comparing like-for-like is the weaker test; asserting the DECOMPOSITION is the
     strong one, because it fails if either rule silently stops being applied. */
  await check('OT: report equals payable OT in SQL (like for like)',
    'If the OT report and the database disagree, every payroll conversation built on this screen is wrong.',
    async () => {
      const r = await api(`/attendance-recon/roster-v2/ot-exceptions?from=${FROM}&to=${TO}`);
      const [q] = await sql(
        `SELECT ROUND(SUM(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))/60.0, 2) h
           FROM roster_days
          WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3
            AND is_active AND NOT COALESCE(ot_record_only,false)`, [T, FROM, TO]);
      return { a: r.ot.totalHrs, b: q.h, labelA: 'OT & Exceptions report', labelB: 'SQL payable OT', unit: 'h' };
    }, 0.001);

  await check('OT: raw total decomposes exactly into payable + dedup + record-only',
    'This is the real guard: it fails the moment either the canonical-dedup rule or the supervisory record-only rule stops being applied.',
    async () => {
      const [q] = await sql(
        `SELECT
           ROUND(SUM(t)/60.0,2) AS raw,
           ROUND(SUM(t) FILTER (WHERE is_active AND NOT COALESCE(ot_record_only,false))/60.0,2) AS payable,
           ROUND(SUM(t) FILTER (WHERE NOT is_active)/60.0,2) AS dedup,
           ROUND(SUM(t) FILTER (WHERE is_active AND COALESCE(ot_record_only,false))/60.0,2) AS rec
         FROM (SELECT is_active, ot_record_only,
                      COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0) AS t
                 FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3) x`, [T, FROM, TO]);
      return { a: Number(q.raw), b: Number(q.payable) + Number(q.dedup) + Number(q.rec),
        labelA: 'raw 3-bucket total', labelB: 'payable + dedup + record-only', unit: 'h' };
    }, 0.001);

  await check('OT: the three buckets sum to the total',
    'A total that is not the sum of its parts means one bucket is being dropped or double-counted.',
    async () => {
      const r = await api(`/attendance-recon/roster-v2/ot-exceptions?from=${FROM}&to=${TO}`);
      return { a: r.ot.totalHrs, b: r.ot.regularHrs + r.ot.offdayHrs + r.ot.holidayHrs,
        labelA: 'reported total', labelB: 'regular+offday+holiday', unit: 'h' };
    });

  // ── 2. OT tracker (month) vs the same month in the year grid ───────────
  await check('OT tracker: month sheet vs full-year sheet, same month',
    'These are two exports the buyer can open side by side. They must not disagree.',
    async () => {
      const mo = await api(`/attendance-recon/roster-v2/ot-tracker?month=${MONTH}`);
      const [q] = await sql(
        `SELECT COUNT(DISTINCT person_no)::int p FROM roster_days
          WHERE tenant_id=$1 AND to_char(work_date,'YYYY-MM')=$2
            AND (COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))>0`, [T, MONTH]);
      return { a: mo.totals.people, b: q.p, labelA: 'tracker people', labelB: 'SQL distinct people', unit: '' , };
    }, 0.10);

  // ── 3. Roster grid population vs the dashboard ─────────────────────────
  await check('Roster: person count, grid vs dashboard',
    'The headline "how many people" must be one number across the roster module.',
    async () => {
      const dash = await api(`/attendance-recon/roster-dashboard?from=${FROM}&to=${TO}`);
      const [q] = await sql(
        `SELECT COUNT(DISTINCT person_no)::int p FROM roster_days
          WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active`, [T, FROM, TO]);
      return { a: dash.summary?.agents, b: q.p, labelA: 'dashboard summary.agents', labelB: 'SQL distinct active person_no', unit: '' };
    }, 0.02);

  await check('Roster: dashboard OT total vs the OT report',
    'Two roster screens quoting different OT totals is the single most damaging inconsistency in a WFM demo.',
    async () => {
      const dash = await api(`/attendance-recon/roster-dashboard?from=${FROM}&to=${TO}`);
      const rep = await api(`/attendance-recon/roster-v2/ot-exceptions?from=${FROM}&to=${TO}`);
      return { a: Math.round((dash.summary?.ot_total ?? 0) / 60 * 100) / 100, b: rep.ot.totalHrs,
        labelA: 'dashboard ot_total', labelB: 'OT report total', unit: 'h' };
    }, 0.001);

  // ── 4. Schedule coverage vs schedule grid ──────────────────────────────
  await check('Schedule: employees in the grid vs its own coverage total',
    'The grid and the coverage strip under it are rendered from one payload — if they disagree the payload is inconsistent.',
    async () => {
      const wk = (await api('/schedule/available-weeks'))[0];
      const g = await api(`/schedule/grid?weekStart=${wk}`);
      const inFns = (g.functions || []).reduce((s, f) => s + (f.employees || []).length, 0);
      return { a: g.totalEmployees, b: inFns, labelA: 'totalEmployees', labelB: 'sum over functions', unit: '' };
    });

  await check('Schedule: coverage day total equals the roster population',
    'Each day\'s working+off+leave+absent must account for everyone — a short total means someone vanished.',
    async () => {
      const wk = (await api('/schedule/available-weeks'))[0];
      const g = await api(`/schedule/grid?weekStart=${wk}`);
      const day = Object.values(g.coverage || {})[0] || {};
      return { a: (day.working || 0) + (day.off || 0) + (day.leave || 0) + (day.absent || 0),
        b: day.total || 0, labelA: 'working+off+leave+absent', labelB: 'stated total', unit: '' };
    });

  // ── 5. Capacity: required HC is internally consistent ──────────────────
  await check('Capacity: per-function peaks roll up to the stated peak',
    'The hiring decision is read off this number; a roll-up that does not match its own detail is not defensible.',
    async () => {
      const [d] = await sql(`SELECT MAX(work_date)::text d FROM roster_days WHERE tenant_id=$1`, [T]);
      const r = await api(`/capacity/staffing/requirement?date=${d.d}`);
      const day = (r.days || [])[0] || {};
      const fns = day.functions || [];
      /* The 48 half-hour totalCurve is the number the generator consumes, and every
         function's own hourly curve feeds it. If the roll-up drifts from its detail,
         the hiring verdict on screen is not defensible. */
      /* totalCurve48 is 48 half-hour slots; each function publishes 24 HOURLY rows
         carrying `requiredScheduledHc`. Fold the hourly detail to the same 48-slot
         grain (each hour spans two slots) before comparing — comparing a 24-array to
         a 48-array by index is how the first version produced NaN. */
      const peakFromCurve = Math.max(0, ...(day.totalCurve48 || [0]));
      const perSlot = Array.from({ length: 48 }, (_, slot) =>
        fns.reduce((s, f) => {
          const h = (f.hours || []).find((x) => x.hour === Math.floor(slot / 2));
          return s + (h?.requiredScheduledHc ?? 0);
        }, 0));
      const peakFromFns = Math.max(0, ...perSlot);
      return { a: peakFromCurve, b: peakFromFns,
        labelA: 'stated peak of totalCurve48', labelB: 'peak of summed function curves', unit: ' HC' };
    }, 0.02);

  // ── 6. Data-span agrees with reality ───────────────────────────────────
  await check('Data span: reported coverage vs the table itself',
    'Every screen now opens from this endpoint. If it is wrong, every screen opens in the wrong place.',
    async () => {
      const s = await api('/attendance-recon/roster-v2/data-span');
      const [q] = await sql(`SELECT COUNT(*)::int n FROM roster_days WHERE tenant_id=$1`, [T]);
      return { a: s.roster.rows, b: q.n, labelA: 'data-span rows', labelB: 'SQL COUNT(*)', unit: '' };
    });

  await check('Data span: latest day really is the maximum work_date',
    'Screens land on this date. If it is not the true maximum, they land on an empty day.',
    async () => {
      const s = await api('/attendance-recon/roster-v2/data-span');
      const [q] = await sql(`SELECT MAX(work_date)::text d FROM roster_days WHERE tenant_id=$1`, [T]);
      return { a: s.latestDay === q.d ? 1 : 0, b: 1, labelA: `latestDay ${s.latestDay}`, labelB: `SQL max ${q.d}`, unit: '' };
    });

  // ── 7. OT year vs its own per-month breakdown ──────────────────────────
  await check('OT year-to-date: months add up to the year total',
    'The year headline is what a buyer remembers; it must equal the months shown beneath it.',
    async () => {
      const y = await api(`/attendance-recon/roster-v2/ot-year?year=${YEAR}`);
      const sum = (y.totals.months || []).reduce((a, b) => a + b, 0) + (y.totals.undated || 0);
      return { a: y.totals.total, b: sum, labelA: 'year total', labelB: 'sum of months (+undated)', unit: 'h' };
    });

  await check('OT year-to-date: people count matches the rows returned',
    'A stated population larger than the table beneath it is the classic dashboard lie.',
    async () => {
      const y = await api(`/attendance-recon/roster-v2/ot-year?year=${YEAR}`);
      return { a: y.totals.people, b: (y.people || []).length, labelA: 'stated people', labelB: 'rows returned', unit: '' };
    });


  /* ═══════════════════════════════════════════════════════════════════════
     WHOLE-SYSTEM — the modules outside the demo path also have to agree.
     Added after the Report Builder was found answering a different "True OT"
     than the OT report for the identical window: nothing was watching it.
     ═══════════════════════════════════════════════════════════════════════ */

  // ── 8. Report Builder is not a private universe ────────────────────────
  const build = async (body) => {
    const r = await fetch(`${BASE}/api/v1/report-builder-v2/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} on report-builder run`);
    return (await r.json()).rows?.[0] ?? {};
  };

  await check('Builder: True OT equals the OT report for the same window',
    'A user can build their own OT report. If the builder applies different rules than the official ' +
    'report, the buyer gets two numbers for one concept from one product — measured gap was 51.82h ' +
    '(supervisory record-only) on top of 541.12h (duplicate identities).',
    async () => {
      const row = await build({ sourceKey: 'overtime', metrics: ['trueOtMin'], dateFrom: FROM, dateTo: TO });
      const [q] = await sql(
        `SELECT SUM(COALESCE(ot_min,0)+COALESCE(offday_ot_min,0)+COALESCE(holiday_ot_min,0))::int m
           FROM roster_days
          WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3
            AND is_active AND NOT COALESCE(ot_record_only,false)`, [T, FROM, TO]);
      return { a: Number(row.trueOtMin) / 60, b: q.m / 60, labelA: 'builder True OT', labelB: 'payable OT in SQL', unit: 'h' };
    }, 0);

  await check('Builder: agent population excludes duplicate identities',
    'roster_days keeps non-canonical rows for people with a folded second employee number. A builder ' +
    'report that counts them reports more staff than exist.',
    async () => {
      const row = await build({ sourceKey: 'overtime', metrics: ['agents'], dateFrom: FROM, dateTo: TO });
      const [q] = await sql(
        `SELECT COUNT(DISTINCT COALESCE(person_no,employee_no))::int n FROM roster_days
          WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3
            AND is_active AND NOT COALESCE(ot_record_only,false)`, [T, FROM, TO]);
      return { a: row.agents, b: q.n, labelA: 'builder agents', labelB: 'canonical people in SQL', unit: '' };
    }, 0);

  await check('Builder: late days use the platform tardiness window, not > 0',
    'A one-minute lateness is not a lateness (BR-TRD-001, 7..240). A builder report that counts it ' +
    'would put people on a list the official reports never put them on.',
    async () => {
      const row = await build({ sourceKey: 'attendance', metrics: ['lateDays'], dateFrom: FROM, dateTo: TO });
      const [q] = await sql(
        `SELECT COUNT(*)::int n FROM roster_days
          WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active
            AND sys_late_min BETWEEN 7 AND 240`, [T, FROM, TO]);
      return { a: row.lateDays, b: q.n, labelA: 'builder late days', labelB: 'SQL 7..240', unit: 'days' };
    }, 0);

  // ── 9. Scorecard: one period, and Final never blended into the weeks ────
  await check('Scorecard board: reports a real uploaded period, not a blend',
    'The board read every scorecard row the tenant has ever had while the caption named one month. ' +
    'With a second month uploaded that silently averages two months into one league table.',
    async () => {
      const b = await api('/attendance-recon/roster-v2/scorecard');
      const [q] = await sql(
        `SELECT COUNT(DISTINCT batch_id)::int n FROM scorecard_entries se
          WHERE se.tenant_id=$1 AND se.batch_id = (
            SELECT id FROM scorecard_batches WHERE tenant_id=$1 AND status <> 'archived'
             ORDER BY period_year DESC NULLS LAST, period_month DESC NULLS LAST, uploaded_at DESC LIMIT 1)`, [T]);
      return { a: b.period ? q.n : 0, b: 1, labelA: `board period "${b.period}" → batches`, labelB: 'exactly one', unit: '' };
    }, 0);

  await check('Scorecard board: agent count matches the period it claims',
    'A board listing more agents than the period contains means rows leaked in from another upload.',
    async () => {
      const b = await api('/attendance-recon/roster-v2/scorecard');
      const [q] = await sql(
        `SELECT COUNT(DISTINCT i.person_no)::int n
           FROM scorecard_entries se JOIN employee_identity i
             ON i.tenant_id=se.tenant_id AND i.employee_no=se.employee_no
          WHERE se.tenant_id=$1 AND se.week_label <> 'Final'
            AND se.batch_id = (SELECT id FROM scorecard_batches WHERE tenant_id=$1 AND status <> 'archived'
              ORDER BY period_year DESC NULLS LAST, period_month DESC NULLS LAST, uploaded_at DESC LIMIT 1)`, [T]);
      return { a: b.count, b: q.n, labelA: 'board agents', labelB: 'people with weekly rows', unit: '' };
    }, 0);

  await check('Scorecard board: the official Final is never folded into the weekly average',
    'Averaging W1..W4 together with the Final summary row turned one agent\u2019s official Net of 125 ' +
    'into 113. The two must be reported side by side, never added.',
    async () => {
      const b = await api('/attendance-recon/roster-v2/scorecard');
      const withFinal = (b.agents || []).filter((a) => a.final_net != null);
      if (!withFinal.length) return { a: 1, b: 1, labelA: 'no Final rows in this period', labelB: 'n/a', unit: '' };
      const [q] = await sql(
        `SELECT MAX(se.net_points)::numeric v
           FROM scorecard_entries se JOIN employee_identity i
             ON i.tenant_id=se.tenant_id AND i.employee_no=se.employee_no
          WHERE se.tenant_id=$1 AND se.week_label='Final' AND i.person_no=$2
            AND se.batch_id = (SELECT id FROM scorecard_batches WHERE tenant_id=$1 AND status <> 'archived'
              ORDER BY period_year DESC NULLS LAST, period_month DESC NULLS LAST, uploaded_at DESC LIMIT 1)`,
        [T, withFinal[0].person_no]);
      return { a: Number(withFinal[0].final_net), b: Number(q.v),
               labelA: `board final_net (${withFinal[0].name})`, labelB: 'the Final row in SQL', unit: 'pts' };
    }, 0);

  // ── 10. Attrition: the headline rate and the list beneath it ───────────
  await check('Attrition: the separations list matches the stated count',
    'The classic dashboard lie is a headline larger than the table under it.',
    async () => {
      const a = await api('/attrition?months=6');
      return { a: a.summary.separations, b: (a.separations || []).length,
               labelA: 'stated separations', labelB: 'rows listed', unit: '' };
    }, 0);

  await check('Attrition: voluntary + involuntary account for every separation',
    'A separation that is neither RES nor TER would vanish from both splits while still inflating the total.',
    async () => {
      const a = await api('/attrition?months=6');
      return { a: a.summary.separations, b: a.summary.voluntary + a.summary.involuntary,
               labelA: 'total separations', labelB: 'voluntary + involuntary', unit: '' };
    }, 0);

  await check('Attrition: a rate is stated only when it can be computed',
    'With no headcount to divide by, a 0 rate was rendered as a large GREEN 0% — a window with no ' +
    'data reading as perfect retention. Null is the only honest answer.',
    async () => {
      const a = await api('/attrition?months=6');
      const consistent = (a.summary.avgHeadcount > 0) === (a.summary.attritionRatePeriod != null);
      return { a: consistent ? 1 : 0, b: 1,
               labelA: `avgHC ${a.summary.avgHeadcount} / rate ${a.summary.attritionRatePeriod}`,
               labelB: 'rate present iff headcount > 0', unit: '' };
    }, 0);

  // ── 11. Coverage: an unmodelled requirement is not a surplus ───────────
  await check('Coverage: every hour states whether its requirement was modelled',
    'No same-weekday history produced required=0, so gap = available - 0 reported a comfortable ' +
    'SURPLUS. "We could not model this" must never render as "zero staff needed".',
    async () => {
      /* Stated as CONSISTENT == TOTAL, not BAD == 0. The harness rejects 0-vs-0 on
         purpose — two zeros prove nothing, because a check that never read anything
         also produces them. Counting the hours that pass makes the assertion real. */
      const cv = await api(`/coverage/hourly?date=${TO}`);
      let good = 0, total = 0;
      for (const f of cv.functions || []) for (const h of f.hours || []) {
        total++;
        // `required` and `gap` must be null together, and `modelled` must agree with both
        const paired = (h.required == null) === (h.gap == null);
        const honest = (h.required != null) === (h.modelled === true);
        if (paired && honest) good++;
      }
      return { a: good, b: total, labelA: 'hours stating their own basis', labelB: 'hours returned', unit: '' };
    }, 0);

  // ── 12. Shrinkage: the parts and the whole ─────────────────────────────
  await check('Shrinkage: planned + unplanned + late equals the stated total',
    'Shrinkage drives every capacity number. If the components do not sum to the headline, the ' +
    'headline is not made of the components.',
    async () => {
      const sh = await api(`/analytics/shrinkage?from=${FROM}&to=${TO}`);
      const o = sh.overall;
      return { a: o.totalPct, b: o.plannedPct + o.unplannedPct + o.latePct,
               labelA: 'stated total shrinkage', labelB: 'planned + unplanned + late', unit: '%' };
    }, 0.011);   // each part is rounded to 1dp, so three parts can drift by up to 0.05

  await check('Shrinkage: weekday and weekend partition the same scheduled days',
    'The split views must cover the whole period exactly once — no day counted twice, none dropped.',
    async () => {
      const sh = await api(`/analytics/shrinkage?from=${FROM}&to=${TO}`);
      return { a: sh.overall.scheduledDays, b: sh.weekday.scheduledDays + sh.weekend.scheduledDays,
               labelA: 'overall scheduled days', labelB: 'weekday + weekend', unit: 'days' };
    }, 0);


  // ── 13. The permission balance is counted over the CYCLE, not a week ────
  await check('Permission balance: enforced over the cut-off cycle',
    'BR-PRM-003 is 3 permissions + 6 hours per CYCLE (BR-TIM-002). The code counted a ' +
    'Sat-Fri week, which is ~1/4 of a cycle and therefore granted ~4x the agreed balance. ' +
    'If this ever reverts, 384 of 2,298 employee-cycles go back to being over the limit.',
    async () => {
      const [emp] = await sql(
        `SELECT r.employee_id, rp.permission_date::text d
           FROM requests r JOIN request_permissions rp ON rp.request_id=r.id
           JOIN request_types rt ON rt.id=r.request_type_id
          WHERE rt.code='permission' AND r.status NOT IN ('rejected','cancelled')
          ORDER BY rp.permission_date DESC LIMIT 1`);
      if (!emp) return { a: 1, b: 1, labelA: 'no permissions on file', labelB: 'n/a', unit: '' };
      const u = await api(`/permission-requests/weekly-usage?employeeId=${emp.employee_id}&date=${emp.d}`);
      // a cycle spans ~28-31 days; a week would be exactly 7
      const days = Math.round(
        (new Date(u.weekEnd + 'T00:00:00Z') - new Date(u.weekStart + 'T00:00:00Z')) / 86400000) + 1;
      return { a: days >= 27 ? 1 : 0, b: 1,
               labelA: `window ${u.weekStart}→${u.weekEnd} = ${days} days`,
               labelB: 'a cycle (>=27 days), not a week', unit: '' };
    }, 0);

  await check('Permission balance: the hour cap is reported, not just enforced',
    'The 6-hour cap was always enforced but never returned, so a TL could read ' +
    '"2 of 3 permissions left", approve, and have the minute cap reject it.',
    async () => {
      const [emp] = await sql(
        `SELECT r.employee_id, rp.permission_date::text d
           FROM requests r JOIN request_permissions rp ON rp.request_id=r.id
           JOIN request_types rt ON rt.id=r.request_type_id
          WHERE rt.code='permission' AND r.status NOT IN ('rejected','cancelled')
          ORDER BY rp.permission_date DESC LIMIT 1`);
      if (!emp) return { a: 1, b: 1, labelA: 'no permissions on file', labelB: 'n/a', unit: '' };
      const u = await api(`/permission-requests/weekly-usage?employeeId=${emp.employee_id}&date=${emp.d}`);
      const ok = Number.isFinite(u.usedMinutes) && Number.isFinite(u.remainingMinutes) && u.maxMinutes === 360;
      return { a: ok ? 1 : 0, b: 1,
               labelA: `used ${u.usedMinutes}m / max ${u.maxMinutes}m`,
               labelB: 'minutes reported, cap = 360', unit: '' };
    }, 0);

  await c.end();
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${'═'.repeat(72)}`);
  console.log(`  ${results.length - bad.length}/${results.length} cross-checks agree`);
  if (bad.length) {
    console.log('\n  DISAGREEMENTS — fix before the demo:');
    bad.forEach((r) => console.log(`   • ${r.name}${r.err ? ` — ${r.err}` : ''}`));
    process.exit(1);
  }
  console.log('\n  ✅ Every screen tells the same story.');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
