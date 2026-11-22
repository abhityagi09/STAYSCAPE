import type { Request, Response } from 'express';
import {
  PRIVILEGED_ROLES,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type RoleDefinitionDto,
} from '@stayscape/shared';
import { sendSuccess } from '@/lib/http';

export function listRoleDefinitions(): RoleDefinitionDto[] {
  return ROLES.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    permissions: [...ROLE_PERMISSIONS[role]].sort(),
    privileged: PRIVILEGED_ROLES.includes(role),
  }));
}

export function createRolesController() {
  return {
    list: (_req: Request, res: Response) => {
      sendSuccess(res, listRoleDefinitions());
    },
  };
}
