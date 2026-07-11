/**
 * Smart Break Management — B5 SIMULATION pure logic (§28).
 * Zero I/O. Deterministic scenario math shared by the scheduler (dry-run
 * scenario application) and BreakSimulationService. Reuses the risk grammar of
 * break-release.logic — no duplicated thresholds or risk math lives here.
 */
import { BreakPolicyV2Row } from './break-policy.logic';
import { RiskLevel } from './break-release.logic';

// ─── Scenario shape (§28) ───────────────────────────────────────────────────

export type QueueSpike = 'none' | 'moderate' | 'severe';

export interface BreakSimScenario {
  /** % of on-shift employees marked absent — deterministic per employee_id hash */
  absencePct?: number;
  /** synthetic live-queue pressure injected into riskAssess */
  queueSpike?: QueueSpike;
  /** virtual extra scheduled HC added to every coverage bucket in scope */
  extraStaff?: number;
  /** release-mode override applied to every policy row (in-memory only) */
  mode?: 'auto' | 'supervisor' | 'hybrid' | 'freeze';
  /** shallow policy patch applied to every policy row (thresholds deep-merged) */
  policyOverrides?: Record<string, unknown>;
}

/** Normalized/clamped copy — the resolved scenario echoed back to the caller. */
export function normalizeScenario(s: BreakSimScenario | null | undefined): Required<Pick<BreakSimScenario, 'absencePct' | 'queueSpike' | 'extraStaff'>> & BreakSimScenario {
  const absencePct = Math.max(0, Math.min(100, Number(s?.absencePct) || 0));
  const queueSpike: QueueSpike = (['none', 'moderate', 'severe'] as const).includes(s?.queueSpike as any)
    ? (s!.queueSpike as QueueSpike) : 'none';
  const extraStaff = Math.max(0, Math.min(500, Math.floor(Number(s?.extraStaff) || 0)));
  const mode = (['auto', 'supervisor', 'hybrid', 'freeze'] as const).includes(s?.mode as any) ? s!.mode : undefined;
  return { absencePct, queueSpike, extraStaff, mode, policyOverrides: s?.policyOverrides };
}

// ─── Deterministic absence seeding (§28: reproducible, per employee hash) ────

/** FNV-1a 32-bit hash of a string → [0, 1). Stable across runs and processes. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/** Same employee_id + same absencePct → always the same answer (no RNG). */
export function isSimAbsent(employeeId: string, absencePct: number): boolean {
  if (!(absencePct > 0)) return false;
  return hash01(employeeId) * 100 < absencePct;
}

// ─── Queue-spike → synthetic live inputs for riskAssess (§28) ────────────────

/**
 * Maps a scenario spike onto the SAME live inputs riskAssess reads for real
 * Sprinklr data. Values chosen against THRESHOLD_DEFAULTS (queue_waiting_max
 * 50): moderate lands in the "approaching max" yellow band + 1 at-risk queue
 * (orange); severe exceeds the max and trips the ≥3 at-risk red rule.
 * staleSec 0 = "fresh synthetic snapshot" so the §30 stale fail-safe does not
 * distort simulated risk.
 */
export function queueSpikeInputs(spike: QueueSpike): { queueWaiting: number; atRiskQueueCount: number; staleSec: number } {
  switch (spike) {
    case 'severe':   return { queueWaiting: 80, atRiskQueueCount: 3, staleSec: 0 };
    case 'moderate': return { queueWaiting: 45, atRiskQueueCount: 1, staleSec: 0 };
    default:         return { queueWaiting: 0,  atRiskQueueCount: 0, staleSec: 0 };
  }
}

// ─── Policy overrides (in-memory patch, never persisted) ─────────────────────

const OVERRIDABLE = new Set([
  'total_daily_minutes', 'max_sessions', 'duration_pattern', 'protected_first_min',
  'protected_last_min', 'min_gap_between_breaks_min', 'min_work_before_first_min',
  'max_delay_min', 'release_mode', 'thresholds',
]);

/** Returns NEW rows — input rows are never mutated (the DB cache stays clean). */
export function applyPolicyOverrides(
  rows: BreakPolicyV2Row[],
  overrides: Record<string, unknown> | null | undefined,
  mode?: BreakSimScenario['mode'],
): BreakPolicyV2Row[] {
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (OVERRIDABLE.has(k) && v !== undefined) patch[k] = v;
  }
  if (mode) patch.release_mode = mode;
  if (!Object.keys(patch).length) return rows.map(r => ({ ...r, thresholds: { ...r.thresholds } }));
  return rows.map(r => ({
    ...r,
    ...patch,
    // thresholds merge (override keys win, the rest of the row's thresholds survive)
    thresholds: { ...r.thresholds, ...((patch.thresholds as Record<string, unknown>) ?? {}) },
  })) as BreakPolicyV2Row[];
}

// ─── Delayed-slot projection (§28) ───────────────────────────────────────────

export interface SimSlotWindow {
  functionName: string;
  /** absolute epoch-minutes of the planned window */
  startMin: number;
  endMin: number;
}

/**
 * A slot is projected DELAYED when its planned window overlaps any hour where
 * its function's simulated risk is red/critical (the release engine holds all
 * releases at red+, §13). riskByHour keys: `${epochHourMin}|${functionName}`
 * where epochHourMin = epoch-minutes floored to the hour.
 */
export function projectDelayed(slots: SimSlotWindow[], riskByHour: Map<string, RiskLevel>): SimSlotWindow[] {
  const out: SimSlotWindow[] = [];
  for (const s of slots) {
    let hit = false;
    for (let h = Math.floor(s.startMin / 60) * 60; h < s.endMin && !hit; h += 60) {
      const lvl = riskByHour.get(`${h}|${s.functionName}`);
      if (lvl === 'red' || lvl === 'critical') hit = true;
    }
    if (hit) out.push(s);
  }
  return out;
}

// ─── Late-return math (shared with reports; pure, testable) ──────────────────

/** Minutes an actual break ran past its planned duration (cross-midnight safe). */
export function lateReturnMin(
  plannedStartMin: number, plannedEndMin: number,
  actualStartMin: number, actualEndMin: number,
): number {
  let planned = plannedEndMin - plannedStartMin;
  if (planned <= 0) planned += 1440;
  let actual = actualEndMin - actualStartMin;
  if (actual < 0) actual += 1440;
  return Math.max(0, actual - planned);
}
