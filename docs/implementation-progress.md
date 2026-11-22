# Implementation progress

Last updated: 2026-11-22 · Current phase: **Phase 1 — complete** (see verification below)

Legend: ✅ done and tested · 🟡 done, not verifiable without external credentials · ⏳ planned for a later phase

## Phase 1 modules

| Module                                                                                                                             | Status                   | Notes                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Monorepo (npm workspaces, TS, ESLint, Prettier, EditorConfig, aliases)                                                             | ✅                       | `apps/web`, `apps/api`, `packages/shared`, `packages/config`, `infrastructure`, `scripts`, `docs`, `tests` |
| Env validation, logging, request IDs, security headers, CORS, body limits, rate limits                                             | ✅                       | Redis-backed rate limit store                                                                              |
| MongoDB connection (replica set, transactions)                                                                                     | ✅                       | Verified against Docker `rs0` and in-memory replica set                                                    |
| Redis connection, BullMQ email queue + worker                                                                                      | ✅                       | Emails delivered to Mailpit via the queue in e2e                                                           |
| Health (`/health`, `/live`, `/ready`)                                                                                              | ✅                       | Readiness returns 503 when a dependency is down                                                            |
| OpenAPI 3.1 + Swagger UI                                                                                                           | ✅                       | `/api/v1/docs`                                                                                             |
| Graceful shutdown                                                                                                                  | ✅                       | SIGINT/SIGTERM, 15 s hard timeout (not covered by automated tests)                                         |
| `auth` (register, login, logout, logout-all, refresh rotation + reuse detection, forgot/reset, verify/resend, change password, me) | ✅                       |                                                                                                            |
| CSRF (double-submit + origin check)                                                                                                | ✅                       |                                                                                                            |
| `users` (profile, preferences, avatar, sessions, admin list/roles/status)                                                          | ✅                       |                                                                                                            |
| `roles`, `permissions` (RBAC middleware, ownership policy)                                                                         | ✅                       |                                                                                                            |
| `sessions`                                                                                                                         | ✅                       | Family-based, TTL cleanup                                                                                  |
| `notifications` (in-app)                                                                                                           | ✅                       | Email/SMS/push channels ⏳                                                                                 |
| `audit`                                                                                                                            | ✅                       | Secrets redacted                                                                                           |
| `newsletter` subscription                                                                                                          | ✅                       | Double opt-in ⏳                                                                                           |
| Mail provider abstraction (SMTP)                                                                                                   | ✅ local / 🟡 production | Verified with Mailpit; a production SMTP provider needs credentials                                        |
| Storage abstraction                                                                                                                | ✅ local / 🟡 S3         | `S3StorageProvider` implemented; untested without credentials                                              |
| Dev-only admin bootstrap                                                                                                           | ✅                       | Refuses production and remote databases                                                                    |
| Web: architecture (router, code splitting, Query, Redux, Axios refresh coordination, error boundaries)                             | ✅                       |                                                                                                            |
| Web: design system (all 33 required components plus helpers; tokens, dark mode, reduced motion)                                    | ✅                       |                                                                                                            |
| Web: public, auth, customer, partner, admin screens                                                                                | ✅                       | No fabricated data; future modules labelled                                                                |
| Docker Compose (Mongo RS, Redis, Mailpit, API, Web)                                                                                | ✅                       |                                                                                                            |
| GitHub Actions CI                                                                                                                  | 🟡                       | Workflow written; not run (no GitHub remote)                                                               |
| Documentation                                                                                                                      | ✅                       |                                                                                                            |

## Phase 1 acceptance checklist (verified 2026-11-22)

| Criterion                               | Result  | Evidence                                                    |
| --------------------------------------- | ------- | ----------------------------------------------------------- |
| Frontend starts                         | ✅ PASS | Vite dev server on :5173; nginx image on :8080              |
| Backend starts                          | ✅ PASS | `npm run dev:api`; Docker `api` healthy                     |
| MongoDB connects                        | ✅ PASS | `/health/ready` → mongodb up; `rs.status()` → `rs0 PRIMARY` |
| Redis connects                          | ✅ PASS | `/health/ready` → redis up                                  |
| Docker Compose works                    | ✅ PASS | `docker compose up -d --build --wait` → 5 services healthy  |
| Registration / login / refresh / logout | ✅ PASS | API tests + e2e                                             |
| Password reset via test email service   | ✅ PASS | e2e reads the reset link from Mailpit                       |
| Protected routes                        | ✅ PASS | Web guard tests + e2e                                       |
| Backend RBAC                            | ✅ PASS | `rbac.test.ts`                                              |
| Profile management                      | ✅ PASS | API tests + e2e                                             |
| Responsive layouts                      | ✅ PASS | Mobile e2e project (Pixel 7), no horizontal overflow        |
| Shared UI components                    | ✅ PASS | `components.test.tsx`                                       |
| Tests pass                              | ✅ PASS | 111 unit/integration + 7 e2e                                |
| Production builds succeed               | ✅ PASS | `npm run build`                                             |
| Documentation complete                  | ✅ PASS | `README.md`, `docs/*`                                       |

## Known limitations / follow-ups

- Hindi is selectable as a preference but the UI is not yet translated (labelled in the UI).
- Phone numbers are stored but not verified (no SMS provider yet).
- React Router 7 publishes only its `development` build in its default export map, so the web bundle includes it (React itself is the production build).
- Access tokens cannot be revoked mid-lifetime by signature alone. Each request checks the session store instead (one extra indexed query per request). Add a Redis cache if this becomes a hotspot.
- Newsletter signup is single opt-in.

## Upcoming phases

- **Phase 2**: partner onboarding application + KYC, properties, rooms, rates, calendar inventory (property-local dates), media, maps provider, search.
- **Phase 3**: bookings (transactional inventory holds), Razorpay payments + refunds (idempotent), payouts, reporting (Recharts).
- **Later**: reviews, AI features, mobile push.
