# WFM Backend — Performance Test Suite (k6)

**System under test:** Boutiqaat Contact Center WFM — NestJS backend
**Target:** `http://localhost:3000` (global prefix + versioning → routes are `/api/v1/...`)
**Tooling:** [Grafana k6](https://k6.io/docs/) load-testing engine
**Scope:** read-heavy `attendance-recon` reporting endpoints (roster dashboard, roster grid, report builder, integrity, employee master, HR-matrix CSV export)
**Author:** WFM Platform Engineering
**Status:** Ready to run — scripts are self-contained; nothing was executed as part of authoring (k6 may not be installed on the authoring host).

---

## 1. Why these endpoints

These are the production "hot paths" of the roster module — the GETs that the WFM, RTA, and TL dashboards fan out to on every page load and date-range change. They are the right thing to load-test because they:

- are **read-heavy and aggregation-heavy** (they scan the per-day roster table, ~17k `(employee, day)` rows for a full month);
- are **called interactively** (a user changing a date range re-issues all of them);
- include a **CSV export** (`hr-matrix`) that materializes a full wide matrix — the single most expensive call in the module.

| # | Endpoint | Query | Weight in mix | Cost profile |
|---|----------|-------|--------------:|--------------|
| 1 | `/api/v1/attendance-recon/roster-dashboard` | `from=2026-06-01&to=2026-06-29` | 35% | medium — month aggregation |
| 2 | `/api/v1/attendance-recon/roster-v2` | `from&to&limit=40&offset=0` | 30% | low/medium — paginated grid |
| 3 | `/api/v1/attendance-recon/report-builder` (grouped) | `from&to&groupBy=role&kpis=…` | 15% | medium — grouped KPIs |
| 4 | `/api/v1/attendance-recon/report-builder` (detail) | `from&to` (no group) | 8% | **heavy** — full detail scan |
| 5 | `/api/v1/attendance-recon/roster-v2/integrity` | — | 6% | low — changes rarely |
| 6 | `/api/v1/attendance-recon/roster-v2/employee-master` | — | 4% | low — changes rarely |
| 7 | `/api/v1/attendance-recon/roster-v2/hr-matrix` | `from=2026-06-01&to=2026-06-07` | 2% | **heaviest** — wide CSV export |

All endpoints require a **JWT Bearer** header.

> **Login assumption.** There is no public, safe-to-hammer login endpoint, so we do **not** load-test authentication. We mint **one** `platform_admin` JWT out-of-band and reuse it across all VUs ("token reuse" = simulated logged-in session). This isolates the *data/query* cost — which is what we want to measure — from auth/bcrypt cost. If you later need to characterize login throughput, that requires a separate, rate-limited test against the real auth flow.

---

## 2. Prerequisites

### 2.1 Install k6

Full docs: <https://k6.io/docs/get-started/installation/>

- **Windows (winget):** `winget install k6 --source winget`
- **Windows (Chocolatey):** `choco install k6`
- **macOS (Homebrew):** `brew install k6`
- **Linux (Debian/Ubuntu):**
  ```bash
  sudo gpg -k
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
  sudo apt-get update && sudo apt-get install k6
  ```
- **Docker (no install):** `docker run --rm -i grafana/k6 run - < perf/k6-load-test.js` (pass env with `-e TOKEN=... -e BASE=...`; on Linux add `--network=host` to reach `localhost:3000`).

Verify: `k6 version`

### 2.2 Token minting dependencies

`perf/mint-token.js` reuses the backend's existing dependencies (`jsonwebtoken`, `pg`). Run it from a place where those resolve — easiest is to run `node` with the repo's `backend/node_modules` on the path, i.e. run from the repo root after `npm install` has been done in `backend/`. The script loads env from `backend/.env` then repo-root `.env`, connects to Postgres, picks an active `platform_admin` user, and signs `{ sub, tenantId }` with `JWT_ACCESS_SECRET` (HS256), exactly like `backend/scripts/smoke-get.js`.

The backend must be **running** and the **database reachable** with real data loaded (the project's live local Postgres `wfm_db` already contains real attendance data).

---

## 3. How to mint the token and run each script

The token must be minted first and passed in via the `TOKEN` env var. `BASE` is optional (defaults to `http://localhost:3000`).

### 3.1 bash / git-bash / macOS / Linux

```bash
# Smoke (run this first — gate)
TOKEN=$(node perf/mint-token.js) k6 run perf/k6-smoke-test.js

# Load (50 → 100 VUs)
TOKEN=$(node perf/mint-token.js) k6 run perf/k6-load-test.js

# Stress (100 → 250 → 500 VUs)
TOKEN=$(node perf/mint-token.js) k6 run perf/k6-stress-test.js

# Override base URL if the backend is elsewhere
BASE=http://127.0.0.1:3000 TOKEN=$(node perf/mint-token.js) k6 run perf/k6-load-test.js
```

### 3.2 Windows PowerShell

```powershell
# Smoke (run this first — gate)
$env:TOKEN = (node perf/mint-token.js); k6 run perf/k6-smoke-test.js

# Load (50 → 100 VUs)
$env:TOKEN = (node perf/mint-token.js); k6 run perf/k6-load-test.js

# Stress (100 → 250 → 500 VUs)
$env:TOKEN = (node perf/mint-token.js); k6 run perf/k6-stress-test.js

# Override base URL
$env:BASE = "http://127.0.0.1:3000"; $env:TOKEN = (node perf/mint-token.js); k6 run perf/k6-load-test.js
```

> `mint-token.js` prints the JWT **alone** on stdout (diagnostics go to stderr), so `$(...)` / `(node ...)` capture only the token. The token TTL defaults to 2h (`PERF_TOKEN_TTL` to override) so it outlives even a long stress run.

### 3.3 Useful k6 flags

- `--out json=results.json` — dump raw samples for offline analysis.
- `--summary-export=summary.json` — machine-readable end-of-test summary.
- `--vus N --duration Ts` — quick ad-hoc override (ignores the staged profile).
- `--http-debug=full` — dump request/response (debugging only; very noisy).

---

## 4. Test scenarios

| Script | Profile | Purpose | Key thresholds |
|--------|---------|---------|----------------|
| `k6-smoke-test.js` | 1 VU, 30s | Sanity gate — every endpoint returns 200, fast | `p95 < 800ms`, `http_req_failed == 0`, `checks == 100%` |
| `k6-load-test.js` | 0→50→100 VUs, staged (~4.5 min) | Expected peak load with realistic weighted mix | `p95 < 1500ms`, `p99 < 3000ms`, `http_req_failed < 1%` |
| `k6-stress-test.js` | 100→250→500 VUs, staged (~6 min) | Find the breaking point | `http_req_failed < 5%` with **abortOnFail**; `p95 < 5000ms` |

### 4.1 Load profile (staged ramp)

```
VUs
100 |                 __________
    |                /          \
 50 |    ___________/            \
    |   /                         \
  0 |__/___________________________\____ time
    0  30s   1m30s  2m   4m       4m30s
```

### 4.2 Stress profile (find the knee)

```
VUs
500 |                    __________
    |                   /          \
250 |          ________/            \
    |         /                      \
100 |________/                        \___
  0 |________________________________________ time
    0   1m       3m        5m          6m
```

The stress test **aborts early** (after a 20s grace window) if `http_req_failed` climbs above 5% — once the service is shedding >5% of requests it's saturated and there's no value in continuing to ramp. The last stable VU level before the abort is your practical capacity ceiling for this endpoint mix.

### 4.3 Traffic mix (load & stress)

Weighted to mirror real dashboard usage — the everyday grid/dashboard calls dominate, the CSV export is rare:

```
roster-dashboard        ███████ 35%
roster-v2               ██████  30%
report-builder grouped  ███     15%
report-builder detail   ██       8%
integrity               █        6%
employee-master         ▌        4%
hr-matrix (CSV)         ▎        2%
```

`roster-v2` randomizes its `offset` (0/40/80/120) so we don't accidentally test a single hot/cached page.

---

## 5. Metrics captured

k6 reports these out of the box plus the custom metrics the scripts add:

| Metric | What it tells you |
|--------|-------------------|
| `http_req_duration` avg / p90 / **p95** / **p99** / max | Response-time distribution. p95/p99 are the SLA-relevant tail. |
| `http_req_failed` (rate) | Error rate — non-2xx and transport failures. The reliability headline. |
| `http_reqs` (count + **rate/s**) | Throughput (RPS) — how many requests/sec the system served. |
| `iterations` / `iteration_duration` | Completed VU iterations and end-to-end loop time. |
| `vus` / `vus_max` | Concurrency actually achieved. |
| `data_received` / `data_sent` | Bandwidth — `hr-matrix` CSV dominates `data_received`. |
| `checks` (rate) | % of `check()` assertions that passed (status 200, non-empty body). |
| **`ep_*` Trends** (load test) | **Per-endpoint** response time — `ep_roster_dashboard`, `ep_roster_v2`, `ep_report_builder_grouped`, `ep_report_builder_detail`, `ep_integrity`, `ep_employee_master`, `ep_hr_matrix`. This is how you attribute slowness to a specific route. |
| `endpoint_errors` / `stress_errors` (Rate) | Custom per-suite error rate, independent of transport-level `http_req_failed`. |
| `endpoint_requests` / `stress_requests` (Counter) | Total exercised requests. |

All requests are also tagged with `endpoint:<name>`, so in `--out json` / Grafana you can slice every standard metric by endpoint too.

---

## 6. Pass / fail thresholds (the gate)

A run is **PASS** only if every threshold below holds; k6 exits non-zero if any fail (CI-friendly).

| Suite | Threshold | Rationale |
|-------|-----------|-----------|
| Smoke | `http_req_duration p95 < 800ms` | Single-VU baseline must be snappy. |
| Smoke | `http_req_failed == 0` | Any error at 1 VU is a real bug, not load. |
| Smoke | `checks rate == 1` | Every endpoint returns 200 + body. |
| Load | `http_req_duration p95 < 1500ms` | Interactive SLA under expected peak. |
| Load | `http_req_duration p99 < 3000ms` | Tail latency cap. |
| Load | `http_req_failed < 1%` | Near-zero errors at peak. |
| Load | `ep_report_builder_detail p95 < 4000ms` | Heaviest JSON path — looser, attributed. |
| Load | `ep_hr_matrix p95 < 6000ms` | Heaviest export — looser, attributed. |
| Stress | `http_req_failed < 5%` (**abortOnFail**) | Saturation guard — stop when shedding load. |
| Stress | `http_req_duration p95 < 5000ms` | Degraded-but-alive bar. |

---

## 7. Expected bottlenecks for this workload

This is a **read-mostly, aggregation-bound** workload. Under load, expect the database — not Node — to be the first thing to bend.

1. **`report-builder` detail mode (no `groupBy`)** — returns the full per-`(employee, day)` detail set for the window. For a month that's on the order of **~17k roster rows** scanned and serialized to JSON. Largest CPU + serialization cost of the JSON endpoints; first to blow its p95 under concurrency.

2. **`hr-matrix` CSV export** — materializes a wide employee × day matrix and streams it as CSV. Even over a 7-day window it's the heaviest single call (most `data_received`, most string building). Kept to **2%** of the mix on purpose; in real life it should be download-throttled / job-queued, not hammered.

3. **`roster-dashboard` aggregations** — month-wide group/aggregate over the same roster table. Repeated identical date windows across 50–100 VUs all recompute the same aggregate — a natural caching candidate (§8).

4. **Database query pattern.** The endpoints under test read the WFM master table `roster_days` (migrations `053`–`058`, ~17.3k rows), not the older `roster_daily` ingestion cache. Relevant indexes:
   - `idx_roster_person` on `(tenant_id, person_no)` — canonical-person dedupe in the dashboard rankings (migration 058)
   - `idx_roster_active` on `(tenant_id, is_active)` — default active-only filter (migration 058)
   - `idx_roster_roleinc` on `(tenant_id, include_tardiness)` — tardiness-role exclusion (migration 058)
   - a `(tenant_id, work_date)` index from the base roster_days migration backing the date-range scans

   The heaviest scans are the `report-builder` detail mode and the `hr-matrix` CSV (full month, all columns) and the `master-export` Fact sheet (up to 50k rows). **Confirm with `EXPLAIN ANALYZE`** that month-range queries hit the `(tenant_id, work_date)` index. Recommended additions if row counts grow into the hundreds of thousands: a composite `(tenant_id, work_date, is_active)` covering index, and response caching for `integrity` / `employee-master` (change rarely).

   > **Naming note for the index recommendation.** The original task referenced a `roster_days` table and a `(tenant_id, person_no)` index "already present per migration 058." In this codebase the live table is **`roster_daily`** with column **`employee_no`** (not `person_no`), and the equivalent of the `(tenant_id, person_no)` index — `idx_roster_daily_emp` on `(tenant_id, employee_no)` — **already exists** (created in `roster-ingestion.service.ts`, not a numbered SQL migration). The composite recommendation below is mapped onto the real schema; treat `is_active` filtering as belonging to the employee/identity table, not `roster_daily`.

5. **DB connection pool exhaustion.** At 250–500 VUs, concurrent requests will exceed the TypeORM/`pg` pool size (default ~10). Requests then queue waiting for a connection — latency climbs sharply with **no** corresponding rise in DB CPU. This is the most likely cause of the stress-test knee, and it's a config fix, not a code fix (§8).

6. **JSON serialization & GC in Node.** Large detail/dashboard payloads stress V8's serializer and trigger GC pauses under high RPS. Gzip (§8) reduces bytes on the wire; pagination caps reduce object counts.

---

## 8. Bottleneck recommendations

Ordered by effort-to-impact:

1. **Size the DB connection pool deliberately.** Set the `pg`/TypeORM pool `max` to roughly `(number of backend instances) × (pool per instance)` ≤ Postgres `max_connections`. For a single instance, a pool of **20–30** is a reasonable starting point; measure connection wait time and tune. This is usually the single biggest win at 250–500 VUs. Pair with sane `statement_timeout` so a runaway query can't pin a connection.

2. **Cache the rarely-changing reads.** `integrity` and `employee-master` change only on re-ingest. Put a short-TTL cache in front of them (in-process LRU or Redis, keyed by `tenant_id`) and invalidate on roster ingest. Also cache `roster-dashboard` keyed by `(tenant_id, from, to)` for ~30–60s — dozens of VUs request the identical month window, so the hit rate is very high.

3. **Verify / add composite indexes and check the plan.** Confirm `idx_roster_daily_date (tenant_id, work_date)` is used for the month-range scans via `EXPLAIN ANALYZE`. If dashboard/report queries also filter by an active/employee dimension, add a covering composite (e.g. `(tenant_id, work_date, employee_no)`) so the aggregate can be index-only. Per-employee filters are already covered by `idx_roster_daily_emp (tenant_id, employee_no)` — the equivalent of the requested `(tenant_id, person_no)` index, **which already exists**. Run `ANALYZE roster_daily` after bulk ingests so the planner has fresh stats.

4. **Enforce pagination caps.** `roster-v2` is already paginated (`limit/offset`). Cap `limit` server-side (e.g. max 200) so a client can't request the whole month in one page. Prefer **keyset/seek pagination** over large `OFFSET` for deep pages (`OFFSET` still scans skipped rows).

5. **Throttle / queue the heavy export.** `hr-matrix` CSV should be rate-limited per user and, for large windows, generated as an async job (return a job id, stream the file when ready) rather than synchronously on the request thread. This keeps a few concurrent exports from starving interactive traffic.

6. **Enable gzip/Brotli compression.** The JSON detail payloads and CSV export are highly compressible. Enabling response compression (NestJS `compression` middleware or at the reverse proxy) cuts `data_received` and tail latency on the big responses substantially. k6 sends `Accept-Encoding` and decompresses automatically, so the suite will reflect the gain.

7. **Stream large responses.** For `report-builder` detail and `hr-matrix`, stream rows instead of building one giant in-memory array/string — flattens the memory/GC spike at high concurrency.

8. **Run k6 off-box for the 500-VU stage.** At 500 VUs the *load generator* itself can become the bottleneck. If the laptop running k6 saturates before the backend does, you measure the client, not the server. Run the stress test from a separate machine (or distributed k6) when chasing the true ceiling.

---

## 9. Deliverables in this folder

| File | Purpose |
|------|---------|
| `perf/mint-token.js` | Mints + prints a `platform_admin` JWT (env → pg → `jwt.sign`), modeled on `backend/scripts/smoke-get.js`. |
| `perf/k6-smoke-test.js` | 1 VU / 30s sanity gate. |
| `perf/k6-load-test.js` | Staged 50→100 VU load with per-endpoint Trend metrics and weighted mix. |
| `perf/k6-stress-test.js` | Staged 100→250→500 VU stress with abortOnFail + teardown summary. |
| `perf/Performance_Test_Report.md` | This document. |

---

## 10. Interpreting results — quick guide

- **Smoke fails** → a real functional bug or a slow query even at rest. Fix before any load run.
- **Load p95/p99 OK, per-endpoint Trends spiky** → look at which `ep_*` metric is high; that's your target for caching/indexing.
- **Load `http_req_failed` rising while DB CPU is low** → connection pool starvation (§8.1), not query cost.
- **Stress aborts at a given VU level** → that's your practical ceiling for this mix; capacity-plan instance count from there.
- **`data_received` dominated by `hr-matrix`** → confirms the export is the bandwidth/serialization hog; throttle + compress (§8.5, §8.6).
