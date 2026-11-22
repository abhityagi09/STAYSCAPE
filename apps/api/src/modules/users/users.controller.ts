import type { Request, Response } from 'express';
import type {
  ListUsersQuery,
  UpdatePreferencesInput,
  UpdateUserRolesInput,
  UpdateUserStatusInput,
  Role,
} from '@stayscape/shared';
import type { Container } from '@/container';
import { sendMessage, sendSuccess } from '@/lib/http';
import {
  requestContext,
  requireAuth,
  validatedParams,
  validatedQuery,
} from '@/lib/request-context';

export function createUsersController(container: Container) {
  const { users } = container.services;

  return {
    getProfile: async (req: Request, res: Response) => {
      sendSuccess(res, await users.getProfile(requireAuth(req).userId));
    },
    updateProfile: async (req: Request, res: Response) => {
      const { userId } = requireAuth(req);
      sendSuccess(
        res,
        await users.updateProfile(
          userId,
          req.body as Parameters<typeof users.updateProfile>[1],
          requestContext(req),
        ),
      );
    },
    updatePreferences: async (req: Request, res: Response) => {
      const { userId } = requireAuth(req);
      sendSuccess(
        res,
        await users.updatePreferences(
          userId,
          req.body as UpdatePreferencesInput,
          requestContext(req),
        ),
      );
    },
    uploadAvatar: async (req: Request, res: Response) => {
      const { userId } = requireAuth(req);
      sendSuccess(res, await users.uploadAvatar(userId, req.file, requestContext(req)));
    },
    listSessions: async (req: Request, res: Response) => {
      const { userId, sessionId } = requireAuth(req);
      sendSuccess(res, await users.listSessions(userId, sessionId));
    },
    revokeSession: async (req: Request, res: Response) => {
      const { userId } = requireAuth(req);
      const { id } = validatedParams<{ id: string }>(req);
      await users.revokeSession(userId, id, requestContext(req));
      sendMessage(res, 'Session revoked.');
    },
    listUsers: async (req: Request, res: Response) => {
      sendSuccess(res, await users.listUsers(validatedQuery<ListUsersQuery>(req)));
    },
    updateRoles: async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const { id } = validatedParams<{ id: string }>(req);
      const { roles } = req.body as UpdateUserRolesInput;
      sendSuccess(res, await users.updateRoles(auth, id, roles as Role[], requestContext(req)));
    },
    updateStatus: async (req: Request, res: Response) => {
      const auth = requireAuth(req);
      const { id } = validatedParams<{ id: string }>(req);
      sendSuccess(
        res,
        await users.updateStatus(auth, id, req.body as UpdateUserStatusInput, requestContext(req)),
      );
    },
  };
}
