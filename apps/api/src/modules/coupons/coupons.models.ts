import { Schema, model, type Types } from 'mongoose';
import type { CurrencyCode } from '@stayscape/shared';

export const COUPON_KINDS = [
  'STANDARD',
  'FIRST_BOOKING',
  'PROPERTY',
  'DESTINATION',
  'SEASONAL',
  'LIMITED_TIME',
  'REFERRAL',
  'LOYALTY',
] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

export interface CouponAttrs {
  code: string;
  name: string;
  description: string;
  kind: CouponKind;
  discountType: 'PERCENT' | 'FIXED';
  /** PERCENT: basis points of the room subtotal. FIXED: minor units. */
  value: number;
  maxDiscountMinor: number | null;
  minBookingMinor: number;
  currencies: CurrencyCode[];
  startsAt: Date;
  endsAt: Date | null;
  totalLimit: number | null;
  perUserLimit: number;
  firstBookingOnly: boolean;
  eligibleHotelIds: Types.ObjectId[];
  eligibleCities: string[];
  eligibleUserIds: Types.ObjectId[];
  /** When false, the coupon cannot be combined with rate-plan discounts (long-stay, early-bird…). */
  stackableWithRateDiscounts: boolean;
  active: boolean;
  usedCount: number;
  reservedCount: number;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}
export type CouponRecord = CouponAttrs & { _id: Types.ObjectId };

const couponSchema = new Schema<CouponAttrs>(
  {
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 32 },
    name: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    kind: { type: String, enum: COUPON_KINDS, default: 'STANDARD' },
    discountType: { type: String, enum: ['PERCENT', 'FIXED'], required: true },
    value: { type: Number, required: true, min: 1 },
    maxDiscountMinor: { type: Number, default: null },
    minBookingMinor: { type: Number, default: 0, min: 0 },
    currencies: { type: [String], default: ['INR'] },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, default: null },
    totalLimit: { type: Number, default: null, min: 1 },
    perUserLimit: { type: Number, default: 1, min: 1 },
    firstBookingOnly: { type: Boolean, default: false },
    eligibleHotelIds: { type: [Schema.Types.ObjectId], default: [] },
    eligibleCities: { type: [String], default: [] },
    eligibleUserIds: { type: [Schema.Types.ObjectId], default: [] },
    stackableWithRateDiscounts: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
    usedCount: { type: Number, default: 0, min: 0 },
    reservedCount: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);
couponSchema.index({ code: 1 }, { unique: true, name: 'uniq_code' });
couponSchema.index({ active: 1, kind: 1, startsAt: -1 }, { name: 'active_kind' });
export const CouponModel = model<CouponAttrs>('Coupon', couponSchema);

/** Per-user usage counter; the conditional upsert enforces perUserLimit atomically. */
export interface CouponUsageAttrs {
  couponId: Types.ObjectId;
  userId: Types.ObjectId;
  count: number;
}
const usageSchema = new Schema<CouponUsageAttrs>(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    count: { type: Number, required: true, min: 0 },
  },
  { versionKey: false },
);
usageSchema.index({ couponId: 1, userId: 1 }, { unique: true, name: 'uniq_coupon_user' });
export const CouponUsageModel = model<CouponUsageAttrs>('CouponUsage', usageSchema);

export interface CouponRedemptionAttrs {
  couponId: Types.ObjectId;
  code: string;
  userId: Types.ObjectId;
  holdId: Types.ObjectId;
  bookingId: Types.ObjectId | null;
  discountMinor: number;
  currency: CurrencyCode;
  status: 'RESERVED' | 'REDEEMED' | 'RELEASED';
  reservedAt: Date;
  redeemedAt: Date | null;
  releasedAt: Date | null;
}
export type CouponRedemptionRecord = CouponRedemptionAttrs & { _id: Types.ObjectId };
const redemptionSchema = new Schema<CouponRedemptionAttrs>(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    code: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    holdId: { type: Schema.Types.ObjectId, ref: 'BookingHold', required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    discountMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    status: { type: String, enum: ['RESERVED', 'REDEEMED', 'RELEASED'], required: true },
    reservedAt: { type: Date, required: true },
    redeemedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
  },
  { versionKey: false },
);
redemptionSchema.index({ holdId: 1 }, { unique: true, name: 'uniq_hold' });
redemptionSchema.index({ couponId: 1, status: 1 }, { name: 'coupon_status' });
redemptionSchema.index({ userId: 1, reservedAt: -1 }, { name: 'user_reserved' });
export const CouponRedemptionModel = model<CouponRedemptionAttrs>(
  'CouponRedemption',
  redemptionSchema,
);
