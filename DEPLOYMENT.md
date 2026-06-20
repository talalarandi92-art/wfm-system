# WFM Platform — Production Deployment

Single-server deployment behind a domain with HTTPS. Everything runs in Docker:
Postgres, Redis, the NestJS backend, and an nginx frontend that serves the SPA,
terminates TLS, and reverse-proxies the API + chat WebSocket.

```
            ┌──────────── nginx (frontend) :80/:443 ────────────┐
  browser → │  /            → SPA static files                  │
            │  /api/        → backend:3000                       │
            │  /uploads/    → backend:3000                       │
            │  /socket.io/  → backend:3000 (WebSocket upgrade)   │
            └───────────────────────────────────────────────────┘
                       backend → postgres / redis
```

## 1. Prerequisites

- A Linux server (2 vCPU / 4 GB RAM minimum) with Docker + Docker Compose v2.
- A domain name with a DNS **A record** pointing to the server's public IP.
- Ports **80** and **443** open in the firewall.

## 2. Configure

```bash
git clone <your-repo> wfm && cd wfm
cp .env.production.example .env
```

Edit `.env` and set every value marked `REQUIRED`, plus `DOMAIN` and `CORS_ORIGINS`
(both must be your real `https://your-domain`). Generate secrets:

```bash
openssl rand -hex 48      # JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, SESSION_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD, REDIS_PASSWORD
```

> Keep `.env` off git — it holds all the secrets. (`.gitignore` already excludes it.)

## 3. First-time TLS certificate

nginx won't start without a certificate, so issue one first with certbot in
standalone mode (needs port 80 free — run this **before** starting the stack):

```bash
mkdir -p certbot/conf certbot/www
docker run --rm -p 80:80 \
  -v "$PWD/certbot/conf:/etc/letsencrypt" \
  -v "$PWD/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --standalone \
  -d your-domain.com \
  --email you@example.com --agree-tos --no-eff-email
```

After this, `certbot/conf/live/your-domain.com/` contains the cert. The `certbot`
service in compose renews it automatically every 12h.

## 4. Launch

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

A dedicated `migrate` service runs **all** pending SQL migrations (tracked in a
`schema_migrations` table, idempotent) and must finish before the backend starts.
This applies the full schema + seed + every feature migration on a fresh volume,
**and** new migrations on an existing one. Watch progress:

```bash
docker compose -f docker-compose.prod.yml logs -f migrate backend
```

Visit `https://your-domain.com` and log in with `SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`. **Change the admin password immediately after first login.**

## 5. Updating to a new version

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Existing data is preserved (Postgres/Redis/uploads live in named volumes).
New SQL migrations **are applied automatically** on every `up` by the `migrate`
service (it re-runs only the not-yet-applied files, tracked in `schema_migrations`),
so no manual psql step is needed. To run them on demand:

```bash
docker compose -f docker-compose.prod.yml run --rm migrate
```

## 6. Backups

```bash
# Database
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U wfm_user wfm_db | gzip > backup-$(date +%F).sql.gz

# Uploaded files
docker run --rm -v wfm_uploads_data:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Schedule both via cron. Test a restore before you rely on it.

## 7. Operational notes

- **Logs:** `docker compose -f docker-compose.prod.yml logs -f [service]`
- **Restart one service:** `docker compose -f docker-compose.prod.yml restart backend`
- **Postgres and Redis are not exposed to the host** — only reachable inside the
  Docker network. Don't add host port mappings in production.
- **Uploads** are filtered server-side (allowlist of safe types) and capped at 50 MB.
- The chat WebSocket connects to the **same origin** in production; nginx proxies
  `/socket.io/` to the backend with the required upgrade headers.

## 8. Still recommended before heavy production load

- Wire the socket.io **Redis adapter** so presence/rooms survive a backend restart
  and allow horizontal scaling (Redis is already provisioned).
- Move secrets from `.env` into a secrets manager (Docker secrets / Vault) if the
  host is shared.
- Add uptime monitoring + log aggregation.
- Consider off-site, encrypted backup storage.
