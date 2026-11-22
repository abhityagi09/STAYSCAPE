import type { Request } from 'express';
import { Errors } from './errors';
import type { AuthContext } from '@/types/express';

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
}

export function requestContext(req: Request): RequestContext {
  const userAgent = req.get('user-agent');
  return {
    ipAddress: req.ip ?? null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
    requestId: req.requestId,
  };
}

/** Access the authenticated principal; throws if a route forgot to apply `authenticate`. */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw Errors.unauthorized();
  return req.auth;
}

export function validatedQuery<T>(req: Request): T {
  return req.validatedQuery as T;
}

export function validatedParams<T>(req: Request): T {
  return req.validatedParams as T;
}
