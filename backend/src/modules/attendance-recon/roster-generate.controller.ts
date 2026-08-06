import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Post, Query, Req, UseGuards, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { shiftCategoryFromCode, shiftCategoryCaseSql } from '@common/shift-category';
import { RosterSharedService } from './roster-shared.service';
import { scoreScheduleQuality, QualityRow } from '../schedule-generator/verdict.engine';
import { kwToday } from '@common/kw-date';

/* Schedule generators (ladder / demand mix / weekly assignment), drafts and
 * publish/unpublish, split VERBATIM out of the monolithic ReconController
 * (2026-07-07, EXECUTION_BRIEF Phase-4). Same route prefix — zero route renames. */
@ApiTags('Attendance Reconciliation')
@ApiBearerAuth()
@Controller('attendance-recon')
@UseGuards(JwtAuthGuard)
export class RosterGenerateController {
  constructor(
    private readonly shared: RosterSharedService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}
  /* ── LADDERED ROTATION (Director 2026-07-04) — humane, coverage-safe block rotation ──
   *  Each agent works a BLOCK of 2-3 days in one band, rests, then STEPS to the next band
   *  (forward = morning→evening→night, easiest on the body). Agents are phase-staggered across
   *  the cycle so each day's per-band coverage ≈ demand — the schedule fills the need WITHOUT
   *  daily shift-thrash, guarantees ≥1 rest day between bands (post-night recovery), keeps females
   *  off midnight, and shows any residual gap honestly (feed it to gap-remedies). Read-only proposal. */
  @Get('roster-v2/ladder-generate')
  @RequirePermissions('schedule.generate')
  async ladderGenerate(@Req() req: any, @Query('function') functionName?: string,
    @Query('weekStart') weekStart?: string, @Query('weeks') weeksQ?: string, @Query('direction') dirQ?: string,
    @Query('allowFemaleN') allowFemaleNQ?: string) {
    const t = req.user.tenantId;
    // Females are day-only (up to C) by DEFAULT. allowFemaleN = the "operationally necessary" exception
    // (rule 6.4): lets females take the evening band via N ONLY (ends 22:00) — NEVER E (ends 01:00).
    const allowFemaleN = allowFemaleNQ === '1' || allowFemaleNQ === 'true';
    const snapSat = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 1) % 7)); return d.toISOString().slice(0, 10); };
    const [{ frontier }] = await this.ds.query(`SELECT MAX(work_date)::text frontier FROM roster_days WHERE tenant_id=$1 AND is_active`, [t]);
    // function key is CANONICAL (interns fold into their parent team for headcount — Director rule)
    let fn = functionName ? functionName.replace(/^\s*[Ii]nternship\s+/, '') : functionName;
    if (!fn) { const [top] = await this.ds.query(`SELECT canon_fn(COALESCE(role_function,function_name)) fn FROM roster_days WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1`, [t]); fn = top?.fn; }
    const ws = snapSat(weekStart || (frontier ? (() => { const d = new Date(frontier + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })() : kwToday()));
    const weeks = Math.max(1, Math.min(4, parseInt(weeksQ || '2', 10)));
    const nDays = weeks * 7;
    const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dates: string[] = []; { const d = new Date(ws + 'T00:00:00Z'); for (let i = 0; i < nDays; i++) { dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } }

    // active pool for the function, with gender
    const pool = await this.ds.query(
      `SELECT e.employee_no, TRIM(CONCAT(e.first_name_en,' ',COALESCE(e.last_name_en,''))) name, COALESCE(e.gender,'male') gender
         FROM employees e JOIN functions f ON f.id=e.function_id
        WHERE e.tenant_id=$1 AND e.status='active' AND canon_fn(f.name)=$2 ORDER BY e.employee_no`, [t, fn]).catch(() => []);
    if (!pool.length) return { weekStart: ws, function: fn, error: 'no active employees for this function', grid: [], coverage: [] };

    // demand per band = 28-day observed avg agents/day whose shift START lands in the band window
    const dRows = await this.ds.query(`
      WITH r AS (SELECT shift_start_min ss FROM roster_days WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL
                   AND canon_fn(COALESCE(role_function,function_name))=$2 AND work_date >= ($3::date-28) AND work_date < $3::date),
      d AS (SELECT GREATEST(COUNT(DISTINCT work_date),1) n FROM roster_days WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL AND work_date >= ($3::date-28) AND work_date < $3::date)
      SELECT ROUND(COUNT(*) FILTER (WHERE ss>=300 AND ss<720)::numeric/(SELECT n FROM d),1)::float morning,
             ROUND(COUNT(*) FILTER (WHERE ss>=720 AND ss<1020)::numeric/(SELECT n FROM d),1)::float evening,
             ROUND(COUNT(*) FILTER (WHERE ss>=1020 OR ss<300)::numeric/(SELECT n FROM d),1)::float night
      FROM r`, [t, fn, ws]).catch(() => [{ morning: 0, evening: 0, night: 0 }]);
    const demand = { morning: dRows[0]?.morning || 0, evening: dRows[0]?.evening || 0, night: dRows[0]?.night || 0 };

    // Females are DAY-only (up to C) — they cover the morning band. So the MALES only need to cover the
    // RESIDUAL demand: morning not already met by the female pool, plus all of evening + night. Sizing the
    // male blocks by that residual stops males wasting days on an already-covered morning while evening/
    // night go short (the female pool is ~5/7 of its size working on any day).
    const males0 = pool.filter((p: any) => p.gender === 'male'), females0 = pool.filter((p: any) => p.gender !== 'male');
    const femWorking = females0.length * 5 / 7;
    const maleDem = { morning: Math.max(0, demand.morning - femWorking), evening: demand.evening, night: demand.night };
    const mAvg = (maleDem.morning + maleDem.evening + maleDem.night) / 3 || 1;
    const mblk = (x: number) => x >= mAvg * 1.15 ? 3 : x >= mAvg * 0.4 ? 2 : 1;  // tiny residual → a 1-day touch (humane variety)
    const bm = mblk(maleDem.morning), be = mblk(maleDem.evening), bn = mblk(maleDem.night);
    // FORWARD cycle (chosen by coverage; forward preferred on tie): morning→evening→night→OFF→OFF
    const dir = dirQ === 'backward' ? 'backward' : 'forward';
    const order = dir === 'backward' ? ['night', 'evening', 'morning'] : ['morning', 'evening', 'night'];
    const bandLen: any = { morning: bm, evening: be, night: bn };
    // Humane cycle: each 2-3 day band BLOCK is followed by a full OFF (rest after each block →
    // consecutive working days ≤ the block length, never a 7-day streak — the OFF is interleaved,
    // not dumped at the end, which previously let a week land with 0 OFF once the weekly +wk step
    // shifted a non-7 cycle). Males step morning→evening→night.
    const buildCycle = (bands: string[]) => { const c: string[] = []; for (const band of bands) { for (let i = 0; i < bandLen[band]; i++) c.push(band); c.push('OFF'); } return c; };
    const maleCycle = buildCycle(order);
    // FEMALES: capped at C by default (day band). A clean 3+2 split with rest = a 7-day cycle
    // (2 OFF/week, ≤3 consecutive); they rotate M/B/C. When allowFemaleN is set (operational necessity),
    // they also step into an EVENING block — but the code picker gives them N ONLY, never the blocked E.
    const femaleCycle: string[] = allowFemaleN
      ? ['morning', 'morning', 'morning', 'OFF', 'evening', 'evening', 'OFF']
      : ['morning', 'morning', 'morning', 'OFF', 'morning', 'morning', 'OFF'];

    // band → concrete shift code (spread within a band across agents for full-width coverage).
    // Morning = up to C (female-safe). Evening/night codes are only ever reached by the male cycle.
    const CODES: any = { morning: ['M', 'B', 'C'], evening: ['N', 'E'], night: ['MD', 'MN'] };
    const males = pool.filter((p: any) => p.gender === 'male'), females = pool.filter((p: any) => p.gender !== 'male');
    // Each agent STEPS FORWARD one cycle-slot every new week (wk), so week-2 is never a copy of
    // week-1 — fixes the "static fortnight" (a 7-slot female cycle used to repeat exactly). The
    // cross-agent phase stagger still delivers each day's band coverage; +wk moves the whole cohort
    // forward together, so the per-day band histogram is only time-shifted (coverage preserved).
    // Walk the cycle continuously (phase+d). The cycles are no longer length-7 (a rest OFF now
    // follows each block → male 10-11, female 8), so week-2 already differs from week-1 without a
    // per-week index step — and dropping that step keeps the interleaved OFF intact, so consecutive
    // working days never exceed a block length (≤3). The concrete code still rotates weekly (+wk) for
    // within-band variety.
    const assign = (list: any[], cycle: string[]) => list.map((p, i) => {
      const female = p.gender !== 'male';
      const phase = cycle.length ? Math.floor(i * cycle.length / Math.max(1, list.length)) : 0;
      const days = dates.map((_, d) => {
        const wk = Math.floor(d / 7);
        const band = cycle[(phase + d) % cycle.length];
        if (band === 'OFF') return 'OFF';
        // females in the evening band take N ONLY (ends 22:00) — never the blocked E (ends 01:00).
        const codes = (female && band === 'evening') ? ['N'] : CODES[band];
        return codes[(i + wk) % codes.length];   // alternate the concrete code week-to-week
      });
      return { employeeNo: p.employee_no, name: p.name, gender: p.gender, days };
    });
    const grid = [...assign(males, maleCycle), ...assign(females, femaleCycle)].sort((a, b) => a.name.localeCompare(b.name));

    // coverage per day per band vs demand + honest gaps
    const bandOf = (code: string) => code === 'OFF' ? 'off' : ['M', 'B', 'C', 'AM'].includes(code) ? 'morning' : ['N', 'E', 'EE', 'EE20'].includes(code) ? 'evening' : 'night';
    const coverage = dates.map((date, d) => {
      const cnt = { morning: 0, evening: 0, night: 0, off: 0 } as any;
      for (const g of grid) cnt[bandOf(g.days[d])]++;
      const gap = { morning: +(demand.morning - cnt.morning).toFixed(1), evening: +(demand.evening - cnt.evening).toFixed(1), night: +(demand.night - cnt.night).toFixed(1) };
      return { date, dayName: DOW[new Date(date + 'T00:00:00Z').getUTCDay()], ...cnt, demand, gap,
        short: [gap.morning, gap.evening, gap.night].some(x => x >= 1) };
    });
    const shortDays = coverage.filter(c => c.short).length;
    return {
      weekStart: ws, weeks, function: fn, direction: dir, blocks: { morning: bm, evening: be, night: bn },
      demand, poolSize: pool.length, males: males.length, females: females.length,
      cycleMale: maleCycle, cycleFemale: femaleCycle, dates,
      grid, coverage,
      summary: {
        shortDays, coversAll: shortDays === 0,
        femaleNightExcluded: !allowFemaleN, allowFemaleN,
        femalePolicy: allowFemaleN
          ? 'females may cover the evening band via N only (ends 22:00) — operational-necessity exception (rule 6.4); never E/MD/MN'
          : 'females are day-only (up to C, ends 20:00); never evening/night/midnight',
        note: (dir === 'forward' ? 'forward rotation (morning→evening→night) — easiest on the circadian clock' : 'backward rotation as requested (harder on the body)')
          + (shortDays > 0 && !allowFemaleN ? ' · evening/night short because males alone cannot cover it — enable allowFemaleN (females on N) or cover the gap with OT/cross-skill' : ''),
        restRule: 'a full OFF day after each band block (≤3 consecutive working days; females get exactly 2 OFF/week)',
      },
    };
  }

  /** SCHEDULE-GAP BACKFILL (read-only review; from the 2026-07-04 training). Person-days that carry
   *  NO scheduled shift (OFF / unknown window) yet have a SYSTEM login → the person likely WORKED.
   *  Propose the most-likely shift by nearest canonical START to the login (the login-only method
   *  that won the training: ~77% window-accurate; logout ignored because ~17% of sessions bleed).
   *  NEVER writes; NEVER overrides an explicit shift. Early logins (<05:00) are flagged as a possible
   *  previous-day cross-midnight TAIL rather than a real new shift. */
  @Get('roster-v2/gap-backfill')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Propose the likely shift for person-days with system login but no scheduled shift (flagged, read-only)' })
  async gapBackfill(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string, @Query('function') functionName?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || (range?.b ? `${range.b.slice(0, 7)}-01` : range?.a), dTo = to || range?.b;
    const p: any[] = [t, dFrom, dTo];
    let fnW = '';
    if (functionName) { p.push(functionName); fnW = ` AND canon_fn(COALESCE(role_function,function_name))=canon_fn($${p.length})`; }
    // rows with system evidence but no scheduled window (OFF or unknown). Skip legit non-work markers.
    const rows = await this.ds.query(
      `SELECT person_no, COALESCE(clean_name,name) name, canon_fn(COALESCE(role_function,function_name)) fn,
              work_date::text date, shift_code, presence, gender,
              sys_login_min li, sys_logout_min lo
         FROM roster_days
        WHERE tenant_id=$1 AND is_active AND work_date BETWEEN $2 AND $3
          AND shift_start_min IS NULL AND sys_login_min IS NOT NULL
          AND COALESCE(presence,'') NOT IN ('sick','leave','absent')${fnW}
        ORDER BY work_date DESC, name`, p).catch(() => []);
    // canonical starts (BR-SHF-005), window-deduped — nearest START to the login wins.
    const START: Record<string, number> = { M: 420, B: 540, C: 660, N: 780, E: 960, EE: 1080, MD: 1320, MN: 1380, AM: 420, M20: 480, B20: 600, N20: 840 };
    const codes = Object.entries(START);
    const nearest = (login: number) => {
      let best = 'M', bd = 1e9;
      for (const [code, ss] of codes) { const d = Math.min(Math.abs(ss - login), Math.abs(ss - login - 1440), Math.abs(ss - login + 1440)); if (d < bd) { bd = d; best = code; } }
      return { code: best, off: bd };
    };
    const proposals = rows.map((r: any) => {
      const li = r.li as number;
      const { code, off } = nearest(li);
      // females never propose MD/MN (BR-GEN); fall back to the nearest allowed instead.
      const female = String(r.gender || '').toLowerCase().startsWith('f');
      let proposed = code;
      if (female && (code === 'MD' || code === 'MN')) proposed = li < 300 || li >= 1320 ? 'N' : code;
      const tail = li < 300;   // logged in after midnight → could be yesterday's cross-midnight tail
      const confidence = tail ? 'low' : off <= 45 ? 'high' : off <= 120 ? 'medium' : 'low';
      return { personNo: r.person_no, name: r.name, function: r.fn, date: r.date,
        currentCode: r.shift_code || 'OFF', proposedCode: proposed,
        loginMinutes: li, login: `${String(Math.floor(li / 60)).padStart(2, '0')}:${String(li % 60).padStart(2, '0')}`,
        startGapMin: off, confidence,
        note: tail ? 'login after midnight — may be the previous day\'s cross-midnight shift tail, not a new shift' :
          (r.currentCode === 'OFF' || r.shift_code === 'OFF') ? 'marked OFF but has a system login — likely worked (OFF-day work / schedule error)' : 'no scheduled window but has a system login' };
    });
    const byConf = { high: 0, medium: 0, low: 0 } as any;
    proposals.forEach((x: any) => byConf[x.confidence]++);
    return { from: dFrom, to: dTo, function: functionName || null, total: proposals.length,
      byConfidence: byConf,
      method: 'nearest canonical shift-start to the system login (login-only; logout ignored — bleed). Read-only proposal — never overrides an explicit shift.',
      proposals };
  }

  /** DEMAND-DRIVEN shift-mix generator over the canonical roster (roster_days): measure the
   *  hourly need per function, then greedy set-cover the standard shift windows (real start/end
   *  taken from the data) to cover every hour — and check we have enough active staff. The
   *  "build a schedule that covers all hours" core. Read-only proposal. */
  @Get('roster-v2/generate')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Demand-driven shift-mix that covers the hourly need per function (set-cover)' })
  async generateMix(@Req() req: any, @Query('function') functionName?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const range = (await this.ds.query(`SELECT MIN(work_date)::text a, MAX(work_date)::text b FROM roster_days WHERE tenant_id=$1`, [t]))[0];
    const dFrom = from || range?.a, dTo = to || range?.b;
    // pick the function (busiest if not given); function key is CANONICAL (interns fold to parent)
    let fn = functionName ? functionName.replace(/^\s*[Ii]nternship\s+/, '') : functionName;
    if (!fn) {
      const top = await this.ds.query(`SELECT canon_fn(COALESCE(role_function,function_name)) fn, COUNT(*) n FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND shift_start_min IS NOT NULL AND presence IN ('office','wfh') GROUP BY 1 ORDER BY n DESC LIMIT 1`, [t, dFrom, dTo]);
      fn = top[0]?.fn;
    }
    const p = [t, dFrom, dTo, fn];
    const w = `tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND shift_start_min IS NOT NULL AND canon_fn(COALESCE(role_function,function_name))=canon_fn($4)`;
    const cov = (start: string, len: string) => {
      const a0 = `(((${start})%1440+1440)%1440)`, b0 = `(${a0}+(${len}))`;
      return `((${a0} < h.hh*60+60 AND LEAST(${b0},1440) > h.hh*60) OR (${b0}>1440 AND (${b0}-1440) > h.hh*60))`;
    };
    const [{ days }] = await this.ds.query(`SELECT COUNT(DISTINCT work_date)::int days FROM roster_days WHERE ${w}`, p);
    // 1) DEMAND = avg daily scheduled headcount covering each hour (the need to replicate).
    const dem = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh), r AS (SELECT shift_start_min ss, shift_end_min se FROM roster_days WHERE ${w})
      SELECT h.hh, COUNT(*) FILTER (WHERE ${cov('r.ss', '(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END)')}) sched FROM r CROSS JOIN h GROUP BY h.hh ORDER BY h.hh`, p);
    const demand = Array(24).fill(0); dem.forEach((r: any) => { demand[r.hh] = days ? Math.round(r.sched / days) : 0; });
    // 2) SHIFT DEFINITIONS = the function's real shift windows (mode start/end per code).
    const defs = await this.ds.query(`
      SELECT UPPER(shift_code) code, MODE() WITHIN GROUP (ORDER BY shift_start_min) ss, MODE() WITHIN GROUP (ORDER BY shift_end_min) se, COUNT(*) n
      FROM roster_days WHERE ${w} AND presence IN ('office','wfh')
        AND UPPER(shift_code) !~ '^(OFF|H|L|SL|DL|RES|TER|TRANSFER|COMP|UPL|A)$'
      GROUP BY UPPER(shift_code) HAVING COUNT(*) >= 5 ORDER BY n DESC LIMIT 12`, p);
    const covHours = (ss: number, se: number) => { const a = (((ss % 1440) + 1440) % 1440), e = a + (se <= ss ? se + 1440 - ss : se - ss), out: number[] = []; for (let h = 0; h < 24; h++) { const h0 = h * 60; if ((a < h0 + 60 && Math.min(e, 1440) > h0) || (e > 1440 && e - 1440 > h0)) out.push(h); } return out; };
    const shifts = defs.map((d: any) => ({ code: d.code, ss: d.ss, se: d.se, hrs: covHours(d.ss, d.se), used: d.n }));
    // 3) GREEDY set-cover: add the shift that covers the most still-under-covered demand.
    const assigned = Array(24).fill(0); const mix: Record<string, number> = {}; let guard = 0;
    while (guard++ < 600) {
      let best: any = null, bestGain = 0;
      for (const s of shifts) { const gain = s.hrs.reduce((g: number, h: number) => g + (demand[h] - assigned[h] > 0 ? 1 : 0), 0); if (gain > bestGain) { bestGain = gain; best = s; } }
      if (!best || bestGain <= 0) break;
      mix[best.code] = (mix[best.code] || 0) + 1; best.hrs.forEach((h: number) => assigned[h]++);
    }
    // 4) coverage result + verdict + staff availability
    const coverageByHour = demand.map((d, h) => ({ hour: h, demand: d, covered: assigned[h], gap: assigned[h] - d }));
    const openHours = coverageByHour.filter(c => c.demand > 0);
    const shortHours = openHours.filter(c => c.gap < 0);
    const totalUnits = Object.values(mix).reduce((s, n) => s + n, 0);
    const [{ active }] = await this.ds.query(`SELECT COUNT(DISTINCT person_no)::int active FROM roster_days WHERE ${w}`, p);
    const tFn = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const mixRows = Object.entries(mix).map(([code, count]) => { const s = shifts.find((x: any) => x.code === code); return { code, count, start: tFn(s.ss), end: tFn(s.se % 1440) }; }).sort((a, b) => b.count - a.count);
    const allFns = await this.ds.query(`SELECT DISTINCT canon_fn(COALESCE(role_function,function_name)) fn FROM roster_days WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND shift_start_min IS NOT NULL AND presence IN ('office','wfh') ORDER BY 1`, [t, dFrom, dTo]);
    return {
      from: dFrom, to: dTo, function: fn, functions: allFns.map((r: any) => r.fn).filter(Boolean), days,
      // honest disclosure: "demand" here = the CURRENT schedule's hourly headcount (circular),
      // not an Erlang/workload-derived requirement — the UI must say so.
      basis: 'replicates current schedule (not workload-derived)',
      demand, coverageByHour,
      shiftMix: mixRows, shiftDefs: shifts.map((s: any) => ({ code: s.code, start: tFn(s.ss), end: tFn(s.se % 1440), used: s.used })),
      staffing: { shiftsPerDay: totalUnits, activeStaff: active, needWithOff: Math.ceil(totalUnits * 7 / 6), enough: active >= Math.ceil(totalUnits * 7 / 6) },
      verdict: { coversAllHours: shortHours.length === 0, shortHours: shortHours.map(c => ({ hour: c.hour, demand: c.demand, covered: c.covered, gap: c.gap })), worstGap: openHours.length ? Math.min(...openHours.map(c => c.gap)) : 0 },
    };
  }

  /** PER-EMPLOYEE weekly assignment over the demand mix (the final piece): assign each active
   *  person in the function a WEEKLY shift code + an OFF day so the daily mix is covered, females
   *  never take midnight, night/midnight goes to the LEAST historically-loaded (fair rotation),
   *  and weekend-OFF goes to the most weekend-deprived. Weekly rotation ⇒ ≥10h rest by construction.
   *  Read-only proposal (writing into the editable grid is a separate, confirmed step). */
  @Get('roster-v2/generate-week')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Per-employee weekly shift + OFF assignment covering the demand mix (fair, female-aware)' })
  async generateWeek(@Req() req: any, @Query('function') functionName?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const t = req.user.tenantId;
    const mixData: any = await this.generateMix(req, functionName, from, to);
    const fn = mixData.function, dFrom = mixData.from, dTo = mixData.to;
    // canonical classifier (common/shift-category.ts) collapsed to the 3 buckets this planner needs
    const cat = (code: string) => { const c = shiftCategoryFromCode(code); return c === 'midnight' ? 'midnight' : c === 'night' ? 'night' : 'day'; };

    // active people in the function with gender + historical night/mid load + weekend-off share
    const emps = (await this.ds.query(`
      WITH r AS (SELECT person_no, clean_name, gender, presence, work_date, UPPER(COALESCE(shift_category,shift_code,'')) sc FROM roster_days
                  WHERE tenant_id=$1 AND work_date BETWEEN $2 AND $3 AND is_active AND canon_fn(COALESCE(role_function,function_name))=canon_fn($4))
      SELECT person_no, MAX(clean_name) name, MAX(gender) gender,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh')) wd,
             COUNT(*) FILTER (WHERE presence IN ('office','wfh') AND sc ~ '^(N|MD|MN)') nm,
             COUNT(*) FILTER (WHERE presence='off' AND EXTRACT(DOW FROM work_date) IN (4,5,6)) woff
        FROM r WHERE person_no IS NOT NULL GROUP BY person_no
       HAVING COUNT(*) FILTER (WHERE presence IN ('office','wfh')) >= 1`, [t, dFrom, dTo, fn]))
      .map((e: any) => ({ personNo: e.person_no, name: e.name, male: String(e.gender || '').toLowerCase().startsWith('m'),
        nightLoad: e.wd ? e.nm / e.wd : 0, weekendOff: +e.woff, code: null as string | null, off: null as number[] | null }));

    // order shift codes: fill midnight → night → day (hardest constraint first)
    const order = (c: string) => cat(c) === 'midnight' ? 0 : cat(c) === 'night' ? 1 : 2;
    const codes = [...mixData.shiftMix].sort((a: any, b: any) => order(a.code) - order(b.code));
    const offDays = 2;   // weekly OFF days per person (business rule: 2 OFF / week)
    const need = (count: number) => Math.ceil(count * 7 / (7 - offDays));   // people per code to keep `count` working with `offDays` OFF each
    let pool = emps.slice();
    const groups: any[] = [];
    // Codes a female may NOT be assigned (rule 6.4): E/EE end past midnight and MD/MN are midnight —
    // all end after the female cap of C (20:00). The category 'evening' collapses to 'day' in cat(),
    // so gate by the CODE, not the category, or E/EE would silently leak to females.
    const femaleBlocked = (code: string) => /^(E|MD|MN)/i.test(code);
    for (const m of codes) {
      const c = cat(m.code), want = need(m.count);
      let cands = pool.filter(e => (c === 'midnight' || femaleBlocked(m.code)) ? e.male : true);
      // night/midnight → least-loaded first (fair rotation); day → most-loaded first (relieve them).
      // NIGHT is additionally MALES-FIRST (rule 6.4): a female gets N only once the male pool is exhausted.
      cands.sort((a, b) => (c === 'night' && a.male !== b.male) ? (a.male ? -1 : 1)
        : c === 'day' ? b.nightLoad - a.nightLoad : a.nightLoad - b.nightLoad);
      let take = cands.slice(0, want);
      const femaleNight = c === 'night' ? take.filter(e => !e.male).length : 0;
      take.forEach(e => { e.code = m.code; });
      pool = pool.filter(e => !e.code);
      groups.push({ code: m.code, category: c, perDay: m.count, assigned: take.length, want, femaleNight, members: take });
    }
    // leftover pool → spare (extra OFF / standby)
    const spares = pool.map(e => ({ ...e, code: 'OFF/Spare' }));

    // OFF days: within each group round-robin `offDays` day-slots 0-6 (Sat-based), spaced apart
    // so each day keeps `perDay` working. bias: give weekend (idx 5,6) OFF to the most
    // weekend-deprived in the group first.
    for (const g of groups) {
      const sorted = [...g.members].sort((a, b) => a.weekendOff - b.weekendOff);
      const spacing = Math.floor(7 / offDays);   // 2 OFF → 3 days apart
      sorted.forEach((e, i) => { e.off = Array.from({ length: offDays }, (_, k) => (i + k * spacing) % 7); });
      g.dailyCovered = Array.from({ length: 7 }, (_, d) => g.members.filter((e: any) => !(e.off || []).includes(d)).length);
      g.coversEveryDay = g.dailyCovered.every((n: number) => n >= g.perDay);
    }

    const dayNames = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const assignments = [...groups.flatMap(g => g.members.map((e: any) => ({ personNo: e.personNo, name: e.name, code: e.code, category: g.category, off: (e.off ?? [0]).map((d: number) => dayNames[d]).join('+'), nightLoadPct: Math.round(100 * e.nightLoad) }))),
      ...spares.map(e => ({ personNo: e.personNo, name: e.name, code: 'OFF/Spare', category: 'spare', off: '—', nightLoadPct: Math.round(100 * e.nightLoad) }))]
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

    const peopleNeeded = codes.reduce((s: number, m: any) => s + need(m.count), 0);
    const warnings: string[] = [];
    for (const g of groups) { if (g.assigned < g.want) warnings.push(`${g.code}: need ${g.want}, only ${g.assigned} eligible`); if (!g.coversEveryDay) warnings.push(`${g.code}: OFF buffer too thin — some day drops below ${g.perDay}`); if (g.femaleNight > 0) warnings.push(`${g.code}: ${g.femaleNight} female(s) on N — males were assigned first and the male pool is exhausted (rule 6.4) — flag`); }

    // ── ROSTER HEALTH CHECK (Director 2026-07-03): the generator must never leave the
    //    user blind — prove the assignment covers the demand hour-by-hour BEFORE publish. ──
    const health = await this.computeWeekHealth(t, fn, mixData.demand, mixData.shiftDefs, groups, warnings);

    return {
      from: dFrom, to: dTo, function: fn,
      staffing: { ...mixData.staffing, peopleNeeded, spares: spares.length },
      groups: groups.map(g => ({ code: g.code, category: g.category, perDay: g.perDay, assigned: g.assigned, want: g.want, femaleNight: g.femaleNight, coversEveryDay: g.coversEveryDay, dailyCovered: g.dailyCovered })),
      assignments, spares: spares.map(e => ({ name: e.name })),
      warnings, coversDemand: mixData.verdict.coversAllHours, shiftMix: mixData.shiftMix,
      health,
    };
  }

  /** Post-generation coverage proof: per day × hour Required / Scheduled / Effective
   *  (shrinkage-adjusted from the function's last-28-day reality), status colors,
   *  weekend (Thu+Fri) & night focus, totals and rule-based recommended actions.
   *  Demand basis = mixData.demand (avg hourly HC of the source window — disclosed). */
  private async computeWeekHealth(t: string, fn: string, demand: number[], shiftDefs: any[], groups: any[], warnings: string[]) {
    const toMin = (s: string) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
    // shift windows from the mix's real definitions; cross-midnight when end ≤ start
    const win: Record<string, { ss: number; se: number }> = {};
    for (const d of shiftDefs || []) { const ss = toMin(d.start), seRaw = toMin(d.end); win[d.code] = { ss, se: seRaw <= ss ? seRaw + 1440 : seRaw }; }
    const hoursOf = (ss: number, se: number) => { const a = ((ss % 1440) + 1440) % 1440, e = a + (se - ss), out: number[] = []; for (let h = 0; h < 24; h++) { const h0 = h * 60; if ((a < h0 + 60 && Math.min(e, 1440) > h0) || (e > 1440 && e - 1440 > h0)) out.push(h); } return out; };

    // projected shrinkage = the function's own recent unplanned+planned lost-day rate
    let shrinkRate = 0, shrinkParts = { sick: 0, absent: 0, leave: 0, base: 0 };
    try {
      const [s] = await this.ds.query(`
        SELECT COUNT(*) FILTER (WHERE presence='sick')::int sick, COUNT(*) FILTER (WHERE presence='absent')::int absent,
               COUNT(*) FILTER (WHERE presence='leave')::int leave, COUNT(*) FILTER (WHERE presence <> 'off')::int base
          FROM roster_days WHERE tenant_id=$1 AND canon_fn(COALESCE(role_function,function_name))=canon_fn($2) AND is_active
           AND work_date >= (SELECT MAX(work_date) FROM roster_days WHERE tenant_id=$1) - INTERVAL '27 days'`, [t, fn]);
      shrinkParts = s; shrinkRate = s.base > 0 ? (s.sick + s.absent + s.leave) / s.base : 0;
    } catch { /* projection unavailable → 0, disclosed below */ }

    const dayNames = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const days = dayNames.map((name, di) => {
      const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, required: demand[h] || 0, scheduled: 0, effective: 0, gap: 0, status: 'grey' as string }));
      for (const g of groups) {
        const w = win[g.code]; if (!w) continue;
        const working = g.members.filter((m: any) => !(m.off || []).includes(di)).length;
        for (const h of hoursOf(w.ss, w.se)) hours[h].scheduled += working;
      }
      for (const c of hours) {
        c.effective = Math.round(c.scheduled * (1 - shrinkRate) * 10) / 10;
        c.gap = Math.round((c.effective - c.required) * 10) / 10;
        c.status = c.required === 0 ? (c.scheduled > 0 ? 'blue' : 'grey')
          : c.effective >= c.required * 1.3 ? 'yellow'          // notable overstaffing
          : c.effective >= c.required ? 'green'
          : c.effective >= c.required * 0.85 ? 'yellow' : 'red';
      }
      const open = hours.filter(c => c.required > 0);
      const covered = open.reduce((s, c) => s + Math.min(c.effective, c.required), 0);
      const req = open.reduce((s, c) => s + c.required, 0);
      return { day: name, hours, coveragePct: req ? Math.round(1000 * covered / req) / 10 : 100, red: open.filter(c => c.status === 'red').length, yellow: open.filter(c => c.status === 'yellow').length };
    });

    const all = days.flatMap(d => d.hours.filter(c => c.required > 0));
    const sum = (f: (c: any) => number) => Math.round(all.reduce((s, c) => s + f(c), 0) * 10) / 10;
    const requiredHrs = sum(c => c.required), scheduledHrs = sum(c => c.scheduled), effectiveHrs = sum(c => c.effective);
    const shortageHrs = sum(c => Math.max(0, c.required - c.effective)), surplusHrs = sum(c => Math.max(0, c.effective - c.required));
    const coveragePct = requiredHrs ? Math.round(1000 * sum(c => Math.min(c.effective, c.required)) / requiredHrs) / 10 : 100;
    const critical = all.filter(c => c.status === 'red').length, warning = all.filter(c => c.status === 'yellow').length;
    const nightHrs = all.filter(c => c.hour >= 22 || c.hour < 6);
    const nightCoverage = nightHrs.length ? Math.round(1000 * nightHrs.reduce((s, c) => s + Math.min(c.effective, c.required), 0) / Math.max(1, nightHrs.reduce((s, c) => s + c.required, 0))) / 10 : 100;
    // Sat-start week: [0]=Sat … [5]=Thu [6]=Fri. The weekend is Thu+Fri+Sat, and
    // Saturday was missing here — the recommendation below already NAMED three days
    // while reporting two, so a Saturday that fell to 60% never raised anything.
    const weekend = { thu: days[5].coveragePct, fri: days[6].coveragePct, sat: days[0].coveragePct };

    // rule-based recommended actions — concrete, ranked worst-first
    const recs: string[] = [];
    const worstRed = new Map<number, number>();
    for (const d of days) for (const c of d.hours) if (c.status === 'red') worstRed.set(c.hour, Math.min(worstRed.get(c.hour) ?? 0, c.gap));
    [...worstRed.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5)
      .forEach(([h, gap]) => recs.push(`RED ${String(h).padStart(2, '0')}:00 — short ${Math.abs(gap)} HC: add OT, shift a start time into this hour, or move cross-skilled staff`));
    if (surplusHrs > requiredHrs * 0.15) recs.push(`Overstaffing ${surplusHrs}h vs need — consider trimming the heaviest surplus hours or re-timing shifts`);
    for (const g of groups) if (g.assigned < g.want) recs.push(`${g.code}: ${g.want - g.assigned} more people needed — cross-skill move, hire, or accept the gap with OT`);
    if (shrinkRate > 0.12) recs.push(`Projected shrinkage ${Math.round(shrinkRate * 1000) / 10}% is high — review sick/absence/leave before trusting the effective numbers`);
    if (weekend.thu < 95 || weekend.fri < 95 || weekend.sat < 95)
      recs.push(`Weekend (Thu/Fri/Sat) coverage ${weekend.thu}% / ${weekend.fri}% / ${weekend.sat}% — rebalance weekend OFFs`);

    return {
      basis: 'demand = avg hourly HC of the source window (see generate basis); effective = scheduled × (1 − projected shrinkage)',
      projectedShrinkagePct: Math.round(shrinkRate * 1000) / 10,
      shrinkageParts: shrinkParts,
      totals: { requiredHrs, scheduledHrs, effectiveHrs, shortageHrs, surplusHrs, coveragePct, criticalIntervals: critical, warningIntervals: warning, nightCoveragePct: nightCoverage, weekend },
      days,
      acceptable: critical === 0 && coveragePct >= 95,
      verdictText: critical === 0 && coveragePct >= 95
        ? `ACCEPTABLE — ${coveragePct}% coverage, no red hours`
        : `NEEDS ATTENTION — ${coveragePct}% coverage, ${critical} red interval(s), ${warning} warning(s)`,
      recommendations: recs.length ? recs : ['No action needed — coverage holds across all demand hours'],
      generatorWarnings: warnings,
    };
  }

  private weekDays = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  /** Expand the weekly assignment into a 7-day grid (employee × Sat→Fri → code/OFF). */
  private weekGrid(wk: any) {
    return wk.assignments.map((a: any) => ({
      personNo: a.personNo, name: a.name, code: a.code, category: a.category, off: a.off, nightLoadPct: a.nightLoadPct,
      // off is "Sat+Wed" (2 OFF days per week) — mark every listed day OFF
      days: this.weekDays.map(dn => (String(a.off || '').split('+').includes(dn) || a.code === 'OFF/Spare') ? 'OFF' : a.code),
    }));
  }

  /** SAVE the generated weekly roster as a reviewable DRAFT (held outside the live grid). */
  @Post('roster-v2/generate-week/save')
  @RequirePermissions('schedule.publish')
  @ApiOperation({ summary: 'Save the demand-driven weekly roster as a reviewable draft' })
  async saveWeekDraft(@Req() req: any, @Body() body: { function?: string; from?: string; to?: string; weekStart?: string; label?: string }) {
    const t = req.user.tenantId;
    const wk: any = await this.generateWeek(req, body?.function, body?.from, body?.to);
    const grid = this.weekGrid(wk);
    // default week-start = the Saturday AFTER the data horizon (a fresh future week).
    let weekStart = body?.weekStart;
    if (!weekStart) {
      const [{ mx }] = await this.ds.query(`SELECT MAX(work_date)::text mx FROM roster_days WHERE tenant_id=$1`, [t]);
      const dt = new Date(`${mx}T00:00:00Z`); let add = (6 - dt.getUTCDay() + 7) % 7; if (add === 0) add = 7;
      dt.setUTCDate(dt.getUTCDate() + add); weekStart = dt.toISOString().slice(0, 10);
    }
    const label = body?.label || `${wk.function} · ${weekStart}`;
    const payload = { weekStart, function: wk.function, days: this.weekDays, mix: wk.shiftMix, staffing: wk.staffing, warnings: wk.warnings, grid, health: wk.health };
    const [row] = await this.ds.query(
      `INSERT INTO schedule_drafts(tenant_id, function, week_start, label, payload, created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
      [t, wk.function, weekStart, label, JSON.stringify(payload), req.user.sub || null]);
    return { ok: true, id: row.id, weekStart, label, function: wk.function, days: this.weekDays, grid, staffing: wk.staffing, warnings: wk.warnings, mix: wk.shiftMix, health: wk.health };
  }

  /** List recent saved roster drafts. */
  @Get('roster-v2/drafts')
  @RequirePermissions('attendance.view_team')
  async listDrafts(@Req() req: any) {
    const drafts = await this.ds.query(`SELECT id, function, week_start::text "weekStart", label, created_at FROM schedule_drafts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.user.tenantId]);
    return { drafts };
  }

  /** Fetch one saved draft (the full week grid) by id. */
  @Get('roster-v2/draft')
  @RequirePermissions('attendance.view_team')
  async getDraft(@Req() req: any, @Query('id') id: string) {
    if (!id) throw new BadRequestException('id required');
    const [row] = await this.ds.query(`SELECT id, function, week_start::text "weekStart", label, payload, created_at FROM schedule_drafts WHERE tenant_id=$1 AND id=$2`, [req.user.tenantId, id]);
    if (!row) throw new NotFoundException('draft not found');
    return { id: row.id, ...row.payload, label: row.label, createdAt: row.created_at };
  }

  /** PUBLISH the generated weekly roster into the live editable grid (attendance_records).
   *  SAFE BY DESIGN: targets an EMPTY future week by default (the Saturday after the last existing
   *  schedule), and uses ON CONFLICT DO NOTHING so it NEVER overwrites an existing schedule — it only
   *  fills empty employee×date cells. Rows are tagged in `notes` so unpublish can cleanly remove them. */
  @Post('roster-v2/publish')
  @RequirePermissions('schedule.publish')
  @ApiOperation({ summary: 'Publish the generated weekly roster into attendance_records (empty week, non-overwriting)' })
  async publishWeek(@Req() req: any, @Body() body: { function?: string; from?: string; to?: string; weekStart?: string }) {
    const t = req.user.tenantId;
    const wk: any = await this.generateWeek(req, body?.function, body?.from, body?.to);
    let weekStart = body?.weekStart;
    if (!weekStart) {
      const [{ mx }] = await this.ds.query(`SELECT MAX(attendance_date)::text mx FROM attendance_records WHERE tenant_id=$1`, [t]);
      const dt = new Date(`${mx || kwToday()}T00:00:00Z`); let add = (6 - dt.getUTCDay() + 7) % 7; if (add === 0) add = 7;
      dt.setUTCDate(dt.getUTCDate() + add); weekStart = dt.toISOString().slice(0, 10);
    }
    // resolve canonical person_no → employees.id, and shift code → shift_codes (id/start/end)
    const persons = [...new Set(wk.assignments.map((a: any) => a.personNo).filter(Boolean))] as string[];
    const empMap: Record<string, string> = {};
    (await this.ds.query(`SELECT employee_no, id FROM employees WHERE tenant_id=$1 AND employee_no = ANY($2)`, [t, persons])).forEach((r: any) => { empMap[r.employee_no] = r.id; });
    const codes = [...new Set(wk.assignments.map((a: any) => a.code).filter((c: string) => c && c !== 'OFF/Spare'))] as string[];
    const scMap: Record<string, any> = {};
    (await this.ds.query(`SELECT UPPER(code) code, id, start_time ss, end_time se FROM shift_codes WHERE tenant_id=$1 AND UPPER(code)=ANY($2)`, [t, codes.map((c: string) => c.toUpperCase())])).forEach((r: any) => { scMap[r.code] = r; });
    const note = `[generated ${weekStart}]`;
    const addDays = (iso: string, n: number) => { const dd = new Date(`${iso}T00:00:00Z`); dd.setUTCDate(dd.getUTCDate() + n); return dd.toISOString().slice(0, 10); };
    const rows: any[][] = []; let noEmp = 0;
    for (const a of wk.assignments) {
      const eid = empMap[a.personNo]; if (!eid) { noEmp++; continue; }
      for (let dI = 0; dI < 7; dI++) {
        const off = String(a.off || '').split('+').includes(this.weekDays[dI]) || a.code === 'OFF/Spare';
        const sc = off ? null : scMap[String(a.code).toUpperCase()];
        rows.push([t, eid, addDays(weekStart, dI), sc?.id || null, sc?.ss || null, sc?.se || null, off ? 'off' : 'present', note]);
      }
    }
    let written = 0;
    if (rows.length) {
      const C = 8;
      const values = rows.map((_, i) => `($${i * C + 1},$${i * C + 2},$${i * C + 3},$${i * C + 4},$${i * C + 5},$${i * C + 6},$${i * C + 7},false,$${i * C + 8})`).join(',');
      const res = await this.ds.query(
        `INSERT INTO attendance_records (tenant_id, employee_id, attendance_date, scheduled_shift_code_id, scheduled_start, scheduled_end, attendance_marker, is_wfh, notes)
         VALUES ${values} ON CONFLICT (tenant_id, employee_id, attendance_date) DO NOTHING RETURNING employee_id`, rows.flat());
      // TypeORM .query() returns the RETURNING rows array — its length = rows actually inserted (ON CONFLICT skips don't return).
      written = Array.isArray(res) ? res.length : (res?.rowCount || 0);
    }
    const skipped = rows.length - written;
    return { ok: true, weekStart, function: wk.function, written, skipped, unmappedPeople: noEmp, note,
      message: skipped > 0 ? `${skipped} cell(s) already had a schedule and were preserved (not overwritten).` : (written ? `published ${written} cells into week ${weekStart}.` : 'nothing to publish.') };
  }

  /** SCHEDULE QUALITY (Stage 2A) — grade an EXISTING saved/published window the same way the
   *  generate verdict grades a preview: coverage vs the observed 28-day baseline, fairness
   *  (the classic engine's calcFairness — the ONE scoring), rule compliance (female-night,
   *  rest≥10h, 2-OFF/week, ≤6 consecutive) recounted from real roster_days schedule rows, and
   *  the shift-mix distribution. Verified data only; read-only. Default window = the last
   *  COMPLETE Sat→Fri week inside the data. */
  @Get('roster-v2/schedule-quality')
  @RequirePermissions('attendance.view_team')
  @ApiOperation({ summary: 'Grade a saved/published schedule window: coverage, fairness, rule compliance, shift mix (read-only)' })
  async scheduleQuality(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('function') functionName?: string,
  ) {
    const t = req.user.tenantId;
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    let dFrom = ISO.test(from ?? '') ? from! : undefined;
    let dTo = ISO.test(to ?? '') ? to! : undefined;
    if (!dFrom || !dTo) {
      const [{ mx }] = await this.ds.query(
        `SELECT MAX(work_date)::text mx FROM roster_days WHERE tenant_id=$1 AND is_active`, [t]);
      if (!mx) throw new BadRequestException('No roster data available.');
      // last complete Sat→Fri week ≤ the data frontier
      const d = new Date(mx + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 5 + 7) % 7));   // most recent Friday ≤ mx
      dTo = dTo ?? d.toISOString().slice(0, 10);
      const f = new Date(dTo + 'T00:00:00Z');
      f.setUTCDate(f.getUTCDate() - 6);
      dFrom = dFrom ?? f.toISOString().slice(0, 10);
    }
    if (dFrom > dTo) throw new BadRequestException('from must be ≤ to');
    const span = Math.round((Date.parse(dTo) - Date.parse(dFrom)) / 86400e3) + 1;
    if (span > 35) throw new BadRequestException('window too large — max 35 days');
    const dates: string[] = [];
    { const d = new Date(dFrom + 'T00:00:00Z'); for (let i = 0; i < span; i++) { dates.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } }

    const p: any[] = [t, dFrom, dTo];
    let fnW = '';
    if (functionName) { p.push(functionName.replace(/^\s*[Ii]nternship\s+/, '')); fnW = ` AND canon_fn(COALESCE(role_function,function_name))=canon_fn($${p.length})`; }

    // The window's schedule rows — canonical roster spine, deduped via is_active.
    const catExpr = shiftCategoryCaseSql('shift_category,shift_code');
    const rows: QualityRow[] = await this.ds.query(
      `SELECT person_no AS "personNo", COALESCE(clean_name,name) AS name,
              LOWER(COALESCE(gender,'')) AS gender,
              canon_fn(COALESCE(role_function,function_name)) AS fn,
              work_date::text AS date, shift_code AS code, ${catExpr} AS category,
              shift_start_min AS ss, shift_end_min AS se, presence
         FROM roster_days
        WHERE tenant_id=$1 AND is_active AND work_date BETWEEN $2 AND $3
          AND person_no IS NOT NULL${fnW}
        ORDER BY person_no, work_date`, p);
    if (!rows.length) {
      return { window: { from: dFrom, to: dTo, days: span }, people: 0, score: null,
        error: 'no schedule rows in this window' };
    }

    // Observed baseline: avg scheduled HC per fn × hour over the 28 days BEFORE the
    // window (same basis as the generator's hourly health — disclosed, not Erlang).
    const bp: any[] = [t, dFrom];
    let bFnW = '';
    if (functionName) { bp.push(functionName.replace(/^\s*[Ii]nternship\s+/, '')); bFnW = ` AND canon_fn(COALESCE(role_function,function_name))=canon_fn($${bp.length})`; }
    const baseRows = await this.ds.query(`
      WITH h AS (SELECT generate_series(0,23) hh),
      r AS (SELECT canon_fn(COALESCE(role_function,function_name)) fn, shift_start_min ss, shift_end_min se
              FROM roster_days
             WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL
               AND work_date >= ($2::date - 28) AND work_date < $2::date${bFnW}),
      d AS (SELECT GREATEST(COUNT(DISTINCT work_date),1)::int n FROM roster_days
             WHERE tenant_id=$1 AND is_active AND shift_start_min IS NOT NULL
               AND work_date >= ($2::date - 28) AND work_date < $2::date)
      SELECT r.fn, h.hh AS "hour",
        (COUNT(*) FILTER (WHERE ((r.ss%1440+1440)%1440) < h.hh*60+60
             AND LEAST(((r.ss%1440+1440)%1440)+(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END),1440) > h.hh*60
             OR ((((r.ss%1440+1440)%1440)+(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END))>1440
                 AND ((((r.ss%1440+1440)%1440)+(CASE WHEN r.se<=r.ss THEN r.se+1440-r.ss ELSE r.se-r.ss END))-1440) > h.hh*60)))::float
          / (SELECT n FROM d) AS baseline
      FROM r CROSS JOIN h GROUP BY r.fn, h.hh`, bp).catch(() => []);
    const baseline: Record<string, number[]> = {};
    for (const b of baseRows) {
      if (!baseline[b.fn]) baseline[b.fn] = new Array(24).fill(0);
      baseline[b.fn][b.hour] = +(+b.baseline || 0);
    }

    const quality = scoreScheduleQuality({
      rows, dates,
      minRestHours: 10, offDaysPerWeek: 2,     // business rules 6.6 / weekly OFF allowance
      baseline: Object.keys(baseline).length ? baseline : null,
    });
    return { function: functionName ?? null, ...quality };
  }

  /** Reverse a publish: delete ONLY the generated rows for a week (tagged in notes). Safe. */
  @Post('roster-v2/unpublish')
  @RequirePermissions('schedule.publish')
  @ApiOperation({ summary: 'Remove the generated rows for a week (only rows this engine wrote)' })
  async unpublishWeek(@Req() req: any, @Body() body: { weekStart: string }) {
    if (!body?.weekStart) throw new BadRequestException('weekStart required');
    const t = req.user.tenantId;
    // approved/soft-locked weeks are IMMUTABLE to unpublish — no override, because this deletes
    // rows wholesale; the only way to change the approved range is re-uploading the schedule
    // (same soft-lock as assertScheduleEditable, but with the supervisor bypass removed).
    const lock = await this.shared.getScheduleLock(t);
    const we = new Date(`${body.weekStart}T00:00:00Z`); we.setUTCDate(we.getUTCDate() + 6);
    const weekEnd = we.toISOString().slice(0, 10);
    if (lock && body.weekStart <= lock.to && weekEnd >= lock.from) {
      throw new ForbiddenException(`Week ${body.weekStart} overlaps the approved/locked schedule range (${lock.from} → ${lock.to}) — unpublish is not allowed; re-upload the schedule to change it.`);
    }
    const r = await this.ds.query(
      `DELETE FROM attendance_records WHERE tenant_id=$1 AND attendance_date BETWEEN $2::date AND ($2::date + 6) AND notes LIKE '[generated %' RETURNING employee_id`,
      [t, body.weekStart]);
    // TypeORM returns DELETE..RETURNING as a [rows[], affectedCount] tuple — read the count off whichever shape we got.
    const deleted = Array.isArray(r)
      ? (typeof r[1] === 'number' ? r[1] : (Array.isArray(r[0]) ? r[0].length : r.length))
      : (r?.rowCount || 0);
    await this.ds.query(
      `INSERT INTO audit_logs (tenant_id, actor_id, actor_email, action, module, entity_type, new_value, notes)
       VALUES ($1,$2,$3,'schedule.unpublish','attendance-recon','schedule_week',$4::jsonb,$5)`,
      [t, req.user.id || req.user.sub || null, req.user.email || null,
       JSON.stringify({ weekStart: body.weekStart, deleted }),
       `Removed ${deleted} generated row(s) for week ${body.weekStart}`]).catch(() => {});
    return { ok: true, deleted };
  }
}
