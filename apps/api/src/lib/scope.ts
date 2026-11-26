import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestHandler } from 'express';

/**
 * Request-scoped context. Set once partner access has been resolved so cross-cutting concerns
 * (audit logging) can attribute actions to the partner without threading ids through every call.
 */
export interface RequestScope {
  partnerId?: string;
  hotelId?: string;
}

export const requestScope = new AsyncLocalStorage<RequestScope>();

export const scopeMiddleware: RequestHandler = (_req, _res, next) =>
  requestScope.run({}, () => next());

export function setScope(values: RequestScope): void {
  const store = requestScope.getStore();
  if (store) Object.assign(store, values);
}
