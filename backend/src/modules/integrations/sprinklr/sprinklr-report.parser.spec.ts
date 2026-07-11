import {
  flattenReportingQuery, classifyReport, parseLoginLogout, parseSurvey,
} from './sprinklr-report.parser';

/**
 * A0 parser tests.
 *
 * ⚠ The login/logout reportingQuery JSON was NOT captured live (SPRINKLR_LIVE_REPORTING_FINDINGS
 * §"Honest limits"). These fixtures are REALISTIC constructions from the documented column lists
 * (login/logout: Login ts · Logout ts · Logged-In Time · Logout Cause · Device + Agent Email;
 * survey §12: Date · Agent Email · Channel · resolve Yes/No · Survey Response Count), using the
 * groupedData / ORIGINAL_EXPANDED_KEY shape the extension already reads. When the Director provides
 * the real payload, update the fixtures to the confirmed field order and re-run.
 */

// A grouped reportingQuery response carrying a login/logout TABLE. The dimension tuple sits in
// additional.ORIGINAL_EXPANDED_KEY; the logged-in duration is a measure in projections.
const loginLogoutFixture = {
  reportingQuery: {
    responses: [{
      groupedData: [{
        groupBys: ['AGENT_EMAIL', 'DAY'],
        responses: [
          {
            key: '5501',
            groupDetails: { id: '5501', name: 'a.alhamada@boutiqaat.com' },
            additional: {
              ORIGINAL_EXPANDED_KEY: [
                'a.alhamada@boutiqaat.com', '2026-07-10',
                '2026-07-10 09:02:00', '2026-07-10 18:05:00',
                'Manual Logout', 'Web',
              ],
            },
            projections: { M_LOGGED_IN_TIME: 32580 }, // 9h03m in seconds
          },
          {
            key: '5502',
            groupDetails: { id: '5502', name: 'm.nawaf@boutiqaat.com' },
            additional: {
              ORIGINAL_EXPANDED_KEY: [
                'm.nawaf@boutiqaat.com', '2026-07-10',
                '2026-07-10 13:00:00', '2026-07-10 22:00:00',
                'Session Timeout', 'Mobile',
              ],
            },
            projections: { M_LOGGED_IN_TIME: 32400 },
          },
        ],
      }],
    }],
  },
};

// Survey TABLE (FINDINGS §12): Date · Agent Email · Channel · resolve Yes/No · Survey Response Count.
const surveyFixture = {
  reportingQuery: {
    responses: [{
      groupedData: [{
        groupBys: ['AGENT_EMAIL', 'CHANNEL'],
        responses: [
          {
            key: '5501',
            groupDetails: { id: '5501', name: 'a.alhamada@boutiqaat.com' },
            additional: {
              ORIGINAL_EXPANDED_KEY: ['2026-07-10', 'a.alhamada@boutiqaat.com', 'WhatsApp Business', 'Yes'],
            },
            projections: { M_SURVEY_RESPONSE_COUNT: 4 },
          },
          {
            key: '5502',
            groupDetails: { id: '5502', name: 'm.nawaf@boutiqaat.com' },
            additional: {
              ORIGINAL_EXPANDED_KEY: ['2026-07-10', 'm.nawaf@boutiqaat.com', 'Live Chat', 'No'],
            },
            projections: { M_SURVEY_RESPONSE_COUNT: 2 },
          },
        ],
      }],
    }],
  },
};

// The LIVE agent-status poll the extension already handles — must NOT classify as a report table.
const liveStatusFixture = {
  reportingQuery: {
    responses: [{
      groupedData: [{
        responses: [
          { key: '5501', groupDetails: { name: 'A. Alhamada' }, additional: { ORIGINAL_EXPANDED_KEY: ['5501', 'Bio Break', 'Logged In'] } },
          { key: '5502', groupDetails: { name: 'M. Nawaf' }, additional: { ORIGINAL_EXPANDED_KEY: ['5502', 'Available', 'Logged In'] } },
        ],
      }],
    }],
  },
};

describe('sprinklr-report.parser — login/logout', () => {
  const items = flattenReportingQuery(loginLogoutFixture);

  it('flattens grouped rows', () => {
    expect(items).toHaveLength(2);
    expect(items[0].expandedKey).toContain('a.alhamada@boutiqaat.com');
    expect(items[0].measures.M_LOGGED_IN_TIME).toBe(32580);
  });

  it('classifies as login_logout', () => {
    expect(classifyReport(items)).toBe('login_logout');
  });

  it('normalizes agent_email, day, login/logout minutes, duration, cause, device', () => {
    const rows = parseLoginLogout(items);
    expect(rows).toHaveLength(2);
    const r = rows[0];
    expect(r.agent_email).toBe('a.alhamada@boutiqaat.com');
    expect(r.day).toBe('2026-07-10');
    expect(r.login_min).toBe(9 * 60 + 2);    // 09:02
    expect(r.logout_min).toBe(18 * 60 + 5);  // 18:05
    expect(r.logged_in_sec).toBe(32580);
    expect(r.logout_cause).toBe('Manual Logout');
    expect(r.device).toBe('Web');
    expect(r.needs_confirmation).toBeUndefined();

    expect(rows[1].agent_email).toBe('m.nawaf@boutiqaat.com');
    expect(rows[1].login_min).toBe(13 * 60);
    expect(rows[1].device).toBe('Mobile');
  });
});

describe('sprinklr-report.parser — survey', () => {
  const items = flattenReportingQuery(surveyFixture);

  it('classifies as survey', () => {
    expect(classifyReport(items)).toBe('survey');
  });

  it('normalizes agent_email + channel + resolved + count', () => {
    const rows = parseSurvey(items);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      agent_email: 'a.alhamada@boutiqaat.com',
      day: '2026-07-10',
      channel: 'WhatsApp Business',
      resolved: true,
      response_count: 4,
    });
    expect(rows[1]).toMatchObject({ resolved: false, response_count: 2, channel: 'Live Chat' });
  });
});

describe('sprinklr-report.parser — does not misclassify the live agent-status poll', () => {
  it('live status rows are NOT login_logout or survey', () => {
    const items = flattenReportingQuery(liveStatusFixture);
    const type = classifyReport(items);
    expect(type).not.toBe('login_logout');
    expect(type).not.toBe('survey');
  });
});
