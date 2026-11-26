import { Schema, model, type Types } from 'mongoose';
import {
  BED_TYPES,
  CANCELLATION_POLICY_TYPES,
  MEAL_PLANS,
  PRICING_ADJUSTMENT_TYPES,
  PRICING_RULE_TYPES,
  ROOM_SIZE_UNITS,
  ROOM_TYPE_STATUSES,
  STACKING_POLICIES,
  type BedType,
  type CancellationPolicyType,
  type CurrencyCode,
  type MealPlan,
  type PricingAdjustmentType,
  type PricingRuleType,
  type RoomTypeStatus,
  type StackingPolicy,
} from '@stayscape/shared';

export interface RoomTypeAttrs {
  hotelId: Types.ObjectId;
  name: string;
  description: string;
  images: Array<{ mediaId: Types.ObjectId; alt: string }>;
  roomSize: number;
  roomSizeUnit: 'SQM' | 'SQFT';
  bedConfiguration: Array<{ type: BedType; count: number }>;
  maximumAdults: number;
  maximumChildren: number;
  maximumOccupancy: number;
  amenities: string[];
  totalInventory: number;
  status: RoomTypeStatus;
  createdAt: Date;
  updatedAt: Date;
}
export type RoomTypeRecord = RoomTypeAttrs & { _id: Types.ObjectId };

const bedSchema = new Schema<{ type: BedType; count: number }>(
  {
    type: { type: String, enum: BED_TYPES, required: true },
    count: { type: Number, min: 1, required: true },
  },
  { _id: false },
);

const roomTypeSchema = new Schema<RoomTypeAttrs>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    name: { type: String, required: true, maxlength: 100 },
    description: { type: String, default: '', maxlength: 2000 },
    images: {
      type: [
        { mediaId: { type: Schema.Types.ObjectId, ref: 'MediaAsset' }, alt: String, _id: false },
      ],
      default: [],
    },
    roomSize: { type: Number, required: true, min: 1 },
    roomSizeUnit: { type: String, enum: ROOM_SIZE_UNITS, default: 'SQM' },
    bedConfiguration: { type: [bedSchema], default: [] },
    maximumAdults: { type: Number, required: true, min: 1 },
    maximumChildren: { type: Number, required: true, min: 0 },
    maximumOccupancy: { type: Number, required: true, min: 1 },
    amenities: { type: [String], default: [] },
    totalInventory: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ROOM_TYPE_STATUSES, default: 'ACTIVE' },
  },
  { timestamps: true, versionKey: false },
);
roomTypeSchema.index({ hotelId: 1, status: 1 }, { name: 'hotel_status' });
export const RoomTypeModel = model<RoomTypeAttrs>('RoomType', roomTypeSchema);

export interface CancellationPolicy {
  type: CancellationPolicyType;
  freeCancellationHours: number;
  refundBasisPointsAfterDeadline: number;
  fixedChargeMinor?: number | null;
  noShowRefundBasisPoints?: number;
  description?: string;
}

export interface RatePlanAttrs {
  hotelId: Types.ObjectId;
  roomTypeId: Types.ObjectId;
  name: string;
  mealPlan: MealPlan;
  cancellationPolicy: CancellationPolicy;
  currency: CurrencyCode;
  basePriceMinor: number;
  includedAdults: number;
  includedChildren: number;
  additionalAdultPriceMinor: number;
  additionalChildPriceMinor: number;
  extraBedPriceMinor: number;
  mealSupplementPerGuestMinor: number;
  minimumStay: number;
  maximumStay: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export type RatePlanRecord = RatePlanAttrs & { _id: Types.ObjectId };

const minor = {
  type: Number,
  required: true,
  min: 0,
  validate: { validator: Number.isInteger, message: 'Money must be integer minor units' },
};

const ratePlanSchema = new Schema<RatePlanAttrs>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    name: { type: String, required: true, maxlength: 80 },
    mealPlan: { type: String, enum: MEAL_PLANS, required: true },
    cancellationPolicy: {
      type: { type: String, enum: CANCELLATION_POLICY_TYPES, required: true },
      freeCancellationHours: { type: Number, default: 48 },
      refundBasisPointsAfterDeadline: { type: Number, default: 0 },
      fixedChargeMinor: { type: Number, default: null },
      noShowRefundBasisPoints: { type: Number, default: 0 },
      description: String,
    },
    currency: { type: String, default: 'INR' },
    basePriceMinor: minor,
    includedAdults: { type: Number, default: 2, min: 1 },
    includedChildren: { type: Number, default: 0, min: 0 },
    additionalAdultPriceMinor: { ...minor, default: 0, required: false },
    additionalChildPriceMinor: { ...minor, default: 0, required: false },
    extraBedPriceMinor: { ...minor, default: 0, required: false },
    mealSupplementPerGuestMinor: { ...minor, default: 0, required: false },
    minimumStay: { type: Number, default: 1, min: 1 },
    maximumStay: { type: Number, default: 30, min: 1 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);
ratePlanSchema.index({ hotelId: 1, roomTypeId: 1, active: 1 }, { name: 'hotel_room_active' });
export const RatePlanModel = model<RatePlanAttrs>('RatePlan', ratePlanSchema);

export interface PricingRuleAttrs {
  hotelId: Types.ObjectId;
  name: string;
  roomTypeId: Types.ObjectId | null;
  ratePlanId: Types.ObjectId | null;
  ruleType: PricingRuleType;
  startDate: string | null;
  endDate: string | null;
  daysOfWeek: number[];
  adjustmentType: PricingAdjustmentType;
  adjustmentValue: number;
  priority: number;
  stackingPolicy: StackingPolicy;
  conditions: {
    minNights?: number;
    minDaysBeforeArrival?: number;
    maxDaysBeforeArrival?: number;
    minOccupancyBp?: number;
    maxOccupancyBp?: number;
    bookFrom?: string;
    bookTo?: string;
  };
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export type PricingRuleRecord = PricingRuleAttrs & { _id: Types.ObjectId };

const pricingRuleSchema = new Schema<PricingRuleAttrs>(
  {
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    name: { type: String, required: true, maxlength: 80 },
    roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', default: null },
    ratePlanId: { type: Schema.Types.ObjectId, ref: 'RatePlan', default: null },
    ruleType: { type: String, enum: PRICING_RULE_TYPES, required: true },
    startDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    endDate: { type: String, default: null, match: /^\d{4}-\d{2}-\d{2}$/ },
    daysOfWeek: { type: [Number], default: [] },
    adjustmentType: { type: String, enum: PRICING_ADJUSTMENT_TYPES, required: true },
    adjustmentValue: {
      type: Number,
      required: true,
      validate: { validator: Number.isInteger, message: 'Must be an integer' },
    },
    priority: { type: Number, default: 100 },
    stackingPolicy: { type: String, enum: STACKING_POLICIES, default: 'STACKABLE' },
    conditions: {
      minNights: Number,
      minDaysBeforeArrival: Number,
      maxDaysBeforeArrival: Number,
      minOccupancyBp: Number,
      maxOccupancyBp: Number,
      bookFrom: String,
      bookTo: String,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);
pricingRuleSchema.index({ hotelId: 1, active: 1 }, { name: 'hotel_active' });
export const PricingRuleModel = model<PricingRuleAttrs>('PricingRule', pricingRuleSchema);
