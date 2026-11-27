# Administration and operations

Console: `/admin`. Every state-changing action is written to the audit log (actor, action,
entity, request id, IP; secrets redacted).

| Area                                                                                                                                                          | Route                                      | Permission                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Platform dashboard (GBV, commission, refunds, customers, partners, settlements, comparison)                                                                   | `/admin/dashboard`                         | `reports:view`                                                     |
| Reports and analytics                                                                                                                                         | `/admin/reports`                           | `analytics:platform`                                               |
| Partner verification                                                                                                                                          | `/admin/partners`                          | `partners:approve`                                                 |
| Property moderation and revisions                                                                                                                             | `/admin/properties`                        | `hotels:moderate`                                                  |
| Users, roles, suspension                                                                                                                                      | `/admin/users`, `/admin/customers`         | `users:read` / `users:manage` (privileged roles: super admin only) |
| Bookings (search, escalation)                                                                                                                                 | `/admin/bookings`                          | `bookings:read-all`                                                |
| Payments, refunds, refund decisions and retries                                                                                                               | `/admin/payments`, `/admin/refunds`        | `payments:read` / `refunds:manage`                                 |
| Operations: reconciliation-required bookings, failed/pending refunds, failed deliveries, reported reviews, outbox, **background jobs** (dead letters + retry) | `/admin/operations`                        | `payments:read`; job retry `system:configure`                      |
| Commissions (global/partner/property rules, preview)                                                                                                          | `/admin/commissions`                       | view `payments:read`, change `commissions:manage`                  |
| Settlements (create from eligible entries, hold, record payment with evidence)                                                                                | `/admin/settlements`                       | view `payments:read`, change `settlements:manage`                  |
| Financial reconciliation report                                                                                                                               | `GET /api/v1/admin/finance/reconciliation` | `payments:read`                                                    |
| Coupons and promotions oversight                                                                                                                              | `/admin/coupons`, `/admin/promotions`      | `coupons:manage`                                                   |
| Support queue                                                                                                                                                 | `/admin/support`                           | `support:manage`                                                   |
| Review moderation                                                                                                                                             | `/admin/reviews`                           | `reviews:moderate`                                                 |
| Content (guides, blog, legal, FAQ, banners) with schedule and preview                                                                                         | `/admin/content`                           | `content:manage`                                                   |
| Catalogue (amenities, destinations, categories)                                                                                                               | `/admin/catalog`                           | `catalog:manage`                                                   |
| Corporate organisations                                                                                                                                       | `/admin/organizations`                     | `users:manage`                                                     |
| Audit log                                                                                                                                                     | `/admin/audit-logs`                        | `audit:read`                                                       |

## Daily checklist

1. Operations page: reconciliation-required bookings, failed refunds, failed deliveries, dead-lettered jobs — all should be empty.
2. Reconciliation report for the previous day: 0 exceptions.
3. Partner applications and property revisions awaiting review.
4. Support queue by priority; reported reviews.

## Payouts

Automated payouts are disabled until a payout provider is onboarded (`PAYOUT_PROVIDER=disabled`).
Finance pays by bank transfer and records the transfer reference and a confirmation document; a
settlement is never marked paid without that evidence.
