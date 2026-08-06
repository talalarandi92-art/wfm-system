/**
 * DEMAND-DRIVEN SCHEDULE ENGINE — THE generator (behavioral merge approved by
 * the Director 2026-07-08): the classic engine's weekend-fair OFF structure and
 * rotation-band fairness are grafted in as options (offStrategy /
 * rotationFairness); the demand basis, per-function allocation and honest gaps
 * stay primary. Two-phase approach used by enterprise WFM (NICE IEX, Verint,
 * Calabrio):
 *
 *   Phase 1 — SHIFT-MIX OPTIMIZATION (greedy weighted set-cover):
 *     Given a required-HC curve (48 × 30-min intervals) and the shift catalog,
 *     decide HOW MANY of each shift code each day needs so the staffed curve
 *     hugs the requirement curve with minimal overstaffing.
 *
 *   Phase 2 — ROSTER ASSIGNMENT (constraint-based, fairness-weighted):
 *     Fill the mix with real employees honoring: gender rules (female MD/N2
 *     blocked, N warn-only), min rest hours between shifts (cross-midnight
 *     aware), max consecutive working days, OFF placement on low-demand days,
 *     YTD + intra-week fairness (whoever has the least of a category gets it).
 *
 *   Unfillable slots are NEVER hidden — they come back as coverage gaps with
 *   the blocking reason (per project rule: show gaps honestly).
 */

import { ShiftDef, SHIFTS, EmployeeInfo, ShiftDistribution, allowedShiftCodes, femaleLateAllowed } from './generator.types';
import { calcRestHours, assignOffDays, ROTATION_NEXT } from './generator.engine';

/* ── Interval helpers ─────────────────────────────────────────────────────── */

const SLOT_MIN = 30;
const SLOTS = 48;

function timeToSlot(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return Math.floor((h * 60 + m) / SLOT_MIN);
}

/** Slots covered by a shift on its OWN day (cross-midnight tail spills to next day). */
export function shiftSlots(shift: ShiftDef): { today: number[]; tomorrow: number[] } {
  if (!shift.start || !shift.end) return { today: [], tomorrow: [] };
  const s = timeToSlot(shift.start);
  const e = timeToSlot(shift.end);
  const today: number[] = [];
  const tomorrow: number[] = [];
  if (e > s) {
    for (let i = s; i < e; i++) today.push(i);
  } else {
    for (let i = s; i < SLOTS; i++) today.push(i);
    for (let i = 0; i < e; i++) tomorrow.push(i);
  }
  return { today, tomorrow };
}

/* ── Phase 1: shift mix ───────────────────────────────────────────────────── */

export interface ShiftMixDay {
  date: string;
  mix: Record<string, number>;            // shift code → count
  staffedCurve: number[];                 // 48 — what the mix delivers (same-day slots)
  requiredCurve: number[];                // 48 — input requirement
  residualGaps: { interval: string; deficit: number }[]; // honest uncovered demand
}

const WORKING_CODES = ['M', 'B', 'C', 'E', 'EE', 'N', 'MD', 'MN']; // catalog working shifts

// SHIFTS is keyed by catalog KEY (e.g. N2), not by shift CODE (EE) — resolve by code.
const SHIFT_BY_CODE: Record<string, ShiftDef> =
  Object.fromEntries(Object.values(SHIFTS).map(s => [s.code, s]));

export function computeShiftMix(
  date: string,
  required: number[],          // 48 ints
  maxStaffPerDay: number,      // pool ceiling — never plan more bodies than exist
): ShiftMixDay {
  const deficit = [...required];
  const staffed = new Array(SLOTS).fill(0);
  const mix: Record<string, number> = {};
  let placed = 0;

  const apply = (code: string, dir: 1 | -1) => {
    for (const i of shiftSlots(SHIFT_BY_CODE[code]).today) {
      deficit[i] -= dir;
      staffed[i] += dir;
    }
    mix[code] = (mix[code] ?? 0) + dir;
    if (mix[code] <= 0) delete mix[code];
    placed += dir;
  };
  const totalDeficit = (d: number[]) => d.reduce((s, x) => s + Math.max(0, x), 0);
  const maxDeficit = (d: number[]) => Math.max(0, ...d);

  // Greedy: repeatedly add the one shift that erases the most remaining deficit.
  // Tie-break toward shifts covering the single worst interval.
  const greedyFill = () => {
    while (placed < maxStaffPerDay) {
      let best: { code: string; reduction: number; coversPeak: boolean } | null = null;
      const peakIdx = deficit.indexOf(Math.max(...deficit));
      for (const code of WORKING_CODES) {
        const slots = shiftSlots(SHIFT_BY_CODE[code]).today;
        const reduction = slots.reduce((s, i) => s + Math.max(0, Math.min(1, deficit[i])), 0);
        if (reduction <= 0) continue;
        const coversPeak = slots.includes(peakIdx);
        if (!best
            || reduction > best.reduction + 1e-9
            || (Math.abs(reduction - best.reduction) < 1e-9 && coversPeak && !best.coversPeak)) {
          best = { code, reduction, coversPeak };
        }
      }
      if (!best) break; // nothing reduces deficit anymore
      apply(best.code, 1);
    }
  };

  greedyFill();

  // ── Edge-patch pass. The greedy favors mid-day-heavy shifts (B/C cover the most
  // deficit slots), which can (a) strand window-open/close edges — 08:00 is coverable
  // ONLY by M, 18–20 only by C/N/EE — and (b) place redundant shifts (5 bodies where
  // 4 cover). Local improvement fixes both without touching feasible plans:
  //   1. drop any shift whose every covered slot is already in surplus,
  //   2. 1-for-1 swaps that strictly reduce the total residual deficit
  //      (tie-break: reduce the single worst interval — the −2-at-08:00 case),
  //   3. re-run the greedy with the freed ceiling.
  // Every step strictly improves (total, worst) or reduces bodies → terminates.
  for (let guard = 0; guard < 16; guard++) {
    let changed = false;
    for (const code of Object.keys(mix)) {
      while ((mix[code] ?? 0) > 0
             && shiftSlots(SHIFT_BY_CODE[code]).today.every(i => deficit[i] < 0)) {
        apply(code, -1);
        changed = true;
      }
    }
    for (let swaps = 0; swaps < 64; swaps++) {
      const t0 = totalDeficit(deficit), m0 = maxDeficit(deficit);
      if (t0 <= 0) break;
      let best: { from: string; to: string; t: number; m: number } | null = null;
      for (const from of Object.keys(mix)) {
        for (const to of WORKING_CODES) {
          if (to === from) continue;
          const d2 = [...deficit];
          for (const i of shiftSlots(SHIFT_BY_CODE[from]).today) d2[i] += 1;
          for (const i of shiftSlots(SHIFT_BY_CODE[to]).today) d2[i] -= 1;
          const t = totalDeficit(d2), m = maxDeficit(d2);
          const improves = t < t0 || (t === t0 && m < m0);
          if (improves && (!best || t < best.t || (t === best.t && m < best.m))) {
            best = { from, to, t, m };
          }
        }
      }
      if (!best) break;
      apply(best.from, -1);
      apply(best.to, 1);
      changed = true;
    }
    const before = placed;
    greedyFill();
    if (!changed && placed === before) break;
  }

  const residualGaps = deficit
    .map((d, i) => ({ d, i }))
    .filter(x => x.d > 0.5)
    .map(x => ({
      interval: `${String(Math.floor(x.i / 2)).padStart(2, '0')}:${x.i % 2 ? '30' : '00'}`,
      deficit: Math.ceil(x.d),
    }));

  return { date, mix, staffedCurve: staffed, requiredCurve: required, residualGaps };
}

/* ── Phase 2: roster assignment ───────────────────────────────────────────── */

export interface DemandAssignment {
  employeeId: string;
  date: string;
  code: string;                 // shift code, OFF, or L (approved leave)
  overstaff?: boolean;          // working shift assigned beyond demand (OFF allowance exhausted)
}

export interface DemandRosterResult {
  assignments: DemandAssignment[];
  unfilled: { date: string; code: string; reason: string }[];
  warnings: string[];           // e.g. female assigned N out of necessity
}

const CATEGORY_OF: Record<string, keyof Pick<ShiftDistribution, 'morning' | 'afternoon' | 'evening' | 'night' | 'midnight'>> = {
  M: 'morning', B: 'morning', C: 'afternoon', E: 'evening', EE: 'evening', N: 'night', MD: 'midnight', MN: 'midnight',
};

export function assignRoster(
  dates: string[],
  mixByDate: Map<string, Record<string, number>>,
  employees: EmployeeInfo[],
  ytdDist: Map<string, ShiftDistribution>,
  lastShiftBeforeWeek: Map<string, ShiftDef>,
  priorConsecutive: Map<string, number>,
  opts: {
    minRestHours: number; offDaysPerWeek: number; maxConsecutive?: number;
    /** Female-late (N) exception — same two switches the classic engine takes,
     *  so both paths answer the question identically. See femaleLateAllowed. */
    allowFemaleN?: boolean;
    femaleLateFunctionIds?: string[];
    /** empId → dates with APPROVED leave — assigned 'L', excluded from staffing */
    onLeave?: Map<string, Set<string>>;
    /**
     * OFF placement (behavioral merge, Director-approved 2026-07-08):
     *   'lowest-demand' (default) — OFFs land on the days whose mix asks for the
     *     fewest bodies, staggered by a 35%/day cap (max coverage strategy).
     *   'weekend-fair' — the classic engine's structure: ONE weekend OFF (Thu/Fri)
     *     + one mid-week OFF, weekend slot rationed by YTD weekend-OFF fairness.
     */
    offStrategy?: 'lowest-demand' | 'weekend-fair';
    /**
     * Classic rotation-band fairness (behavioral merge): each employee gets a weekly
     * target band from last week's category (night→afternoon→morning→midnight→night;
     * females rotate morning↔afternoon only) and, among equally-fair candidates,
     * band-matching employees are preferred — weekly consistency without ever
     * overriding gender/rest/function rules or the least-share fairness order.
     */
    rotationFairness?: boolean;
  },
): DemandRosterResult {
  const MAX_CONSEC = opts.maxConsecutive ?? 6;
  const assignments: DemandAssignment[] = [];
  const unfilled: DemandRosterResult['unfilled'] = [];
  const warnings: string[] = [];

  // Per-employee running state
  const prevShift = new Map<string, ShiftDef | null>(
    employees.map(e => [e.id, lastShiftBeforeWeek.get(e.id) ?? null]));
  const consec = new Map<string, number>(
    employees.map(e => [e.id, priorConsecutive.get(e.id) ?? 0]));
  const weekCount = new Map<string, Record<string, number>>(
    employees.map(e => [e.id, { morning: 0, afternoon: 0, evening: 0, night: 0, midnight: 0 }]));
  // Specific-CODE counts. Category fairness (morning/night/…) alone CANNOT rotate people across
  // the shifts WITHIN a category — so an employee locked to one category (e.g. a female confined to
  // day: M/B/C are all 'morning') ties on category-share every day and freezes on one code forever.
  // Tracking per-code counts lets us break that tie by rotating M→B→C (the fairness the manual
  // roster had: women averaged 5.4 distinct shifts; the category-only engine gave them 1.4).
  const codeCount = new Map<string, Record<string, number>>(employees.map(e => [e.id, {}]));
  const totalOf = (id: string) => { const w = weekCount.get(id)!; return w.morning + w.afternoon + w.evening + w.night + w.midnight; };
  const offUsed = new Map<string, number>(employees.map(e => [e.id, 0]));
  const offToday = new Map<string, Set<string>>(); // date → employee ids OFF

  // ── OFF planning — two Director-tested strategies (behavioral merge):
  //    default 'lowest-demand' places OFFs where the mix asks for the fewest bodies;
  //    'weekend-fair' grafts the classic structure (one weekend + one mid-week OFF,
  //    weekend slot rationed by YTD weekend-OFF fairness) via the SAME assignOffDays
  //    the classic engine uses. Streak repair below applies to both.
  for (const date of dates) offToday.set(date, new Set());
  const plannedOff = new Map<string, Set<string>>();

  // Per-day OFF ceiling = the even share of the weekly allowance across the week.
  // Guarantees a coverage floor of (n − dayCap) working EVERY day, and since
  // 7·dayCap ≥ 2n the pool always fits, so everyone still gets exactly the allowance.
  const dayCap = Math.max(1, Math.ceil(employees.length * opts.offDaysPerWeek / Math.max(dates.length, 1)));

  if (opts.offStrategy === 'weekend-fair') {
    const offMap = assignOffDays(employees, dates, opts.offDaysPerWeek, priorConsecutive, ytdDist, dates[0]);
    for (const emp of employees) {
      const mine = new Set<string>(offMap.get(emp.id) ?? []);
      plannedOff.set(emp.id, mine);
      for (const d of mine) offToday.get(d)!.add(emp.id);
    }
  } else {
    // BALANCED, coverage-safe placement (fixes the per-function OFF-concentration
    // bug, 2026-07-08 — a whole small function landing OFF on one day = zero cover).
    // Each person's OFFs go on the LEAST-LOADED days (lower demand only as a
    // tiebreak), capped at dayCap so no single day ever loses > dayCap people →
    // a guaranteed coverage floor of (n − dayCap) working EVERY day. Capacity
    // (7·dayCap ≥ 2n) always suffices, so everyone still gets exactly the allowance.
    const demandOf = new Map(dates.map(d => {
      const m = mixByDate.get(d) ?? {};
      return [d, Object.values(m).reduce((a, b) => a + b, 0)] as [string, number];
    }));
    for (const emp of employees) {
      let need = opts.offDaysPerWeek;
      const mine = new Set<string>();
      while (need > 0) {
        const cand = dates
          .filter(d => !mine.has(d) && offToday.get(d)!.size < dayCap)
          .sort((a, b) => (offToday.get(a)!.size - offToday.get(b)!.size) || (demandOf.get(a)! - demandOf.get(b)!));
        if (!cand.length) break;                 // no capacity (rare) → left to the day loop
        const d = cand[0];
        offToday.get(d)!.add(emp.id); mine.add(d); need--;
      }
      plannedOff.set(emp.id, mine);
    }
  }

  // ── Streak repair (COVERAGE-SAFE) — no working run > MAX_CONSEC, OFF total stays
  //    = allowance, and the break lands on the LEAST-LOADED legal day (under dayCap
  //    where possible) so breaking a shared streak can't dump the whole function OFF
  //    on one breach date (the 2026-07-08 concentration bug). Re-scans to a fixpoint;
  //    bounded by the week length.
  for (const emp of employees) {
    const mine = plannedOff.get(emp.id)!;
    for (let guard = 0; guard < dates.length; guard++) {
      // first day where the running streak (incl. prior-week consec) exceeds MAX_CONSEC
      let c = consec.get(emp.id) ?? 0, breachIdx = -1, streakStart = 0;
      for (let di = 0; di < dates.length; di++) {
        if (mine.has(dates[di])) { c = 0; streakStart = di + 1; continue; }
        c++;
        if (c > MAX_CONSEC) { breachIdx = di; break; }
      }
      if (breachIdx < 0) break;                  // no violation
      // candidate break days = working days of THIS streak; prefer under-cap then least-loaded
      const lo = Math.max(streakStart, breachIdx - MAX_CONSEC + 1);
      let best = -1, bestScore = Infinity;
      for (let k = lo; k <= breachIdx; k++) {
        if (mine.has(dates[k])) continue;
        const load = offToday.get(dates[k])!.size;
        const score = (load < dayCap ? 0 : 100000) + load;   // under-cap wins, then least-loaded
        if (score < bestScore) { bestScore = score; best = k; }
      }
      const breakDate = best >= 0 ? dates[best] : dates[breachIdx];
      // keep total = allowance: free a LATER planned OFF if one exists (else it's a
      // legal extra forced-rest OFF — genuinely unavoidable, rare)
      const later = dates.filter(d => mine.has(d) && d > breakDate).pop();
      if (later) { offToday.get(later)!.delete(emp.id); mine.delete(later); }
      offToday.get(breakDate)!.add(emp.id); mine.add(breakDate);
    }
  }

  // ── Rotation-band targets (classic graft, opts.rotationFairness) ──
  const targetBand = new Map<string, string>();
  if (opts.rotationFairness) {
    employees.forEach((e, idx) => {
      const last = lastShiftBeforeWeek.get(e.id);
      let band = last && last.code !== 'OFF'
        ? (ROTATION_NEXT[last.category] ?? 'morning')
        : ['morning', 'afternoon', 'night', 'midnight'][idx % 4];   // no history → spread by position
      if (e.gender === 'female') {
        // Same female rotation guard as the classic engine: rotate only through the
        // bands she may actually work (morning↔afternoon) — never a blocked band.
        const bands = ['morning', 'afternoon'];
        if (!bands.includes(band)) {
          const prev = last?.category && bands.includes(last.category) ? last.category : 'afternoon';
          band = bands[(bands.indexOf(prev) + 1) % bands.length];
        }
      }
      targetBand.set(e.id, band);
    });
  }

  // ── Day-by-day assignment, hardest shifts first (midnights → cross-midnight evenings → …)
  const HARD_ORDER = ['MD', 'MN', 'EE', 'E', 'N', 'C', 'B', 'M'];

  for (const date of dates) {
    const mix = { ...(mixByDate.get(date) ?? {}) };
    const assignedToday = new Set<string>(offToday.get(date));
    // Coverage floor: at most dayCap people go OFF on this date for this (per-function)
    // pool, so a low-demand day can never take the whole team dark — surplus beyond
    // the floor WORKS (labeled overstaffing), the same guard weekend-fair already uses.
    let offCountToday = 0;

    // Approved leave first — these people are NOT available, full stop
    for (const emp of employees) {
      if (opts.onLeave?.get(emp.id)?.has(date) && !assignedToday.has(emp.id)) {
        assignments.push({ employeeId: emp.id, date, code: 'L' });
        assignedToday.add(emp.id);
        consec.set(emp.id, 0);
        prevShift.set(emp.id, SHIFTS.OFF);
      }
    }

    // Register OFF assignments — but NEVER over the weekly allowance: if an employee
    // already burned it (e.g. an early surplus OFF), release this planned slot so the
    // day loop assigns them work instead. Forced-rest (at MAX_CONSEC) stays legal.
    for (const id of [...offToday.get(date)!]) {
      if (opts.onLeave?.get(id)?.has(date)) continue; // leave already covers the day
      // Release a planned OFF (→ the day loop works this person) when EITHER the
      // person already burned the weekly allowance OR — in the DEFAULT strategy —
      // this date already has dayCap people OFF (coverage floor). Forced-rest
      // (MAX_CONSEC) always stays OFF. weekend-fair is EXCLUDED from the floor: it
      // makes surplus WORK, so a released OFF there can't be recovered (would drop
      // the person to 1 OFF) — its structure keeps exactly-2-OFF and a tiny team
      // thinning one weekend day is that opt-in strategy's known, accepted tradeoff.
      const floorReleasable = offCountToday >= dayCap && opts.offStrategy !== 'weekend-fair';
      if (((offUsed.get(id) ?? 0) >= opts.offDaysPerWeek || floorReleasable) && (consec.get(id) ?? 0) < MAX_CONSEC) {
        offToday.get(date)!.delete(id);
        assignedToday.delete(id);
        continue;
      }
      assignments.push({ employeeId: id, date, code: 'OFF' });
      consec.set(id, 0);
      prevShift.set(id, SHIFTS.OFF);
      offUsed.set(id, (offUsed.get(id) ?? 0) + 1);
      offCountToday++;
    }

    for (const code of HARD_ORDER) {
      let count = mix[code] ?? 0;
      const shift = SHIFT_BY_CODE[code];
      const cat = CATEGORY_OF[code];

      while (count > 0) {
        // Eligible pool
        const eligible = employees.filter(e => {
          if (assignedToday.has(e.id)) return false;
          if ((consec.get(e.id) ?? 0) >= MAX_CONSEC) return false;
          if (e.gender === 'female' && shift.femaleRule === 'blocked') return false;
          // Per-function operating hours (same policy the classic engine enforces)
          const allowed = allowedShiftCodes(e.functionName);
          if (allowed && !allowed.has(code)) return false;
          const rest = calcRestHours(prevShift.get(e.id) ?? null, shift);
          if (rest !== null && rest < opts.minRestHours) return false;
          return true;
        });

        // Female-N only as a true last resort (business rule 6.4) — EXCEPT where
        // the exception applies (OMT's window runs to 22:00 and the team is all
        // female): there N is ordinary work, so those women are not pushed to the
        // back of the queue and not warned about below.
        const males = eligible.filter(e =>
          !(e.gender === 'female' && shift.femaleRule === 'warn' && !femaleLateAllowed(e, opts)));
        const pool = males.length > 0 ? males : eligible;

        if (pool.length === 0) {
          unfilled.push({
            date, code,
            reason: eligible.length === 0
              ? 'no eligible employee (rest/consecutive/gender constraints)'
              : 'constraint conflict',
          });
          count--;
          continue;
        }

        // Fairness: least share of this CATEGORY (YTD + this week); then rotate the SPECIFIC CODE
        // (so day-locked employees cycle M→B→C instead of freezing); then least total load; then a
        // deterministic id tiebreak (never fall back to array order — that is what froze the women).
        // With rotationFairness: the weekly band target leads — employees whose band matches this
        // shift's category are preferred (weekly consistency), fairness ordering inside each group.
        pool.sort((a, b) => {
          if (targetBand.size) {
            const ba = targetBand.get(a.id) === shift.category ? 0 : 1;
            const bb = targetBand.get(b.id) === shift.category ? 0 : 1;
            if (ba !== bb) return ba - bb;
          }
          const wa = weekCount.get(a.id)![cat] + share(ytdDist.get(a.id), cat);
          const wb = weekCount.get(b.id)![cat] + share(ytdDist.get(b.id), cat);
          if (Math.abs(wa - wb) > 1e-9) return wa - wb;
          const ca = codeCount.get(a.id)![code] ?? 0, cb = codeCount.get(b.id)![code] ?? 0;
          if (ca !== cb) return ca - cb;
          const ta = totalOf(a.id), tb = totalOf(b.id);
          if (ta !== tb) return ta - tb;
          return a.id < b.id ? -1 : 1;
        });
        const chosen = pool[0];

        if (chosen.gender === 'female' && shift.femaleRule === 'warn' && !femaleLateAllowed(chosen, opts)) {
          warnings.push(`${date}: ${chosen.name} (أنثى) أُسندت ${code} لعدم توفر بديل — يتطلب اعتماد المشرف`);
        }

        assignments.push({ employeeId: chosen.id, date, code });
        assignedToday.add(chosen.id);
        weekCount.get(chosen.id)![cat] += 1;
        codeCount.get(chosen.id)![code] = (codeCount.get(chosen.id)![code] ?? 0) + 1;
        consec.set(chosen.id, (consec.get(chosen.id) ?? 0) + 1);
        prevShift.set(chosen.id, shift);
        count--;
      }
    }

    // Anyone not assigned and not OFF → pool exceeds demand. An extra OFF is
    // only allowed while under the weekly OFF allowance — beyond it the
    // employee MUST work (labeled overstaffing), so OFF days never leak.
    for (const e of employees) {
      if (assignedToday.has(e.id)) continue;
      const mustRest = (consec.get(e.id) ?? 0) >= MAX_CONSEC;   // forced-rest OFF stays legal
      // weekend-fair keeps the planned OFF STRUCTURE fixed (classic-engine parity):
      // surplus people WORK on non-planned days (labeled overstaffing) instead of
      // taking early surplus OFFs that would cannibalize the Thu/Fri weekend slot.
      const structuredOff = opts.offStrategy === 'weekend-fair';
      // atFloor: this date already has dayCap people OFF for this pool → the rest must
      // WORK so the function keeps its coverage floor (the 2026-07-08 concentration fix,
      // extended to the default 'lowest-demand' strategy too).
      const atFloor = offCountToday >= dayCap;
      if (((offUsed.get(e.id) ?? 0) >= opts.offDaysPerWeek || structuredOff || atFloor) && !mustRest) {
        // Next-best working shift: eligible + fairest category share
        const allowed = allowedShiftCodes(e.functionName);
        const candidates = WORKING_CODES.filter(code => {
          const s = SHIFT_BY_CODE[code];
          if (allowed && !allowed.has(code)) return false;
          // No demand necessity here → females never get 'warn' shifts in surplus,
          // unless the exception makes that shift ordinary for them (OMT).
          if (e.gender === 'female' && s.femaleRule !== 'allowed'
              && !(s.femaleRule === 'warn' && femaleLateAllowed(e, opts))) return false;
          return calcRestHours(prevShift.get(e.id) ?? null, s) >= opts.minRestHours;
        });
        if (candidates.length) {
          candidates.sort((a, b) => {
            const wa = weekCount.get(e.id)![CATEGORY_OF[a]] + share(ytdDist.get(e.id), CATEGORY_OF[a]);
            const wb = weekCount.get(e.id)![CATEGORY_OF[b]] + share(ytdDist.get(e.id), CATEGORY_OF[b]);
            return wa - wb;
          });
          const code = candidates[0];
          assignments.push({ employeeId: e.id, date, code, overstaff: true });
          weekCount.get(e.id)![CATEGORY_OF[code]] += 1;
          consec.set(e.id, (consec.get(e.id) ?? 0) + 1);
          prevShift.set(e.id, SHIFT_BY_CODE[code]);
          warnings.push(`${date}: ${e.name} — فائض تغطية: أُسند ${code} لأن رصيد الـ OFF الأسبوعي مكتمل [overstaffing]`);
          continue;
        }
      }
      // Weekend-fair structure guard: a surplus OFF today must REPLACE a future
      // planned OFF (mid-week first) instead of silently burning the allowance —
      // otherwise the register step later releases the planned Thu/Fri slot and
      // the weekend-fairness the strategy exists for is destroyed.
      if (opts.offStrategy === 'weekend-fair') {
        const future = dates.filter(d => d > date && offToday.get(d)!.has(e.id));
        let over = (offUsed.get(e.id) ?? 0) + 1 + future.length - opts.offDaysPerWeek;
        const weekend = new Set([dates[5], dates[6]]);
        const dropOrder = [...future.filter(d => !weekend.has(d)), ...future.filter(d => weekend.has(d))];
        for (const drop of dropOrder) {
          if (over <= 0) break;
          offToday.get(drop)!.delete(e.id);
          over--;
        }
      }
      assignments.push({ employeeId: e.id, date, code: 'OFF' });
      consec.set(e.id, 0);
      prevShift.set(e.id, SHIFTS.OFF);
      offUsed.set(e.id, (offUsed.get(e.id) ?? 0) + 1);
      offCountToday++;
    }
  }

  return { assignments, unfilled, warnings };
}

function share(dist: ShiftDistribution | undefined, cat: string): number {
  if (!dist || dist.total === 0) return 0;
  return ((dist as any)[cat] ?? 0) / dist.total;
}
