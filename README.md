# STAYSCAPE

Multi-vendor hotel discovery, booking and property-management marketplace for India: travellers
search, compare and book verified stays; partners run their properties, rates, inventory and
reservations; administrators verify partners, moderate listings, and run payments, refunds,
commissions and settlements.

**Status: Phase 5 complete — READY FOR STAGING** (see [the release report](docs/release-report.md)).
A controlled production pilot needs the external items in
[known limitations](docs/known-limitations.md): Razorpay KYC and keys, hosting, and legal and tax review.

| Workspace                 | Stack                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`                | React 19, Vite 7, TypeScript, React Router 7, TanStack Query 5, Redux Toolkit 2, React Hook Form + Zod 4, Tailwind CSS 4, MapLibre 6 |
| `apps/api`                | Node.js 22, Express 5, TypeScript, MongoDB 8 (Mongoose 8, transactions), Redis 7 + BullMQ 5, Argon2id, JWT, prom-client              |
| `packages/shared`         | Types, enums, Zod schemas, permission matrix, pricing helpers and API contracts used by both apps                                    |
| `packages/config`         | Shared TypeScript, ESLint and Prettier configuration                                                                                 |
| `infrastructure`          | Dockerfiles, nginx (SSI SEO, security headers), MongoDB replica-set init, backups, Prometheus alerts                                 |
| `tests/e2e`, `tests/load` | Playwright (functional, responsive, accessibility, Web Vitals) and k6 load scenarios                                                 |

## Quick start

Requirements: Node.js 22 (`.nvmrc`), npm ≥ 10, Docker with Compose v2.20+.

```bash
npm install
cp .env.example .env
npm run services:up                                   # MongoDB replica set, Redis, Mailpit
npm run build:shared
SEED_USER_PASSWORD='Choose-A-Str0ng-One' npm run seed  # fictional listings (development only)
ADMIN_BOOTSTRAP_EMAIL=admin@stayscape.local ADMIN_BOOTSTRAP_PASSWORD='Choose-A-Str0ng-One' npm run bootstrap:admin
npm run dev                                           # API :4000, web :5173
```

Web <http://localhost:5173> · API docs <http://localhost:4000/api/v1/docs> · Mailpit <http://localhost:8025>.
Production-mode staging stack and troubleshooting: [docs/setup.md](docs/setup.md).

## Commands

| Command                                                              | Purpose                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`                                                        | Shared package watch + API (tsx watch) + web (Vite)                             |
| `npm run build`                                                      | Production builds of shared, API (tsup) and web (Vite)                          |
| `npm run lint` / `npm run format:check` / `npm run typecheck`        | ESLint (incl. jsx-a11y), Prettier, `tsc` in every workspace                     |
| `npm run test`                                                       | Vitest: shared unit, API integration (MongoDB replica set), web component tests |
| `npm run test:e2e`                                                   | Playwright against real API, MongoDB, Redis and Mailpit                         |
| `npm run i18n:check` / `npm run docs:env`                            | Hindi coverage check; regenerate docs/environment.md                            |
| `npm run services:up` / `services:down`, `docker:up` / `docker:down` | Local dependencies; full containerised stack                                    |
| `npm run seed`, `npm run bootstrap:admin`                            | Development-only fictional data and super administrator                         |
| `npm run db:migrate`, `npm run db:indexes`                           | Release steps: versioned migrations, index synchronisation                      |
| `npm run check:env`                                                  | Check `.env` and local service reachability                                     |

## Documentation

| Topic             | Documents                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Getting started   | [Setup](docs/setup.md) · [Development](docs/development.md) · [Environment variables](docs/environment.md) · [Testing](docs/testing.md)                                                                                                     |
| Design            | [Architecture](docs/architecture.md) · [Database](docs/database.md) · [API](docs/api.md)                                                                                                                                                    |
| Security          | [Authentication](docs/authentication.md) · [Permissions](docs/permissions.md) ([roles](docs/rbac.md)) · [Security](docs/security.md) · [India compliance checklist](docs/compliance-india.md)                                               |
| Domain            | [Marketplace](docs/marketplace.md) · [Inventory](docs/inventory.md) · [Pricing](docs/pricing.md) · [Bookings](docs/bookings.md) · [Payments](docs/payments.md) · [Refunds](docs/refunds.md) · [Reservations (detail)](docs/reservations.md) |
| Operations        | [Partner operations](docs/partner-operations.md) · [Administration](docs/admin-operations.md) · [Analytics](docs/analytics.md) · [TrustScore](docs/trustscore.md) · [AI assistant](docs/ai.md)                                              |
| Production        | [Deployment](docs/deployment.md) · [Monitoring](docs/monitoring.md) · [Backup & recovery](docs/backup-recovery.md) · [Known limitations](docs/known-limitations.md)                                                                         |
| Learn the project | [Explanatory guide for developers and interviews (start here)](docs/about/README.md)                                                                                                                                                        |
| Status            | [Requirements traceability](docs/traceability.md) · [Release report](docs/release-report.md) · [Implementation progress](docs/implementation-progress.md)                                                                                   |
