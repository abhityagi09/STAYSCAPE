import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  objectIdSchema,
  tripInviteSchema,
  tripItemSchema,
  tripSchema,
  tripTokenSchema,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendMessage, sendSuccess } from '@/lib/http';
import { requestContext, requireAuth, validatedParams } from '@/lib/request-context';
import { validate } from '@/middleware/validate';

const idParam = z.object({ id: objectIdSchema });
const id = (req: Request) => validatedParams<{ id: string }>(req).id;
const uid = (req: Request) => requireAuth(req).userId;

/** /api/v1/trips — TripSpace. */
export function createTripsRouter(container: Container): Router {
  const router = Router();
  const { trips } = container.services;
  // Public read-only share view (registered before auth).
  router.get('/shared/:token', validate({ params: tripTokenSchema }), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    sendSuccess(res, await trips.shared(validatedParams<{ token: string }>(req).token));
  });
  router.use(container.authenticate);
  router.get('/', async (req, res) => sendSuccess(res, await trips.list(uid(req))));
  router.post('/', validate({ body: tripSchema }), async (req, res) =>
    sendSuccess(res, await trips.create(uid(req), req.body), 201),
  );
  router.post('/invitations/accept', validate({ body: tripTokenSchema }), async (req, res) =>
    sendSuccess(res, await trips.accept(uid(req), (req.body as { token: string }).token)),
  );
  router.get('/:id', validate({ params: idParam }), async (req, res) =>
    sendSuccess(res, await trips.get(uid(req), id(req))),
  );
  router.put('/:id', validate({ params: idParam, body: tripSchema }), async (req, res) =>
    sendSuccess(res, await trips.update(uid(req), id(req), req.body)),
  );
  router.delete('/:id', validate({ params: idParam }), async (req, res) => {
    await trips.remove(uid(req), id(req), requestContext(req));
    sendMessage(res, 'Trip deleted.');
  });
  router.post('/:id/items', validate({ params: idParam, body: tripItemSchema }), async (req, res) =>
    sendSuccess(res, await trips.addItem(uid(req), id(req), req.body), 201),
  );
  router.delete(
    '/:id/items/:itemId',
    validate({ params: idParam.extend({ itemId: objectIdSchema }) }),
    async (req, res) =>
      sendSuccess(
        res,
        await trips.removeItem(uid(req), id(req), validatedParams<{ itemId: string }>(req).itemId),
      ),
  );
  router.post(
    '/:id/invitations',
    validate({ params: idParam, body: tripInviteSchema }),
    async (req, res) =>
      sendSuccess(res, await trips.invite(uid(req), id(req), req.body, requestContext(req)), 201),
  );
  router.delete(
    '/:id/members/:memberId',
    validate({ params: idParam.extend({ memberId: objectIdSchema }) }),
    async (req, res) => {
      await trips.removeMember(
        uid(req),
        id(req),
        validatedParams<{ memberId: string }>(req).memberId,
      );
      sendMessage(res, 'Removed from the trip.');
    },
  );
  router.put(
    '/:id/sharing',
    validate({ params: idParam, body: z.strictObject({ enabled: z.boolean() }) }),
    async (req, res) =>
      sendSuccess(
        res,
        await trips.setSharing(uid(req), id(req), (req.body as { enabled: boolean }).enabled),
      ),
  );
  return router;
}
