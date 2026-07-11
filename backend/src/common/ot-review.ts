/**
 * Director OT decisions (2026-07-11) — pure, testable helpers shared by the OT/exceptions
 * report and referenced by the recon ingest step. No DB, no side effects.
 *
 *  Decision 1 — a scheduled OFF day worked stays OFF: its net hours live in the NON-payable
 *               off_worked_min column and never enter payable OT until HR clarifies.
 *  Decision 2 — before/after-shift OT is a reserved period: only an ACKNOWLEDGED review flag's
 *               minutes are added to payable OT; pending/ignored contribute nothing. The engine
 *               (roster_days.ot_min) is never mutated — payable is recomputed at report time.
 */

/** A before/after-shift OT flag only becomes reviewable (raises an alert) at or above this many minutes. */
export const PENDING_THRESHOLD = 15;

export type OtReviewStatus = 'pending' | 'acknowledged' | 'ignored';

/**
 * Payable OT minutes for a period. OFF-worked evidence is deliberately absent — it is not a
 * parameter here because it is never payable. Acknowledged before/after review minutes ARE added.
 */
export function payableOtMin(parts: {
  regularMin?: number; offdayMin?: number; holidayMin?: number; ackReviewMin?: number;
}): number {
  const n = (x?: number) => Math.max(0, Math.round(Number(x || 0)));
  return n(parts.regularMin) + n(parts.offdayMin) + n(parts.holidayMin) + n(parts.ackReviewMin);
}

export interface OtEvidence { personNo: string; date: string; kind: 'before' | 'after'; minutes: number; }
export interface OtFlag { personNo: string; date: string; kind: 'before' | 'after'; status: OtReviewStatus; minutes: number; }

const keyOf = (x: { personNo: string; date: string; kind: string }) => `${x.personNo}|${x.date}|${x.kind}`;

/**
 * PRESERVE-ON-REBUILD reference semantics (mirrored by the recon-ingest SQL): given the flags that
 * already exist and the fresh before/after evidence for the ingested range, decide the resulting set.
 *   • an existing RESOLVED flag (acknowledged/ignored) is PRESERVED verbatim — never overwritten.
 *   • a still-PENDING flag is refreshed to the latest evidence minutes (or dropped if evidence gone).
 *   • new evidence ≥ threshold with no existing flag becomes a fresh PENDING flag.
 */
export function mergePendingFlags(existing: OtFlag[], evidence: OtEvidence[], threshold = PENDING_THRESHOLD): OtFlag[] {
  const resolved = new Map<string, OtFlag>();
  for (const f of existing) if (f.status === 'acknowledged' || f.status === 'ignored') resolved.set(keyOf(f), f);
  const out: OtFlag[] = [...resolved.values()];
  for (const ev of evidence) {
    if (ev.minutes < threshold) continue;
    const k = keyOf(ev);
    if (resolved.has(k)) continue; // resolved decision wins — do not re-open
    out.push({ personNo: ev.personNo, date: ev.date, kind: ev.kind, status: 'pending', minutes: Math.round(ev.minutes) });
  }
  return out;
}
