import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  DOCUMENT_MAX_BYTES,
  documentTypeSchema,
  inviteStaffSchema,
  updateStaffSchema,
  listPartnersQuerySchema,
  objectIdSchema,
  partnerDraftSchema,
  partnerReviewDecisionSchema,
  type PartnerDocumentType,
  type PartnerReviewDecision,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendMessage, sendSuccess } from '@/lib/http';
import {
  requestContext,
  requireAuth,
  validatedParams,
  validatedQuery,
} from '@/lib/request-context';
import type { RateLimiters } from '@/middleware/rate-limit';
import { validate } from '@/middleware/validate';
import { requirePermission } from '@/modules/permissions/permission.middleware';

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1, fields: 2 },
});
const idParam = z.object({ id: objectIdSchema });
const mediaParam = z.object({ mediaId: objectIdSchema });

function sendFile(res: Response, body: Buffer, contentType: string, fileName: string) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(body);
}

/** /api/v1/partner — onboarding application and team, for the signed-in user. */
export function createPartnerApplicationRouter(
  container: Container,
  limiters: RateLimiters,
): Router {
  const router = Router();
  const { partners, partnerAccess } = container.services;
  router.use(container.authenticate);

  router.get('/application', async (req: Request, res: Response) => {
    sendSuccess(res, await partners.getMine(requireAuth(req).userId));
  });
  router.put(
    '/application',
    validate({ body: partnerDraftSchema }),
    async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await partners.saveDraft(requireAuth(req).userId, req.body, requestContext(req)),
      );
    },
  );
  router.post(
    '/application/documents',
    limiters.auth,
    documentUpload.single('file'),
    async (req: Request, res: Response) => {
      const type = documentTypeSchema.safeParse((req.body as { type?: unknown }).type);
      if (!type.success) {
        return void res.status(422).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Choose a document type.',
            details: { fieldErrors: { type: ['Choose a document type'] } },
            requestId: req.requestId,
          },
        });
      }
      sendSuccess(
        res,
        await partners.uploadDocument(
          requireAuth(req).userId,
          type.data as PartnerDocumentType,
          req.file,
          requestContext(req),
        ),
      );
    },
  );
  router.get(
    '/application/documents/:mediaId',
    validate({ params: mediaParam }),
    async (req: Request, res: Response) => {
      const { body, asset } = await partners.readOwnDocument(
        requireAuth(req).userId,
        validatedParams<{ mediaId: string }>(req).mediaId,
      );
      sendFile(res, body, asset.contentType, asset.originalFileName);
    },
  );
  router.delete(
    '/application/documents/:mediaId',
    validate({ params: mediaParam }),
    async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await partners.removeDocument(
          requireAuth(req).userId,
          validatedParams<{ mediaId: string }>(req).mediaId,
        ),
      );
    },
  );
  router.post('/application/submit', limiters.auth, async (req: Request, res: Response) => {
    sendSuccess(res, await partners.submit(requireAuth(req).userId, requestContext(req)));
  });

  // Team (owners only)
  // Team management is for partner accounts only (invitations below are for invitees).
  router.use('/staff', requirePermission('partner:access'));
  router.get('/staff', async (req: Request, res: Response) => {
    sendSuccess(
      res,
      await partners.listStaff(await partnerAccess.requireApprovedOwner(requireAuth(req))),
    );
  });
  router.post(
    '/staff',
    validate({ body: inviteStaffSchema }),
    async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      sendSuccess(
        res,
        await partners.inviteStaff(
          await partnerAccess.requireApprovedOwner(auth),
          auth.userId,
          req.body,
          requestContext(req),
        ),
        201,
      );
    },
  );
  router.delete(
    '/staff/:id',
    validate({ params: idParam }),
    async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      await partners.revokeStaff(
        await partnerAccess.requireApprovedOwner(auth),
        validatedParams<{ id: string }>(req).id,
        auth.userId,
        requestContext(req),
      );
      sendMessage(res, 'Access revoked.');
    },
  );
  router.patch(
    '/staff/:id',
    validate({ params: idParam, body: updateStaffSchema }),
    async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      sendSuccess(
        res,
        await partners.updateStaff(
          await partnerAccess.requireApprovedOwner(auth),
          validatedParams<{ id: string }>(req).id,
          auth.userId,
          req.body,
          requestContext(req),
        ),
      );
    },
  );
  router.post(
    '/staff/:id/suspend',
    validate({ params: idParam }),
    async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      sendSuccess(
        res,
        await partners.setStaffSuspended(
          await partnerAccess.requireApprovedOwner(auth),
          validatedParams<{ id: string }>(req).id,
          auth.userId,
          true,
          requestContext(req),
        ),
      );
    },
  );
  router.post(
    '/staff/:id/reactivate',
    validate({ params: idParam }),
    async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      sendSuccess(
        res,
        await partners.setStaffSuspended(
          await partnerAccess.requireApprovedOwner(auth),
          validatedParams<{ id: string }>(req).id,
          auth.userId,
          false,
          requestContext(req),
        ),
      );
    },
  );
  router.get(
    '/staff/:id/activity',
    validate({
      params: idParam,
      query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(25),
      }),
    }),
    async (req: Request, res: Response) => {
      const q = validatedQuery<{ page: number; limit: number }>(req);
      sendSuccess(
        res,
        await partners.staffActivity(
          await partnerAccess.requireApprovedOwner(requireAuth(req)),
          validatedParams<{ id: string }>(req).id,
          q.page,
          q.limit,
        ),
      );
    },
  );
  router.get('/invitations', async (req: Request, res: Response) => {
    sendSuccess(res, await partners.myInvitations(requireAuth(req).userId));
  });
  router.post(
    '/invitations/:id/accept',
    validate({ params: idParam }),
    async (req: Request, res: Response) => {
      await partners.acceptInvitation(
        requireAuth(req).userId,
        validatedParams<{ id: string }>(req).id,
        requestContext(req),
      );
      sendMessage(res, 'Invitation accepted.');
    },
  );
  return router;
}

/** /api/v1/admin/partners — verification review (partners:approve). */
export function createAdminPartnersRouter(container: Container): Router {
  const router = Router();
  const { partners } = container.services;
  router.use(container.authenticate, requirePermission('partners:approve'));
  router.get(
    '/',
    validate({ query: listPartnersQuerySchema }),
    async (req: Request, res: Response) => {
      sendSuccess(res, await partners.list(validatedQuery(req)));
    },
  );
  router.get('/:id', validate({ params: idParam }), async (req: Request, res: Response) => {
    sendSuccess(res, await partners.getForAdmin(validatedParams<{ id: string }>(req).id));
  });
  router.get(
    '/:id/documents/:mediaId',
    validate({ params: idParam.extend(mediaParam.shape) }),
    async (req: Request, res: Response) => {
      const { id, mediaId } = validatedParams<{ id: string; mediaId: string }>(req);
      const { body, asset } = await partners.readDocumentForAdmin(id, mediaId);
      await container.services.audit.record({
        actorId: requireAuth(req).userId,
        action: 'partner.document_viewed',
        entityType: 'Partner',
        entityId: id,
        metadata: { mediaId },
        context: requestContext(req),
      });
      sendFile(res, body, asset.contentType, asset.originalFileName);
    },
  );
  router.post(
    '/:id/decision',
    validate({ params: idParam, body: partnerReviewDecisionSchema }),
    async (req: Request, res: Response) => {
      sendSuccess(
        res,
        await partners.decide(
          requireAuth(req),
          validatedParams<{ id: string }>(req).id,
          req.body as PartnerReviewDecision,
          requestContext(req),
        ),
      );
    },
  );
  return router;
}
