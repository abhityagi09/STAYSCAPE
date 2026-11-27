# Setup

Three ways to run STAYSCAPE, from fastest to most production-like.

## Prerequisites

| Tool    | Version                 | Notes                                           |
| ------- | ----------------------- | ----------------------------------------------- |
| Node.js | 22.21.1 (`.nvmrc`)      | 22.17+ works locally; CI and images use 22.21.1 |
| npm     | 10+                     | npm workspaces                                  |
| Docker  | 24+ with Compose v2.20+ | MongoDB replica set, Redis, Mailpit, full stack |

## 1. Local development (hot reload)

```sh
npm install
cp .env.example .env                 # safe local defaults; no real secrets
npm run services:up                  # MongoDB replica set, Redis, Mailpit (ports bound to 127.0.0.1)
npm run check:env                    # verifies .env and that the services answer
npm run build:shared
SEED_USER_PASSWORD='Choose-A-Str0ng-One' npm run seed          # fictional listings and accounts
ADMIN_BOOTSTRAP_EMAIL=admin@stayscape.local ADMIN_BOOTSTRAP_PASSWORD='Choose-A-Str0ng-One' npm run bootstrap:admin
npm run dev                          # shared (watch) + API on :4000 + web on :5173
```

Open <http://localhost:5173>. Emails land in Mailpit at <http://localhost:8025>; payments use the
labelled sandbox gateway (docs/payments.md).

## 2. Full stack in Docker (development images)

```sh
npm run docker:up                    # web on http://localhost:8080 (nginx + API + workers)
```

Seed it the same way with `MONGO_URI=mongodb://localhost:27017/stayscape?directConnection=true`.

## 3. Production-mode staging stack (local or a staging host)

Runs the production images and configuration (`NODE_ENV=production`, Secure cookies, non-root,
read-only containers, private databases) with the labelled sandbox gateway:

```sh
node scripts/make-staging-env.mjs --url=http://localhost:8081   # generates .env.staging with fresh secrets
C="docker compose -f docker-compose.prod.yml --env-file .env.staging"
$C --profile self-hosted up -d --build --wait
$C --profile release run --rm release                            # migrations + indexes
$C exec -T -e SEED_USER_PASSWORD='Choose-A-Str0ng-One' api node dist/scripts/seed.js
$C exec -T -e ADMIN_BOOTSTRAP_EMAIL=admin@stayscape.local -e ADMIN_BOOTSTRAP_PASSWORD='Choose-A-Str0ng-One' \
  api node dist/scripts/bootstrap-admin.js
sh scripts/deploy/smoke.sh http://localhost:8081
```

Mailpit for this stack: <http://localhost:8026>.

## Accounts after seeding

| Account                          | Password                   | Use                                            |
| -------------------------------- | -------------------------- | ---------------------------------------------- |
| `seed.traveller@stayscape.dev`   | `SEED_USER_PASSWORD`       | customer                                       |
| `seed.partner1..8@stayscape.dev` | `SEED_USER_PASSWORD`       | approved partners with published listings      |
| `ADMIN_BOOTSTRAP_EMAIL`          | `ADMIN_BOOTSTRAP_PASSWORD` | super administrator (development/staging only) |

Seeded listings are fictional and say so; their ratings are labelled sample data.

## Troubleshooting

| Symptom                                                 | Fix                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Invalid environment configuration`                     | The message names each variable; compare with `.env.example` / docs/environment.md.                  |
| `Transaction numbers are only allowed on a replica set` | Use the Compose MongoDB (a replica set) or an Atlas cluster; a standalone `mongod` is not supported. |
| API cannot reach MongoDB from the host                  | Use `?directConnection=true` with the Compose replica set.                                           |
| No verification email                                   | Open Mailpit (<http://localhost:8025>); check `MAIL_PROVIDER=smtp` and `SMTP_PORT=1025`.             |
| 429 responses during automated tests                    | Raise `RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_MAX` for that environment only.     |
| Map stays on "Loading map"                              | nginx must serve `.mjs` as JavaScript (already configured in infrastructure/nginx/default.conf).     |
| Port already in use                                     | Stop the other stack (`npm run docker:down`) or change `WEB_BIND`/ports.                             |
