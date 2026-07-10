#!/usr/bin/env bash
# ============================================================================
# WFM Platform — PostgreSQL restore (run on the DOCKER HOST)
#
# *** DESTRUCTIVE ***  Drops and recreates every object in wfm_db from the
# given dump (pg_restore --clean --if-exists). All data written after the
# dump was taken is LOST.
#
# Usage:
#   ./backup/pg-restore.sh backups/wfm_db_2026-07-10_021500.dump
#
# The script:
#   1. shows the dump file and target DB,
#   2. requires you to type RESTORE to proceed,
#   3. stops the backend (so nothing writes mid-restore),
#   4. restores, then starts the backend again.
#
# For a roster-only undo after a bad recon rebuild, prefer the in-DB
# roster_days_recon_bak table (kept by the recon pipeline) — no full
# restore needed for that case.
# ============================================================================
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

COMPOSE=(docker compose --env-file ./prod.env -f docker-compose.prod.yml)

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Usage: $0 backups/wfm_db_<timestamp>.dump" >&2
  echo "Available dumps:" >&2
  ls -lh backups/wfm_db_*.dump 2>/dev/null >&2 || echo "  (none)" >&2
  exit 1
fi

# The container sees the file under /backups
DUMP_IN_CONTAINER="/backups/$(basename "$DUMP")"

echo "=============================================================="
echo "  RESTORE TARGET : wfm_db (postgres service)"
echo "  DUMP FILE      : $DUMP ($(ls -lh "$DUMP" | awk '{print $5}'))"
echo "  THIS DESTROYS all data written after the dump was taken."
echo "=============================================================="
read -r -p "Type RESTORE to proceed: " CONFIRM
if [ "$CONFIRM" != "RESTORE" ]; then
  echo "Aborted — nothing was changed."
  exit 1
fi

echo "[1/4] Stopping backend (prevents writes during restore)…"
"${COMPOSE[@]}" stop backend

echo "[2/4] Restoring…"
"${COMPOSE[@]}" exec -T postgres sh -c \
  'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" "'"$DUMP_IN_CONTAINER"'"'

echo "[3/4] Starting backend…"
"${COMPOSE[@]}" start backend

echo "[4/4] Verifying health…"
sleep 10
"${COMPOSE[@]}" exec -T backend wget -q -O - http://127.0.0.1:3000/api/v1/health && echo
echo "Restore complete. Spot-check the app before announcing recovery."
