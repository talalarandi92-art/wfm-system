/** Spec gate for the shared shift normalizer — the Director's examples table verbatim
 *  (2026-07-03) plus the suffix-grammar edge cases that used to be hardcoded lists. */
import { normalizeShiftCode, hrMatrixCode } from './shift-normalize';

const n = normalizeShiftCode;

describe('shift-normalize — Director examples table', () => {
  it('M → base M, working, HR M', () => {
    const r = n('M');
    expect(r).toMatchObject({ base: 'M', status: 'working', hrCode: 'M', isWfh: false, isWorking: true, countsActual: true, shrinkage: null });
    expect(r.startMin).toBe(420); expect(r.endMin).toBe(960); expect(r.crossesMidnight).toBe(false);
  });
  it('WFH-M → base M, wfh, HR WFH, same timing/coverage as M', () => {
    const r = n('WFH-M');
    expect(r).toMatchObject({ base: 'M', status: 'wfh', isWfh: true, isWorking: true, countsActual: true });
    expect(r.startMin).toBe(420); expect(r.endMin).toBe(960);
  });
  it.each([['MA', 'M'], ['BA', 'B'], ['NA', 'N'], ['MDA', 'MD'], ['EE20A', 'EE20'], ['CA', 'C'], ['EA', 'E'], ['MNA', 'MN'], ['M7-3A', 'M7-3']])(
    '%s → absence from %s, HR A, unplanned shrinkage, scheduled-not-actual', (code, base) => {
      const r = n(code);
      expect(r).toMatchObject({ base, status: 'absence', hrCode: 'A', isWorking: false, countsScheduled: true, countsActual: false, shrinkage: 'unplanned', mapped: true });
    });
  it.each([['MS', 'M'], ['BS', 'B'], ['NS', 'N'], ['MDS', 'MD'], ['EE20S', 'EE20'], ['CS', 'C'], ['ES', 'E'], ['MNS', 'MN'], ['EES', 'EE'], ['M7-3S', 'M7-3']])(
    '%s → sick on %s, HR SL', (code, base) => {
      const r = n(code);
      expect(r).toMatchObject({ base, status: 'sick', hrCode: 'SL', isWorking: false, countsScheduled: true, countsActual: false, shrinkage: 'unplanned', mapped: true });
    });
  it('A-suffix keeps the base shift timing for analysis', () => {
    expect(n('MDA')).toMatchObject({ startMin: 1320, endMin: 1860, crossesMidnight: true });
    expect(n('NA')).toMatchObject({ startMin: 780, endMin: 1320, crossesMidnight: false });
  });
  it('OFF → weekly off, not working, not scheduled, not actual', () => {
    expect(n('OFF')).toMatchObject({ status: 'off', hrCode: 'OFF', isWorking: false, countsScheduled: false, countsActual: false, shrinkage: null });
  });
  it('H / L / COMP → planned shrinkage, not actual', () => {
    for (const [c, hr] of [['H', 'H'], ['L', 'L'], ['COMP', 'COMP']] as const)
      expect(n(c)).toMatchObject({ hrCode: hr, isWorking: false, countsScheduled: true, countsActual: false, shrinkage: 'planned' });
  });
});

describe('shift-normalize — grammar & legacy', () => {
  it('ABS is a legacy alias of A — never an official code', () => {
    expect(n('ABS')).toMatchObject({ status: 'absence', hrCode: 'A' });
    expect(hrMatrixCode('ABS')).toBe('A');
  });
  it('plain A / SL are the HR-normalized codes', () => {
    expect(n('A')).toMatchObject({ status: 'absence', hrCode: 'A' });
    expect(n('SL')).toMatchObject({ status: 'sick', hrCode: 'SL' });
  });
  it('WFH variants in all spellings map to the base', () => {
    for (const c of ['WFH-N', 'WFHN', 'WFH_N']) expect(n(c)).toMatchObject({ base: 'N', status: 'wfh', hrCode: 'WFH' });
    expect(n('WFH-MD')).toMatchObject({ base: 'MD', crossesMidnight: true });
    expect(n('WFH')).toMatchObject({ status: 'wfh', isWfh: true, startMin: null });
  });
  it('cross-midnight bases flagged (E, EE20, MD, MN)', () => {
    for (const c of ['E', 'EE20', 'MD', 'MN']) expect(n(c).crossesMidnight).toBe(true);
    for (const c of ['M', 'B', 'C', 'N']) expect(n(c).crossesMidnight).toBe(false);
  });
  it('longest base wins: EE20A is EE20+A, not EE2+0A; M20S is M20+S; N20A is N20+A', () => {
    expect(n('EE20A').base).toBe('EE20');
    expect(n('M20S')).toMatchObject({ base: 'M20', status: 'sick' });
    expect(n('N20A')).toMatchObject({ base: 'N20', status: 'absence' });
  });
  it('Ramadan variants keep the base, no timing guess', () => {
    expect(n('MDR')).toMatchObject({ base: 'MD', status: 'working', isRamadan: true, startMin: null });
    expect(n('MNR')).toMatchObject({ base: 'MN', isRamadan: true });
    expect(n('MDRA')).toMatchObject({ base: 'MD', status: 'absence', hrCode: 'A', isRamadan: true });
  });
  it('AM is an exact 8h base — never parsed as A+M or M+suffix', () => {
    expect(n('AM')).toMatchObject({ base: 'AM', status: 'working', startMin: 480, endMin: 960 });
  });
  it('unknown codes are flagged, never guessed', () => {
    for (const c of ['XYZ', 'S', 'R', 'WFH-XYZ', '']) expect(n(c).mapped).toBe(false);
  });
  it('separation / transfer are not headcount', () => {
    for (const c of ['RES', 'TER']) expect(n(c)).toMatchObject({ status: 'separation', countsScheduled: false, countsActual: false });
  });
});
