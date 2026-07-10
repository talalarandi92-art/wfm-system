# WFM Platform — Production Deploy Runbook

Paste-ready, numbered, in order. Every port / path / env name below was read
from the code (citations in brackets). Nothing here has been executed — this
pack is **files only**.

Architecture being deployed (single origin):

```
internet ──▶ nginx :80/:443 ──▶ backend :3000 (NestJS, serves API + SPA + /uploads + /socket.io)
                                   │
                          postgres :5432 (internal) · redis :6379 (internal, chat adapter)
```

- API prefix: `/api/v1` (global prefix `api` + URI versioning v1 — `backend/src/main.ts:75-76`)
- SPA served by the backend itself from `FRONTEND_DIST` (`backend/src/main.ts:117-131`) — there is **no separate frontend container**; nginx only proxies `:3000`.
- Health endpoint: `GET /api/v1/health` — public, pings the DB (`backend/src/modules/health/health.controller.ts:9,16-23`).
- Migrations are **manual** — plain SQL files in `database/migrations/` (79 files, `001_initial_schema.sql` → latest) applied by `backend/scripts/migrate.js` into a `schema_migrations` ledger. TypeORM runs with `synchronize: false` and never applies them (`backend/src/app.module.ts:94`). **Nothing auto-migrates on boot.**

---

## 0. Prerequisites (decisions + hardware)

1. **Server**: 1 Linux VM (Ubuntu 22.04/24.04 LTS recommended), 4 vCPU / 8 GB RAM / 80 GB SSD is comfortable; 2 vCPU / 4 GB is the floor. Docker Engine ≥ 24 + docker compose plugin installed.
2. **Domain**: one hostname (e.g. `wfm.boutiqaat.example`) — **NOT YET DECIDED, see gate at the bottom**.
3. **DNS**: an `A` record for that hostname pointing at the server's public IP. Wait for propagation (`dig +short wfm.example.com`) before step 4.
4. **Firewall**: allow inbound 80 + 443 only (plus your SSH port). Postgres/Redis are never exposed publicly — Postgres is loopback-only on the host at `127.0.0.1:5433` for admin tasks (compose file), Redis has no host port at all.
5. On the server, everything lives in one folder, assumed below to be `/opt/wfm` (the repo checkout; `deploy/` is inside it).

## 1. Get the code onto the server

```bash
sudo mkdir -p /opt/wfm && sudo chown "$USER" /opt/wfm
git clone <repo-url> /opt/wfm
cd /opt/wfm/deploy
```

## 2. Create the production env file

```bash
cp prod.env.example prod.env
chmod 600 prod.env
nano prod.env
```

Fill in, at minimum:
- `POSTGRES_PASSWORD`, `REDIS_PASSWORD`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — `openssl rand -hex 64` each, different values
- `CORS_ORIGINS=https://<your-domain>` (single origin — the SPA is served from the same host, `main.ts:110-131`)
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` (needed once, in step 8; clear afterwards)

Every other variable is documented inline in `prod.env.example` with the code line that reads it. **Never** set `ALLOW_DEMO_SEED` in production (`backend/src/database/seeds/seed-demo-users.ts:29` refuses demo users without it — keep it that way).

## 3. Put the real domain into nginx.conf

Edit `deploy/nginx.conf` — replace `wfm.example.com` in **3 places** (both `server_name` lines and the two `ssl_certificate*` paths).

## 4. First-time TLS bootstrap (chicken-and-egg fix)

nginx.conf references certificates that don't exist yet, so nginx would crash-loop on first start. Issue the cert **first** with certbot standalone (it binds :80 itself — nginx must not be running):

```bash
cd /opt/wfm/deploy
docker compose --env-file ./prod.env -f docker-compose.prod.yml run --rm \
  -p 80:80 --entrypoint "" certbot \
  certbot certonly --standalone \
    -d wfm.example.com \
    --email you@example.com --agree-tos --no-eff-email
```

Success = `Successfully received certificate` and the cert lands in the shared `certbot_conf` volume, exactly where nginx.conf looks. From now on the `certbot` compose service renews it automatically via **webroot** (no downtime), and the nginx service reloads itself every 6 h to pick up renewals — both loops are already in `docker-compose.prod.yml`.

## 5. Build and start the stack

```bash
cd /opt/wfm/deploy
docker compose --env-file ./prod.env -f docker-compose.prod.yml up -d --build
docker compose --env-file ./prod.env -f docker-compose.prod.yml ps
```

The backend image build compiles **both** the backend (`nest build`) and the frontend (`vite build`) and bakes the SPA into `/app/frontend/dist` — the exact default path `main.ts:117-119` resolves from the container workdir, additionally pinned by `FRONTEND_DIST` in prod.env. Expected on first boot: backend logs `Serving SPA from /app/frontend/dist` and `Chat socket.io using Redis adapter (redis:6379)`:

```bash
docker compose --env-file ./prod.env -f docker-compose.prod.yml logs backend | tail -20
```

(If Redis were down you'd see the harmless in-memory fallback warning instead — `backend/src/common/adapters/redis-io.adapter.ts:48-51`.)

## 6. Apply database migrations (MANUAL — required, nothing auto-runs)

The migration runner and all SQL files are baked into the backend image (`/app/backend/scripts/migrate.js` + `/app/database/migrations` — layout matches `migrate.js:39` which resolves `<backend>/../database/migrations`):

```bash
# see what's pending (fresh DB: all 79 pending)
docker compose --env-file ./prod.env -f docker-compose.prod.yml exec backend \
  node scripts/migrate.js --status

# apply, in filename order, each in its own transaction
docker compose --env-file ./prod.env -f docker-compose.prod.yml exec backend \
  node scripts/migrate.js
```

Then restart the backend so every module starts against the complete schema:

```bash
docker compose --env-file ./prod.env -f docker-compose.prod.yml restart backend
```

> Migrating an **existing** database instead of a fresh one? Use
> `node scripts/migrate.js --baseline <token>` once to mark already-applied
> files without executing them (`migrate.js:14-19`), then run normally.

## 7. Data note (Boutiqaat-specific)

Migration `002_seed_boutiqaat.sql` creates the tenant + a **placeholder admin user with no usable password**. Real roster/attendance data is loaded separately via the recon pipeline (`docs/RECON_PIPELINE.md`) / in-system Upload & Rebuild — out of scope for this runbook.

## 8. First admin login (seed the admin password)

`npm run seed:admin` runs `backend/src/database/seeds/seed-admin.ts` — it bcrypt-hashes `SEED_ADMIN_PASSWORD` and activates the placeholder admin matching `SEED_ADMIN_EMAIL` in the Boutiqaat tenant (`seed-admin.ts:29-51`). It needs `ts-node` (a devDependency), so it runs from the **repo checkout on the host**, reaching Postgres through the loopback-only `127.0.0.1:5433` mapping:

```bash
cd /opt/wfm/backend
npm ci    # first time only (installs devDeps incl. ts-node)

POSTGRES_HOST=127.0.0.1 POSTGRES_PORT=5433 \
POSTGRES_DB=wfm_db POSTGRES_USER=wfm_user \
POSTGRES_PASSWORD='<from prod.env>' \
SEED_ADMIN_EMAIL='<admin email>' SEED_ADMIN_PASSWORD='<strong password>' \
npm run seed:admin
```

Expected: `Admin password set for: <email>`. Now log in at `https://<domain>/` and **clear `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` from prod.env**.

## 9. Smoke checks

```bash
# 1. HTTP → HTTPS redirect
curl -sI http://wfm.example.com/ | head -3           # expect 301 → https

# 2. Health (public endpoint, DB ping) — health.controller.ts:16-23
curl -s https://wfm.example.com/api/v1/health
# expect {"status":"ok","info":{"database":{"status":"up"}},...}

# 3. SPA served (single origin)
curl -s https://wfm.example.com/ | grep -o '<title>[^<]*'

# 4. Auth wall — any protected route without a token must be 401 (deny-by-default RBAC)
curl -s -o /dev/null -w '%{http_code}\n' https://wfm.example.com/api/v1/users

# 5. Login via the UI, open the chat page, confirm websocket connects
#    (browser devtools → WS → /socket.io/ upgraded to websocket, not polling)
```

Also confirm Swagger is **absent** in production: `https://<domain>/api/docs` should be the SPA fallback, not Swagger (`main.ts:79` gates it to non-production).

## 10. Backups — enable and verify

```bash
cd /opt/wfm/deploy
chmod +x backup/pg-backup.sh backup/pg-restore.sh

# run one manually
./backup/pg-backup.sh
ls -lh backups/

# verify the dump is a valid archive (lists tables without restoring anything)
docker compose --env-file ./prod.env -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_restore -l /backups/'"$(ls backups | tail -1)"' | head'

# install nightly cron (02:15, 14-day rotation is inside the script)
( crontab -l 2>/dev/null; echo '15 2 * * * cd /opt/wfm/deploy && ./backup/pg-backup.sh >> backups/backup.log 2>&1' ) | crontab -
```

Quarterly drill: restore the latest dump into a scratch DB and log in against it. Note: for a **roster-only** undo after a bad recon rebuild, the recon pipeline keeps the in-DB `roster_days_recon_bak` table — use that before reaching for a full restore.

Also back up off-box: sync `deploy/backups/` + `deploy/prod.env` to storage that does not live on this server.

## 11. Update procedure (new release)

```bash
cd /opt/wfm
git pull

cd deploy
# keep a rollback image of what is currently running
docker tag wfm-backend:latest wfm-backend:prev

# take a pre-update backup
./backup/pg-backup.sh

# build + apply migrations + restart (short downtime; do it off-peak)
docker compose --env-file ./prod.env -f docker-compose.prod.yml build backend
docker compose --env-file ./prod.env -f docker-compose.prod.yml up -d backend
docker compose --env-file ./prod.env -f docker-compose.prod.yml exec backend \
  node scripts/migrate.js
docker compose --env-file ./prod.env -f docker-compose.prod.yml restart backend

# smoke: step 9 checks 2–4
```

## 12. Rollback

```bash
cd /opt/wfm/deploy

# 1. put the previous image back
docker tag wfm-backend:prev wfm-backend:latest
docker compose --env-file ./prod.env -f docker-compose.prod.yml up -d backend

# 2. ONLY if the bad release's migrations changed the schema incompatibly,
#    restore the pre-update dump (destructive — loses writes since the dump):
./backup/pg-restore.sh backups/wfm_db_<pre-update-timestamp>.dump
```

The SQL migrations have no down-scripts — DB rollback **is** the pg-restore path. That is why step 11 takes a backup before every update.

---

## Operational notes

- **Volumes that hold state**: `pg_data` (database), `uploads` (attachments — `main.ts:97` puts them at `<cwd>/uploads`), `redis_data`, `certbot_conf`. Never `docker compose down -v` in production.
- **Recon rebuilds** (`node scripts/recon-refresh.js`, month source workbooks) run where the source files live — they are not containerized by this pack. If they must run in-container later, set `RECON_SOURCE_DIR`/`RECON_SCHEDULE_FILE`/`RECON_NEW_DIR` (`recon.controller.ts:21-25`) and mount the folders.
- **Scaling out** to a second backend instance later is already possible: chat presence is shared via the Redis adapter; put both instances behind the same nginx upstream.

---

```
██████████████████████████████████████████████████████████████████
█                                                                █
█   GATED — awaiting server/domain decision (Director).          █
█   This pack is prepared and reviewed, but NOT deployed.        █
█   Do not run against any server until the Director signs off   █
█   on the hosting target and the domain name.                   █
█                                                                █
██████████████████████████████████████████████████████████████████
```
