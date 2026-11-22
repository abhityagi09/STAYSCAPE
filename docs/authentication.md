# Authentication

## Tokens

| Token         | Form                                                 | Lifetime                                    | Storage                                                                                                              |
| ------------- | ---------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Access token  | JWT HS256 (`sub`, `sid`, `typ=access`, `iss`, `aud`) | `ACCESS_TOKEN_TTL_SECONDS` (15 min)         | **Browser memory only** (`lib/api/token-store.ts`)                                                                   |
| Refresh token | 384-bit opaque random string                         | `REFRESH_TOKEN_TTL_DAYS` (30 days, sliding) | `ss_rt` cookie: HttpOnly, SameSite=Strict, Secure (prod), `Path=/api/v1/auth`. Database stores **SHA-256 hash only** |
| CSRF token    | 192-bit random                                       | same as refresh                             | `ss_csrf` cookie, readable by JS, `Path=/`                                                                           |

`sid` is the refresh-token **family** id. Every authenticated request re-loads the user and checks
that the family is still active, so logout, "sign out everywhere", session revocation, password
changes and suspensions take effect immediately — not when the access token expires.

## Flows

**Register** `POST /auth/register` — Zod validation (strict object: unknown fields such as `roles`
are rejected) → duplicate check (+ unique index for races) → in one MongoDB transaction create the
user (role `CUSTOMER` only) and an email-verification token → enqueue verification email → audit →
sign in (returns access token, sets cookies).

**Login** `POST /auth/login` — rate limited per IP+email. Unknown email still runs an Argon2 verify
against a dummy hash (timing equalisation). Wrong email and wrong password return the same
`401 INVALID_CREDENTIALS`. Account status (`SUSPENDED`/`DEACTIVATED` → 403) is only disclosed after
the password is proven. Successful and failed logins are audited (never the password).

**Refresh** `POST /auth/refresh` — requires the cookie and the CSRF header. The presented token is
atomically claimed (`findOneAndUpdate … revokedAt: null`) and a new token in the same family is
issued. Presenting an already-rotated token is treated as theft: the whole family is revoked,
`401 REFRESH_TOKEN_REUSED` is returned and `auth.refresh_reuse_detected` is audited.

**Logout** `POST /auth/logout` revokes the cookie's family and clears cookies (idempotent; works
with an expired access token). **Logout all** `POST /auth/logout-all` revokes every family.

**Forgot / reset password** — `forgot-password` always returns the same `202` message. For active
accounts it invalidates outstanding reset tokens, stores a SHA-256 hash of a new 256-bit token
(`PASSWORD_RESET_TTL_MINUTES`) and emails the link. `reset-password` atomically consumes the token
inside a transaction (single use; concurrent attempts cannot both succeed), sets the new Argon2id
hash, revokes **all** sessions, records an audit event, creates an in-app notification and emails a
"password changed" alert.

**Email verification** — 24 h single-use token; `resend-verification` is generic and has a 60 s
cooldown. **Change password** (`POST /auth/change-password`) needs the current password and signs
out every other session.

## Passwords

Argon2id, `memoryCost=19456 KiB`, `timeCost=2`, `parallelism=1` (OWASP baseline; configurable).
Policy (shared Zod schema, enforced server-side): 10–128 chars with lowercase, uppercase and a
digit. `passwordHash` is `select: false`, stripped by `toJSON`, and DTOs are built through
`toUserDto` which never maps it.

## CSRF

Cookie-authenticated endpoints (`refresh`, `logout`, `logout-all`) require:

1. `X-CSRF-Token` header equal to the `ss_csrf` cookie (constant-time compare), and
2. if an `Origin` header is present, an allowlisted origin.

Combined with `SameSite=Strict` and the narrow cookie path, cross-site requests cannot use the
session. All other endpoints use the `Authorization: Bearer` header, which browsers never attach
automatically.

## Frontend session handling

- On load, `SessionManager` restores the session via `/auth/refresh` (skipped when no session
  cookie exists, so anonymous visitors make no request).
- The Axios interceptor retries a request once after a 401 by refreshing. Refreshes are
  **single-flight** (concurrent 401s share one request) and **serialised across tabs** with the Web
  Locks API, preventing false reuse detection between tabs.
- If refresh fails the session is ended, caches are cleared and protected routes redirect to
  `/login?redirect=…&reason=expired`. Redirect targets are restricted to same-origin paths.

## Rate limits (per IP, `RATE_LIMIT_WINDOW_MS`)

| Limiter | Default                 | Applies to                                                                  |
| ------- | ----------------------- | --------------------------------------------------------------------------- |
| global  | 300                     | every `/api/v1` route                                                       |
| auth    | 30                      | register, forgot/reset password, verify/resend, change password, newsletter |
| login   | 10 per IP **and** email | login                                                                       |

Limits are stored in Redis (shared across API instances); `429 RATE_LIMITED` includes `Retry-After`.
`.env.example` uses higher values for local development.
