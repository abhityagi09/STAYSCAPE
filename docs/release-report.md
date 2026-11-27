# STAYSCAPE — Phase 5 final release report

Date: 2026-11-27 · Branch: `phase5` · Environment verified: local production-mode staging stack
(`docker-compose.prod.yml`, `NODE_ENV=production`, `DEPLOYMENT_ENV=staging`, labelled sandbox
gateway) and the development stack, on Docker Desktop (8 vCPU / 3.7 GiB VM).

## Recommendation: **READY FOR STAGING**

The application is functionally complete, secured, tested and operable in a production-mode
environment. It is **not yet ready for a controlled production pilot** because these are still
missing:

- real payments have not been exercised against Razorpay (no account/keys);
- no production infrastructure exists yet (hosting, domain/TLS, Atlas, managed Redis, S3, SMTP);
- the CI/CD pipeline has not yet run on GitHub (it needs a push and GitHub environments);
- the legal and tax documents and obligations need professional review.

Once those four items are in place and the pipeline passes, the evidence below supports a
**controlled production pilot**.

## Functional coverage

Full matrix: [traceability.md](traceability.md). Of 73 requirements:

- **65 PASS**;
- **6 PASS** with an external or manual part outstanding: payouts, live Claude, CI/CD live
  deployment, the legal review, the manual screen-reader audit, and Razorpay test mode;
- **1 PARTIAL/BLOCKED**: the channel manager is simulator-only, pending provider API access;
- **1 BLOCKED**: live Razorpay verification.

None FAIL.

| Module                                                                                              | Status                                          |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Accounts and authentication (incl. data export and deletion)                                        | PASS                                            |
| Authorisation and tenant isolation                                                                  | PASS                                            |
| Marketplace: onboarding, listings, media, rooms, rates, inventory, search, maps, comparison         | PASS                                            |
| Reservations: holds, bookings, payments (sandbox), cancellations, refunds, notifications, documents | PASS (Razorpay live: BLOCKED)                   |
| Reviews, wishlists, support, trips, rewards, price intelligence, TrustScore, accessibility          | PASS                                            |
| Partner operations, analytics, staff                                                                | PASS                                            |
| Admin operations, finance, commissions, settlements, reconciliation, coupons, promotions, CMS       | PASS (payouts: BLOCKED by design)               |
| Channel manager                                                                                     | PARTIAL (simulator only)                        |
| AI assistant                                                                                        | PASS (deterministic); live Claude BLOCKED (key) |
| English/Hindi, currency display                                                                     | PASS (1,950 strings; native review pending)     |

## Technical verification (all commands run on 2026-11-27)

| Check                                                                   | Result                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` (incl. jsx-a11y), `format:check`, `typecheck`            | clean                                                                                                                                                                                                     |
| `npm run i18n:check`, `node scripts/env-docs.mjs --check`               | 0 missing translations; env reference up to date                                                                                                                                                          |
| Unit + integration tests (`npm test`, MongoDB replica set + real Redis) | **335 passed**: shared 10, API 227 (39 files), web 98 (12 files)                                                                                                                                          |
| Authorisation matrix                                                    | 300 routes × 7 roles, 0 violations, 0 server errors, 44 pinned public routes                                                                                                                              |
| Acceptance scenario (30 steps, one flow)                                | passed                                                                                                                                                                                                    |
| Production build                                                        | passed (API tsup, web Vite)                                                                                                                                                                               |
| End-to-end (Playwright) on the production-mode staging stack            | **28 passed**: functional journeys, privacy, resilience (deep links, back/forward, network loss, ended session), responsive (9 widths), axe WCAG 2.2 AA, keyboard, motion, text size, targets, Web Vitals |
| End-to-end on the development stack                                     | 28 passed                                                                                                                                                                                                 |
| Docker                                                                  | API and web images build; non-root (uid 1000 / 101), read-only, capabilities dropped; health checks pass; release task (migrations + indexes) ran                                                         |
| Smoke test (`scripts/deploy/smoke.sh`)                                  | passed                                                                                                                                                                                                    |
| CI/CD workflow                                                          | `actionlint` clean; **not yet executed on GitHub**                                                                                                                                                        |

## Security

Completed: OWASP Top 10 and OWASP API review ([security.md](security.md)):

- **Dependencies:** `npm audit` reports 0 vulnerabilities. Upgraded maplibre-gl (critical XSS),
  nodemailer (high, SMTP injection), sharp (high, libvips), vitest/tinypool (critical, dev only)
  and esbuild.
- **Secrets:** gitleaks over the full history found no leaks, so no rotation is required.
- **Images:** Trivy finds no fixable high or critical vulnerabilities in either image (OS
  packages upgraded, npm removed from the runtime image).
- **Access control:** a route-by-route authorisation matrix; three partner routers hardened.
- **Logs:** capability tokens are redacted from request logs.
- **Privacy:** data export and deletion are implemented.

Unresolved risks (low): no dedicated error-tracking SaaS (errors are covered by logs, metrics and
alerts); a manual screen-reader audit is still pending; the DPDP and CERT-In organisational
duties (grievance officer, incident contact, log retention region) are not yet in place.

## Performance

Conditions: production-mode staging on a shared laptop VM, with k6 running inside the Docker
network. Budgets and full results: [testing.md](testing.md).

| Measure                                          | Result                                                                                                                      |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Pricing CPU per dated search                     | **4× lower** (17.7 → 4.4 ms) after caching `Intl` formatters per time zone                                                  |
| Baseline (76 VUs, realistic mix), 3 API replicas | 83.8 req/s; p95 0.30–1.11 s; all budgets met except autocomplete (309 ms vs 300 ms); 0.02 % errors (expected sold-out 409s) |
| Stress (228 VUs)                                 | saturates at ≈ 90 req/s; p95 3–5 s; **0 errors**, graceful degradation                                                      |
| Single replica                                   | CPU-bound at ≈ 40 req/s (throttled 87 % of periods): scale horizontally                                                     |
| Integrity after load                             | 0 invariant violations, 0 overdue holds, 0 failed jobs, 0 reconciliation exceptions                                         |
| Home page transfer                               | JS 626 → **308 KB**, total 965 → **406 KB** (map stack split into a lazy chunk)                                             |
| Lab LCP / CLS (desktop)                          | home 0.87–1.29 s, search 0.45 s, property 0.30 s; CLS ≤ 0.0001                                                              |

## Integrations

| Integration                                        | Status                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| MongoDB (replica set, transactions), Redis, BullMQ | verified                                                                                            |
| SMTP (Mailpit in staging)                          | verified                                                                                            |
| Payment gateway                                    | labelled sandbox verified end to end; Razorpay adapter implemented, **BLOCKED** on account and keys |
| ECB reference rates (display currency)             | verified live                                                                                       |
| S3 storage                                         | adapter implemented; local driver verified; S3 **BLOCKED** on a bucket                              |
| Anthropic Claude                                   | SDK path tested with a scripted client; live **BLOCKED** on a key                                   |
| Channel manager                                    | simulator only; **BLOCKED** on provider API access                                                  |
| Payout provider                                    | disabled by design; **BLOCKED** on provider onboarding                                              |

## Operational readiness

| Area        | State                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Monitoring  | Prometheus `/metrics` (latency, errors, runtime, dependencies, queues, payments, reconciliation, inventory integrity); 16 alert rules validated and scraped on staging; runbooks and incident response in [monitoring.md](monitoring.md)   |
| Logs        | structured JSON with request ids, ready for forwarding                                                                                                                                                                                     |
| Backups     | encrypted oplog-consistent dumps plus media archive; **restore drill passed** (66 collections, 0 mismatches, financial checksum equal); RPO ≤ 5 min with Atlas PITR, ≤ 24 h portable; RTO ≤ 2 h ([backup-recovery.md](backup-recovery.md)) |
| Deployments | release task, health-checked rollout, smoke test, automatic rollback, approval-gated production ([deployment.md](deployment.md))                                                                                                           |
| Support     | admin operations console, reconciliation report, job inspector and retry, audit log                                                                                                                                                        |

## Defects found in Phase 5

All critical and high defects are fixed; regression tests were re-run after the fixes.

| #   | Severity | Defect                                                                                                                                                                      | Resolution                                                                                         |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Critical | maplibre-gl ≤ 6.4: XSS in its DOM sanitiser                                                                                                                                 | upgraded to 6.19.0                                                                                 |
| 2   | High     | nodemailer SMTP command injection; sharp/libvips CVEs                                                                                                                       | upgraded to 10.6.1 / 0.35.5                                                                        |
| 3   | High     | container base images: 26 (API) and 68 (web) fixable high/critical OS vulnerabilities                                                                                       | newer pinned bases, `apk upgrade`, npm removed                                                     |
| 4   | High     | no data export or account deletion (DPDP rights)                                                                                                                            | implemented in the API and UI, with tests                                                          |
| 5   | High     | the new privacy card was not reachable (it was placed on an unrouted page)                                                                                                  | moved to Account → Settings; e2e added                                                             |
| 6   | High     | API CPU-bound: a new `Intl.DateTimeFormat` per pricing call                                                                                                                 | formatters cached per time zone; public caches added                                               |
| 7   | High     | map broken by the MapLibre 6 upgrade (worker not emitted; `.mjs` served as octet-stream)                                                                                    | worker emitted as an asset; nginx serves `.mjs` as JavaScript                                      |
| 8   | Medium   | three partner routers lacked the router-level `partner:access` gate (data was still scoped, so nothing leaked)                                                              | gate added; matrix enforces it                                                                     |
| 9   | Medium   | capability tokens (share links, previews) written to request logs                                                                                                           | redacted                                                                                           |
| 10  | Medium   | WCAG failures: text contrast, invalid `<dl>`, label-in-name, invalid grid ARIA                                                                                              | fixed; axe now clean on public and workspace pages                                                 |
| 11  | Medium   | phone-width horizontal overflow on every workspace page (header; `sr-only` text escaping scroll regions)                                                                    | header controls move to the drawer; scroll regions made `relative`                                 |
| 12  | Medium   | public header overflow at 200 % browser text size                                                                                                                           | breakpoint adjusted; language switcher added to the drawer                                         |
| 13  | Medium   | home LCP delayed by the hero animation (2.1 s); CLS 0.37 from the footer while the property page loaded; MapLibre in the shared vendor chunk                                | animation removed from the LCP element; main area kept at least one viewport tall; map chunk split |
| 14  | Medium   | no metrics, alerts, reconciliation report, job inspection, migrations, production-safe admin bootstrap, backups, SEO, production compose or CD pipeline                     | all implemented and verified (see above)                                                           |
| 15  | Low      | empty `METRICS_TOKEN=` from `.env.example` would have failed config validation; `.env.example` lacked 4 variables; React Router hydrate warning; a misplaced config comment | fixed                                                                                              |

## Post-release audit (2026-11-27)

A second audit found and fixed 8 issues: 1 high (a secret-scan allowlist gap that would have failed
CI) and several medium (provider-side reconciliation, missing ledger indexes, an expensive metrics
query, heading structure, missing resilience tests). Details and the requirement-by-requirement
table: [implementation-progress.md](implementation-progress.md) ("Phase 5 audit"). The
recommendation is unchanged.

## Known limitations

See [known-limitations.md](known-limitations.md) and [compliance-india.md](compliance-india.md).
The main items:

- the external accounts and approvals listed above;
- a review of the Hindi translations by a native speaker;
- a manual screen-reader audit;
- load and restore testing on production-sized infrastructure;
- no SMS or push notifications;
- full server-side rendering of page bodies is not implemented: public pages get server-generated
  metadata and a crawlable summary instead.
