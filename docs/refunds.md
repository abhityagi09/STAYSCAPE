# Refunds

Implementation: `apps/api/src/modules/payments/refunds.service.ts`, policy engine
`apps/api/src/modules/bookings/cancellation-policy.ts`. Detail: docs/reservations.md.

## Where refunds come from

| Source                                                | Amount                                                                                                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest cancellation                                    | the booking's **policy snapshot**: free before the property-local deadline, then the after-deadline percentage, fixed charge or non-refundable |
| Property rejection / no-show                          | full, or per the no-show rule; remaining nights released                                                                                       |
| Late or duplicate payment that could not be allocated | full, automatically                                                                                                                            |
| Customer request outside policy                       | an administrator approves an amount (≤ refundable) or rejects with a reason                                                                    |
| Goodwill / correction                                 | administrator, idempotent per key, never above the captured amount                                                                             |

## States

`REQUESTED → APPROVED → PROCESSING → SUCCEEDED`, or `FAILED` (retryable by an administrator) or
`REJECTED`. **A refund is shown as succeeded only after the provider confirms it** — by the
refund API response or the `refund.processed` webhook; a provider timeout leaves it `PROCESSING`
and the reconciliation job asks the provider again, so a lost response never refunds twice.

## Accounting

On success the ledger posts the cash outflow and splits it between the partner payable and the
platform's commission (and coupon funding) in proportion, with exact integer rounding; refunds of
unallocated payments only move unallocated funds. Commission reversals follow the original
snapshot, never today's rules.

## Tested scenarios

Full refund before the deadline (duplicate requests ignored); partial refund after the deadline;
non-refundable and fixed-charge policies; unpaid booking cancellation (hold released, nothing to
refund); refund failure → escalation → admin retry; lost provider response recovered without a
second refund; webhook-confirmed pending refund; idempotent partial admin refunds capped at the
captured amount; customer request routed through an admin decision.
