# Security

Security review against the OWASP Top 10 (2021) and the OWASP API Security Top 10 (2023),
with the automated evidence for each control. Detailed authentication design: docs/authentication.md;
permissions: docs/permissions.md.

## Controls and evidence

| Risk                                | Controls                                                                                                                                                                                                                                                                                                                                         | Verified by                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Broken access control / BOLA / BFLA | Permission middleware on every protected router; resource checks return **404** for other people's records; partner workspace scoped to membership; staff need the specific permission for the specific property                                                                                                                                 | `authorization-matrix.test.ts` (300 routes × 7 roles), isolation tests in bookings, partners, corporate, trips, support |
| Mass assignment                     | All bodies parsed with **strict** Zod schemas (unknown keys rejected); protected fields (roles, status, prices, totals) never accepted from clients; prices always computed server-side                                                                                                                                                          | users, privacy, bookings tests (forged prices and extra fields → 422)                                                   |
| Cryptographic failures              | Argon2id password hashing; refresh tokens and verification/reset tokens stored as SHA-256 hashes; settlement account numbers AES-256-GCM encrypted (`DATA_ENCRYPTION_KEY`); quotes HMAC-signed; TLS at the edge; backups AES-256 encrypted                                                                                                       | auth, partners ("encrypts the settlement account"), quote tests                                                         |
| Injection                           | Mongoose with typed queries; Express `query parser: simple` (no nested operator objects); Zod validation of params/query/body; regex input escaped; CSV export neutralises formula injection                                                                                                                                                     | validation tests, "escapes CSV cells and neutralises formula injection"                                                 |
| XSS                                 | React escaping; Markdown rendered without raw HTML (`SafeMarkdown`); strict CSP (`script-src 'self'` + Razorpay only, `object-src 'none'`, `frame-ancestors 'none'`); SEO fragments HTML-escaped and JSON-LD script-escaped                                                                                                                      | web "renders Markdown without HTML", `seo.test.ts` hostile-name test                                                    |
| CSRF                                | Access token in memory (Authorization header); the refresh cookie is HttpOnly, Secure, SameSite=Strict, path-scoped, and refresh/logout require a double-submit CSRF token                                                                                                                                                                       | auth "requires a matching CSRF token"                                                                                   |
| Authentication weaknesses           | Generic login errors; account status checked after the password; rate limits on login, auth and the API (Redis-backed); refresh rotation with reuse detection that revokes the token family; logout and logout-all; password change/reset revoke sessions; suspension revokes sessions immediately                                               | auth and users test suites (incl. "detects refresh token reuse")                                                        |
| Insecure design (money/inventory)   | Transactions for every booking/payment/refund write; idempotency keys; atomic conditional inventory updates + a database validator for the invariant; webhooks are the source of truth with signature checks and replay protection                                                                                                               | concurrency and payment suites; `stayscape_inventory_invariant_violations`                                              |
| Security misconfiguration           | Production config refuses development secrets, sandbox payments, insecure cookies, missing CORS allowlist; Helmet headers; `x-powered-by` off; `server_tokens off`; API docs off in production; non-root read-only containers with all capabilities dropped; databases on an internal network                                                    | `env.test.ts`, health tests, `scripts/deploy/smoke.sh`                                                                  |
| Vulnerable components               | `npm audit` 0 vulnerabilities (2026-11-27, after upgrading sharp, nodemailer, maplibre-gl, vitest and forcing esbuild ≥ 0.28.2); Trivy: no fixable high/critical in either image (OS packages upgraded, npm removed from the runtime image)                                                                                                      | CI `security` and `images` jobs                                                                                         |
| Insecure file uploads               | Size limits; content sniffing (magic bytes) rather than the declared type; images re-encoded with sharp (strips metadata, pixel limits); private documents in a non-public store served only to authorised users; reference checks before attaching                                                                                              | media, partners, support tests                                                                                          |
| SSRF                                | No user-supplied URLs are fetched server-side: video links are stored and embedded client-side (YouTube/Vimeo allowlist); outbound calls go only to fixed configured hosts (Razorpay, ECB, SMTP, Anthropic, S3)                                                                                                                                  | code review (`grep fetch/axios` in the API)                                                                             |
| Webhook forgery                     | HMAC-SHA256 over the raw body with timing-safe comparison; event-id deduplication; amounts and states always re-fetched from the provider before acting                                                                                                                                                                                          | "processes webhooks idempotently and out of order, with signature checks"; channel webhook tests                        |
| API abuse / resource consumption    | Global, auth and login rate limits; per-user AI limits and a monthly budget; body size limit (100 KB JSON, explicit upload limits); pagination caps; max 3 active holds per person                                                                                                                                                               | health ("applies the global API rate limit"), assistant tests                                                           |
| AI prompt injection                 | Tool results are wrapped as `untrusted_data`; the system prompt states that tool data are not instructions; the assistant can only call read-only search/detail/quote tools with validated arguments; answers may only mention properties returned by tools, and any price not produced by the pricing engine is replaced by the verified quotes | `assistant.test.ts`                                                                                                     |
| Excessive data exposure             | DTO mappers whitelist fields (no hashes, tokens, internal notes, partner bank details); guests' contact details are not shared with partners beyond what a stay requires; account export excludes staff notes                                                                                                                                    | users ("never exposes the password hash"), privacy, support tests                                                       |
| Sensitive data in logs              | Request logs record method, route URL (capability tokens redacted) and status only — no bodies, cookies or headers; audit metadata sanitiser redacts secret-like keys; card data never reaches STAYSCAPE (Razorpay Checkout)                                                                                                                     | "audit metadata sanitiser redacts secrets", log redaction test                                                          |
| Secrets in the repository           | `.env*` ignored (except examples); gitleaks scan of the full history: **no leaks** (test fixtures and documented placeholders allowlisted by pattern in `.gitleaks.toml`)                                                                                                                                                                        | CI `security` job                                                                                                       |

No secrets were found in the repository history, so no rotation is required from this review.

## Secrets management and rotation

Secrets come from the platform secret store at deploy time (docs/environment.md). Rotate on
staff changes, suspected exposure, and at least yearly:

| Secret                               | Rotation impact and procedure                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_ACCESS_SECRET`                  | Deploy the new value: access tokens signed with the old value fail and clients refresh silently (refresh sessions are independent).                                   |
| `QUOTE_SIGNING_SECRET`               | Outstanding quotes become invalid; guests are re-quoted automatically.                                                                                                |
| `RAZORPAY_*`                         | Create new keys in the Razorpay dashboard, deploy, then revoke the old ones; update the webhook secret on both sides together.                                        |
| `DATA_ENCRYPTION_KEY`                | Encrypted fields are settlement account numbers. Add the new key alongside the old one, run a re-encryption job, then remove the old key. Do not replace it in place. |
| `METRICS_TOKEN`, SMTP, S3, Anthropic | Replace in the secret store and Prometheus/clients, deploy, revoke the old credential.                                                                                |
| `BACKUP_PASSPHRASE`                  | New backups use the new value; keep the old one as long as backups encrypted with it are retained.                                                                    |

## Privacy

- **Data export:** `GET /api/v1/users/me/export` (Account → Settings → Your data → Download my data) returns a JSON copy of
  the account's personal data: profile, preferences, bookings, reviews, saved lists, alerts,
  notifications, support conversations, trips, sessions, loyalty history and the newsletter status.
- **Deletion:** `POST /api/v1/users/me/deletion` with the password and `confirm: "DELETE"`. Refused
  while bookings are upcoming or in progress, refunds are open, or the account has partner, staff or
  admin roles (those are closed through support). Deletion anonymises the account, revokes all sessions,
  removes saved lists, alerts, notifications, tokens, referral code, trips, staff memberships and the
  newsletter subscription. Bookings, payments, refunds and invoices are **retained** for tax and
  accounting record-keeping; verified reviews stay, attributed to "Former guest". The email
  address becomes available for a new account.
- **Cookies:** only strictly necessary cookies (HttpOnly refresh session, CSRF token); the theme
  and language choices are stored in the browser. No analytics or advertising cookies, so no
  consent banner is required for cookies; add one before introducing any non-essential tracking.
- **Marketing:** opt-in only (newsletter, promotional email preference); every email carries an
  unsubscribe path.

## Breach response

1. Contain (revoke credentials, rotate secrets, block access), preserve logs and audit records.
2. Assess the personal data affected and the people concerned.
3. Notify the **Data Protection Board of India** and each affected person as required by the
   Digital Personal Data Protection Act, 2023 and its Rules, and CERT-In within **6 hours** of
   noticing reportable cyber incidents (CERT-In Directions, 28 April 2022). Legal counsel confirms
   scope and wording.
4. Remediate, then run a post-incident review (docs/monitoring.md).
