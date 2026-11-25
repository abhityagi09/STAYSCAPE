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

## Error codes

`VALIDATION_ERROR` (422, with `details.fieldErrors`), `BAD_REQUEST` (400), `AUTH_REQUIRED`,
`INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `SESSION_REVOKED`,
`REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_REUSED` (401), `CSRF_INVALID`, `ACCOUNT_SUSPENDED`,
`ACCOUNT_DEACTIVATED`, `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT`, `EMAIL_TAKEN` (409),
`VERIFICATION_TOKEN_INVALID` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415),
`RATE_LIMITED` (429), `SERVICE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500 — details only in logs).
