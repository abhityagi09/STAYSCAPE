# Development, testing and operations

## Prerequisites

- Node.js **≥ 22.12** (`.nvmrc` = 22; verified on 22.17.1) and npm ≥ 10 (verified on 10.9.2)
- Docker with Compose v2 (verified on Docker 29.9 / Compose 5.7)

## First-time setup

```bash
npm install                 # installs every workspace
cp .env.example .env        # safe local defaults; see comments in the file
npm run services:up         # MongoDB 8 replica set, Redis 7.4, Mailpit (waits until healthy)
npm run check:env           # optional: confirms variables and service reachability
npm run dev                 # shared (watch) + API :4000 + web :5173
```

| URL                                | What                                                                 |
| ---------------------------------- | -------------------------------------------------------------------- |
| http://localhost:5173              | Web app (Vite; proxies `/api` to the API so cookies are first-party) |
| http://localhost:4000/api/v1/docs  | Swagger UI                                                           |
| http://localhost:4000/health/ready | Readiness                                                            |
| http://localhost:8025              | Mailpit inbox — every email the app "sends" lands here               |

### Development credentials

There are **no seeded users**. Register through the UI, or create a local super-administrator:

```bash
ADMIN_BOOTSTRAP_PASSWORD='Choose-A-Str0ng-One' npm run bootstrap:admin
# email defaults to ADMIN_BOOTSTRAP_EMAIL in .env (admin@stayscape.local)
```

The script is refused in production and against non-local databases (see `docs/rbac.md`).
Verification and reset emails appear in Mailpit; open the link from there.

## Environment variables

`.env.example` documents every variable. The API validates them with Zod at startup and exits with
a list of offending **names** (never values). In production it additionally rejects: secrets
containing `dev-only`, `COOKIE_SECURE=false`, non-SMTP mail providers, an empty `CORS_ORIGINS`,
and `STORAGE_DRIVER=s3` without bucket/region.

> Do **not** add `NODE_ENV` to the shared `.env`: Vite would apply it to web builds and bundle
> React's development build. The web build fails loudly if this happens.

## Testing

| Command                                               | Scope                                                                               | Needs                                                                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run test`                                        | shared unit (10), API integration (62), web components/pages (39)                   | nothing — the API suite starts an in-memory MongoDB replica set (first run downloads a MongoDB binary, ~600 MB, cached in `~/.cache/mongodb-binaries`) |
| `npm run test:e2e`                                    | Playwright: auth journeys incl. real email via Mailpit, RBAC, responsive navigation | `npm run services:up`; once: `npx playwright install chromium`. Starts API and web automatically, or reuses running ones                               |
| `E2E_BASE_URL=http://localhost:8080 npm run test:e2e` | Same suite against the Docker stack                                                 | `npm run docker:up`                                                                                                                                    |

API tests use the real Express app, Mongoose models, transactions, Argon2 and JWT; only the
mail transport (in-memory) and job queue (inline) are substituted, and rate limits use the memory
store. Set `MONGO_TEST_URI` to run them against an existing replica set.

## Docker

```bash
npm run docker:up     # builds api + web images, starts everything, waits for health checks
npm run docker:down   # stop (add -v to docker compose down to delete volumes)
```

The web container (nginx) serves the SPA on http://localhost:8080 and proxies `/api/` to the API.
All ports bind to `127.0.0.1`. Volumes: `mongo-data`, `mongo-config`, `redis-data`, `api-uploads`.

## Production configuration (guidance)

The Compose file is a **local** stack. For production:

- **Secrets**: generate `JWT_ACCESS_SECRET` (≥ 48 random bytes) and inject via the platform's
  secret manager; never commit `.env`.
- **NODE_ENV=production** on API/worker processes; `COOKIE_SECURE=true`; HTTPS everywhere (HSTS is
  enabled automatically); serve web and API from the same site (as the nginx image does) so
  `COOKIE_SAMESITE=strict` keeps working; set `CORS_ORIGINS` and `WEB_APP_URL` explicitly;
  `TRUST_PROXY` = number of proxies in front of the API.
- **MongoDB**: managed replica set with auth + TLS; run `node dist/scripts/sync-indexes.js` on release.
- **Redis**: managed instance with auth/TLS (`rediss://`).
- **Workers**: run `node dist/worker.js` separately and set `RUN_WORKERS=false` on API instances.
- **Email**: a real SMTP provider (SES, Postmark, SendGrid…) with SPF/DKIM/DMARC on `MAIL_FROM`.
- **Media**: `STORAGE_DRIVER=s3` with a bucket + CDN (`S3_PUBLIC_BASE_URL`).
- **Docs**: consider `API_DOCS_ENABLED=false` publicly.
- **Admins**: never use the bootstrap script; provision through an audited procedure.
- **Logs**: JSON to stdout (`LOG_PRETTY=false`); authorization headers, cookies and secret-like
  fields are redacted.

## CI

`.github/workflows/ci.yml`: lint → typecheck → tests → build; Playwright e2e against Compose
services; Docker image builds. (Defined but not yet executed on GitHub — no remote is configured.)

## Troubleshooting

| Symptom                                                        | Fix                                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| API exits: "Could not connect to MongoDB/Redis"                | `npm run services:up`; check `docker compose ps`                                                                  |
| "Transaction numbers are only allowed on a replica set member" | Use the Compose Mongo (replica set) or a replica-set URI; `directConnection=true` for the local one               |
| Mongo container never healthy                                  | `docker compose logs mongo`; reset with `docker compose down -v` (deletes local data)                             |
| Port 4000/5173/8080 in use                                     | Stop the other process or change `PORT` / Vite port; Compose and `npm run dev` both use 4000                      |
| Signed out on every reload                                     | Ensure you use the Vite URL (same-origin proxy), `COOKIE_SECURE=false` on plain http, and cookies are not blocked |
| `403 CSRF_INVALID` on refresh                                  | The `ss_csrf` cookie is missing or the request Origin is not in `CORS_ORIGINS`/`WEB_APP_URL`                      |
| `429 RATE_LIMITED` locally                                     | Raise the limits in `.env` or `docker compose exec redis redis-cli FLUSHALL`                                      |
| No emails in Mailpit                                           | Check `MAIL_PROVIDER=smtp`, `SMTP_HOST/PORT`, and `RUN_WORKERS=true` (or a running worker)                        |
| First `npm run test` slow                                      | One-time MongoDB binary download for the in-memory replica set                                                    |
| `Refusing to build: NODE_ENV=…`                                | Remove `NODE_ENV` from `.env`/shell for web builds                                                                |

## Exact versions installed

Runtime: Node.js 22.17.1, npm 10.9.2, MongoDB 8.0 (Docker), Redis 7.4 (Docker), Mailpit v1.27,
nginx 1.27, MongoDB 7.0.24 (in-memory test binary).

| Area               | Packages                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language & tooling | typescript 5.9.3, tsx 4.23.15, tsup 8.5.1, eslint 9.39.5, typescript-eslint 8.73.0, eslint-plugin-react-hooks 5.2.0, eslint-plugin-jsx-a11y 6.10.2, eslint-config-prettier 10.1.8, prettier 3.10.1, concurrently 9.2.5                                                                                                                                                                                            |
| API                | express 5.3.0, mongoose 8.24.10, ioredis 5.11.1, bullmq 5.81.6, argon2 0.44.0, jsonwebtoken 9.0.3, zod 4.6.7, helmet 8.3.0, cors 2.8.6, cookie-parser 1.4.7, express-rate-limit 7.5.1, rate-limit-redis 4.3.1, pino 9.14.0, pino-http 10.5.0, multer 2.5.0, nodemailer 7.0.13, @aws-sdk/client-s3 3.1175.0, swagger-ui-express 5.0.1, dotenv 17.4.2                                                               |
| Web                | react 19.3.1, react-dom 19.3.1, react-router 7.18.6, @tanstack/react-query 5.108.2, @reduxjs/toolkit 2.15.0, react-redux 9.3.1, axios 1.21.1, react-hook-form 7.92.0, @hookform/resolvers 5.9.2, tailwindcss 4.3.5, @tailwindcss/vite 4.3.5, vite 7.3.8, @vitejs/plugin-react 5.2.0, lucide-react 1.77.0, clsx 2.1.1, tailwind-merge 3.7.1, @fontsource-variable/inter 5.3.0, @fontsource-variable/fraunces 5.3.0 |
| Testing            | vitest 3.2.7, supertest 7.3.2, mongodb-memory-server 10.4.3, @testing-library/react 16.3.3, @testing-library/user-event 14.6.13, @testing-library/jest-dom 6.9.1, jsdom 26.1.0, @playwright/test 1.65.1                                                                                                                                                                                                           |

Recharts is part of the target stack but is not installed yet: Phase 1 has no charts (dashboards
show no metrics until real data exists). It will be added with the reporting module.
