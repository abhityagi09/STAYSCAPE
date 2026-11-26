import { randomUUID } from 'node:crypto';
import {
  AVATAR_MAX_BYTES,
  ROLE_LABELS,
  canModerateAccount,
  checkRoleChange,
  type AdminUserDto,
  type ListUsersQuery,
  type Paginated,
  type Role,
  type UpdatePreferencesInput,
  type UpdateUserStatusInput,
  type UserDto,
} from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { Logger } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import type { StorageProvider } from '@/infrastructure/storage/storage.provider';
import type { AuditService } from '@/modules/audit/audit.service';
import type { NotificationService } from '@/modules/notifications/notification.service';
import type { SessionService } from '@/modules/sessions/session.service';
import { toAdminUserDto, toUserDto } from './user.mapper';
import type { UserRepository } from './user.repository';

interface Deps {
  users: UserRepository;
  sessions: SessionService;
  storage: StorageProvider;
  audit: AuditService;
  notifications: NotificationService;
  logger: Logger;
}

const IMAGE_SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      b.length > 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) =>
      b.length > 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** Determine the real image type from magic bytes; the client-declared MIME type is not trusted. */
export function sniffImage(buffer: Buffer): { mime: string; ext: string } | null {
  const match = IMAGE_SIGNATURES.find((signature) => signature.test(buffer));
  return match ? { mime: match.mime, ext: match.ext } : null;
}

export class UsersService {
  constructor(private readonly deps: Deps) {}

  async getProfile(userId: string): Promise<UserDto> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw Errors.notFound('User');
    return toUserDto(user);
  }

  async updateProfile(
    userId: string,
    input: {
      firstName?: string | undefined;
      lastName?: string | undefined;
      phone?: string | null | undefined;
    },
    context: RequestContext,
  ): Promise<UserDto> {
    const set: Record<string, unknown> = {};
    if (input.firstName !== undefined) set.firstName = input.firstName;
    if (input.lastName !== undefined) set.lastName = input.lastName;
    if (input.phone !== undefined) {
      const current = await this.deps.users.findById(userId);
      if (current && current.phone !== input.phone) {
        set.phone = input.phone;
        set.phoneVerifiedAt = null; // a changed number must be re-verified
      }
    }
    const user = await this.deps.users.update(userId, { $set: set });
    if (!user) throw Errors.notFound('User');
    await this.deps.audit.record({
      actorId: userId,
      action: 'user.profile_updated',
      entityType: 'User',
      entityId: userId,
      metadata: { fields: Object.keys(set) },
      context,
    });
    return toUserDto(user);
  }

  async updatePreferences(
    userId: string,
    input: UpdatePreferencesInput,
    context: RequestContext,
  ): Promise<UserDto> {
    const set: Record<string, unknown> = {};
    if (input.language) set['preferences.language'] = input.language;
    if (input.currency) set['preferences.currency'] = input.currency;
    for (const [key, value] of Object.entries(input.notifications ?? {})) {
      if (typeof value === 'boolean') set[`preferences.notifications.${key}`] = value;
    }
    if (input.personalization) {
      set['preferences.personalization.recommendations'] = input.personalization.recommendations;
      // The consent timestamp records when the user opted in (cleared on opt-out).
      set['preferences.personalization.consentedAt'] = input.personalization.recommendations ? new Date() : null;
    }
    const user = await this.deps.users.update(userId, { $set: set });
    if (!user) throw Errors.notFound('User');
    await this.deps.audit.record({
      actorId: userId,
      action: 'user.preferences_updated',
      entityType: 'User',
      entityId: userId,
      metadata: { fields: Object.keys(set) },
      context,
    });
    return toUserDto(user);
  }

  async uploadAvatar(
    userId: string,
    file: { buffer: Buffer; size: number; mimetype: string } | undefined,
    context: RequestContext,
  ): Promise<UserDto> {
    if (!file) throw Errors.badRequest('Attach an image in the "avatar" field.');
    if (file.size > AVATAR_MAX_BYTES)
      throw Errors.tooLarge('Avatar images must be 2 MB or smaller.');
    const detected = sniffImage(file.buffer);
    if (!detected) throw Errors.unsupportedMedia('Avatars must be JPEG, PNG or WebP images.');

    const existing = await this.deps.users.findById(userId);
    if (!existing) throw Errors.notFound('User');

    const key = `avatars/${userId}/${randomUUID()}.${detected.ext}`;
    const stored = await this.deps.storage.put(key, file.buffer, detected.mime);
    const user = await this.deps.users.update(userId, {
      $set: {
        avatar: {
          url: stored.url,
          key: stored.key,
          contentType: stored.contentType,
          size: stored.size,
          updatedAt: new Date(),
        },
      },
    });
    if (!user) throw Errors.notFound('User');

    if (existing.avatar?.key) {
      await this.deps.storage
        .delete(existing.avatar.key)
        .catch((error: unknown) =>
          this.deps.logger.warn(
            { err: error, key: existing.avatar?.key },
            'Failed to delete previous avatar',
          ),
        );
    }
    await this.deps.audit.record({
      actorId: userId,
      action: 'user.avatar_updated',
      entityType: 'User',
      entityId: userId,
      context,
    });
    return toUserDto(user);
  }

  listSessions(userId: string, currentSessionId: string) {
    return this.deps.sessions.list(userId, currentSessionId);
  }

  async revokeSession(userId: string, sessionId: string, context: RequestContext): Promise<void> {
    await this.deps.sessions.revokeForUser(userId, sessionId);
    await this.deps.audit.record({
      actorId: userId,
      action: 'user.session_revoked',
      entityType: 'RefreshSession',
      entityId: sessionId,
      context,
    });
  }

  // ---- administration -------------------------------------------------------------------

  async listUsers(query: ListUsersQuery): Promise<Paginated<AdminUserDto>> {
    const { items, total } = await this.deps.users.list(query);
    return paginated(items.map(toAdminUserDto), query.page, query.limit, total);
  }

  async updateRoles(
    actor: { userId: string; roles: Role[] },
    targetId: string,
    roles: Role[],
    context: RequestContext,
  ): Promise<AdminUserDto> {
    const target = await this.deps.users.findById(targetId);
    if (!target) throw Errors.notFound('User');
    const check = checkRoleChange({
      actorId: actor.userId,
      actorRoles: actor.roles,
      targetId,
      targetCurrentRoles: target.roles,
      nextRoles: roles,
    });
    if (!check.allowed) throw new AppError(403, 'FORBIDDEN', check.reason ?? 'Not allowed.');

    const updated = await this.deps.users.setRoles(targetId, roles);
    if (!updated) throw Errors.notFound('User');
    await this.deps.audit.record({
      actorId: actor.userId,
      action: 'user.roles_updated',
      entityType: 'User',
      entityId: targetId,
      metadata: { from: target.roles, to: roles },
      context,
    });
    await this.deps.notifications.notifyInApp({
      userId: targetId,
      type: 'ROLE_CHANGED',
      title: 'Your account access changed',
      body: `Your roles are now: ${roles.map((role) => ROLE_LABELS[role]).join(', ')}.`,
    });
    return toAdminUserDto(updated);
  }

  async updateStatus(
    actor: { userId: string; roles: Role[] },
    targetId: string,
    input: UpdateUserStatusInput,
    context: RequestContext,
  ): Promise<AdminUserDto> {
    const target = await this.deps.users.findById(targetId);
    if (!target) throw Errors.notFound('User');
    const check = canModerateAccount({
      actorId: actor.userId,
      actorRoles: actor.roles,
      targetId,
      targetRoles: target.roles,
    });
    if (!check.allowed) throw new AppError(403, 'FORBIDDEN', check.reason ?? 'Not allowed.');

    const updated = await this.deps.users.setStatus(targetId, input.status);
    if (!updated) throw Errors.notFound('User');
    if (input.status !== 'ACTIVE')
      await this.deps.sessions.revokeAll(targetId, 'ACCOUNT_SUSPENDED');
    await this.deps.audit.record({
      actorId: actor.userId,
      action: 'user.status_updated',
      entityType: 'User',
      entityId: targetId,
      metadata: { from: target.accountStatus, to: input.status, reason: input.reason ?? null },
      context,
    });
    return toAdminUserDto(updated);
  }
}
