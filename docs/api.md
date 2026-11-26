# API reference (v1)

Base path `/api/v1`. Interactive docs: `GET /api/v1/docs` (Swagger UI) and
`GET /api/v1/openapi.json` (OpenAPI 3.1; request bodies are generated from the shared Zod schemas).
Disable with `API_DOCS_ENABLED=false`.

All responses use `{ success, data }` / `{ success: false, error: { code, message, details?, requestId } }`.
Every response carries `X-Request-Id` (a well-formed incoming one is propagated).

Auth legend: **—** public · **B** bearer access token · **C** refresh cookie + `X-CSRF-Token` · `perm` required permission.

## Health (also mounted at `/health`, outside rate limiting)

| Method | Path          | Auth | Description                                                                     |
| ------ | ------------- | ---- | ------------------------------------------------------------------------------- |
| GET    | /health       | —    | Summary; `status: ok                                                            | degraded` |
| GET    | /health/live  | —    | Liveness: process responds (no dependency checks)                               |
| GET    | /health/ready | —    | Readiness: MongoDB + Redis ping; **503** if either is down (no internal detail) |

## Auth

| Method | Path                      | Auth            | Body                                                      | Success                               |
| ------ | ------------------------- | --------------- | --------------------------------------------------------- | ------------------------------------- |
| POST   | /auth/register            | —               | firstName, lastName, email, phone?, password, acceptTerms | 201 `AuthSessionDto` + cookies        |
| POST   | /auth/login               | —               | email, password                                           | 200 `AuthSessionDto` + cookies        |
| POST   | /auth/refresh             | C               | —                                                         | 200 `AuthSessionDto`, rotated cookies |
| POST   | /auth/logout              | C               | —                                                         | 200                                   |
| POST   | /auth/logout-all          | B + CSRF header | —                                                         | 200 `{ revokedSessions }`             |
| POST   | /auth/forgot-password     | —               | email                                                     | 202 (generic)                         |
| POST   | /auth/reset-password      | —               | token, password                                           | 200                                   |
| POST   | /auth/verify-email        | —               | token                                                     | 200 `{ user }`                        |
| POST   | /auth/resend-verification | —               | email                                                     | 202 (generic)                         |
| POST   | /auth/change-password     | B               | currentPassword, newPassword                              | 200                                   |
| GET    | /auth/me                  | B               | —                                                         | 200 `UserDto`                         |

## Users

| Method | Path                | Auth           | Description                                               |
| ------ | ------------------- | -------------- | --------------------------------------------------------- |
| GET    | /users/profile      | B              | Own profile                                               |
| PATCH  | /users/profile      | B              | firstName?, lastName?, phone? (`""`/`null` clears)        |
| PATCH  | /users/preferences  | B              | language?, currency?, notifications{…}? (partial merge)   |
| POST   | /users/avatar       | B              | multipart `avatar`; JPEG/PNG/WebP ≤ 2 MB, content-sniffed |
| GET    | /users/sessions     | B              | Active sessions (`current` flags this device)             |
| DELETE | /users/sessions/:id | B              | Revoke own session (others' → 404)                        |
| GET    | /users              | `users:read`   | page, limit, search, role, status                         |
| PATCH  | /users/:id/roles    | `users:manage` | `{ roles }` (privileged roles need SUPER_ADMIN)           |
| PATCH  | /users/:id/status   | `users:manage` | `{ status, reason? }`; suspension revokes sessions        |

## Notifications, audit, roles, newsletter

| Method | Path                        | Auth         | Description                                   |
| ------ | --------------------------- | ------------ | --------------------------------------------- |
| GET    | /notifications              | B            | page, limit, unreadOnly                       |
| GET    | /notifications/unread-count | B            |                                               |
| PATCH  | /notifications/:id/read     | B            | Own only (others' → 404)                      |
| POST   | /notifications/read-all     | B            |                                               |
| GET    | /audit                      | `audit:read` | page, limit, action, actorId, entityType      |
| GET    | /roles                      | `users:read` | Role → permission matrix                      |
| GET    | /permissions/me             | B            | Caller's roles and effective permissions      |
| GET    | /permissions                | `users:read` | Permission catalogue                          |
| POST   | /newsletter/subscriptions   | —            | `{ email, source? }`, idempotent              |
| GET    | /media/*                    | —            | Locally stored media (`STORAGE_DRIVER=local`) |

## Public discovery (Phase 2)

Prices and availability responses are sent with `Cache-Control: no-store` and are never cached
server-side. Only `PUBLISHED` listings are returned.

| Method         | Path                                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET            | /hotels                                      | Search. Query: destination, city, region, country, q, checkIn, checkOut, adults, children, childrenAges, rooms, propertyTypes, minPrice, maxPrice (minor units, avg nightly incl. taxes), stars, minRating, amenities, breakfast, parking, pool, wifi, petFriendly, accessible, freeCancellation, instantConfirmation, bbox (`minLng,minLat,maxLng,maxLat`), lat, lng, radiusKm, sort (`recommended · price_asc · price_desc · rating_desc · reviews_desc · distance · popularity`), page, limit |
| GET            | /hotels/featured · /hotels/trending          | `limit` ≤ 24 (cached)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GET            | /hotels/nearby                               | lat, lng, radiusKm, limit, excludeId                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET            | /hotels/compare                              | `ids` (≤ 4, comma-separated), optional checkIn, checkOut, adults, rooms                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET            | /hotels/:idOrSlug                            | Detail: content, amenities, policies, rooms and rate plans                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET            | /hotels/:idOrSlug/offers                     | Live room offers (quotes) for a stay                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET            | /hotels/:idOrSlug/similar                    | Same city, then same property type                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET            | /destinations · /destinations/suggestions?q= | Destinations (cached) and autocomplete (destinations + hotels)                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET            | /amenities                                   | Amenity catalogue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| POST           | /availability/search                         | Same criteria as `GET /hotels`, as JSON                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| POST           | /availability/quote                          | hotelId, roomTypeId, ratePlanId, checkIn, checkOut, adults, children, childrenAges, rooms, extraBeds? → `QuoteDto` with signed `quoteToken`                                                                                                                                                                                                                                                                                                                                                      |
| POST           | /availability/quote/revalidate               | `{ quoteToken }` → recalculated quote, `valid`, `priceChanged`, `reason`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| GET/PUT/DELETE | /wishlist, /wishlist/ids, /wishlist/:hotelId | **B**; own saved stays                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Partner (Phase 2) — **B**

| Method                          | Path                                                               | Auth                            | Description                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET / PUT                       | /partner/application                                               | B                               | Own application / save a draft section                                                                                                                                         |
| POST                            | /partner/application/documents                                     | B                               | multipart `file` + `type`; PDF/JPEG/PNG ≤ 5 MB, content-checked, private storage                                                                                               |
| GET / DELETE                    | /partner/application/documents/:mediaId                            | B                               | Download (owner only, `no-store`) / remove                                                                                                                                     |
| POST                            | /partner/application/submit                                        | B                               | Submit for review (required documents enforced)                                                                                                                                |
| GET / POST / DELETE             | /partner/staff, /partner/staff/:id                                 | approved owner                  | Team and per-property permissions                                                                                                                                              |
| GET / POST                      | /partner/invitations, /partner/invitations/:id/accept              | B                               | Staff invitations for the caller                                                                                                                                               |
| GET / POST                      | /partner/hotels                                                    | `partner:access`                | List accessible properties / create (approved owner)                                                                                                                           |
| GET / PATCH                     | /partner/hotels/:hotelId                                           | `CONTENT_EDIT`                  | Detail with live + working content / edit (revision once approved)                                                                                                             |
| POST                            | /partner/hotels/:hotelId/submit · /publish · /unpublish · /archive | owner                           | Workflow transitions (see [marketplace.md](marketplace.md))                                                                                                                    |
| POST / DELETE                   | /partner/hotels/:hotelId/media, /media/:mediaId                    | `CONTENT_EDIT` / `ROOMS_MANAGE` | Image upload (≤ 10 MB, `purpose`=HOTEL_IMAGE·ROOM_IMAGE) / delete unreferenced image                                                                                           |
| GET / POST / GET / PUT / DELETE | /partner/hotels/:hotelId/room-types[/:roomTypeId]                  | `ROOMS_MANAGE`                  | Room categories; delete archives when bookings/holds exist                                                                                                                     |
| GET / POST / PUT / DELETE       | /partner/hotels/:hotelId/rate-plans[/:ratePlanId]                  | `RATES_MANAGE`                  | Rate plans                                                                                                                                                                     |
| GET / POST / PUT / DELETE       | /partner/hotels/:hotelId/pricing-rules[/:ruleId]                   | `RATES_MANAGE`                  | Pricing rules                                                                                                                                                                  |
| GET                             | /partner/hotels/:hotelId/inventory                                 | `INVENTORY_MANAGE`              | roomTypeId, from, to → daily rows incl. `available`                                                                                                                            |
| PATCH                           | /partner/hotels/:hotelId/inventory                                 | `INVENTORY_MANAGE`              | `{ roomTypeId, from, to, daysOfWeek?, set: { blockedRooms?, closedToArrival?, closedToDeparture?, minimumStay?, maximumStay? } }`; atomic, `409` + `details.dates` on conflict |
| POST                            | /partner/hotels/:hotelId/quote-preview                             | `RATES_MANAGE`                  | Quote for an unpublished listing                                                                                                                                               |

Staff permissions apply only to their assigned properties; owners have all of them.

## Admin review (Phase 2)

| Method | Path                                   | Auth               | Description                                                                                                               |
| ------ | -------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| GET    | /admin/partners, /admin/partners/:id   | `partners:approve` | Applications (page, limit, status, search)                                                                                |
| GET    | /admin/partners/:id/documents/:mediaId | `partners:approve` | Document download (audited)                                                                                               |
| POST   | /admin/partners/:id/decision           | `partners:approve` | APPROVE (also reinstates a suspended partner) · REJECT · REQUEST_DOCUMENTS · SUSPEND (reason required except for APPROVE) |
| GET    | /admin/hotels, /admin/hotels/:hotelId  | `hotels:moderate`  | Listings (status, revision, search) with rooms and rate plans                                                             |
| POST   | /admin/hotels/:hotelId/decision        | `hotels:moderate`  | START_REVIEW · APPROVE · REJECT · APPROVE_REVISION · REJECT_REVISION · SUSPEND · REINSTATE · FEATURE                      |

## Reservations, payments and account (Phase 3) — **B**

State-creating POSTs marked **IK** require an `Idempotency-Key` header (8–128 chars); a replay
returns the original result, a reused key with a different body returns 422
`IDEMPOTENCY_KEY_REUSED`. Request bodies are strict (unknown keys → 422). See
[reservations.md](reservations.md) for the state machines.

| Method                            | Path                                                                    | Notes                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST                              | /bookings/holds                                                         | **IK** `{ hotelId, checkIn, checkOut, items: [{ roomTypeId, ratePlanId, rooms, adults, childrenAges, extraBeds }] }` → `HoldDto` (server-priced, expires in `BOOKING_HOLD_TTL_MINUTES`) |
| GET / DELETE                      | /bookings/holds/:reference                                              | Own hold / release it (idempotent)                                                                                                                                                      |
| POST                              | /bookings                                                               | **IK** `{ holdReference, guestDetails, acceptTerms: true }` → `BookingDetailDto` (`PENDING_PAYMENT`)                                                                                    |
| GET                               | /bookings                                                               | page, limit, view (`all · upcoming · pending · past · cancelled`), status, q                                                                                                            |
| GET                               | /bookings/:reference                                                    | Detail incl. snapshots, payments, refunds, timeline and allowed `actions`                                                                                                               |
| GET                               | /bookings/:reference/cancellation                                       | Policy preview: eligibility, charge, refundable amount                                                                                                                                  |
| POST                              | /bookings/:reference/cancel                                             | **IK** `{ reason? }` → charge, refund, `alreadyCancelled`                                                                                                                               |
| POST                              | /bookings/:reference/refund-requests                                    | `{ reason }` — cancelled bookings; needs an admin decision                                                                                                                              |
| POST                              | /bookings/:reference/payments                                           | **IK** → `CheckoutConfigDto` (key id + order id; never a secret)                                                                                                                        |
| POST                              | /bookings/:reference/payments/verify                                    | `{ providerOrderId, providerPaymentId, signature }` → outcome `CONFIRMED · PROCESSING · RECONCILIATION_REQUIRED · FAILED`                                                               |
| POST                              | /bookings/:reference/payments/sandbox-complete                          | **Sandbox provider only** (route absent with Razorpay): `{ outcome, deliverWebhook }`                                                                                                   |
| GET                               | /bookings/:reference/documents/confirmation · /invoice                  | PDF downloads (owner only, `no-store`)                                                                                                                                                  |
| POST                              | /bookings/:reference/review                                             | Verified review for a completed stay                                                                                                                                                    |
| POST                              | /payments/webhooks/razorpay                                             | **No auth** — HMAC `X-Razorpay-Signature` over the raw body, `X-Razorpay-Event-Id` de-duplicated                                                                                        |
| GET                               | /account/overview · /payments · /refunds · /reviews · /reviews/eligible | Dashboard data from the caller's own records                                                                                                                                            |
| GET / POST / GET / PATCH / DELETE | /wishlists[/:id]                                                        | Named lists; `GET /:id?checkIn&checkOut` adds live prices                                                                                                                               |
| PUT / DELETE                      | /wishlists/:id/items/:hotelId                                           | Save (with `{ note }`) / remove                                                                                                                                                         |
| POST / DELETE                     | /wishlists/:id/share                                                    | Create/rotate or revoke the share link                                                                                                                                                  |
| GET                               | /wishlists/shared/:token                                                | **Public**, read-only (no notes, no ids)                                                                                                                                                |
| GET / PUT / DELETE                | /wishlist, /wishlist/ids, /wishlist/:hotelId                            | Heart button (default list)                                                                                                                                                             |
| POST                              | /reviews/photos                                                         | multipart `file` (image)                                                                                                                                                                |
| PUT                               | /reviews/:id                                                            | Edit within the window/edit limit                                                                                                                                                       |
| POST                              | /reviews/:id/report                                                     | `{ reason, details? }` (idempotent per user)                                                                                                                                            |
| GET                               | /hotels/:idOrSlug/reviews                                               | **Public**: page, limit, sort (`recent · highest · lowest`) + category summary                                                                                                          |
| GET / POST                        | /support/tickets                                                        | List / create (multipart: subject, category, bookingReference?, message, file?)                                                                                                         |
| GET                               | /support/tickets/:id · /attachments/:mediaId                            | Own tickets / private attachments                                                                                                                                                       |
| POST                              | /support/tickets/:id/messages · /close                                  | Reply (multipart) / close                                                                                                                                                               |

### Property side — `bookings:read-property` + resource access (`BOOKINGS_MANAGE` for staff)

| Method | Path                                                               | Notes                                                             |
| ------ | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| GET    | /partner/hotels/:hotelId/bookings                                  | view `arrivals · upcoming · past · all` (confirmed-or-later only) |
| POST   | /partner/hotels/:hotelId/bookings/:reference/check-in · /check-out | On/after the arrival date / after check-in                        |
| POST   | /partner/hotels/:hotelId/bookings/:reference/no-show               | `{ note? }` — policy no-show refund, frees remaining nights       |
| POST   | /partner/hotels/:hotelId/bookings/:reference/reject                | `{ reason }` — before check-in, full refund                       |
| GET    | /partner/hotels/:hotelId/reviews                                   | Reviews of the property                                           |
| PUT    | /partner/hotels/:hotelId/reviews/:reviewId/response                | `{ body }` (no delete endpoint exists)                            |

### Operations — `admin:access`

| Method     | Path                                          | Permission         | Notes                                                                                                                    |
| ---------- | --------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| GET        | /admin/operations                             | `payments:read`    | Reconciliation exceptions, refunds needing attention, refund requests, failed deliveries, flagged reviews, outbox counts |
| POST       | /admin/refunds/:id/retry                      | `refunds:manage`   | FAILED → APPROVED → processed again                                                                                      |
| POST       | /admin/refunds/:id/decision                   | `refunds:manage`   | `{ decision: APPROVE, amountMinor }` or `{ decision: REJECT, reason }`                                                   |
| POST       | /admin/bookings/:reference/refunds            | `refunds:manage`   | **IK** `{ amountMinor, reason }` partial/full refund                                                                     |
| POST       | /admin/notifications/deliveries/:id/retry     | `payments:read`    | Re-run a failed notification delivery                                                                                    |
| GET / POST | /admin/reviews, /admin/reviews/:id/moderation | `reviews:moderate` | `{ decision: REMOVE · RESTORE · DISMISS_REPORTS, reason }`                                                               |

## Phase 4 — operations, administration and intelligent features

All routes are under `/api/v1`. **B** = bearer auth required. "Property access" means the
permission checked against the specific property.

### Partner — **B**

| Method             | Path                                                                                            | Access                                                   | Notes                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET                | /partner/analytics                                                                              | `analytics:view` on each property                        | `from`, `to`, `hotelIds`, `currency`, `format=csv` ([analytics.md](analytics.md)) |
| GET / PATCH / POST | /partner/staff/:id, /suspend, /reactivate, /activity                                            | owner                                                    | Edit access, suspend or reactivate, view the activity log                         |
| GET / POST / PUT   | /partner/hotels/:hotelId/bookings/:ref, /notes, /rooms                                          | `bookings:view` · `bookings:notes` · `bookings:check-in` | Detail, internal notes, room assignment                                           |
| GET / POST         | /partner/hotels/:hotelId/inventory/blocks, /:blockId/release                                    | `inventory:view` · `inventory:manage`                    | Maintenance blocks                                                                |
| PATCH              | /partner/hotels/:hotelId/inventory                                                              | `inventory:manage`                                       | `set.stopSell` added                                                              |
| GET / PUT          | /partner/hotels/:hotelId/accessibility                                                          | `property:edit`                                          | Read or declare accessibility features                                            |
| GET / POST / PATCH | /partner/hotels/:hotelId/channels, /:id, /rotate-secret, /sync, /events, /events/:eventId/retry | `property:edit` (manage), `inventory:view` (read)        | Channel manager                                                                   |
| GET                | /partner/finance/summary, /settlements, /settlements/:id/entries                                | owner                                                    | Partner-wide payables and settlements                                             |
| GET                | /partner/finance/ledger                                                                         | owner, or staff with `financials:view`                   | Staff see entries for their permitted properties only                             |
| GET / POST         | /partner/support/tickets, /:id, /:id/messages, /:id/attachments/:mediaId                        | `bookings:view` on the ticket's property                 | Tickets shared by support only                                                    |

### Admin — **B**

| Method                    | Path                                                                                                                 | Permission                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET                       | /admin/dashboard                                                                                                     | `reports:view`                                                                                      |
| GET                       | /admin/analytics (`format=csv`)                                                                                      | `analytics:platform`                                                                                |
| GET                       | /admin/customers, /admin/customers/:id                                                                               | `users:read`                                                                                        |
| GET / POST / PUT / DELETE | /admin/catalog/{amenities,destinations,categories}[/:id]                                                             | `catalog:manage`                                                                                    |
| GET                       | /admin/bookings                                                                                                      | `bookings:read-all`                                                                                 |
| POST                      | /admin/bookings/:ref/escalations                                                                                     | `bookings:manage`                                                                                   |
| GET                       | /admin/escalations                                                                                                   | `bookings:read-all`                                                                                 |
| POST                      | /admin/escalations/:id/resolve                                                                                       | `bookings:manage`                                                                                   |
| GET                       | /admin/payments (`exceptions=true`), /admin/refunds                                                                  | `payments:read`                                                                                     |
| GET / POST / PUT          | /admin/commissions, /admin/commissions/preview                                                                       | `payments:read` · `commissions:manage`                                                              |
| GET                       | /admin/finance/ledger, /admin/finance/summary                                                                        | `payments:read`                                                                                     |
| GET / POST                | /admin/settlements, /:id/entries, /:id/hold, /:id/release, /:id/fail                                                 | `payments:read` · `settlements:manage`                                                              |
| POST                      | /admin/settlements/:id/initiate-payout                                                                               | Always **409**: payouts are disabled                                                                |
| POST                      | /admin/settlements/:id/record-payment                                                                                | `settlements:manage`. Multipart `method`, `providerReference`, `paidAt`, `file` (evidence required) |
| GET / POST / PUT          | /admin/coupons, /admin/coupons/performance                                                                           | `coupons:manage`                                                                                    |
| GET / POST / PATCH        | /admin/support/tickets, /:id, /assign, /escalate, /resolve, /messages, /attachments/:mediaId, /admin/support/metrics | `support:manage`                                                                                    |
| GET / POST / PUT          | /admin/content, /images, /:id, /revisions, /publish, /unpublish, /archive, /restore, /preview                        | `content:manage`                                                                                    |
| GET / POST                | /admin/hotels/:hotelId/accessibility, /accessibility/verify                                                          | `hotels:moderate` (evidence required to verify; never shown publicly)                               |
| GET / POST                | /admin/organizations, /admin/organizations/:id/decision                                                              | `users:manage`                                                                                      |

### Customer and public

| Method                    | Path                                                                                                                                                                        | Auth               | Notes                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| POST                      | /coupons/check                                                                                                                                                              | **B**              | Check a code against a hold                                                                          |
| PUT / DELETE              | /bookings/holds/:reference/coupon                                                                                                                                           | **B** (hold owner) | `{ code }`. Reprices the active hold and reserves the coupon atomically; 409 once a booking exists   |
| GET                       | /recommendations                                                                                                                                                            | **B**              | Personalised only with consent (`PATCH /users/preferences { personalization: { recommendations } }`) |
| GET                       | /price-intelligence/:hotel/calendar, /history                                                                                                                               | public             | Flexible dates (up to 14 check-in dates, served from the public cache) and observed history          |
| GET / POST / DELETE       | /price-alerts[/:id]                                                                                                                                                         | **B**              | Up to 20 active alerts                                                                               |
| GET                       | /deals/last-minute                                                                                                                                                          | public             | Only against observed history                                                                        |
| GET / POST                | /rewards/loyalty, /loyalty/redeem, /referrals, /referrals/claim                                                                                                             | **B**              | Loyalty and referrals                                                                                |
| GET / POST / PUT / DELETE | /trips, /trips/:id, /items, /invitations, /members/:id, /sharing, /trips/invitations/accept                                                                                 | **B**              | TripSpace                                                                                            |
| GET                       | /trips/shared/:token                                                                                                                                                        | public             | Read-only (hotels and dates)                                                                         |
| *                         | /corporate/organizations, /organization, /organization/policy, /members, /invitations, /requests, /requests/:id/decision, /requests/:id/booking, /reports, /invoices[/:ref] | **B**              | Scoped to the caller's organisation                                                                  |
| POST                      | /assistant/messages                                                                                                                                                         | **B**              | `{ message, history }`. Rate limited per user (`RATE_LIMITED` 429)                                   |
| GET                       | /content?type=, /content/:type/:slug, /content/preview/:token                                                                                                               | public             | Published content (cached 60 s only when successful). Previews are `no-store` and `noindex`          |
| GET                       | /categories                                                                                                                                                                 | public             | Browse categories                                                                                    |
| GET                       | /currency/rates, /currency/convert                                                                                                                                          | public             | ECB reference rates. Display only                                                                    |
| GET                       | /hotels?accessibilityFeatures=…&accessibilityVerifiedOnly=true                                                                                                              | public             | Accessibility filters                                                                                |
| POST                      | /channels/webhooks/:connectionId                                                                                                                                            | HMAC signature     | Raw body. `x-stayscape-channel-signature: t=…,v1=…`                                                  |

## Error codes

`VALIDATION_ERROR` (422, with `details.fieldErrors`), `BAD_REQUEST` (400), `AUTH_REQUIRED`,
`INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `SESSION_REVOKED`,
`REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_REUSED` (401), `CSRF_INVALID`, `ACCOUNT_SUSPENDED`,
`ACCOUNT_DEACTIVATED`, `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT`, `EMAIL_TAKEN` (409),
`VERIFICATION_TOKEN_INVALID` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415),
`RATE_LIMITED` (429), `SERVICE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500 — details only in logs).
Phase 3: `IDEMPOTENCY_KEY_REQUIRED` (400), `IDEMPOTENCY_KEY_REUSED` (422), `INVENTORY_UNAVAILABLE`,
`HOLD_EXPIRED`, `INVALID_STATE` (409), `NOT_ELIGIBLE` (403/409), `PAYMENT_VERIFICATION_FAILED` (400),
`PAYMENT_PROVIDER_ERROR` (502).
