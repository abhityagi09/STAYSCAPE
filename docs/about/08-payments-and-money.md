# 8. Payments and money — gateways, webhooks, refunds, the ledger and reconciliation

## 8.1 How online payment works

A website does not move money itself. A **payment gateway** (Razorpay in India; Stripe elsewhere)
talks to banks and card networks. STAYSCAPE's job is to ask the gateway to collect an amount and
then **find out reliably whether it worked**.

```
Browser                  STAYSCAPE API                  Razorpay
   │  "Pay for SS-…"          │                             │
   │ ───────────────────────► │  create order (₹10,500) ──► │
   │ ◄─────── order id ────── │ ◄────── order_abc ───────── │
   │  open Razorpay Checkout (card/UPI page served by Razorpay — card data never touches STAYSCAPE)
   │ ─────────────────────────────────────────────────────► │
   │ ◄──── payment id + signature ───────────────────────── │
   │  "verify these" ────────►│  check signature + FETCH   │
   │                          │  payment from Razorpay ───► │
   │                          │ ◄──── status: captured ──── │
   │ ◄──── booking CONFIRMED ─│                             │
   │                          │ ◄──── webhook: payment.captured (server to server, signed)
```

Key ideas:

- **Order:** the gateway's record of "collect exactly this amount for this booking". Created by the
  server from the server-computed total.
- **Card data never touches STAYSCAPE.** Razorpay's checkout collects it, which keeps STAYSCAPE out
  of most of the heavy **PCI-DSS** card-security obligations.
- **The browser callback is not proof.** A hacked browser can claim anything. The server checks the
  signature **and fetches the payment from the gateway** to confirm amount, currency and status.
- **Authorised vs captured:** some gateways first _authorise_ (reserve money on the card) and later
  _capture_ (actually take it). STAYSCAPE captures when needed and handles a capture timeout safely.

## 8.2 Webhooks — the source of truth

A **webhook** is the gateway calling _your_ server to say "this happened" (payment captured,
payment failed, refund processed). It is the most reliable signal because it doesn't depend on the
customer's browser staying open. Webhooks have well-known pitfalls:

| Pitfall                                                                  | Defence                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Forgery** — anyone could POST a fake "payment captured"                | HMAC-SHA256 signature over the exact raw body with a shared secret, compared in constant time; invalid → 400 |
| **Duplicates** — gateways retry, so the same event arrives several times | Each event id stored with a unique index; repeats are acknowledged and ignored                               |
| **Out of order** — "failed" may arrive after "captured"                  | Events are applied through the state machine; a late "failed" cannot undo a confirmed payment                |
| **Missing** — the webhook never arrives                                  | The reconciliation job asks the gateway directly every 2 minutes                                             |
| **Stale data in the body**                                               | Amounts and states are re-fetched from the gateway before acting                                             |

**Defence in layers:** browser verification, webhook, and scheduled reconciliation all lead to the
_same_ conditional state transition, so whichever comes first wins and the others become no-ops.

## 8.3 The sandbox gateway

Real gateways need a business account and KYC. To develop and test honestly, STAYSCAPE has its own
**sandbox provider** that reproduces Razorpay's protocol — orders, signed checkout results, signed
webhooks, refunds — and can simulate outages, capture timeouts and failed refunds. The UI clearly
labels it "Test payment sandbox — no real money moves", and the server refuses to use it in
production. Swapping to Razorpay is a configuration change because both implement the same
`PaymentProvider` interface (an example of the **adapter pattern**).

## 8.4 Refunds

Refunds come from: guest cancellation (per policy), property rejection or no-show, payments that
couldn't be allocated, approved requests outside policy, and administrator goodwill.

Refund **states**: REQUESTED → APPROVED → PROCESSING → SUCCEEDED, or FAILED (retryable) or
REJECTED. The golden rule: **a refund is shown as succeeded only when the gateway confirms it**.
If the gateway's response is lost (timeout), the refund stays PROCESSING and the reconciliation job
asks the gateway later — using the refund's unique receipt id — so it is never refunded twice.
Refunds can never exceed what was captured, and partial refunds are idempotent.

## 8.5 The ledger — double-entry accounting in software

A marketplace holds other people's money for a while: the guest pays STAYSCAPE, STAYSCAPE keeps its
commission and owes the rest to the hotel. To track this correctly, STAYSCAPE keeps an
**append-only ledger** — a journal of money movements, inspired by double-entry bookkeeping:

| Account             | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `CASH`              | Money STAYSCAPE holds for bookings (+ captured, − refunded, − paid out)    |
| `PARTNER_PAYABLE`   | Money owed to hotels                                                       |
| `PLATFORM_REVENUE`  | STAYSCAPE's commission                                                     |
| `PROMOTION_EXPENSE` | Discounts funded by STAYSCAPE coupons (negative)                           |
| `UNALLOCATED`       | Captured money not tied to a stay (late/duplicate payment awaiting refund) |

**The balance rule:** for every transaction, `CASH = PARTNER_PAYABLE + PLATFORM_REVENUE +
PROMOTION_EXPENSE + UNALLOCATED`.

Worked example — a ₹10,000 booking, 15 % commission, no coupon:

| Entry            | Account          | Amount (paise) |
| ---------------- | ---------------- | -------------- |
| Payment captured | CASH             | +1,000,000     |
| Payable to hotel | PARTNER_PAYABLE  | +850,000       |
| Commission       | PLATFORM_REVENUE | +150,000       |

Cash (1,000,000) = 850,000 + 150,000 ✓. If the guest later gets a 50 % refund, new entries post
−500,000 cash, −425,000 payable and −75,000 revenue (commission reversed in proportion) — and it
still balances.

**Append-only** means entries are never edited or deleted. A mistake is fixed with a new correcting
entry. That gives a complete, auditable history — exactly how real accounting works. Each entry has
a unique `entryKey` (e.g. `booking.<id>.commission`) so it can never be posted twice.

## 8.6 Commissions

The commission is decided by rules with precedence **property rule > partner rule > global rule**,
each with a rate (basis points) and optional fixed amount, an effective date range and options
(include fees? promotional? exempt?). Taxes are never commissioned. When payment confirms the
booking, the commission is **snapshotted** — later rule changes never rewrite it.

## 8.7 Settlements — paying the hotels

After a stay completes and a hold period passes (1 day by default), its payable becomes **eligible**.
An administrator creates a **settlement batch** for a partner from eligible entries. Automated payouts
are deliberately **disabled** until a payout provider is onboarded: finance pays by bank transfer and
must record the transfer reference **and upload proof** — a settlement can never be marked paid without
evidence. If a transfer fails, the entries are released to be settled again.

## 8.8 Reconciliation — proving the money adds up

**Reconciliation** means comparing independent records to make sure they agree. STAYSCAPE's report
compares four sources — booking price snapshots, payment records, refund records and the ledger — and
optionally the **gateway itself**. It flags:

| Check                                                | Meaning                               |
| ---------------------------------------------------- | ------------------------------------- |
| Paid booking without ledger entries                  | Commission/payable never accrued      |
| Ledger cash ≠ captured payment                       | Accounting mismatch                   |
| Captured ≠ booking total                             | Charged the wrong amount              |
| Refund not in the ledger                             | Money left without being recorded     |
| Payment's refunded total ≠ sum of its refunds        | Inconsistent refund tracking          |
| Refunded more than captured                          | Over-refund                           |
| Unbalanced ledger transaction                        | Broken double-entry                   |
| Unallocated funds still open                         | Late payment not yet returned         |
| Settlement paid without its ledger payout            | Payout not recorded                   |
| Provider: payment missing / status / amount mismatch | Our records disagree with the gateway |

The report **never changes data** — it reports, and people fix with auditable entries. After all the
load tests on staging it showed 0 exceptions. It can export the exceptions as CSV.

## 8.9 Coupons

Platform-funded discounts with usage limits (total and per customer), minimum spend, dates and
first-booking-only options. Limits are enforced **atomically** under concurrent checkouts (tested),
and a coupon use is released if the hold expires. The partner's payable is not reduced by a platform
coupon — STAYSCAPE pays for it (recorded as promotion expense).

## Say it in an interview

**"How do you know a payment really succeeded?"** — _"Never from the browser alone. I verify the
checkout signature and fetch the payment from the provider; the signed webhook is the authoritative
signal; and a reconciliation job asks the provider about anything still pending. All three funnel
into the same idempotent conditional state transition, so the booking is confirmed exactly once."_

**"Explain your ledger."** — _"Append-only double-entry style entries in integer paise across cash,
partner payable, platform revenue, promotion expense and unallocated, where each transaction
balances. Refunds post proportional reversals; nothing is ever edited — corrections are new entries.
A reconciliation report cross-checks bookings, payments, refunds, the ledger and the provider."_

**"What happens if a refund request times out?"** — _"The refund stays PROCESSING. The
reconciliation job looks it up at the provider by its unique receipt, so we never send a second
refund, and we only mark it succeeded when the provider confirms."_
