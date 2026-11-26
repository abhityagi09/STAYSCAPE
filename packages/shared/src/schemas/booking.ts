import { z } from 'zod';
import {
  CANCELLATION_REASONS,
  REVIEW_MAX_PHOTOS,
  REVIEW_REPORT_REASONS,
  TICKET_CATEGORIES,
} from '../constants/booking';
import { BOOKING_STATUSES } from '../constants/booking';
import { MAX_ROOMS_PER_SEARCH, MAX_STAY_NIGHTS } from '../constants/marketplace';
import { diffDays, isValidLocalDate } from '../utils/local-date';
import { objectIdSchema } from './common';

/**
 * Request schemas for the reservation domain. All are strict: clients can never submit prices,
 * totals, statuses, customer ids or other server-owned fields — unknown keys are rejected.
 */

const localDate = z.string().refine(isValidLocalDate, 'Use a valid date (YYYY-MM-DD)');
const trimmed = (max: number) => z.string().trim().max(max);
const name = (label: string) => z.string().trim().min(1, `${label} is required`).max(60);
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +919812345678');

export const holdItemSchema = z.strictObject({
  roomTypeId: objectIdSchema,
  ratePlanId: objectIdSchema,
  rooms: z.number().int().min(1).max(MAX_ROOMS_PER_SEARCH),
  adults: z.number().int().min(1).max(30),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(10).default([]),
  extraBeds: z.number().int().min(0).max(10).default(0),
});

export const createHoldSchema = z
  .strictObject({
    hotelId: objectIdSchema,
    checkIn: localDate,
    checkOut: localDate,
    /** One room category and rate plan per booking (the model supports more; see docs). */
    items: z.array(holdItemSchema).min(1).max(1),
    couponCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, 'Invalid coupon code').optional(),
  })
  .superRefine((v, ctx) => {
    if (!isValidLocalDate(v.checkIn) || !isValidLocalDate(v.checkOut)) return;
    const nights = diffDays(v.checkIn, v.checkOut);
    if (nights < 1)
      ctx.addIssue({
        code: 'custom',
        path: ['checkOut'],
        message: 'Check-out must be after check-in',
      });
    if (nights > MAX_STAY_NIGHTS)
      ctx.addIssue({
        code: 'custom',
        path: ['checkOut'],
        message: `Stays can be up to ${MAX_STAY_NIGHTS} nights`,
      });
    for (const [i, item] of v.items.entries()) {
      if (item.rooms > item.adults)
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'rooms'],
          message: 'Each room needs at least one adult',
        });
    }
  });
export type CreateHoldInput = z.output<typeof createHoldSchema>;

export const guestSchema = z.strictObject({
  firstName: name('First name'),
  lastName: name('Last name'),
});

export const guestDetailsSchema = z.strictObject({
  primaryGuest: z.strictObject({
    firstName: name('First name'),
    lastName: name('Last name'),
    email: z.email('Enter a valid email').trim().toLowerCase().max(254),
    phone,
  }),
  additionalGuests: z.array(guestSchema).max(40).default([]),
  specialRequests: trimmed(1000).default(''),
  estimatedArrivalTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')
    .nullable()
    .default(null),
});
export type GuestDetailsInput = z.output<typeof guestDetailsSchema>;

export const createBookingSchema = z.strictObject({
  holdReference: z.string().regex(/^HLD-[A-Z0-9]{10}$/, 'Invalid hold reference'),
  guestDetails: guestDetailsSchema,
  acceptTerms: z.literal(true, { error: 'You must accept the booking terms' }),
});
export type CreateBookingInput = z.output<typeof createBookingSchema>;

export const bookingReferenceSchema = z
  .string()
  .regex(/^SS-[A-Z0-9]{8}$/, 'Invalid booking reference');
export const bookingReferenceParams = z.object({ reference: bookingReferenceSchema });

export const listBookingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.enum(BOOKING_STATUSES).optional(),
  /** Group filters used by the dashboard tabs. */
  view: z.enum(['upcoming', 'past', 'cancelled', 'pending', 'all']).default('all'),
  q: z.string().trim().max(80).optional(),
});
export type ListBookingsQuery = z.output<typeof listBookingsQuerySchema>;

export const verifyPaymentSchema = z.strictObject({
  providerOrderId: z.string().trim().min(6).max(64),
  providerPaymentId: z.string().trim().min(6).max(64),
  signature: z.string().trim().min(16).max(256),
});
export type VerifyPaymentInput = z.output<typeof verifyPaymentSchema>;

export const cancelBookingSchema = z.strictObject({
  reason: trimmed(500).default(''),
});

export const sandboxCompleteSchema = z.strictObject({
  outcome: z.enum(['success', 'failure']),
  /** When false the provider "forgets" to call the webhook — exercises reconciliation. */
  deliverWebhook: z.boolean().default(true),
});

export const adminRefundSchema = z.strictObject({
  amountMinor: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
});

export const refundRequestSchema = z.strictObject({
  reason: z.string().trim().min(10, 'Tell us why you are requesting a refund').max(1000),
});

export const refundDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('APPROVE'), amountMinor: z.number().int().min(1) }),
  z.strictObject({ decision: z.literal('REJECT'), reason: z.string().trim().min(3).max(500) }),
]);

export const partnerBookingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  view: z.enum(['arrivals', 'departures', 'in-house', 'upcoming', 'past', 'all']).default('upcoming'),
  status: z.enum(BOOKING_STATUSES).optional(),
  from: localDate.optional(),
  to: localDate.optional(),
  q: z.string().trim().max(80).optional(),
});
export const bookingNoteSchema = z.strictObject({ body: z.string().trim().min(1, 'Write a note').max(2000) });
export const roomAssignmentSchema = z.strictObject({
  assignments: z.array(z.strictObject({ roomTypeId: objectIdSchema, roomNumbers: z.array(z.string().trim().min(1).max(20)).max(20) })).max(10),
});
export const partnerNoShowSchema = z.strictObject({ note: trimmed(500).default('') });
export const partnerRejectSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
export const cancellationReasonSchema = z.enum(CANCELLATION_REASONS);

// ---------------------------------------------------------------- wishlists
export const wishlistNameSchema = z.string().trim().min(1, 'Give the list a name').max(60);
export const createWishlistSchema = z.strictObject({ name: wishlistNameSchema });
export const updateWishlistSchema = z.strictObject({ name: wishlistNameSchema });
export const wishlistItemSchema = z.strictObject({ note: trimmed(300).default('') });
export const wishlistAvailabilityQuerySchema = z
  .object({
    checkIn: localDate.optional(),
    checkOut: localDate.optional(),
    adults: z.coerce.number().int().min(1).max(30).default(2),
    rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_SEARCH).default(1),
  })
  .refine((v) => Boolean(v.checkIn) === Boolean(v.checkOut), {
    message: 'Provide both dates',
    path: ['checkOut'],
  })
  .refine((v) => !v.checkIn || !v.checkOut || diffDays(v.checkIn, v.checkOut) >= 1, {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  });

// ---------------------------------------------------------------- reviews
const score = z.number().int().min(1, 'Rate from 1 to 5').max(5, 'Rate from 1 to 5');
export const reviewRatingsSchema = z.strictObject({
  cleanliness: score,
  staff: score,
  location: score,
  comfort: score,
  facilities: score,
  value: score,
});
export const reviewSchema = z.strictObject({
  ratings: reviewRatingsSchema,
  title: z.string().trim().min(3, 'Add a short title').max(120),
  body: z.string().trim().min(20, 'Write at least 20 characters').max(4000),
  photoIds: z.array(objectIdSchema).max(REVIEW_MAX_PHOTOS).default([]),
});
export type ReviewInput = z.output<typeof reviewSchema>;
export const reviewReportSchema = z.strictObject({
  reason: z.enum(REVIEW_REPORT_REASONS),
  details: trimmed(1000).default(''),
});
export const reviewResponseSchema = z.strictObject({
  body: z.string().trim().min(5).max(2000),
});
export const reviewModerationSchema = z.strictObject({
  decision: z.enum(['REMOVE', 'RESTORE', 'DISMISS_REPORTS']),
  reason: z.string().trim().min(3).max(500),
});
export const publicReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  sort: z.enum(['recent', 'highest', 'lowest']).default('recent'),
});

// ---------------------------------------------------------------- support
export const createTicketSchema = z.strictObject({
  subject: z.string().trim().min(5, 'Add a subject').max(140),
  category: z.enum(TICKET_CATEGORIES),
  bookingReference: bookingReferenceSchema.nullable().default(null),
  message: z.string().trim().min(10, 'Describe the issue (10+ characters)').max(5000),
});
export const ticketMessageSchema = z.strictObject({
  body: z.string().trim().min(1, 'Write a message').max(5000),
});
export const REVIEW_PHOTO_LIMIT = REVIEW_MAX_PHOTOS;
