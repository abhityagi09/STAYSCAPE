import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  listUsersQuerySchema,
  objectIdSchema,
  updatePreferencesSchema,
  updateProfileSchema,
  updateUserRolesSchema,
  updateUserStatusSchema,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { Errors } from '@/lib/errors';
import { requirePermission } from '@/modules/permissions/permission.middleware';
import { validate } from '@/middleware/validate';
import { createUsersController } from './users.controller';

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1, fields: 0 },
  fileFilter: (_req, file, callback) => {
    if ((AVATAR_MIME_TYPES as readonly string[]).includes(file.mimetype)) callback(null, true);
    else callback(Errors.unsupportedMedia('Avatars must be JPEG, PNG or WebP images.'));
  },
});

const idParams = z.object({ id: objectIdSchema });
const sessionParams = z.object({ id: z.uuid('Invalid session id') });

export function createUsersRouter(container: Container): Router {
  const router = Router();
  const controller = createUsersController(container);
  router.use(container.authenticate);

  // self-service
  router.get('/profile', controller.getProfile);
  router.patch('/profile', validate({ body: updateProfileSchema }), controller.updateProfile);
  router.patch(
    '/preferences',
    validate({ body: updatePreferencesSchema }),
    controller.updatePreferences,
  );
  router.post('/avatar', avatarUpload.single('avatar'), controller.uploadAvatar);
  router.get('/sessions', controller.listSessions);
  router.delete('/sessions/:id', validate({ params: sessionParams }), controller.revokeSession);

  // administration
  router.get(
    '/',
    requirePermission('users:read'),
    validate({ query: listUsersQuerySchema }),
    controller.listUsers,
  );
  router.patch(
    '/:id/roles',
    requirePermission('users:manage'),
    validate({ params: idParams, body: updateUserRolesSchema }),
    controller.updateRoles,
  );
  router.patch(
    '/:id/status',
    requirePermission('users:manage'),
    validate({ params: idParams, body: updateUserStatusSchema }),
    controller.updateStatus,
  );

  return router;
}
