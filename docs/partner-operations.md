# Partner operations

Workspace: `/partner`. Onboarding and listing rules: docs/marketplace.md.

| Area            | What partners do                                                                                                                                         | Notes                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Onboarding      | business details, registration/tax information, documents (private storage), settlement account (encrypted); submit for review                           | resubmission after rejection shows the reason                                 |
| Properties      | content, location, photos and videos, amenities, policies, accessibility declarations                                                                    | approved listings change through revisions that go live only after moderation |
| Rooms and rates | room categories, bed configurations, occupancy, rate plans (meal plan, cancellation policy, min/max stay), pricing rules                                 | precedence and stacking: docs/pricing.md                                      |
| Inventory       | calendar by date, range updates (blocks, stop-sell, CTA/CTD, min/max stay), maintenance blocks                                                           | never below committed rooms (docs/inventory.md)                               |
| Reservations    | arrivals, in-house, departures, search and filters, detail with guest requests, internal notes, room assignment, check-in, check-out, no-show, rejection | each action needs the matching staff permission for that property             |
| Reviews         | public responses                                                                                                                                         | removal only by moderators for policy violations                              |
| Team            | invite staff, assign properties, fine-grained permissions, suspend/reactivate, activity                                                                  | owner only                                                                    |
| Finance         | payables from the ledger, settlements and their entries                                                                                                  | owner only; payouts are bank transfers recorded with evidence                 |
| Analytics       | occupancy, ADR, RevPAR, booking pace, cancellations, conversions by property                                                                             | definitions: docs/analytics.md                                                |
| Channel manager | connection settings and sync status                                                                                                                      | only the local simulator exists (docs/known-limitations.md)                   |
| Support         | tickets an agent shares with the property                                                                                                                | guests' contact details stay with STAYSCAPE                                   |

Staff permissions: `property:edit`, `rooms:manage`, `inventory:view`, `inventory:manage`,
`pricing:manage`, `bookings:view`, `bookings:check-in`, `bookings:check-out`, `bookings:no-show`,
`bookings:notes`, `reviews:respond`, `analytics:view`, `financials:view`. A staff member only ever
sees the properties assigned to them, and each action checks the permission for that property.
