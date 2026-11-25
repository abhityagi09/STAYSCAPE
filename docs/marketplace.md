# Marketplace (Phase 2)

How partners, listings, rooms, inventory, pricing and search fit together. Source of truth for the
rules below is the code referenced in each section.

## Partner onboarding

`apps/api/src/modules/partners` · UI: `/partner/onboarding` (6-step wizard), `/admin/partners`.

```
REGISTERED ──submit──→ UNDER_REVIEW ──APPROVE──→ APPROVED ⇄ SUSPENDED
                          │  │                    (SUSPEND / APPROVE reinstates)
     REQUEST_DOCUMENTS ←──┘  └──→ REJECT
             ↓                       ↓
     DOCUMENTS_PENDING          REJECTED      (both editable; resubmit → UNDER_REVIEW)
```

Admin decisions: `APPROVE` (also grants the `HOTEL_OWNER` role, in one transaction),
`REJECT` and `REQUEST_DOCUMENTS` (reason required, shown to the owner), `SUSPEND`.

- Each step is saved as a draft (`PUT /partner/application`) and restored on return.
- Only `REGISTERED`, `DOCUMENTS_PENDING` and `REJECTED` applications are editable; a rejection
  reason is shown and the owner can resubmit.
- Submission requires business registration, identity proof and bank proof documents.
- Verification documents go to **private storage** (`PRIVATE_UPLOAD_DIR` / `S3_PRIVATE_BUCKET`),
  are never publicly served, are streamed only to their owner or a `partners:approve` admin
  (`Cache-Control: no-store`), and every admin view is audited.
- The settlement account number is encrypted at rest (AES-256-GCM, `DATA_ENCRYPTION_KEY`) and
  only its last four digits are ever returned.
- An admin cannot review their own application or property.
- Owners can invite staff with per-property permissions: `CONTENT_EDIT`, `ROOMS_MANAGE`,
  `INVENTORY_MANAGE`, `RATES_MANAGE`.

## Property publication workflow

`apps/api/src/modules/hotels/hotels.service.ts`

```
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → PUBLISHED
  ↑         └──────────┴──→ REJECTED     ↕ (unpublish)
  └───────────────────────────┘
APPROVED / PUBLISHED → SUSPENDED (admin) → APPROVED (reinstate)
any (except SUSPENDED) → ARCHIVED (refused while future bookings or holds exist)
```

- Only `PUBLISHED` listings are visible publicly (search, detail, quotes, wishlist, compare).
- Submission requires completeness: valid content, map location, ≥ 1 photo, an active room
  category with rooms and an active rate plan.
- **Re-approval:** once a listing has been approved (`everApproved`), content edits never touch the
  live listing. They accumulate in `revision.data` (`DRAFT → SUBMITTED → approved/rejected`), and
  only `APPROVE_REVISION` copies them onto the live document. Travellers keep seeing the approved
  content until then.
- Rooms, rates and inventory are operational data and take effect immediately (they do not change
  what was reviewed).

## Media

`apps/api/src/modules/media` · `apps/api/src/lib/file-signature.ts`

- Images: JPEG/PNG/WebP/AVIF up to 10 MB; documents: PDF/JPEG/PNG up to 5 MB.
- The declared MIME type **and** the file's magic bytes must match an allowed type; images are
  additionally decoded by `sharp` (pixel limit enforced).
- Uploads are backend-controlled (multipart → API → storage). Storage keys are random and
  partner-scoped; MongoDB stores only metadata and variant URLs, never binaries.
- Each image produces WebP variants (`sm`, `md`, `lg`, aspect ratio preserved, never enlarged)
  plus an AVIF `md` variant. EXIF/GPS metadata is stripped. The web app serves them through
  `<picture>` with `srcset`, `loading="lazy"` and a dominant-colour placeholder.
- Ownership is checked on attach and delete; a photo used by the live listing, the pending
  revision or a room cannot be deleted.
- `media.cleanup` (BullMQ, hourly) removes unattached uploads older than
  `MEDIA_ORPHAN_TTL_HOURS` after re-checking every place a file can be referenced.
- Adapters: `LocalStorageProvider` (development) and `S3StorageProvider` (any S3-compatible
  store; not verified without credentials).

## Inventory

`apps/api/src/modules/inventory`

- One `DailyInventory` row per room type per **property-local date** (`localDate`, a
  `"YYYY-MM-DD"` string). Dates are never derived from the server's time zone; "today" is computed
  in the hotel's `timeZone`.
- `available = totalRooms − blockedRooms − heldRooms − bookedRooms`, never negative. This is
  enforced three ways: conditional updates (`$expr`) in the service, transactions for multi-date
  changes (all dates or none), and a MongoDB collection validator using `$expr`
  (`ensureInventoryValidator`, applied at startup and by `npm run db:indexes`) that rejects any
  write breaking it, even one that bypasses the application.
- Partners cannot block rooms, or reduce a room type's total, below what is already held or
  booked; the API returns `409` with the conflicting dates.
- Room types that have ever had holds or bookings are archived instead of deleted.

### Reservation primitives (used by Phase 3)

`InventoryService.reserveHeld / releaseHeld / commitHeld / bookDirect / releaseBooked` — each takes
the caller's MongoDB session and applies one conditional `updateMany` across every night, throwing
(and so aborting the caller's transaction) unless every night matched. Holds, bookings and their
idempotency live in the booking module — see [reservations.md](reservations.md).

| Primitive       | Effect                                          | Condition on every night |
| --------------- | ----------------------------------------------- | ------------------------ |
| `reserveHeld`   | `heldRooms += n`                                | available ≥ n            |
| `releaseHeld`   | `heldRooms −= n`                                | heldRooms ≥ n            |
| `commitHeld`    | held → booked                                   | heldRooms ≥ n            |
| `bookDirect`    | `bookedRooms += n` (late payment re-allocation) | available ≥ n            |
| `releaseBooked` | `bookedRooms −= n` (cancellation, no-show)      | bookedRooms ≥ n          |

Concurrency is covered by a test that fires 12 simultaneous single-room reservations at 5 rooms and
expects exactly 5 to succeed with every night held equally.

## Pricing engine

`apps/api/src/modules/pricing/pricing.engine.ts` (pure, no I/O) and `quote.service.ts`.

All money is **integer minor units** (paise). Percentages are **basis points** (1% = 100 bp).
JavaScript numbers are only used as integers; every intermediate is checked with
`Number.isSafeInteger`.

### Precedence (per night, per room)

1. **Base** — the rate plan's `basePriceMinor`.
2. **Date override** — the highest-priority active `DATE_OVERRIDE` covering the night sets a fixed
   price. When one applies, step 3 is skipped for that night.
3. **Date adjustments** — `WEEKDAY`, `WEEKEND`, `SEASONAL`, `EVENT` rules covering the night,
   sorted by `priority` (desc) then rule id (asc). If the top rule is `EXCLUSIVE`, only it applies;
   otherwise every `STACKABLE` rule applies in that order, each to the running amount.
4. **Supplements** — adults/children beyond the plan's included guests, extra beds, and the meal
   supplement per guest. Guests are spread across rooms as evenly as possible. Children aged
   13+ count as adults.
5. **Discounts** — `LONG_STAY` (`minNights`), `EARLY_BIRD` (`minDaysBeforeArrival`),
   `LAST_MINUTE` (`maxDaysBeforeArrival`) eligible for the stay, selected with the same
   EXCLUSIVE/STACKABLE rule, applied to the room-night amount after supplements.
6. **Taxes** — per room-night on the discounted amount, using the slab containing that amount
   (e.g. GST slabs). **Fees** are untaxed and charged `PER_STAY`, `PER_NIGHT` or `PER_ROOM_NIGHT`.
7. **Breakdown** — nightly lines, adjustments, discounts, taxes, fees and totals are all returned.

A night never goes below zero. Rules are scoped to a hotel and optionally a room type and/or rate
plan.

### Rounding

`applyBasisPoints(amount, bp)` = `amount × bp / 10000` rounded **half away from zero** to a whole
minor unit, computed with integer division. Rounding happens at each percentage step, per room per
night, so totals are the exact sum of the displayed lines. `nightlyAverageMinor` in search results is
display-only (`round(total / nights)`); the authoritative amount is always `totals.totalMinor`.

### Quotes

`POST /availability/quote` returns property, room, rate plan, dates, nights, rooms, occupancy,
nightly breakdown, discounts, taxes, fees, total, currency, `roomsLeft`, `expiresAt` and an
HMAC-signed `quoteToken` (`QUOTE_SIGNING_SECRET`, TTL `QUOTE_TTL_SECONDS`).
`POST /availability/quote/revalidate` verifies the token and **recalculates** from current rates
and inventory, reporting any price change. Phase 3 must call it before creating a booking; the
token is never trusted as a price.

Quotes also enforce: check-in not in the past (property-local), rate-plan min/max stay,
closed-to-arrival / closed-to-departure, arrival-date min/max stay, occupancy per room, and
availability for every night.

## Search

`apps/api/src/modules/search/search.service.ts`

- **Without dates:** one aggregation pipeline filters, sorts and paginates in MongoDB (no prices
  are shown — a base price is never presented as a stay price).
- **With dates:** candidates matching the non-price filters are priced through the quote engine;
  hotels that cannot satisfy every night and the room count are excluded. Price filters apply to
  the average nightly price incl. taxes and fees. Sorting is stable (ties broken by id).
  Documented limit: at most 600 candidates are priced per request.
- Geospatial: `2dsphere` index, `$geoWithin` bounding boxes (coordinates validated:
  lng −180…180, lat −90…90), radius search, `$geoNear` for nearby and distance sort.
- Caching: destinations, amenities, featured and trending lists are cached in Redis
  (`SEARCH_CACHE_TTL_SECONDS`) and invalidated on publication changes. **Availability and prices
  are never cached** (`Cache-Control: no-store`).
- Analytics (`searchevents`, 180-day TTL): destination, arrival month, nights, guest/room counts,
  filter names, sort, result count. No user id, IP address or exact dates.
- The web client cancels superseded requests (`AbortSignal` via TanStack Query) and debounces map
  moves (500 ms) and destination suggestions (250 ms).

## Maps

`apps/web/src/components/map/MapView.tsx`, `apps/web/src/lib/map/provider.ts`

MapLibre GL (loaded on demand) with clustered, price-labelled markers, a themed popup for the
selected/hovered property, search-as-I-move with server-side bounding boxes, and list ↔ map
highlighting. Default tiles: OpenFreeMap (no key). Mapbox or any MapLibre-compatible style can be
used by setting `VITE_MAP_STYLE_URL`. The results list remains the accessible alternative.

## Comparison

Up to 4 properties, stored client-side (Redux + `localStorage`, ids and names only). The compare
page fetches `GET /hotels/compare` for live data and, when dates are present, real prices.
