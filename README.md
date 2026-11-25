# STAYSCAPE

Multi-vendor hotel discovery, booking and property management platform.

**Current status: Phase 1 — foundation, authentication, RBAC and UI system.** Property listings,
search inventory, bookings and payments arrive in later phases; the UI says so honestly wherever
those modules will appear. See [`docs/implementation-progress.md`](docs/implementation-progress.md).

| Workspace         | Stack                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`        | React 19, Vite 7, TypeScript, React Router 7, TanStack Query 5, Redux Toolkit 2, React Hook Form + Zod 4, Tailwind CSS 4 |
| `apps/api`        | Node.js 22, Express 5, TypeScript, MongoDB 8 (Mongoose 8), Redis 7 + BullMQ 5, Argon2id, JWT                             |
| `packages/shared` | Types, enums, Zod schemas, permission matrix and API contracts used by both apps                                         |
| `packages/config` | Shared TypeScript, ESLint and Prettier configuration                                                                     |
| `infrastructure`  | Dockerfiles, nginx, MongoDB replica-set init                                                                             |
| `tests/e2e`       | Playwright end-to-end tests                                                                                              |

## Quick start

Requirements: Node.js ≥ 22.12, npm ≥ 10, Docker with Compose v2.

```bash
npm install
cp .env.example .env
npm run services:up        # MongoDB replica set, Redis, Mailpit (Docker)
npm run dev                # API on :4000, web on :5173
```

- Web app: http://localhost:5173
- API docs (Swagger UI): http://localhost:4000/api/v1/docs
- Captured emails (Mailpit): http://localhost:8025

Create a local super-administrator (development only):

```bash
ADMIN_BOOTSTRAP_PASSWORD='Choose-A-Str0ng-One' npm run bootstrap:admin
```

### Full stack in Docker

```bash
npm run docker:up          # web + API + dependencies; web on http://localhost:8080
npm run docker:down
```

## Commands

| Command                                 | Purpose                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run dev`                           | Shared package watch + API (tsx watch) + web (Vite)                                     |
| `npm run build`                         | Production builds of shared, API (tsup) and web (Vite)                                  |
| `npm run lint`                          | ESLint (flat config, incl. jsx-a11y) across the repo                                    |
| `npm run typecheck`                     | `tsc --noEmit` in every workspace and the e2e suite                                     |
| `npm run test`                          | Vitest: shared unit, API integration (in-memory Mongo replica set), web component tests |
| `npm run test:e2e`                      | Playwright against real API/Mongo/Redis/Mailpit (needs `npm run services:up`)           |
| `npm run services:up` / `services:down` | Start/stop MongoDB, Redis, Mailpit                                                      |
| `npm run docker:up` / `docker:down`     | Full containerised stack                                                                |
| `npm run bootstrap:admin`               | Development-only SUPER_ADMIN bootstrap                                                  |
| `npm run db:indexes`                    | Synchronise MongoDB indexes (production release step)                                   |
| `npm run seed`                          | Idempotent development marketplace data (needs `SEED_USER_PASSWORD`; dev/local only)    |
| `npm run check:env`                     | Check `.env` and local service reachability                                             |

## Documentation

- [Architecture](docs/architecture.md)
- [Authentication](docs/authentication.md)
- [Roles & permissions](docs/rbac.md)
- [Database](docs/database.md)
- [API](docs/api.md)
- [Marketplace: onboarding, listings, inventory, pricing, search](docs/marketplace.md)
- [Development, testing & troubleshooting](docs/development.md)
- [Implementation progress](docs/implementation-progress.md)
