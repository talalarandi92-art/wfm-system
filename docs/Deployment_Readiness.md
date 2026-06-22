# WFM Roster Suite — Deployment Readiness & QA Sign-off

_Generated 2026-06-22 after the canonical-identity + analytics build-out._

## 1. Build & test status (verified)
| Check | Result |
|---|---|
| Backend build (`npx nest build`) | ✅ exit 0 |
| Frontend typecheck (`npx tsc --noEmit`) | ✅ 0 errors |
| Frontend prod build (`npx vite build`) | ✅ built |
| API smoke (all GET endpoints, live DB) | ✅ **187 reachable, 0 × 5xx** |
| Migrations applied | ✅ **62 / 62** |
| Endpoints behind RBAC (`@RequirePermissions`) | ✅ 34 in recon controller |
| Hardcoded secrets scan (new code) | ✅ none (all via `process.env`) |
| OT cross-midnight correction | ✅ OT-before 1.53M → 174k min |
| Identity dedupe | ✅ 163 raw IDs → 141 people |

## 2. Run instructions (local / server)
```bash
# DB (Postgres wfm_db) must be running; env in backend/.env (or repo-root .env):
#   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, JWT_ACCESS_SECRET

cd backend
node scripts/migrate.js            # apply pending migrations (idempotent)
npx nest build && node dist/main.js   # API on :3000  (Swagger /api/docs)

cd frontend
npm run build                      # production bundle in dist/
# or: npx vite --host --port 5173  (dev)
```

### Data pipeline (run in order after new source data lands)
```bash
node scripts/import-roster-master.js [FROM] [TO]   # parse schedule+punch+Ameyo+Sprinklr+Odoo → roster_days
node scripts/backfill-identity.js                  # canonical identity + role-hours + scrub hidden TLs
node scripts/fix-ot-noise.js                       # idempotent cross-midnight OT correction
node scripts/verify-roster-integrity.js            # post-checks (P=0, dedupe, TL audit, role-hours)
```

## 3. Performance (k6)
Scripts ready in `perf/` (k6 not installed on this box — install from https://k6.io/docs):
```bash
TOKEN=$(node perf/mint-token.js) k6 run perf/k6-smoke-test.js     # sanity
TOKEN=$(node perf/mint-token.js) k6 run perf/k6-load-test.js      # 50→100 VUs
TOKEN=$(node perf/mint-token.js) k6 run perf/k6-stress-test.js    # 100→250→500 VUs
```
See `perf/Performance_Test_Report.md` for thresholds (p95<1500ms, p99<3000ms, err<1%) and bottleneck notes (report-builder detail + hr-matrix/master-export are the heaviest; consider response caching for `integrity`/`employee-master`).

## 4. Production hosting
A Docker + nginx/TLS stack is the intended deployment (see prior `production_deployment` setup): API container, Postgres with a persistent volume, nginx reverse-proxy terminating TLS and serving the built frontend, daily DB backup. Before go-live:
- Set strong `JWT_ACCESS_SECRET`; enable real password hashing for any seeded users.
- Serve over HTTPS only; set secure cookie/CORS for the real domain.
- Restrict DB to the app network; rotate the DB password.
- Schedule the data pipeline (cron) after each source-data refresh.

## 5. Security checklist
- [x] All roster endpoints require a permission (`@RequirePermissions`).
- [x] RBAC enforced (admin=all; RTA+TL=admin-minus-settings; agent=own-only).
- [x] No secrets in source; all credentials from env.
- [x] Repo holds code only — no PII workbooks committed.
- [ ] HTTPS + secure headers (set at nginx in prod).
- [ ] Rate-limit auth + heavy exports at the proxy.

## 6. Honest open items / data limits
- **Permission HC impact is day-granularity** — `roster_days` stores permission type/duration but not exact start/end minute, so intra-day (half-hourly) permission placement isn't possible.
- **`hire_date` / `termination_date` not populated** in the employee master — genuine resignations aren't auto-flagged; team-leader departures are handled via the editable `team_leader_status` table.
- **Aya Ruiz removed** (514 roster labels nulled) — those agents show with no team leader until reassigned via the TL-management panel.
- **MD/Team-Leader coverage% can read low** in the daily impact view because some roles don't log into the agent systems — present is login-based.

## 7. Final sign-off checklist
- [x] Identity unified (one person = one row); inactive excluded by default.
- [x] HR-matrix emits SL/A/shift/OFF/L/H/WFH/DL/COMP — **never "P"**.
- [x] Sick/absent keep original shift; mothers 7h; 8h roles (RTA/Resolution/TL) excluded from tardiness; Customer Care 9h.
- [x] WFH = system login + no punch + schedule match.
- [x] OT before/after/OFF/holiday/COMP/cross-midnight captured & corrected.
- [x] Tardiness bands, shift-rate, conformance, coverage curve, permission/leave impact.
- [x] Custom Report Builder (+36 presets) + Custom Dashboard Builder.
- [x] Schedule change/swap log with before/after impact + revert.
- [x] Data-quality audit, Employee_Master_Clean, multi-sheet Excel master.
- [x] Executive Overview, Agent 360, Interval Headcount, System Audit.
- [x] 187 endpoints green, 62 migrations applied, frontend builds clean.
