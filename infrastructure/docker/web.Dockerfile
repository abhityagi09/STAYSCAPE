# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------- build
FROM node:22.21.1-alpine3.22 AS build
WORKDIR /app
ENV MONGOMS_DISABLE_POSTINSTALL=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @stayscape/config -w @stayscape/shared -w @stayscape/web --include-workspace-root
COPY packages ./packages
COPY apps/web ./apps/web
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build -w @stayscape/shared && npm run build -w @stayscape/web

# ---------------------------------------------------------------- runtime
# Unprivileged nginx (uid 101, port 8080): no root process; works with a read-only root
# filesystem when /tmp is a tmpfs (see docker-compose.prod.yml).
FROM nginxinc/nginx-unprivileged:1.29.3-alpine AS runtime
# Pick up OS security fixes published after the base image was built.
USER root
RUN apk upgrade --no-cache
USER 101
COPY infrastructure/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY infrastructure/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
