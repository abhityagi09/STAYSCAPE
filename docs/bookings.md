# Bookings

State machines, holds and documents: docs/reservations.md. Inventory: docs/inventory.md.

## Booking states

```
PENDING_PAYMENT ──order created──► PAYMENT_PROCESSING ──verified──► CONFIRMED ──check-in──► CHECKED_IN
      │                                    │                           │                        │
      │ hold expires / guest cancels       │ payment failed (retry ok) │ cancel / no-show       check-out
      ▼                                    ▼                           ▼                        ▼
   EXPIRED / CANCELLED                PENDING_PAYMENT              CANCELLED               CHECKED_OUT ──job──► COMPLETED
                                                                                                         (review allowed)
Verified payment that cannot be allocated safely (rooms gone) ──► RECONCILIATION_REQUIRED (auto full refund)
```

## Guarantees

| Guarantee                                 | Mechanism                                                                                                        | Test                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| No overbooking, no negative inventory     | atomic conditional updates + transaction + DB validator                                                          | bookings, inventory, resilience suites        |
| One booking per hold, idempotent creation | unique hold reference; `Idempotency-Key` with request hash                                                       | "creates one booking per hold … idempotently" |
| No duplicate confirmation                 | conditional state transition `PENDING/PROCESSING → CONFIRMED` inside the payment transaction                     | verify/webhook race test                      |
| Browser cannot confirm a payment          | confirmation requires the provider signature **and** a provider fetch, or a verified webhook                     | "a forged signature never confirms anything"  |
| Late payments are never lost              | payment after expiry: re-allocated if rooms are still free, otherwise recorded as unallocated and fully refunded | "re-allocates …", "never double-allocates …"  |
| Cancellation during payment               | releases the hold; a capture arriving later is tracked and refunded                                              | resilience suite                              |
| Network interruptions                     | the scheduled reconciliation (every 2 min) asks the provider about pending payments and completes or fails them  | "reconciles a payment whose browser closed"   |
| Booking time zone                         | check-in deadlines and no-show times computed in the property's time zone                                        | cancellation-policy tests                     |

## Recovery jobs

| Job                          | Interval | Purpose                                                                    |
| ---------------------------- | -------- | -------------------------------------------------------------------------- |
| `bookings.expire-holds`      | 30 s     | release expired holds, expire unpaid bookings                              |
| `payments.reconcile`         | 2 min    | resolve payments/refunds whose browser or webhook never arrived            |
| `outbox.dispatch`            | 10 s     | deliver domain events (emails, invoices, refunds) with retries             |
| `bookings.complete-stays`    | 1 h      | complete checked-out/elapsed stays (unlocks reviews, rewards, settlements) |
| `bookings.checkin-reminders` | 1 h      | reminders (respecting preferences)                                         |
| `finance.backfill`           | 1 h      | post ledger entries for any confirmed booking missing them                 |

All are idempotent; each item is processed in its own try/catch so one bad record cannot stall a
run. Stale states are visible in metrics (`stayscape_holds_overdue`,
`stayscape_bookings_payment_processing_stale`) and alerts.
