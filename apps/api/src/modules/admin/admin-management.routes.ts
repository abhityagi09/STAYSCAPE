import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  adminBookingsQuerySchema,
  adminPaymentsQuerySchema,
  adminPromotionsQuerySchema,
  adminRefundsQuerySchema,
  adminUsersQuerySchema,
  amenityUpsertSchema,
  bookingEscalationSchema,
  bookingReferenceSchema,
  catalogListQuerySchema,
  destinationUpsertSchema,
  escalationResolveSchema,
  escalationsQuerySchema,
  objectIdSchema,
  propertyCategoryUpsertSchema,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendMessage, sendSuccess } from '@/lib/http';
import {
  requestContext,
  requireAuth,
  validatedParams,
  validatedQuery,
} from '@/lib/request-context';
import { validate } from '@/middleware/validate';
import { requirePermission } from '@/modules/permissions/permission.middleware';

const idParam = z.object({ id: objectIdSchema });
const id = (req: Request) => validatedParams<{ id: string }>(req).id;
type Q = Parameters<Container['services']['adminManagement']['listBookings']>[0];

/** /api/v1/admin/(users|catalog|bookings|payments|refunds|escalations) — admin records and catalogue. */
export function createAdminManagementRouter(container: Container): Router {
  const router = Router();
  const { adminManagement: admin } = container.services;
  router.use(
    ['/customers', '/catalog', '/bookings', '/payments', '/refunds', '/escalations', '/promotions'],
    container.authenticate,
    requirePermission('admin:access'),
  );

  // Customers (read: users:read; status changes stay on the Phase 1 /users/:id/status endpoint).
  router.get(
    '/customers',
    requirePermission('users:read'),
    validate({ query: adminUsersQuerySchema }),
    async (req, res) => sendSuccess(res, await admin.listUsers(validatedQuery(req))),
  );
  router.get(
    '/customers/:id',
    requirePermission('users:read'),
    validate({ params: idParam }),
    async (req, res) => sendSuccess(res, await admin.userDetail(id(req))),
  );

  // Catalogue: amenities, destinations, property categories (catalog:manage).
  const kinds = {
    amenities: ['amenity', amenityUpsertSchema],
    destinations: ['destination', destinationUpsertSchema],
    categories: ['category', propertyCategoryUpsertSchema],
  } as const;
  for (const [path, [kind, schema]] of Object.entries(kinds)) {
    router.get(
      `/catalog/${path}`,
      requirePermission('catalog:manage'),
      validate({ query: catalogListQuerySchema }),
      async (req, res) => sendSuccess(res, await admin.listCatalog(kind, validatedQuery(req))),
    );
    router.post(
      `/catalog/${path}`,
      requirePermission('catalog:manage'),
      validate({ body: schema }),
      async (req, res) =>
        sendSuccess(
          res,
          await admin.saveCatalog(
            requireAuth(req).userId,
            kind,
            null,
            req.body as Record<string, unknown>,
            requestContext(req),
          ),
          201,
        ),
    );
    router.put(
      `/catalog/${path}/:id`,
      requirePermission('catalog:manage'),
      validate({ params: idParam, body: schema }),
      async (req, res) =>
        sendSuccess(
          res,
          await admin.saveCatalog(
            requireAuth(req).userId,
            kind,
            id(req),
            req.body as Record<string, unknown>,
            requestContext(req),
          ),
        ),
    );
    router.delete(
      `/catalog/${path}/:id`,
      requirePermission('catalog:manage'),
      validate({ params: idParam }),
      async (req, res) => {
        await admin.deleteCatalog(requireAuth(req).userId, kind, id(req), requestContext(req));
        sendMessage(res, 'Deleted.');
      },
    );
  }

  // Bookings, payments, refunds.
  router.get(
    '/bookings',
    requirePermission('bookings:read-all'),
    validate({ query: adminBookingsQuerySchema }),
    async (req, res) => sendSuccess(res, await admin.listBookings(validatedQuery<Q>(req))),
  );
  router.post(
    '/bookings/:reference/escalations',
    requirePermission('bookings:manage'),
    validate({
      params: z.object({ reference: bookingReferenceSchema }),
      body: bookingEscalationSchema,
    }),
    async (req, res) =>
      sendSuccess(
        res,
        await admin.escalate(
          requireAuth(req),
          validatedParams<{ reference: string }>(req).reference,
          req.body as { reason: string; priority: 'HIGH' },
          requestContext(req),
        ),
        201,
      ),
  );
  router.get(
    '/escalations',
    requirePermission('bookings:read-all'),
    validate({ query: escalationsQuerySchema }),
    async (req, res) => sendSuccess(res, await admin.listEscalations(validatedQuery(req))),
  );
  router.post(
    '/escalations/:id/resolve',
    requirePermission('bookings:manage'),
    validate({ params: idParam, body: escalationResolveSchema }),
    async (req, res) =>
      sendSuccess(
        res,
        await admin.resolveEscalation(
          requireAuth(req),
          id(req),
          (req.body as { resolution: string }).resolution,
          requestContext(req),
        ),
      ),
  );
  router.get(
    '/payments',
    requirePermission('payments:read'),
    validate({ query: adminPaymentsQuerySchema }),
    async (req, res) => sendSuccess(res, await admin.listPayments(validatedQuery(req))),
  );
  // Partner discounts across the marketplace (read-only oversight; partners own their rules).
  router.get(
    '/promotions',
    requirePermission('coupons:manage'),
    validate({ query: adminPromotionsQuerySchema }),
    async (req, res) => sendSuccess(res, await admin.listPromotions(validatedQuery(req))),
  );
  router.get(
    '/refunds',
    requirePermission('payments:read'),
    validate({ query: adminRefundsQuerySchema }),
    async (req, res) => sendSuccess(res, await admin.listRefunds(validatedQuery(req))),
  );
  return router;
}

/** /api/v1/categories — public browse categories. */
export function createCategoriesRouter(container: Container): Router {
  const router = Router();
  router.get('/', async (_req, res) =>
    sendSuccess(res, await container.services.adminManagement.publicCategories()),
  );
  return router;
}
