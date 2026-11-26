import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  adminRefundSchema,
  bookingReferenceSchema,
  objectIdSchema,
  partnerNoShowSchema,
  partnerRejectSchema,
  refundDecisionSchema,
  reviewModerationSchema,
  reviewResponseSchema,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendMessage, sendSuccess } from '@/lib/http';
import { requireIdempotencyKey } from '@/lib/idempotency';
import {
  requestContext,
  requireAuth,
  validatedParams,
  validatedQuery,
} from '@/lib/request-context';
import { validate } from '@/middleware/validate';
import { requirePermission } from '@/modules/permissions/permission.middleware';

const hotelParam = z.object({ hotelId: objectIdSchema });
const bookingParams = hotelParam.extend({ reference: bookingReferenceSchema });
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  view: z.enum(['arrivals', 'upcoming', 'past', 'all']).default('upcoming'),
});

/**
 * /api/v1/partner/hotels/:hotelId/(bookings|reviews) — property-side reservation handling.
 * Access is resource-level: the hotel must belong to the caller's partner (owner) or be assigned to
 * them with the BOOKINGS_MANAGE staff permission; other hotels' bookings read as 404.
 */
export function createPartnerBookingsRouter(container: Container): Router {
  const router = Router();
  const { cancellations, reviews } = container.services;
  // Scoped to this router's own paths: the router shares the /partner/hotels prefix with others.
  router.use(
    ['/:hotelId/bookings', '/:hotelId/reviews'],
    container.authenticate,
    requirePermission('bookings:read-property'),
  );
  const p = (req: Request) => validatedParams<{ hotelId: string; reference: string }>(req);

  router.get(
    '/:hotelId/bookings',
    validate({ params: hotelParam, query: listQuery }),
    async (req, res) => {
      sendSuccess(
        res,
        await cancellations.listForPartner(requireAuth(req), p(req).hotelId, validatedQuery(req)),
      );
    },
  );
  router.post(
    '/:hotelId/bookings/:reference/check-in',
    validate({ params: bookingParams }),
    async (req, res) => {
      sendSuccess(
        res,
        await cancellations.checkIn(
          requireAuth(req),
          p(req).hotelId,
          p(req).reference,
          requestContext(req),
        ),
      );
    },
  );
  router.post(
    '/:hotelId/bookings/:reference/check-out',
    validate({ params: bookingParams }),
    async (req, res) => {
      sendSuccess(
        res,
        await cancellations.checkOut(
          requireAuth(req),
          p(req).hotelId,
          p(req).reference,
          requestContext(req),
        ),
      );
    },
  );
  router.post(
    '/:hotelId/bookings/:reference/no-show',
    validate({ params: bookingParams, body: partnerNoShowSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await cancellations.markNoShow(
          requireAuth(req),
          p(req).hotelId,
          p(req).reference,
          (req.body as { note: string }).note,
          requestContext(req),
        ),
      );
    },
  );
  router.post(
    '/:hotelId/bookings/:reference/reject',
    validate({ params: bookingParams, body: partnerRejectSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await cancellations.reject(
          requireAuth(req),
          p(req).hotelId,
          p(req).reference,
          (req.body as { reason: string }).reason,
          requestContext(req),
        ),
      );
    },
  );

  router.get('/:hotelId/reviews', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(res, await reviews.partnerList(requireAuth(req), p(req).hotelId)),
  );
  router.put(
    '/:hotelId/reviews/:reviewId/response',
    validate({
      params: hotelParam.extend({ reviewId: objectIdSchema }),
      body: reviewResponseSchema,
    }),
    async (req, res) => {
      await reviews.respond(
        requireAuth(req),
        p(req).hotelId,
        validatedParams<{ reviewId: string }>(req).reviewId,
        (req.body as { body: string }).body,
        requestContext(req),
      );
      sendMessage(res, 'Response published.');
    },
  );
  return router;
}

/** /api/v1/admin/operations, /admin/refunds, /admin/reviews — initial operations tooling (Phase 4 expands it). */
export function createAdminOperationsRouter(container: Container): Router {
  const router = Router();
  const { operations, refunds, bookingNotifications, reviews } = container.services;
  router.use(
    ['/operations', '/refunds', '/bookings', '/notifications', '/reviews'],
    container.authenticate,
    requirePermission('admin:access'),
  );
  const id = (req: Request) => validatedParams<{ id: string }>(req).id;
  const idParam = z.object({ id: objectIdSchema });

  router.get('/operations', requirePermission('payments:read'), async (_req, res) =>
    sendSuccess(res, await operations.overview()),
  );
  router.post(
    '/refunds/:id/retry',
    requirePermission('refunds:manage'),
    validate({ params: idParam }),
    async (req, res) => sendSuccess(res, await refunds.retry(requireAuth(req).userId, id(req))),
  );
  router.post(
    '/refunds/:id/decision',
    requirePermission('refunds:manage'),
    validate({ params: idParam, body: refundDecisionSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await refunds.decide(
          requireAuth(req).userId,
          id(req),
          req.body as { decision: 'REJECT'; reason: string },
        ),
      );
    },
  );
  router.post(
    '/bookings/:reference/refunds',
    requirePermission('refunds:manage'),
    validate({ params: z.object({ reference: bookingReferenceSchema }), body: adminRefundSchema }),
    async (req, res) => {
      const key = requireIdempotencyKey(req);
      sendSuccess(
        res,
        await operations.refundBooking(
          requireAuth(req).userId,
          validatedParams<{ reference: string }>(req).reference,
          req.body as { amountMinor: number; reason: string },
          key,
          requestContext(req),
        ),
        201,
      );
    },
  );
  router.post(
    '/notifications/deliveries/:id/retry',
    requirePermission('payments:read'),
    validate({ params: idParam }),
    async (req, res) => {
      await bookingNotifications.retryDelivery(id(req));
      sendMessage(res, 'Delivery retried.');
    },
  );
  router.get(
    '/reviews',
    requirePermission('reviews:moderate'),
    validate({
      query: z.object({ status: z.enum(['FLAGGED', 'REMOVED', 'PUBLISHED']).default('FLAGGED') }),
    }),
    async (req, res) => {
      sendSuccess(res, await reviews.adminList(validatedQuery<{ status: 'FLAGGED' }>(req).status));
    },
  );
  router.post(
    '/reviews/:id/moderation',
    requirePermission('reviews:moderate'),
    validate({ params: idParam, body: reviewModerationSchema }),
    async (req, res) => {
      const body = req.body as { decision: 'REMOVE'; reason: string };
      await reviews.moderate(
        requireAuth(req).userId,
        id(req),
        body.decision,
        body.reason,
        requestContext(req),
      );
      sendMessage(res, 'Moderation recorded.');
    },
  );
  return router;
}
