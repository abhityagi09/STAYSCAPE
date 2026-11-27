# Understanding STAYSCAPE — a complete guide

This folder explains **everything about STAYSCAPE** — what it is, how it is built, why each decision
was made and how to talk about it in an interview. It assumes **no technical background**: every
idea is introduced from scratch with an everyday comparison before the technical detail.

## How to read this guide

Read the chapters in order the first time. Each one builds on the previous one. Every chapter ends
with **"Say it in an interview"** — short, confident answers to the questions you are likely to be
asked.

| #   | Chapter                                                                  | What you will understand                                                                  |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| 1   | [What STAYSCAPE is](01-what-is-stayscape.md)                             | The product, who uses it, and every journey through it                                    |
| 2   | [How the web works](02-how-the-web-works.md)                             | Browsers, servers, the internet, HTTP, APIs, JSON — the foundations                       |
| 3   | [Architecture](03-architecture.md)                                       | How the pieces of STAYSCAPE fit together and why                                          |
| 4   | [Technology stack](04-technology-stack.md)                               | Every tool used, what it does, why it was chosen, what the alternatives were              |
| 5   | [Data and the database](05-data-and-database.md)                         | How information is stored: MongoDB, documents, indexes, transactions, money and dates     |
| 6   | [Security and sign-in](06-security-and-authentication.md)                | Passwords, tokens, cookies, permissions and the common attacks we defend against          |
| 7   | [The booking engine](07-booking-engine.md)                               | Inventory, holds, race conditions, idempotency, pricing, state machines                   |
| 8   | [Payments and money](08-payments-and-money.md)                           | Payment gateways, webhooks, refunds, the ledger, commissions, settlements, reconciliation |
| 9   | [The frontend](09-frontend.md)                                           | React, single-page apps, state, routing, accessibility, languages, speed, SEO             |
| 10  | [Background work and reliability](10-background-jobs-and-reliability.md) | Queues, retries, the outbox pattern, scheduled jobs, monitoring, backups                  |
| 11  | [Testing and quality](11-testing-and-quality.md)                         | Unit, integration, end-to-end and load tests; continuous integration                      |
| 12  | [Deployment and operations](12-deployment-and-operations.md)             | Docker, nginx, environments, scaling, CI/CD, incidents                                    |
| 13  | [The AI travel assistant](13-ai-assistant.md)                            | How a large language model is used safely without inventing facts                         |
| 14  | [Interview playbook](14-interview-playbook.md)                           | How to present the project; 60+ questions with model answers                              |
| 15  | [Glossary](15-glossary.md)                                               | Every technical word used in this project, in plain English                               |

## The project in one paragraph

STAYSCAPE is a **hotel marketplace** — like a small Booking.com or MakeMyTrip built for India.
**Travellers** search for stays, compare them, book a room and pay online. **Hotel partners**
(owners and their staff) list their properties, set prices and room availability, and manage
arriving guests. **Administrators** (the STAYSCAPE team) check that partners are genuine, approve
listings, handle refunds, pay partners their share and keep the money accurate. It is built as a
**website** (what people see in the browser) and an **API server** (the "kitchen" that does the
work and keeps the data), backed by a **database** (MongoDB), a fast memory store (**Redis**) and
**background workers** that send emails and do scheduled jobs.

## The numbers worth remembering

| Fact                        | Value                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Business modules in the API | 35+ (bookings, payments, finance, partners, …)                                                                            |
| API endpoints (routes)      | 300                                                                                                                       |
| User roles                  | 7 (guest, customer, hotel owner, hotel staff, support, admin, super admin)                                                |
| Automated tests             | 335 unit/integration + 28 browser end-to-end + 1 thirty-step acceptance flow                                              |
| Languages                   | English and Hindi (1,950 interface texts translated)                                                                      |
| Hold time while paying      | 10 minutes                                                                                                                |
| Load test result            | 84 requests per second with three API servers, all speed targets met except autocomplete (309 ms against a 300 ms target) |
| Release status              | Ready for staging; production pilot needs payment-provider keys, hosting and legal review                                 |
