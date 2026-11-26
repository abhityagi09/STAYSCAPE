import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createOrganizationSchema,
  linkBookingSchema,
  localDateSchema,
  objectIdSchema,
  orgDecisionSchema,
  orgInviteSchema,
  orgMemberUpdateSchema,
  travelDecisionSchema,
  travelPolicySchema,
  travelRequestSchema,
  tripTokenSchema,
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
import { sendDownload } from '@/modules/bookings/bookings.routes';
import { requirePermission } from '@/modules/permissions/permission.middleware';
import type { TravelPolicy } from './corporate.service';

const idParam = z.object({ id: objectIdSchema });
const uid = (req: Request) => requireAuth(req).userId;
const id = (req: Request) => validatedParams<{ id: string }>(req).id;

/** /api/v1/corporate — the caller's own organisation only. */
export function createCorporateRouter(container: Container): Router {
  const router = Router();
  const { corporate } = container.services;
  router.use(container.authenticate);
  router.post('/organizations', validate({ body: createOrganizationSchema }), async (req, res) =>
    sendSuccess(res, await corporate.create(uid(req), req.body, requestContext(req)), 201),
  );
  router.get('/organization', async (req, res) => sendSuccess(res, await corporate.mine(uid(req))));
  router.put('/organization/policy', validate({ body: travelPolicySchema }), async (req, res) =>
    sendSuccess(
      res,
      await corporate.updatePolicy(uid(req), req.body as TravelPolicy, requestContext(req)),
    ),
  );
  router.get('/members', async (req, res) => sendSuccess(res, await corporate.members(uid(req))));
  router.post('/invitations', validate({ body: orgInviteSchema }), async (req, res) =>
    sendSuccess(res, await corporate.invite(uid(req), req.body, requestContext(req)), 201),
  );
  router.post('/invitations/accept', validate({ body: tripTokenSchema }), async (req, res) =>
    sendSuccess(res, await corporate.accept(uid(req), (req.body as { token: string }).token)),
  );
  router.patch(
    '/members/:id',
    validate({ params: idParam, body: orgMemberUpdateSchema }),
    async (req, res) =>
      sendSuccess(
        res,
        await corporate.updateMember(uid(req), id(req), req.body, requestContext(req)),
      ),
  );
  router.delete('/members/:id', validate({ params: idParam }), async (req, res) => {
    await corporate.removeMember(uid(req), id(req), requestContext(req));
    sendMessage(res, 'Member removed.');
  });
  router.get(
    '/requests',
    validate({
      query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        status: z.enum(['PENDING', 'APPROVED', 'AUTO_APPROVED', 'REJECTED', 'BOOKED']).optional(),
        scope: z.enum(['mine', 'org']).default('mine'),
      }),
    }),
    async (req, res) =>
      sendSuccess(res, await corporate.listRequests(uid(req), validatedQuery(req))),
  );
  router.post('/requests', validate({ body: travelRequestSchema }), async (req, res) =>
    sendSuccess(res, await corporate.createRequest(uid(req), req.body, requestContext(req)), 201),
  );
  router.post(
    '/requests/:id/decision',
    validate({ params: idParam, body: travelDecisionSchema }),
    async (req, res) =>
      sendSuccess(res, await corporate.decide(uid(req), id(req), req.body, requestContext(req))),
  );
  router.post(
    '/requests/:id/booking',
    validate({ params: idParam, body: linkBookingSchema }),
    async (req, res) =>
      sendSuccess(
        res,
        await corporate.linkBooking(
          uid(req),
          id(req),
          (req.body as { bookingReference: string }).bookingReference,
          requestContext(req),
        ),
      ),
  );
  router.get(
    '/reports',
    validate({ query: z.object({ from: localDateSchema, to: localDateSchema }) }),
    async (req, res) => {
      const q = validatedQuery<{ from: string; to: string }>(req);
      sendSuccess(res, await corporate.report(uid(req), q.from, q.to));
    },
  );
  router.get('/invoices', async (req, res) => sendSuccess(res, await corporate.invoices(uid(req))));
  router.get(
    '/invoices/:reference',
    validate({ params: z.object({ reference: z.string().regex(/^SS-[A-Z0-9]{8}$/) }) }),
    async (req, res) => {
      const doc = await corporate.invoicePdf(
        uid(req),
        validatedParams<{ reference: string }>(req).reference,
      );
      sendDownload(res, doc.body, 'application/pdf', doc.fileName);
    },
  );
  return router;
}

/** /api/v1/admin/organizations — verification of corporate accounts. */
export function createAdminCorporateRouter(container: Container): Router {
  const router = Router();
  const { corporate } = container.services;
  router.use(container.authenticate, requirePermission('users:manage'));
  router.get(
    '/',
    validate({
      query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']).optional(),
      }),
    }),
    async (req, res) => {
      const q = validatedQuery<{ page: number; limit: number; status?: string }>(req);
      sendSuccess(res, await corporate.adminList(q.page, q.limit, q.status));
    },
  );
  router.post(
    '/:id/decision',
    validate({ params: idParam, body: orgDecisionSchema }),
    async (req, res) =>
      sendSuccess(
        res,
        await corporate.adminDecide(uid(req), id(req), req.body, requestContext(req)),
      ),
  );
  return router;
}
