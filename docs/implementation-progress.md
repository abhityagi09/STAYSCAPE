# Implementation progress

Last updated: 2026-11-26 · Current phase: **Phase 4 — complete** (see verification below). Phases 1–3
re-verified with Phase 4 (the full unit, API and end-to-end suites).

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
- `npm test`: shared 10/10, API 189/189 (28 files), web 83/83 (9 files).
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
- **Hindi:** navigation and the new Phase 4 screens are translated. Older screens fall back to
  English text.
- **Recharts:** not used. Charts are inline SVG with table alternatives, to avoid a new dependency.
- Corporate travel requests take property, room and rate ids; there is no property picker yet.

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

- Hindi translation covers navigation and Phase 4 screens; older screens still use English text.
- Phone numbers are stored but not verified (no SMS provider yet).
- React Router 7 publishes only its `development` build in its default export map, so the web bundle includes it (React itself is the production build).
- Access tokens cannot be revoked mid-lifetime by signature alone. Each request checks the session store instead (one extra indexed query per request). Add a Redis cache if this becomes a hotspot.
- Newsletter signup is single opt-in.

## Upcoming phases

- **Phase 5**: to be specified. Candidates from Phase 4: a third-party channel-manager adapter (with
  API access), a payout provider, the live Claude API (with a key), complete Hindi coverage, mobile
  push.
