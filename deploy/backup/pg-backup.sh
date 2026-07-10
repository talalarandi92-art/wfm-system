#!/usr/bin/env bash
# ============================================================================
# WFM Platform — nightly PostgreSQL backup (run on the DOCKER HOST)
#
# Dumps the whole wfm_db in pg_dump custom format (-Fc, compressed, restorable
# table-by-table) into deploy/backups/ (mounted at /backups inside the
# postgres container), then deletes dumps older than 14 days.
#
# Cron (as the deploy user), nightly at 02:15:
#   15 2 * * * cd /opt/wfm/deploy && ./backup/pg-backup.sh >> backups/backup.log 2>&1
#
# Note: for a quick in-DB roster undo (bad recon rebuild), there is also the
# roster_days_recon_bak table kept by the recon pipeline — that covers roster
# rollback without a full restore. This script is the real disaster-recovery
# layer; the bak table is not a substitute for it.
# ============================================================================
set -euo pipefail

# Resolve deploy/ regardless of where the script is invoked from
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

COMPOSE=(docker compose --env-file ./prod.env -f docker-compose.prod.yml)
STAMP="$(date +%Y-%m-%d_%H%M%S)"
KEEP_DAYS=14

mkdir -p backups

echo "[$(date -Is)] Starting pg_dump → /backups/wfm_db_${STAMP}.dump"

# Runs inside the postgres container; POSTGRES_USER/POSTGRES_DB come from the
# container's own environment (set in docker-compose.prod.yml).
"${COMPOSE[@]}" exec -T postgres sh -c \
  'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "/backups/wfm_db_'"${STAMP}"'.dump"'

# Sanity: refuse to rotate if tonight's dump is missing or suspiciously small
DUMP="backups/wfm_db_${STAMP}.dump"
if [ ! -s "$DUMP" ]; then
  echo "[$(date -Is)] ERROR: dump file missing or empty — NOT rotating old backups." >&2
  exit 1
fi
SIZE=$(wc -c < "$DUMP")
if [ "$SIZE" -lt 100000 ]; then
  echo "[$(date -Is)] WARNING: dump is only ${SIZE} bytes — verify before trusting it." >&2
fi

# 14-day rotation
find backups -name 'wfm_db_*.dump' -mtime +"$KEEP_DAYS" -print -delete

echo "[$(date -Is)] Done. Current backups:"
ls -lh backups/wfm_db_*.dump | tail -5
