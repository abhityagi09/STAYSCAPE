import { Router, type Request, type Response } from 'express';
import { PERMISSIONS, permissionsForRoles } from '@stayscape/shared';
import type { Container } from '@/container';
import { sendSuccess } from '@/lib/http';
import { requireAuth } from '@/lib/request-context';
import { requirePermission } from './permission.middleware';

export function createPermissionsRouter(container: Container): Router {
  const router = Router();
  router.use(container.authenticate);

  /** Effective permissions of the caller (used by the web app to tailor navigation). */
  router.get('/me', (req: Request, res: Response) => {
    const { roles } = requireAuth(req);
    sendSuccess(res, { roles, permissions: permissionsForRoles(roles) });
  });

  /** Full permission catalogue for administrators. */
  router.get('/', requirePermission('users:read'), (_req: Request, res: Response) => {
    sendSuccess(res, [...PERMISSIONS]);
  });

  return router;
}
