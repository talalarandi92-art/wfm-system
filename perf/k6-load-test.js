// perf/k6-load-test.js
//
// LOAD TEST — staged ramp to 50 then 100 VUs against the read-heavy
// attendance-recon endpoints, using a realistic weighted traffic mix
// (dashboard + roster-v2 are the everyday hot paths; the hr-matrix CSV export
// is rare). Per-endpoint Trend + error-Rate metrics let you see WHICH route
// degrades, not just the global aggregate.
//
// Run:
//   bash:        TOKEN=$(node perf/mint-token.js) k6 run perf/k6-load-test.js
//   PowerShell:  $env:TOKEN = (node perf/mint-token.js); k6 run perf/k6-load-test.js
//
// Env vars:
//   TOKEN  (required)  Bearer JWT minted by perf/mint-token.js
//   BASE   (optional)  backend base URL, default http://localhost:3000

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3000';
const TOKEN = __ENV.TOKEN || '';
const API = `${BASE}/api/v1`;

const FROM = '2026-06-01';
const TO = '2026-06-29';

// ---- per-endpoint custom metrics ----
const dashboardTrend = new Trend('ep_roster_dashboard', true);
const rosterV2Trend = new Trend('ep_roster_v2', true);
const reportGroupedTrend = new Trend('ep_report_builder_grouped', true);
const reportDetailTrend = new Trend('ep_report_builder_detail', true);
const integrityTrend = new Trend('ep_integrity', true);
const employeeMasterTrend = new Trend('ep_employee_master', true);
const hrMatrixTrend = new Trend('ep_hr_matrix', true);

const errorRate = new Rate('endpoint_errors');
const reqCounter = new Counter('endpoint_requests');

export const options = {
  // Ramp 0 -> 50 -> hold -> 100 -> hold -> down. Mirrors a busy intraday window.
  stages: [
    { duration: '30s', target: 50 },  // ramp to 50 VUs
    { duration: '1m', target: 50 },   // hold 50
    { duration: '30s', target: 100 }, // ramp to 100 VUs
    { duration: '2m', target: 100 },  // hold 100 (the real measurement window)
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1500', 'p(99)<3000'],
    http_req_failed: ['rate<0.01'],
    endpoint_errors: ['rate<0.01'],
    checks: ['rate>0.99'],
    // Heaviest routes get their own (looser) ceilings so we can attribute slowness.
    ep_report_builder_detail: ['p(95)<4000'],
    ep_hr_matrix: ['p(95)<6000'],
  },
};

function authParams(name) {
  return {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    },
    tags: { endpoint: name },
    timeout: '60s',
  };
}

// Record a request's result into both the shared and per-endpoint metrics.
function exercise(tag, pathOnly, trend) {
  let res;
  group(tag, () => {
    res = http.get(`${API}${pathOnly}`, authParams(tag));
    trend.add(res.timings.duration);
    reqCounter.add(1);
    const ok = check(res, {
      [`${tag} status is 200`]: (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });
  return res;
}

// Weighted traffic mix. Cumulative thresholds — dashboard + roster-v2 dominate,
// hr-matrix CSV export is deliberately rare (it's the heaviest call).
//   dashboard      35%
//   roster-v2      30%
//   report grouped 15%
//   report detail   8%
//   integrity       6%
//   employee-master 4%
//   hr-matrix       2%
function pickAndRun() {
  const r = Math.random();
  if (r < 0.35) {
    exercise('roster-dashboard', `/attendance-recon/roster-dashboard?from=${FROM}&to=${TO}`, dashboardTrend);
  } else if (r < 0.65) {
    // vary pagination offset to avoid a single hot page / cache sweet-spot
    const offset = Math.floor(Math.random() * 4) * 40;
    exercise('roster-v2', `/attendance-recon/roster-v2?from=${FROM}&to=${TO}&limit=40&offset=${offset}`, rosterV2Trend);
  } else if (r < 0.80) {
    exercise(
      'report-builder-grouped',
      `/attendance-recon/report-builder?from=${FROM}&to=${TO}&groupBy=role&kpis=agents,scheduledDays,lateMin,otMin,conformance`,
      reportGroupedTrend,
    );
  } else if (r < 0.88) {
    exercise('report-builder-detail', `/attendance-recon/report-builder?from=${FROM}&to=${TO}`, reportDetailTrend);
  } else if (r < 0.94) {
    exercise('integrity', `/attendance-recon/roster-v2/integrity`, integrityTrend);
  } else if (r < 0.98) {
    exercise('employee-master', `/attendance-recon/roster-v2/employee-master`, employeeMasterTrend);
  } else {
    exercise('hr-matrix', `/attendance-recon/roster-v2/hr-matrix?from=2026-06-01&to=2026-06-07`, hrMatrixTrend);
  }
}

export default function () {
  if (!TOKEN) {
    throw new Error('TOKEN env var is empty. Run: TOKEN=$(node perf/mint-token.js) k6 run perf/k6-load-test.js');
  }
  pickAndRun();
  // Realistic think-time between actions: 1-3s.
  sleep(1 + Math.random() * 2);
}
