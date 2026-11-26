import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  TICKET_ATTACHMENT_MAX_BYTES,
  agentMessageSchema,
  objectIdSchema,
  partnerTicketMessageSchema,
  periodQuerySchema,
  supportQueueQuerySchema,
  ticketAssignSchema,
  ticketEscalateSchema,
  ticketResolveSchema,
  ticketUpdateSchema,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { Errors } from '@/lib/errors';
import { sendSuccess } from '@/lib/http';
import {
  requestContext,
  requireAuth,
  validatedParams,
  validatedQuery,
} from '@/lib/request-context';
import { validate, zodErrorDetails } from '@/middleware/validate';
import { sendDownload } from '@/modules/bookings/bookings.routes';
import { periodFrom } from '@/modules/finance/finance.routes';
import { requirePermission } from '@/modules/permissions/permission.middleware';
import type { QueueQuery } from './support-console.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TICKET_ATTACHMENT_MAX_BYTES, files: 1, fields: 6, fieldSize: 10_000 },
});
const idParam = z.object({ id: objectIdSchema });
const fileParam = idParam.extend({ mediaId: objectIdSchema });
const id = (req: Request) => validatedParams<{ id: string }>(req).id;

/** /api/v1/admin/support — the agent console (support:manage). */
export function createAdminSupportRouter(container: Container): Router {
  const router = Router();
  const { supportConsole } = container.services;
  router.use(container.authenticate, requirePermission('support:manage'));
  router.get('/tickets', validate({ query: supportQueueQuerySchema }), async (req, res) =>
    sendSuccess(res, await supportConsole.queue(requireAuth(req), validatedQuery<QueueQuery>(req))),
  );
  router.get('/metrics', validate({ query: periodQuerySchema }), async (req, res) => {
    const { from, to } = periodFrom(validatedQuery<{ from?: string; to?: string }>(req));
    sendSuccess(res, await supportConsole.metrics(from, to));
  });
  router.get('/tickets/:id', validate({ params: idParam }), async (req, res) =>
    sendSuccess(res, await supportConsole.detail(id(req))),
  );
  router.post(
    '/tickets/:id/assign',
    validate({ params: idParam, body: ticketAssignSchema }),
    async (req, res) =>
      sendSuccess(
        res,
        await supportConsole.assign(
          requireAuth(req),
          id(req),
          (req.body as { assigneeId: string | null }).assigneeId,
          requestContext(req),
        ),
      ),
  );
  router.patch(
    '/tickets/:id',
    validate({ params: idParam, body: ticketUpdateSchema }),
    async (req, res) =>
      sendSuccess(
        res,
        await supportConsole.update(
          requireAuth(req),
          id(req),
          req.body as object,
          requestContext(req),
        ),
      ),
  );
  router.post(
    '/tickets/:id/escalate',
    validate({ params: idParam, body: ticketEscalateSchema }),
    async (req, res) =>
      sendSuccess(
        res,
        await supportConsole.escalate(
          requireAuth(req),
          id(req),
          (req.body as { reason: string }).reason,
          requestContext(req),
        ),
      ),
  );
  router.post(
    '/tickets/:id/resolve',
    validate({ params: idParam, body: ticketResolveSchema }),
    async (req, res) =>
      sendSuccess(
        res,
        await supportConsole.resolve(
          requireAuth(req),
          id(req),
          (req.body as { resolution: string }).resolution,
          requestContext(req),
        ),
      ),
  );
  router.post(
    '/tickets/:id/messages',
    validate({ params: idParam }),
    upload.single('file'),
    async (req, res) => {
      const parsed = agentMessageSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.validation(zodErrorDetails(parsed.error));
      sendSuccess(
        res,
        await supportConsole.message(
          requireAuth(req),
          id(req),
          parsed.data,
          req.file,
          requestContext(req),
        ),
        201,
      );
    },
  );
  router.get(
    '/tickets/:id/attachments/:mediaId',
    validate({ params: fileParam }),
    async (req, res) => {
      const { body, asset } = await supportConsole.attachment(
        id(req),
        validatedParams<{ mediaId: string }>(req).mediaId,
      );
      sendDownload(res, body, asset.contentType, asset.originalFileName);
    },
  );
  return router;
}

/** /api/v1/partner/support — tickets an agent shared with the caller's properties. */
export function createPartnerSupportRouter(container: Container): Router {
  const router = Router();
  const { supportConsole } = container.services;
  router.use(container.authenticate);
  router.get('/tickets', async (req, res) =>
    sendSuccess(res, await supportConsole.partnerList(requireAuth(req))),
  );
  router.get('/tickets/:id', validate({ params: idParam }), async (req, res) =>
    sendSuccess(res, await supportConsole.partnerDetail(requireAuth(req), id(req))),
  );
  router.post(
    '/tickets/:id/messages',
    validate({ params: idParam }),
    upload.single('file'),
    async (req, res) => {
      const parsed = partnerTicketMessageSchema.safeParse(req.body);
      if (!parsed.success) throw Errors.validation(zodErrorDetails(parsed.error));
      sendSuccess(
        res,
        await supportConsole.partnerReply(
          requireAuth(req),
          id(req),
          parsed.data.body,
          req.file,
          requestContext(req),
        ),
        201,
      );
    },
  );
  router.get(
    '/tickets/:id/attachments/:mediaId',
    validate({ params: fileParam }),
    async (req, res) => {
      const { body, asset } = await supportConsole.partnerAttachment(
        requireAuth(req),
        id(req),
        validatedParams<{ mediaId: string }>(req).mediaId,
      );
      sendDownload(res, body, asset.contentType, asset.originalFileName);
    },
  );
  return router;
}
