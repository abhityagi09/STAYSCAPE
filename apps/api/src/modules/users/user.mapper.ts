import { permissionsForRoles, type AdminUserDto, type UserDto } from '@stayscape/shared';
import type { UserRecord } from './user.model';

const iso = (date: Date | null | undefined) => (date ? new Date(date).toISOString() : null);

/** The only path by which a user record leaves the API. passwordHash is never mapped. */
export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user._id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone ?? null,
    avatarUrl: user.avatar?.url ?? null,
    roles: user.roles,
    permissions: permissionsForRoles(user.roles),
    accountStatus: user.accountStatus,
    emailVerified: Boolean(user.emailVerifiedAt),
    emailVerifiedAt: iso(user.emailVerifiedAt),
    phoneVerifiedAt: iso(user.phoneVerifiedAt),
    preferences: {
      language: user.preferences?.language ?? 'en',
      currency: user.preferences?.currency ?? 'INR',
      notifications: {
        emailBookingUpdates: user.preferences?.notifications?.emailBookingUpdates ?? true,
        emailPromotions: user.preferences?.notifications?.emailPromotions ?? false,
        emailSecurityAlerts: user.preferences?.notifications?.emailSecurityAlerts ?? true,
        smsBookingUpdates: user.preferences?.notifications?.smsBookingUpdates ?? false,
        pushEnabled: user.preferences?.notifications?.pushEnabled ?? false,
      },
      personalization: {
        recommendations: user.preferences?.personalization?.recommendations ?? false,
        consentedAt: iso(user.preferences?.personalization?.consentedAt ?? null),
      },
    },
    lastLoginAt: iso(user.lastLoginAt),
    createdAt: new Date(user.createdAt).toISOString(),
    updatedAt: new Date(user.updatedAt).toISOString(),
  };
}

export function toAdminUserDto(user: UserRecord): AdminUserDto {
  return {
    id: user._id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    roles: user.roles,
    accountStatus: user.accountStatus,
    emailVerified: Boolean(user.emailVerifiedAt),
    lastLoginAt: iso(user.lastLoginAt),
    createdAt: new Date(user.createdAt).toISOString(),
  };
}
