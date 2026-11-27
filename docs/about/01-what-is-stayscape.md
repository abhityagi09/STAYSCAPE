# 1. What STAYSCAPE is

## 1.1 The problem it solves

Imagine you run a small boutique hotel in Udaipur. You have 12 rooms. You want travellers from all
over India to find you, see real prices, and book and pay online — but you cannot build a website
with a booking engine, a payment system and a team to answer complaints.

Now imagine you are a traveller. You want to see many hotels side by side, trust that the photos and
reviews are real, know the full price including tax before you pay, and get your money back fairly
if you cancel.

A **marketplace** sits in the middle. It gives hotels a shop window and tools, gives travellers
choice and trust, and earns a **commission** (a percentage) on every completed booking. Amazon is a
marketplace for products; STAYSCAPE is a marketplace for places to stay. Because many independent
sellers ("vendors") use the same platform, it is called **multi-vendor**.

## 1.2 Who uses it — the roles

Software decides what each person may do based on their **role**. STAYSCAPE has seven:

| Role                    | Who they are                      | What they can do                                                                                                              |
| ----------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Guest**               | Anyone not signed in              | Browse, search, see prices, read reviews, create an account                                                                   |
| **Customer**            | A signed-in traveller             | Book, pay, cancel, review a completed stay, save favourites, plan trips, ask the AI assistant, download or delete their data  |
| **Hotel owner**         | The business that owns properties | Everything about their own properties: details, photos, rooms, prices, availability, reservations, team, earnings, analytics  |
| **Hotel staff**         | Employees of an owner             | Only the properties they are assigned to, and only the actions the owner allowed (e.g. check guests in but not change prices) |
| **Support agent**       | STAYSCAPE customer service        | Read customers, bookings and payments; answer support tickets; cannot change money settings                                   |
| **Administrator**       | STAYSCAPE operations team         | Approve partners and listings, handle refunds, set commissions, pay partners, moderate reviews, manage content                |
| **Super administrator** | The most trusted few              | Everything, including making other people administrators                                                                      |

An important rule: **nobody can give themselves more power**, and only super administrators can
create administrators. This stops a compromised account from taking over the system.

## 1.3 The journeys

### The traveller's journey (the most important one)

1. **Discover** — the home page shows destinations, trending and featured stays.
2. **Search** — type "Goa", pick dates and guests. Results show _real_ prices for those dates,
   including tax, because the system calculates a price for every hotel that has rooms free.
3. **Filter and sort** — property type, star rating, amenities (pool, Wi-Fi), price range,
   "free cancellation", "breakfast included"; sort by price, rating, distance; switch between a
   list and a **map**.
4. **Compare** — tick up to four stays and see them side by side.
5. **View a property** — photo gallery, map, amenities, policies, accessibility features, a
   **TrustScore**, verified reviews, and each room with its rate plans and live prices.
6. **Choose a room** — the server produces a **quote**: a signed price promise valid for a short
   time.
7. **Hold** — the chosen rooms are reserved for 10 minutes so nobody else can take them while
   you pay. (Think of a shop assistant putting an item behind the counter for you.)
8. **Guest details** — name, contact, special requests.
9. **Pay** — through the payment gateway (Razorpay in production; a clearly labelled test gateway
   in development). STAYSCAPE never sees card numbers.
10. **Confirmation** — only after the payment is _verified with the payment company_ is the
    booking confirmed; an email and an invoice follow.
11. **Before and during the stay** — reminders, the booking page, the option to cancel under the
    rate's policy (refund calculated automatically).
12. **After the stay** — write a review (only people who actually stayed can), earn reward points.

### The hotel partner's journey

1. **Apply** — business details, tax registration, bank account (stored encrypted), documents
   such as an ownership proof (stored privately).
2. **Verification** — an administrator checks and approves or asks for changes.
3. **Create a property** — description, location on a map, photos and videos, amenities,
   policies, accessibility declarations.
4. **Rooms and rates** — room categories (e.g. "Deluxe Lake View", 2 adults, 1 king bed), rate
   plans (e.g. "Flexible with breakfast", "Non-refundable"), pricing rules (weekend +20 %,
   early-bird −10 %, festival dates).
5. **Inventory** — a calendar of how many rooms are available each night; block rooms for
   maintenance or stop selling a date.
6. **Publish** — an administrator reviews the listing; once approved it appears in search.
7. **Daily operations** — arrivals, check-in, check-out, no-shows, room numbers, notes, replying
   to reviews, support tickets shared by STAYSCAPE.
8. **Money** — see what STAYSCAPE owes them (from the ledger) and the settlements paid to them.
9. **Team** — invite staff and decide exactly what each may do at which property.

### The administrator's journey

Approve partners and listings · moderate reviews · search any booking · decide refund requests ·
set commission rules · create settlement batches and record bank transfers with proof · create
coupons · publish content (travel guides, FAQs, legal pages) · watch the operations page for
problems (failed refunds, stuck jobs, payments needing attention) · run the **reconciliation
report** that proves the money adds up · read the **audit log** of who did what.

## 1.4 The extra features (what makes it more than a basic booking site)

| Feature                   | In plain words                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Wishlists and trips**   | Save favourite stays in named lists; plan a trip with friends who can be invited to edit                                                         |
| **Price intelligence**    | A calendar of cheapest prices by date, price-drop alerts, "deal" labels only when the price really is lower than its own history                 |
| **Rewards and referrals** | Points for completed stays, redeemable as coupons; bonus for referring a friend                                                                  |
| **Corporate travel**      | Companies set travel policies (maximum price per night, approval above an amount); employees request trips; managers approve                     |
| **TrustScore**            | A score built from verified reviews, cancellation behaviour, response quality and verified features — withheld when there is too little evidence |
| **Accessibility**         | Hotels declare features (step-free entrance, roll-in shower); administrators verify them; guests can filter by them                              |
| **AI assistant**          | Ask in plain language ("a quiet stay in Udaipur for two next weekend"); it searches real data and never invents hotels or prices                 |
| **Two languages**         | English and Hindi                                                                                                                                |
| **Currency display**      | See approximate prices in other currencies using official European Central Bank rates (payment is always in rupees)                              |
| **Content management**    | The team publishes travel guides and FAQs with schedules and previews                                                                            |
| **Analytics**             | Occupancy, average daily rate, revenue per available room and conversion for partners; platform-wide figures for administrators                  |

## 1.5 Design principles (the "rules of the house")

These were set at the start and followed in every phase. Interviewers love principles because they
show judgement:

1. **No fake success.** The system never says "paid" or "refunded" until the payment company
   confirms it.
2. **Money in whole numbers of paise.** ₹5,250.00 is stored as `525000`. Decimals cause rounding
   errors (chapter 5).
3. **Dates belong to the hotel.** A "night of 12 December" means 12 December in the hotel's time
   zone, not the server's.
4. **The server decides prices.** The browser can never send a price; it is always recalculated.
5. **Every important change is all-or-nothing** (a _transaction_) and safe to retry (_idempotent_).
6. **Check permission on every request** — and check that the specific record belongs to you.
7. **Validate everything that comes in.**
8. **No secrets in the code.** Passwords and keys live in the environment, never in files on
   GitHub.
9. **Accessible to everyone,** with loading, empty and error states for every screen.
10. **Never claim something works without a test that proves it.**

## 1.6 How it was built — the five phases

| Phase | Theme                       | Highlights                                                                                                                                                                        |
| ----- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Foundation                  | Project structure, sign-in, roles and permissions, design system, Docker                                                                                                          |
| 2     | Marketplace                 | Partner onboarding, listings, photos, rooms, rates, inventory, pricing engine, search, maps, comparison                                                                           |
| 3     | Reservations                | Holds, bookings, payments, cancellations, refunds, emails, invoices, reviews, support, wishlists                                                                                  |
| 4     | Operations and intelligence | Partner/admin dashboards, staff, finance ledger, commissions, settlements, coupons, CMS, analytics, Hindi, AI assistant, TrustScore, rewards, trips, corporate                    |
| 5     | Production readiness        | Security audit, permission matrix, concurrency tests, reconciliation, accessibility, performance and load testing, monitoring, backups, CI/CD, SEO, privacy rights, documentation |

## Say it in an interview

**"What is STAYSCAPE?"** — _"A multi-vendor hotel marketplace for India. Travellers search real
availability and prices, book and pay online; hotel partners manage listings, rates, inventory and
guests; administrators verify partners, handle refunds, commissions and settlements. I built the
whole system: a React web app, a Node.js/Express API on MongoDB and Redis, background workers, and
the production tooling — tests, monitoring, backups and CI/CD."_

**"What was the hardest part?"** — _"Making booking and money correct under pressure: two people
trying to book the last room at the same moment, a payment that succeeds after the room hold has
expired, a webhook that arrives twice or out of order. I solved those with atomic database
updates, transactions, idempotency keys and treating the payment provider as the source of truth —
and I wrote tests that fire concurrent requests to prove it."_

**"Why a marketplace and not one hotel's site?"** — _"The interesting problems — multiple vendors,
permissions, commissions, settlements, trust and moderation — only exist in a marketplace."_
