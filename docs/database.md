# Database

MongoDB 8 via Mongoose 8. **A replica set is required**: reservation-critical workflows (and, in
Phase 1, registration and password reset) use multi-document transactions through
`lib/transaction.ts → withTransaction()`.

- Local: `docker compose` runs a single-node replica set `rs0`. Its health check
  (`infrastructure/mongo/init-replica-set.js`) initiates the set idempotently and reports healthy
  only once the node is the writable primary. Connect with
  `mongodb://localhost:27017/stayscape?directConnection=true`.
- Tests: `mongodb-memory-server` starts an in-memory single-node replica set
  (`MONGO_TEST_URI` overrides it with an existing one).
- Production: a managed replica set (e.g. MongoDB Atlas) with authentication and TLS.

`autoIndex` is enabled outside production. In production run `npm run db:indexes`
(`node dist/scripts/sync-indexes.js`) as a release step.

Conventions: timestamps are UTC `Date`s; future inventory will use explicit property-local calendar
dates (`YYYY-MM-DD` strings) and money will be integer minor units (`packages/shared/src/utils/money.ts`).

## Collections

### users

| Field                                                            | Type                                           | Notes                                                   |
| ---------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| firstName, lastName                                              | string ≤ 60                                    |                                                         |
| email                                                            | string                                         | trimmed, lower-cased, **unique**                        |
| phone                                                            | string \| null                                 | E.164                                                   |
| passwordHash                                                     | string                                         | Argon2id, `select: false`, removed from JSON            |
| avatar                                                           | `{url,key,contentType,size,updatedAt}` \| null |                                                         |
| roles                                                            | Role[]                                         | enum-validated, non-empty, unique; default `[CUSTOMER]` |
| accountStatus                                                    | ACTIVE \| SUSPENDED \| DEACTIVATED             | enforced on login, refresh and every request            |
| emailVerifiedAt, phoneVerifiedAt, lastLoginAt, passwordChangedAt | Date \| null                                   |                                                         |
| preferences                                                      | `{language, currency, notifications{…}}`       |                                                         |
| createdAt, updatedAt                                             | Date                                           |                                                         |

Indexes: `uniq_email {email:1} unique`, `roles {roles:1}`, `status_created {accountStatus:1, createdAt:-1}`.

### refreshsessions

`userId, tokenHash (SHA-256), tokenFamily, familyCreatedAt, deviceInformation{userAgent,label},
ipAddress, expiresAt, revokedAt, revokedReason, createdAt`

Indexes: `uniq_token_hash` (unique), `family_revoked {tokenFamily, revokedAt}`,
`user_active {userId, revokedAt, expiresAt}`, `ttl_expires {expiresAt} expireAfterSeconds: 0`
(expired sessions are cleaned up by MongoDB's TTL monitor).

### verificationtokens

`userId, purpose (EMAIL_VERIFICATION | PASSWORD_RESET), tokenHash, expiresAt, consumedAt, createdAt`

Indexes: `uniq_token_hash` (unique), `user_purpose {userId, purpose, consumedAt}`, TTL on `expiresAt`.

### auditlogs

`actorId, action, entityType, entityId, metadata, ipAddress, requestId, timestamp`

Metadata passes through `sanitizeMetadata` (redacts keys matching password/secret/token/
authorization/cookie/otp/cvv/card/pan/api-key, bounds depth and string length).
Indexes: `timestamp`, `actor_timestamp`, `entity_timestamp`, `action_timestamp`.

### notifications

`userId, type, channel (IN_APP | EMAIL | SMS | PUSH), title, body, deliveryStatus (PENDING | SENT |
DELIVERED | FAILED), deliveredAt, failureReason, readAt, resource{type,id}, createdAt, updatedAt`

In-app notifications are recorded as DELIVERED when stored (the inbox is the delivery). External
channels start as PENDING and will be updated by their workers — no delivery is ever faked.
Indexes: `user_created`, `user_unread`, `delivery_queue {channel, deliveryStatus}`.

### newslettersubscriptions

`email (unique), status, source, consentedAt, ipAddress` — idempotent upsert.

## Backups and data

Docker volumes: `mongo-data`, `mongo-config`, `redis-data`, `api-uploads`. `docker compose down -v`
deletes them. No seed data exists; the only development fixture is the optional admin bootstrap.
