# API reference (v1)

Base path `/api/v1`. Interactive docs: `GET /api/v1/docs` (Swagger UI) and
`GET /api/v1/openapi.json` (OpenAPI 3.1; request bodies are generated from the shared Zod schemas).
Disable with `API_DOCS_ENABLED=false`.

All responses use `{ success, data }` / `{ success: false, error: { code, message, details?, requestId } }`.
Every response carries `X-Request-Id` (a well-formed incoming one is propagated).

Auth legend: **—** public · **B** bearer access token · **C** refresh cookie + `X-CSRF-Token` · `perm` required permission.

## Health (also mounted at `/health`, outside rate limiting)

| Method | Path          | Auth | Description                                                                     |
| ------ | ------------- | ---- | ------------------------------------------------------------------------------- |
| GET    | /health       | —    | Summary; `status: ok                                                            | degraded` |
| GET    | /health/live  | —    | Liveness: process responds (no dependency checks)                               |
| GET    | /health/ready | —    | Readiness: MongoDB + Redis ping; **503** if either is down (no internal detail) |

## Auth

| Method | Path                      | Auth            | Body                                                      | Success                               |
| ------ | ------------------------- | --------------- | --------------------------------------------------------- | ------------------------------------- |
| POST   | /auth/register            | —               | firstName, lastName, email, phone?, password, acceptTerms | 201 `AuthSessionDto` + cookies        |
| POST   | /auth/login               | —               | email, password                                           | 200 `AuthSessionDto` + cookies        |
| POST   | /auth/refresh             | C               | —                                                         | 200 `AuthSessionDto`, rotated cookies |
| POST   | /auth/logout              | C               | —                                                         | 200                                   |
| POST   | /auth/logout-all          | B + CSRF header | —                                                         | 200 `{ revokedSessions }`             |
| POST   | /auth/forgot-password     | —               | email                                                     | 202 (generic)                         |
| POST   | /auth/reset-password      | —               | token, password                                           | 200                                   |
| POST   | /auth/verify-email        | —               | token                                                     | 200 `{ user }`                        |
| POST   | /auth/resend-verification | —               | email                                                     | 202 (generic)                         |
| POST   | /auth/change-password     | B               | currentPassword, newPassword                              | 200                                   |
| GET    | /auth/me                  | B               | —                                                         | 200 `UserDto`                         |

## Users

| Method | Path                | Auth           | Description                                               |
| ------ | ------------------- | -------------- | --------------------------------------------------------- |
| GET    | /users/profile      | B              | Own profile                                               |
| PATCH  | /users/profile      | B              | firstName?, lastName?, phone? (`""`/`null` clears)        |
| PATCH  | /users/preferences  | B              | language?, currency?, notifications{…}? (partial merge)   |
| POST   | /users/avatar       | B              | multipart `avatar`; JPEG/PNG/WebP ≤ 2 MB, content-sniffed |
| GET    | /users/sessions     | B              | Active sessions (`current` flags this device)             |
| DELETE | /users/sessions/:id | B              | Revoke own session (others' → 404)                        |
| GET    | /users              | `users:read`   | page, limit, search, role, status                         |
| PATCH  | /users/:id/roles    | `users:manage` | `{ roles }` (privileged roles need SUPER_ADMIN)           |
| PATCH  | /users/:id/status   | `users:manage` | `{ status, reason? }`; suspension revokes sessions        |

## Notifications, audit, roles, newsletter

| Method | Path                        | Auth         | Description                                   |
| ------ | --------------------------- | ------------ | --------------------------------------------- |
| GET    | /notifications              | B            | page, limit, unreadOnly                       |
| GET    | /notifications/unread-count | B            |                                               |
| PATCH  | /notifications/:id/read     | B            | Own only (others' → 404)                      |
| POST   | /notifications/read-all     | B            |                                               |
| GET    | /audit                      | `audit:read` | page, limit, action, actorId, entityType      |
| GET    | /roles                      | `users:read` | Role → permission matrix                      |
| GET    | /permissions/me             | B            | Caller's roles and effective permissions      |
| GET    | /permissions                | `users:read` | Permission catalogue                          |
| POST   | /newsletter/subscriptions   | —            | `{ email, source? }`, idempotent              |
| GET    | /media/*                    | —            | Locally stored media (`STORAGE_DRIVER=local`) |

## Error codes

`VALIDATION_ERROR` (422, with `details.fieldErrors`), `BAD_REQUEST` (400), `AUTH_REQUIRED`,
`INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `SESSION_REVOKED`,
`REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_REUSED` (401), `CSRF_INVALID`, `ACCOUNT_SUSPENDED`,
`ACCOUNT_DEACTIVATED`, `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT`, `EMAIL_TAKEN` (409),
`VERIFICATION_TOKEN_INVALID` (400), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415),
`RATE_LIMITED` (429), `SERVICE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500 — details only in logs).
