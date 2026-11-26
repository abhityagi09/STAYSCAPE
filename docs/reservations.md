# Reservations, payments and refunds (Phase 3)

How a stay goes from "Select" to a confirmed, paid, cancellable and reviewable booking. The
source of truth for every allowed status change is
[`packages/shared/src/constants/booking.ts`](../packages/shared/src/constants/booking.ts); there is
no generic status-update endpoint — each change is an explicit domain operation.

## State machines

**Booking** (`bookingStatus`) and **payment** (`paymentStatus`) are separate fields.

```
PENDING_PAYMENT ─createOrder→ PAYMENT_PROCESSING ─payment failed→ PENDING_PAYMENT (retry while held)
      │                              │
      │ cancel / hold expiry         ├─ verified payment + live hold ──────────────→ CONFIRMED
      ▼                              ├─ verified payment, hold gone, rooms free ────→ CONFIRMED (re-allocated)
  CANCELLED / EXPIRED                └─ verified payment, hold gone, rooms taken ───→ RECONCILIATION_REQUIRED
                                                                                      └─ full refund settles → CANCELLED
CONFIRMED → CHECKED_IN → CHECKED_OUT → COMPLETED      (job completes stays after check-out)
CONFIRMED → CANCELLED (guest, policy) | REJECTED (property declines, full refund) | CANCELLED (no-show)
EXPIRED   → CONFIRMED | RECONCILIATION_REQUIRED       (only via a late verified payment)
```

| Payment                                                  |                           | Refund                          |                                         | Hold              |                          |
| -------------------------------------------------------- | ------------------------- | ------------------------------- | --------------------------------------- | ----------------- | ------------------------ |
| INITIATED → PENDING                                      | order created             | REQUESTED → APPROVED/REJECTED   | admin decides customer requests         | ACTIVE → CONSUMED | payment confirmed        |
| PENDING → SUCCESS / FAILED                               | verified result           | APPROVED → PROCESSING           | atomic claim before calling the gateway | ACTIVE → RELEASED | guest abandons / cancels |
| FAILED → SUCCESS                                         | a later attempt succeeded | PROCESSING → SUCCEEDED / FAILED | **only** on the provider's answer       | ACTIVE → EXPIRED  | expiry worker            |
| SUCCESS → REFUND_PENDING → PARTIALLY_REFUNDED / REFUNDED |                           | FAILED → APPROVED               | admin retry                             |                   |                          |

A failure never overwrites a success (out-of-order webhooks are safe).

## Inventory hold engine

`BookingsService.createHold` (`POST /bookings/holds`, `Idempotency-Key` required):

1. authenticated customer with `bookings:create`; at most 3 unbooked live holds per customer;
2. `QuoteService.quote` re-validates publication, room/rate status, dates (property-local), capacity,
   arrival/departure restrictions and availability, and **recalculates the price** — the request has
   no price fields (unknown keys are rejected);
3. one MongoDB transaction: `InventoryService.reserveHeld` runs a single conditional `updateMany`
   over every stay night (check-in … day before check-out, never the check-out date) requiring
   `total − blocked − held − booked ≥ rooms`; if any night fails, the transaction aborts — all nights
   or none. The collection validator independently forbids negative availability;
4. the hold stores item, price, policy and hotel snapshots and `expiresAt = now + BOOKING_HOLD_TTL_MINUTES` (10).

Redis locks are not used for correctness. Concurrency is covered by tests (12 parallel holds on 5
rooms → exactly 5 succeed; two customers racing for the final room → one 201, one 409).

**Expiry worker** (`bookings.expire-holds`, every 30 s; MongoDB TTL is deliberately _not_ used because
it would not release counters): for each `ACTIVE` hold past `expiresAt`, in one transaction, the
conditional `ACTIVE → EXPIRED` update is the guard, then held rooms are released and an unpaid
booking becomes `EXPIRED`. Re-runs, concurrent workers and restarts are safe (tested repeatedly).

## Booking creation

`POST /bookings` with `{ holdReference, guestDetails, acceptTerms: true }` and an `Idempotency-Key`.
Ownership is part of the hold query (another customer's hold reads as 404). The hold must be
`ACTIVE` and unexpired (`HOLD_EXPIRED` otherwise). Duplicate creation is impossible three ways: the
idempotency key (a reused key with a different body → 422 `IDEMPOTENCY_KEY_REUSED`), a unique index
on `booking.holdId`, and the conditional claim of the hold. Concurrent duplicates return the same
booking. References look like `SS-7KQ2M9XA`.

## Payments

Provider abstraction: [`payments/providers/payment-provider.ts`](../apps/api/src/modules/payments/providers/payment-provider.ts).

| Provider                 | Use                                   | Notes                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RazorpayProvider`       | production / Razorpay test mode       | Official REST API; checkout signature = HMAC-SHA256(`order_id                                                                                                                                           | payment_id`, key secret); webhook signature = HMAC-SHA256(raw body, webhook secret). **Not verified against live Razorpay in this repository (no keys).** |
| `SandboxPaymentProvider` | local development and automated tests | Labelled in the UI ("no real money moves"); same signature scheme and webhook payloads, stateful (orders/payments/refunds can be fetched), scriptable failures. **Refused when `NODE_ENV=production`.** |

Flow: `POST /bookings/:ref/payments` creates (or reuses the open) provider order for the
**server-side** booking total and returns a safe checkout config (key id, order id, amount, prefill —
never a secret). The browser opens Razorpay Checkout (or the sandbox panel); its callback is sent to
`POST /bookings/:ref/payments/verify`, which (1) verifies the signature and (2) fetches the payment
from the provider, checks order/amount/currency, captures if only authorised, and only then settles.
A browser callback alone never confirms anything.

`POST /api/v1/payments/webhooks/razorpay` is mounted **before** the JSON parser (raw bytes for the
HMAC) and outside the rate limiter. Each event is stored in `paymentevents` with a unique
`(provider, providerEventId)`; duplicates are acknowledged without re-processing, while an event that
previously failed is processed again. Handled: `payment.captured`, `payment.authorized`,
`order.paid`, `payment.failed`, `refund.processed`, `refund.failed`.

### Reconciliation (recovery matrix)

`payments.reconcile` runs every 2 minutes.

| Situation                                              | Recovery                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser closed / frontend timeout after paying         | Reconciliation fetches the order's payments from the gateway and settles.                                                                                           |
| Webhook late, duplicated or out of order               | Unique event ids; settlement is idempotent; failure never overrides success.                                                                                        |
| Payment fails after order creation                     | `FAILED`, booking back to `PENDING_PAYMENT`, retry with the open hold.                                                                                              |
| Hold expired during payment                            | Re-allocate if every night is still free (→ `CONFIRMED`); otherwise `RECONCILIATION_REQUIRED`, automatic full refund, ops alert, audit — never a double allocation. |
| Database failure after the provider succeeded          | Transaction rolls back; the next webhook delivery or reconciliation settles it.                                                                                     |
| Crash between "payment recorded" and "rooms allocated" | Reconciliation finds `paymentStatus SUCCESS` bookings still awaiting allocation.                                                                                    |
| Customer pays twice / pays a cancelled booking         | The extra payment is recorded and refunded in full automatically.                                                                                                   |
| Worker restart mid-processing                          | State lives in MongoDB; stuck webhook events and refunds are re-driven.                                                                                             |

Successful payments are never discarded.

## Cancellation policy engine

[`bookings/cancellation-policy.ts`](../apps/api/src/modules/bookings/cancellation-policy.ts) — pure,
integer-only. The policy is snapshotted on the booking. Deadlines use the property's wall clock:
`checkIn = check-in date + check-in time in the property's IANA zone` (DST-correct), free deadline
`= checkIn − freeCancellationHours`.

| Policy                      | Before free deadline                                                                                    | After deadline / any time |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------- |
| `FREE_CANCELLATION`         | full refund                                                                                             | after-deadline rule       |
| `PARTIALLY_REFUNDABLE`      | after-deadline rule                                                                                     | after-deadline rule       |
| `NON_REFUNDABLE`            | no refund                                                                                               | no refund                 |
| after-deadline rule         | `fixedChargeMinor` set → charge `min(fixed, paid)`; else refund `paid × refundBasisPointsAfterDeadline` |
| no-show (property-recorded) | refund `paid × noShowRefundBasisPoints`                                                                 |

Guests cannot cancel online after the check-in time. Rounding: basis points round half away from
zero (same helper as pricing); `charge = paid − refund` exactly. `GET /bookings/:ref/cancellation`
previews eligibility, charge and refund; `POST /bookings/:ref/cancel` performs it in one transaction
(status, inventory release, unique cancellation record, approved refund). Duplicate requests return
the existing cancellation (`alreadyCancelled: true`).

## Refunds

One refund per approved operation (unique `idempotencyKey`, e.g. `cancellation.<bookingId>`).
`APPROVED → PROCESSING` is an atomic claim; the gateway receives `receipt = refund id`. If a response
is lost, the retry first lists the payment's refunds at the provider and adopts the one with that
receipt instead of creating another (tested). `SUCCEEDED` is set only when the provider reports
`processed` (response, webhook or reconciliation). On failure: the refund is `FAILED`, the payment
status is compensated (no longer "refund pending"), operations are alerted, it is audited, and an
administrator can retry. Partial and full refunds update `refundedMinor`; amounts can never exceed
the captured amount.

## Notifications and the transactional outbox

Domain services write `outboxevents` in the **same transaction** as the state change (idempotent
upsert by `eventId`). A dispatcher (after each commit, plus a sweep every 10 s) claims events
atomically and enqueues them on BullMQ with `jobId = eventId`. Handlers:

- notifications — in-app + email per event (`booking.created`, `payment.succeeded`, `payment.failed`,
  `booking.confirmed`, `booking.cancelled`, `booking.expired`, `booking.reconciliation_required`,
  `refund.requested`, `refund.completed`, `refund.failed`, `checkin.reminder`, `review.reminder`,
  `review.responded`). Templates: [`infrastructure/mail/booking-templates.ts`](../apps/api/src/infrastructure/mail/booking-templates.ts);
- `refund.process` and `documents.generate` commands.

`notificationdeliveries` holds one row per (event, channel, recipient): a `SENT` row is never sent
again (retried webhooks cannot re-send a confirmation), failures are `FAILED` with the error and
attempt count (BullMQ retries 5× with back-off) and are listed for manual retry on
`/admin/operations`. Receipts (confirmation, payment, cancellation, refund) are always emailed;
reminders respect the "booking updates" email preference. Emails go to the account address.

## Documents

Invoices: one per paid booking, number `SSI-<year>-<seq>` from an atomic counter (gap-tolerant),
issuer from config (`INVOICE_ISSUER_MODE=PLATFORM`) or the partner's business details (`PROPERTY`),
rendered with pdfkit into **private** storage. If the stored file is missing it is re-rendered from
the stored record (same number). Confirmations are rendered on demand from the current booking.
Both are served only through ownership-checked endpoints (`Cache-Control: no-store`).

## Wishlists, reviews, support

- **Wishlists**: named lists with notes; the heart button uses a default "Saved stays" list. Sharing
  creates a 256-bit token (SHA-256 hash for lookup, encrypted copy for the owner); the public view
  shows the list name, owner's first name and published hotel cards — never notes or ids.
- **Reviews**: only for `CHECKED_OUT`/`COMPLETED` bookings of the reviewer, within 180 days of
  check-out, one per booking (unique index). Six category scores, overall = mean ×10 as an integer.
  Edits limited by `REVIEW_EDIT_WINDOW_DAYS`/`REVIEW_MAX_EDITS`. Reports flag a review (`FLAGGED`,
  still visible); moderators can `REMOVE`/`RESTORE`/dismiss with a reason. Owners can respond; there
  is no endpoint that lets them delete or hide reviews. Hotel rating summaries are recalculated after
  every change.
- **Support**: tickets (optionally linked to the customer's own booking), messages, private
  attachments (PDF/JPEG/PNG, content-checked), statuses `OPEN … CLOSED`. The agent console is Phase 4.

## Security checklist (each covered by automated tests)

Other customers' bookings, documents, tickets and wishlists → 404 · partners see only their hotels'
bookings → 404 · payment amounts come only from the server snapshot · cancellation charges come only
from the snapshotted policy · unknown body keys (e.g. `bookingStatus`, `totalMinor`) → 422 · forged
checkout and webhook signatures → 400 · duplicate webhooks don't duplicate effects · inventory release
happens exactly once · expired holds cannot be booked · review eligibility is derived from the
reviewer's own completed booking.
