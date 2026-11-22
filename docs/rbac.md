# Roles, permissions and resource access

Defined once in `packages/shared/src/constants/{roles,permissions}.ts` and imported by both apps.
**Only the API enforces them**; the web app uses them solely to decide what navigation to render.

## Roles

| Role          | Rank | Purpose                                          |
| ------------- | ---- | ------------------------------------------------ |
| _(guest)_     | —    | Unauthenticated public access; no role           |
| `CUSTOMER`    | 0    | Default for every self-registered account        |
| `HOTEL_STAFF` | 1    | Delegated property operations                    |
| `HOTEL_OWNER` | 2    | Owns properties and staff                        |
| `SUPPORT`     | 3    | Read-only customer support                       |
| `ADMIN`       | 4    | Platform administration                          |
| `SUPER_ADMIN` | 5    | Everything, including privileged role assignment |

A user may hold several roles; effective permissions are the union.

## Permission matrix

| Permission                                                                  | CUSTOMER | HOTEL_STAFF | HOTEL_OWNER | SUPPORT | ADMIN | SUPER_ADMIN |
| --------------------------------------------------------------------------- | :------: | :---------: | :---------: | :-----: | :---: | :---------: |
| bookings:create / read-own / cancel-own, reviews:create                     |    ✓     |             |             |         |       |      ✓      |
| partner:access, rooms:manage, bookings:read-property                        |          |      ✓      |      ✓      |         |       |      ✓      |
| hotels:create, hotels:update, staff:manage                                  |          |             |      ✓      |         |       |      ✓      |
| reports:view                                                                |          |             |      ✓      |         |   ✓   |      ✓      |
| admin:access, users:read, bookings:read-all, payments:read                  |          |             |             |    ✓    |   ✓   |      ✓      |
| users:manage, hotels:moderate, partners:approve, refunds:manage, audit:read |          |             |             |         |   ✓   |      ✓      |
| roles:assign-privileged, system:configure                                   |          |             |             |         |       |      ✓      |

## Enforcement

- `requirePermission(...)` / `requireAnyPermission(...)` middleware after `authenticate`
  (`modules/permissions/permission.middleware.ts`). Roles are read from the database on every
  request, so role changes apply immediately.
- **Resource ownership is separate from roles** (`modules/permissions/ownership.policy.ts`):
  `canAccessResource(principal, { ownerId, memberIds }, { permission, overridePermission })`
  requires the permission **and** ownership/membership; only an explicit platform override such
  as `hotels:moderate` bypasses ownership. Denials surface as **404**, so probing another owner's
  ID reveals nothing. Phase 1 applies the same rule to sessions and notifications (queries are
  scoped by `userId`), and Phase 2 property endpoints will use the policy directly.
- **Role assignment rules** (`checkRoleChange`): requires `users:manage`; nobody changes their own
  roles; ADMIN/SUPER_ADMIN can only be granted or removed by a SUPER_ADMIN; non-super-admins cannot
  modify accounts of equal or higher rank. Status changes follow the same seniority rule and
  suspending an account revokes all of its sessions.
- Public registration uses a strict schema — any `roles`/`accountStatus` field is rejected with 422.

## Administrator bootstrap (development only)

```bash
ADMIN_BOOTSTRAP_EMAIL=admin@stayscape.local ADMIN_BOOTSTRAP_PASSWORD='Choose-A-Str0ng-One' npm run bootstrap:admin
```

The script refuses to run when `NODE_ENV=production` or when `MONGO_URI` points at a non-local
host (`localhost`, `127.0.0.1`, `::1`, `mongo`). It creates the account (or promotes an existing
one) with `SUPER_ADMIN`, marks the email verified and never prints the password. Production
administrators must be provisioned through an audited operational procedure.
