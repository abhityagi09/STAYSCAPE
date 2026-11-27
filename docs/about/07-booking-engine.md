# 7. The booking engine — inventory, holds, concurrency and pricing

This is the heart of STAYSCAPE and the best interview material, because it combines business
rules with hard computer-science problems.

## 7.1 Inventory: counting rooms per night

A hotel doesn't sell "a room"; it sells **room-nights**. A two-night stay from 12 to 14 December
uses the nights of 12 and 13 (the check-out date is not a night).

For every room type and every local night, STAYSCAPE keeps one record:

| Field          | Meaning                                                      |
| -------------- | ------------------------------------------------------------ |
| `totalRooms`   | How many rooms of this type exist (e.g. 5 Deluxe rooms)      |
| `heldRooms`    | Temporarily reserved by people currently paying              |
| `bookedRooms`  | Sold to confirmed bookings                                   |
| `blockedRooms` | Taken out of sale (maintenance, owner's use)                 |
| restrictions   | stop-sell, closed to arrival/departure, minimum/maximum stay |

**Available = total − held − booked − blocked.** The **invariant** (a rule that must always be true)
is that this never goes below zero.

## 7.2 The race condition problem

A **race condition** happens when the result depends on the timing of things that run at the same
time. Classic example — one room left, two travellers click "Book" in the same millisecond:

```
Traveller A: read available = 1        Traveller B: read available = 1
Traveller A: 1 > 0, so book            Traveller B: 1 > 0, so book
Traveller A: write available = 0       Traveller B: write available = 0
Result: TWO bookings for ONE room  → overbooking
```

The bug is that _reading, deciding and writing_ are separate steps and someone else can slip in
between them. The solution is to make the check and the change **one indivisible (atomic)
operation** in the database:

```
updateOne(
  { roomTypeId, localDate, $expr: { heldRooms + bookedRooms + blockedRooms + 1 <= totalRooms } },
  { $inc: { heldRooms: 1 } }
)
```

MongoDB evaluates the condition and applies the increment as a single operation on that document.
If A and B race, the first one changes the document; the second's condition is now false, nothing
changes, and B is told "sold out" (HTTP 409). No locks held across network calls, no waiting.

**Multi-night stays** need _every_ night or none. If night 1 succeeds but night 2 is full, night 1
must be undone. So all nights are updated inside one **transaction**; any failure rolls all back.

**Defence in depth:** a MongoDB **collection validator** rejects any write that would break the
invariant, even if a bug slipped past the application. The metric
`stayscape_inventory_invariant_violations` must always be 0 and raises an alert if not.

Verified by tests: two customers for the last room (exactly one wins), ten customers for three rooms
(exactly three win), six overlapping multi-night requests for one room (winners never overlap), and
load tests that created and cancelled hundreds of holds with zero violations.

## 7.3 Holds — reserving while you pay

Paying takes time (entering card details, a bank's OTP). If rooms were only reserved _after_
payment, someone else could take them while you pay. If they were sold _before_ payment, unpaid
attempts would block inventory forever. The **hold** is the compromise:

- Selecting a room creates a hold: rooms move into `heldRooms` for **10 minutes**.
- Paying converts held rooms into booked rooms.
- If you don't pay in time, a background job **expires** the hold and releases the rooms.
- A person can have at most **3 active holds** (anti-hoarding).

**Expiry must be safe when run twice.** The expiry job runs every 30 seconds and possibly on several
worker machines. Each hold is moved from ACTIVE to EXPIRED with a _conditional_ update ("only if
still ACTIVE"), so only one run can release it; the others find nothing to do. Tested with three
expiry runs racing over the same holds: each night released exactly once.

## 7.4 Idempotency — making retries safe

Networks fail. Your phone loses signal right after tapping "Pay"; did the request arrive? The app
retries. Without protection, a retry could create a second hold or a second booking.

An operation is **idempotent** if doing it twice has the same effect as doing it once. STAYSCAPE
makes creating holds, bookings, payment orders and refunds idempotent with an **Idempotency-Key**
header: a random id the client generates once per action.

- First request with key K: performed, result stored with K and a fingerprint (hash) of the body.
- Repeat with K and the same body: the **original result is returned**, nothing new happens.
- Repeat with K but a different body: rejected (`IDEMPOTENCY_KEY_REUSED`) — it is a bug or abuse.

Unique database indexes provide a second guarantee: one booking per hold, one refund per idempotency
key, one ledger entry per entry key.

## 7.5 State machines — the life of a booking

A **state machine** lists the allowed states and the allowed moves between them. Anything else is
refused, which prevents impossible situations (refunding a booking twice, checking out someone who
never checked in).

```
PENDING_PAYMENT ──pay──► PAYMENT_PROCESSING ──verified──► CONFIRMED ──► CHECKED_IN ──► CHECKED_OUT ──► COMPLETED
     │                          │                              │
     │ hold expires/cancel      │ failed (can retry)          │ cancel / no-show / rejected
     ▼                          ▼                              ▼
  EXPIRED / CANCELLED      PENDING_PAYMENT                  CANCELLED
Verified payment but rooms no longer available ──► RECONCILIATION_REQUIRED (automatic full refund)
```

Every transition is a conditional update ("change to CONFIRMED only if currently PENDING_PAYMENT or
PAYMENT_PROCESSING"), so even if the browser's verification and the payment webhook arrive at the
same instant, the booking is confirmed **exactly once** — one confirmation email, one set of ledger
entries (tested).

Holds, payments, refunds and settlements have their own state machines.

## 7.6 Tricky real-world cases (and how they are handled)

| Situation                                                                 | What happens                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Payment succeeds **after** the hold expired, and the rooms are still free | Rooms are re-allocated and the booking confirmed                                                                                          |
| Payment succeeds after expiry and the rooms were **sold to someone else** | Booking goes to RECONCILIATION_REQUIRED; the money is recorded as unallocated and **fully refunded automatically**; operators are alerted |
| Guest cancels while the payment page is open, then pays anyway            | The hold is released on cancel; the later capture is tracked and refunded — money is never lost or double-allocated                       |
| Browser closes after paying, webhook never arrives                        | Every 2 minutes a reconciliation job asks the provider about pending payments and completes them                                          |
| Payment gateway is down when creating the order                           | Clear "try again" error (502), nothing marked paid, the hold still stands                                                                 |
| Owner tries to block rooms that a hold depends on                         | Refused; they can only block genuinely free rooms                                                                                         |
| External channel manager sends a booking that would oversell              | Recorded and flagged, not applied                                                                                                         |

## 7.7 The pricing engine

Pricing is a **pure function**: given the rate, rules, guests and dates, it always returns the same
price, with no side effects. That makes it easy to test (dozens of unit tests) and deterministic
regardless of rule order.

For **each room-night**, the calculation runs in a fixed order:

1. **Base rate** of the rate plan — or a **date override** that replaces it.
2. **Adjustment rules** (weekend, seasonal, event, occupancy-based) in priority order. A rule is
   either _stackable_ (combines with others) or _exclusive_ (wins alone).
3. **Supplements** — extra adults, children by age band, extra beds, meal plan.
4. **Discounts** — long stay, early bird, last minute, promotional — only when the stay qualifies;
   never below zero.
5. **Taxes** per room-night by **slab** (GST in India depends on the nightly rate band) and **fees**
   per stay, per night or per room-night.
6. **Coupon** (platform-funded) applied at checkout.

### Quotes

The result is a **quote**, signed with a server secret (HMAC) and valid for a few minutes. When you
create a hold, the price is **recomputed on the server** from current data — a client can never
send its own price. The quote's signature lets the server detect tampering, and _revalidation_ tells
the user if a price changed since they looked.

### Snapshots

The final price breakdown and cancellation policy are copied into the booking (chapter 5), so later
rate changes never affect it.

### Caching and correctness

Search listings may show "from" prices cached for up to 15 seconds for speed. This is safe because
the property page re-quotes live and the hold re-prices atomically — a cached listing can never
produce a booking at a wrong price.

## 7.8 Cancellations and the policy engine

Each rate plan has a policy: **free cancellation** until N hours before check-in, then a percentage
or fixed charge; **partially refundable**; or **non-refundable**. Deadlines are computed in the
property's time zone. No-shows have their own rule. When you cancel, the engine computes the refund
from the **policy snapshot**, the inventory is released (only future nights for no-shows), and a
refund is started (chapter 8). Online cancellation closes at check-in time.

## Say it in an interview

**"Walk me through booking a room."** — _"The client gets a signed quote, then POSTs a hold with an
idempotency key. The server re-prices, then in one transaction increments `heldRooms` for every
night with a conditional atomic update, so it's all nights or none and can't oversell. The hold
lasts ten minutes. Creating the booking snapshots the price and policy. Payment confirmation —
verified with the provider — transitions the booking with a conditional update, moves held rooms to
booked, posts ledger entries and queues the email through the outbox, all in one transaction. A
30-second job expires abandoned holds idempotently."_

**"What's idempotency and where do you use it?"** — _"Doing an operation twice has the same effect
as once. Clients send an Idempotency-Key on holds, bookings, payment orders and refunds; I store the
result with a hash of the request body and replay it on retries, and reject a reused key with a
different body. Unique indexes back it up."_

**"How would this scale to many hotels?"** — _"Inventory is per room type per night, so contention
is only on the same room type and night — naturally partitioned. Atomic updates avoid long locks.
API servers are stateless and scale horizontally; the hot paths are indexed."_
