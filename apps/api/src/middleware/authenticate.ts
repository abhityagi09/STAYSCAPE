import type { RequestHandler } from 'express';
import { AppError, Errors } from '@/lib/errors';
import { assertAccountUsable } from '@/modules/auth/auth.service';
import type { TokenService } from '@/modules/auth/token.service';
import type { SessionService } from '@/modules/sessions/session.service';
import type { UserRepository } from '@/modules/users/user.repository';

/**
 * Bearer access-token authentication.
 *
 * Besides verifying the JWT, every request re-reads the user and confirms that the issuing
 * session has not been revoked. Suspensions, logouts and "sign out everywhere" therefore take
 * effect immediately instead of waiting for the access token to expire.
 */
export function createAuthenticate(deps: {
  tokens: TokenService;
  users: UserRepository;
  sessions: SessionService;
}): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) return next(Errors.unauthorized());
    const token = header.slice('Bearer '.length).trim();
    if (!token) return next(Errors.unauthorized());

    const claims = deps.tokens.verifyAccessToken(token);
    const [user, active] = await Promise.all([
      deps.users.findById(claims.sub),
      deps.sessions.isActive(claims.sid, claims.sub),
    ]);
    if (!user) throw new AppError(401, 'TOKEN_INVALID', 'The access token is invalid.');
    if (!active)
      throw new AppError(401, 'SESSION_REVOKED', 'This session has ended. Please sign in again.');
    assertAccountUsable(user);

    req.auth = { userId: claims.sub, roles: user.roles, sessionId: claims.sid, user };
    next();
  };
}
