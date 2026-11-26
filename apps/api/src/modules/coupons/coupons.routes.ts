import { Router } from 'express';
import { z } from 'zod';
import { couponCheckSchema, couponSchema, objectIdSchema, pageQuerySchema, periodQuerySchema, type CouponInputDto } from '@stayscape/shared';
import type { Container } from '@/container';
import { Errors } from '@/lib/errors';
import { sendSuccess } from '@/lib/http';
import { requestContext, requireAuth, validatedParams, validatedQuery } from '@/lib/request-context';
import { validate } from '@/middleware/validate';
import { BookingHoldModel, type BookingHoldRecord } from '@/modules/bookings/booking.models';
import { periodFrom } from '@/modules/finance/finance.routes';
import { requirePermission } from '@/modules/permissions/permission.middleware';

/** /api/v1/coupons/check — preview a code against the customer's own live hold (server-priced). */
export function createCouponsRouter(container: Container): Router {
  const router = Router();
  router.use(container.authenticate);
  router.post('/check', validate({ body: couponCheckSchema }), async (req, res) => {
    const body = req.body as z.output<typeof couponCheckSchema>;
    const auth = requireAuth(req);
    const hold = await BookingHoldModel.findOne({ holdReference: body.holdReference, customerId: auth.userId, status: 'ACTIVE' }).lean<BookingHoldRecord>();
    if (!hold) throw Errors.notFound('Hold');
    const totals = hold.price.totals;
    const result = await container.services.coupons.evaluate(body.code, {
      userId: auth.userId,
      hotelId: hold.hotelId.toString(),
      city: hold.hotelSnapshot.city,
      currency: hold.price.currency,
      subtotalMinor: totals.subtotalMinor,
      totalMinor: totals.totalMinor,
      hasRateDiscounts: totals.discountsMinor !== 0,
    });
    sendSuccess(res, { code: result.coupon.code, name: result.coupon.name, discountMinor: result.discountMinor, newTotalMinor: totals.totalMinor - result.discountMinor, currency: hold.price.currency });
  });
  return router;
}

/** /api/v1/admin/coupons */
export function createAdminCouponsRouter(container: Container): Router {
  const router = Router();
  const { coupons } = container.services;
  router.use('/coupons', container.authenticate, requirePermission('admin:access'));
  router.get('/coupons', requirePermission('payments:read'), validate({ query: pageQuerySchema.extend({ q: z.string().trim().max(60).optional() }) }), async (req, res) => {
    const q = validatedQuery<{ page: number; limit: number; q?: string }>(req);
    sendSuccess(res, await coupons.list(q.page, q.limit, q.q));
  });
  router.get('/coupons/performance', requirePermission('payments:read'), validate({ query: periodQuerySchema }), async (req, res) => {
    const { from, to } = periodFrom(validatedQuery(req));
    sendSuccess(res, await coupons.performance(from, to));
  });
  router.post('/coupons', requirePermission('coupons:manage'), validate({ body: couponSchema }), async (req, res) => {
    sendSuccess(res, await coupons.save(requireAuth(req).userId, null, req.body as CouponInputDto, requestContext(req)), 201);
  });
  router.put('/coupons/:id', requirePermission('coupons:manage'), validate({ params: z.object({ id: objectIdSchema }), body: couponSchema }), async (req, res) => {
    sendSuccess(res, await coupons.save(requireAuth(req).userId, validatedParams<{ id: string }>(req).id, req.body as CouponInputDto, requestContext(req)));
  });
  return router;
}
