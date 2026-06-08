# WFM Platform

Enterprise Workforce Management Platform for Boutiqaat Contact Center.

---

> **PROPRIETARY AND CONFIDENTIAL**
>
> This software and its source code are proprietary and confidential.
> Unauthorized copying, distribution, modification, reverse engineering,
> decompilation, or use in any form is strictly prohibited without prior
> written permission from the owner.
>
> All intellectual property rights are reserved.

---

## Overview

A full-featured WFM platform comparable in scope to NICE, Verint, Calabrio,
and Genesys WFM. Built for 24/7 omnichannel contact center operations supporting
scheduling, attendance, real-time monitoring, capacity planning, scorecards,
and operational workflows.

Supports: 1,000+ concurrent active users | Arabic/English | RTL/LTR | SaaS-ready

---

## Tech Stack

| Layer      | Technology                               |
|------------|------------------------------------------|
| Backend    | NestJS · TypeScript · PostgreSQL · Redis |
| Frontend   | React · TypeScript · Vite                |
| Queue      | BullMQ (Redis-backed)                    |
| Auth       | JWT (access + rotating refresh tokens)   |
| Schema     | TypeORM · SQL migrations (no sync)       |
| Container  | Docker + Docker Compose                  |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for PostgreSQL + Redis)
- Node.js 20+ (backend + frontend)
- Git

---

## Quick Start (Development)

### 1. Clone and configure environment

```bash
git clone <repository-url>
cd "WFM System"
cp .env.example .env
# Edit .env — fill in POSTGRES_PASSWORD, REDIS_PASSWORD, JWT secrets, SEED_ADMIN_EMAIL/PASSWORD
```

### 2. Start infrastructure (PostgreSQL + Redis)

```bash
docker-compose up -d
```

The database schema and Boutiqaat tenant seed data are applied automatically
on the first startup. Wait for the health check to pass (~30 seconds).

Verify database is ready:
```bash
docker exec wfm_postgres pg_isready -U wfm_user -d wfm_db
```

### 3. Verify schema was applied

```bash
docker exec -it wfm_postgres psql -U wfm_user -d wfm_db -c "\dt"
```

You should see ~35 tables including `tenants`, `employees`, `shift_codes`,
`schedule_versions`, `audit_logs`, etc.

### 4. Apply schema to a local PostgreSQL (if not using Docker)

```bash
psql -h localhost -U postgres -c "CREATE DATABASE wfm_db;"
psql -h localhost -U postgres -d wfm_db -f database/migrations/001_initial_schema.sql
psql -h localhost -U postgres -d wfm_db -f database/migrations/002_seed_boutiqaat.sql
```

---

## Project Structure

```
WFM System/
├── .env.example              # Environment variables template (safe to commit)
├── docker-compose.yml        # PostgreSQL + Redis dev infrastructure
├── CLAUDE.md                 # AI assistant project instructions
├── database/
│   └── migrations/
│       ├── 001_initial_schema.sql   # Core schema (35 tables)
│       └── 002_seed_boutiqaat.sql   # Boutiqaat tenant seed data
├── data/
│   └── samples/              # Place real schedule workbooks here (gitignored)
├── docs/                     # Project documentation
│   ├── WFM_REQUIREMENTS_V3_ENTERPRISE_MASTER.md
│   ├── WFM_FULL_PHASE_PLAN.md
│   ├── WFM_MASTER_HANDOVER.md
│   ├── WFM_AI_SKILLS_ROUTER.md
│   ├── WFM_SAAS_ARCHITECTURE_ADDENDUM.md
│   └── WFM_SECURITY_SCALABILITY_ADDENDUM.md
├── backend/                  # NestJS backend (Step 2)
└── frontend/                 # React/Vite frontend (Step 3)
```

---

## Development Phases

| Phase | Description                      | Status   |
|-------|----------------------------------|----------|
| 0     | Planning & Requirements          | Complete |
| 1     | Database Schema (this step)      | Complete |
| 2     | NestJS Backend Foundation        | Next     |
| 3     | React Frontend Foundation        | Pending  |
| 4     | Real Workbook Import / Parser    | Pending  |
| 5     | Attendance & Adherence Engine    | Pending  |
| 6     | Schedule Management              | Pending  |
| 7+    | See docs/WFM_FULL_PHASE_PLAN.md  | Pending  |

---

## Security Notes

- Never commit `.env` files — see `.gitignore`
- Passwords are hashed with Argon2id in production
- All APIs require JWT authentication
- RBAC is enforced server-side, never frontend-only
- Audit log is append-only (no UPDATE/DELETE allowed)
- All tenant-owned data is scoped by `tenant_id`
- Rate limiting is enforced on all public endpoints

---

## License

Proprietary. All rights reserved. See notice above.
