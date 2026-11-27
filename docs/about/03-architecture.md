# 3. Architecture — how the pieces fit together

**Architecture** means the big-picture structure: which parts exist, what each is responsible for,
and how they talk. Good architecture makes a system easy to change, test and run.

## 3.1 The big picture

```
            Traveller / Partner / Admin  (browser)
                         │  HTTPS
                ┌────────▼─────────┐
                │      nginx       │  serves the website files, forwards /api,
                │ (front door)     │  adds security headers, SEO metadata
                └────────┬─────────┘
                         │
      ┌──────────────────▼───────────────────┐        ┌──────────────────────┐
      │        API server(s)  (Node.js)      │        │  Worker (Node.js)    │
      │  routes → permissions → validation   │        │  queues + scheduled  │
      │  → services (business rules)         │        │  jobs (expire holds, │
      │  → database models                   │        │  emails, reconcile)  │
      └───────┬──────────────────┬───────────┘        └─────────┬────────────┘
              │                  │                              │
        ┌─────▼─────┐      ┌─────▼─────┐                        │
        │ MongoDB   │      │  Redis    │◄───────────────────────┘
        │ (records) │      │ (queues,  │
        └───────────┘      │  cache,   │       External: Razorpay (payments),
                           │  limits)  │       SMTP (email), S3 (files),
                           └───────────┘       ECB (currency), Anthropic (AI)
```

## 3.2 A monorepo with workspaces

A **repository** ("repo") is the folder of code tracked by **git** (version control: every change is
recorded, can be reviewed and undone). A **monorepo** keeps several related projects in one repo:

```
STAYSCAPE/
├── apps/web          the React website
├── apps/api          the Node.js API and worker
├── packages/shared   code used by BOTH (types, validation rules, permissions, money helpers)
├── packages/config   shared settings for TypeScript, linting and formatting
├── infrastructure/   Dockerfiles, nginx, backups, monitoring
├── tests/e2e         browser tests        tests/load   load tests
└── docs/             documentation
```

**npm workspaces** link these together. The biggest win is `packages/shared`: the rule "a check-out
date must be after check-in" is written **once** (as a Zod schema) and used by the browser (to show
an error instantly) and by the server (to reject bad data). The permission matrix is also shared,
so the UI hides buttons you cannot use while the server still enforces the rule.

## 3.3 Modular monolith — and why not microservices

There are two broad ways to build a backend:

- **Microservices** — many small separate programs (bookings service, payments service…) talking
  over the network. Pros: teams and services scale independently. Cons: network failures between
  services, distributed transactions are very hard, much more infrastructure.
- **Monolith** — one program. A **modular monolith** is one program divided into clear modules with
  boundaries.

STAYSCAPE is a **modular monolith**. Booking a room touches inventory, payments, the ledger and
notifications; doing that safely in _one database transaction_ is simple in a monolith and very hard
across microservices. Modules (`bookings`, `payments`, `finance`, `partners`, …) are separated so
one could be extracted later if there is a real need. In interviews this shows you chose the
simplest thing that meets the requirements — a mark of seniority.

It still scales: you run **several copies** of the API behind nginx (horizontal scaling) and a
separate worker process, which the load tests verified (chapter 11).

## 3.4 Layers inside the API

Each request passes through layers, each with one job (this is **separation of concerns**):

```
Router        "POST /bookings/holds goes to the holds handler"
  ↓
Middleware    request id → metrics → logging → security headers → CORS → rate limit
              → body size limit → authenticate (who are you?) → requirePermission (may you?)
  ↓
Validation    the body/query/params must match a strict schema (unknown fields rejected)
  ↓
Controller    thin: reads the request, calls a service, sends the response
  ↓
Service       the business rules: transactions, idempotency, ownership checks, pricing
  ↓
Model/Repo    talks to MongoDB through Mongoose
  ↓
Mapper (DTO)  turns database records into safe response shapes (no password hashes, no secrets)
```

**DTO** (Data Transfer Object) means "the exact shape we send out". Mapping to DTOs on purpose is
why internal fields never leak.

## 3.5 Dependency injection — the "container"

All services are created in one place (`apps/api/src/container.ts`) and handed what they need
(`new PrivacyService({ audit, hasher, sessions, storage, logger })`). This is **dependency
injection**. Why? In tests we can hand in a fake email sender or an in-memory job queue, and in
production the real ones — without changing the services. It also makes the wiring visible in one
file.

## 3.6 Configuration and the twelve-factor idea

Settings (database address, secrets, feature switches) come from **environment variables**, not
from code. The same built program runs in development, staging and production with different
settings. On start-up the API **validates every setting** and refuses to start with unsafe ones
(e.g. a development secret or the test payment gateway in production). There are 95 settings,
documented automatically in `docs/environment.md`.

This follows the **twelve-factor app** guidelines: config in the environment, stateless processes,
logs to standard output, separate build/release/run stages.

## 3.7 Environments

| Environment             | Purpose                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **Local / development** | A developer's machine; fake email (Mailpit), test payment gateway, fictional seed data |
| **Test**                | Automated tests with an in-memory database                                             |
| **Staging**             | A copy of production setup to test releases safely; fictional data; test payments      |
| **Production**          | The real thing with real customers, money and data                                     |

STAYSCAPE has a special `DEPLOYMENT_ENV=staging` that keeps every production safety rule except
that it allows the labelled test gateway.

## 3.8 Important cross-cutting pieces

| Concern       | Where                           | What it does                                                                                         |
| ------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Request IDs   | middleware                      | Every request gets an id that appears in logs and error responses, so a support ticket can be traced |
| Audit log     | `modules/audit`                 | Who did what, when, from where — for every sensitive action                                          |
| Outbox        | `modules/outbox`                | Guarantees emails/events are sent if and only if the database change happened                        |
| Metrics       | `lib/metrics.ts`                | Numbers for monitoring (latency, errors, queue sizes, money problems)                                |
| Caching       | `catalog/cache.service.ts`      | Short-lived copies of public data in Redis                                                           |
| Health checks | `/health/live`, `/health/ready` | Lets the infrastructure know if a copy of the API is alive and ready                                 |

## Say it in an interview

**"Describe the architecture."** — _"A TypeScript monorepo: React SPA, an Express API and a shared
package for types, Zod schemas and the permission matrix. The API is a modular monolith — modules
for bookings, payments, finance, partners and so on — with a layered request pipeline:
authentication, permission middleware, strict validation, thin controllers, services that own the
business rules and transactions, and DTO mappers. MongoDB is the system of record, Redis backs rate
limiting, caching and BullMQ job queues, and a separate worker runs background jobs. nginx serves
the SPA and proxies the API on the same origin."_

**"Why not microservices?"** — _"Booking needs inventory, payment, ledger and notification changes
to succeed or fail together. In one process that's a single MongoDB transaction; across services
it's sagas and compensation. The modules are separated so extraction is possible later, and I scale
horizontally by running multiple API replicas."_

**"Why share code between frontend and backend?"** — _"One source of truth. The same Zod schema
validates in the browser for instant feedback and on the server for safety, and the same
permission matrix drives both UI and enforcement, so they cannot drift apart."_
