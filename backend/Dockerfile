# ─── WFM Backend — production image ──────────────────────────────────────────
# Multi-stage: build with full deps, run with prod deps only.

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Uploads are persisted via a mounted volume in docker-compose
RUN mkdir -p uploads/chat
EXPOSE 3000
# Graceful shutdown handled by Nest enableShutdownHooks()
CMD ["node", "dist/main.js"]
