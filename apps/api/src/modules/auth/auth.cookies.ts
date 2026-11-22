import type { CookieOptions, Request, Response } from 'express';
import { API_PREFIX, AUTH_COOKIES } from '@stayscape/shared';
import type { Config } from '@/config/env';
import { generateOpaqueToken } from '@/lib/crypto';

/** Refresh cookie is only ever sent to the auth routes. */
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

type CookieConfig = Pick<Config, 'COOKIE_SECURE' | 'COOKIE_SAMESITE' | 'COOKIE_DOMAIN'>;

function base(config: CookieConfig): CookieOptions {
  return {
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAMESITE,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(
  res: Response,
  config: CookieConfig,
  refreshToken: string,
  expiresAt: Date,
): void {
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
  res.cookie(AUTH_COOKIES.refreshToken, refreshToken, {
    ...base(config),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge,
  });
  // Readable by the SPA so it can echo the value in the X-CSRF-Token header (double-submit).
  res.cookie(AUTH_COOKIES.csrfToken, generateOpaqueToken(24), {
    ...base(config),
    httpOnly: false,
    path: '/',
    maxAge,
  });
}

export function clearAuthCookies(res: Response, config: CookieConfig): void {
  res.clearCookie(AUTH_COOKIES.refreshToken, {
    ...base(config),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
  });
  res.clearCookie(AUTH_COOKIES.csrfToken, { ...base(config), path: '/' });
}

export function readRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[AUTH_COOKIES.refreshToken];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined;
}
