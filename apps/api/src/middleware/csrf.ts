import type { RequestHandler } from 'express';
import { AUTH_COOKIES, CSRF_HEADER } from '@stayscape/shared';
import type { Config } from '@/config/env';
import { AppError } from '@/lib/errors';
import { safeEqual } from '@/lib/crypto';

/**
 * CSRF protection for endpoints that authenticate using the refresh-token cookie.
 *
 * Defence in depth:
 *  1. The refresh cookie is HttpOnly + SameSite (strict by default) + path-scoped.
 *  2. Double-submit token: the readable `ss_csrf` cookie must be echoed in `X-CSRF-Token`.
 *     A cross-site attacker can neither read the cookie nor set custom headers without CORS.
 *  3. If an Origin header is present it must be on the CORS allowlist.
 *
 * Bearer-token endpoints are not CSRF-prone (the token is never sent ambiently).
 */
export function requireCsrf(
  config: Pick<Config, 'corsOrigins' | 'API_PUBLIC_URL'>,
): RequestHandler {
  const allowed = new Set([...config.corsOrigins, new URL(config.API_PUBLIC_URL).origin]);
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) {
      return next(new AppError(403, 'CSRF_INVALID', 'Request origin is not allowed.'));
    }
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const cookieToken = cookies?.[AUTH_COOKIES.csrfToken];
    const headerToken = req.get(CSRF_HEADER);
    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      return next(
        new AppError(
          403,
          'CSRF_INVALID',
          'Your session could not be verified. Please refresh and try again.',
        ),
      );
    }
    next();
  };
}
