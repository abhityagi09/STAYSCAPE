import type {
  AccountStatus,
  CurrencyCode,
  Language,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
} from '../constants/account';
import type { Permission } from '../constants/permissions';
import type { Role } from '../constants/roles';
import type { NotificationPreferences } from '../schemas/users';

export interface UserPreferencesDto {
  language: Language;
  currency: CurrencyCode;
  notifications: NotificationPreferences;
}

export interface UserDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  roles: Role[];
  permissions: Permission[];
  accountStatus: AccountStatus;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  preferences: UserPreferencesDto;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Reduced projection for administrative listings. */
export interface AdminUserDto {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: Role[];
  accountStatus: AccountStatus;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthSessionDto {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: UserDto;
}

export interface SessionDto {
  /** Stable session identifier (refresh token family). */
  id: string;
  userAgent: string | null;
  deviceLabel: string;
  ipAddress: string | null;
  signedInAt: string;
  lastActiveAt: string;
  expiresAt: string;
  current: boolean;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  channel: NotificationChannel;
  title: string;
  body: string;
  deliveryStatus: NotificationDeliveryStatus;
  readAt: string | null;
  resource: { type: string; id: string } | null;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  requestId: string | null;
  timestamp: string;
}

export interface RoleDefinitionDto {
  role: Role;
  label: string;
  permissions: Permission[];
  privileged: boolean;
}

export interface HealthDto {
  status: 'ok' | 'degraded' | 'unavailable';
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  checks?: Record<string, { status: 'up' | 'down'; latencyMs?: number }>;
}

export interface MessageDto {
  message: string;
}
