// perf/k6-smoke-test.js
//
// SMOKE TEST — 1 VU, ~30s. Sanity-only: every endpoint must return 200 and the
// global p95 must stay under 800ms. This is the gate you run first; if it fails,
// don't bother running load/stress.
//
// Run:
//   bash:        TOKEN=$(node perf/mint-token.js) k6 run perf/k6-smoke-test.js
//   PowerShell:  $env:TOKEN = (node perf/mint-token.js); k6 run perf/k6-smoke-test.js
//
// Env vars:
//   TOKEN  (required)  Bearer JWT minted by perf/mint-token.js
//   BASE   (optional)  backend base URL, default http://localhost:3000

import http from 'k6/http';
import { check, sleep, group } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:3000';
const TOKEN = __ENV.TOKEN || '';
const API = `${BASE}/api/v1`;

// Common date window used across the dashboard endpoints.
const FROM = '2026-06-01';
const TO = '2026-06-29';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    // Sanity bar: fast on a single VU, zero failures.
    http_req_duration: ['p(95)<800'],
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
};

function authParams(name) {
  return {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    },
    tags: { endpoint: name },
  };
}

// Each entry: [tag, path]. Order roughly cheapest -> heaviest.
const ENDPOINTS = [
  ['integrity', `/attendance-recon/roster-v2/integrity`],
  ['employee-master', `/attendance-recon/roster-v2/employee-master`],
  ['roster-dashboard', `/attendance-recon/roster-dashboard?from=${FROM}&to=${TO}`],
  ['roster-v2', `/attendance-recon/roster-v2?from=${FROM}&to=${TO}&limit=40&offset=0`],
  [
    'report-builder-grouped',
    `/attendance-recon/report-builder?from=${FROM}&to=${TO}&groupBy=role&kpis=agents,scheduledDays,lateMin,otMin,conformance`,
  ],
  ['report-builder-detail', `/attendance-recon/report-builder?from=${FROM}&to=${TO}`],
  ['hr-matrix', `/attendance-recon/roster-v2/hr-matrix?from=2026-06-01&to=2026-06-07`],
];

export default function () {
  if (!TOKEN) {
    throw new Error('TOKEN env var is empty. Run: TOKEN=$(node perf/mint-token.js) k6 run perf/k6-smoke-test.js');
  }

  for (const [tag, pathOnly] of ENDPOINTS) {
    group(tag, () => {
      const res = http.get(`${API}${pathOnly}`, authParams(tag));
      check(res, {
        [`${tag} status is 200`]: (r) => r.status === 200,
        [`${tag} body not empty`]: (r) => r.body && r.body.length > 0,
      });
    });
    sleep(0.5);
  }
}
