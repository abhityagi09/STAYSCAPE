import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Config } from '@/config/env';
import { AppError } from '@/lib/errors';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
}

/** Issues and verifies short-lived HS256 access tokens. */
export class TokenService {
  constructor(
    private readonly config: Pick<
      Config,
      'JWT_ACCESS_SECRET' | 'JWT_ISSUER' | 'JWT_AUDIENCE' | 'ACCESS_TOKEN_TTL_SECONDS'
    >,
  ) {}

  signAccessToken(claims: AccessTokenClaims): { token: string; expiresIn: number } {
    const token = jwt.sign({ sid: claims.sid, typ: 'access' }, this.config.JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      subject: claims.sub,
      issuer: this.config.JWT_ISSUER,
      audience: this.config.JWT_AUDIENCE,
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
    });
    return { token, expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.config.JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
      }) as JwtPayload;
      if (
        payload.typ !== 'access' ||
        typeof payload.sub !== 'string' ||
        typeof payload.sid !== 'string'
      ) {
        throw new AppError(401, 'TOKEN_INVALID', 'The access token is invalid.');
      }
      return { sub: payload.sub, sid: payload.sid };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof jwt.TokenExpiredError) {
        throw new AppError(401, 'TOKEN_EXPIRED', 'The access token has expired.');
      }
      throw new AppError(401, 'TOKEN_INVALID', 'The access token is invalid.');
    }
  }
}
