# Implementation progress

Last updated: 2026-11-25 · Current phase: **Phase 2 — complete** (see verification below). Phase 1
verified 2026-11-22 and re-verified with Phase 2.

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

- Hindi is selectable as a preference but the UI is not yet translated (labelled in the UI).
- Phone numbers are stored but not verified (no SMS provider yet).
- React Router 7 publishes only its `development` build in its default export map, so the web bundle includes it (React itself is the production build).
- Access tokens cannot be revoked mid-lifetime by signature alone. Each request checks the session store instead (one extra indexed query per request). Add a Redis cache if this becomes a hotspot.
- Newsletter signup is single opt-in.

## Upcoming phases

- **Phase 3**: bookings (transactional inventory holds), Razorpay payments + refunds (idempotent), payouts, reporting (Recharts).
- **Later**: reviews, AI features, mobile push.
