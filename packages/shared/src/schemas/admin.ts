import { z } from 'zod';
import { CURRENCIES } from '../constants/account';
import { BOOKING_STATUSES, PAYMENT_STATUSES, REFUND_STATUSES } from '../constants/booking';
import { AMENITY_CATEGORIES, PROPERTY_TYPES } from '../constants/marketplace';
import { objectIdSchema } from './common';
import { localDateSchema } from './marketplace';

/** Phase 4 administration and finance request schemas (strict: unknown keys are rejected). */

const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Use a valid date');

export const commissionRuleSchema = z
  .strictObject({
    name: z.string().trim().min(3).max(120),
    scope: z.enum(['GLOBAL', 'PARTNER', 'HOTEL']),
    partnerId: objectIdSchema.nullable().default(null),
    hotelId: objectIdSchema.nullable().default(null),
    rateBasisPoints: z.number().int().min(0).max(10_000),
    fixedMinor: z.number().int().min(0).max(100_000_000).default(0),
    base: z.enum(['ROOM_SUBTOTAL', 'DISCOUNTED_ROOM_SUBTOTAL']).default('DISCOUNTED_ROOM_SUBTOTAL'),
    includeFees: z.boolean().default(false),
    promotional: z.boolean().default(false),
    exempt: z.boolean().default(false),
    effectiveFrom: isoDateTime,
    effectiveTo: isoDateTime.nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((v) => !v.effectiveTo || Date.parse(v.effectiveTo) > Date.parse(v.effectiveFrom), {
    message: 'End must be after start',
    path: ['effectiveTo'],
  });
export type CommissionRuleInputDto = z.output<typeof commissionRuleSchema>;

export const commissionPreviewSchema = z.strictObject({
  partnerId: objectIdSchema,
  hotelId: objectIdSchema,
  totals: z.strictObject({
    roomChargesMinor: z.number().int().min(0),
    discountsMinor: z.number().int().max(0),
    subtotalMinor: z.number().int().min(0),
    taxesMinor: z.number().int().min(0),
    feesMinor: z.number().int().min(0),
    totalMinor: z.number().int().min(0),
  }),
});

export const periodQuerySchema = z
  .object({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    compare: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
  })
  .refine((v) => !v.from || !v.to || Date.parse(v.to) > Date.parse(v.from), {
    message: 'End must be after start',
    path: ['to'],
  });

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const ledgerQuerySchema = pageQuerySchema.extend({
  partnerId: objectIdSchema.optional(),
  account: z
    .enum(['CASH', 'PARTNER_PAYABLE', 'PLATFORM_REVENUE', 'PROMOTION_EXPENSE', 'UNALLOCATED'])
    .optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
});

export const createSettlementSchema = z.strictObject({ partnerId: objectIdSchema });
export const settlementReasonSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
export const settlementsQuerySchema = pageQuerySchema.extend({
  partnerId: objectIdSchema.optional(),
  status: z.enum(['PENDING', 'ELIGIBLE', 'PROCESSING', 'PAID', 'FAILED', 'ON_HOLD']).optional(),
});
export const settlementPaymentFieldsSchema = z.strictObject({
  method: z.enum(['BANK_TRANSFER', 'PAYOUT_PROVIDER']),
  providerReference: z
    .string()
    .trim()
    .min(4, 'Enter the bank/provider reference (e.g. UTR)')
    .max(120),
  paidAt: isoDateTime,
});

export const COUPON_KIND_VALUES = [
  'STANDARD',
  'FIRST_BOOKING',
  'PROPERTY',
  'DESTINATION',
  'SEASONAL',
  'LIMITED_TIME',
  'REFERRAL',
  'LOYALTY',
] as const;
export const couponSchema = z
  .strictObject({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,32}$/, '3–32 letters, digits or dashes'),
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().max(500).default(''),
    kind: z.enum(COUPON_KIND_VALUES).default('STANDARD'),
    discountType: z.enum(['PERCENT', 'FIXED']),
    value: z.number().int().min(1),
    maxDiscountMinor: z.number().int().min(1).nullable().default(null),
    minBookingMinor: z.number().int().min(0).default(0),
    currencies: z
      .array(z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']))
      .min(1)
      .default(['INR']),
    startsAt: isoDateTime,
    endsAt: isoDateTime.nullable().default(null),
    totalLimit: z.number().int().min(1).nullable().default(null),
    perUserLimit: z.number().int().min(1).max(100).default(1),
    firstBookingOnly: z.boolean().default(false),
    eligibleHotelIds: z.array(objectIdSchema).max(500).default([]),
    eligibleCities: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
    eligibleUserIds: z.array(objectIdSchema).max(1000).default([]),
    stackableWithRateDiscounts: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .refine((v) => v.discountType !== 'PERCENT' || v.value <= 10_000, {
    message: 'A percentage is at most 10000 basis points',
    path: ['value'],
  })
  .refine((v) => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: 'End must be after start',
    path: ['endsAt'],
  });
export type CouponInputDto = z.output<typeof couponSchema>;

export const couponCheckSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,32}$/, 'Invalid coupon code'),
  holdReference: z.string().regex(/^HLD-[A-Z0-9]{10}$/),
});

/** Analytics period: property-local calendar dates, end exclusive. `hotelIds` is a comma-separated list. */
export const analyticsQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    hotelIds: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      )
      .pipe(z.array(objectIdSchema).max(50).optional()),
    currency: z.enum(CURRENCIES).optional(),
    compare: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v !== 'false'),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .refine((v) => !v.from || !v.to || v.to > v.from, {
    message: 'End must be after start',
    path: ['to'],
  });
export type AnalyticsQueryDto = z.output<typeof analyticsQuerySchema>;

// ---------------------------------------------------------------- support console
const TICKET_STATUS_VALUES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_CUSTOMER',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;
const TICKET_PRIORITY_VALUES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const supportQueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum([...TICKET_STATUS_VALUES, 'ACTIVE']).default('ACTIVE'),
  priority: z.enum(TICKET_PRIORITY_VALUES).optional(),
  assignee: z.union([z.enum(['me', 'unassigned']), objectIdSchema]).optional(),
  category: z.string().max(40).optional(),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(['priority', 'oldest', 'newest', 'last_message']).default('priority'),
});
export const ticketAssignSchema = z.strictObject({ assigneeId: objectIdSchema.nullable() });
export const ticketUpdateSchema = z
  .strictObject({
    priority: z.enum(TICKET_PRIORITY_VALUES).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER']).optional(),
    partnerVisible: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
export const agentMessageSchema = z.object({
  channel: z.enum(['CUSTOMER', 'PARTNER', 'INTERNAL']),
  body: z.string().trim().min(1).max(5000),
});
export const ticketEscalateSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
export const ticketResolveSchema = z.strictObject({
  resolution: z.string().trim().min(3).max(1000),
});
export const partnerTicketMessageSchema = z.object({ body: z.string().trim().min(1).max(5000) });

// ---------------------------------------------------------------- catalogue
const code = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{2,40}$/, 'Use 2–40 lowercase letters, digits or dashes');
export const amenityUpsertSchema = z.strictObject({
  code,
  name: z.string().trim().min(2).max(60),
  category: z.enum(AMENITY_CATEGORIES),
  icon: z.string().trim().max(40).default('sparkles'),
  description: z.string().trim().max(300).nullable().default(null),
  active: z.boolean().default(true),
});
export const destinationUpsertSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,80}$/),
  city: z.string().trim().min(2).max(80),
  region: z.string().trim().min(2).max(80),
  country: z.string().trim().toUpperCase().length(2),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  description: z.string().trim().min(10).max(600),
  images: z
    .array(
      z.strictObject({ url: z.string().url().max(500), alt: z.string().trim().min(2).max(160) }),
    )
    .max(8)
    .default([]),
  active: z.boolean().default(true),
});
export const propertyCategoryUpsertSchema = z
  .strictObject({
    code,
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(300).default(''),
    icon: z.string().trim().max(40).default('building'),
    propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(PROPERTY_TYPES.length).default([]),
    amenityCodes: z.array(code).max(10).default([]),
    sortOrder: z.number().int().min(0).max(1000).default(100),
    active: z.boolean().default(true),
  })
  .refine((v) => v.propertyTypes.length + v.amenityCodes.length > 0, {
    message: 'A category needs at least one property type or amenity',
    path: ['propertyTypes'],
  });
export const catalogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(60).optional(),
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

// ---------------------------------------------------------------- admin records
const listBase = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(80).optional(),
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  sort: z.enum(['newest', 'oldest', 'amount_desc', 'amount_asc']).default('newest'),
};
export const adminBookingsQuerySchema = z.object({
  ...listBase,
  status: z.enum(BOOKING_STATUSES).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  hotelId: objectIdSchema.optional(),
  escalated: z.enum(['true']).optional(),
});
export const adminPaymentsQuerySchema = z.object({
  ...listBase,
  status: z.enum(PAYMENT_STATUSES).optional(),
  exceptions: z.enum(['true']).optional(),
});
export const adminRefundsQuerySchema = z.object({
  ...listBase,
  status: z.enum(REFUND_STATUSES).optional(),
});
export const adminUsersQuerySchema = z.object({
  ...listBase,
  role: z.string().max(30).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
});
export const bookingEscalationSchema = z.strictObject({
  reason: z.string().trim().min(5).max(1000),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('HIGH'),
});
export const escalationResolveSchema = z.strictObject({
  resolution: z.string().trim().min(3).max(1000),
});
export const escalationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['OPEN', 'RESOLVED']).default('OPEN'),
});
