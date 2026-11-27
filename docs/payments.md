# Payments

Implementation: `apps/api/src/modules/payments/`. Detail: docs/reservations.md ("Payments").

## Providers

| `PAYMENT_PROVIDER` | Use                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox`          | Labelled local/staging gateway with the same order → checkout → signature → webhook flow as Razorpay; the UI shows "Test payment sandbox — no real money moves". Refused in production. |
| `razorpay`         | Razorpay Orders + Checkout. Card data never touches STAYSCAPE (PCI scope stays with Razorpay). Test keys in development/staging, live keys in production.                               |

## Flow and verification

1. `POST /bookings/:ref/payments` (idempotent) creates a provider order for the booking's
   server-computed total.
2. The guest pays in Razorpay Checkout.
3. `POST /bookings/:ref/payments/verify`: the browser's signature is checked **and** the payment
   is fetched from the provider; amount and currency must match the order. The browser callback
   alone can never mark a payment successful.
4. The `payment.captured` / `payment.failed` webhook (HMAC over the raw body, timing-safe, event-id
   deduplicated, processed in any order) is the authoritative confirmation.
5. Confirmation happens in one transaction: booking `CONFIRMED`, hold consumed, rooms booked,
   commission snapshot, balanced ledger entries, outbox events (confirmation email, invoice).

Every 2 minutes `payments.reconcile` asks the provider about payments still pending (closed
browser, lost webhook, capture timeout) and completes or fails them exactly once.

## Tested scenarios

Success; failed card then successful retry while the hold lasts; cancelled checkout (hold
expires, nothing charged); duplicate and out-of-order webhooks; invalid signature (400); gateway
outage on order creation (502, retryable, nothing marked paid); capture timeout (booking stays
unconfirmed until reconciliation captures it, confirmed once); verify and webhook arriving
simultaneously (one confirmation, one ledger entry, one email); payment after hold expiry
(re-allocated or refunded); reconciliation of a closed browser.

## Reconciliation report

`GET /api/v1/admin/finance/reconciliation?from&to` (`payments:read`; `&format=csv` exports the
exceptions). Read-only comparison of four sources: booking price snapshots, provider payment
records, refund records and the append-only ledger, plus partner payable balances. Checks:

| Check                                | Meaning                                                |
| ------------------------------------ | ------------------------------------------------------ |
| `PAID_BOOKING_WITHOUT_LEDGER`        | paid booking without commission/payable accrual        |
| `LEDGER_CASH_DIFFERS_FROM_PAYMENT`   | ledger cash ≠ captured amount                          |
| `PAYMENT_DIFFERS_FROM_BOOKING_TOTAL` | captured ≠ booking total                               |
| `REFUND_WITHOUT_LEDGER`              | provider-confirmed refund not reflected in ledger cash |
| `PAYMENT_REFUNDED_TOTAL_MISMATCH`    | payment's refunded total ≠ sum of succeeded refunds    |
| `REFUND_EXCEEDS_CAPTURE`             | more refunded than captured                            |
| `UNBALANCED_LEDGER_TRANSACTION`      | a transaction's cash ≠ sum of the other accounts       |
| `UNALLOCATED_FUNDS_OPEN`             | captured money not tied to a stay and not yet refunded |
| `SETTLEMENT_PAID_WITHOUT_LEDGER`     | settlement marked paid without its payout entry        |

The report never changes data. Corrections are posted as new, auditable ledger entries; historical
records are never edited. Last staging run after load testing: **0 exceptions**; ledger cash =
captured − refunded; cash = partner payable + platform revenue.
