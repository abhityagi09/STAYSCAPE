# 15. Glossary — every term in plain English

| Term                           | Plain-English meaning                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| **Access token**               | A short-lived (15-minute) signed pass proving who you are on each request           |
| **ACID**                       | Guarantees of a reliable transaction: Atomic, Consistent, Isolated, Durable         |
| **Adapter pattern**            | Wrapping different services (sandbox vs Razorpay) behind one common interface       |
| **Aggregation pipeline**       | A sequence of database steps (filter, group, sum) for reports                       |
| **Alert**                      | An automatic notification when a metric crosses a threshold                         |
| **API**                        | The menu of requests a server accepts                                               |
| **Argon2id**                   | A slow, memory-hard password-hashing algorithm                                      |
| **Atomic operation**           | One that happens completely or not at all, with nothing in between                  |
| **Audit log**                  | A permanent record of who did what and when                                         |
| **Authentication**             | Proving who you are                                                                 |
| **Authorisation**              | Deciding what you're allowed to do                                                  |
| **axe**                        | A tool that automatically checks web pages for accessibility problems               |
| **Back-off (exponential)**     | Waiting longer between each retry (2 s, 4 s, 8 s…)                                  |
| **Backend**                    | The server side: business rules, data, money                                        |
| **Basis point**                | One hundredth of a percent (100 bp = 1 %)                                           |
| **BOLA / IDOR**                | A flaw letting users access others' records by changing an id                       |
| **BullMQ**                     | A job-queue library built on Redis                                                  |
| **Cache**                      | A short-term copy of data to answer repeated questions faster                       |
| **Canonical URL**              | The single official address of a page, for search engines                           |
| **CERT-In**                    | India's cyber-security agency; some incidents must be reported within 6 hours       |
| **CI/CD**                      | Automatically testing (CI) and releasing (CD) every change                          |
| **CLS**                        | Cumulative Layout Shift — how much a page jumps while loading                       |
| **Code splitting**             | Breaking the website into files downloaded only when needed                         |
| **Commission**                 | The marketplace's percentage of each booking                                        |
| **Component**                  | A reusable piece of the interface (a button, a card)                                |
| **Concurrency**                | Several things happening at the same time                                           |
| **Container**                  | A running packaged application (from a Docker image)                                |
| **Cookie**                     | Small data a website stores in the browser and receives back automatically          |
| **CORS**                       | Rules about which other websites may call an API                                    |
| **CSP**                        | Content Security Policy — tells the browser which scripts and resources are allowed |
| **CSRF**                       | An attack tricking your browser into sending a request you didn't intend            |
| **Dead letter**                | A job that failed all retries and is kept for inspection                            |
| **Dependency injection**       | Handing a component the tools it needs instead of it creating them                  |
| **Deployment**                 | Putting a new version of the software into use                                      |
| **DNS**                        | The internet's phone book (names → addresses)                                       |
| **Docker / image**             | Packaging software with everything it needs; the package is an image                |
| **Document database**          | A database storing JSON-like documents (MongoDB)                                    |
| **DPDP Act**                   | India's Digital Personal Data Protection Act, 2023                                  |
| **DTO**                        | The exact, safe shape of data sent out by the API                                   |
| **End-to-end test**            | A test where a real browser uses the real app                                       |
| **Environment variable**       | A setting supplied to a program from outside its code                               |
| **Expand–contract**            | Changing data in two releases so old and new versions both work                     |
| **Frontend**                   | What users see and interact with in the browser                                     |
| **GST**                        | India's Goods and Services Tax                                                      |
| **Hash**                       | A one-way fingerprint of data                                                       |
| **Health check**               | An endpoint that says whether a service is alive/ready                              |
| **HMAC**                       | A signature made with a shared secret to prove a message wasn't forged or changed   |
| **Hold**                       | A temporary 10-minute reservation of rooms while paying                             |
| **Horizontal scaling**         | Running more copies of a service                                                    |
| **HTTP / HTTPS**               | The language of web requests; HTTPS is the encrypted version                        |
| **HttpOnly**                   | A cookie setting that hides it from JavaScript                                      |
| **i18n**                       | Internationalisation — supporting multiple languages                                |
| **Idempotency**                | Doing something twice has the same effect as once                                   |
| **Index**                      | A lookup structure that makes database searches fast                                |
| **Integration test**           | A test of several parts working together (API + database)                           |
| **Invariant**                  | A rule that must always be true (rooms never negative)                              |
| **JSON**                       | A simple text format for data                                                       |
| **JSON-LD**                    | Structured data in pages that tells search engines facts (this is a hotel…)         |
| **JWT**                        | JSON Web Token — a signed, tamper-evident token                                     |
| **k6**                         | A load-testing tool                                                                 |
| **LCP**                        | Largest Contentful Paint — how fast the main content appears                        |
| **Ledger**                     | An append-only record of money movements                                            |
| **Least privilege**            | Giving each part only the access it needs                                           |
| **LLM**                        | Large language model (Claude, ChatGPT)                                              |
| **Load balancer**              | Spreads traffic across server copies                                                |
| **Load test**                  | Simulating many users to measure performance                                        |
| **Marketplace / multi-vendor** | A platform where many independent sellers serve customers                           |
| **Mass assignment**            | Sneaking extra fields into a request to change protected data                       |
| **Metrics**                    | Numbers measured over time (latency, errors)                                        |
| **Middleware**                 | A step every request passes through (logging, auth)                                 |
| **Migration**                  | A versioned script that changes stored data's shape                                 |
| **Minor units**                | Smallest currency unit (paise) — money stored as whole numbers                      |
| **Modular monolith**           | One application divided into clear modules                                          |
| **Monorepo**                   | Several related projects in one repository                                          |
| **nginx**                      | A web server and reverse proxy                                                      |
| **Node.js**                    | Runs JavaScript on servers                                                          |
| **Observability**              | Understanding a running system through logs, metrics and alerts                     |
| **Open Graph**                 | Tags that control link previews on social apps                                      |
| **Outbox pattern**             | Saving an event with the data change, then delivering it reliably                   |
| **OWASP**                      | A foundation publishing the top web security risks                                  |
| **p95**                        | The time within which 95 % of requests complete                                     |
| **Payment gateway**            | A company that collects payments (Razorpay)                                         |
| **PCI-DSS**                    | Security rules for handling card data                                               |
| **Prometheus**                 | A monitoring system that collects metrics and evaluates alerts                      |
| **Prompt injection**           | Text in data trying to give an AI new instructions                                  |
| **Quote**                      | A signed, short-lived price calculated by the server                                |
| **Race condition**             | A bug caused by the timing of simultaneous operations                               |
| **Rate limiting**              | Restricting how many requests someone may make in a time window                     |
| **RBAC**                       | Role-based access control                                                           |
| **React**                      | A library for building interfaces from components                                   |
| **Reconciliation**             | Comparing independent records to prove they agree                                   |
| **Redis**                      | A very fast in-memory data store                                                    |
| **Refresh token**              | A long-lived credential used only to get new access tokens                          |
| **Replica set**                | A group of database servers keeping copies; required for transactions               |
| **REST**                       | An API style where URLs are resources and HTTP verbs are actions                    |
| **Reverse proxy**              | A server that forwards requests to other servers                                    |
| **Rollback**                   | Undoing a transaction, or going back to the previous release                        |
| **Room-night**                 | One room for one night — the unit hotels sell                                       |
| **RPO / RTO**                  | Acceptable data loss / acceptable recovery time after a disaster                    |
| **Salt**                       | Random data added before hashing a password                                         |
| **SameSite**                   | A cookie setting that stops it being sent on cross-site requests                    |
| **Sandbox**                    | A safe test version of an external service                                          |
| **Schema**                     | The expected shape of data                                                          |
| **Seed data**                  | Fictional sample data for development                                               |
| **SEO**                        | Search Engine Optimisation — being found on Google                                  |
| **Settlement**                 | Paying a partner what they are owed                                                 |
| **Smoke test**                 | A quick check that the main things work after a deploy                              |
| **Snapshot**                   | A frozen copy of data at a moment (price at booking time)                           |
| **SPA**                        | Single-page application                                                             |
| **SSI**                        | Server-side includes — nginx inserting content into a page as it serves it          |
| **SSRF**                       | Tricking a server into fetching URLs for an attacker                                |
| **Staging**                    | A production-like environment for testing releases                                  |
| **State machine**              | Allowed states and transitions of something (a booking)                             |
| **Stateless**                  | Keeping no per-user memory between requests in the server process                   |
| **TanStack Query**             | A library managing server data in the frontend                                      |
| **TLS**                        | The encryption behind HTTPS                                                         |
| **Transaction**                | A group of database changes that succeed or fail together                           |
| **Trivy**                      | A scanner for vulnerabilities in container images                                   |
| **TypeScript**                 | JavaScript with types that catch mistakes early                                     |
| **Unit test**                  | A test of one small piece in isolation                                              |
| **Validation**                 | Checking that incoming data has the right shape and values                          |
| **WCAG**                       | The international web accessibility standard                                        |
| **Webhook**                    | A service calling your server to report an event                                    |
| **Worker**                     | A background process that runs queued jobs                                          |
| **XSS**                        | An attack injecting scripts into web pages                                          |
| **Zod**                        | A validation library for describing and checking data shapes                        |
