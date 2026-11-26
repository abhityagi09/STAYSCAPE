import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { objectIdSchema } from '@stayscape/shared';
import type { Container } from '@/container';
import { requirePermission } from '@/modules/permissions/permission.middleware';
import { sendSuccess } from '@/lib/http';
import {
  requestContext,
  requireAuth,
  validatedParams,
  validatedQuery,
} from '@/lib/request-context';
import { validate } from '@/middleware/validate';
import { SIGNATURE_HEADER } from './channel.adapter';

const hotelParam = z.object({ hotelId: objectIdSchema });
const connParam = hotelParam.extend({ id: objectIdSchema });
type P = { hotelId: string; id: string; eventId?: string };
const p = (req: Request) => validatedParams<P>(req);

/** /api/v1/partner/hotels/:hotelId/channels */
export function createPartnerChannelsRouter(container: Container): Router {
  const router = Router({ mergeParams: true });
  const { channels } = container.services;
  router.use(container.authenticate, requirePermission('partner:access'));
  router.get('/:hotelId/channels', validate({ params: hotelParam }), async (req, res) =>
    sendSuccess(res, await channels.list(requireAuth(req), p(req).hotelId)),
  );
  router.post(
    '/:hotelId/channels',
    validate({
      params: hotelParam,
      body: z.strictObject({
        provider: z.enum(['LOCAL_SIMULATOR']),
        name: z.string().trim().min(2).max(80),
      }),
    }),
    async (req, res) =>
      sendSuccess(
        res,
        await channels.create(requireAuth(req), p(req).hotelId, req.body, requestContext(req)),
        201,
      ),
  );
  router.patch(
    '/:hotelId/channels/:id',
    validate({
      params: connParam,
      body: z.strictObject({
        status: z.enum(['ACTIVE', 'PAUSED']).optional(),
        mappings: z
          .array(
            z.strictObject({
              roomTypeId: objectIdSchema,
              externalRoomCode: z.string().trim().min(1).max(60),
            }),
          )
          .max(50)
          .optional(),
      }),
    }),
    async (req, res) =>
      sendSuccess(
        res,
        await channels.update(
          requireAuth(req),
          p(req).hotelId,
          p(req).id,
          req.body,
          requestContext(req),
        ),
      ),
  );
  router.post(
    '/:hotelId/channels/:id/rotate-secret',
    validate({ params: connParam }),
    async (req, res) =>
      sendSuccess(
        res,
        await channels.rotateSecret(
          requireAuth(req),
          p(req).hotelId,
          p(req).id,
          requestContext(req),
        ),
      ),
  );
  router.post('/:hotelId/channels/:id/sync', validate({ params: connParam }), async (req, res) =>
    sendSuccess(res, await channels.syncNow(requireAuth(req), p(req).hotelId, p(req).id)),
  );
  router.get(
    '/:hotelId/channels/:id/events',
    validate({
      params: connParam,
      query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        status: z.enum(['PROCESSED', 'FAILED', 'CONFLICT', 'IGNORED']).optional(),
      }),
    }),
    async (req, res) => {
      const q = validatedQuery<{ page: number; limit: number; status?: string }>(req);
      sendSuccess(
        res,
        await channels.events(
          requireAuth(req),
          p(req).hotelId,
          p(req).id,
          q.page,
          q.limit,
          q.status,
        ),
      );
    },
  );
  router.post(
    '/:hotelId/channels/:id/events/:eventId/retry',
    validate({ params: connParam.extend({ eventId: objectIdSchema }) }),
    async (req, res) =>
      sendSuccess(res, {
        status: await channels.retryEvent(
          requireAuth(req),
          p(req).hotelId,
          p(req).id,
          p(req).eventId!,
        ),
      }),
  );
  return router;
}

/** POST /api/v1/channels/webhooks/:connectionId — raw body, authenticated by HMAC signature. */
export function createChannelWebhookHandler(container: Container) {
  return [
    express.raw({ type: '*/*', limit: '512kb' }),
    async (req: Request, res: Response) => {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      sendSuccess(
        res,
        await container.services.channels.receiveWebhook(String(req.params.connectionId), raw, {
          [SIGNATURE_HEADER]: req.get(SIGNATURE_HEADER),
        }),
      );
    },
  ] as const;
}
