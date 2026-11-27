# 11. Testing and quality

## 11.1 Why automated tests

A test is a small program that checks another program. Once written, it runs in seconds every time
anything changes, so mistakes are caught immediately instead of by customers. Tests are also
**documentation**: they show exactly how the system is supposed to behave.

## 11.2 The testing pyramid

```
            /\        End-to-end (few, slow, most realistic): a real browser clicks through
           /  \       the real app — 28 tests + 1 thirty-step acceptance flow
          /----\
         /      \     Integration (many): real HTTP requests to the real API with a real
        /        \    database — most of the 227 API tests
       /----------\
      /            \  Unit (many, fast): one function in isolation — pricing engine,
     /______________\ cancellation policy, money rounding, permission checks
```

Many fast tests at the bottom, fewer slow ones at the top.

| Layer       | STAYSCAPE                                                                                                                                                 | Tool                                       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Unit        | Pricing engine, cancellation rules, rounding, refund splits, permissions, TrustScore weights                                                              | Vitest                                     |
| Integration | Every API module: Supertest sends real requests through Express, validation, permissions and services to a **real MongoDB replica set** started in memory | Vitest + Supertest + mongodb-memory-server |
| Component   | React screens rendered and used like a user would (find by label, click, type) with a mocked API                                                          | Vitest + Testing Library (98 tests)        |
| End-to-end  | Real Chromium browser against the running stack (production mode on staging)                                                                              | Playwright (28 tests)                      |
| Load        | Many simulated users at once                                                                                                                              | k6                                         |
| Static      | Type checking, linting, formatting, translation coverage                                                                                                  | tsc, ESLint, Prettier, i18n check          |

Results on the final code: **335 unit/integration/component tests pass** (shared 10, API 227,
web 98), **28 end-to-end tests pass** on both the production-mode staging stack and the development
stack.

## 11.3 Notable tests (great interview stories)

| Test                           | What it proves                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authorisation matrix**       | Discovers all 300 routes and calls each as 7 roles; refused exactly when the permission is missing; no crashes; public routes pinned                                                                                                                                                                 |
| **Concurrency**                | 2 customers for the last room → 1 wins; 10 customers for 3 rooms → 3 win; overlapping multi-night stays never overlap; 3 racing expiry workers release each night once                                                                                                                               |
| **Payment races**              | Browser verify + webhook + second verify at the same moment → confirmed once, one ledger entry, one email                                                                                                                                                                                            |
| **Failure paths**              | Gateway outage, capture timeout, payment after hold expiry, cancel during payment, refund timeout, duplicate webhooks, forged signatures                                                                                                                                                             |
| **Reconciliation**             | A clean dataset reports nothing; deliberately corrupted ledger/payments are detected                                                                                                                                                                                                                 |
| **Acceptance**                 | 30 steps: register → verify email → partner onboarding → approval → hotel, rooms, rates, inventory → publish → search, filter, compare → quote → hold → guest details → pay → verify → confirmation email → partner sees reservation → check-in/out → review → analytics → commission and settlement |
| **Accessibility & responsive** | axe WCAG 2.2 AA on public and logged-in pages; nine screen widths; keyboard; 200 % text; reduced motion; touch targets; error announcement                                                                                                                                                           |
| **Resilience**                 | Deep links and refresh, back/forward keeps filters, lost connection shows a retry that works, expired session returns you to where you were after sign-in                                                                                                                                            |
| **Privacy**                    | Download data, delete account, old password no longer works                                                                                                                                                                                                                                          |
| **SEO**                        | Hostile hotel names can't inject HTML/script into metadata                                                                                                                                                                                                                                           |

**Real-database testing** matters: mocking the database would have hidden every concurrency bug,
because the protections live in the database operations.

## 11.4 Load and stress testing

**Load testing** checks behaviour under expected traffic; **stress testing** pushes beyond it to find
the breaking point. STAYSCAPE's k6 script simulates a realistic mix: browsing (40 users),
autocomplete (10), availability checks (15), booking with real holds/payments that are then
cancelled (6), partner inventory updates (3), admin dashboards (2).

What was learned (a great interview story about _measuring before optimising_):

1. First run: only 27 requests/second, everything ~2.5 s slow.
2. A CPU **profile** of the API showed the time spent building date formatters
   (`Intl.DateTimeFormat`) on every pricing call. Caching one formatter per time zone made pricing
   **4× cheaper**.
3. Still slow → measured the server's own timings vs the client's. The server handled requests in
   ~50 ms, but they waited ~1.5 s before being handled. Linux **CPU throttling** counters showed the
   API container was paused 87 % of the time at its 1-CPU limit.
4. Ran **3 API copies**: 84 req/s, all speed budgets met except autocomplete (309 ms against
   300 ms) → proof that horizontal scaling works.
5. Stress at 3× users: throughput levelled off at ~90 req/s and responses slowed, but **zero errors**
   — graceful degradation.
6. After all runs: no inventory violations, no stuck holds, no failed jobs, reconciliation clean.

Honest caveat (say this in interviews): it ran on a laptop shared with other projects, so the numbers
are indicative, not production capacity.

## 11.5 Continuous integration and delivery (CI/CD)

**CI** (Continuous Integration) runs all checks automatically on every change pushed to GitHub, so
broken code can't be merged. **CD** (Continuous Delivery/Deployment) automatically builds and ships
releases. STAYSCAPE's GitHub Actions pipeline:

1. **Verify** — install, lint, format check, typecheck, translation and config-doc checks, all tests
   (with real MongoDB and Redis), build.
2. **Security** — dependency audit (fail on high/critical), secret scan of the whole git history.
3. **Images** — build Docker images tagged with the commit id, scan them with Trivy, publish.
4. **Staging tests** — start the exact images in production mode, migrate, seed fictional data,
   smoke test, full browser suite, backup + restore drill, load smoke.
5. **Deploy to staging** — automatic.
6. **Deploy to production** — waits for **manual approval** by a reviewer.

The pipeline definition is validated (actionlint) but has not run on GitHub yet — that needs a push
and GitHub environments with secrets.

## 11.6 Code quality tools

- **TypeScript strict mode** — catches type mistakes.
- **ESLint** — bug patterns and accessibility rules (jsx-a11y); zero warnings allowed.
- **Prettier** — one consistent format, so reviews focus on logic.
- **Conventional commits** — commit messages like `feat(...)`, `fix(...)` describe changes.

## Say it in an interview

**"How did you test concurrency?"** — _"Against a real in-memory MongoDB replica set, I fire
concurrent requests with Promise.all — ten customers for three rooms — and assert exactly three
succeed, every night shows three held rooms, and a database-wide invariant query returns zero
violations. Mocks would have hidden exactly the bugs I care about."_

**"Tell me about a performance problem you solved."** — _"Load testing showed uniform 2-second
latency. A CPU profile pointed to creating Intl.DateTimeFormat objects in the pricing loop — caching
them per time zone made pricing 4× cheaper. Then server-side metrics showed fast handlers but long
queueing, and cgroup counters showed CPU throttling, so the fix was horizontal scaling; three
replicas met the budgets."_

**"What's your testing strategy?"** — _"A pyramid: pure unit tests for pricing and policies,
integration tests through HTTP against a real database for every module, component tests with
Testing Library, Playwright end-to-end against the production-mode stack, plus k6 load tests and an
automated route-by-role authorisation matrix."_
