import {
  toSeconds, toInt, normalizeReportDate,
  classifyReport, classifyAgentSummaryKey, looksLikeAgentSummary,
  parseAgentSummary, agentSummaryToStatRow, flattenReportingQuery,
  RawReportItem,
} from './sprinklr-report.parser';
import { SprinklrReportService } from './sprinklr-report.service';

/**
 * Agent Summary (voice/Inbound agent performance) tests — built from the Director's real report shape
 * (grain = one row per agent per day). Columns: Date · User · Offered · Taken · Not taken · User Email ·
 * Unique Profiles (Agent) · Talk Time · Avg Talk Time · Hold Time · Avg Hold Time · After Call up Time.
 *
 * Two capture shapes are exercised:
 *  (1) a LABELED table (named cells keyed by the human header) — what a rendered reporting table yields;
 *  (2) a reportingQuery grouped response with M_* measure keys — what the extension harvests live.
 * Staging is empty until the Director opens the report; these fixtures prove the whole chain now.
 */

// (1) LABELED rows — the 3 sample rows verbatim from the Director's screenshot.
const labeledRows: RawReportItem[] = [
  { measures: {}, dims: {
    'Date': 'Thu, Jul 02, 2026', 'User': 'Hussein Hijazi',
    'Offered': 90, 'Taken': 89, 'Not taken': 1,
    'User Email': 'h.hijazi@boutiqaat.com', 'Unique Profiles (Agent)': 79,
    'Talk Time': '03h 38m', 'Average Talk Time': '02m 27s',
    'Hold Time': '17m 31s', 'Average Hold Time': '12s',
    'After Call up Time': '07m 35s',
  } },
  { measures: {}, dims: {
    'Date': 'Tue, Jul 07, 2026', 'User': 'Rand Chbib',
    'Offered': 84, 'Taken': 82, 'Not taken': 2,
    'User Email': 'r.chbib@boutiqaat.com', 'Unique Profiles (Agent)': 70,
    'Talk Time': '03h 24m', 'Average Talk Time': '02m 30s',
    'Hold Time': '09m 26s', 'Average Hold Time': '07s',
    'After Call up Time': '12m 19s',
  } },
  { measures: {}, dims: {
    'Date': 'Sat, Jul 05, 2026', 'User': 'Samar Haroun',
    'Offered': 68, 'Taken': 67, 'Not taken': 1,
    'User Email': 's.haroun@boutiqaat.com', 'Unique Profiles (Agent)': 58,
    'Talk Time': '02h 12m', 'Average Talk Time': '01m 57s',
    'Hold Time': '07m 41s', 'Average Hold Time': '07s',
    'After Call up Time': '04m 26s',
  } },
];

// (2) reportingQuery grouped response (measures as M_* keys, dims in ORIGINAL_EXPANDED_KEY).
const reportingQueryFixture = {
  reportingQuery: {
    responses: [{
      groupedData: [{
        groupBys: ['DAY', 'AGENT', 'AGENT_EMAIL'],
        responses: [{
          key: '5501',
          groupDetails: { id: '5501', name: 'Hussein Hijazi' },
          additional: { ORIGINAL_EXPANDED_KEY: ['2026-07-02', 'Hussein Hijazi', 'h.hijazi@boutiqaat.com'] },
          projections: {
            M_OFFERED: 90, M_TAKEN: 89, M_NOT_TAKEN: 1, M_UNIQUE_PROFILES: 79,
            M_TALK_TIME: 13080, M_AVG_TALK_TIME: 147, M_HOLD_TIME: 1051,
            M_AVG_HOLD_TIME: 12, M_AFTER_CALL_UP_TIME: 455,
          },
        }],
      }],
    }],
  },
};

describe('agent-summary — duration & date helpers', () => {
  it('parses "03h 38m" / "02m 27s" / "12s" / "1h 2m 3s" to seconds', () => {
    expect(toSeconds('03h 38m')).toBe(13080);
    expect(toSeconds('02m 27s')).toBe(147);
    expect(toSeconds('12s')).toBe(12);
    expect(toSeconds('17m 31s')).toBe(1051);
    expect(toSeconds('1h 2m 3s')).toBe(3723);
  });
  it('parses integer counts', () => {
    expect(toInt(90)).toBe(90);
    expect(toInt('1,234')).toBe(1234);
    expect(toInt('n/a')).toBeNull();
  });
  it('normalizes "Thu, Jul 02, 2026" → 2026-07-02', () => {
    expect(normalizeReportDate('Thu, Jul 02, 2026')).toBe('2026-07-02');
    expect(normalizeReportDate('Jul 5, 2026')).toBe('2026-07-05');
    expect(normalizeReportDate('2026-07-02')).toBe('2026-07-02');
  });
  it('classifies header keys to the right agent-summary field', () => {
    expect(classifyAgentSummaryKey('User Email')).toBe('email');
    expect(classifyAgentSummaryKey('Talk Time')).toBe('talkTotal');
    expect(classifyAgentSummaryKey('Average Talk Time')).toBe('talkAvg');
    expect(classifyAgentSummaryKey('After Call up Time')).toBe('acwTotal');
    expect(classifyAgentSummaryKey('Not taken')).toBe('notTaken');
    expect(classifyAgentSummaryKey('M_AVG_HOLD_TIME')).toBe('holdAvg');
    expect(classifyAgentSummaryKey('M_AFTER_CALL_UP_TIME')).toBe('acwTotal');
  });
});

describe('agent-summary — classification', () => {
  it('classifies the labeled table as agent_summary', () => {
    expect(looksLikeAgentSummary(labeledRows)).toBe(true);
    expect(classifyReport(labeledRows)).toBe('agent_summary');
  });
  it('classifies the reportingQuery (M_*) shape as agent_summary', () => {
    const items = flattenReportingQuery(reportingQueryFixture);
    expect(items).toHaveLength(1);
    expect(classifyReport(items)).toBe('agent_summary');
  });
  it('does NOT treat a Yes/No survey row as agent_summary', () => {
    const survey: RawReportItem[] = [{ dims: { email: 'a@b.com', resolved: 'Yes', channel: 'chat' }, measures: {} }];
    expect(looksLikeAgentSummary(survey)).toBe(false);
  });
});

describe('agent-summary — normalization (labeled rows)', () => {
  const rows = parseAgentSummary(labeledRows);

  it('maps every column for row 0 (Hussein)', () => {
    const r = rows[0];
    expect(r.agent_email).toBe('h.hijazi@boutiqaat.com');
    expect(r.user).toBe('Hussein Hijazi');
    expect(r.day).toBe('2026-07-02');
    expect(r.offered).toBe(90);
    expect(r.taken).toBe(89);
    expect(r.notTaken).toBe(1);
    expect(r.uniqueProfiles).toBe(79);
    expect(r.talkSecTotal).toBe(13080);
    expect(r.talkSecAvg).toBe(147);
    expect(r.holdSecTotal).toBe(1051);
    expect(r.holdSecAvg).toBe(12);
    expect(r.acwSecTotal).toBe(455);
    // avg ACW derived from total/taken (report shipped only the total column)
    expect(r.acwSecAvg).toBeCloseTo(455 / 89, 2);
  });

  it('computes AHT = avg talk + avg hold + avg ACW', () => {
    // 147 + 12 + 455/89 = 164.11
    expect(rows[0].ahtSec).toBe(164.11);
    // Rand: 150 + 7 + 739/82 = 166.01
    expect(rows[1].ahtSec).toBe(166.01);
    // Samar: 117 + 7 + 266/67 = 127.97
    expect(rows[2].ahtSec).toBe(127.97);
  });

  it('maps each email to its own row', () => {
    expect(rows.map(r => r.agent_email)).toEqual([
      'h.hijazi@boutiqaat.com', 'r.chbib@boutiqaat.com', 's.haroun@boutiqaat.com',
    ]);
  });
});

describe('agent-summary — normalization (reportingQuery M_* rows)', () => {
  it('maps M_* measures + expandedKey identity', () => {
    const items = flattenReportingQuery(reportingQueryFixture);
    const [r] = parseAgentSummary(items);
    expect(r.agent_email).toBe('h.hijazi@boutiqaat.com');
    expect(r.user).toBe('Hussein Hijazi');
    expect(r.day).toBe('2026-07-02');
    expect(r.offered).toBe(90);
    expect(r.taken).toBe(89);
    expect(r.talkSecTotal).toBe(13080);
    expect(r.talkSecAvg).toBe(147);
    expect(r.holdSecAvg).toBe(12);
    expect(r.acwSecTotal).toBe(455);
    expect(r.ahtSec).toBe(164.11);
  });
});

describe('agent-summary — promotion row builder (pure)', () => {
  const [row0] = parseAgentSummary(labeledRows);

  it('maps to agent_daily_stats columns with an email fallback key', () => {
    const s = agentSummaryToStatRow(row0, {});
    expect(s.stat_date).toBe('2026-07-02');
    expect(s.sprinklr_agent_id).toBe('email:h.hijazi@boutiqaat.com');
    expect(s.agent_name).toBe('Hussein Hijazi');
    expect(s.agent_email).toBe('h.hijazi@boutiqaat.com');
    expect(s.employee_id).toBeNull();
    expect(s.contacts_received).toBe(90);          // ← offered (contacts received)
    expect(s.aht_seconds).toBe(164.11);
    expect(s.avg_response_seconds).toBeNull();
    expect(s.extra.source).toBe('agent_summary');
    expect(s.extra.handled).toBe(89);              // ← taken
    expect(s.extra.talkSecTotal).toBe(13080);
    expect(s.extra.holdSecAvg).toBe(12);
    expect(s.extra.acwSecTotal).toBe(455);
  });

  it('uses the resolved numeric Sprinklr id + employee_id when the identity map has them', () => {
    const s = agentSummaryToStatRow(row0, { sprinklrAgentId: '5501', employeeId: 'emp-uuid-1' });
    expect(s.sprinklr_agent_id).toBe('5501');
    expect(s.employee_id).toBe('emp-uuid-1');
  });
});

describe('agent-summary — promotion upsert shape (service, mocked DataSource)', () => {
  it('upserts one agent_daily_stats row per agent/day with the mapped columns', async () => {
    const calls: { sql: string; params: any[] }[] = [];
    const mockDs: any = {
      query: jest.fn(async (sql: string, params: any[]) => {
        calls.push({ sql, params });
        return /INSERT INTO agent_daily_stats/.test(sql) ? [{}] : []; // identity lookups → unresolved
      }),
    };
    const svc = new SprinklrReportService(mockDs);
    const n = await svc.promoteAgentSummary('tenant-1', labeledRows);
    expect(n).toBe(3);

    const upserts = calls.filter(c => /INSERT INTO agent_daily_stats/.test(c.sql));
    expect(upserts).toHaveLength(3);

    // params order: [tenant, stat_date, sprinklr_agent_id, agent_name, agent_email, employee_id,
    //                contacts_received, aht_seconds, avg_response_seconds, extraJson]
    const p0 = upserts[0].params;
    expect(p0[0]).toBe('tenant-1');
    expect(p0[1]).toBe('2026-07-02');
    expect(p0[2]).toBe('email:h.hijazi@boutiqaat.com');
    expect(p0[4]).toBe('h.hijazi@boutiqaat.com');
    expect(p0[5]).toBeNull();
    expect(p0[6]).toBe(90);
    expect(p0[7]).toBe(164.11);
    const extra = JSON.parse(p0[9]);
    expect(extra.source).toBe('agent_summary');
    expect(extra.handled).toBe(89);
    expect(extra.talkSecTotal).toBe(13080);

    // upsert must be idempotent on the natural key
    expect(upserts[0].sql).toMatch(/ON CONFLICT \(tenant_id, stat_date, sprinklr_agent_id\) DO UPDATE/);
  });
});
