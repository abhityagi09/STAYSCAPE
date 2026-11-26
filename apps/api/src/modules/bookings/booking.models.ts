import { Schema, model, type Types } from 'mongoose';
import type { CommissionSnapshot } from '@/modules/finance/finance.service';
import {
  BOOKING_STATUSES,
  CANCELLATION_REASONS,
  CANCELLATION_STATUSES,
  HOLD_STATUSES,
  PAYMENT_STATUSES,
  type BookingItemDto,
  type BookingStatus,
  type CancellationPolicySnapshotDto,
  type CancellationReason,
  type CancellationStatus,
  type CurrencyCode,
  type GuestDetailsDto,
  type HoldStatus,
  type PaymentStatus,
  type PriceSnapshotDto,
} from '@stayscape/shared';

/** Snapshot of one booked line. Ids are kept as ObjectIds for inventory operations. */
export interface BookingItemSnapshot extends Omit<BookingItemDto, 'roomTypeId' | 'ratePlanId'> {
  roomTypeId: Types.ObjectId;
  ratePlanId: Types.ObjectId;
  /** Property-local nights reserved (check-in … day before check-out). */
  nights: string[];
}

export interface HotelSnapshot {
  name: string;
  slug: string;
  city: string;
  state: string;
  addressLine: string;
  postalCode: string;
  country: string;
  phone: string | null;
  email: string | null;
  checkInTime: string;
  checkOutTime: string;
}

// ------------------------------------------------------------------ InventoryHold
export interface BookingHoldAttrs {
  holdReference: string;
  customerId: Types.ObjectId;
  hotelId: Types.ObjectId;
  bookingId: Types.ObjectId | null;
  items: BookingItemSnapshot[];
  startDate: string;
  endDate: string;
  propertyTimezone: string;
  price: PriceSnapshotDto;
  hotelSnapshot: HotelSnapshot;
  expiresAt: Date;
  status: HoldStatus;
  idempotencyKey: string;
  requestHash: string;
  consumedAt: Date | null;
  releasedAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type BookingHoldRecord = BookingHoldAttrs & { _id: Types.ObjectId };

const holdSchema = new Schema<BookingHoldAttrs>(
  {
    holdReference: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    items: { type: Schema.Types.Mixed, required: true },
    startDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    propertyTimezone: { type: String, required: true },
    price: { type: Schema.Types.Mixed, required: true },
    hotelSnapshot: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: HOLD_STATUSES, default: 'ACTIVE' },
    idempotencyKey: { type: String, required: true, maxlength: 128 },
    requestHash: { type: String, required: true },
    consumedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
holdSchema.index({ holdReference: 1 }, { unique: true, name: 'uniq_reference' });
holdSchema.index(
  { customerId: 1, idempotencyKey: 1 },
  { unique: true, name: 'uniq_customer_idempotency' },
);
// The expiry worker scans this; TTL deletion is deliberately NOT used (it would not release inventory).
holdSchema.index({ status: 1, expiresAt: 1 }, { name: 'status_expiry' });
holdSchema.index({ customerId: 1, createdAt: -1 }, { name: 'customer_created' });
export const BookingHoldModel = model<BookingHoldAttrs>('BookingHold', holdSchema);

// ------------------------------------------------------------------ Booking
export interface StatusEvent {
  status: BookingStatus;
  at: Date;
  note: string | null;
}

export interface BookingAttrs {
  bookingReference: string;
  customerId: Types.ObjectId;
  hotelId: Types.ObjectId;
  partnerId: Types.ObjectId;
  bookingItems: BookingItemSnapshot[];
  guestDetails: GuestDetailsDto;
  checkInLocalDate: string;
  checkOutLocalDate: string;
  propertyTimezone: string;
  numberOfNights: number;
  totalRooms: number;
  totalGuests: number;
  priceSnapshot: PriceSnapshotDto;
  cancellationPolicySnapshot: CancellationPolicySnapshotDto[];
  hotelSnapshot: HotelSnapshot;
  bookingStatus: BookingStatus;
  paymentStatus: PaymentStatus;
  holdId: Types.ObjectId;
  idempotencyKey: string;
  requestHash: string;
  statusHistory: StatusEvent[];
  reconciliationNote: string | null;
  reviewId: Types.ObjectId | null;
  /** Physical room numbers assigned by the property, per booked room category. */
  roomAssignments: Array<{ roomTypeId: Types.ObjectId; roomNumbers: string[] }>;
  /** Commission fixed when payment confirmed the booking (see finance/commission.ts). */
  commissionSnapshot: CommissionSnapshot | null;
  checkedInBy: Types.ObjectId | null;
  checkedOutBy: Types.ObjectId | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  completedAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type BookingRecord = BookingAttrs & { _id: Types.ObjectId };

const bookingSchema = new Schema<BookingAttrs>(
  {
    bookingReference: { type: String, required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
    bookingItems: { type: Schema.Types.Mixed, required: true },
    guestDetails: { type: Schema.Types.Mixed, required: true },
    checkInLocalDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    checkOutLocalDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    propertyTimezone: { type: String, required: true },
    numberOfNights: { type: Number, required: true, min: 1 },
    totalRooms: { type: Number, required: true, min: 1 },
    totalGuests: { type: Number, required: true, min: 1 },
    priceSnapshot: { type: Schema.Types.Mixed, required: true },
    cancellationPolicySnapshot: { type: Schema.Types.Mixed, required: true },
    hotelSnapshot: { type: Schema.Types.Mixed, required: true },
    bookingStatus: { type: String, enum: BOOKING_STATUSES, required: true },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, required: true },
    holdId: { type: Schema.Types.ObjectId, ref: 'BookingHold', required: true },
    idempotencyKey: { type: String, required: true, maxlength: 128 },
    requestHash: { type: String, required: true },
    statusHistory: {
      type: [
        new Schema<StatusEvent>(
          {
            status: { type: String, enum: BOOKING_STATUSES, required: true },
            at: { type: Date, required: true },
            note: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    reconciliationNote: { type: String, default: null },
    reviewId: { type: Schema.Types.ObjectId, ref: 'Review', default: null },
    roomAssignments: { type: Schema.Types.Mixed, default: [] },
    commissionSnapshot: { type: Schema.Types.Mixed, default: null },
    checkedInBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    checkedOutBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    checkedInAt: { type: Date, default: null },
    checkedOutAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
bookingSchema.index({ bookingReference: 1 }, { unique: true, name: 'uniq_reference' });
// One booking per hold: a repeated or concurrent create can never produce two bookings.
bookingSchema.index({ holdId: 1 }, { unique: true, name: 'uniq_hold' });
bookingSchema.index(
  { customerId: 1, idempotencyKey: 1 },
  { unique: true, name: 'uniq_customer_idempotency' },
);
bookingSchema.index({ customerId: 1, createdAt: -1 }, { name: 'customer_created' });
bookingSchema.index(
  { customerId: 1, bookingStatus: 1, checkInLocalDate: 1 },
  { name: 'customer_status_checkin' },
);
bookingSchema.index({ hotelId: 1, checkInLocalDate: 1 }, { name: 'hotel_checkin' });
bookingSchema.index({ bookingStatus: 1, checkOutLocalDate: 1 }, { name: 'status_checkout' });
bookingSchema.index({ bookingStatus: 1, checkInLocalDate: 1 }, { name: 'status_checkin' });
export const BookingModel = model<BookingAttrs>('Booking', bookingSchema);

// ------------------------------------------------------------------ Cancellation
export interface CancellationAttrs {
  bookingId: Types.ObjectId;
  requestedBy: Types.ObjectId | null;
  requestedByRole: 'CUSTOMER' | 'PROPERTY' | 'SYSTEM' | 'ADMIN';
  reason: CancellationReason;
  note: string;
  policySnapshot: CancellationPolicySnapshotDto[];
  paidMinor: number;
  cancellationChargeMinor: number;
  refundableAmountMinor: number;
  currency: CurrencyCode;
  refundId: Types.ObjectId | null;
  status: CancellationStatus;
  createdAt: Date;
  updatedAt: Date;
}
export type CancellationRecord = CancellationAttrs & { _id: Types.ObjectId };

const cancellationSchema = new Schema<CancellationAttrs>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    requestedByRole: {
      type: String,
      enum: ['CUSTOMER', 'PROPERTY', 'SYSTEM', 'ADMIN'],
      required: true,
    },
    reason: { type: String, enum: CANCELLATION_REASONS, required: true },
    note: { type: String, default: '', maxlength: 1000 },
    policySnapshot: { type: Schema.Types.Mixed, default: [] },
    paidMinor: { type: Number, required: true, min: 0 },
    cancellationChargeMinor: { type: Number, required: true, min: 0 },
    refundableAmountMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    refundId: { type: Schema.Types.ObjectId, ref: 'Refund', default: null },
    status: { type: String, enum: CANCELLATION_STATUSES, required: true },
  },
  { timestamps: true, versionKey: false },
);
// A booking is cancelled at most once — duplicate requests hit this index.
cancellationSchema.index({ bookingId: 1 }, { unique: true, name: 'uniq_booking' });
export const CancellationModel = model<CancellationAttrs>('Cancellation', cancellationSchema);
