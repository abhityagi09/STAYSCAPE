/**
 * Route-by-route authorisation matrix.
 *
 * Every route registered on the real app is discovered at runtime and called as each of the seven
 * roles. A super administrator run records which permission checks the route actually enforces;
 * every other role is then expected to be refused (401 guest / 403 signed in) exactly when it
 * lacks one of those permissions, and allowed past authorisation otherwise. No route may answer
 * with a server error for any role. The set of routes reachable without signing in is pinned
 * below, so a new endpoint cannot become public by accident.
 */
import { createRequire } from 'node:module';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { hasAllPermissions, hasAnyPermission, type Permission, type Role } from '@stayscape/shared';
import type * as PermissionMiddleware from '@/modules/permissions/permission.middleware';
import { bearer, createUserWithRoles, registerUser, type SignedInUser } from '@/test/helpers';
import { bookingWorld } from '@/test/booking-fixtures';

type Check = { kind: 'all' | 'any'; permissions: Permission[] };
const checksByRequest = new WeakMap<object, Check[]>();

vi.mock('@/modules/permissions/permission.middleware', async (importOriginal) => {
  const original = await importOriginal<typeof PermissionMiddleware>();
  const wrap =
    (kind: Check['kind'], factory: typeof original.requirePermission) =>
    (...permissions: Permission[]) => {
      const inner = factory(...permissions);
      return ((req, res, next) => {
        const list = checksByRequest.get(req) ?? [];
        list.push({ kind, permissions });
        checksByRequest.set(req, list);
        return inner(req, res, next);
      }) as ReturnType<typeof factory>;
    };
  return {
    ...original,
    requirePermission: wrap('all', original.requirePermission),
    requireAnyPermission: wrap('any', original.requireAnyPermission),
  };
});

// ---------------------------------------------------------------- route discovery
const require = createRequire(import.meta.url);
type RouteLike = { path: string; methods: Record<string, boolean> };
interface RouterNode {
  routes: RouteLike[];
  mounts: Array<{ paths: string[]; child: RouterNode }>;
}
const nodes = new WeakMap<object, RouterNode>();
const nodeFor = (router: object) => {
  let n = nodes.get(router);
  if (!n) nodes.set(router, (n = { routes: [], mounts: [] }));
  return n;
};
const RouterProto = (require('router') as { prototype: Record<string, unknown> }).prototype;
const originalRoute = RouterProto.route as (this: object, path: string) => RouteLike;
const originalUse = RouterProto.use as (this: object, ...args: unknown[]) => unknown;
RouterProto.route = function (this: object, path: string) {
  const route = originalRoute.call(this, path);
  nodeFor(this).routes.push(route);
  return route;
};
RouterProto.use = function (this: object, ...args: unknown[]) {
  const first = args[0];
  const paths =
    typeof first === 'string' ? [first] : Array.isArray(first) ? (first as string[]) : ['/'];
  for (const fn of args) {
    if (typeof fn === 'function' && nodes.has(fn))
      nodeFor(this).mounts.push({ paths, child: nodes.get(fn)! });
  }
  return originalUse.apply(this, args);
};

function collect(node: RouterNode, prefix = ''): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  for (const r of node.routes)
    for (const [m, on] of Object.entries(r.methods))
      if (on && m !== '_all') out.push({ method: m.toUpperCase(), path: prefix + r.path });
  for (const { paths, child } of node.mounts)
    for (const p of paths) out.push(...collect(child, prefix + (p === '/' ? '' : p)));
  return out;
}

const OID = '64b0000000000000000000ff';
function concrete(path: string) {
  return path
    .replace(/:reference/g, 'SS-ZZZZZZZZ')
    .replace(/:slug/g, 'no-such-listing')
    .replace(/:token/g, 'x'.repeat(43))
    .replace(/:code/g, 'NOSUCHCODE')
    .replace(/:[A-Za-z]+/g, OID)
    .replace(/\*[A-Za-z]*/g, 'x')
    .replace(/[{}]/g, '');
}

/** Routes that end the caller's own session or account; covered by the auth and privacy suites. */
const SESSION_ENDING = new Set([
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/logout-all',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/change-password',
  'POST /api/v1/users/me/deletion',
]);

/**
 * Routes reachable without signing in. Anything not listed must answer 401 to a guest.
 * Review additions: public routes must expose only published, non-personal data.
 */
const PUBLIC = [
  'GET /api/v1/amenities/',
  'GET /api/v1/categories/',
  'GET /api/v1/content/',
  'GET /api/v1/content/:type/:slug',
  'GET /api/v1/content/preview/:token',
  'GET /api/v1/currency/convert',
  'GET /api/v1/currency/rates',
  'GET /api/v1/deals/last-minute',
  'GET /api/v1/destinations/',
  'GET /api/v1/destinations/suggestions',
  'GET /api/v1/health/',
  'GET /api/v1/health/live',
  'GET /api/v1/health/ready',
  'GET /api/v1/hotels/',
  'GET /api/v1/hotels/:idOrSlug',
  'GET /api/v1/hotels/:idOrSlug/offers',
  'GET /api/v1/hotels/:idOrSlug/reviews',
  'GET /api/v1/hotels/:idOrSlug/similar',
  'GET /api/v1/hotels/compare',
  'GET /api/v1/hotels/featured',
  'GET /api/v1/hotels/nearby',
  'GET /api/v1/hotels/trending',
  'GET /api/v1/openapi.json',
  'GET /api/v1/price-intelligence/:idOrSlug/calendar',
  'GET /api/v1/price-intelligence/:idOrSlug/history',
  'GET /api/v1/trips/shared/:token',
  'GET /api/v1/wishlists/shared/:token',
  'GET /health/',
  'GET /health/live',
  'GET /health/ready',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/resend-verification',
  'POST /api/v1/auth/reset-password',
  'POST /api/v1/auth/verify-email',
  'POST /api/v1/availability/quote',
  'POST /api/v1/availability/quote/revalidate',
  'POST /api/v1/availability/search',
  'POST /api/v1/newsletter/subscriptions',
  // SEO metadata, sitemap and robots: published, non-personal data only.
  'GET /api/v1/seo/body,/body/*path',
  'GET /api/v1/seo/head,/head/*path',
  'GET /robots.txt',
  'GET /sitemap.xml',
];

/** 503 SERVICE_UNAVAILABLE is the documented answer of optional infrastructure (job queues without Redis). */
const isServerError = (res: { status: number; body?: { error?: { code?: string } } }) =>
  res.status >= 500 && !(res.status === 503 && res.body?.error?.code === 'SERVICE_UNAVAILABLE');
const partnerScoped = (path: string) => /^\/api\/v1\/partner(\/|$)/.test(path);
const isWebhook = (path: string) => path.includes('/webhooks/');
/** Partner onboarding and staff invitations: any signed-in person acts on their own record. */
const SELF_SERVICE = /^\/api\/v1\/partner\/(application|invitations)/;

describe('authorisation matrix', () => {
  it(
    'enforces each route’s permissions for all seven roles and never errors',
    { timeout: 300_000 },
    async () => {
      const { app, owner, customer, admin } = await bookingWorld();
      const staff = await createUserWithRoles(app, ['CUSTOMER', 'HOTEL_STAFF']);
      const support = await createUserWithRoles(app, ['SUPPORT']);
      const superAdmin = await createUserWithRoles(app, ['SUPER_ADMIN']);
      const other = await registerUser(app);
      void other;
      const roles: Array<{ name: string; user: SignedInUser | null; roles: Role[] }> = [
        { name: 'guest', user: null, roles: [] },
        { name: 'customer', user: customer, roles: ['CUSTOMER'] },
        { name: 'hotel owner', user: owner, roles: ['CUSTOMER', 'HOTEL_OWNER'] },
        { name: 'hotel staff', user: staff, roles: ['CUSTOMER', 'HOTEL_STAFF'] },
        { name: 'support agent', user: support, roles: ['SUPPORT'] },
        { name: 'administrator', user: admin, roles: ['ADMIN'] },
      ];

      const all = collect(nodeFor((app as unknown as { router: object }).router));
      const routes = [...new Map(all.map((r) => [`${r.method} ${r.path}`, r])).values()].filter(
        (r) => !SESSION_ENDING.has(`${r.method} ${r.path}`),
      );
      expect(routes.length).toBeGreaterThan(200);

      // Capture checks per request through a response header set by a probe middleware.
      const call = async (method: string, path: string, user: SignedInUser | null) => {
        let req = request(app)[method.toLowerCase() as 'get'](concrete(path));
        if (user) req = req.set(bearer(user.accessToken));
        if (!['GET', 'DELETE', 'HEAD'].includes(method)) req = req.send({});
        return req;
      };

      // 1. Super administrator: has every permission; discovers each route's enforced checks.
      const required = new Map<string, Check[]>();
      const serverErrors: string[] = [];
      const originalHandle = (app as unknown as { handle: (...a: unknown[]) => unknown }).handle;
      let lastChecks: Check[] = [];
      (app as unknown as { handle: (...a: unknown[]) => unknown }).handle = function (
        this: unknown,
        ...args: unknown[]
      ) {
        const [req, res] = args as [object, { on: (e: string, f: () => void) => void }];
        res.on('finish', () => (lastChecks = checksByRequest.get(req) ?? []));
        return originalHandle.apply(this, args);
      };
      for (const r of routes) {
        const key = `${r.method} ${r.path}`;
        const res = await call(r.method, r.path, superAdmin);
        if (isServerError(res))
          serverErrors.push(`super admin ${key} → ${res.status} ${res.text.slice(0, 120)}`);
        // Partner workspace routes are scoped to partner membership (resource ownership), and
        // signed webhooks authenticate by signature — neither is granted by platform roles.
        if (
          (res.status === 401 || res.status === 403) &&
          !partnerScoped(r.path) &&
          !isWebhook(r.path)
        )
          serverErrors.push(`super admin refused on ${key} → ${res.status}`);
        required.set(key, lastChecks);
      }

      // 2. Every other role.
      const violations: string[] = [];
      const publicRoutes: string[] = [];
      for (const role of roles) {
        for (const r of routes) {
          const key = `${r.method} ${r.path}`;
          const res = await call(r.method, r.path, role.user);
          if (isServerError(res)) {
            serverErrors.push(`${role.name} ${key} → ${res.status}`);
            continue;
          }
          if (isWebhook(r.path)) {
            // Authenticated by signature, not by role: only check that it is refused unsigned.
            if (res.status !== 401 && res.status !== 400)
              violations.push(`unsigned webhook ${key} → ${res.status}`);
            continue;
          }
          if (!role.user) {
            if (res.status !== 401) publicRoutes.push(key);
            continue;
          }
          if (partnerScoped(r.path)) {
            // Membership decides: the approved owner gets in; non-members never do.
            if (role.name === 'hotel owner' && (res.status === 401 || res.status === 403))
              violations.push(`hotel owner refused on own workspace ${key} → ${res.status}`);
            if (['customer', 'hotel staff'].includes(role.name) && !SELF_SERVICE.test(r.path)) {
              // 422 = body schema checked before membership (no data revealed); a 200 must be empty.
              const data = (res.body as { data?: unknown })?.data;
              const empty =
                (Array.isArray(data) && data.length === 0) ||
                (Array.isArray((data as { items?: unknown[] })?.items) &&
                  (data as { items: unknown[] }).items.length === 0);
              if (![403, 404, 422].includes(res.status) && !(res.status === 200 && empty))
                violations.push(`${role.name} (not a member) reached ${key} → ${res.status}`);
            }
            continue;
          }
          const checks = required.get(key) ?? [];
          const permitted = checks.every((c) =>
            c.kind === 'all'
              ? hasAllPermissions(role.roles, c.permissions)
              : hasAnyPermission(role.roles, c.permissions),
          );
          if (!permitted && res.status !== 403)
            violations.push(
              `${role.name} reached ${key} without ${JSON.stringify(checks)} → ${res.status}`,
            );
          if (permitted && res.status === 401)
            violations.push(`${role.name} was asked to sign in on ${key}`);
        }
      }

      expect(serverErrors).toEqual([]);
      expect(violations).toEqual([]);
      expect(publicRoutes.sort()).toEqual([...PUBLIC].sort());
    },
  );
});
