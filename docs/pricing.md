# Pricing

Engine: `apps/api/src/modules/pricing/pricing.engine.ts` (pure, deterministic), quotes:
`quote.service.ts`. Full rule semantics: docs/marketplace.md ("Pricing engine").

## Money

All amounts are **integer minor units** (paise for INR) end to end — database, API, ledger. Percentages
are **basis points** (1 % = 100 bp) and rounded half away from zero per room-night
(`applyBasisPoints`); refunds split with exact integer rounding (no paise created or lost). Display
formatting happens only in the browser; other currencies are display-only conversions from ECB
reference rates and never used for charging.

## Order of calculation (per room-night)

1. Base rate of the rate plan (or a date override, which replaces the base and suppresses seasonal
   adjustments).
2. Adjustment rules — weekend, seasonal, event, occupancy — in priority order; `EXCLUSIVE` rules win
   alone, `STACKABLE` rules stack.
3. Supplements — extra adults/children by age band, extra beds, meal plan.
4. Discounts — long stay, early bird, last minute, promotional (booking window) — only when the
   stay qualifies; never below zero.
5. Taxes per room-night by **slab** (e.g. Indian GST bands by the nightly rate) and fees by basis
   (per stay, per night, per room-night).
6. Coupon (platform-funded) at checkout, applied to the hold and frozen into the booking.

## Quotes and snapshots

- Quotes are **signed** (`QUOTE_SIGNING_SECRET`, valid `QUOTE_TTL_SECONDS`) and re-validated; a hold
  re-computes the price on the server and never accepts a client price.
- A booking stores a **price snapshot** (per-night breakdown, taxes, fees, coupon) and a
  **cancellation policy snapshot**; later rate or rule changes never alter existing bookings.
- Search listings may show "from" prices cached for at most 15 s
  (`PRICED_SEARCH_CACHE_TTL_SECONDS`); the property page re-quotes live and the hold re-prices
  atomically, so a cached listing can never produce a booking at a stale price.

## Tax review

The tax slab configuration is data (per property), not legal advice: GST rates, thresholds and the
invoice issuer (property vs platform as e-commerce operator) must be confirmed by a tax
professional before launch (docs/compliance-india.md).
