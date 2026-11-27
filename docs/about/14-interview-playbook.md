# 14. Interview playbook

## 14.1 How to present the project

### The 30-second version

> "STAYSCAPE is a multi-vendor hotel marketplace for India that I built end to end. Travellers
> search real availability and prices, book and pay; hotels manage listings, rates, inventory and
> guests; administrators verify partners and run refunds, commissions and settlements. It's a
> TypeScript monorepo — React frontend, Node/Express API on MongoDB and Redis with background
> workers — and I took it to production readiness with 360+ automated tests, load testing,
> monitoring, encrypted backups and a CI/CD pipeline."

### The 2-minute version (structure: problem → design → hard parts → proof → result)

1. **Problem:** independent hotels need a shop window and booking engine; travellers need trustworthy
   prices and fair refunds.
2. **Design:** modular monolith; shared schemas and permissions between frontend and backend;
   MongoDB transactions; Redis-backed queues; nginx in front.
3. **Hard parts:** overbooking under concurrency, exactly-once payment confirmation, money accuracy,
   multi-tenant permissions.
4. **Proof:** concurrency tests with real parallel requests, a route-by-role authorisation matrix
   over 300 routes, a 30-step acceptance flow, load tests, a reconciliation report showing zero
   exceptions after load.
5. **Result:** ready for staging; production waits only on external accounts (payment keys, hosting)
   and legal review.

### Use the STAR method for stories

**S**ituation → **T**ask → **A**ction → **R**esult. Example:

- _S:_ Load test showed 2-second latency at only 27 requests/second.
- _T:_ Find and fix the bottleneck without guessing.
- _A:_ CPU-profiled the API; found Intl.DateTimeFormat created per pricing call; cached per time
  zone (4× less CPU); then compared server vs client timings and checked CPU throttling counters;
  scaled to three replicas.
- _R:_ 84 req/s with all budgets met except autocomplete (309 ms against 300 ms); zero errors at 3×
  load; data integrity verified afterwards.

## 14.2 Questions and model answers

### Product and design

1. **What problem does it solve?** Connects independent hotels with travellers; gives hotels tools
   and travellers trust, earning commission.
2. **Who are the users?** Guests, customers, hotel owners, hotel staff, support, admins, super
   admins — seven roles with distinct permissions.
3. **Most important design principle?** No fake success — never confirm a booking, payment or refund
   until it's verified with the source of truth.
4. **Why snapshots in bookings?** So later price or policy changes never alter what a guest agreed
   to; it's correct and legally safer.
5. **What would you build next?** Live Razorpay and payouts, a real channel-manager integration,
   SMS/push, server-side rendering for SEO, real-user performance monitoring.

### Architecture

6. **Monolith or microservices?** Modular monolith: booking touches inventory, payment, ledger and
   notifications in one transaction; modules allow later extraction.
7. **How do frontend and backend share code?** A workspace package with types, Zod schemas, the
   permission matrix and money helpers.
8. **What is the request lifecycle?** Request id → metrics → logging → headers → CORS → rate limit
   → body limit → router → authenticate → permission → validation → controller → service → mapper.
9. **What is dependency injection here?** A container builds services with their dependencies, so
   tests inject fakes (in-memory queue, memory mailer).
10. **Why nginx in front?** Serves static files efficiently, same-origin API proxy for strict
    cookies, security headers, SEO includes, blocks internal endpoints.

### Database

11. **Why MongoDB?** Rich nested documents and multi-document transactions on a replica set.
12. **SQL vs NoSQL?** Tables with joins and enforced schema vs flexible documents; both fine; I'd
    pick Postgres for heavy relational reporting.
13. **What is an index?** A sorted lookup structure making queries fast; unique indexes also enforce
    rules (one booking per hold).
14. **What are ACID transactions?** All-or-nothing, consistent, isolated, durable groups of changes.
15. **Why a replica set locally?** Transactions need it; dev and tests behave like production.
16. **How do you store money?** Integer paise and basis points with explicit rounding.
17. **How do you handle time zones?** Stay dates as property-local dates with the property's time
    zone; instants in UTC; deadlines computed in the property's zone.
18. **How do you change data shape safely?** Versioned, locked, idempotent migrations following
    expand → contract so rollbacks stay safe.

### Concurrency and correctness

19. **How do you prevent overbooking?** Conditional atomic increments within a transaction per stay,
    plus a database validator; tested with concurrent requests.
20. **What is a race condition?** Outcome depends on timing of concurrent operations; fixed by
    making check-and-update atomic.
21. **What is idempotency?** Same effect whether performed once or many times; implemented with
    Idempotency-Key headers, request hashes and unique indexes.
22. **How is a booking confirmed exactly once?** Conditional state transition (only from
    PENDING/PROCESSING) inside the payment transaction; browser verify, webhook and reconciliation
    all converge on it.
23. **What happens if a payment arrives after the hold expired?** Re-allocate if rooms are free;
    otherwise mark for reconciliation, record as unallocated and refund automatically.
24. **How are abandoned holds cleaned up?** A job every 30 s expires them with conditional updates —
    safe with multiple workers.
25. **What's a state machine and why?** Explicit allowed states and transitions; prevents impossible
    actions like refunding twice.

### Payments and money

26. **How does online payment work?** Server creates an order; the gateway collects payment;
    server verifies signature and fetches status; webhook confirms.
27. **Why not trust the browser's success callback?** It can be forged; the server verifies with the
    provider.
28. **How do you secure webhooks?** HMAC over the raw body, constant-time compare, event-id
    de-duplication, re-fetching from the provider.
29. **What if webhooks arrive twice or out of order?** De-duplicated by event id; applied through
    the state machine so a late failure can't undo a capture.
30. **Explain the ledger.** Append-only entries across cash, partner payable, revenue, promotion
    expense and unallocated; each transaction balances; corrections are new entries.
31. **How are commissions calculated?** Precedence property > partner > global; basis points plus
    fixed; snapshotted at confirmation; taxes never commissioned.
32. **How are partners paid?** Eligible entries after the stay + hold period form a settlement;
    marked paid only with a bank-transfer reference and proof; payouts automated later.
33. **What is reconciliation?** Comparing bookings, payments, refunds, ledger and the provider;
    report-only, zero exceptions after load tests.
34. **How do refunds work?** Policy-driven amount; succeeded only on provider confirmation; timeouts
    resolved by reconciliation without double refunds.

### Security

35. **How are passwords stored?** Argon2id hashes with salts.
36. **Explain your token strategy.** 15-minute JWT in memory + 30-day HttpOnly, Secure,
    SameSite=Strict refresh cookie, rotation with reuse detection.
37. **What's CSRF and your defence?** Forged cross-site requests; bearer tokens, SameSite cookies,
    double-submit CSRF token on refresh/logout, origin checks.
38. **What's XSS and your defence?** Injected scripts; React escaping, no raw HTML, strict CSP,
    escaped SEO metadata, no tokens in readable storage.
39. **What's IDOR/BOLA?** Accessing others' records by changing ids; ownership checks returning 404.
40. **How do you prove access control works?** The 300-route × 7-role matrix test.
41. **What's mass assignment?** Sneaking extra fields like roles into updates; strict schemas reject
    unknown fields.
42. **How do you manage secrets?** Environment variables from a secret manager; startup refuses dev
    secrets in production; gitleaks scans history.
43. **How do you handle file uploads?** Size limits, magic-byte type detection, re-encoding, private
    storage for documents.
44. **How do you comply with privacy law?** Data export and deletion with legally required records
    retained; minimal sharing; documented breach procedure (DPDP Act, CERT-In).

### Frontend

45. **Why an SPA?** Highly interactive and mostly private screens; SEO handled with server-generated
    metadata.
46. **Server state vs client state?** TanStack Query for API data; Redux for small app-wide state.
47. **How do you handle token expiry in the browser?** Axios interceptor refreshes once and retries,
    coordinating concurrent failures.
48. **How do you make it accessible?** WCAG 2.2 AA practices verified with axe and scripted tests.
49. **How do you make it fast?** Code splitting, lazy map chunk, responsive WebP/AVIF images,
    immutable caching; LCP 0.3–1.3 s in lab tests.
50. **How do you do i18n?** `tr()` source-text keys, lazily loaded Hindi dictionary, a CI check for
    missing translations.

### Reliability and operations

51. **Why background jobs?** Slow, unreliable or scheduled work shouldn't block users.
52. **What's the outbox pattern?** Writing the event in the same transaction as the change, then
    dispatching with retries — exactly-when-committed delivery.
53. **How do you monitor?** Structured logs with request ids, Prometheus metrics, 16 alert rules with
    runbooks.
54. **What are RPO and RTO?** Acceptable data loss and downtime; ≤ 5 minutes with point-in-time
    restore, ≤ 2 hours recovery.
55. **How do you know backups work?** Automated restore drill comparing counts and a financial
    checksum.
56. **How do you deploy?** CI-built immutable images, release task (migrations, indexes),
    health-checked rollout, smoke test, automatic rollback, approval for production.
57. **How does it scale?** Stateless API replicas, Redis caching of public data, indexed queries,
    separate worker.

### Testing

58. **What's your testing strategy?** Pyramid: unit, integration against a real database, component,
    end-to-end, load, plus static checks.
59. **Why not mock the database?** The correctness guarantees live in database operations; mocks
    would hide concurrency bugs.
60. **What did load testing teach you?** Measure before optimising; profile; distinguish server time
    from queueing; scale horizontally.
61. **What bug are you proudest of catching?** (Pick one) a secret-scan allowlist gap that would have
    failed CI; screen-reader text escaping scroll containers and widening phone pages; the map breaking
    after a security upgrade because nginx served `.mjs` with the wrong type.

### Behavioural

62. **What would you do differently?** Start with the authorisation matrix and load tests earlier;
    consider server-side rendering for public pages from day one.
63. **How do you handle unknowns (no payment keys)?** Build behind an interface, use an honest
    labelled sandbox that mimics the real protocol, document exactly what remains unverified.
64. **How do you balance speed and quality?** Clear principles, automated checks in CI, and honest
    reporting of what is and isn't verified.

## 14.3 Words that signal seniority (use them correctly)

Idempotency · atomic conditional update · invariant · transaction / rollback · state machine ·
source of truth · eventual consistency · back-off · dead-letter queue · outbox pattern · least
privilege · defence in depth · horizontal scaling · p95 latency · graceful degradation · expand and
contract migrations · immutable artefacts · observability · RPO/RTO · threat model.

## 14.4 Be honest about limits

Interviewers trust candidates who know their system's limits. STAYSCAPE's are clearly documented:
live Razorpay not yet verified (no keys), payouts disabled by design, channel manager is a simulator,
load tests ran on a laptop, manual screen-reader audit pending, Hindi needs native review, no full
server-side rendering. Saying "here is what's proven and here is what still needs an external
account" is a strength.
