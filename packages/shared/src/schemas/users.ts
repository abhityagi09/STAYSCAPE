import { z } from 'zod';
import { ACCOUNT_STATUSES, CURRENCIES, LANGUAGES } from '../constants/account';
import { ROLES } from '../constants/roles';
import { paginationQuerySchema, personNameSchema, phoneSchema } from './common';

export const updateProfileSchema = z
  .strictObject({
    firstName: personNameSchema('First name').optional(),
    lastName: personNameSchema('Last name').optional(),
    /** `null` or empty string removes the phone number. */
    phone: z
      .union([phoneSchema, z.literal(''), z.null()])
      .optional()
      .transform((value) => (value === '' ? null : value)),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one field to update',
  });
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const notificationPreferencesSchema = z.strictObject({
  emailBookingUpdates: z.boolean(),
  emailPromotions: z.boolean(),
  emailSecurityAlerts: z.boolean(),
  smsBookingUpdates: z.boolean(),
  pushEnabled: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export const updatePreferencesSchema = z
  .strictObject({
    language: z.enum(LANGUAGES).optional(),
    currency: z.enum(CURRENCIES).optional(),
    notifications: notificationPreferencesSchema.partial().optional(),
    /** Opt-in consent for recommendations from the user's own bookings and saved stays. */
    personalization: z.strictObject({ recommendations: z.boolean() }).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one preference to update',
  });
export type UpdatePreferencesInput = z.input<typeof updatePreferencesSchema>;

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(ACCOUNT_STATUSES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const updateUserRolesSchema = z.strictObject({
  roles: z
    .array(z.enum(ROLES))
    .min(1, 'At least one role is required')
    .max(ROLES.length)
    .transform((roles) => [...new Set(roles)]),
});
export type UpdateUserRolesInput = z.input<typeof updateUserRolesSchema>;

export const updateUserStatusSchema = z.strictObject({
  status: z.enum(ACCOUNT_STATUSES),
  reason: z.string().trim().max(500).optional(),
});
export type UpdateUserStatusInput = z.input<typeof updateUserStatusSchema>;

export const listAuditQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(100).optional(),
  actorId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
  entityType: z.string().trim().max(60).optional(),
});
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const newsletterSubscribeSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).email('Enter a valid email address'),
  source: z.enum(['homepage', 'footer']).default('homepage'),
});
export type NewsletterSubscribeInput = z.input<typeof newsletterSubscribeSchema>;
