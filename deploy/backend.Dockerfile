# ============================================================================
# WFM Platform — backend image (single-origin: API + SPA in one process)
#
# BUILD CONTEXT = REPO ROOT (set in docker-compose.prod.yml):
#   docker compose --env-file ./prod.env -f docker-compose.prod.yml build backend
#
# Runtime layout (matches what the code expects — do not rearrange):
#   /app/backend           WORKDIR — process.cwd()
#   /app/backend/dist      compiled NestJS (entry: dist/main.js, package.json start:prod)
#   /app/backend/uploads   attachment uploads (main.ts:97 — <cwd>/uploads; volume)
#   /app/backend/scripts   migrate.js (manual SQL migration runner)
#   /app/frontend/dist     built SPA — main.ts:117-119 default is
#                          path.join(cwd, '..', 'frontend', 'dist') = /app/frontend/dist,
#                          and FRONTEND_DIST pins it explicitly anyway.
#   /app/database/migrations  SQL files — migrate.js:39 resolves
#                          <backend>/../database/migrations = /app/database/migrations
# ============================================================================

# ---------- Stage 1: backend build (needs devDeps: @nestjs/cli, typescript) --
FROM node:22-alpine AS backend-build
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/tsconfig.json backend/tsconfig.build.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build
# Strip devDependencies — runtime keeps only prod node_modules
RUN npm prune --omit=dev

# ---------- Stage 2: frontend build (Vite → dist, default outDir) -----------
FROM node:22-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/tailwind.config.js frontend/postcss.config.js ./
COPY frontend/public ./public
COPY frontend/src ./src
RUN npm run build

# ---------- Stage 3: slim runtime -------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend

# Compiled backend + prod deps
COPY --from=backend-build --chown=node:node /build/backend/dist ./dist
COPY --from=backend-build --chown=node:node /build/backend/node_modules ./node_modules
COPY --chown=node:node backend/package.json ./package.json

# Manual migration runner + the SQL migrations it applies
# (migrations are NOT auto-run — see DEPLOY_RUNBOOK.md step 7)
COPY --chown=node:node backend/scripts/migrate.js ./scripts/migrate.js
COPY --chown=node:node database/migrations /app/database/migrations

# Built SPA where main.ts serves it from
COPY --from=frontend-build --chown=node:node /build/frontend/dist /app/frontend/dist

# Uploads dir (volume mounts over this path)
RUN mkdir -p /app/backend/uploads && chown node:node /app/backend/uploads

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
