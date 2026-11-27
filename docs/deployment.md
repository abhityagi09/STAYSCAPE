# Deployment

## Target architecture

```
                 Internet (HTTPS only)
                        │
             TLS load balancer / CDN ── caches /assets/* (immutable, 1 year)
                        │  HTTP, private network
        ┌───────────────▼────────────────┐
        │ web  (nginx-unprivileged:8080) │  SPA, SSI SEO metadata, /api proxy,
        │ read-only, non-root, no caps   │  /metrics blocked at the edge
        └───────────────┬────────────────┘
          edge network  │  backend network (internal: no route to the internet)
        ┌───────────────▼────────────────┐        ┌──────────────────────┐
        │ api × N  (node:22, uid 1000)   │◄──────►│ worker (same image)  │
        │ RUN_WORKERS=false              │        │ BullMQ consumers +   │
        └───────┬───────────────┬────────┘        │ scheduled jobs       │
                │               │                 └──────────┬───────────┘
      ┌─────────▼───┐   ┌───────▼─────┐   egress network     │
      │ MongoDB     │   │ Redis       │   (SMTP, Razorpay,   │
      │ Atlas RS    │   │ managed     │    ECB, Claude API)  │
      └─────────────┘   └─────────────┘   S3 media buckets ◄─┘
```

Recommended hosting: any Docker host or orchestrator (AWS ECS/Fargate, a VM with Compose,
Kubernetes) in **ap-south-1 (Mumbai)** for latency and Indian data-residency preferences, with:

- **MongoDB Atlas** (M10+ replica set, private endpoint / VPC peering, continuous backups with
  point-in-time restore) — the API requires transactions;
- **managed Redis** (ElastiCache/Upstash/Redis Cloud, TLS, `noeviction`, private network);
- **S3** (public bucket for listing media behind a CDN, private bucket for verification
  documents, versioning on both);
- a **TLS load balancer** (ALB/Cloud Load Balancer/Caddy) terminating HTTPS with HSTS, forwarding
  to the web container's private interface (`WEB_BIND`).

MongoDB and Redis must never be publicly reachable. In `docker-compose.prod.yml` they exist only
in the `self-hosted` profile (staging), on an `internal` network with no published ports.

## Release process (CI/CD)

`.github/workflows/ci.yml` stages on every push to `main`/`master`:

1. **verify** — install, lint, format, typecheck, i18n and env-doc checks, unit + integration
   tests (MongoDB replica set, Redis), builds;
2. **security** — `npm audit --audit-level=high`, gitleaks over the full history;
3. **images** — build API and web images tagged `sha-<commit>`, Trivy scan (fail on fixable
   critical), push to GHCR;
4. **staging-e2e** — start the exact images in production mode, migrate, seed fictional data,
   smoke test, full Playwright suite (functional, responsive, accessibility, Web Vitals),
   backup + restore drill, k6 smoke;
5. **deploy-staging** — environment `staging` (its own secrets), `scripts/deploy/deploy.sh`,
   smoke test;
6. **deploy-production** — environment `production`: **configure required reviewers** so the job
   waits for manual approval; same script with production secrets; smoke test.

Environment-specific secrets live in GitHub environments (`DEPLOY_SSH_KEY`, `DEPLOY_HOST`) and
on the hosts (`.env.staging`, `.env.production` from the secret manager). Production credentials
are never available to pull-request builds.

## Deploying a release

```sh
sh scripts/deploy/deploy.sh .env.production sha-<commit> https://www.example.com
```

The script pulls the images, runs the **release task** (versioned migrations, then index
synchronisation), starts `API_REPLICAS` (default 3) API replicas, the worker and web with
health-check waits, and runs `scripts/deploy/smoke.sh`. If the smoke test fails it rolls back
to the previously running tag automatically.

### Rollback

```sh
sh scripts/deploy/deploy.sh .env.production "$(cat .deploy/previous-tag)" https://www.example.com
```

Migrations are **expand/contract** (docs/database.md "Migrations"): a release only adds fields
or collections that the previous release ignores, so rolling back never needs a
down-migration. Destructive "contract" steps ship one release later, after the rollback window.
Data restores are a separate decision (docs/backup-recovery.md).

## First administrator (production)

Never seed fictional data or create default credentials in production — the seed and the
development bootstrap refuse to run there. Create the first super administrator once:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm \
  -e ADMIN_BOOTSTRAP_CONFIRM=create-first-super-admin \
  -e ADMIN_BOOTSTRAP_EMAIL=ops@example.com \
  -e ADMIN_BOOTSTRAP_PASSWORD='<from the secret manager>' \
  api node dist/scripts/bootstrap-first-admin.js
```

It refuses if any super administrator exists, never promotes an existing account, never prints
the password and writes an audit entry. Further administrators are invited in the product.

## Capacity

Measured on staging (docs/testing.md): one API replica with 1 vCPU sustains ≈ 30–40 req/s of
the realistic mix before CPU throttling; three replicas met the latency budgets at 84 req/s and
degraded gracefully (no errors) at 90 req/s. Start production with **3 API replicas × 1 vCPU /
768 MiB**, one worker, and autoscale API replicas on CPU > 60 % or p95 > 1 s. MongoDB was the
next bottleneck in the test (peaks of 100 % of one core): size Atlas at M30+ before marketing
launches and watch `stayscape_http_request_duration_seconds`.

## Graceful shutdown

Containers receive SIGTERM (`init: true`, `stop_grace_period: 30s`); the API stops accepting
connections and finishes in-flight requests, workers finish the current job, and connections to
MongoDB and Redis are closed (`apps/api/src/bootstrap.ts`). BullMQ re-queues anything left
active, and every job is idempotent.

## Logs

All containers log JSON to stdout (pino for the API with request ids; nginx `json` access log).
The Docker `json-file` driver rotates locally (20 MB × 5); point the host's log agent
(CloudWatch, Datadog, Loki, …) at the container logs, or switch the logging driver
(`awslogs`, `fluentd`) in `docker-compose.prod.yml`. Capability tokens are redacted from logged
URLs; request bodies, cookies and authorization headers are never logged.
