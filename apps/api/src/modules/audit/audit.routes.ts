import { Router, type Request, type Response } from 'express';
import { listAuditQuerySchema, type ListAuditQuery } from '@stayscape/shared';
import type { Container } from '@/container';
import { sendSuccess } from '@/lib/http';
import { validatedQuery } from '@/lib/request-context';
import { requirePermission } from '@/modules/permissions/permission.middleware';
import { validate } from '@/middleware/validate';

export function createAuditRouter(container: Container): Router {
  const router = Router();
  const { audit } = container.services;
  router.get(
    '/',
    container.authenticate,
    requirePermission('audit:read'),
    validate({ query: listAuditQuerySchema }),
    async (req: Request, res: Response) => {
      sendSuccess(res, await audit.list(validatedQuery<ListAuditQuery>(req)));
    },
  );
  return router;
}
