/**
 * GATE (Scorecard wave B2, spec §10): identity resolution precedence + safety.
 *
 * Pure logic only (no DB) so the contract is deterministic:
 *   - precedence: exact email > sprinklr_agent_id > fuzzy-name-flagged
 *   - unresolved-queue routing (anything not hard-linked)
 *   - no hard link below the confidence threshold (name NEVER hard-links)
 *   - fuzzy matching is unique-best + margin guarded (no name-only merges)
 */
import {
  resolveSignal,
  bestFuzzy,
  nameSimilarity,
  normName,
  normEmail,
  HARD_LINK_THRESHOLD,
  CONFIDENCE,
} from './resolution';

describe('B2 identity — normalization', () => {
  it('normName collapses case/space/punct', () => {
    expect(normName('  Ahmed   Al-Ali ')).toBe('ahmed al ali');
    expect(normName('José  Núñez')).toBe('jose nunez');
  });
  it('normEmail lowercases + trims', () => {
    expect(normEmail('  Foo.Bar@X.COM ')).toBe('foo.bar@x.com');
    expect(normEmail(null)).toBe('');
  });
});

describe('B2 identity — precedence (email > sprinklr_agent_id > fuzzy)', () => {
  it('exact email wins over everything', () => {
    const o = resolveSignal({
      emailMatchPersonNo: '13019',
      structuralPersonNo: '99999',
      fuzzy: { personNo: '88888', score: 0.9 },
    });
    expect(o.method).toBe('exact_email');
    expect(o.personNo).toBe('13019');
    expect(o.confidence).toBe(CONFIDENCE.EXACT_EMAIL);
    expect(o.hardLink).toBe(true);
  });

  it('sprinklr structured link wins when no email', () => {
    const o = resolveSignal({
      structuralPersonNo: '13316',
      fuzzy: { personNo: '88888', score: 0.99 },
    });
    expect(o.method).toBe('sprinklr_agent_id');
    expect(o.personNo).toBe('13316');
    expect(o.confidence).toBe(CONFIDENCE.STRUCTURED_SPRINKLR);
    expect(o.hardLink).toBe(true);
  });

  it('fuzzy is last resort AND never hard-links, even at score 1.0', () => {
    const o = resolveSignal({ fuzzy: { personNo: '11887', score: 1.0 } });
    expect(o.method).toBe('fuzzy_name');
    expect(o.personNo).toBe('11887');
    expect(o.hardLink).toBe(false); // name-only never hard-links
    expect(o.confidence).toBeLessThan(HARD_LINK_THRESHOLD);
  });

  it('no signals → none, not linked', () => {
    const o = resolveSignal({});
    expect(o.method).toBe('none');
    expect(o.personNo).toBeNull();
    expect(o.hardLink).toBe(false);
  });
});

describe('B2 identity — no hard link below threshold', () => {
  it('every non-fuzzy hardLink implies confidence >= threshold', () => {
    for (const c of [CONFIDENCE.EXACT_EMAIL, CONFIDENCE.STRUCTURED_SPRINKLR]) {
      expect(c).toBeGreaterThanOrEqual(HARD_LINK_THRESHOLD);
    }
    // fuzzy cap is strictly below threshold
    expect(CONFIDENCE.FUZZY_NAME_MAX).toBeLessThan(HARD_LINK_THRESHOLD);
  });
});

describe('B2 identity — fuzzy matching guards', () => {
  const roster = [
    { personNo: '1', name: 'Ahmed Al Ali' },
    { personNo: '2', name: 'Ahmed Al Salem' },
    { personNo: '3', name: 'Fatima Hassan' },
  ];

  it('nameSimilarity is symmetric and bounded 0..1', () => {
    const s = nameSimilarity('Ahmed Al Ali', 'ahmed al ali');
    expect(s).toBe(1);
    expect(nameSimilarity('Ahmed', '')).toBe(0);
    expect(nameSimilarity('X Y', 'A B')).toBe(0);
  });

  it('unique clear winner resolves', () => {
    const b = bestFuzzy('Fatima Hassan', roster);
    expect(b?.personNo).toBe('3');
    expect(b?.score).toBe(1);
  });

  it('ambiguous near-ties are rejected (no name-only merge)', () => {
    // "Ahmed Al" is equally close to persons 1 and 2 → margin guard rejects
    const b = bestFuzzy('Ahmed Al', roster);
    expect(b).toBeNull();
  });

  it('below-min score is rejected', () => {
    expect(bestFuzzy('Zzz Qqq', roster)).toBeNull();
  });
});

describe('B2 identity — queue routing', () => {
  it('anything not hard-linked is destined for the unresolved queue', () => {
    const outcomes = [
      resolveSignal({ fuzzy: { personNo: '5', score: 0.9 } }), // fuzzy → queue
      resolveSignal({}), // none → queue
    ];
    for (const o of outcomes) expect(o.hardLink).toBe(false);
  });
});
