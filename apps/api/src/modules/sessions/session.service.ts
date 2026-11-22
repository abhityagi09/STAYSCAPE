import { randomUUID } from 'node:crypto';
import type { SessionDto } from '@stayscape/shared';
import type { Config } from '@/config/env';
import { generateOpaqueToken, hashToken } from '@/lib/crypto';
import { AppError, Errors } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { describeUserAgent } from '@/lib/user-agent';
import type { RefreshSessionRecord, SessionRevokeReason } from './refresh-session.model';
import type { SessionRepository } from './session.repository';

export interface IssuedRefreshToken {
  refreshToken: string;
  tokenFamily: string;
  userId: string;
  expiresAt: Date;
}

/** Outcome of a reuse detection, reported to the caller so it can be audited. */
export class RefreshTokenReuseError extends AppError {
  constructor(
    public readonly userId: string,
    public readonly tokenFamily: string,
  ) {
    super(401, 'REFRESH_TOKEN_REUSED', 'Your session is no longer valid. Please sign in again.');
  }
}

export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly config: Pick<Config, 'REFRESH_TOKEN_TTL_DAYS'>,
  ) {}

  private expiry(): Date {
    return new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);
  }

  private async issue(
    userId: string,
    tokenFamily: string,
    familyCreatedAt: Date,
    context: RequestContext,
  ): Promise<IssuedRefreshToken> {
    const refreshToken = generateOpaqueToken(48);
    const expiresAt = this.expiry();
    await this.repository.create({
      userId,
      tokenHash: hashToken(refreshToken),
      tokenFamily,
      familyCreatedAt,
      deviceInformation: {
        userAgent: context.userAgent,
        label: describeUserAgent(context.userAgent),
      },
      ipAddress: context.ipAddress,
      expiresAt,
    });
    return { refreshToken, tokenFamily, userId, expiresAt };
  }

  /** Start a new sign-in (a new token family). */
  start(userId: string, context: RequestContext): Promise<IssuedRefreshToken> {
    return this.issue(userId, randomUUID(), new Date(), context);
  }

  /**
   * Rotate a refresh token. The presented token is atomically revoked and a new one in the
   * same family is issued. Presenting an already-rotated token is treated as theft: the whole
   * family is revoked and a RefreshTokenReuseError is thrown.
   */
  async rotate(rawToken: string, context: RequestContext): Promise<IssuedRefreshToken> {
    const tokenHash = hashToken(rawToken);
    const claimed = await this.repository.claimForRotation(tokenHash);
    if (claimed) {
      return this.issue(
        claimed.userId.toString(),
        claimed.tokenFamily,
        claimed.familyCreatedAt,
        context,
      );
    }

    const existing = await this.repository.findByTokenHash(tokenHash);
    if (existing?.revokedReason === 'ROTATED') {
      await this.repository.revokeFamily(existing.tokenFamily, 'REUSE_DETECTED');
      throw new RefreshTokenReuseError(existing.userId.toString(), existing.tokenFamily);
    }
    throw new AppError(
      401,
      'REFRESH_TOKEN_INVALID',
      'Your session has expired. Please sign in again.',
    );
  }

  /** Revoke the session that owns this refresh token (logout). Idempotent. */
  async revokeByToken(
    rawToken: string,
    reason: SessionRevokeReason,
  ): Promise<RefreshSessionRecord | null> {
    const record = await this.repository.revokeByTokenHash(hashToken(rawToken), reason);
    if (record) await this.repository.revokeFamily(record.tokenFamily, reason);
    return record;
  }

  revokeAll(userId: string, reason: SessionRevokeReason, exceptFamily?: string): Promise<number> {
    return this.repository.revokeAllForUser(userId, reason, exceptFamily ? { exceptFamily } : {});
  }

  isActive(tokenFamily: string, userId: string): Promise<boolean> {
    return this.repository.isFamilyActive(tokenFamily, userId);
  }

  async list(userId: string, currentFamily: string): Promise<SessionDto[]> {
    const records = await this.repository.listActiveForUser(userId);
    return records.map((record) => ({
      id: record.tokenFamily,
      userAgent: record.deviceInformation?.userAgent ?? null,
      deviceLabel: record.deviceInformation?.label ?? 'Unknown device',
      ipAddress: record.ipAddress,
      signedInAt: record.familyCreatedAt.toISOString(),
      lastActiveAt: record.createdAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      current: record.tokenFamily === currentFamily,
    }));
  }

  /** Resource-scoped revoke: the userId filter means another user's session id is simply "not found". */
  async revokeForUser(userId: string, tokenFamily: string): Promise<void> {
    const count = await this.repository.revokeFamily(tokenFamily, 'USER_REVOKED', userId);
    if (count === 0) throw Errors.notFound('Session');
  }
}
