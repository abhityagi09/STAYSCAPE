# Analytics — metric definitions

All figures come from MongoDB aggregation pipelines over Stayscape's own records
(`apps/api/src/modules/analytics/analytics.service.ts`). Nothing is sampled or estimated.

## Conventions

- **Money:** integer minor units (paise for INR). Values are only ever summed within one currency.
  Partner metrics take a `currency` filter that defaults to INR.
- **Ratios:** basis points (10 000 = 100 %).
- **Period:** `from` (inclusive) to `to` (exclusive), as calendar dates. Defaults to the last 30 days.
  The maximum is 366 days.
  - Booking _events_ (confirmation, cancellation) use the UTC instants of those dates.
  - Stay _nights_ use each booking's property-local `nightly[].date`.
- **Scope:**
  - Partner metrics cover only properties where the caller holds `analytics:view`: every property for
    an owner, assigned properties for staff.
  - Asking for any other property returns 404.
  - Admin metrics need `reports:view` (dashboard) or `analytics:platform` (analytics and export).

## Property metrics (`GET /partner/analytics`)

| Metric                    | Definition                                                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total reservations        | Bookings confirmed (payment captured) in the period, including any cancelled later                                                                                                                                                                                   |
| Upcoming arrivals         | Confirmed bookings checking in within the next 7 days                                                                                                                                                                                                                |
| Current guests / in-house | Guests and bookings currently in `CHECKED_IN`                                                                                                                                                                                                                        |
| Completed stays           | Bookings checked out or completed with check-out inside the period                                                                                                                                                                                                   |
| Cancelled bookings        | Paid bookings cancelled or rejected during the period                                                                                                                                                                                                                |
| Gross booking value (GBV) | What guests owed for reservations confirmed in the period: total including taxes and fees, _before_ platform-funded coupons. GBV is not the partner's payout                                                                                                         |
| Recognised room revenue   | Sum of nightly room charges (after rate-plan discounts, excluding taxes and fees) for nights inside the period, from stays that were not cancelled or rejected                                                                                                       |
| Room nights sold          | Rooms × nights inside the period for those stays                                                                                                                                                                                                                     |
| Available room nights     | For each active room category and date: `totalRooms − blockedRooms` from the inventory row (blocked includes maintenance blocks), or the category's room count where no row exists yet. Stop-sell dates still count as available (closed for sale, not out of order) |
| Occupancy                 | Room nights sold ÷ available room nights                                                                                                                                                                                                                             |
| ADR                       | Recognised room revenue ÷ room nights sold                                                                                                                                                                                                                           |
| RevPAR                    | Recognised room revenue ÷ available room nights                                                                                                                                                                                                                      |
| Average booking value     | GBV ÷ total reservations                                                                                                                                                                                                                                             |
| Cancellation rate         | Share of the period's reservations that were later cancelled or rejected                                                                                                                                                                                             |
| Guest review score        | Mean overall score of published and flagged reviews written in the period (removed reviews are excluded)                                                                                                                                                             |
| Booking conversion        | Reservations ÷ property detail-page views in the period                                                                                                                                                                                                              |

Views are an anonymous daily counter per property (`hoteldailystats`) keyed by property-local
date. They carry no user or device data.

The response also contains:

- the nightly revenue and occupancy trend;
- bookings and cancellations by confirmation date;
- performance per room category;
- the monthly review trend;
- the previous period's reservations and GBV, for comparison.

**CSV export:** `?format=csv` returns one row per date. Cells starting with `= + - @` (other than
plain numbers) are prefixed with `'` to prevent spreadsheet formula injection.

## Platform metrics

`GET /admin/dashboard` covers bookings, confirmed, cancelled, GBV and platform commission, where
platform commission is the sum of `PLATFORM_REVENUE` ledger entries net of refund reversals. It also
covers:

- promotion expense (coupons);
- refund volume (provider-confirmed refunds only);
- support ticket count;
- average review rating;
- active customers and new sign-ups;
- approved partners and partners awaiting review;
- published properties;
- pending settlements.

Each period metric includes `previous` and `changeBp` against the immediately preceding period of
equal length. `changeBp` is `null` when the previous value is 0.

`GET /admin/analytics` returns:

- daily booking volume and GBV;
- commission and refunds;
- customer and partner growth;
- property distribution by city and by type;
- coupon performance;
- support performance: average first-response time (first agent reply on the customer thread) and
  average resolution time.

Export with `?format=csv`.
