// perf/k6-stress-test.js
//
// STRESS TEST — push past normal load (100 -> 250 -> 500 VUs) to find the
// breaking point. The run ABORTS early if the error rate exceeds 5% (the system
// is clearly saturated; no point burning the remaining stages). A teardown()
// summary prints the key takeaways to the console.
//
// Run:
//   bash:        TOKEN=$(node perf/mint-token.js) k6 run perf/k6-stress-test.js
//   PowerShell:  $env:TOKEN = (node perf/mint-token.js); k6 run perf/k6-stress-test.js
//
// Env vars:
//   TOKEN  (required)  Bearer JWT minted by perf/mint-token.js
//   BASE   (optional)  backend base URL, default http://localhost:3000
//
// NOTE: 500 VUs from a single load generator is demanding on the *client* too.
// If the laptop running k6 saturates before the backend does, run k6 from a
// separate box (or use a smaller mix) so you measure the server, not the client.

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3000';
const TOKEN = __ENV.TOKEN || '';
const API = `${BASE}/api/v1`;

const FROM = '2026-06-01';
const TO = '2026-06-29';

const respTrend = new Trend('stress_response_time', true);
const errorRate = new Rate('stress_errors');
const reqCounter = new Counter('stress_requests');

export const options = {
  stages: [
    { duration: '1m', target: 100 },  // warm up to normal peak
    { duration: '2m', target: 250 },  // 2.5x normal peak
    { duration: '2m', target: 500 },  // 5x normal peak — expected to hurt
    { duration: '1m', target: 0 },    // recovery / cooldown
  ],
  thresholds: {
    // abortOnFail: if the system starts failing >5% of requests, stop the test
    // immediately rather than hammering a dead service for the remaining stages.
    http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '20s' }],
    http_req_duration: ['p(95)<5000'],
  },
};

function authParams(name) {
  return {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    },
    tags: { endpoint: name },
    timeout: '90s',
  };
}

function exercise(tag, pathOnly) {
  let res;
  group(tag, () => {
    res = http.get(`${API}${pathOnly}`, authParams(tag));
    respTrend.add(res.timings.duration);
    reqCounter.add(1);
    const ok = check(res, {
      [`${tag} status is 200`]: (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });
  return res;
}

// Same weighted mix as the load test, so the stress profile is comparable.
function pickAndRun() {
  const r = Math.random();
  if (r < 0.35) {
    exercise('roster-dashboard', `/attendance-recon/roster-dashboard?from=${FROM}&to=${TO}`);
  } else if (r < 0.65) {
    const offset = Math.floor(Math.random() * 4) * 40;
    exercise('roster-v2', `/attendance-recon/roster-v2?from=${FROM}&to=${TO}&limit=40&offset=${offset}`);
  } else if (r < 0.80) {
    exercise(
      'report-builder-grouped',
      `/attendance-recon/report-builder?from=${FROM}&to=${TO}&groupBy=role&kpis=agents,scheduledDays,lateMin,otMin,conformance`,
    );
  } else if (r < 0.88) {
    exercise('report-builder-detail', `/attendance-recon/report-builder?from=${FROM}&to=${TO}`);
  } else if (r < 0.94) {
    exercise('integrity', `/attendance-recon/roster-v2/integrity`);
  } else if (r < 0.98) {
    exercise('employee-master', `/attendance-recon/roster-v2/employee-master`);
  } else {
    exercise('hr-matrix', `/attendance-recon/roster-v2/hr-matrix?from=2026-06-01&to=2026-06-07`);
  }
}

export default function () {
  if (!TOKEN) {
    throw new Error('TOKEN env var is empty. Run: TOKEN=$(node perf/mint-token.js) k6 run perf/k6-stress-test.js');
  }
  pickAndRun();
  // Tighter think-time than the load test — stress wants to drive concurrency up.
  sleep(0.5 + Math.random());
}

export function teardown() {
  // Runs once after all stages (or after an abort). Detailed numbers are in the
  // standard k6 end-of-test summary; this is a human-readable signpost.
  console.log('==================================================================');
  console.log(' STRESS TEST COMPLETE');
  console.log(' Review the k6 summary above for the breaking point:');
  console.log('   - stress_response_time  (avg / p95 / p99 by stage in the graph)');
  console.log('   - stress_errors         (the VU count where this climbs = the knee)');
  console.log('   - http_req_failed       (>5% triggers abortOnFail = saturation)');
  console.log(' If the run aborted early, the last stable VU level before the abort');
  console.log(' is your practical capacity ceiling for this endpoint mix.');
  console.log('==================================================================');
}
