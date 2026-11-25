import express, { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  IMAGE_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_BYTES,
  bookingReferenceParams,
  cancelBookingSchema,
  createBookingSchema,
  createHoldSchema,
  createTicketSchema,
  listBookingsQuerySchema,
  objectIdSchema,
  publicReviewsQuerySchema,
  refundRequestSchema,
  reviewReportSchema,
  reviewSchema,
  sandboxCompleteSchema,
  ticketMessageSchema,
  verifyPaymentSchema,
  wishlistAvailabilityQuerySchema,
  createWishlistSchema,
  updateWishlistSchema,
  wishlistItemSchema,
  type CreateBookingInput,
  type CreateHoldInput,
  type ListBookingsQuery,
  type ReviewInput,
  type VerifyPaymentInput,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { Errors } from '@/lib/errors';
import { sendMessage, sendSuccess } from '@/lib/http';
import { requireIdempotencyKey } from '@/lib/idempotency';
import {
  requestContext,
  requireAuth,
  validatedParams,
  validatedQuery,
} from '@/lib/request-context';
import { validate, zodErrorDetails } from '@/middleware/validate';
import { requirePermission } from '@/modules/permissions/permission.middleware';

const ref = (req: Request) => validatedParams<{ reference: string }>(req).reference;
const idParam = z.object({ id: objectIdSchema });
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 2 },
});
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TICKET_ATTACHMENT_MAX_BYTES, files: 1, fields: 6, fieldSize: 10_000 },
});

export function sendDownload(res: Response, body: Buffer, contentType: string, fileName: string) {
  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName.replace(/[^\w.-]/g, '_')}"`,
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
}

/** /api/v1/bookings — the signed-in customer's reservations. */
export function createBookingsRouter(container: Container): Router {
  const router = Router();
  const { bookings, payments, cancellations, documents, reviews } = container.services;
  router.use(container.authenticate);
  const canBook = requirePermission('bookings:create');
  const canRead = requirePermission('bookings:read-own');
  const canCancel = requirePermission('bookings:cancel-own');
  const holdParams = z.object({
    reference: z.string().regex(/^HLD-[A-Z0-9]{10}$/, 'Invalid hold reference'),
  });

  router.post('/holds', canBook, validate({ body: createHoldSchema }), async (req, res) => {
    const key = requireIdempotencyKey(req);
    sendSuccess(
      res,
      await bookings.createHold(
        requireAuth(req),
        req.body as CreateHoldInput,
        key,
        requestContext(req),
      ),
      201,
    );
  });
  router.get('/holds/:reference', canRead, validate({ params: holdParams }), async (req, res) =>
    sendSuccess(res, await bookings.getHold(requireAuth(req), ref(req))),
  );
  router.delete('/holds/:reference', canBook, validate({ params: holdParams }), async (req, res) =>
    sendSuccess(res, await bookings.releaseHold(requireAuth(req), ref(req))),
  );

  router.post('/', canBook, validate({ body: createBookingSchema }), async (req, res) => {
    const key = requireIdempotencyKey(req);
    sendSuccess(
      res,
      await bookings.createBooking(
        requireAuth(req),
        req.body as CreateBookingInput,
        key,
        requestContext(req),
      ),
      201,
    );
  });
  router.get('/', canRead, validate({ query: listBookingsQuerySchema }), async (req, res) =>
    sendSuccess(res, await bookings.list(requireAuth(req), validatedQuery<ListBookingsQuery>(req))),
  );
  router.get(
    '/:reference',
    canRead,
    validate({ params: bookingReferenceParams }),
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, await bookings.detail(requireAuth(req), ref(req)));
    },
  );

  // Cancellation (policy preview, then the explicit operation)
  router.get(
    '/:reference/cancellation',
    canCancel,
    validate({ params: bookingReferenceParams }),
    async (req, res) => sendSuccess(res, await cancellations.quote(requireAuth(req), ref(req))),
  );
  router.post(
    '/:reference/cancel',
    canCancel,
    validate({ params: bookingReferenceParams, body: cancelBookingSchema }),
    async (req, res) => {
      requireIdempotencyKey(req);
      sendSuccess(
        res,
        await cancellations.cancel(
          requireAuth(req),
          ref(req),
          (req.body as { reason: string }).reason,
          requestContext(req),
        ),
      );
    },
  );
  router.post(
    '/:reference/refund-requests',
    canCancel,
    validate({ params: bookingReferenceParams, body: refundRequestSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await cancellations.requestRefund(
          requireAuth(req),
          ref(req),
          (req.body as { reason: string }).reason,
        ),
        201,
      );
    },
  );

  // Payments
  router.post(
    '/:reference/payments',
    canBook,
    validate({ params: bookingReferenceParams }),
    async (req, res) => {
      const key = requireIdempotencyKey(req);
      sendSuccess(
        res,
        await payments.createOrder(requireAuth(req), ref(req), key, requestContext(req)),
        201,
      );
    },
  );
  router.post(
    '/:reference/payments/verify',
    canBook,
    validate({ params: bookingReferenceParams, body: verifyPaymentSchema }),
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(
        res,
        await payments.verify(
          requireAuth(req),
          ref(req),
          req.body as VerifyPaymentInput,
          requestContext(req),
        ),
      );
    },
  );
  if (payments.provider.sandbox) {
    // DEVELOPMENT/TEST ONLY: stands in for the gateway's hosted checkout. Never registered with Razorpay.
    router.post(
      '/:reference/payments/sandbox-complete',
      canBook,
      validate({ params: bookingReferenceParams, body: sandboxCompleteSchema }),
      async (req, res) => {
        sendSuccess(
          res,
          await payments.sandboxComplete(
            requireAuth(req),
            ref(req),
            req.body as { outcome: 'success' | 'failure'; deliverWebhook: boolean },
          ),
        );
      },
    );
  }

  // Documents (ownership is part of every lookup)
  router.get(
    '/:reference/documents/confirmation',
    canRead,
    validate({ params: bookingReferenceParams }),
    async (req, res) => {
      const doc = await documents.confirmationPdf(requireAuth(req).userId, ref(req));
      sendDownload(res, doc.body, 'application/pdf', doc.fileName);
    },
  );
  router.get(
    '/:reference/documents/invoice',
    canRead,
    validate({ params: bookingReferenceParams }),
    async (req, res) => {
      const doc = await documents.invoicePdf(requireAuth(req).userId, ref(req));
      sendDownload(res, doc.body, 'application/pdf', doc.fileName);
    },
  );

  // Verified review for this stay
  router.post(
    '/:reference/review',
    requirePermission('reviews:create'),
    validate({ params: bookingReferenceParams, body: reviewSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await reviews.create(
          requireAuth(req),
          ref(req),
          req.body as ReviewInput,
          requestContext(req),
        ),
        201,
      );
    },
  );
  return router;
}

/**
 * POST /api/v1/payments/webhooks/razorpay — mounted BEFORE the JSON body parser: the signature is
 * computed over the exact raw bytes. No auth (the HMAC signature is the authentication).
 */
export function createPaymentWebhookHandler(container: Container) {
  return [
    express.raw({ type: '*/*', limit: '1mb' }),
    async (req: Request, res: Response) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const headers = {
        'x-razorpay-signature': req.get('x-razorpay-signature'),
        'x-razorpay-event-id': req.get('x-razorpay-event-id'),
      };
      sendSuccess(res, await container.services.payments.handleWebhook(body, headers));
    },
  ] as const;
}

/** /api/v1/account — customer dashboard data. */
export function createAccountRouter(container: Container): Router {
  const router = Router();
  const { lifecycle, payments, refunds, reviews } = container.services;
  router.use(container.authenticate, requirePermission('bookings:read-own'));
  router.get('/overview', async (req, res) =>
    sendSuccess(res, await lifecycle.overview(requireAuth(req))),
  );
  router.get('/payments', async (req, res) =>
    sendSuccess(res, await payments.listForCustomer(requireAuth(req).userId)),
  );
  router.get('/refunds', async (req, res) =>
    sendSuccess(res, await refunds.listForCustomer(requireAuth(req).userId)),
  );
  router.get('/reviews', async (req, res) =>
    sendSuccess(res, await reviews.mine(requireAuth(req))),
  );
  router.get('/reviews/eligible', async (req, res) =>
    sendSuccess(res, await reviews.eligible(requireAuth(req))),
  );
  return router;
}

/** /api/v1/reviews — photo uploads, edits and reports. */
export function createReviewsRouter(container: Container): Router {
  const router = Router();
  const { reviews } = container.services;
  router.use(container.authenticate);
  router.post(
    '/photos',
    requirePermission('reviews:create'),
    imageUpload.single('file'),
    async (req, res) =>
      sendSuccess(res, await reviews.uploadPhoto(requireAuth(req), req.file), 201),
  );
  router.put(
    '/:id',
    requirePermission('reviews:create'),
    validate({ params: idParam, body: reviewSchema }),
    async (req, res) => {
      sendSuccess(
        res,
        await reviews.update(
          requireAuth(req),
          validatedParams<{ id: string }>(req).id,
          req.body as ReviewInput,
          requestContext(req),
        ),
      );
    },
  );
  router.post(
    '/:id/report',
    validate({ params: idParam, body: reviewReportSchema }),
    async (req, res) => {
      await reviews.report(
        requireAuth(req),
        validatedParams<{ id: string }>(req).id,
        req.body as { reason: 'SPAM'; details: string },
      );
      sendMessage(res, 'Thanks — our team will review this.');
    },
  );
  return router;
}

/** GET /api/v1/hotels/:idOrSlug/reviews (public). */
export function createPublicReviewsHandler(container: Container) {
  return [
    validate({
      params: z.object({ idOrSlug: z.string().regex(/^[a-z0-9-]{3,140}$|^[a-f\d]{24}$/i) }),
      query: publicReviewsQuerySchema,
    }),
    async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await container.services.reviews.publicList(
          validatedParams<{ idOrSlug: string }>(req).idOrSlug,
          validatedQuery(req),
        ),
      );
    },
  ] as const;
}

/** /api/v1/wishlists — named lists; GET /shared/:token is public. Plus the legacy /wishlist heart API. */
export function createWishlistRouters(container: Container) {
  const { wishlists } = container.services;
  const lists = Router();
  lists.get(
    '/shared/:token',
    validate({ params: z.object({ token: z.string().max(64) }) }),
    async (req, res) =>
      sendSuccess(res, await wishlists.shared(validatedParams<{ token: string }>(req).token)),
  );
  lists.use(container.authenticate);
  const id = (req: Request) => validatedParams<{ id: string }>(req).id;
  const uid = (req: Request) => requireAuth(req).userId;
  lists.get('/', async (req, res) => sendSuccess(res, await wishlists.list(uid(req))));
  lists.post('/', validate({ body: createWishlistSchema }), async (req, res) =>
    sendSuccess(res, await wishlists.create(uid(req), (req.body as { name: string }).name), 201),
  );
  lists.get(
    '/:id',
    validate({ params: idParam, query: wishlistAvailabilityQuerySchema }),
    async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      sendSuccess(res, await wishlists.detail(uid(req), id(req), validatedQuery(req)));
    },
  );
  lists.patch('/:id', validate({ params: idParam, body: updateWishlistSchema }), async (req, res) =>
    sendSuccess(
      res,
      await wishlists.rename(uid(req), id(req), (req.body as { name: string }).name),
    ),
  );
  lists.delete('/:id', validate({ params: idParam }), async (req, res) => {
    await wishlists.remove(uid(req), id(req));
    sendMessage(res, 'List deleted.');
  });
  const itemParams = idParam.extend({ hotelId: objectIdSchema });
  lists.put(
    '/:id/items/:hotelId',
    validate({ params: itemParams, body: wishlistItemSchema }),
    async (req, res) => {
      await wishlists.saveItem(
        uid(req),
        id(req),
        validatedParams<{ hotelId: string }>(req).hotelId,
        (req.body as { note: string }).note,
      );
      sendMessage(res, 'Saved.');
    },
  );
  lists.delete('/:id/items/:hotelId', validate({ params: itemParams }), async (req, res) => {
    await wishlists.removeItem(
      uid(req),
      id(req),
      validatedParams<{ hotelId: string }>(req).hotelId,
    );
    sendMessage(res, 'Removed.');
  });
  lists.post('/:id/share', validate({ params: idParam }), async (req, res) =>
    sendSuccess(res, await wishlists.share(uid(req), id(req))),
  );
  lists.delete('/:id/share', validate({ params: idParam }), async (req, res) => {
    await wishlists.unshare(uid(req), id(req));
    sendMessage(res, 'Sharing turned off.');
  });

  const heart = Router();
  heart.use(container.authenticate);
  const hotelParam = z.object({ hotelId: objectIdSchema });
  heart.get('/', async (req, res) => sendSuccess(res, await wishlists.defaultCards(uid(req))));
  heart.get('/ids', async (req, res) => sendSuccess(res, await wishlists.savedHotelIds(uid(req))));
  heart.put('/:hotelId', validate({ params: hotelParam }), async (req, res) => {
    await wishlists.saveToDefault(uid(req), validatedParams<{ hotelId: string }>(req).hotelId);
    sendMessage(res, 'Saved.');
  });
  heart.delete('/:hotelId', validate({ params: hotelParam }), async (req, res) => {
    await wishlists.removeEverywhere(uid(req), validatedParams<{ hotelId: string }>(req).hotelId);
    sendMessage(res, 'Removed.');
  });
  return { lists, heart };
}

/** /api/v1/support/tickets — customer support foundation. */
export function createSupportRouter(container: Container): Router {
  const router = Router();
  const { support } = container.services;
  router.use(container.authenticate, requirePermission('support:create'));
  const id = (req: Request) => validatedParams<{ id: string }>(req).id;
  router.get('/tickets', async (req, res) =>
    sendSuccess(res, await support.list(requireAuth(req))),
  );
  router.post('/tickets', attachmentUpload.single('file'), async (req, res) => {
    // Multipart: fields arrive as strings; validate them with the same strict schema.
    const raw = { ...(req.body as Record<string, string>) };
    const parsed = createTicketSchema.safeParse({
      ...raw,
      bookingReference: raw.bookingReference ? raw.bookingReference : null,
    });
    if (!parsed.success) throw Errors.validation(zodErrorDetails(parsed.error));
    sendSuccess(
      res,
      await support.create(requireAuth(req), parsed.data, req.file, requestContext(req)),
      201,
    );
  });
  router.get('/tickets/:id', validate({ params: idParam }), async (req, res) =>
    sendSuccess(res, await support.detail(requireAuth(req), id(req))),
  );
  router.post(
    '/tickets/:id/messages',
    validate({ params: idParam }),
    attachmentUpload.single('file'),
    async (req, res) => {
      const parsed = ticketMessageSchema.safeParse({
        body: (req.body as { body?: string }).body ?? '',
      });
      if (!parsed.success) throw Errors.validation(zodErrorDetails(parsed.error));
      sendSuccess(
        res,
        await support.reply(requireAuth(req), id(req), parsed.data.body, req.file),
        201,
      );
    },
  );
  router.post('/tickets/:id/close', validate({ params: idParam }), async (req, res) =>
    sendSuccess(res, await support.close(requireAuth(req), id(req))),
  );
  router.get(
    '/tickets/:id/attachments/:mediaId',
    validate({ params: idParam.extend({ mediaId: objectIdSchema }) }),
    async (req, res) => {
      const { body, asset } = await support.attachment(
        requireAuth(req),
        id(req),
        validatedParams<{ mediaId: string }>(req).mediaId,
      );
      sendDownload(res, body, asset.contentType, asset.originalFileName);
    },
  );
  return router;
}
