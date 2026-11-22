import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongoose';
import type {
  AuthSessionDto,
  ChangePasswordInput,
  LoginInput,
  RegisterPayload,
  UserDto,
} from '@stayscape/shared';
import type { Config } from '@/config/env';
import { generateOpaqueToken, hashToken } from '@/lib/crypto';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import type { Logger } from '@/lib/logger';
import type { PasswordHasher } from '@/lib/password';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import type { EmailService } from '@/modules/notifications/email.service';
import type { NotificationService } from '@/modules/notifications/notification.service';
import { RefreshTokenReuseError, type SessionService } from '@/modules/sessions/session.service';
import { toUserDto } from '@/modules/users/user.mapper';
import type { UserRecord } from '@/modules/users/user.model';
import type { UserRepository } from '@/modules/users/user.repository';
import type { TokenService } from './token.service';
import type { VerificationTokenRepository } from './verification-token.repository';

export interface AuthResult {
  session: AuthSessionDto;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface Deps {
  config: Config;
  logger: Logger;
  users: UserRepository;
  verificationTokens: VerificationTokenRepository;
  sessions: SessionService;
  tokens: TokenService;
  hasher: PasswordHasher;
  audit: AuditService;
  notifications: NotificationService;
  email: EmailService;
}

const RESEND_COOLDOWN_MS = 60_000;

export function assertAccountUsable(user: Pick<UserRecord, 'accountStatus'>): void {
  if (user.accountStatus === 'SUSPENDED') {
    throw new AppError(
      403,
      'ACCOUNT_SUSPENDED',
      'This account has been suspended. Please contact support.',
    );
  }
  if (user.accountStatus === 'DEACTIVATED') {
    throw new AppError(403, 'ACCOUNT_DEACTIVATED', 'This account has been deactivated.');
  }
}

export class AuthService {
  constructor(private readonly deps: Deps) {}

  private async issueSession(
    user: UserRecord,
    context: RequestContext,
    existingFamily?: { refreshToken: string; tokenFamily: string; expiresAt: Date },
  ): Promise<AuthResult> {
    const refresh =
      existingFamily ?? (await this.deps.sessions.start(user._id.toString(), context));
    const access = this.deps.tokens.signAccessToken({
      sub: user._id.toString(),
      sid: refresh.tokenFamily,
    });
    return {
      session: { accessToken: access.token, expiresIn: access.expiresIn, user: toUserDto(user) },
      refreshToken: refresh.refreshToken,
      refreshExpiresAt: refresh.expiresAt,
    };
  }

  private async createVerificationToken(
    userId: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
    session?: ClientSession,
  ) {
    const { config, verificationTokens } = this.deps;
    const token = generateOpaqueToken(32);
    const ttlMs =
      purpose === 'EMAIL_VERIFICATION'
        ? config.EMAIL_VERIFICATION_TTL_HOURS * 3600 * 1000
        : config.PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
    await verificationTokens.invalidateOutstanding(userId, purpose, session);
    const record = await verificationTokens.create(
      { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) },
      session,
    );
    return { token, tokenId: record._id.toString() };
  }

  async register(input: RegisterPayload, context: RequestContext): Promise<AuthResult> {
    const { users, hasher, email, audit, notifications } = this.deps;
    if (await users.findByEmail(input.email)) {
      throw Errors.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
    }
    const passwordHash = await hasher.hash(input.password);

    let created: { user: UserRecord; token: string; tokenId: string };
    try {
      // User and verification token are created atomically: no orphan users without a token.
      created = await withTransaction(async (session) => {
        const user = await users.create(
          {
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone,
            passwordHash,
          },
          session,
        );
        const verification = await this.createVerificationToken(
          user._id.toString(),
          'EMAIL_VERIFICATION',
          session,
        );
        return { user, ...verification };
      });
    } catch (error) {
      if (isMongoDuplicateKey(error))
        throw Errors.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
      throw error;
    }

    const { user } = created;
    const userId = user._id.toString();
    await email.sendEmailVerification({
      to: user.email,
      firstName: user.firstName,
      token: created.token,
      tokenId: created.tokenId,
    });
    await audit.record({
      actorId: userId,
      action: 'auth.register',
      entityType: 'User',
      entityId: userId,
      context,
    });
    await notifications.notifyInApp({
      userId,
      type: 'ACCOUNT_WELCOME',
      title: 'Welcome to STAYSCAPE',
      body: 'Your account is ready. Verify your email address to secure it.',
    });
    await users.recordLogin(userId);
    return this.issueSession(user, context);
  }

  async login(input: LoginInput, context: RequestContext): Promise<AuthResult> {
    const { users, hasher, audit } = this.deps;
    const email = input.email.trim().toLowerCase();
    const user = await users.findByEmailWithPassword(email);
    if (!user) {
      await hasher.verifyDummy(input.password);
      await audit.record({
        actorId: null,
        action: 'auth.login_failed',
        entityType: 'User',
        metadata: { reason: 'unknown_email' },
        context,
      });
      throw Errors.invalidCredentials();
    }
    const valid = await hasher.verify(user.passwordHash, input.password);
    if (!valid) {
      await audit.record({
        actorId: null,
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user._id.toString(),
        metadata: { reason: 'bad_password' },
        context,
      });
      throw Errors.invalidCredentials();
    }
    // Status is only disclosed after the password is proven, so it does not aid enumeration.
    assertAccountUsable(user);

    const userId = user._id.toString();
    await users.recordLogin(userId);
    const fresh = (await users.findById(userId)) ?? user;
    const result = await this.issueSession(fresh, context);
    await audit.record({
      actorId: userId,
      action: 'auth.login',
      entityType: 'User',
      entityId: userId,
      context,
    });
    return result;
  }

  async refresh(rawToken: string | undefined, context: RequestContext): Promise<AuthResult> {
    if (!rawToken)
      throw new AppError(
        401,
        'REFRESH_TOKEN_INVALID',
        'Your session has expired. Please sign in again.',
      );
    let rotated;
    try {
      rotated = await this.deps.sessions.rotate(rawToken, context);
    } catch (error) {
      if (error instanceof RefreshTokenReuseError) {
        await this.deps.audit.record({
          actorId: error.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'RefreshSession',
          entityId: error.tokenFamily,
          context,
        });
        this.deps.logger.warn(
          { userId: error.userId, requestId: context.requestId },
          'Refresh token reuse detected',
        );
      }
      throw error;
    }
    const user = await this.deps.users.findById(rotated.userId);
    if (!user)
      throw new AppError(
        401,
        'REFRESH_TOKEN_INVALID',
        'Your session has expired. Please sign in again.',
      );
    try {
      assertAccountUsable(user);
    } catch (error) {
      await this.deps.sessions.revokeAll(rotated.userId, 'ACCOUNT_SUSPENDED');
      throw error;
    }
    return this.issueSession(user, context, rotated);
  }

  async logout(rawToken: string | undefined, context: RequestContext): Promise<void> {
    if (!rawToken) return;
    const record = await this.deps.sessions.revokeByToken(rawToken, 'LOGOUT');
    if (record) {
      await this.deps.audit.record({
        actorId: record.userId.toString(),
        action: 'auth.logout',
        entityType: 'RefreshSession',
        entityId: record.tokenFamily,
        context,
      });
    }
  }

  async logoutAll(userId: string, context: RequestContext): Promise<number> {
    const count = await this.deps.sessions.revokeAll(userId, 'LOGOUT_ALL');
    await this.deps.audit.record({
      actorId: userId,
      action: 'auth.logout_all',
      entityType: 'User',
      entityId: userId,
      metadata: { revoked: count },
      context,
    });
    return count;
  }

  /** Always resolves without revealing whether the account exists. */
  async forgotPassword(emailAddress: string, context: RequestContext): Promise<void> {
    const user = await this.deps.users.findByEmail(emailAddress);
    if (!user || user.accountStatus !== 'ACTIVE') {
      await this.deps.audit.record({
        actorId: null,
        action: 'auth.password_reset_requested',
        entityType: 'User',
        metadata: { matched: false },
        context,
      });
      return;
    }
    const userId = user._id.toString();
    const { token, tokenId } = await this.createVerificationToken(userId, 'PASSWORD_RESET');
    await this.deps.email.sendPasswordReset({
      to: user.email,
      firstName: user.firstName,
      token,
      tokenId,
    });
    await this.deps.audit.record({
      actorId: userId,
      action: 'auth.password_reset_requested',
      entityType: 'User',
      entityId: userId,
      metadata: { matched: true },
      context,
    });
  }

  async resetPassword(rawToken: string, password: string, context: RequestContext): Promise<void> {
    const { users, verificationTokens, hasher, sessions } = this.deps;
    const passwordHash = await hasher.hash(password);
    const user = await withTransaction(async (session) => {
      const token = await verificationTokens.consume(
        hashToken(rawToken),
        'PASSWORD_RESET',
        session,
      );
      if (!token) {
        throw new AppError(
          400,
          'VERIFICATION_TOKEN_INVALID',
          'This reset link is invalid or has expired. Please request a new one.',
        );
      }
      const userId = token.userId.toString();
      const target = await users.findById(userId);
      if (!target || target.accountStatus !== 'ACTIVE') {
        throw new AppError(
          400,
          'VERIFICATION_TOKEN_INVALID',
          'This reset link is invalid or has expired. Please request a new one.',
        );
      }
      await users.setPassword(userId, passwordHash, session);
      // Anyone holding a session (possibly the attacker that prompted the reset) is signed out.
      await sessions.revokeAll(userId, 'PASSWORD_CHANGED');
      return target;
    });
    await this.afterPasswordChange(user, 'auth.password_reset', context);
  }

  async changePassword(
    userId: string,
    currentFamily: string,
    input: ChangePasswordInput,
    context: RequestContext,
  ): Promise<void> {
    const { users, hasher, sessions } = this.deps;
    const user = await users.findByIdWithPassword(userId);
    if (!user) throw Errors.unauthorized();
    if (!(await hasher.verify(user.passwordHash, input.currentPassword))) {
      throw Errors.validation(
        { fieldErrors: { currentPassword: ['Current password is incorrect'] } },
        'Current password is incorrect.',
      );
    }
    await users.setPassword(userId, await hasher.hash(input.newPassword));
    await sessions.revokeAll(userId, 'PASSWORD_CHANGED', currentFamily);
    await this.afterPasswordChange(user, 'auth.password_changed', context);
  }

  private async afterPasswordChange(user: UserRecord, action: string, context: RequestContext) {
    const userId = user._id.toString();
    await this.deps.audit.record({
      actorId: userId,
      action,
      entityType: 'User',
      entityId: userId,
      context,
    });
    await this.deps.notifications.notifyInApp({
      userId,
      type: 'PASSWORD_CHANGED',
      title: 'Password changed',
      body: 'Your password was changed and other sessions were signed out.',
    });
    if (user.preferences?.notifications?.emailSecurityAlerts !== false) {
      await this.deps.email.sendPasswordChanged({
        to: user.email,
        firstName: user.firstName,
        eventId: randomUUID(),
      });
    }
  }

  async verifyEmail(rawToken: string, context: RequestContext): Promise<UserDto> {
    const { users, verificationTokens } = this.deps;
    const token = await verificationTokens.consume(hashToken(rawToken), 'EMAIL_VERIFICATION');
    if (!token) {
      throw new AppError(
        400,
        'VERIFICATION_TOKEN_INVALID',
        'This verification link is invalid or has expired.',
      );
    }
    const userId = token.userId.toString();
    await users.markEmailVerified(userId);
    const user = await users.findById(userId);
    if (!user)
      throw new AppError(
        400,
        'VERIFICATION_TOKEN_INVALID',
        'This verification link is invalid or has expired.',
      );
    await this.deps.audit.record({
      actorId: userId,
      action: 'auth.email_verified',
      entityType: 'User',
      entityId: userId,
      context,
    });
    await this.deps.notifications.notifyInApp({
      userId,
      type: 'EMAIL_VERIFIED',
      title: 'Email verified',
      body: `${user.email} is now verified.`,
    });
    return toUserDto(user);
  }

  /** Generic response regardless of account state; enforces a resend cooldown. */
  async resendVerification(emailAddress: string, context: RequestContext): Promise<void> {
    const user = await this.deps.users.findByEmail(emailAddress);
    if (!user || user.emailVerifiedAt || user.accountStatus !== 'ACTIVE') return;
    const userId = user._id.toString();
    const latest = await this.deps.verificationTokens.findLatestOutstanding(
      userId,
      'EMAIL_VERIFICATION',
    );
    if (latest && Date.now() - new Date(latest.createdAt).getTime() < RESEND_COOLDOWN_MS) return;
    const { token, tokenId } = await this.createVerificationToken(userId, 'EMAIL_VERIFICATION');
    await this.deps.email.sendEmailVerification({
      to: user.email,
      firstName: user.firstName,
      token,
      tokenId,
    });
    await this.deps.audit.record({
      actorId: userId,
      action: 'auth.verification_resent',
      entityType: 'User',
      entityId: userId,
      context,
    });
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw Errors.unauthorized();
    return toUserDto(user);
  }
}
