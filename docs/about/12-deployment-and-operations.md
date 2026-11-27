# 12. Deployment and operations — running STAYSCAPE for real

## 12.1 Containers and Docker

"It works on my machine" is a classic problem: different computers have different versions of
everything. **Docker** solves it by packaging an application with everything it needs (the exact
Node.js version, libraries, files) into an **image** — like a shipping container with a standard
shape. A running copy of an image is a **container**. The same image runs identically on a laptop,
a test server and production.

STAYSCAPE builds two images:

| Image | Built from                     | Contains                                            |
| ----- | ------------------------------ | --------------------------------------------------- |
| `api` | Node.js 22 on Alpine Linux     | The compiled API, worker and scripts                |
| `web` | nginx (unprivileged) on Alpine | The built website files and the nginx configuration |

**Multi-stage builds:** a first stage has all build tools and compiles the code; the final stage
copies only the result, so the shipped image is small and contains no compilers or source code.

**Security hardening of containers:**

- run as a **non-root user** (uid 1000 for the API, 101 for nginx) — if broken into, the attacker
  is not "admin" of the container;
- **read-only filesystem** (only `/tmp` and data volumes are writable);
- **all Linux capabilities dropped** and "no new privileges";
- OS packages upgraded at build time; npm removed from the runtime image (nothing to install
  malware with); scanned with **Trivy** (no fixable high/critical vulnerabilities);
- **health checks** so the platform restarts broken containers;
- **resource limits** (CPU and memory) so one service can't starve the others.

**Docker Compose** describes several containers and how they connect. STAYSCAPE has:

- `docker-compose.yml` — local development stack (MongoDB, Redis, Mailpit, API, web);
- `docker-compose.prod.yml` — production/staging: API (several replicas), worker, web, a one-off
  **release** task, backup and restore-drill tasks, and a `self-hosted` profile with private
  MongoDB/Redis/Mailpit for staging.

## 12.2 Networking: keeping databases private

Containers sit on virtual networks:

- `backend` — **internal**: no route to or from the internet. MongoDB and Redis live only here and
  publish **no ports**. Only the API and worker can reach them.
- `egress` — lets the API and worker reach outside services (payment gateway, email, AI).
- `edge` — the web container, the only thing exposed, bound to the private address the load
  balancer forwards to.

## 12.3 nginx — the front door

**nginx** is a fast web server. In STAYSCAPE it:

- serves the built website files, with long caching for hashed asset files;
- acts as a **reverse proxy**: requests to `/api/…` are forwarded to the API. Because the site and
  API share the **same origin**, the strict `SameSite` cookie works and there is no CORS complexity;
- adds **security headers** (CSP, frame denial, referrer policy, permissions policy);
- injects SEO metadata with server-side includes (chapter 9), with a 5-minute cache;
- blocks `/metrics` from the public;
- writes JSON access logs with the request id;
- serves `.mjs` files as JavaScript (a bug found in testing: the map worker failed because nginx
  served it with the wrong file type).

In production a **TLS load balancer** (or CDN) in front handles HTTPS certificates and forwards to
nginx.

## 12.4 Environments and configuration

| Environment | Who uses it      | Data           | Payments           |
| ----------- | ---------------- | -------------- | ------------------ |
| Local       | Developers       | Fictional seed | Sandbox            |
| Staging     | Testing releases | Fictional seed | Sandbox (labelled) |
| Production  | Real customers   | Real           | Razorpay live      |

Configuration comes from environment variables (95 of them, documented automatically). Secrets
(signing keys, passwords) come from a **secret manager**, never from git. The app validates its
configuration at start-up and refuses unsafe production settings.

## 12.5 Scaling

- **Vertical scaling** — a bigger machine. Limited and expensive.
- **Horizontal scaling** — more copies behind a load balancer. STAYSCAPE's API is **stateless**
  (sessions are in the database, caches in Redis), so any copy can serve any request. nginx spreads
  requests across copies. The load test showed 1 copy ≈ 40 req/s and 3 copies ≈ 84 req/s with all
  budgets met. Recommendation: start production with 3 API copies, 1 worker, and autoscale on CPU
  > 60 % or p95 > 1 s.
- **Caching** — store repeated answers. Public data (destinations, hotel details, plain searches)
  is cached in Redis for up to 60 seconds and invalidated when listings change; priced searches at
  most 15 seconds; bookings and payments are never cached.
- **Database** — managed MongoDB Atlas, sized up as traffic grows; indexes on every hot query.

## 12.6 The release process

1. A developer pushes code → the CI pipeline runs every check.
2. Images are built once, tagged with the commit id (**immutable**: the same tag always means the
   same code) and scanned.
3. The exact images run on a production-mode staging stack with the full test suite.
4. Deploy to staging, smoke test.
5. A reviewer approves → deploy to production:
   - pull images,
   - run the **release task** (versioned database migrations, then index synchronisation),
   - start the new containers and wait for health checks,
   - run the **smoke test** (key pages, APIs, security headers, private APIs refuse anonymous
     access, `/metrics` not public),
   - if the smoke test fails → **automatic rollback** to the previous version.

**Rollback** is safe because database migrations are _expand-then-contract_ (old code still works
with the new data shape).

**First administrator in production:** a dedicated one-time script that requires a confirmation
phrase, refuses if any super admin exists, never promotes existing accounts, never prints the
password and writes an audit record. Fictional seed data can never run in production.

## 12.7 Operating the system day to day

- **Daily checklist** for admins: operations page empty (no reconciliation-required bookings,
  failed refunds, failed deliveries, dead-lettered jobs); reconciliation report clean; pending
  partner applications; support queue.
- **Incident response:** declare, stabilise (often roll back the last deploy), communicate,
  check money and data first (run reconciliation), notify regulators if personal data was breached
  (India's DPDP Act; CERT-In within 6 hours for reportable incidents), and hold a blameless review.

## 12.8 What production still needs

A hosting account, domain and TLS certificate, MongoDB Atlas, managed Redis, S3 buckets, an email
provider with SPF/DKIM/DMARC, Razorpay KYC and keys, GitHub environments with reviewers and
secrets, and the legal/tax review. That is why the release recommendation is **ready for staging**,
not yet production.

## Say it in an interview

**"How is it deployed?"** — _"Two hardened images — a Node API/worker and unprivileged nginx — run
with Docker Compose or any orchestrator. Databases are managed services on a private network. CI
builds immutable images per commit, scans them, runs the full suite against them in production
mode, deploys to staging, and production waits for approval. Deploys run versioned migrations, a
health-checked rollout and a smoke test with automatic rollback."_

**"How does it scale?"** — _"The API is stateless, so I scale horizontally behind nginx; I measured
roughly linear gains from one to three replicas. Public reads are cached in Redis with explicit
invalidation; transactional data is never cached. The worker scales separately."_

**"Why non-root, read-only containers?"** — _"Least privilege: if a container is compromised, the
attacker can't modify the image, install tools or act as root."_
