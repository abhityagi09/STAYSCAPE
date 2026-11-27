# 4. The technology stack — every tool, what it does, why it was chosen

For each tool: **what it is in plain words**, **what it does in STAYSCAPE**, **why it was chosen**
and **what else could have been used** (interviewers often ask "why X over Y?").

## 4.1 Languages

### JavaScript and TypeScript

- **What:** JavaScript is the language browsers run. **Node.js** lets it run on servers too.
  **TypeScript** is JavaScript plus _types_: you declare that `totalMinor` is a number and
  `status` is one of a fixed set of words, and a checker (`tsc`) catches mistakes before the code
  runs.
- **In STAYSCAPE:** every part — website, API, shared package, tests — is TypeScript.
- **Why:** one language end to end; types shared between browser and server; huge ecosystem.
  Types catch whole classes of bugs (calling a function with the wrong data) at build time.
- **Alternatives:** Python (Django/FastAPI), Java (Spring), Go. Fine choices, but they would need a
  second language for the frontend and no shared types.

## 4.2 Backend

| Tool                     | Plain-words description                                                               | Role here                                                             | Why / alternatives                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js 22**           | Runs JavaScript on a server; very good at handling many simultaneous network requests | Runs the API and the worker                                           | Event-driven and efficient for I/O-heavy apps (database, payment calls). Alternatives: Deno, Bun (newer, smaller ecosystems)                                                                         |
| **Express 5**            | A minimal web framework: routes + middleware                                          | Defines the 300 routes and the middleware pipeline                    | Simple, well understood, huge ecosystem. Alternatives: Fastify (faster), NestJS (more structure, more ceremony)                                                                                      |
| **MongoDB 8**            | A **document database**: stores records as JSON-like documents                        | System of record for everything                                       | Flexible nested data (a hotel with its policies, images, amenities); supports multi-document **transactions** on a replica set. Alternative: PostgreSQL (relational, also excellent — see chapter 5) |
| **Mongoose 8**           | A library that defines document shapes (schemas), validation and indexes for MongoDB  | Every collection's model                                              | Schema + typed models + index declarations. Alternative: the raw MongoDB driver or Prisma                                                                                                            |
| **Redis 7**              | An in-memory store — extremely fast but meant for temporary data                      | Rate-limit counters, cache, job queues                                | Microsecond reads; shared between all API copies                                                                                                                                                     |
| **BullMQ 5**             | A job-queue library on top of Redis                                                   | Email jobs, domain events, 12 scheduled maintenance jobs              | Retries with back-off, scheduling, dead-letter retention. Alternatives: RabbitMQ, AWS SQS, Agenda                                                                                                    |
| **Zod 4**                | A validation library: describe the expected shape, it checks real data                | Every request body/query, the environment config, shared with the web | Strict objects reject unknown fields (stops mass assignment); also produces TypeScript types                                                                                                         |
| **Argon2**               | The modern password-hashing algorithm (winner of the Password Hashing Competition)    | Hashing passwords                                                     | Deliberately slow and memory-hard, so stolen hashes are hard to crack. Alternatives: bcrypt, scrypt                                                                                                  |
| **jsonwebtoken**         | Creates and verifies JWTs (signed tokens)                                             | Access tokens                                                         | Standard, stateless verification                                                                                                                                                                     |
| **Helmet**               | Sets security headers                                                                 | CSP, frame protection, etc. on API responses                          | Saner defaults in one line                                                                                                                                                                           |
| **pino** / **pino-http** | Very fast structured (JSON) logging                                                   | Every request logged with its request id                              | JSON logs are searchable in log platforms                                                                                                                                                            |
| **prom-client**          | Exposes metrics in Prometheus format                                                  | `/metrics`                                                            | Industry-standard monitoring                                                                                                                                                                         |
| **sharp**                | Fast image processing                                                                 | Re-encodes uploads to WebP/AVIF in several sizes, strips metadata     | Speed and safety                                                                                                                                                                                     |
| **multer**               | Handles file uploads                                                                  | Photos, documents, avatars                                            | Size limits per upload                                                                                                                                                                               |
| **nodemailer**           | Sends email over SMTP                                                                 | Confirmation, reset and notification emails                           | Standard                                                                                                                                                                                             |
| **pdfkit**               | Creates PDFs                                                                          | Invoices and booking confirmations                                    | —                                                                                                                                                                                                    |
| **@anthropic-ai/sdk**    | Official client for the Claude AI API                                                 | The AI assistant (optional)                                           | Official SDK, tool use                                                                                                                                                                               |
| **@aws-sdk/client-s3**   | Talks to S3-compatible file storage                                                   | Production photo/document storage                                     | —                                                                                                                                                                                                    |
| **tsup**                 | Bundles TypeScript into runnable JavaScript                                           | Builds the API and scripts                                            | Fast (esbuild-based)                                                                                                                                                                                 |
| **tsx**                  | Runs TypeScript directly in development                                               | `npm run dev`, scripts                                                | —                                                                                                                                                                                                    |

## 4.3 Frontend

| Tool                      | Plain-words description                                                                                      | Role here                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| **React 19**              | A library for building interfaces from reusable **components**                                               | Every screen                                |
| **Vite 7**                | A build tool and development server: instant reloads while developing; optimised, split files for production | Building the website                        |
| **React Router 7**        | Maps URLs to screens without reloading the page                                                              | All routes, lazy-loaded pages, guards       |
| **TanStack Query 5**      | Manages data fetched from the server: caching, loading/error states, retries, refetching                     | Every API call                              |
| **Redux Toolkit 2**       | A predictable store for app-wide state                                                                       | Sign-in state, comparison tray              |
| **React Hook Form + Zod** | Fast forms with validation from the shared schemas                                                           | Every form                                  |
| **Tailwind CSS 4**        | Styling with small utility classes (`flex`, `p-4`) and design tokens                                         | All styling, dark mode                      |
| **Axios**                 | HTTP client                                                                                                  | API calls, automatic token refresh          |
| **MapLibre GL 6**         | Open-source interactive maps                                                                                 | Search map, property map                    |
| **lucide-react**          | Icon set                                                                                                     | Icons                                       |
| **Fontsource**            | Self-hosted fonts (Inter, Fraunces)                                                                          | Typography without third-party font servers |

Why React? Largest ecosystem and hiring pool, component model, excellent tooling. Alternatives:
Vue, Svelte, Angular. Why a **single-page app** rather than server-rendered pages (Next.js)? The
app is highly interactive (filters, maps, dashboards) and most screens are private. SEO for public
pages is handled with server-generated metadata via nginx (chapter 9). Next.js would be a valid
alternative — in interviews say you would consider it for an SEO-first content site.

## 4.4 Testing and quality

| Tool                       | Role                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| **Vitest**                 | Unit and integration tests (API, web, shared)                                                   |
| **Supertest**              | Sends real HTTP requests to the Express app inside tests                                        |
| **mongodb-memory-server**  | Starts a real MongoDB **replica set** in memory for each test run (so transactions really work) |
| **Testing Library**        | Tests React components the way a user uses them (by label and role, not internals)              |
| **Playwright**             | Drives a real Chromium browser for end-to-end tests                                             |
| **axe-core**               | Automated accessibility checks                                                                  |
| **k6**                     | Load and stress testing                                                                         |
| **ESLint** (with jsx-a11y) | Finds bugs and accessibility mistakes in code                                                   |
| **Prettier**               | Automatic consistent formatting                                                                 |

## 4.5 Infrastructure and operations

| Tool                                   | Role                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Docker**                             | Packages each part with everything it needs into an **image**; runs it as a **container** |
| **Docker Compose**                     | Starts several containers together (dev stack and production/staging stack)               |
| **nginx**                              | Web server and reverse proxy (front door)                                                 |
| **Mailpit**                            | Catches outgoing email in development/staging so nothing is really sent                   |
| **GitHub Actions**                     | CI/CD pipeline: lint, test, build, scan, deploy                                           |
| **Prometheus**                         | Collects metrics and evaluates alert rules                                                |
| **gitleaks**                           | Scans the code history for leaked secrets                                                 |
| **Trivy**                              | Scans Docker images for known vulnerabilities                                             |
| **mongodump / mongorestore + openssl** | Encrypted backups and restores                                                            |

## 4.6 External services

| Service                         | Use                                                               | Status                        |
| ------------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| **Razorpay**                    | Indian payment gateway (cards, UPI, net banking)                  | Implemented; live keys needed |
| **Sandbox gateway**             | STAYSCAPE's own labelled test gateway reproducing Razorpay's flow | Used in dev/staging           |
| **SMTP provider**               | Sending email                                                     | Mailpit locally               |
| **S3**                          | Photo and document storage                                        | Local disk in dev             |
| **European Central Bank**       | Official daily exchange rates for display                         | Live                          |
| **Anthropic Claude**            | Large language model for the assistant                            | Optional; key needed          |
| **OpenFreeMap / OpenStreetMap** | Map tiles                                                         | No key needed                 |

## Say it in an interview

**"Why MongoDB?"** — _"The domain has rich nested documents — a hotel with policies, images and
amenities; a booking with price and policy snapshots — which map naturally to documents. MongoDB on
a replica set gives multi-document ACID transactions, which I rely on for booking and payment
writes. PostgreSQL would also have been a good fit; I'd choose it if the reporting needs were
heavily relational."_

**"Why TanStack Query and Redux both?"** — _"They solve different problems. TanStack Query owns
**server state** — data fetched from the API, with caching, loading states and refetching. Redux
holds a small amount of **client state** — who is signed in, the comparison tray. Keeping server
data out of Redux avoids a lot of hand-written loading and cache code."_

**"Why Argon2 instead of bcrypt?"** — _"Argon2id is memory-hard, which makes GPU cracking far more
expensive; it's the current OWASP recommendation. bcrypt is still acceptable."_

**"Why BullMQ?"** — _"I needed reliable background jobs with retries, exponential back-off,
scheduling and de-duplication by job id, and Redis was already in the stack."_
