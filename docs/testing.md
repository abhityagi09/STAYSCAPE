# Testing

| Layer                                             | Tool                                                                              | Where                        | Command                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Shared rules (pricing math, dates, money)         | Vitest                                                                            | `packages/shared`            | `npm test -w @stayscape/shared`                                                                                        |
| API unit + **integration**                        | Vitest + Supertest against a real MongoDB **replica set** (mongodb-memory-server) | `apps/api/src/**/*.test.ts`  | `npm test -w @stayscape/api`                                                                                           |
| Web components and pages                          | Vitest + Testing Library (jsdom) with a mocked API client                         | `apps/web/src/**/*.test.tsx` | `npm test -w @stayscape/web`                                                                                           |
| End-to-end, responsive, accessibility, Web Vitals | Playwright (Chromium desktop + Pixel 7)                                           | `tests/e2e`                  | `npm run test:e2e`                                                                                                     |
| Load and stress                                   | k6 (Docker image)                                                                 | `tests/load`                 | see below                                                                                                              |
| Static                                            | ESLint, Prettier, `tsc`, i18n key check, env-doc check                            | —                            | `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run i18n:check`, `node scripts/env-docs.mjs --check` |

`npm test` runs the first three. API tests are integration tests: every request goes through
Express, validation, permissions, services and a transaction-capable MongoDB. Set
`MONGO_TEST_URI` to use an existing replica set and `REDIS_TEST_URL=redis://localhost:6379/15` to
run the BullMQ job-inspector test against a real Redis (CI does both).

## Notable suites

| Suite                                                                  | What it proves                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions/authorization-matrix.test.ts`                             | Every registered route (300) × 7 roles: refused exactly when the role lacks the permission the route enforces; no 5xx; the public surface is pinned.                                                                              |
| `bookings/bookings.test.ts`, `bookings/reservation-resilience.test.ts` | Last-room races, 10-way contention, overlapping multi-night stays, hold release/expiry idempotency, racing expiry workers, verify/webhook races, cancellation during payment, gateway outage, capture timeout and reconciliation. |
| `bookings/cancellations.test.ts`                                       | Full/partial/non-refundable policies, refund failure and retry, lost provider responses, webhook-confirmed refunds, duplicate requests.                                                                                           |
| `finance/*.test.ts`                                                    | Commission precedence, refund splits with exact rounding, balanced ledger, settlements with evidence, reconciliation report.                                                                                                      |
| `modules/acceptance.test.ts`                                           | The 30-step guest → partner → admin journey as one flow.                                                                                                                                                                          |
| `privacy/privacy.test.ts`                                              | Data export and account deletion.                                                                                                                                                                                                 |
| `seo/seo.test.ts`                                                      | Metadata, JSON-LD escaping, sitemap, robots, noindex rules.                                                                                                                                                                       |
| `tests/e2e/resilience.spec.ts`                                         | Deep links and refresh, back/forward with filters, network interruption with retry, ended session → sign-in → back to the deep link.                                                                                              |
| `tests/e2e/quality.spec.ts`                                            | Nine viewport widths, axe WCAG 2.2 AA (public, customer, partner, admin), keyboard, reduced motion, 200 % text, touch targets, Core Web Vitals.                                                                                   |

## End-to-end

```sh
npm run test:e2e                                   # starts API + web against local services
E2E_BASE_URL=http://localhost:8080 npx playwright test --trace off      # an existing stack
E2E_BASE_URL=http://localhost:8081 MAILPIT_URL=http://localhost:8026 \
  E2E_SEED_PASSWORD='<seed password>' npx playwright test --trace off   # the staging stack
```

Screenshots of key screens at 375/768/1440 px and `quality-report.json` are written to
`test-results/`.

## Load testing (staging only)

Never point load tests at production. Run k6 inside the stack's network so the Docker Desktop
port proxy is not measured:

```sh
docker run --rm --network stayscape-staging_edge -e BASE_URL=http://web:8080 \
  -e MAILPIT_URL=http://mailpit:8025 -e PROFILE=baseline -e SEED_USER_PASSWORD='<seed password>' \
  -v "$PWD/tests/load:/scripts" grafana/k6:1.3.0 run /scripts/stayscape.js
```

Profiles: `smoke` (≈ 4 VUs), `baseline` (76 VUs: browse 40, autocomplete 10, availability 15,
booking 6, partner 3, admin 2), `stress` (228 VUs). Booking traffic creates real holds,
bookings and sandbox orders and cancels them, so inventory is not exhausted.

### Performance budgets (p95, measured server-side through nginx)

| Endpoint                                       | Budget             |
| ---------------------------------------------- | ------------------ |
| Destination autocomplete                       | 300 ms             |
| Hotel detail                                   | 500 ms             |
| Search without dates                           | 800 ms             |
| Room offers (availability)                     | 1,000 ms           |
| Search with dates (priced)                     | 1,500 ms           |
| Hold creation, payment order, inventory update | 1,500 ms           |
| Admin dashboard                                | 2,000 ms           |
| Error rate                                     | < 1 %              |
| LCP (lab, desktop)                             | < 2.5 s; CLS < 0.1 |

### Recorded results (2026-11-26, laptop Docker Desktop: 8 vCPU / 3.7 GiB VM shared with other stacks)

| Run                                         | API replicas (1 CPU each) | VUs    | Throughput             | p95 (range across endpoints)                                             | Errors                     |
| ------------------------------------------- | ------------------------- | ------ | ---------------------- | ------------------------------------------------------------------------ | -------------------------- |
| Baseline, before optimisation               | 1                         | 76     | 26.9 req/s             | 2.13–2.89 s                                                              | 0.02 %                     |
| Baseline, formatter caching + public caches | 1                         | 76     | 39.6 req/s             | 1.54–1.98 s (CPU-throttled 87 % of periods)                              | 0.05 %                     |
| **Baseline**                                | **3**                     | **76** | **83.8 req/s**         | **0.30–1.11 s — all budgets met except autocomplete (309 ms vs 300 ms)** | **0.02 %** (sold-out 409s) |
| Stress                                      | 3                         | 228    | 89.7 req/s (saturated) | 2.9–5.0 s                                                                | **0.00 %**                 |

After all runs: inventory invariant violations 0, overdue holds 0, failed jobs/webhooks/refunds
0, reconciliation exceptions 0. Interpretation and capacity guidance: docs/deployment.md
("Capacity"). Summaries: `tests/load/results/*.json`.

### Lab Web Vitals (staging, desktop 1440 px, local network)

| Page           | LCP         | CLS    |
| -------------- | ----------- | ------ |
| Home           | 0.87–1.29 s | 0.0001 |
| Search results | 0.45–0.48 s | 0      |
| Property page  | 0.28–0.30 s | 0      |

Bundle (measured transfer, gzip): the home page loads **308 KB of JavaScript / 406 KB in total**
(it was 626 KB / 965 KB before the map stack was split out of the shared vendor chunk). The map
stack (MapLibre, 305 KB gzip plus its worker) downloads only on map views; each workspace
(account, partner, admin) and the Hindi dictionary (44 KB gzip) are separate lazy chunks.
