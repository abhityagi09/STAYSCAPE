/**
 * Reservation domain constants and state machines (Phase 3).
 *
 * Booking status and payment status are deliberately separate: a booking can be CONFIRMED while
 * its payment is PARTIALLY_REFUNDED, or EXPIRED while a late payment is being reconciled.
 * Transitions are only performed by explicit domain operations on the API — never by a generic
 * status update — and every allowed edge is listed here so tests and docs share one source.
 */

export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_PROCESSING',
  'CONFIRMED',
  'REJECTED',
  'CANCELLED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'COMPLETED',
  'EXPIRED',
  /** Verified payment, but the rooms could not be safely allocated. Refund/manual resolution. */
  'RECONCILIATION_REQUIRED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  PENDING_PAYMENT: [
    'PAYMENT_PROCESSING',
    'CONFIRMED',
    'CANCELLED',
    'EXPIRED',
    'RECONCILIATION_REQUIRED',
  ],
  PAYMENT_PROCESSING: [
    'PENDING_PAYMENT',
    'CONFIRMED',
    'CANCELLED',
    'EXPIRED',
    'RECONCILIATION_REQUIRED',
  ],
  CONFIRMED: ['CANCELLED', 'CHECKED_IN', 'COMPLETED', 'REJECTED'],
  REJECTED: [],
  CANCELLED: [],
  CHECKED_IN: ['CHECKED_OUT', 'COMPLETED'],
  CHECKED_OUT: ['COMPLETED'],
  COMPLETED: [],
  // A payment verified after expiry is re-allocated if rooms are still free, otherwise reconciled.
  EXPIRED: ['CONFIRMED', 'RECONCILIATION_REQUIRED'],
  RECONCILIATION_REQUIRED: ['CONFIRMED', 'CANCELLED'],
};

export const PAYMENT_STATUSES = [
  'INITIATED',
  'PENDING',
  'SUCCESS',
  'FAILED',
  'REFUND_PENDING',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  INITIATED: ['PENDING', 'SUCCESS', 'FAILED'],
  PENDING: ['SUCCESS', 'FAILED'],
  // A later attempt on the same order can still succeed; success is never overwritten by failure.
  FAILED: ['SUCCESS'],
  SUCCESS: ['REFUND_PENDING'],
  REFUND_PENDING: ['PARTIALLY_REFUNDED', 'REFUNDED', 'SUCCESS'],
  PARTIALLY_REFUNDED: ['REFUND_PENDING', 'REFUNDED'],
  REFUNDED: [],
};

export const REFUND_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'REJECTED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_TRANSITIONS: Record<RefundStatus, readonly RefundStatus[]> = {
  REQUESTED: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING'],
  PROCESSING: ['SUCCEEDED', 'FAILED'],
  // Failed refunds are escalated; an administrator may retry (back to APPROVED).
  FAILED: ['APPROVED'],
  SUCCEEDED: [],
  REJECTED: [],
};

export const HOLD_STATUSES = ['ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED'] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

export const HOLD_TRANSITIONS: Record<HoldStatus, readonly HoldStatus[]> = {
  ACTIVE: ['CONSUMED', 'RELEASED', 'EXPIRED'],
  CONSUMED: [],
  RELEASED: [],
  EXPIRED: [],
};

export const CANCELLATION_STATUSES = ['CONFIRMED', 'REFUND_PENDING', 'COMPLETED'] as const;
export type CancellationStatus = (typeof CANCELLATION_STATUSES)[number];

export const CANCELLATION_REASONS = [
  'CUSTOMER_REQUEST',
  'NO_SHOW',
  'PROPERTY_REJECTED',
  'INVENTORY_UNAVAILABLE',
  'PAYMENT_NOT_COMPLETED',
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const PAYMENT_PROVIDERS = ['RAZORPAY', 'SANDBOX'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_EVENT_PROCESSING_STATUSES = [
  'RECEIVED',
  'PROCESSED',
  'IGNORED',
  'FAILED',
] as const;
export type PaymentEventProcessingStatus = (typeof PAYMENT_EVENT_PROCESSING_STATUSES)[number];

export const REVIEW_STATUSES = ['PUBLISHED', 'FLAGGED', 'REMOVED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_CATEGORIES = [
  'cleanliness',
  'staff',
  'location',
  'comfort',
  'facilities',
  'value',
] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];
export const REVIEW_CATEGORY_LABELS: Record<ReviewCategory, string> = {
  cleanliness: 'Cleanliness',
  staff: 'Staff',
  location: 'Location',
  comfort: 'Comfort',
  facilities: 'Facilities',
  value: 'Value for money',
};
export const REVIEW_REPORT_REASONS = [
  'SPAM',
  'OFFENSIVE',
  'PERSONAL_INFORMATION',
  'NOT_RELEVANT',
  'OTHER',
] as const;
export type ReviewReportReason = (typeof REVIEW_REPORT_REASONS)[number];
/** Reviews can be written up to this many days after check-out. */
export const REVIEW_WINDOW_DAYS = 180;
export const REVIEW_MAX_PHOTOS = 6;

export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_CUSTOMER',
  'ESCALATED',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_CATEGORIES = [
  'BOOKING',
  'PAYMENT',
  'REFUND',
  'CANCELLATION',
  'PROPERTY',
  'ACCOUNT',
  'OTHER',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
/** CUSTOMER: visible to the customer. PARTNER: agent <-> property conversation. INTERNAL: agents only. */
export const TICKET_CHANNELS = ['CUSTOMER', 'PARTNER', 'INTERNAL'] as const;
export type TicketChannel = (typeof TICKET_CHANNELS)[number];
export const TICKET_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

export const MAX_WISHLISTS = 20;
export const MAX_WISHLIST_ITEMS = 100;

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAYMENT_PROCESSING: 'Payment in progress',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Declined by property',
  CANCELLED: 'Cancelled',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  RECONCILIATION_REQUIRED: 'Under review',
};
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  INITIATED: 'Not paid',
  PENDING: 'Pending',
  SUCCESS: 'Paid',
  FAILED: 'Failed',
  REFUND_PENDING: 'Refund in progress',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
};
export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  SUCCEEDED: 'Refunded',
  FAILED: 'Failed — being resolved',
  REJECTED: 'Not approved',
};

/** Booking statuses a customer may cancel from (before the property-local check-in time). */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly BookingStatus[] = [
  'PENDING_PAYMENT',
  'PAYMENT_PROCESSING',
  'CONFIRMED',
];
/** Statuses that make a booking eligible for a review. */
export const REVIEWABLE_BOOKING_STATUSES: readonly BookingStatus[] = ['CHECKED_OUT', 'COMPLETED'];

export function canTransition<S extends string>(
  map: Record<S, readonly S[]>,
  from: S,
  to: S,
): boolean {
  return map[from]?.includes(to) ?? false;
}

export const IDEMPOTENCY_HEADER = 'idempotency-key';
