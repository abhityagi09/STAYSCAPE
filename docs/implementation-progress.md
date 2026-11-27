# Implementation progress

Last updated: 2026-11-26 · Current phase: **Phase 4 — complete** (see verification below). Phases 1–3
re-verified with Phase 4 (the full unit, API and end-to-end suites).

Legend: ✅ done and tested · 🟡 done, not verifiable without external credentials · ⏳ planned for a later phase

## Phase 5 — QA, security, performance and production readiness (2026-11-27)

Outcome: **READY FOR STAGING** — full report: [release-report.md](release-report.md);
requirement-by-requirement status: [traceability.md](traceability.md).

| Task                       | Result                                | Evidence                                                                                               |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1 Requirements audit       | ✅                                    | traceability.md (73 requirements: 65 PASS, 6 PASS with an external part, 1 PARTIAL/BLOCKED, 1 BLOCKED) |
| 2 Architecture audit       | ✅                                    | dependencies upgraded; cross-cutting modules documented (architecture.md)                              |
| 3 Authentication security  | ✅                                    | auth suite; authorisation matrix; smoke                                                                |
| 4 Authorisation matrix     | ✅                                    | `authorization-matrix.test.ts`: 300 routes × 7 roles; 3 routers hardened                               |
| 5 Concurrency and recovery | ✅                                    | `reservation-resilience.test.ts` + existing suites; post-load integrity 0 violations                   |
| 6 Payments and refunds     | ✅ sandbox / ⛔ Razorpay keys         | payment, refund and failure-path tests                                                                 |
| 7 Financial reconciliation | ✅                                    | `GET /admin/finance/reconciliation` + CSV; 0 exceptions on staging                                     |
| 8 Frontend QA              | ✅                                    | web 98 tests; e2e 28 tests (incl. resilience)                                                          |
| 9 Responsive               | ✅                                    | nine widths + screenshots; overflow defects fixed                                                      |
| 10 Accessibility           | ✅ automated / 🟡 manual SR audit     | axe WCAG 2.2 AA on public + workspaces; keyboard, motion, 200 % text, targets                          |
| 11 Performance             | ✅                                    | 4× pricing CPU; caches; home JS −51 %; LCP ≤ 1.3 s                                                     |
| 12 Load/stress             | ✅ staging                            | k6 baseline 84 req/s (3 replicas), stress 0 errors (testing.md)                                        |
| 13 Security hardening      | ✅                                    | npm audit 0; gitleaks clean; Trivy clean; security.md                                                  |
| 14 Job reliability         | ✅                                    | retries, dead letters, inspector + retry UI, metrics, alerts                                           |
| 15 Docker/infrastructure   | ✅                                    | docker-compose.prod.yml; non-root read-only images; staging verified                                   |
| 16 CI/CD                   | ✅ defined / ⛔ not yet run on GitHub | ci.yml (actionlint), deploy/smoke/rollback scripts                                                     |
| 17 Monitoring              | ✅                                    | /metrics; 16 alert rules; Prometheus scrape verified                                                   |
| 18 Backup/DR               | ✅                                    | encrypted backups; restore drill passed; RPO/RTO                                                       |
| 19 SEO                     | ✅                                    | SSI metadata, JSON-LD, sitemap, robots, noindex                                                        |
| 20 Privacy/compliance      | ✅ product / ⛔ legal review          | export + deletion; compliance-india.md                                                                 |
| 21 Documentation           | ✅                                    | all required docs                                                                                      |
| 22 Seeds/migrations        | ✅                                    | migration runner; bootstrap-first-admin; seed refuses production                                       |
| 23 Acceptance              | ✅                                    | `acceptance.test.ts` (30 steps) + e2e                                                                  |
| 24 Defect resolution       | ✅                                    | all critical/high fixed (release-report.md)                                                            |
| 25 Release report          | ✅                                    | release-report.md                                                                                      |

### Phase 5 audit (2026-11-27)

Method: re-read every Phase 5 task against the code; inspected the indexes behind the new
reconciliation and metrics queries; probed the nginx SSI path; ran axe best-practice rules
(heading order, landmarks) in addition to the WCAG rule set; re-ran the whole verification.

#### Defects found and fixed

| #   | Severity | Finding                                                                                                                                                            | Fix                                                                                                                                 |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High     | CI secret scan would fail on the first push: two documented `docker compose exec -e …PASSWORD='…'` placeholders in docs/setup.md were not covered by the allowlist | allowlist pattern for that documented form; gitleaks: no leaks                                                                      |
| 2   | Medium   | Reconciliation compared internal records only; provider-reported payments were never checked (task 7, "provider payment records")                                  | `?provider=true` re-fetches captured payments from the gateway: PROVIDER_PAYMENT_MISSING / STATUS_MISMATCH / AMOUNT_MISMATCH; tests |
| 3   | Medium   | Ledger had no indexes on `refundId`, `settlementId`, `paymentId`: reconciliation lookups were collection scans                                                     | three indexes, synchronised by the release task                                                                                     |
| 4   | Medium   | The inventory-invariant gauge scanned all future inventory nights on every scrape of every replica                                                                 | computed at most every 5 minutes per replica (the database validator still enforces the invariant)                                  |
| 5   | Medium   | The unavailable-property page had no `<h1>`; the FAQ empty state skipped a heading level                                                                           | `EmptyState` heading level (default h2, level 1 for full-page states)                                                               |
| 6   | Medium   | Task 8 cases without automated coverage: deep links + refresh, back/forward, network interruption, ended session                                                   | `tests/e2e/resilience.spec.ts` (4 tests)                                                                                            |
| 7   | Low      | No automated check that form errors are announced (task 10)                                                                                                        | quality test: `aria-invalid`, `aria-describedby` message, focus on the first invalid field, alert for server errors                 |
| 8   | Low      | SEO subrequests forwarded cookies/authorization; the cache key was implicit                                                                                        | headers cleared, explicit per-fragment cache key (encoded-traversal probes confirmed no SSI escape)                                 |

#### Requirement-by-requirement result

| Task                               | Result                                                                               | Verified by                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1 Requirements traceability        | PASS                                                                                 | traceability.md                                                                    |
| 2 Repository/architecture audit    | PASS                                                                                 | index review above; architecture.md                                                |
| 3 Authentication security          | PASS                                                                                 | auth suite (registration through rate limiting), smoke                             |
| 4 Authorisation + tenant isolation | PASS                                                                                 | 300 routes × 7 roles; ownership tests                                              |
| 5 Concurrency and recovery         | PASS                                                                                 | resilience + bookings suites; post-load integrity 0                                |
| 6 Payments and refunds             | PASS (sandbox) · BLOCKED (Razorpay test mode: keys)                                  | payment/refund suites                                                              |
| 7 Financial reconciliation         | PASS                                                                                 | internal + provider checks, CSV, 0 exceptions on staging                           |
| 8 Frontend functional QA           | PASS                                                                                 | web 98 tests; e2e 28 incl. resilience                                              |
| 9 Responsive                       | PASS                                                                                 | nine widths, screenshots                                                           |
| 10 Accessibility                   | PASS (automated) · PARTIAL (manual screen-reader audit)                              | axe WCAG + best-practice, keyboard, motion, text size, targets, error announcement |
| 11 Performance                     | PASS                                                                                 | budgets, Web Vitals, bundle split                                                  |
| 12 Load and stress                 | PASS (staging)                                                                       | k6 baseline/stress; smoke re-run 298/298 checks, 0 % errors                        |
| 13 Security hardening              | PASS                                                                                 | npm audit 0, gitleaks clean, Trivy clean                                           |
| 14 Background jobs                 | PASS                                                                                 | retries, dead letters, inspector + retry UI, alerts                                |
| 15 Docker/infrastructure           | PASS                                                                                 | production compose verified on staging                                             |
| 16 CI/CD                           | PASS (defined, actionlint) · BLOCKED (a live run needs a push + GitHub environments) | ci.yml                                                                             |
| 17 Monitoring                      | PASS                                                                                 | /metrics, 16 rules, Prometheus scrape                                              |
| 18 Backup/DR                       | PASS                                                                                 | restore drill passed (66 collections, 0 mismatches)                                |
| 19 SEO                             | PASS                                                                                 | SSI metadata, JSON-LD, sitemap, robots, heading hierarchy                          |
| 20 Privacy/compliance              | PASS (product) · BLOCKED (legal/tax review)                                          | export + deletion e2e; compliance-india.md                                         |
| 21 Documentation                   | PASS                                                                                 | all required documents                                                             |
| 22 Seeds/migrations                | PASS                                                                                 | migration runner, bootstrap-first-admin, seed refuses production                   |
| 23 Acceptance                      | PASS                                                                                 | 30-step flow + e2e journeys                                                        |
| 24 Defect resolution               | PASS                                                                                 | no open critical/high                                                              |
| 25 Release report                  | PASS                                                                                 | release-report.md                                                                  |

#### Commands run for the audit (all passed)

`prettier --check`, `npm run lint`, `npm run typecheck`, `npm run i18n:check`,
`node scripts/env-docs.mjs --check`, `npm audit` (0), `npm test` with Redis (shared 10, API 227,
web 98), `npm run build`, production-mode staging rebuild + release task + `smoke.sh`, Playwright
28/28 on staging and 28/28 on the development stack, backup + restore drill, k6 smoke, Trivy (both
images clean), gitleaks (no leaks), actionlint (clean).

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

## Audit of Phases 1–4 (2026-11-26)

I reviewed the requirements of every phase against the source code, API routes, Mongoose models,
frontend screens, integrations and tests. Then I re-ran every check after fixing what I found.

### Method

- Traced each Phase 4 requirement from the specification through the API route, service, model and
  frontend screen to its tests.
- Re-ran the Phase 1–3 acceptance suites (unit, API, end-to-end) against the rebuilt Docker stack.
- Searched for stubs, TODOs, placeholder text and "later phase" labels. None remain, apart from
  honest status messages.
- Reviewed security: authorisation and resource scoping, public endpoints that are expensive to
  serve, data exposure, caching of error responses, and secrets.

### Defects found and fixed during the audit

| #   | Finding                                                                                                                                                        | Type                                    | Fix                                                                                                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Coupons could only be applied when creating a hold through the API. Checkout had no coupon field                                                               | Incomplete workflow                     | `PUT` and `DELETE /bookings/holds/:reference/coupon` reprice the active hold and reserve or release the coupon atomically; refused once a booking exists. A coupon field at checkout. API, web and e2e tests |
| 2   | The pricing-rule form offered OCCUPANCY and PROMOTIONAL but had no fields for their conditions, so saving always failed (422)                                  | Broken workflow                         | Occupancy range and booking-window fields. The shared `PricingRuleDto` now includes the new conditions                                                                                                       |
| 3   | No partner reservation detail: notes, room assignment, guest details, payments and timeline had APIs but no screen. The list had no search or filters          | Incomplete                              | `/partner/bookings/:hotelId/:reference` detail page. Search, status and date filters. In-house and departures views                                                                                          |
| 4   | Partners could not declare accessibility features and admins could not verify them in the UI                                                                   | Incomplete                              | `/partner/accessibility` page and a verification panel in admin property moderation, plus read endpoints                                                                                                     |
| 5   | The `financials:view` staff permission was defined but never checked                                                                                           | Spec deviation                          | Staff with `financials:view` can read the ledger for their permitted properties only. Partner-wide summary and settlements stay owner-only. API test                                                         |
| 6   | Saving account preferences failed (422): the form sent the read-only `personalization.consentedAt` back to a strict schema                                     | Regression (Phase 4 broke Phase 1)      | The form sends only the fields it edits. Regression test                                                                                                                                                     |
| 7   | The footer claimed "Prices shown in your preferred currency", which is untrue (prices are in the property's currency)                                          | Misleading text                         | Corrected, translated                                                                                                                                                                                        |
| 8   | Hindi covered only dashboard navigation and Phase 4 page titles                                                                                                | Partial i18n                            | Public header, mobile menu and footer translated. Footer links to guides and FAQ                                                                                                                             |
| 9   | Admin lists took `sort` in the API but not in the UI                                                                                                           | Spec deviation (pagination/filter/sort) | Sort controls on bookings, payments and refunds                                                                                                                                                              |
| 10  | The agent console could not attach files or open customer attachments                                                                                          | Incomplete (support attachments)        | Attachment upload and authenticated downloads                                                                                                                                                                |
| 11  | The CMS editor could not upload images; image ids and alt texts were kept in two lists that could fall out of step                                             | Incomplete (CMS media) + latent bug     | Upload in the editor, one list of images with required alt text                                                                                                                                              |
| 12  | Public price-calendar (up to 31 live quotes) and last-minute-deals endpoints were unauthenticated and uncached, so they could be abused to overload the server | Security / denial of service            | Server-side public cache. Calendar limited to 14 check-in dates                                                                                                                                              |
| 13  | One failing record aborted whole batch jobs (price observations, alerts, loyalty accrual and reversal, coupon release, referrals)                              | Missing error handling                  | Per-item isolation with logging                                                                                                                                                                              |
| 14  | The blocks-and-closures page was not reachable from navigation; the inventory link stayed highlighted on sub-pages                                             | Navigation                              | Linked, exact matching                                                                                                                                                                                       |

### Requirement-by-requirement result

Phase 4 tasks. ✅ PASS · 🟡 PASS for everything that can run here, with an external dependency
outstanding · ⚠️ PARTIAL.

| #   | Requirement                                                                                                                                                 | Result                                                                                 | Evidence                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Partner dashboard routes and KPIs with date and property filters, metric definitions                                                                        | ✅ PASS                                                                                | API `analytics.test.ts`; web `ops.test.tsx`; [analytics.md](analytics.md). `rooms`, `rates` and `guests` redirect to the per-property and reservation screens   |
| 2   | Reservation operations with property-level staff permissions                                                                                                | ✅ PASS                                                                                | API `partner-ops.test.ts` (4); web reservation detail test                                                                                                      |
| 3   | Advanced inventory and pricing; booking snapshots never change                                                                                              | ✅ PASS                                                                                | API `inventory-ops.test.ts`, pricing suite; UI for all rule types                                                                                               |
| 4   | Staff management with activity logs and fine-grained permissions incl. `bookings:view` and `financials:view`                                                | ✅ PASS                                                                                | API `partner-ops.test.ts`; web `ops.test.tsx`                                                                                                                   |
| 5   | Admin dashboard routes, metrics, date-range comparison                                                                                                      | ✅ PASS                                                                                | API `analytics.test.ts`; web; e2e. `/admin/promotions`: partner discounts by state/type plus coupon count (`admin-promotions.test.ts`)                          |
| 6   | Admin CRUD and moderation with pagination, filter, sort and before/after audit                                                                              | ✅ PASS                                                                                | API `admin-management.test.ts`, `support-console.test.ts`, `content.test.ts`                                                                                    |
| 7   | Commission engine                                                                                                                                           | ✅ PASS                                                                                | API `commission.test.ts`, `finance.test.ts`                                                                                                                     |
| 8   | Append-only ledger and settlements; never paid without evidence                                                                                             | 🟡 PASS (payout provider not onboarded, by requirement)                                | API `finance.test.ts`; web; e2e                                                                                                                                 |
| 9   | Coupons with atomic redemption and release                                                                                                                  | ✅ PASS                                                                                | API `coupons.test.ts` (5); web; e2e checkout journey                                                                                                            |
| 10  | Support administration (queue, assignment, priority, notes, property thread, escalation, resolution, attachments, history, response times, least privilege) | ✅ PASS                                                                                | API `support-console.test.ts`; web; e2e                                                                                                                         |
| 11  | CMS (drafts, publishing, scheduling, SEO, media, preview, audit, public APIs)                                                                               | ✅ PASS                                                                                | API `content.test.ts`; web; e2e                                                                                                                                 |
| 12  | AI assistant: backend-only, schema-validated, real search, no invented data, injection-resistant, rate-limited, timeouts, cost tracking, fallback           | 🟡 PASS against a scripted SDK; live Claude API not called (needs `ANTHROPIC_API_KEY`) | API `assistant.test.ts`; e2e in deterministic mode                                                                                                              |
| 13  | Recommendations: deterministic, explainable, consent-aware, can be disabled                                                                                 | ✅ PASS                                                                                | API `intelligence.test.ts`; settings toggle                                                                                                                     |
| 14  | TrustScore with documented formula and confidence                                                                                                           | ✅ PASS                                                                                | API `trust.test.ts`; [trustscore.md](trustscore.md)                                                                                                             |
| 15  | TripSpace routes, collaborators, private-data-safe sharing                                                                                                  | ✅ PASS                                                                                | API `trips.test.ts`; web; e2e                                                                                                                                   |
| 16  | Price intelligence: observations, flexible dates, history, de-duplicated alerts job, last-minute deals                                                      | ✅ PASS                                                                                | API `intelligence.test.ts`                                                                                                                                      |
| 17  | Loyalty: ledger-based, qualifying event, compensating entries, no negatives or duplicates                                                                   | ✅ PASS                                                                                | API `rewards.test.ts`                                                                                                                                           |
| 18  | Referrals: verified qualifying event, abuse prevention, limits                                                                                              | ✅ PASS                                                                                | API `rewards.test.ts`                                                                                                                                           |
| 19  | Corporate travel with data isolation                                                                                                                        | ✅ PASS                                                                                | API `corporate.test.ts` ; web `ops.test.tsx` (property → room → rate picker from the catalogue)                                                                 |
| 20  | English and Hindi with persistent preference; no invented exchange rates                                                                                    | ✅ PASS                                                                                | All 1,928 UI strings translated (`npm run i18n:check`, in CI); web `tr.test.tsx` renders sign-in in Hindi. ECB conversion verified live once; AED not converted |
| 21  | Accessibility and property accessibility filters with provenance                                                                                            | ✅ PASS                                                                                | API `trust.test.ts`; partner and admin screens; search filters (web and API tests)                                                                              |
| 22  | Channel-manager architecture (contract-tested local adapter, no fake third party)                                                                           | 🟡 PASS (simulator); no third-party adapter without provider API access                | API `channels.test.ts`                                                                                                                                          |
| 23  | Advanced analytics via aggregation pipelines, date filters, export                                                                                          | ✅ PASS                                                                                | API `analytics.test.ts`                                                                                                                                         |
| 24  | Tests for all of the above, incl. frontend tests for every new dashboard                                                                                    | ✅ PASS                                                                                | Totals below                                                                                                                                                    |

Phases 1–3: every criterion in their acceptance checklists below still passes. They were re-run in
the full API (191), web (88) and end-to-end (15) suites. The only Phase 1–3 defect found by the audit
was #6, a regression introduced in Phase 4, which is now fixed.

### Commands run for the audit (2026-11-26)

- `npx prettier --check .`: all files formatted.
- `npm run lint`: 0 problems.
- `npm run typecheck`: passed (shared, API, web, e2e).
- `npm test`: shared 10/10, API 191/191 (28 files), web 88/88 (9 files).
- `npm run build`: passed. One pre-existing warning about the shared vendor chunk, which contains
  the map library.
- `docker compose up -d --build --wait api web`, then
  `E2E_BASE_URL=http://localhost:8080 npx playwright test --trace off`: **15/15 passed** (auth,
  booking, marketplace, responsive, and 4 Phase 4 journeys including a coupon applied at checkout).

### Unresolved: external blockers only

- **Claude API:** set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` to verify the live path.
- **Payout provider:** onboarding and compliance. Payouts stay disabled by requirement.
- **Third-party channel manager:** provider API access is needed to build and verify a real adapter.
- **Razorpay:** test or live keys to verify the gateway (unchanged since Phase 3).

## Phase 4 modules (operations, administration, intelligent features)

Design: [phase4.md](phase4.md). Metrics: [analytics.md](analytics.md). TrustScore:
[trustscore.md](trustscore.md).

| #   | Module                                                                                                                                                                              | Status                                               | Tests                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Partner performance dashboard (KPIs, filters, trends, CSV, metric definitions)                                                                                                      | ✅                                                   | `analytics.test.ts`, web `ops.test.tsx`                               |
| 2   | Reservation operations (search, filters, guest details, room assignment, check-in/out/no-show, notes, per-property permissions)                                                     | ✅                                                   | `partner-ops.test.ts`                                                 |
| 3   | Advanced inventory and pricing (bulk updates, stop-sell, maintenance blocks, min/max stay, CTA/CTD, weekend/seasonal/event, promotional, occupancy, long-stay; snapshots immutable) | ✅                                                   | `inventory-ops.test.ts`, existing pricing tests                       |
| 4   | Staff management (invite, accept, properties, permissions, suspend, remove, activity log)                                                                                           | ✅                                                   | `partner-ops.test.ts`, web `ops.test.tsx`                             |
| 5   | Admin dashboard with period comparison                                                                                                                                              | ✅                                                   | `analytics.test.ts`, web `ops.test.tsx`, e2e                          |
| 6   | Admin management (customers, catalogue, escalations, payment exceptions, refunds, review moderation, before/after audit)                                                            | ✅                                                   | `admin-management.test.ts`                                            |
| 7   | Commission engine                                                                                                                                                                   | ✅                                                   | `commission.test.ts`, `finance.test.ts`                               |
| 8   | Append-only ledger and settlements (payouts disabled; paid only with evidence)                                                                                                      | ✅                                                   | `finance.test.ts`, web `ops.test.tsx`, e2e                            |
| 9   | Coupons (atomic limits, release on expiry, redemption, eligibility)                                                                                                                 | ✅                                                   | `coupons.test.ts`                                                     |
| 10  | Support administration (queue, assignment, priority, internal notes, property thread, escalation, resolution, response-time metrics)                                                | ✅                                                   | `support-console.test.ts`, web `ops.test.tsx`, e2e                    |
| 11  | CMS (drafts, publishing, scheduling, SEO, media, preview, revisions, public APIs)                                                                                                   | ✅                                                   | `content.test.ts`, web `ops.test.tsx`, e2e                            |
| 12  | AI travel assistant (backend only, tool use, structured output, validation, quotas, cost tracking, fallback)                                                                        | ✅ code and tests / 🟡 live Claude API not exercised | `assistant.test.ts` (scripted SDK stand-in), e2e (deterministic mode) |
| 13  | Recommendations (deterministic, explainable, consent-aware, can be disabled)                                                                                                        | ✅                                                   | `intelligence.test.ts`                                                |
| 14  | TrustScore (documented formula, confidence)                                                                                                                                         | ✅                                                   | `trust.test.ts`                                                       |
| 15  | TripSpace (`/trips`, `/trips/new`, `/trips/:id`, `/trips/:id/edit`, collaborators, sharing)                                                                                         | ✅                                                   | `trips.test.ts`, web `ops.test.tsx`, e2e                              |
| 16  | Price intelligence (observations, flexible dates, history, alerts job, last-minute deals)                                                                                           | ✅                                                   | `intelligence.test.ts`                                                |
| 17  | Loyalty (ledger, completed-stay earning, reversals, no negative balances, tiers, redemption)                                                                                        | ✅                                                   | `rewards.test.ts`                                                     |
| 18  | Referrals (verified qualifying stay, abuse limits)                                                                                                                                  | ✅                                                   | `rewards.test.ts`                                                     |
| 19  | Corporate travel (organisations, roles, policies, budgets, approvals, reports, invoices, isolation)                                                                                 | ✅                                                   | `corporate.test.ts`                                                   |
| 20  | i18n (English, Hindi, persisted) and currency display (ECB rates, no invented rates)                                                                                                | ✅                                                   | web `ops.test.tsx`, `currency.test.ts`, e2e                           |
| 21  | Accessibility features with provenance and search filters                                                                                                                           | ✅                                                   | `trust.test.ts`, web `ops.test.tsx`                                   |
| 22  | Channel-manager architecture (adapter contract, local simulator, webhooks, mapping, idempotency, conflicts, retries, sync)                                                          | ✅ simulator / ⏳ no third-party adapter             | `channels.test.ts` (contract suite)                                   |
| 23  | Advanced analytics via aggregation pipelines, date filters, export                                                                                                                  | ✅                                                   | `analytics.test.ts`                                                   |
| 24  | Tests (API, web dashboards, e2e)                                                                                                                                                    | ✅                                                   | see the checklist below                                               |

### Defects found and fixed during Phase 4 verification (2026-11-26)

- Maintenance blocks reported the wrong conflicting dates (the lookup ran after a partial update in
  the same transaction). The check now runs first; the conditional update still guards concurrency.
- Customer ticket attachments needed the same channel filter as messages, so an internal or property
  attachment can never be downloaded by the customer. Phase 3 rows without a channel count as
  customer messages.
- Analytics view counts used the UTC date. They now use the property's local date, consistent with
  stay nights.
- Public CMS responses set `Cache-Control: public, max-age=60` before the lookup, so a 404 was
  cached by browsers. A page published moments later stayed "not found" for up to a minute (found by
  the new e2e). Only successful responses are cached now, covered by an API regression test.
- The assistant page crashed in Chromium: an effect implicitly returned `scrollIntoView()`, which now
  returns a Promise, and React called it as a cleanup. jsdom does not return one, so only the browser
  e2e caught it. Fixed with a block-bodied effect.
- The assistant sent the newest message twice: React Query ran the mutation after the re-render, so
  the message was also included in `history`. History is now captured when the message is sent.
- The CMS renderer mapped `##` to `h3`. Fixed to `h2`, since the page title is the only `h1`.
- `createdAt` is immutable in Mongoose, so a referral-window test could not backdate an account. The
  test now writes the raw document. This was a test issue, not a product defect.

### Phase 4 acceptance checklist (verified 2026-11-26)

| Criterion                                                                                              | Result                               | Evidence                                                                           |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------- |
| Partners see accurate KPIs for permitted properties only                                               | ✅ PASS                              | API: hand-computed occupancy, ADR, RevPAR, GBV, cancellation rate; staff scope 404 |
| Staff permissions enforced per operation and per property                                              | ✅ PASS                              | API `partner-ops.test.ts`                                                          |
| Inventory blocks and stop-sell never touch existing reservations; price snapshots never change         | ✅ PASS                              | API `inventory-ops.test.ts`                                                        |
| Admin dashboard with period comparison                                                                 | ✅ PASS                              | API, web, e2e                                                                      |
| Admin changes audited before/after                                                                     | ✅ PASS                              | API (catalogue, support, escalations, CMS)                                         |
| Commission snapshotted; ledger append-only and balanced                                                | ✅ PASS                              | API `finance.test.ts`                                                              |
| Settlements never marked paid without evidence; payouts disabled                                       | ✅ PASS                              | API (initiate → 409, evidence required); web; e2e                                  |
| Coupon limits hold under concurrency                                                                   | ✅ PASS                              | API: 8 concurrent customers, limit 3 → exactly 3 holds                             |
| Support least privilege (internal notes and contact details isolated)                                  | ✅ PASS                              | API `support-console.test.ts`, web                                                 |
| CMS drafts never public; scheduling and previews work                                                  | ✅ PASS                              | API, web, e2e                                                                      |
| AI never invents hotels or prices; tool arguments validated; quotas, timeouts, cost tracking, fallback | ✅ PASS (scripted SDK) / 🟡 live API | `assistant.test.ts`. Live Claude calls need `ANTHROPIC_API_KEY`                    |
| Recommendations explainable and consent-aware                                                          | ✅ PASS                              | API `intelligence.test.ts`                                                         |
| Price alerts notify once per new low                                                                   | ✅ PASS                              | API                                                                                |
| Loyalty earned only after completed stays, never negative, no duplicates                               | ✅ PASS                              | API `rewards.test.ts` (incl. concurrent redemptions → one wins)                    |
| Referral rewards only after a verified qualifying stay                                                 | ✅ PASS                              | API                                                                                |
| Corporate data isolation, policies and approvals                                                       | ✅ PASS                              | API `corporate.test.ts`                                                            |
| TripSpace sharing exposes no private data                                                              | ✅ PASS                              | API `trips.test.ts`, web, e2e                                                      |
| English/Hindi switch persists                                                                          | ✅ PASS                              | web, e2e                                                                           |
| No invented exchange rates                                                                             | ✅ PASS                              | API (recorded ECB fixture; AED unavailable); live ECB fetch verified once manually |
| Channel events signed, idempotent, conflicts detected, retried                                         | ✅ PASS (simulator)                  | API contract suite + integration                                                   |
| Earlier phases unaffected                                                                              | ✅ PASS                              | Full suites: shared 10, API 189, web 83; e2e 14/14                                 |

Commands run on 2026-11-26 (Windows 11, Node v22.17.1, Docker Desktop):

- `npx prettier --check .`: all files formatted.
- `npm run lint`: 0 problems.
- `npm run typecheck`: passed.
- `npm test` (before the audit): shared 10/10, API 189/189 (28 files), web 83/83 (9 files). See the audit section for the current totals.
- `npm run build`: passed. One pre-existing warning: the shared vendor chunk is over 500 kB (map
  library); the Phase 4 pages are separate lazy chunks.
- `npm run docker:up`, then `E2E_BASE_URL=http://localhost:8080 npx playwright test --trace off`:
  14/14 passed, including 3 new Phase 4 journeys.

### Phase 4 known limitations

- **AI assistant:** the live Claude API was not called (no key configured). Set `AI_PROVIDER=anthropic`
  and `ANTHROPIC_API_KEY` to enable it. Until then the deterministic assistant answers.
- **Payouts:** disabled until a payout provider is onboarded and compliance is complete. Settlements
  are paid manually by bank transfer and recorded with evidence.
- **Channel managers:** only the local simulator exists. Real providers need API access and their
  own adapter.
- **Currency:** conversion is display-only from ECB reference rates. AED is not published by the ECB
  and is therefore not converted.
- **Hindi:** every screen. Components call `tr('English text')`/`trf('{0} …', [values])`
  (`apps/web/src/lib/tr.ts`); the dictionary `lib/locales/hi.ts` is lazy-loaded only when Hindi is
  chosen. `npm run i18n:check` (CI) fails on any untranslated string or placeholder mismatch;
  `scripts/i18n-extract.mjs` wraps new literals. Status badges show API enum names in English.
- **Recharts:** not used. Charts are inline SVG with table alternatives, to avoid a new dependency.
- Admin forms choose partners and properties by name (`RecordPicker`); corporate requests choose
  property, room and rate from the catalogue (`StayPicker`).

## Phase 3 modules (reservations, payments, refunds, customer experience)

Design: [reservations.md](reservations.md). Endpoints: [api.md](api.md). Collections: [database.md](database.md).

| Module                                                                                                                                                                                                                               | Status                   | Notes                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `bookings` — holds (atomic multi-night reservation, TTL, expiry worker), idempotent booking creation, snapshots, list/detail, lifecycle (check-in/out, completion), partner reservation operations                                   | ✅                       |                                                                                                 |
| `payments` — provider abstraction, order creation, signature + provider verification, webhooks (raw body, unique event ids), settlement state machine, reconciliation, late-payment re-allocation / exception workflow               | ✅ sandbox / 🟡 Razorpay | Razorpay adapter built on the official REST API; not run against Razorpay (no test keys)        |
| `refunds` — approval, atomic processing claim, lost-response recovery by receipt, provider-confirmed completion, failure compensation + escalation, admin retry/decisions, partial & full                                            | ✅ sandbox / 🟡 Razorpay |                                                                                                 |
| `cancellations` — policy engine (free window, percentage, fixed, non-refundable, partial, no-show, property-local deadlines incl. DST), preview, idempotent cancel                                                                   | ✅                       |                                                                                                 |
| `outbox` + notifications — transactional outbox, BullMQ dispatch, in-app + email templates, delivery log with duplicate suppression, retries, dead-letter inspection and manual retry, preferences                                   | ✅                       | Emails verified end to end through SMTP → Mailpit                                               |
| `documents` — numbered invoices (configurable issuer), confirmation PDFs, private storage, owner-only downloads, self-healing re-render                                                                                              | ✅ local / 🟡 S3         |                                                                                                 |
| `wishlists` — named lists, notes, live availability, secure share links                                                                                                                                                              | ✅                       | Replaces the Phase 2 single-list `wishlistitems`                                                |
| `reviews` — verified eligibility, six categories, photos, edit limits, reports, moderation, owner responses, rating recalculation                                                                                                    | ✅                       |                                                                                                 |
| `support` — tickets linked to own bookings, messages, private attachments, statuses                                                                                                                                                  | ✅                       | Agent console is Phase 4                                                                        |
| `customerDashboard` — overview from the customer's own records                                                                                                                                                                       | ✅                       |                                                                                                 |
| Web: `/checkout`, `/checkout/payment`, `/checkout/confirmation`, `/checkout/failure`                                                                                                                                                 | ✅                       | Hold countdown, expiry handling, preserved guest details, Razorpay Checkout or labelled sandbox |
| Web: `/account` overview, bookings (search/filter), booking detail (status-specific actions, PDFs, cancel, refund request, review), payments, refunds, wishlists (+ shared view), reviews, notifications, profile, settings, support | ✅                       |                                                                                                 |
| Web: partner reservations and guest reviews; admin operations                                                                                                                                                                        | ✅                       | Initial operations page; Phase 4 expands administration                                         |

### Defects found and fixed during Phase 3 verification (2026-11-26)

| Defect                                                                                            | Fix                                                             | Regression coverage                           |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| nginx refused to start: the new `Permissions-Policy` value nested double quotes                   | Single-quoted header value                                      | Docker stack e2e (11/11)                      |
| An invoice whose file was missing (other worker host / lost volume) could not be downloaded       | Re-render the stored invoice record (same number)               | API test deletes the file and downloads again |
| Concurrent duplicate cancellations returned 409 to the loser                                      | Return the existing cancellation                                | API race test                                 |
| Admin retry of a failed refund re-adopted the failed provider refund                              | Only adopt non-failed provider refunds; retry clears the old id | API test                                      |
| Lost refund responses were not recovered by reconciliation (wall-clock staleness)                 | Staleness uses the reconciliation clock                         | API test (one provider refund only)           |
| Concurrent booking creation for one hold returned 409 to the loser                                | Return the winner's booking                                     | API race test                                 |
| The new `/account` overview dropped the Phase 1 greeting, email-verification banner and checklist | Restored on the overview                                        | Phase 1 e2e journey                           |

### Phase 3 acceptance checklist (verified 2026-11-26)

| Criterion                                                | Result                          | Evidence                                                                                                                             |
| -------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Customers can select a room                              | ✅ PASS                         | e2e `booking.spec.ts`; web checkout tests                                                                                            |
| Backend generates an accurate quote                      | ✅ PASS                         | Hold priced server-side (₹5,000 × 3 + 5% = ₹15,750); client price fields rejected (422)                                              |
| Inventory holds work                                     | ✅ PASS                         | API: nights exclude the check-out date, release once, idempotent replay                                                              |
| Simultaneous reservations cannot overbook                | ✅ PASS                         | API: final-room race (one 201, one 409); 12 parallel holds on 5 rooms → 5                                                            |
| Booking creation works                                   | ✅ PASS                         | API: idempotent, one booking per hold, concurrent duplicates; e2e                                                                    |
| Payment gateway test checkout works                      | ✅ PASS (sandbox) / 🟡 Razorpay | e2e pays through the labelled sandbox; Razorpay needs test keys                                                                      |
| Payment verification works                               | ✅ PASS                         | API: forged signature → 400; provider fetch + amount/order checks                                                                    |
| Webhooks are idempotent                                  | ✅ PASS                         | API: duplicate event → `duplicate`, one email; bad signature → 400                                                                   |
| Successful payment confirms a valid booking              | ✅ PASS                         | API + e2e; held → booked, hold consumed                                                                                              |
| Failed payments are handled correctly                    | ✅ PASS                         | API + e2e declined card → retry → confirmed; out-of-order failure ignored                                                            |
| Expired holds release inventory                          | ✅ PASS                         | API: repeated and concurrent expiry runs release exactly once                                                                        |
| Cancellation policies work                               | ✅ PASS                         | 5 engine tests (time zones, DST, rounding) + 5 API policy tests                                                                      |
| Refund workflows work                                    | ✅ PASS                         | API: full, partial, fixed, duplicate, failed + retry, lost response, pending → webhook, requests; e2e refund confirmed by the worker |
| Booking history works                                    | ✅ PASS                         | API list/search/filters; web URL-synced filters                                                                                      |
| Customer dashboard works                                 | ✅ PASS                         | API: counts from own records only                                                                                                    |
| Wishlists work                                           | ✅ PASS                         | API: lists, notes, availability, ownership, sharing                                                                                  |
| Verified reviews work                                    | ✅ PASS                         | API: eligibility, one per stay, edits, reports, moderation, responses, rating summary                                                |
| Notifications queued and delivered via the test provider | ✅ PASS                         | API retry/de-dup/preference tests; e2e emails in Mailpit exactly once per event                                                      |
| Invoices are generated                                   | ✅ PASS                         | API + e2e PDF download (`SSI-2026-…`)                                                                                                |
| Critical tests pass                                      | ✅ PASS                         | 214 unit/integration (10 shared + 136 API + 68 web) and 11 e2e on dev servers **and** the Docker production build                    |
| Production builds succeed                                | ✅ PASS                         | `npm run build`; `docker compose up --build` healthy                                                                                 |

### Phase 3 known limitations

- Razorpay test mode is implemented but not exercised against Razorpay (no keys in this environment);
  the sandbox mirrors its signature and webhook formats. See development.md for the checklist.
- One room category and rate plan per booking (the data model stores an item array; per-stay fees
  would need allocation across items before enabling more).
- Confirmations are rendered on demand (they reflect current status); only invoices are stored.
  Cancelled bookings with a cancellation charge do not get a separate credit note.
- Stays are presumed completed the day after check-out unless the property records a no-show.
- Invoice numbers are gap-tolerant (a concurrent or failed generation can skip a number).
- The support agent console, payouts and reporting/charts are Phase 4.
- A missing local media file returns 500 instead of 404 (pre-existing static-file handler behaviour).

## Phase 2 modules (marketplace, search, property management, inventory)

Design and business rules: [marketplace.md](marketplace.md). Endpoints: [api.md](api.md). Schemas and indexes: [database.md](database.md).

| Module                                                                                                                                                                                           | Status                     | Notes                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------ |
| `partners` — onboarding application, 6-step wizard with drafts, private KYC documents, encrypted settlement account, admin review, resubmission, staff invitations with per-property permissions | ✅                         |                                                                                            |
| `hotels` — listings, publication workflow, revisions requiring re-approval, archive, admin moderation (approve/reject/suspend/reinstate/feature)                                                 | ✅                         |                                                                                            |
| `media` — magic-byte + decode validation, size limits, random keys, WebP/AVIF variants, EXIF stripped, ownership, orphan cleanup job                                                             | ✅ local / 🟡 S3           | S3 adapter not verified without credentials                                                |
| Videos                                                                                                                                                                                           | ✅                         | YouTube/Vimeo links (no video file uploads)                                                |
| `rooms` — room categories, rate plans, pricing rules; archive instead of delete when referenced                                                                                                  | ✅                         |                                                                                            |
| `inventory` — property-local daily rows, atomic range updates, invariant in DB validator, hold/confirm/release/expire API for Phase 3                                                            | ✅                         | Concurrency test: 12 parallel holds on 5 rooms → exactly 5 succeed                         |
| `pricing` — integer engine with documented precedence and rounding, signed quotes, revalidation                                                                                                  | ✅                         |                                                                                            |
| `search` — filters, 7 sorts, stable pagination, date-based availability via real quotes, geo bbox/radius/nearby, caching of non-transactional data, privacy-preserving analytics                 | ✅                         |                                                                                            |
| `catalog` — destinations, amenities, suggestions, wishlist                                                                                                                                       | ✅                         |                                                                                            |
| Web: homepage (hero search, destinations, trending, featured, top-rated, budget, luxury, weekend escapes, categories, inspiration, promo, newsletter)                                            | ✅                         |                                                                                            |
| Web: `/hotels` results (URL-synced filters, sort, mobile filter drawer, map/list, compare tray, wishlist, pagination, empty/error/loading)                                                       | ✅                         |                                                                                            |
| Web: `/hotels/:slug` detail (keyboard gallery, map, rooms & rates, live price breakdown, sticky booking summary, similar stays)                                                                  | ✅                         | CTA leads to a quote-revalidation page that states nothing is booked (checkout is Phase 3) |
| Web: maps (MapLibre, clustering, price labels, popups, search-as-I-move, list ↔ map highlighting)                                                                                                | ✅ OpenFreeMap / 🟡 Mapbox | Mapbox works via `VITE_MAP_STYLE_URL` but was not verified without a token                 |
| Web: comparison (≤ 4, persisted client-side, live backend data)                                                                                                                                  | ✅                         |                                                                                            |
| Web: partner onboarding, properties, media, policies, rooms, rates, inventory calendar (month/week)                                                                                              | ✅                         |                                                                                            |
| Web: admin partner and property review                                                                                                                                                           | ✅                         | Initial version; Phase 4 expands administration                                            |
| Development seed (75 properties, 12 destinations, 32 amenities, 8 partners)                                                                                                                      | ✅                         | Idempotent (re-run verified)                                                               |

### Defects found and fixed during Phase 2 verification (2026-11-25)

| Defect                                                                                                                                                                       | Fix                                                            | Regression coverage               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| Map rendered blank for everyone: MapLibre's unlayered `.maplibregl-map { position: relative }` beat Tailwind's layered `absolute inset-0`, collapsing the map to 0 px height | Inline positioning on the map container                        | e2e asserts the map region height |
| Homepage search lost the typed destination whenever the page re-rendered (e.g. when listings finished loading)                                                               | Search bar re-syncs on value changes, not object identity      | Web test + mobile e2e             |
| Toasts covered bottom-of-page actions (e.g. "Save photos & videos") and hover-pause kept them there                                                                          | Toasts moved to top-right below the header                     | Partner e2e                       |
| Map markers had no property popup                                                                                                                                            | Themed, XSS-safe popup with SPA link; no focus stealing        | e2e (when tiles load)             |
| "Distance" sort was never offered in the UI                                                                                                                                  | Offered when a destination or map area gives a reference point | e2e                               |
| Result cards were clipped in the map view's narrow list column                                                                                                               | Narrower image, wrapping text                                  | Screenshot check                  |

### Phase 2 acceptance checklist (verified 2026-11-25)

| Criterion                                    | Result  | Evidence                                                                                    |
| -------------------------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| A partner can register                       | ✅ PASS | e2e `partner onboarding → … → customer quote`; `partners.test.ts`                           |
| Admin can approve a partner                  | ✅ PASS | same e2e; `partners.test.ts` (full review workflow, resubmission)                           |
| Partner can create a property                | ✅ PASS | e2e; `marketplace.test.ts` (ownership, validation)                                          |
| Admin can approve the property               | ✅ PASS | e2e; `marketplace.test.ts` (publication workflow)                                           |
| Property appears in public search            | ✅ PASS | e2e (found by destination + dates); unpublished listings return 404 publicly (API test)     |
| Customer can search by destination and dates | ✅ PASS | e2e; API date-search test excludes unavailable hotels                                       |
| Filters work using real backend data         | ✅ PASS | API filter tests; web URL-sync test                                                         |
| Sorting works                                | ✅ PASS | API price/distance sort tests; e2e distance sort                                            |
| Map discovery works                          | ✅ PASS | e2e (map renders with height, popup on hover); API bbox/nearby tests                        |
| Hotel detail pages work                      | ✅ PASS | e2e (select rate → summary ₹6,720.00); web gallery/offers tests                             |
| Room categories can be managed               | ✅ PASS | e2e (create room); API room validation and archive-on-commitment                            |
| Date-wise inventory works                    | ✅ PASS | API atomic block/unblock, invariant, concurrency tests; web calendar tests                  |
| Pricing quotes are calculated correctly      | ✅ PASS | 13 engine precedence/rounding tests; e2e ₹3,200 × 2 + 5% GST = ₹6,720                       |
| Comparison works                             | ✅ PASS | e2e; web comparison test                                                                    |
| All relevant access controls work            | ✅ PASS | API ownership, staff permission, unpublished visibility and unauthorised modification tests |
| Tests pass                                   | ✅ PASS | 162 unit/integration (10 shared + 95 API + 57 web) and 9 e2e                                |
| Frontend and backend builds succeed          | ✅ PASS | `npm run build`                                                                             |

### Phase 2 known limitations

- Date-based search prices at most 600 matching candidates per request (documented scaling limit;
  narrow by destination or map area). Revisit with a pre-computed availability/price index if the
  catalogue grows.
- A `text_search` index exists on hotels but free-text `q` uses an escaped case-insensitive regex
  (for partial matches); Atlas Search is not configured.
- Stay-length restrictions on inventory are evaluated on the arrival date (industry-standard
  "min stay on arrival"); rate-plan min/max stay applies to the whole stay.
- Ratings on seeded listings are development samples (labelled); real reviews arrive in a later phase.
- Hovering a result opens its map popup, and leaving the card closes it; click a marker to keep a
  popup open.
- S3 storage and Mapbox styles need credentials to verify; GitHub Actions has not run (no remote run observed).

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

- Hindi translations were written for this release and have not yet been reviewed by a native-speaking editor.
- Phone numbers are stored but not verified (no SMS provider yet).
- React Router 7 publishes only its `development` build in its default export map, so the web bundle includes it (React itself is the production build).
- Access tokens cannot be revoked mid-lifetime by signature alone. Each request checks the session store instead (one extra indexed query per request). Add a Redis cache if this becomes a hotspot.
- Newsletter signup is single opt-in.

## Next steps

Provision production infrastructure and accounts (known-limitations.md), run the CI/CD pipeline
on GitHub, verify Razorpay test mode, complete the legal and tax review, then start a
controlled production pilot.
