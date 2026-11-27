# 10. Background work and reliability

## 10.1 Why background jobs

Some work should not happen while the user waits:

- **slow** — sending an email, generating a PDF invoice, processing an image;
- **unreliable** — the email provider may be down for a minute;
- **scheduled** — expire holds every 30 seconds, complete finished stays every hour.

These run as **jobs** on a **queue**: a to-do list kept in Redis. The API adds jobs; a separate
**worker** process takes them one by one and does them. If the worker is busy or restarting, jobs
wait safely in the queue. STAYSCAPE uses **BullMQ** for this.

## 10.2 Retries, back-off and dead letters

If a job fails (email server down), it is **retried** — up to 5 times with **exponential back-off**
(waiting roughly 2 s, 4 s, 8 s, 16 s…), which avoids hammering a struggling service. If it still
fails after all attempts, it becomes a **dead letter**: kept for 7 days, counted by monitoring,
shown in Admin → Operations → Background jobs with its error, and retryable by a super
administrator (the retry is audited). Job payloads are never shown there because they can contain
one-time links.

**Critical rule: every job is idempotent**, so retrying never sends two confirmation emails, posts
two ledger entries or refunds twice. Jobs can also be given an id; adding the same id twice is
ignored (de-duplication).

## 10.3 The transactional outbox pattern

A subtle problem: "save the booking, then send the email". What if the booking saves but the server
crashes before queueing the email? Or the email is queued but the booking transaction rolls back?

The **outbox pattern** solves it: inside the **same database transaction** as the booking change, an
"outbox event" record is written ("send confirmation for booking X"). Either both are saved or
neither is. A dispatcher job (every 10 seconds) reads pending outbox events and delivers them, with
retries. A **delivery log** prevents duplicates. So emails are sent **if and only if** the change
really happened — tested by simulating an SMTP failure and retrying.

## 10.4 The scheduled jobs

| Job                    | Every | Purpose                                                               |
| ---------------------- | ----- | --------------------------------------------------------------------- |
| Expire holds           | 30 s  | Release rooms from unpaid holds                                       |
| Outbox dispatch        | 10 s  | Deliver emails, invoices, refund events                               |
| Payment reconciliation | 2 min | Ask the gateway about payments/refunds still pending                  |
| Channel sync           | 5 min | Sync availability with channel managers                               |
| Complete stays         | 1 h   | Mark finished stays completed (unlocks reviews, rewards, settlements) |
| Check-in reminders     | 1 h   | Remind upcoming guests (respecting preferences)                       |
| Finance backfill       | 1 h   | Post ledger entries for any confirmed booking missing them            |
| Price alerts           | 1 h   | Notify watchers of new price lows (once per new low, at most daily)   |
| Rewards accrual        | 1 h   | Award loyalty points for completed stays                              |
| Media cleanup          | 1 h   | Delete uploaded files nobody uses                                     |
| Price observation      | 6 h   | Record prices for price history                                       |
| Currency refresh       | 6 h   | Fetch official exchange rates                                         |

Each job processes items one by one inside its own error handler, so one bad record can't stop a
whole run. Scheduled content publishing needs no job: a guide's state (draft, scheduled, live,
expired) is computed from its publish and unpublish times whenever it is read.

## 10.5 Monitoring — knowing something is wrong before customers tell you

Three pillars of **observability**:

1. **Logs** — a written record of events. STAYSCAPE writes **structured JSON logs** (searchable
   fields, not free text) with a **request id** on every line. The same id is returned to the
   client in errors, so a support ticket ("error, request id b7f0…") can be traced instantly.
2. **Metrics** — numbers over time, exposed at `/metrics` for **Prometheus**: request latency by
   route, error counts, event-loop lag, database and Redis health, queue sizes, failed payments,
   reconciliation backlog, overdue holds, failed refunds, failed webhooks, and the inventory
   invariant (must be 0). The endpoint needs a secret token and is blocked from the public internet.
3. **Alerts** — rules that notify a person. 16 rules, for example: API down, database unavailable,
   5xx rate above 2 %, p95 latency above 1.5 s, webhook failures, inventory invariant violated,
   dead-lettered jobs, queue backlog. _Page_ alerts wake someone up; _ticket_ alerts wait for working
   hours. Each has a runbook (what to check, what to do).

**p95 latency** means 95 % of requests are faster than this number — a better measure than the
average, because averages hide slow outliers.

**Health checks**: `/health/live` ("the process is running") and `/health/ready` ("it can reach the
database and Redis"). Load balancers stop sending traffic to a copy that isn't ready.

## 10.6 Backups and disaster recovery

Two key terms:

- **RPO (Recovery Point Objective)** — how much data you can afford to lose (how old the last
  backup may be).
- **RTO (Recovery Time Objective)** — how long it may take to be back up.

STAYSCAPE's plan:

| Layer                           | Method                                                                                                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary                         | MongoDB Atlas continuous backup with point-in-time restore — RPO ≤ 5 minutes                                                                                                                                                 |
| Secondary, provider-independent | Nightly encrypted dump: `mongodump` with the oplog (a consistent snapshot even while data changes), encrypted with AES-256, a checksum, and a manifest recording every collection's document count and the total ledger cash |
| Media                           | S3 versioning and replication (local stacks: encrypted archive of the upload volumes)                                                                                                                                        |
| Config                          | Images are immutable versions; settings in git; secrets in the secret manager                                                                                                                                                |

**A backup you have never restored is only a hope.** The **restore drill** restores the newest
backup into a separate scratch database, verifies the checksum, compares every collection's count and
the ledger cash total with the manifest, then deletes the scratch copy. It passed on staging
(66 collections, 0 mismatches). A wrong passphrase and a corrupted file were both correctly rejected.
Restoring over the live database requires an explicit confirmation phrase.

## 10.7 Graceful shutdown

When a new version is deployed, old containers receive a "please stop" signal (SIGTERM). The API stops
accepting new connections, finishes requests in progress, closes database connections and exits;
workers finish their current job. Anything interrupted is retried later because jobs are idempotent.
Customers don't see errors during deployments.

## Say it in an interview

**"How do you make sure emails are sent exactly when a booking is saved?"** — _"Transactional
outbox: the event row is written in the same MongoDB transaction as the booking change, a
dispatcher delivers it with retries, and a delivery log prevents duplicates."_

**"What happens when a job keeps failing?"** — _"Five attempts with exponential back-off, then it
stays as a dead letter for seven days. A metric and an alert fire; operators see it in the admin
console and can retry it after fixing the cause. Jobs are idempotent, so a retry is always safe."_

**"How do you know your backups work?"** — _"An automated restore drill restores into a scratch
database and compares document counts and a financial checksum against a manifest written at backup
time. It runs in CI and monthly in production."_
