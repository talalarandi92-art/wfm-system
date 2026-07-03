/**
 * THE shared shift-code normalizer — docs/knowledge/WFM_RULES_AND_DECISIONS.md §3/§6.
 *
 * One call answers everything any module needs to know about a roster cell code:
 *   base shift · attendance status · HR-Matrix code · WFH · working/scheduled/actual
 *   headcount flags · shrinkage bucket · canonical timing · cross-midnight.
 *
 * Suffix grammar (Director, 2026-07-03 — generic, so EE20A / M7-3S can never go missing):
 *   <BASE>A  = absent from BASE (no medical report)   → HR Matrix 'A'
 *   <BASE>S  = sick leave on BASE (medical report)    → HR Matrix 'SL'
 *   WFH-<BASE> / WFH<BASE> / <BASE>-WFH = BASE worked from home (same timing/coverage)
 *   <BASE>R  = Ramadan variant of BASE (different timing — timing left null)
 * 'ABS' is NOT an official code — accepted read-only as a legacy alias of 'A'.
 *
 * Timing dictionary mirrors the recon engine (scripts/recon-new-roster.js STD/RESP/MOM)
 * and schedule.service SHIFT_CODE_MAP — minutes from midnight, end>1440 = cross-midnight.
 */

export type ShiftStatus =
  | 'working' | 'wfh' | 'absence' | 'sick'
  | 'off' | 'holiday' | 'leave' | 'comp' | 'separation' | 'unknown';

export interface NormalizedShift {
  raw: string;               // original roster code as given
  base: string | null;       // base shift (M, B, C, N, E, EE20, MD, MN, M20…, M7-3, AM) or null
  status: ShiftStatus;
  hrCode: string;            // HR-Matrix normalized code: base / WFH / A / SL / OFF / H / L / DL / UPL / COMP / RES / TER
  isWfh: boolean;
  isRamadan: boolean;
  isWorking: boolean;        // physically working this day (working | wfh)
  countsScheduled: boolean;  // part of the schedulable base (scheduled − OFF)
  countsActual: boolean;     // counts as actual/available headcount
  shrinkage: 'planned' | 'unplanned' | null;
  startMin: number | null;   // canonical scheduled start (minutes from midnight)
  endMin: number | null;     // canonical scheduled end (may exceed 1440)
  crossesMidnight: boolean;
  mapped: boolean;           // false = code not recognized (flag, never guess)
}

// gross windows, minutes from midnight — end > 1440 crosses midnight
const BASE_TIMES: Record<string, [number, number]> = {
  // standard 9h agent shifts
  M: [420, 960], B: [540, 1080], C: [660, 1200], N: [780, 1320],
  E: [960, 1500], EE20: [1080, 1620], MD: [1320, 1860], MN: [1380, 1920],
  EE: [1080, 1620],                       // seen as EE in some sheets — same window as EE20
  // responsible/supervisor 8h (user-confirmed 2026-06-28)
  M20: [480, 960], B20: [600, 1080], C20: [660, 1200], N20: [840, 1320],
  // mothers 7h
  M7: [420, 840], B7: [540, 960], C7: [660, 1080], N7: [780, 1200],
  // fixed specials
  AM: [480, 960], CCNO: [540, 1020], 'M7-3': [420, 900],
};
// longest-first so EE20 wins over E, M20 over M, M7-3 over M7 …
const BASES = Object.keys(BASE_TIMES).sort((a, b) => b.length - a.length);

const NON_WORKING: Record<string, { status: ShiftStatus; hrCode: string }> = {
  OFF: { status: 'off', hrCode: 'OFF' },
  H: { status: 'holiday', hrCode: 'H' },
  L: { status: 'leave', hrCode: 'L' },
  SL: { status: 'sick', hrCode: 'SL' },       // pre-scheduled sick leave (no base shift)
  DL: { status: 'leave', hrCode: 'DL' },
  UPL: { status: 'leave', hrCode: 'UPL' },
  COMP: { status: 'comp', hrCode: 'COMP' },
  RES: { status: 'separation', hrCode: 'RES' },
  TER: { status: 'separation', hrCode: 'TER' },
  TRANSFER: { status: 'separation', hrCode: 'Transfer' },
  A: { status: 'absence', hrCode: 'A' },       // HR-normalized absence with no base recorded
  ABS: { status: 'absence', hrCode: 'A' },     // LEGACY alias only — never emit 'ABS'
};

function flags(status: ShiftStatus): Pick<NormalizedShift, 'isWorking' | 'countsScheduled' | 'countsActual' | 'shrinkage'> {
  switch (status) {
    case 'working':
    case 'wfh':      return { isWorking: true, countsScheduled: true, countsActual: true, shrinkage: null };
    case 'absence':  return { isWorking: false, countsScheduled: true, countsActual: false, shrinkage: 'unplanned' };
    case 'sick':     return { isWorking: false, countsScheduled: true, countsActual: false, shrinkage: 'unplanned' };
    case 'leave':
    case 'holiday':
    case 'comp':     return { isWorking: false, countsScheduled: true, countsActual: false, shrinkage: 'planned' };
    case 'off':
    case 'separation':
    default:         return { isWorking: false, countsScheduled: false, countsActual: false, shrinkage: null };
  }
}

function make(raw: string, p: Partial<NormalizedShift>): NormalizedShift {
  const status = p.status ?? 'unknown';
  const startMin = p.startMin ?? null;
  const endMin = p.endMin ?? null;
  return {
    raw, base: p.base ?? null, status,
    hrCode: p.hrCode ?? (raw || '').toUpperCase(),
    isWfh: p.isWfh ?? false, isRamadan: p.isRamadan ?? false,
    ...flags(status),
    ...(p.isWorking != null ? { isWorking: p.isWorking } : {}),
    startMin, endMin,
    crossesMidnight: endMin != null ? endMin > 1440 : false,
    mapped: p.mapped ?? true,
  };
}

/** Normalize ANY roster cell code. Unknown codes come back mapped:false — flag, never guess. */
export function normalizeShiftCode(rawIn: string | null | undefined): NormalizedShift {
  const raw = String(rawIn ?? '').trim();
  let U = raw.toUpperCase().replace(/\s+/g, '');
  if (!U) return make(raw, { status: 'unknown', hrCode: '', mapped: false });

  // WFH wrapper — strip and remember; timing/coverage stays the base shift's
  let isWfh = false;
  const wfhStripped = U.replace(/^WFH[-_]?/, '').replace(/[-_]?WFH$/, '');
  if (wfhStripped !== U) { isWfh = true; U = wfhStripped; }
  if (isWfh && !U) return make(raw, { status: 'wfh', hrCode: 'WFH', isWfh: true }); // bare "WFH" — timing unknown

  // plain non-working / HR codes (incl. legacy ABS→A)
  if (!isWfh && NON_WORKING[U]) return make(raw, { ...NON_WORKING[U] });

  // exact base shift
  if (BASE_TIMES[U]) {
    const [s, e] = BASE_TIMES[U];
    return make(raw, { base: U, status: isWfh ? 'wfh' : 'working', hrCode: isWfh ? 'WFH' : U, isWfh, startMin: s, endMin: e });
  }

  // suffix grammar: <BASE>A absence · <BASE>S sick · <BASE>R Ramadan (longest base wins)
  const sfx = U.slice(-1);
  if (sfx === 'A' || sfx === 'S' || sfx === 'R') {
    const stem = U.slice(0, -1);
    const base = BASES.find(b => b === stem);
    if (base) {
      const [s, e] = BASE_TIMES[base];
      if (sfx === 'A') return make(raw, { base, status: 'absence', hrCode: 'A', startMin: s, endMin: e });
      if (sfx === 'S') return make(raw, { base, status: 'sick', hrCode: 'SL', startMin: s, endMin: e });
      // Ramadan variant — real timing differs (split shifts possible); keep base, no timing guess
      return make(raw, { base, status: isWfh ? 'wfh' : 'working', hrCode: isWfh ? 'WFH' : base, isWfh, isRamadan: true });
    }
    // Ramadan sick/absence: MDRA / MDRS style (base+R+suffix)
    if ((sfx === 'A' || sfx === 'S') && stem.endsWith('R')) {
      const rBase = BASES.find(b => b === stem.slice(0, -1));
      if (rBase) return make(raw, sfx === 'A'
        ? { base: rBase, status: 'absence', hrCode: 'A', isRamadan: true }
        : { base: rBase, status: 'sick', hrCode: 'SL', isRamadan: true });
    }
  }

  return make(raw, { status: 'unknown', mapped: false });
}

/** HR-Matrix code for a roster cell — SL for any *S sick, A for any *A absence. */
export function hrMatrixCode(rawCode: string | null | undefined): string {
  return normalizeShiftCode(rawCode).hrCode;
}
