# Monitoring, alerting and incident response

## Signals

| Signal                                   | Source                                                                                                                                                                      | Where                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Structured logs with request correlation | pino (API) and nginx JSON access logs; `X-Request-Id` is accepted from the edge (validated) or generated, returned to clients and logged on every line                      | container stdout → log platform                  |
| Error tracking                           | `level ≥ 50` (error) log events carry the request id, route and error code; 5xx are counted in `stayscape_http_server_errors_total`                                         | log platform alerts + Prometheus                 |
| API latency                              | `stayscape_http_request_duration_seconds{method,route,status}` (route templates, never raw URLs)                                                                            | Prometheus                                       |
| Node.js runtime                          | `stayscape_nodejs_eventloop_lag_*`, heap, GC, CPU (`prom-client` defaults)                                                                                                  | Prometheus                                       |
| Dependencies                             | `stayscape_mongo_up`, `stayscape_redis_up`; `/health/ready` (503 without internals when a dependency is down)                                                               | Prometheus, load balancer health check           |
| Queues                                   | `stayscape_queue_jobs{queue,state}` (waiting/active/delayed/failed)                                                                                                         | Prometheus; Admin → Operations → Background jobs |
| Payments                                 | `stayscape_payments_failed_last_hour`, `stayscape_payment_webhooks_failed`, `stayscape_bookings_payment_processing_stale`                                                   | Prometheus                                       |
| Reconciliation                           | `stayscape_bookings_reconciliation_required`, `stayscape_refunds_failed`, `stayscape_outbox_failed`; the reconciliation report (`GET /api/v1/admin/finance/reconciliation`) | Prometheus, Admin → Finance                      |
| Inventory integrity                      | `stayscape_inventory_invariant_violations` (held + booked + blocked > total; must be 0), `stayscape_holds_overdue`                                                          | Prometheus                                       |
| Database performance                     | Atlas Performance Advisor / profiler (slow queries > 100 ms), connection count, replication lag                                                                             | Atlas monitoring                                 |
| Infrastructure                           | container CPU/memory/restarts, disk, TLS expiry                                                                                                                             | host/orchestrator monitoring                     |

`GET /metrics` is enabled only when `METRICS_TOKEN` is set, requires `Authorization: Bearer
<token>`, and is blocked at the public edge (nginx returns 404). Scrape each API replica on the
private network: `infrastructure/monitoring/prometheus.yml`.

## Alerts

`infrastructure/monitoring/alerts.yml` (16 rules, validated with `promtool check rules`).

| Alert                        | Condition                                   | Severity | Owner            |
| ---------------------------- | ------------------------------------------- | -------- | ---------------- |
| ApiDown                      | scrape fails 2 min                          | page     | platform on-call |
| DatabaseUnavailable          | `stayscape_mongo_up < 1` for 1 min          | page     | platform on-call |
| RedisUnavailable             | `stayscape_redis_up < 1` for 2 min          | page     | platform on-call |
| HighServerErrorRate          | 5xx > 2 % of requests for 5 min             | page     | platform on-call |
| HighLatency                  | p95 > 1.5 s for 10 min                      | ticket   | platform on-call |
| EventLoopBlocked             | event-loop p99 > 500 ms for 5 min           | ticket   | platform on-call |
| PaymentWebhookFailures       | any failed verified webhook for 10 min      | page     | payments on-call |
| PaymentFailureSpike          | > 20 failed payments/hour for 15 min        | ticket   | payments on-call |
| BookingReconciliationBacklog | reconciliation-required bookings for 30 min | ticket   | payments on-call |
| StalePaymentProcessing       | bookings in PAYMENT_PROCESSING > 30 min     | ticket   | payments on-call |
| RefundFailures               | failed refunds for 30 min                   | ticket   | payments on-call |
| InventoryInvariantViolated   | any violation for 1 min                     | page     | platform on-call |
| HoldsNotExpiring             | overdue active holds for 10 min             | ticket   | platform on-call |
| FailedBackgroundJobs         | dead-lettered jobs on any queue for 15 min  | ticket   | platform on-call |
| QueueBacklog                 | > 500 waiting jobs for 15 min               | ticket   | platform on-call |
| OutboxEventsFailed           | failed domain events for 15 min             | ticket   | platform on-call |

_page_ = immediate response 24/7; _ticket_ = next business hours. Route alerts with
Alertmanager (or Grafana Cloud/Datadog) to the on-call rota. Owners are roles; assign people in
the on-call tool.

## Runbooks

### API down

Check the orchestrator for restarts (`docker compose ps`, container logs). A crash loop with
`Invalid environment configuration` means a bad deploy of variables: roll back (docs/deployment.md).
Otherwise scale replicas, then investigate.

### Database unavailable

Check Atlas status and network peering. The API answers 503 on `/health/ready`; bookings cannot
be created (safe: nothing is half-written because every write is transactional). Do not restart
the API in a loop; it reconnects automatically.

### Redis unavailable

Rate limiting and caches degrade; background jobs stop. Holds still expire via the next worker
run once Redis returns (jobs are idempotent and rescheduled).

### High error rate / high latency

Filter logs by `level>=50` and the request id; compare with the deploy time. If it started with a
deploy, roll back. For latency, check `stayscape_nodejs_eventloop_lag_p99_seconds` (CPU → scale
API replicas) and Atlas slow queries (→ index).

### Payment webhook failures

Admin → Operations lists webhook events with failure reasons. Most causes are transient
(database blip); payments are also reconciled by the scheduled job, so no captured payment is
lost. Persistent signature failures mean a rotated `RAZORPAY_WEBHOOK_SECRET` mismatch.

### Reconciliation backlog

Admin → Operations shows each booking with its payment and note. Typical cause: a payment
arrived after its hold expired and the rooms were sold; the system has already started a full
refund. Confirm the refund status; contact the guest.

### Jobs

Admin → Operations → Background jobs lists counts and dead-lettered jobs (failed after five
exponential retries; kept 7 days) without payloads. Fix the cause, then **Retry** (audited,
`system:configure`). Every job is idempotent, so a retry never duplicates emails, refunds or
ledger entries.

## Incident response

1. **Declare** in the incident channel; the first responder is incident lead until handed over.
2. **Stabilise**: roll back the last deploy if correlated; scale; fail over to a read-only notice
   by disabling checkout if payments are at risk.
3. **Communicate**: status page/customer support macro within 30 minutes for customer-facing
   impact; partners notified for booking-affecting incidents.
4. **Money and data first**: run the reconciliation report after any payment, refund or
   database incident; any correction is an auditable adjustment, never an edit of history.
5. **Personal-data breach**: follow docs/security.md ("Breach response") — the Data Protection
   Board of India and affected people must be notified as the DPDP rules require; involve legal.
6. **Review**: blameless post-incident review within five working days with actions and owners.
