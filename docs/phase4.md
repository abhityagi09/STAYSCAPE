# Phase 4 design — operations, administration and intelligent features

This document records what was built in Phase 4 and why each design choice was made. Metric
definitions are in [analytics.md](analytics.md) and the TrustScore formula in
[trustscore.md](trustscore.md). Endpoints are listed in [api.md](api.md) and collections in
[database.md](database.md).

## Principles applied throughout

- Every protected operation checks a permission **and** the specific resource: the property, the
  ticket, the organisation or the trip.
  - Resources outside the caller's reach return **404**, so their existence is not revealed.
- Money is held in integer minor units. Writes to money, inventory, points and quotas are
  conditional or transactional, and replays are idempotent through unique keys.
- State changes are audited with before and after values. A request-scoped `AsyncLocalStorage`
  carries `partnerId` and `hotelId`, so partner activity logs need no per-call plumbing.
- Integrations that cannot be verified are labelled as such. Nothing pretends to be verified.

## Partner operations

| Area                   | Design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff permissions      | Fine-grained property permissions such as `bookings:view`, `bookings:check-in`, `inventory:manage`, `analytics:view` and `financials:view`, assigned per property. Phase 3's coarse codes are mapped onto them for compatibility. Suspended staff are denied on their next request. Every staff action appears in the owner's activity log                                                                                                                                                                                |
| Reservation operations | Search, filters and views (arrivals, departures, in-house, upcoming, past). Append-only internal notes. Room assignments must match the booked room counts. Check-in, check-out and no-show each need their own permission and record who acted. Unpaid or expired holds are never visible                                                                                                                                                                                                                                |
| Analytics              | See [analytics.md](analytics.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Inventory              | Maintenance/renovation/owner-use blocks are records with a reason, applied to every night or none through a `maintenanceRooms` counter that is folded into `blockedRooms`. The availability expression and the database validator are therefore unchanged. Manual block edits use a pipeline update so they never overwrite maintenance blocks. Releasing a block returns only future nights, so past occupancy stays accurate. **Stop-sell** closes dates to new holds and bookings; existing reservations are untouched |
| Pricing                | New rule types: `OCCUPANCY` (an adjustment applied when committed ÷ sellable rooms is inside a range) and `PROMOTIONAL` (a discount bookable only inside a booking window). Booking price snapshots never change after rate, rule or stop-sell edits; a test covers this                                                                                                                                                                                                                                                  |
| Channel manager        | See the channel-manager section below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Finance

- **Commission rules** (global, partner, property, promotional) have effective dates and exemptions.
  - Precedence: property, then partner, then global. Ties go to promotional, then the latest
    effective date.
  - The base is the room subtotal, optionally plus fees, and never taxes.
  - The rule and its result are **snapshotted when payment is confirmed**.
- **Ledger:** append-only. Database hooks reject updates and deletes, and a unique `entryKey`
  makes each posting idempotent. Postings use insert-only upserts so a duplicate never aborts the
  surrounding transaction.
  - On confirmation: CASH +paid, PARTNER_PAYABLE +(gross − commission), PLATFORM_REVENUE
    +commission, PROMOTION_EXPENSE −coupon.
  - Refunds post proportional reversals.
  - Payments that could not be matched to a stay go to `UNALLOCATED`.
- **Settlements** are built from eligible entries: the stay has ended plus `SETTLEMENT_HOLD_DAYS`,
  and refund adjustments are always eligible.
  - Statuses: PENDING, ELIGIBLE, PROCESSING, PAID, FAILED and ON_HOLD.
  - **Payouts are disabled** (`PAYOUT_PROVIDER=disabled`): initiating a payout always returns 409.
  - A settlement is marked PAID only with a transfer reference **and** an uploaded evidence
    document, stored privately.
  - A failed settlement releases its entries.
- **Coupons** are platform-funded, so the partner's payable is unaffected.
  - Total and per-user limits are reserved atomically inside the hold transaction (conditional
    `$inc`, unique usage rows).
  - Uses are released when a hold expires and redeemed on payment.
  - Personal single-use coupons are issued for loyalty and referrals.

## Administration

- **Dashboards:** a platform dashboard with previous-period comparison, plus reports and analytics
  with CSV export.
- **Records:**
  - customers (search, detail, suspend);
  - bookings, with **escalations** (one open per booking, enforced by a partial unique index);
  - payments, with an exceptions view (failed, stuck over 30 minutes, or captured without a stay);
  - refunds (approve, reject, retry; succeeded only on the provider's confirmation);
  - review moderation.
- **Catalogue:** amenities, destinations and browse categories.
  - Codes and slugs cannot be renamed.
  - Items still in use cannot be deleted.
  - The public cache is invalidated on change.
- **Support console:**
  - priority-sorted queue with assignment to people who hold `support:manage`;
  - three threads per ticket — customer, property (shared explicitly) and internal (agents only);
  - escalation, resolution, and first-response and resolution timing;
  - customers never see internal or property messages, and properties never see customer contact
    details.
- **CMS** — banners, featured destinations, promo sections, guides, blog, FAQs and legal pages, in
  English and Hindi:
  - Each entry keeps an editable **draft** and a **published snapshot**, so edits are never live
    until republished.
  - Publishing is scheduled as a `[publishAt, unpublishAt)` window, evaluated per request (no job
    can drift).
  - Optimistic concurrency uses a `version` field.
  - One-hour preview tokens are stored only as hashes.
  - Revision history is append-only.
  - Markdown bodies reject script, frame and inline-handler markup at the API, and the client
    renders them without raw HTML.
  - Public responses are cached for 60 seconds only when successful.
- **Corporate accounts:** organisations start as PENDING_VERIFICATION until a Stayscape admin
  approves them.

## Customer features

- **Recommendations:**
  - deterministic, rule-based scoring with reasons;
  - personal signals (own bookings and saved stays) used only after explicit opt-in, which is
    recorded with a timestamp and can be withdrawn;
  - otherwise labelled "Popular on Stayscape".
- **Price intelligence:** every price comes from the real quote engine.
  - **Flexible dates:** the lowest total per check-in date across a 14-day range.
  - **History:** daily observations stored once per property-local day.
  - **Alerts:** de-duplicated per stay; notify only for a strictly new low, at most once a day.
    Each notification is claimed atomically, so overlapping runs cannot notify twice.
  - **Last-minute deals:** shown only against at least 7 recorded observations and at least 15 %
    below their median.
- **Loyalty:**
  - Earned only when a stay is **completed**: 1 point per ₹100 of room charges after discounts,
    excluding tax.
  - Reduced proportionally by later refunds, capped at the available balance so it never goes
    negative.
  - Redeemed as single-use coupons; unused coupons return their points.
  - Tiers are based on points earned in the last 12 months and are for display only (no invented
    benefits).
- **Referrals:**
  - Rewards are paid only after the referred customer's first completed stay of at least ₹2,000
    that has not been fully refunded.
  - Abuse controls: verified email; a claim window of 7 days after sign-up and before any booking;
    no self-referral or reciprocal pairs; one referrer per customer; 10 rewards per referrer per
    year.
  - Referrers see only initials.
- **TripSpace:**
  - Invitations are bound to an email address, single-use, valid for 14 days and stored as hashes.
  - Roles: owner, editor, viewer.
  - Members see only each other's names.
  - A booking can be added only by its own customer, and shows hotel, dates and status only.
  - Read-only share links show hotels and dates only.
- **Corporate travel:**
  - one organisation per person;
  - policy checks (nightly cap, star cap, cities, advance days, monthly budget, approval threshold)
    run against a live quote;
  - approvers cannot approve their own travel;
  - booked trips are linked only to the employee's own matching confirmed booking;
  - reports and invoices cover linked bookings only, so personal bookings stay private.
- **i18n:**
  - English and Hindi dictionaries with English fallback;
  - the language persists in browser storage and, when signed in, in the account;
  - `<html lang>` follows the chosen language.
- **Currency display:**
  - approximate conversions from the **ECB daily reference rates** only;
  - currencies the ECB does not publish (AED) are not converted;
  - snapshots older than 7 days are not used;
  - charging is always in the property's currency.
- **Accessibility:** see [trustscore.md](trustscore.md#accessibility-provenance).

## AI travel assistant

- **Architecture:**
  - backend only (`POST /assistant/messages`); the key is read from `ANTHROPIC_API_KEY` on the
    server;
  - official `@anthropic-ai/sdk` 1.14.0, model `claude-opus-5-5`, effort `low`, server-side model
    fallback enabled;
  - a manual tool loop capped at 4 tool rounds — the last round offers no tools, so the model must
    answer;
  - per-request and per-turn timeouts.
- **Tools** are read-only calls into the same services as the website: `search_hotels`,
  `get_hotel` and `quote_stay`. The assistant cannot book, pay or change data.
  - Arguments are validated with Zod; invalid ones return an error result to the model.
  - Tool output is wrapped as `untrusted_data`.
  - The system prompt tells the model to treat tool data and history as data, never as instructions.
- **No invented facts:**
  - The final answer must match a JSON schema.
  - Returned hotel cards are built only from properties the tools returned in that turn.
  - Quotes come only from the pricing engine.
  - Any currency amount in the answer that the engine did not produce causes the answer to be
    replaced.
- **Limits:**
  - per-user per-minute and per-day quotas, taken atomically;
  - an optional monthly platform budget;
  - token and cost tracking per user-day and platform-month (no message text stored; user keys are
    hashed);
  - logs record tool names, token counts, cost and timing only.
- **Fallback:** a deterministic no-AI assistant answers when no key is configured, when the provider
  fails, refuses or returns invalid output, or when the budget is exhausted. Its replies are marked
  `degraded`. It is also the default in development and tests (`AI_PROVIDER=rules`).
- **Verification status:** the Claude path has been tested only with a scripted SDK stand-in. It has
  **not** been run against the live API, because no key is configured.

## Channel manager

- `ChannelAdapter` contract:
  - signature verification;
  - payload normalisation;
  - availability push.
- A shared **contract test suite** runs against every adapter.
- The only adapter is the **local simulator**:
  - development and test only, refused in production;
  - webhooks signed with HMAC-SHA256 over `timestamp.body`, with a 5-minute replay window;
  - pushes recorded locally.
- **No third-party channel manager is integrated.** A real one (SiteMinder, STAAH, Channex, …) needs
  that provider's API access and an adapter written against its documentation.
- **Connections:** webhook secrets are encrypted at rest and shown once, with rotation. Room mapping
  is by external room code.
- **Inbound events:**
  - signed;
  - idempotent per `(connection, event id)`;
  - external reservations hold rooms through the same conditional all-nights updates as Stayscape
    bookings;
  - an external sale that no longer fits is recorded as a **CONFLICT** (possible overbooking) for a
    person to resolve;
  - failures are retried with exponential backoff, up to 5 attempts;
  - all events go to an error log.
- **Outbound:** availability for the next 30 days is pushed every 5 minutes, with backoff on failure.

## Scheduled jobs added (BullMQ)

| Job                | Every | Purpose                                                                    |
| ------------------ | ----- | -------------------------------------------------------------------------- |
| `finance.backfill` | 1 h   | Ledger postings for confirmations that missed the inline hook              |
| `prices.observe`   | 6 h   | Daily price observations (idempotent per day)                              |
| `prices.alerts`    | 1 h   | Re-price alerts and notify on new lows                                     |
| `rewards.accrue`   | 1 h   | Earn and reverse points, release expired points coupons, qualify referrals |
| `channels.sync`    | 5 min | Retry failed channel events and push availability                          |
| `currency.refresh` | 6 h   | Store the ECB reference rates (idempotent per published day)               |

## Frontend

- **Partner pages:** performance dashboard, team, settlements, channel manager, blocks and
  closures, guest support.
- **Admin pages:**
  - platform dashboard, reports, customers, catalogue;
  - bookings and escalations, payments, refunds, commissions, settlements, coupons;
  - support queue, content, corporate accounts, review moderation.
- **Customer pages:** TripSpace, rewards, price alerts, assistant, corporate travel and reports.
  - The property page gains accessibility provenance, TrustScore, flexible dates, price watch,
    add-to-trip, and approximate currency.
  - Search gains accessibility filters.
- **Public pages:** guides, blog, legal pages, FAQ and draft preview.
- **Charts** are inline SVG with an accessible "Show as table" alternative. No chart library was
  added.
