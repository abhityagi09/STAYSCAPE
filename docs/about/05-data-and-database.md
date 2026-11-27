# 5. Data and the database

## 5.1 What a database is

A **database** is an organised, permanent store of information that many users can read and change
safely at the same time. It survives restarts, enforces rules, and finds things quickly.

There are two big families:

|               | Relational (SQL) — e.g. PostgreSQL, MySQL    | Document (NoSQL) — e.g. **MongoDB**                                                                        |
| ------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Shape         | Tables with fixed columns, like spreadsheets | **Documents**: JSON-like records that can contain lists and nested objects                                 |
| Relationships | Foreign keys and JOINs across tables         | Either embedded inside the document or referenced by id                                                    |
| Schema        | Enforced by the database                     | Flexible; STAYSCAPE enforces it in the app with Mongoose schemas (plus a database validator for inventory) |
| Language      | SQL                                          | MongoDB query language / aggregation pipelines                                                             |

In MongoDB: a **database** contains **collections** (like tables); a collection contains
**documents** (like rows); each document has a unique `_id` (an **ObjectId**, a 24-character id
that also encodes when it was created).

Example — one booking document (simplified):

```json
{
  "_id": "64b...",
  "bookingReference": "SS-7K2M9Q4X",
  "customerId": "64a...",
  "hotelId": "64c...",
  "checkInLocalDate": "2026-12-12",
  "checkOutLocalDate": "2026-12-14",
  "propertyTimezone": "Asia/Kolkata",
  "bookingStatus": "CONFIRMED",
  "paymentStatus": "SUCCESS",
  "priceSnapshot": {
    "currency": "INR",
    "totals": { "subtotalMinor": 1000000, "taxesMinor": 50000, "totalMinor": 1050000 }
  },
  "cancellationPolicySnapshot": [{ "type": "FREE_CANCELLATION", "freeCancellationHours": 48 }],
  "statusHistory": [
    { "status": "PENDING_PAYMENT", "at": "…" },
    { "status": "CONFIRMED", "at": "…" }
  ]
}
```

Notice the **snapshots**: the price and cancellation policy are _copied into the booking_ at the
moment of booking. If the hotel changes its prices tomorrow, your booking does not change. This is
an important design decision — historical records must never silently change.

## 5.2 The main collections and how they relate

```
User ── owns ──► Partner ── has ──► Hotel ── has ──► RoomType ── has ──► RatePlan
                    │                  │                 └──► DailyInventory (one per night)
                    └── PartnerStaff ──┘ (staff member + assigned hotels + permissions)
User ──► BookingHold ──► Booking ──► Payment ──► Refund
                             ├──► LedgerEntry ──► Settlement (per partner)
                             ├──► Invoice, Cancellation, BookingNote
                             └──► Review
User ──► RefreshSession, Notification, Wishlist, Trip, SupportTicket, LoyaltyAccount …
```

There are 60+ collections. Key ones:

| Collection                                         | Holds                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `users`                                            | Accounts: name, email, password hash (never sent out), roles, preferences     |
| `refreshsessions`                                  | Signed-in sessions per device (hash of the refresh token, device, IP, expiry) |
| `partners`, `partnerstaffs`                        | Businesses and their team members                                             |
| `hotels`, `roomtypes`, `rateplans`, `pricingrules` | What is for sale and how it is priced                                         |
| `dailyinventories`                                 | For each room type and each night: total, held, booked, blocked rooms         |
| `bookingholds`, `bookings`                         | Temporary reservations and real bookings                                      |
| `payments`, `paymentevents`, `refunds`             | Money in and out, and every webhook received                                  |
| `ledgerentries`, `settlements`, `commissionrules`  | Accounting                                                                    |
| `auditlogs`                                        | Who did what                                                                  |
| `outboxevents`, `notificationdeliveries`           | Messages waiting to be sent and the delivery record                           |
| `schema_migrations`                                | Which database upgrade scripts have run                                       |

## 5.3 Indexes — why queries are fast

Without an index, finding "all bookings for customer X" means reading every booking — like finding
a word in a book with no index by reading every page. An **index** is a sorted lookup structure on
chosen fields, just like the index at the back of a book.

STAYSCAPE declares indexes on the models, for example:

- `bookings`: unique on `bookingReference`; `customerId + createdAt` (your bookings, newest first);
  `bookingStatus + checkOutLocalDate` (jobs that complete stays);
- `dailyinventories`: unique on `roomTypeId + localDate`;
- `ledgerentries`: unique on `entryKey` (prevents double posting), plus `refundId`, `settlementId`,
  `paymentId` (added in the Phase 5 audit to keep the reconciliation report fast).

**Unique indexes** double as safety rules: the database itself refuses a second booking for the
same hold, a second ledger entry with the same key, or a second webhook event with the same id.

Trade-off: every index makes writes slightly slower and uses memory, so only useful ones are added.
In production, indexes are created by a release step (`sync-indexes`), not automatically.

## 5.4 Transactions and ACID

A **transaction** groups several changes so they happen **all together or not at all**. Example —
confirming a paid booking must:

1. change the booking to CONFIRMED,
2. turn the hold's rooms into booked rooms for every night,
3. record the commission snapshot,
4. write balanced ledger entries,
5. queue the confirmation email.

If step 4 failed and 1–3 had already happened, the data would be inconsistent. With a transaction,
a failure **rolls back** everything.

**ACID** describes what a reliable transaction guarantees:

| Letter          | Meaning                                                       | Plain words                         |
| --------------- | ------------------------------------------------------------- | ----------------------------------- |
| **A**tomicity   | All or nothing                                                | No half-finished bookings           |
| **C**onsistency | Rules hold before and after                                   | Inventory never goes negative       |
| **I**solation   | Concurrent transactions don't see each other's half-done work | Two bookings don't interleave badly |
| **D**urability  | Once committed, it survives crashes                           | A confirmed booking is not lost     |

MongoDB only supports multi-document transactions on a **replica set** — a group of database
servers that copy each other (one primary takes writes, secondaries keep copies, and one takes over
if the primary fails). That is why STAYSCAPE always runs MongoDB as a replica set, even locally
(a single-node replica set), and why the tests use an in-memory replica set rather than a fake.

## 5.5 Atomic updates — the key to correct inventory

Even inside transactions, the most important trick is the **conditional atomic update**. Instead of
"read the count, check it, then write a new count" (which two people can do at the same moment —
both read "1 room left", both write "booked"), the database is asked in one step:

> "Increase `heldRooms` by 1 **only if** `heldRooms + bookedRooms + blockedRooms + 1 ≤ totalRooms`."

The database performs the check and the change as one indivisible operation. If two requests race,
only one matches the condition; the other changes nothing and receives "no room". Chapter 7 explains
this in depth. On top, a **collection validator** makes the database reject any write that would
break the rule, as a last line of defence.

## 5.6 Money: integer minor units

Computers store decimal fractions in binary, which cannot represent most of them exactly:
`0.1 + 0.2` gives `0.30000000000000004`. Add thousands of prices and taxes and paise go missing.

STAYSCAPE stores **all money as whole numbers of the smallest unit** ("minor units"): paise for
rupees. ₹5,250.00 is `525000`. Percentages are **basis points** (1 % = 100 bp; 15 % commission =
1500). Rounding happens in one defined place, per room-night, "half away from zero", and refunds
are split so the parts add up exactly to the whole — no paisa created or lost. Formatting to
"₹5,250.00" happens only for display.

## 5.7 Dates and time zones

"A night" in a hotel means the hotel's local calendar date. If the server ran in London and
the hotel is in India (5½ hours ahead), "today" could be different dates. STAYSCAPE:

- stores **stay dates** as plain local dates (`"2026-12-12"`) together with the property's time
  zone (`Asia/Kolkata`);
- stores **instants** (when something happened) as UTC timestamps;
- computes deadlines (free cancellation until 48 hours before check-in) in the property's time
  zone, including daylight-saving changes for international properties.

## 5.8 Aggregation pipelines

For reports, MongoDB offers **aggregation pipelines**: a series of steps (filter → group → sum →
sort) run inside the database. The admin dashboard, analytics and the reconciliation report use
them, e.g. "group ledger entries by account and sum the amounts". Doing this in the database is
far faster than loading every document into the API.

## 5.9 Migrations — changing the database safely

As software evolves, stored data sometimes needs reshaping (adding a field to old documents).
A **migration** is a small versioned script that does this once. STAYSCAPE's runner:

- applies migrations in order, records each in `schema_migrations`, and never runs one twice;
- takes a **lock** so two deployments can't run them simultaneously;
- follows **expand → contract**: first add new fields (old code ignores them), deploy, and only in
  a later release remove old ones. This keeps **rollbacks** safe;
- never edits financial history — corrections are new entries.

## 5.10 Seed data

**Seed data** is sample data for development: 75 fictional listings, 12 destinations, 32 amenities,
8 partners. Ratings in seed data are labelled "sample data" in the UI. The seed **refuses to run in
production**, so fictional hotels can never appear on the live site.

## Say it in an interview

**"How do you prevent overbooking?"** — _"Inventory is one document per room type per local night
with total, held, booked and blocked counts. Holds use a conditional atomic update — increment
`heldRooms` only if the sum stays within `totalRooms` — inside a transaction across all nights, so
it's all nights or none. A MongoDB collection validator enforces the same invariant as a last line
of defence, and I have tests with ten concurrent customers for three rooms."_

**"Why store money as integers?"** — _"Floating point can't represent decimal fractions exactly.
Integer paise plus basis points with one explicit rounding rule gives exact, reproducible totals;
refund splits are computed so the parts sum exactly to the total."_

**"What's a snapshot and why?"** — _"At booking time I copy the price breakdown and cancellation
policy into the booking. Later rate changes can't alter what the guest agreed to pay or their
refund rights — that's both correct and legally important."_

**"Why a replica set in development?"** — _"Multi-document transactions require it, and I want
development and tests to behave exactly like production rather than mocking transactions away."_
