# Architecture, build & environment

## Stack
- **Backend:** NestJS + TypeScript, PostgreSQL + TypeORM (`synchronize: false` — SQL migrations are the
  source of truth), JWT (URI-versioned `/api/v1/`), RBAC, append-only audit log, Swagger. Modular monolith.
  `request.user` = the User entity → use `user.id` / `user.tenantId` (NOT `user.sub`). Login field on the
  response = `accessToken`. socket.io with a Redis adapter for scale.
- **Frontend:** React + TypeScript + Vite. `useUiStore` (lang/dark). `apiClient` (axios; returns `.data`).
  `ds`/`card` styling. Role-based routing. Arabic/English, RTL/LTR, light/dark.
- **DB:** ~35 tables; migrations under `database/migrations/NNN_*.sql` (current high-water ~034). Audit,
  attachments, approval-workflow, request envelope + extension tables, headcount interval snapshots.

## Repo layout
- Primary working dir: `backend/`. Frontend: `frontend/`. Migrations: `database/migrations/`.
- The user's real operational data + reports live under `My work/` (OPS, Score Card 2026, etc.).

## Build / run (verify before adding modules)
- `npm install` → `npm run build` → tests if present. Fix broken imports/types/runtime first.
- Dev server (`nest start --watch`) is **unreliable** — it often doesn't reload. To restart cleanly:
  kill the process on port 3000 (PowerShell) then `preview_start`.
- Standalone Node tools (e.g. scorecard generators) run from `backend/` which has `xlsx` + `exceljs`.

## Excel I/O
- **Read:** SheetJS `xlsx` returns raw numbers (time cells as day-fractions). **Write:** `exceljs`
  (preserves formulas, set `calcProperties.fullCalcOnLoad = true`). Caveat: `exceljs` returns time-format
  cells as **Date objects** on read (rounds to the second) — convert back to day-fraction, or read raw
  numbers via SheetJS for exact comparison.
- Time in Excel = day-fraction (AHT/FRT formatted `[h]:mm:ss`). Round-half-up percentages with
  `Math.round(v*100)` before scoring.

## Environment gotchas (Windows, user `t.bassam`)
- The dotted username makes the 8.3 short TEMP path `T573E~1.BAS`, which **breaks npm/electron builds**.
  Fix: set `$env:TEMP` to the long form before building.
- Shell is PowerShell (primary) + a Bash tool (POSIX). Use the right syntax per tool.

## Async-job rule
Heavy operations run as **background/queue jobs**, never inline: large Excel import/export, schedule
generation, attendance recalculation, HC-interval recalc, shift-rate YTD recalc, scorecard recalc,
report generation, bulk notifications. Imports always: preview → validate → row errors → commit; raw
rows stored in `import_batches`/`import_rows`.

## Deployment
Target: VPS / Docker stack + nginx + TLS for server+domain hosting (planned 2026-06-13). Redis adapter
already wired for socket scale.
