import {
  BOOKING_STATUS_LABELS,
  CUSTOMER_CANCELLABLE_STATUSES,
  REVIEWABLE_BOOKING_STATUSES,
  REVIEW_WINDOW_DAYS,
  addDays,
  todayInTimeZone,
  type BookingActionsDto,
  type BookingDetailDto,
  type BookingHotelDto,
  type BookingItemDto,
  type BookingStatus,
  type BookingSummaryDto,
  type CancellationDto,
  type HoldDto,
  type ImageDto,
  type PaymentDto,
  type RefundDto,
} from '@stayscape/shared';
import type { PaymentRecord, RefundRecord } from '@/modules/payments/payment.models';
import { checkInInstant } from './cancellation-policy';
import type {
  BookingHoldRecord,
  BookingItemSnapshot,
  BookingRecord,
  CancellationRecord,
  HotelSnapshot,
} from './booking.models';

export const CONFIRMED_FAMILY: readonly BookingStatus[] = [
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'COMPLETED',
];
const PAID_PAYMENT_STATUSES = ['SUCCESS', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'];

export function toItemDto(item: BookingItemSnapshot): BookingItemDto {
  const { nights: _nights, ...rest } = item;
  return {
    ...rest,
    roomTypeId: item.roomTypeId.toString(),
    ratePlanId: item.ratePlanId.toString(),
  };
}

export function hotelDto(
  hotelId: string,
  timeZone: string,
  snap: HotelSnapshot,
  coverImage: ImageDto | null,
): BookingHotelDto {
  return {
    id: hotelId,
    name: snap.name,
    slug: snap.slug,
    city: snap.city,
    state: snap.state,
    addressLine: [snap.addressLine, snap.city, snap.state, snap.postalCode]
      .filter(Boolean)
      .join(', '),
    timeZone,
    checkInTime: snap.checkInTime,
    checkOutTime: snap.checkOutTime,
    phone: snap.phone,
    email: snap.email,
    coverImage,
  };
}

export function toHoldDto(
  hold: BookingHoldRecord,
  bookingReference: string | null,
  coverImage: ImageDto | null,
): HoldDto {
  return {
    reference: hold.holdReference,
    status: hold.status,
    hotel: hotelDto(hold.hotelId.toString(), hold.propertyTimezone, hold.hotelSnapshot, coverImage),
    checkIn: hold.startDate,
    checkOut: hold.endDate,
    nights: hold.items[0]?.nights.length ?? 0,
    items: hold.items.map(toItemDto),
    price: hold.price,
    expiresAt: hold.expiresAt.toISOString(),
    bookingReference,
  };
}

export function holdIsLive(
  hold: Pick<BookingHoldRecord, 'status' | 'expiresAt'> | null | undefined,
  now = new Date(),
): boolean {
  return Boolean(hold && hold.status === 'ACTIVE' && hold.expiresAt > now);
}

export function toPaymentDto(
  p: PaymentRecord,
  booking: Pick<BookingRecord, 'bookingReference' | 'hotelSnapshot'>,
): PaymentDto {
  return {
    id: p._id.toString(),
    bookingReference: booking.bookingReference,
    hotelName: booking.hotelSnapshot.name,
    provider: p.provider,
    providerOrderId: p.providerOrderId,
    providerPaymentId: p.providerPaymentId,
    amountMinor: p.amountMinor,
    currency: p.currency,
    status: p.status,
    refundedMinor: p.refundedMinor,
    failureReason: p.failureReason,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toRefundDto(
  r: RefundRecord,
  booking: Pick<BookingRecord, 'bookingReference' | 'hotelSnapshot'>,
): RefundDto {
  return {
    id: r._id.toString(),
    bookingReference: booking.bookingReference,
    hotelName: booking.hotelSnapshot.name,
    amountMinor: r.amountMinor,
    currency: r.currency,
    reason: r.reason,
    status: r.status,
    providerRefundId: r.providerRefundId,
    failureReason:
      r.status === 'FAILED'
        ? 'The payment provider could not complete this refund. Our team has been notified.'
        : null,
    requestedAt: r.requestedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
  };
}

export function toCancellationDto(c: CancellationRecord): CancellationDto {
  return {
    reason: c.reason,
    note: c.note,
    requestedBy: c.requestedByRole,
    cancellationChargeMinor: c.cancellationChargeMinor,
    refundableAmountMinor: c.refundableAmountMinor,
    currency: c.currency,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Amount still refundable on a booking's successful payments (net of refunds in flight). */
export function refundableBalance(payments: PaymentRecord[], refunds: RefundRecord[]): number {
  const captured = payments
    .filter((p) => PAID_PAYMENT_STATUSES.includes(p.status))
    .reduce((s, p) => s + p.amountMinor, 0);
  const committed = refunds
    .filter((r) => r.status !== 'FAILED' && r.status !== 'REJECTED')
    .reduce((s, r) => s + r.amountMinor, 0);
  return Math.max(0, captured - committed);
}

export function computeActions(
  booking: BookingRecord,
  context: {
    hold: BookingHoldRecord | null;
    payments: PaymentRecord[];
    refunds: RefundRecord[];
    now?: Date;
  },
): BookingActionsDto {
  const now = context.now ?? new Date();
  const status = booking.bookingStatus;
  const stay = {
    checkInLocalDate: booking.checkInLocalDate,
    checkInTime: booking.hotelSnapshot.checkInTime,
    timeZone: booking.propertyTimezone,
  };
  const paid = context.payments.some((p) => PAID_PAYMENT_STATUSES.includes(p.status));
  const today = todayInTimeZone(booking.propertyTimezone, now);
  return {
    canPay:
      (status === 'PENDING_PAYMENT' || status === 'PAYMENT_PROCESSING') &&
      !paid &&
      holdIsLive(context.hold, now),
    canCancel: CUSTOMER_CANCELLABLE_STATUSES.includes(status) && now < checkInInstant(stay),
    canReview:
      REVIEWABLE_BOOKING_STATUSES.includes(status) &&
      !booking.reviewId &&
      today <= addDays(booking.checkOutLocalDate, REVIEW_WINDOW_DAYS),
    canRequestRefund:
      status === 'CANCELLED' &&
      refundableBalance(context.payments, context.refunds) > 0 &&
      !context.refunds.some((r) => r.source === 'CUSTOMER_REQUEST'),
    canDownloadConfirmation: CONFIRMED_FAMILY.includes(status),
    canDownloadInvoice: CONFIRMED_FAMILY.includes(status) && paid,
  };
}

export function roomSummary(items: BookingItemSnapshot[]): string {
  return items.map((i) => `${i.rooms} × ${i.roomTypeName} · ${i.ratePlanName}`).join(', ');
}

export function toSummaryDto(
  booking: BookingRecord,
  context: {
    hold: BookingHoldRecord | null;
    payments: PaymentRecord[];
    refunds: RefundRecord[];
    coverImage: ImageDto | null;
    now?: Date;
  },
): BookingSummaryDto {
  return {
    reference: booking.bookingReference,
    status: booking.bookingStatus,
    paymentStatus: booking.paymentStatus,
    hotel: {
      id: booking.hotelId.toString(),
      name: booking.hotelSnapshot.name,
      slug: booking.hotelSnapshot.slug,
      city: booking.hotelSnapshot.city,
      state: booking.hotelSnapshot.state,
      coverImage: context.coverImage,
    },
    checkIn: booking.checkInLocalDate,
    checkOut: booking.checkOutLocalDate,
    nights: booking.numberOfNights,
    rooms: booking.totalRooms,
    guests: booking.totalGuests,
    roomSummary: roomSummary(booking.bookingItems),
    totalMinor: booking.priceSnapshot.totals.totalMinor,
    currency: booking.priceSnapshot.currency,
    holdExpiresAt:
      context.hold && context.hold.status === 'ACTIVE'
        ? context.hold.expiresAt.toISOString()
        : null,
    createdAt: booking.createdAt.toISOString(),
    actions: computeActions(booking, context),
  };
}

export function toDetailDto(
  booking: BookingRecord,
  context: {
    hold: BookingHoldRecord | null;
    payments: PaymentRecord[];
    refunds: RefundRecord[];
    cancellation: CancellationRecord | null;
    coverImage: ImageDto | null;
    now?: Date;
  },
): BookingDetailDto {
  return {
    ...toSummaryDto(booking, context),
    hotel: hotelDto(
      booking.hotelId.toString(),
      booking.propertyTimezone,
      booking.hotelSnapshot,
      context.coverImage,
    ),
    items: booking.bookingItems.map(toItemDto),
    guestDetails: booking.guestDetails,
    price: booking.priceSnapshot,
    cancellation: context.cancellation ? toCancellationDto(context.cancellation) : null,
    payments: context.payments.map((p) => toPaymentDto(p, booking)),
    refunds: context.refunds.map((r) => toRefundDto(r, booking)),
    confirmedAt: booking.confirmedAt?.toISOString() ?? null,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    checkedInAt: booking.checkedInAt?.toISOString() ?? null,
    checkedOutAt: booking.checkedOutAt?.toISOString() ?? null,
    reviewId: booking.reviewId?.toString() ?? null,
    timeline: booking.statusHistory.map((e) => ({
      at: e.at.toISOString(),
      type: e.status,
      label: e.note ?? BOOKING_STATUS_LABELS[e.status],
    })),
  };
}
