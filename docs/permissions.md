# Permissions and tenant isolation

The role → permission matrix is defined once in `packages/shared/src/constants/permissions.ts`
and used by both the API (enforcement) and the web app (what to show). The overview of roles and
the original matrix are in docs/rbac.md; this document describes enforcement and isolation.

## Roles

| Role               | Scope                                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guest (signed out) | Public catalogue, quotes, auth flows, share links by token.                                                                                                                |
| `CUSTOMER`         | Their own bookings, payments, refunds, reviews, saved lists, trips, support tickets, rewards, data export and deletion.                                                    |
| `HOTEL_OWNER`      | Their partner business: properties, rooms, rates, inventory, reservations, reviews, team, finance (owner-only data), analytics.                                            |
| `HOTEL_STAFF`      | Only the properties they are assigned to, and only the actions their delegated permissions allow (e.g. `bookings:check-in`, `rooms:manage`, `financials:view`).            |
| `SUPPORT`          | Admin console read access to users, bookings and payments; the support queue. No user management, refunds, commissions, settlements or moderation.                         |
| `ADMIN`            | Platform operations: users (non-privileged roles), moderation, partners, properties, refunds, commissions, settlements, coupons, content, catalogue, analytics, audit log. |
| `SUPER_ADMIN`      | Everything, including assigning privileged roles and `system:configure` (e.g. retrying dead-lettered jobs).                                                                |

Corporate travel adds organisation roles (`ORG_ADMIN`, `APPROVER`, `EMPLOYEE`) checked per
organisation: members only ever see their own organisation's data.

## Enforcement layers

1. **Authentication** (`container.authenticate`): verifies the access token and that its session is
   still active (suspension, logout-all and password changes revoke immediately).
2. **Permission middleware** (`requirePermission`, `requireAnyPermission`) on routers and routes.
3. **Resource checks** in services: ownership (customer → booking), membership and delegated
   permission (staff → property), organisation membership (corporate). Records the caller may not
   see answer **404**, not 403, so their existence is not disclosed.
4. **Privileged-role rules**: nobody changes their own roles; only super administrators grant or
   remove `ADMIN`/`SUPER_ADMIN`; admins cannot suspend more senior accounts.
5. **Validation**: strict schemas reject unknown fields, so permissions cannot be bypassed by
   adding fields (mass assignment).

## Verification

`apps/api/src/modules/permissions/authorization-matrix.test.ts` discovers **every registered
route (300)** at runtime and calls each one as guest, customer, hotel owner, hotel staff, support
agent, administrator and super administrator:

- a super-administrator pass records which permission checks each route actually enforces;
- every other role must be refused (401 guest / 403 signed in) exactly when it lacks one of
  those permissions, and must get past authorisation otherwise;
- partner workspace routes must admit the approved owner and refuse non-members (403/404, or a
  schema-only 422 that reveals no data; a 200 must be empty);
- no route may answer 5xx for any role;
- the set of routes reachable without signing in is **pinned** (44 routes: catalogue, auth
  flows, quotes, token share links, health, OpenAPI), so a new endpoint cannot become public by
  accident.

Ownership and direct-object-reference tests: customer A vs B bookings ("isolates customers"),
partner A vs B hotels ("requires an approved partner and enforces ownership"), staff property
scoping ("enforces the specific permission for the specific property"), staff financial data
("financials:view … for their properties only"), support cannot manage users or commissions,
admins cannot grant privileged roles, corporate organisation isolation, trip collaborators,
support ticket attachments.
