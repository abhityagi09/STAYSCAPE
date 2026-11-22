import { Router } from 'express';
import type { Container } from '@/container';
import { requirePermission } from '@/modules/permissions/permission.middleware';
import { createRolesController } from './roles.controller';

export function createRolesRouter(container: Container): Router {
  const router = Router();
  const controller = createRolesController();
  router.get('/', container.authenticate, requirePermission('users:read'), controller.list);
  return router;
}
