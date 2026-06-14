# ─── WFM Frontend — production image ─────────────────────────────────────────
# Build the Vite SPA, then serve it with nginx which also reverse-proxies the
# API, uploads, and the chat WebSocket to the backend container.

FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Production build → static assets in /app/dist
RUN npm run build

FROM nginx:1.27-alpine AS runtime
# SPA static files
COPY --from=build /app/dist /usr/share/nginx/html
# nginx config template — ${DOMAIN} substituted at container start (envsubst).
# NGINX_ENVSUBST_FILTER limits substitution to DOMAIN so nginx's own $vars survive.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=DOMAIN
EXPOSE 80 443
