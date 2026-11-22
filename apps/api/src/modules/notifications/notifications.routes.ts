import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  listNotificationsQuerySchema,
  objectIdSchema,
  type ListNotificationsQuery,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendSuccess } from '@/lib/http';
import { requireAuth, validatedParams, validatedQuery } from '@/lib/request-context';
import { validate } from '@/middleware/validate';

export function createNotificationsController(container: Container) {
  const { notifications } = container.services;
  return {
    list: async (req: Request, res: Response) => {
      const { userId } = requireAuth(req);
      sendSuccess(
        res,
        await notifications.list(userId, validatedQuery<ListNotificationsQuery>(req)),
      );
    },
    unreadCount: async (req: Request, res: Response) => {
      sendSuccess(res, { count: await notifications.unreadCount(requireAuth(req).userId) });
    },
    markRead: async (req: Request, res: Response) => {
      const { userId } = requireAuth(req);
      sendSuccess(
        res,
        await notifications.markRead(userId, validatedParams<{ id: string }>(req).id),
      );
    },
    markAllRead: async (req: Request, res: Response) => {
      sendSuccess(res, { updated: await notifications.markAllRead(requireAuth(req).userId) });
    },
  };
}

export function createNotificationsRouter(container: Container): Router {
  const router = Router();
  const controller = createNotificationsController(container);
  router.use(container.authenticate);
  router.get('/', validate({ query: listNotificationsQuerySchema }), controller.list);
  router.get('/unread-count', controller.unreadCount);
  router.post('/read-all', controller.markAllRead);
  router.patch(
    '/:id/read',
    validate({ params: z.object({ id: objectIdSchema }) }),
    controller.markRead,
  );
  return router;
}
