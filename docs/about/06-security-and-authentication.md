# 6. Security and sign-in

Two words first:

- **Authentication** — _who are you?_ (proving identity: signing in).
- **Authorisation** — _what are you allowed to do?_ (permissions).

## 6.1 Passwords: never stored, only hashed

STAYSCAPE never stores your password. It stores a **hash** — the output of a one-way function. You
can turn a password into a hash, but not a hash back into a password. At sign-in, the typed password
is hashed again and compared.

Not any hash will do. Fast hashes (like SHA-256) let an attacker who steals the database try
billions of guesses per second. **Argon2id** is designed to be slow and to need lots of memory per
guess, which makes cracking expensive even with powerful graphics cards. Each hash includes a random
**salt**, so two people with the same password get different hashes and pre-computed tables are
useless.

Other password protections:

- **Generic errors:** "Email or password is incorrect" — never "no such email" — so attackers cannot
  discover which emails have accounts (_user enumeration_). Even for unknown emails a dummy hash is
  computed so the response takes the same time.
- **Rate limiting** on login (10 attempts per window per IP in production) stops brute-force
  guessing.
- **Password rules** (minimum strength) validated by the shared schema.
- **Account status** (suspended/deactivated) is checked _after_ the password is verified, so the
  response doesn't reveal account state to strangers.

## 6.2 Tokens and sessions — how you stay signed in

### Access token (JWT)

After sign-in the server issues a **JSON Web Token** — a string with three parts: header, payload
(user id, roles, session id, expiry) and a **signature** made with a server secret. Anyone can read
a JWT, but nobody can change it without the secret, because the signature would no longer match.

- Lifetime: **15 minutes** — if stolen, it is useful only briefly.
- Stored **in memory only** in the web app (not in browser storage that a malicious script could
  read). Sent in the `Authorization: Bearer <token>` header.
- On every request the server also checks that the **session is still active** in the database, so
  logging out, "sign out everywhere", a password change or an admin suspension takes effect
  **immediately**, not after the token expires.

### Refresh token (cookie)

To avoid signing in every 15 minutes, a long-lived **refresh token** (30 days) is stored in a
**cookie** with strict settings:

| Setting             | Effect                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `HttpOnly`          | JavaScript cannot read it, so a malicious script cannot steal it    |
| `Secure`            | Only sent over HTTPS                                                |
| `SameSite=Strict`   | Not sent when another website triggers a request (blocks most CSRF) |
| `Path=/api/v1/auth` | Only sent to the refresh/logout endpoints, nowhere else             |

Only a **hash** of the refresh token is stored in the database.

### Rotation and reuse detection

Each time the refresh token is used, it is **replaced** with a new one (rotation) and the old one is
marked used. If an old, already-used token is ever presented again, someone must have stolen it —
so the whole **token family** (that login's chain of sessions) is revoked and the user must sign in
again. This is the industry-recommended defence against stolen refresh tokens.

When the page reloads, the in-memory access token is gone; the app silently calls `/auth/refresh`
using the cookie and gets a new one. If many requests fail at once, a single refresh is shared
(refresh coordination) so they don't race.

## 6.3 CSRF — Cross-Site Request Forgery

**The attack:** you are signed in to site A. You visit an evil site B, which contains a hidden form
that submits to site A. Your browser automatically attaches A's cookies, so A thinks _you_ sent it.

**The defences in STAYSCAPE:**

1. Normal API calls use the `Authorization` header with an in-memory token, which a foreign site
   cannot attach — so they are immune.
2. The refresh cookie is `SameSite=Strict` (browsers won't send it on cross-site requests) and
   path-restricted.
3. Refresh and logout additionally require a **double-submit CSRF token**: a random value in a
   readable cookie that must also be copied into an `X-CSRF-Token` header. A foreign site can't read
   the cookie, so it can't produce the header. Plus an origin check.

## 6.4 XSS — Cross-Site Scripting

**The attack:** getting the victim's browser to run the attacker's script, e.g. by putting
`<script>` into a review title that other people view.

**The defences:** React escapes text by default; Markdown content is rendered without raw HTML;
SEO metadata is HTML-escaped and JSON-LD is script-escaped (tested with a hostile hotel name);
a strict **Content Security Policy** only allows scripts from STAYSCAPE itself and Razorpay
checkout; tokens are kept out of readable storage, so even a successful injection could not
steal the refresh cookie.

## 6.5 Injection

**The attack:** sending input that the server treats as a command — classic SQL injection, or in
MongoDB, sending `{"$gt": ""}` as a password to mean "anything greater than empty".

**The defences:** every input is validated by **strict Zod schemas** (wrong types and unknown fields
rejected); Express is configured with a simple query parser so query strings cannot become nested
objects; user text used in searches is escaped before it becomes a regular expression; CSV exports
neutralise spreadsheet formulas (a cell starting with `=` could run in Excel).

## 6.6 Authorisation — roles, permissions and ownership

### Role-based access control (RBAC)

Each role maps to a list of **permissions** like `bookings:read-all`, `refunds:manage`,
`partners:approve`. The list lives in the shared package. Routes declare what they need:
`requirePermission('refunds:manage')`.

### Ownership (resource-level checks)

Permissions are not enough: a customer has `bookings:read-own`, but that must not let customer A
read customer B's booking. Every service also checks that the specific record belongs to the
caller. If not, it answers **404 Not Found** rather than 403, so attackers cannot even learn the
record exists. This defends against **IDOR / BOLA** (Insecure Direct Object Reference / Broken
Object Level Authorization) — the most common API vulnerability: changing an id in a URL to see
someone else's data.

### Delegated staff permissions

Hotel staff get fine-grained permissions _per property_, e.g. `bookings:check-in` at the Udaipur
property but nothing at the Goa one.

### Privilege rules

Nobody can change their own roles; only super administrators grant or remove admin roles; admins
cannot suspend more senior accounts.

### Mass assignment

If an API blindly saved every field it received, a user could send `"roles": ["ADMIN"]` in their
profile update. Strict schemas reject unknown fields, and protected fields (roles, status, prices)
are never read from requests.

### Proving it: the authorisation matrix test

A test discovers **all 300 routes** at runtime and calls each as all seven roles. A super-admin run
records which permission checks each route enforces; every other role must then be refused exactly
when it lacks one of them. No route may crash, and the list of routes reachable without signing in
(44) is fixed — so a new endpoint can't become public by accident. It found three partner routers
that relied only on data scoping rather than an explicit role gate; they were hardened.

## 6.7 Other protections

| Threat                                       | Defence                                                                                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brute force / API abuse                      | Redis-backed rate limits: global, auth and login; per-user AI limits; max 3 active holds per person                                                                                         |
| Big or malicious uploads                     | Size limits; the file's real type is detected from its bytes ("magic bytes"), not the claimed type; images are re-encoded (strips hidden metadata and payloads); documents stored privately |
| Webhook forgery                              | Every payment webhook is signed with a shared secret (HMAC-SHA256) over the exact raw body and compared in constant time; event ids de-duplicated; amounts re-checked with the provider     |
| SSRF (making the server fetch attacker URLs) | The server never fetches user-supplied URLs; outbound calls only go to fixed configured services                                                                                            |
| Sensitive data in logs                       | Logs record method, route and status only; capability tokens in URLs are redacted; secret-looking keys in audit data are replaced with `[REDACTED]`                                         |
| Secrets in code                              | Secrets come from environment variables; `.env` files are ignored by git; gitleaks scans history in CI                                                                                      |
| Vulnerable libraries                         | `npm audit` in CI (0 vulnerabilities after upgrades); Trivy scans images                                                                                                                    |
| Clickjacking                                 | `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'`                                                                                                                                    |
| Data at rest                                 | Partner bank account numbers encrypted with AES-256-GCM; backups encrypted                                                                                                                  |
| Misconfiguration                             | The app refuses to start in production with development secrets, the test gateway, insecure cookies or no CORS allow-list                                                                   |

## 6.8 Privacy rights

Indian law (the Digital Personal Data Protection Act, 2023) gives people rights over their data.
STAYSCAPE lets customers **download a copy** of their data (JSON) and **delete their account**.
Deletion is refused while a stay is upcoming or a refund is open. It anonymises the account,
revokes all sessions and removes personal lists, while keeping bookings, payments and invoices,
which tax law requires to be retained. The email becomes free to register again.

## 6.9 The OWASP Top 10

**OWASP** publishes the ten most critical web security risks. In interviews, being able to map your
project to them is impressive:

| OWASP 2021                       | STAYSCAPE                                                             |
| -------------------------------- | --------------------------------------------------------------------- |
| A01 Broken access control        | Permission middleware, ownership checks, 300-route matrix test        |
| A02 Cryptographic failures       | Argon2id, hashed tokens, AES-GCM, HTTPS, encrypted backups            |
| A03 Injection                    | Strict validation, simple query parser, escaping                      |
| A04 Insecure design              | Transactions, idempotency, provider-verified payments                 |
| A05 Security misconfiguration    | Startup config validation, Helmet/CSP, non-root containers            |
| A06 Vulnerable components        | npm audit + Trivy in CI                                               |
| A07 Identification/auth failures | Rate limits, rotation + reuse detection, immediate revocation         |
| A08 Software/data integrity      | Signed webhooks, signed quotes, CI checks before images are published |
| A09 Logging/monitoring failures  | Structured logs with request ids, audit log, metrics and alerts       |
| A10 SSRF                         | No user-controlled outbound requests                                  |

## Say it in an interview

**"How does authentication work?"** — _"Argon2id-hashed passwords. Sign-in returns a 15-minute JWT
held in memory and sets a 30-day refresh token in an HttpOnly, Secure, SameSite=Strict cookie scoped
to the auth path; only its hash is stored. Refresh rotates the token, and reuse of an old token
revokes the whole family. Each request also checks the session is still active, so logout,
password change and suspension are immediate."_

**"Why not store the JWT in localStorage?"** — _"Any XSS could read it. In memory plus an HttpOnly
refresh cookie means a script can't exfiltrate a long-lived credential."_

**"How do you stop users seeing each other's bookings?"** — _"Permission checks at the route plus
ownership checks in the service, returning 404 for records you don't own. I verified it with a test
that calls every route as every role."_

**"How do you verify webhooks?"** — _"HMAC-SHA256 over the raw request body with the shared webhook
secret, constant-time comparison, de-duplication by event id, and I re-fetch the payment from the
provider before acting on it."_
