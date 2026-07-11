/**
 * resolution.ts — PURE identity-resolution logic (no DB), so the gate spec can
 * prove precedence + threshold behaviour deterministically. §10.
 *
 * Precedence (spec §10 / bridge identity): exact email > sprinklr_agent_id >
 * fuzzy-name-flagged. Name-only NEVER hard-links ("Do not merge employees based
 * on name only") — a fuzzy match, however strong, is only ever a *suggestion*
 * routed to the unresolved queue.
 */

export const HARD_LINK_THRESHOLD = 0.8;

export const CONFIDENCE = {
  EXACT_EMAIL: 1.0,
  STRUCTURED_SPRINKLR: 0.95, // pre-existing structured employee_id link on the sprinklr row
  FUZZY_NAME_MAX: 0.79, // capped strictly below threshold — name never hard-links
} as const;

export type ResolveMethod = 'exact_email' | 'sprinklr_agent_id' | 'fuzzy_name' | 'none';

export interface ResolveOutcome {
  personNo: string | null;
  method: ResolveMethod;
  confidence: number;
  hardLink: boolean; // true => safe to write a cross-system link; false => queue it
}

/** Normalize a name for comparison: lowercase, strip diacritics, collapse whitespace. */
export function normName(s: string | null | undefined): string {
  return (s || '')
    .toString()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normEmail(s: string | null | undefined): string {
  return (s || '').toString().trim().toLowerCase();
}

/** Token Sørensen–Dice similarity on name tokens → 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normName(a).split(' ').filter(Boolean));
  const tb = new Set(normName(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/**
 * Best fuzzy candidate for a name against a roster of {personNo, name}.
 * Returns the top scorer only if it is UNIQUELY best (avoids ambiguous merges).
 */
export function bestFuzzy(
  name: string,
  roster: Array<{ personNo: string; name: string }>,
  min = 0.6,
): { personNo: string; score: number } | null {
  let best: { personNo: string; score: number } | null = null;
  let secondScore = 0;
  for (const r of roster) {
    const score = nameSimilarity(name, r.name);
    if (!best || score > best.score) {
      secondScore = best ? best.score : 0;
      best = { personNo: r.personNo, score };
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  if (!best || best.score < min) return null;
  // require a clear margin over the runner-up so a common first name is not a "match"
  if (best.score - secondScore < 0.15) return null;
  return best;
}

/**
 * Resolve ONE external signal to a person, applying precedence + threshold.
 * Inputs are the pre-computed candidate hits from each strategy.
 */
export function resolveSignal(input: {
  emailMatchPersonNo?: string | null; // person whose known email == this signal's email (exact)
  structuralPersonNo?: string | null; // person via a structured sprinklr employee_id link
  fuzzy?: { personNo: string; score: number } | null;
}): ResolveOutcome {
  if (input.emailMatchPersonNo) {
    return {
      personNo: input.emailMatchPersonNo,
      method: 'exact_email',
      confidence: CONFIDENCE.EXACT_EMAIL,
      hardLink: CONFIDENCE.EXACT_EMAIL >= HARD_LINK_THRESHOLD,
    };
  }
  if (input.structuralPersonNo) {
    return {
      personNo: input.structuralPersonNo,
      method: 'sprinklr_agent_id',
      confidence: CONFIDENCE.STRUCTURED_SPRINKLR,
      hardLink: CONFIDENCE.STRUCTURED_SPRINKLR >= HARD_LINK_THRESHOLD,
    };
  }
  if (input.fuzzy) {
    const confidence = Math.min(CONFIDENCE.FUZZY_NAME_MAX, input.fuzzy.score);
    return {
      personNo: input.fuzzy.personNo,
      method: 'fuzzy_name',
      confidence,
      hardLink: false, // name-only never hard-links, regardless of score
    };
  }
  return { personNo: null, method: 'none', confidence: 0, hardLink: false };
}
