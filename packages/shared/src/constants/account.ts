export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', hi: 'हिन्दी (Hindi)' };

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

/** Number of minor units per major unit (ISO 4217 exponent). */
export const CURRENCY_EXPONENT: Record<CurrencyCode, number> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AED: 2,
};

export const VERIFICATION_PURPOSES = ['EMAIL_VERIFICATION', 'PASSWORD_RESET'] as const;
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ['PENDING', 'SENT', 'DELIVERED', 'FAILED'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'ACCOUNT_WELCOME',
  'EMAIL_VERIFIED',
  'PASSWORD_CHANGED',
  'SECURITY_ALERT',
  'ROLE_CHANGED',
  'PARTNER_SUBMITTED',
  'PARTNER_APPROVED',
  'PARTNER_REJECTED',
  'PARTNER_DOCUMENTS_REQUESTED',
  'PARTNER_SUSPENDED',
  'PROPERTY_APPROVED',
  'PROPERTY_REJECTED',
  'PROPERTY_SUSPENDED',
  'STAFF_INVITATION',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number];
