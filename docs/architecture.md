# Architecture

STAYSCAPE is a modular monolith: one API process (plus optional worker processes) and one SPA,
sharing contracts through a workspace package. Microservices are deliberately not used; module
boundaries inside the API make later extraction possible if a real need appears.

```
┌──────────────┐   same-origin /api/v1   ┌──────────────────────────────┐
│  apps/web    │ ───────────────────────▶│  apps/api (Express 5)        │
│  React SPA   │   (Vite proxy / nginx)  │  modules → services → repos  │
└──────────────┘                         └──────┬──────────┬────────────┘
        ▲                                       │          │
        │  @stayscape/shared (types, Zod,       ▼          ▼
        └──── permissions, contracts) ───   MongoDB 8   Redis 7
                                           (replica set) (rate limits, BullMQ)
                                                           │
                                                 BullMQ worker → SMTP (Mailpit locally)
```

## Monorepo

npm workspaces, declared in dependency order: `packages/config`, `packages/shared`, `apps/api`,
`apps/web`. `@stayscape/shared` is built with tsup to `dist/` (ESM + `.d.ts`) and consumed by
both apps; root scripts build it first. The API bundle inlines it (`noExternal`) so the runtime
image does not need the workspace.

Import alias `@/` maps to each app's `src/` (TypeScript `paths`, Vite/Vitest `alias`, esbuild/tsx).

## API layering

```
src/
  app.ts            Express app factory (middleware order, routers, error handling)
  bootstrap.ts      Load env → connect Mongo/Redis → build container → start workers; graceful shutdown
  server.ts         HTTP entry point          worker.ts   standalone BullMQ worker entry point
  container.ts      Composition root (repositories → services → middleware)
  config/           Zod-validated environment (fails fast, never echoes values)
  infrastructure/   database, redis, mail/, storage/, queue/ adapters (provider abstractions)
  jobs/             Job definitions and handlers (email)
  middleware/       request-id, validate, authenticate, csrf, rate-limit, error-handler
  modules/<name>/   *.routes.ts → *.controller.ts → *.service.ts → *.repository.ts → *.model.ts (+ tests)
  docs/openapi.ts   OpenAPI 3.1 document (request bodies generated from the shared Zod schemas)
```

Rules: controllers only translate HTTP ↔ service calls; services hold business rules and never
touch `req`/`res`; repositories own all Mongoose queries; models declare schema and indexes.
Every response passes through `sendSuccess` or the central error handler, giving one envelope:

```json
{ "success": true, "data": { } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { "fieldErrors": {} }, "requestId": "…" } }
```

Modules: `auth`, `users`, `roles`, `permissions`, `sessions`, `notifications`, `audit`, `health`,
`newsletter`.

### Middleware order

request id → pino-http structured logs (secrets redacted) → helmet → CORS allowlist → JSON/urlencoded
body limits → cookie parser → `/health` → global rate limit → versioned routers (`/api/v1`) →
404 → error handler.

### Provider abstractions

| Concern | Interface         | Implementations                                                                            |
| ------- | ----------------- | ------------------------------------------------------------------------------------------ |
| Email   | `MailProvider`    | `SmtpMailProvider` (real), `LogMailProvider` (dev only), `MemoryMailProvider` (tests only) |
| Media   | `StorageProvider` | `LocalStorageProvider` (dev/single node), `S3StorageProvider` (S3-compatible)              |
| Jobs    | `JobQueue`        | `BullJobQueue` (Redis), `InlineJobQueue` (tests only)                                      |

Production env validation rejects the dev/test-only providers. Payments (Razorpay) and maps
(Mapbox) follow the same pattern in later phases.

### Background jobs

Transactional emails are enqueued (never sent inline) with a deterministic `jobId` for
idempotency, 5 attempts with exponential back-off, and `removeOnComplete` so one-time links are
not retained in Redis. Workers run in-process by default (`RUN_WORKERS=true`) or separately via
`node dist/worker.js` (set `RUN_WORKERS=false` on API nodes).

## Web architecture

```
src/
  app/          App providers, router (route-based code splitting via `lazy`), Redux store
  components/ui Design-system components     components/brand  Logo
  features/     auth, account, admin, partner, home, ui — each with api.ts (TanStack Query) + pages
  layouts/      PublicLayout, AuthLayout, DashboardShell → CustomerLayout, PartnerLayout, AdminLayout
  lib/api/      Axios client (token refresh coordination), error normalisation, in-memory token store
  pages/        Legal and status (403/404/error) pages
  styles/       Tailwind v4 design tokens (index.css) + JS tokens
```

- **Server state**: TanStack Query (request cancellation via `AbortSignal`, no retries on 4xx).
- **Client state**: Redux Toolkit for session identity and UI preferences only. The access token
  is never put in Redux, localStorage or logs.
- **Forms**: React Hook Form + Zod resolvers using the shared schemas; server field errors are
  mapped back onto fields.
- **Error handling**: route `errorElement` + top-level error boundary; loading, empty, error and
  success states on every data view.

## Design system

Tokens live in `apps/web/src/styles/index.css`:

- Brand palette (forest `#173D35`, ivory `#F8F6F1`, sand `#E8DFD1`, charcoal `#222725`, gold `#C6A66B`)
  defined once in `@theme`; components use **semantic** tokens (`bg-surface`, `text-fg-muted`,
  `bg-primary`…) so dark mode is a token swap under `.dark`.
- Typography (Inter Variable body, Fraunces Variable display, self-hosted via Fontsource), display
  sizes, radius, shadow, breakpoint and motion tokens; visible `:focus-visible` ring; global
  `prefers-reduced-motion` handling.
- Components (`components/ui`): Button, IconButton, Input, PasswordInput, Textarea, Select,
  MultiSelect, Checkbox, RadioGroup, DatePicker, Modal, Drawer, Dropdown, Tooltip, Popover, Tabs,
  Accordion, Badge, Card, Skeleton, Spinner, Alert, Toast, Breadcrumb, Pagination, DataTable,
  EmptyState, ErrorState, Avatar, ImageUploader, SearchInput, PriceDisplay, RatingDisplay,
  PageHeader, ConfirmationDialog. They follow WAI-ARIA patterns (focus traps, roving tabindex,
  `aria-activedescendant`, live regions) and are linted with `eslint-plugin-jsx-a11y`.

## Deployment shape

The production web image is unprivileged nginx serving the SPA and reverse-proxying `/api/` to
the API, so the refresh cookie is first-party and `SameSite=Strict` works. nginx sets a strict
CSP (`script-src 'self'` plus Razorpay Checkout), frame denial and related headers, injects
per-page SEO metadata with server-side includes, and blocks `/metrics` at the edge. API replicas
run HTTP only (`RUN_WORKERS=false`); a separate worker process runs BullMQ consumers and the
scheduled maintenance jobs. Full topology, CI/CD and operations: docs/deployment.md.

## Request lifecycle

```
nginx (X-Request-Id) → requestId → metrics timer → scope → pino-http (redacted URL) → helmet → CORS
  → rate limit (Redis) → body parser (100 KB) → router → authenticate → requirePermission
  → validate (strict Zod) → controller → service (transaction, idempotency, resource checks)
  → mapper (whitelisted DTO) → { success, data } | error handler → { success: false, error }
```

## Cross-cutting modules (Phase 5)

| Concern                         | Where                                                           |
| ------------------------------- | --------------------------------------------------------------- |
| Metrics (Prometheus)            | `apps/api/src/lib/metrics.ts`, `GET /metrics`                   |
| Job inspection                  | `apps/api/src/lib/job-inspector.ts`, Admin → Operations         |
| Financial reconciliation        | `apps/api/src/modules/finance/reconciliation.service.ts`        |
| Privacy (export, deletion)      | `apps/api/src/modules/privacy`                                  |
| SEO (metadata, sitemap, robots) | `apps/api/src/modules/seo`, `infrastructure/nginx/default.conf` |
| Migrations                      | `apps/api/src/migrations`, `scripts/migrate.ts`                 |
| Backups                         | `infrastructure/backup`                                         |
| Alerts                          | `infrastructure/monitoring`                                     |
