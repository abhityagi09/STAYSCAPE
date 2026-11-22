import type { RequestHandler } from 'express';
import { hasAllPermissions, hasAnyPermission, type Permission } from '@stayscape/shared';
import { Errors } from '@/lib/errors';

/** Requires every listed permission. Must run after `authenticate`. */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(Errors.unauthorized());
    if (!hasAllPermissions(req.auth.roles, permissions)) return next(Errors.forbidden());
    next();
  };
}

/** Requires at least one of the listed permissions. */
export function requireAnyPermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(Errors.unauthorized());
    if (!hasAnyPermission(req.auth.roles, permissions)) return next(Errors.forbidden());
    next();
  };
}
