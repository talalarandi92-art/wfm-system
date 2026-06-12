/**
 * DEMAND-DRIVEN SCHEDULE ENGINE — the two-phase approach used by enterprise
 * WFM (NICE IEX, Verint, Calabrio):
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

import { ShiftDef, SHIFTS, EmployeeInfo, ShiftDistribution } from './generator.types';
import { calcRestHours } from './generator.engine';

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

const WORKING_CODES = ['M', 'B', 'C', 'E', 'N', 'MD']; // catalog working shifts

export function computeShiftMix(
  date: string,
  required: number[],          // 48 ints
  maxStaffPerDay: number,      // pool ceiling — never plan more bodies than exist
): ShiftMixDay {
  const deficit = [...required];
  const staffed = new Array(SLOTS).fill(0);
  const mix: Record<string, number> = {};
  let placed = 0;

  // Greedy: repeatedly add the one shift that erases the most remaining deficit.
  // Tie-break toward shifts covering the single worst interval.
  while (placed < maxStaffPerDay) {
    let best: { code: string; reduction: number; coversPeak: boolean } | null = null;
    const peakIdx = deficit.indexOf(Math.max(...deficit));
    for (const code of WORKING_CODES) {
      const slots = shiftSlots(SHIFTS[code]).today;
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
    mix[best.code] = (mix[best.code] ?? 0) + 1;
    for (const i of shiftSlots(SHIFTS[best.code]).today) {
      deficit[i] -= 1;
      staffed[i] += 1;
    }
    placed++;
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
  code: string;                 // shift code or OFF
}

export interface DemandRosterResult {
  assignments: DemandAssignment[];
  unfilled: { date: string; code: string; reason: string }[];
  warnings: string[];           // e.g. female assigned N out of necessity
}

const CATEGORY_OF: Record<string, keyof Pick<ShiftDistribution, 'morning' | 'afternoon' | 'evening' | 'night' | 'midnight'>> = {
  M: 'morning', B: 'morning', C: 'afternoon', E: 'evening', N: 'night', MD: 'midnight',
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
    /** empId → dates with APPROVED leave — assigned 'L', excluded from staffing */
    onLeave?: Map<string, Set<string>>;
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
  const offUsed = new Map<string, number>(employees.map(e => [e.id, 0]));
  const offToday = new Map<string, Set<string>>(); // date → employee ids OFF

  // ── OFF planning: place OFFs on the days with the LOWEST demand,
  //    forcing them for anyone hitting the consecutive-days ceiling.
  const demandOfDay = dates.map(d => {
    const m = mixByDate.get(d) ?? {};
    return { date: d, demand: Object.values(m).reduce((a, b) => a + b, 0) };
  });
  const lowDemandOrder = [...demandOfDay].sort((a, b) => a.demand - b.demand).map(x => x.date);

  for (const date of dates) offToday.set(date, new Set());
  for (const emp of employees) {
    let need = opts.offDaysPerWeek;
    // Forced OFF first: where would they exceed MAX_CONSEC?
    let c = consec.get(emp.id) ?? 0;
    for (const date of dates) {
      if (need <= 0) break;
      c++;
      if (c > MAX_CONSEC) {
        offToday.get(date)!.add(emp.id);
        need--;
        c = 0;
      }
    }
    // Remaining OFFs on lowest-demand days (capped so a day never loses >35% of pool)
    for (const date of lowDemandOrder) {
      if (need <= 0) break;
      const set = offToday.get(date)!;
      if (set.has(emp.id)) continue;
      if (set.size >= Math.floor(employees.length * 0.35)) continue;
      set.add(emp.id);
      need--;
    }
  }

  // ── Day-by-day assignment, hardest shifts first (MD → N → E → C → B → M)
  const HARD_ORDER = ['MD', 'N', 'E', 'C', 'B', 'M'];

  for (const date of dates) {
    const mix = { ...(mixByDate.get(date) ?? {}) };
    const assignedToday = new Set<string>(offToday.get(date));

    // Approved leave first — these people are NOT available, full stop
    for (const emp of employees) {
      if (opts.onLeave?.get(emp.id)?.has(date) && !assignedToday.has(emp.id)) {
        assignments.push({ employeeId: emp.id, date, code: 'L' });
        assignedToday.add(emp.id);
        consec.set(emp.id, 0);
        prevShift.set(emp.id, SHIFTS.OFF);
      }
    }

    // Register OFF assignments
    for (const id of offToday.get(date)!) {
      if (opts.onLeave?.get(id)?.has(date)) continue; // leave already covers the day
      assignments.push({ employeeId: id, date, code: 'OFF' });
      consec.set(id, 0);
      prevShift.set(id, SHIFTS.OFF);
      offUsed.set(id, (offUsed.get(id) ?? 0) + 1);
    }

    for (const code of HARD_ORDER) {
      let count = mix[code] ?? 0;
      const shift = SHIFTS[code];
      const cat = CATEGORY_OF[code];

      while (count > 0) {
        // Eligible pool
        const eligible = employees.filter(e => {
          if (assignedToday.has(e.id)) return false;
          if ((consec.get(e.id) ?? 0) >= MAX_CONSEC) return false;
          if (e.gender === 'female' && shift.femaleRule === 'blocked') return false;
          const rest = calcRestHours(prevShift.get(e.id) ?? null, shift);
          if (rest !== null && rest < opts.minRestHours) return false;
          return true;
        });

        // Female-N only as a true last resort (business rule 6.4)
        const males = eligible.filter(e => !(e.gender === 'female' && shift.femaleRule === 'warn'));
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

        // Fairness: least share of this category (YTD + this week), then least total
        pool.sort((a, b) => {
          const wa = weekCount.get(a.id)![cat] + share(ytdDist.get(a.id), cat);
          const wb = weekCount.get(b.id)![cat] + share(ytdDist.get(b.id), cat);
          return wa - wb;
        });
        const chosen = pool[0];

        if (chosen.gender === 'female' && shift.femaleRule === 'warn') {
          warnings.push(`${date}: ${chosen.name} (أنثى) أُسندت ${code} لعدم توفر بديل — يتطلب اعتماد المشرف`);
        }

        assignments.push({ employeeId: chosen.id, date, code });
        assignedToday.add(chosen.id);
        weekCount.get(chosen.id)![cat] += 1;
        consec.set(chosen.id, (consec.get(chosen.id) ?? 0) + 1);
        prevShift.set(chosen.id, shift);
        count--;
      }
    }

    // Anyone not assigned and not OFF → extra OFF (pool exceeds demand)
    for (const e of employees) {
      if (!assignedToday.has(e.id)) {
        assignments.push({ employeeId: e.id, date, code: 'OFF' });
        consec.set(e.id, 0);
        prevShift.set(e.id, SHIFTS.OFF);
      }
    }
  }

  return { assignments, unfilled, warnings };
}

function share(dist: ShiftDistribution | undefined, cat: string): number {
  if (!dist || dist.total === 0) return 0;
  return ((dist as any)[cat] ?? 0) / dist.total;
}
