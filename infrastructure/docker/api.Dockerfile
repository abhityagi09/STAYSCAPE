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
RUN npm ci -w @stayscape/config -w @stayscape/shared -w @stayscape/api --include-workspace-root
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm run build -w @stayscape/shared && npm run build -w @stayscape/api

# ---------------------------------------------------------------- runtime
FROM node:22.21.1-alpine3.22 AS runtime
ENV NODE_ENV=production \
    MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
# Pick up OS security fixes published after the base image was built.
RUN apk upgrade --no-cache
COPY package.json package-lock.json ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Package managers are not needed at runtime; removing them shrinks the attack surface.
RUN npm ci --omit=dev -w @stayscape/api && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
     /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
     /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
RUN mkdir -p var/uploads var/private && chown -R node:node var
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/health/live >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/server.js"]
