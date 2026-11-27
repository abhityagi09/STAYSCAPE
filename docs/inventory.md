# Inventory

Design detail: docs/marketplace.md ("Inventory") and docs/reservations.md ("Inventory hold engine").

## Model

One `DailyInventory` document per room category per **property-local night** (`YYYY-MM-DD`,
never interpreted in the server's time zone):

| Field                                                                            | Meaning                                         |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| `totalRooms`                                                                     | sellable rooms of this category                 |
| `heldRooms`                                                                      | rooms held by active checkout holds             |
| `bookedRooms`                                                                    | rooms of confirmed (and in-house) bookings      |
| `blockedRooms`                                                                   | out of sale: manual blocks + `maintenanceRooms` |
| `stopSell`, `closedToArrival`, `closedToDeparture`, `minimumStay`, `maximumStay` | restrictions                                    |

**Invariant:** `heldRooms + bookedRooms + blockedRooms ≤ totalRooms`, never negative. It is
enforced three ways: every change is a single conditional update (`$inc` guarded by
`$expr`), multi-night changes run in one transaction (all nights or none), and a MongoDB
collection validator rejects any write that would break it. `stayscape_inventory_invariant_violations`
must always be 0 (alert: InventoryInvariantViolated).

## Lifecycle of a room-night

```
available ──hold──► held ──payment verified──► booked ──check-out/complete──► (history)
    ▲                 │                          │
    └──expire/release─┘                          └──cancel/no-show (future nights)──► available
```

- **Hold** (`POST /bookings/holds`, `Idempotency-Key` required): server-priced; up to 3 active
  holds per person; expires after `BOOKING_HOLD_TTL_MINUTES` (10).
- **Expiry**: the `bookings.expire-holds` job runs every 30 s; it is idempotent and safe to run on
  several workers at once (each hold transitions exactly once).
- **Partner changes**: blocks, maintenance and total reductions are refused for any night where
  they would drop below committed rooms; stop-sell closes a date to _new_ holds without touching
  existing reservations.
- **Channel managers**: signed, idempotent external reservations go through the same engine; an
  external booking that would oversell is recorded and flagged rather than applied.

## Verified behaviour

Concurrency tests (`bookings.test.ts`, `inventory.test.ts`, `reservation-resilience.test.ts`)
against a transaction-capable replica set: two customers for the last room (exactly one wins),
ten customers for three rooms (exactly three), overlapping multi-night stays on one room (winners
never overlap; each holds all its nights), racing expiry workers (each night released once),
blocking below active holds (refused), and load tests that created and cancelled hundreds of
holds and bookings with 0 invariant violations afterwards.
