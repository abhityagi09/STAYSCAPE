import { Schema, model, type Types } from 'mongoose';
import { PROPERTY_TYPES, type PropertyType } from '@stayscape/shared';

/**
 * A browse category ("Beach resorts", "Pet-friendly stays"): an admin-curated filter over the fixed
 * property types and amenity codes. It never changes a listing's own `propertyType`.
 */
export interface PropertyCategoryAttrs {
  code: string;
  name: string;
  description: string;
  icon: string;
  propertyTypes: PropertyType[];
  amenityCodes: string[];
  sortOrder: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
export type PropertyCategoryRecord = PropertyCategoryAttrs & { _id: Types.ObjectId };
const categorySchema = new Schema<PropertyCategoryAttrs>(
  {
    code: { type: String, required: true, match: /^[a-z0-9-]{2,40}$/ },
    name: { type: String, required: true, maxlength: 60 },
    description: { type: String, default: '', maxlength: 300 },
    icon: { type: String, default: 'building', maxlength: 40 },
    propertyTypes: { type: [String], enum: PROPERTY_TYPES, default: [] },
    amenityCodes: { type: [String], default: [] },
    sortOrder: { type: Number, default: 100 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);
categorySchema.index({ code: 1 }, { unique: true, name: 'uniq_code' });
categorySchema.index({ active: 1, sortOrder: 1 }, { name: 'active_sort' });
export const PropertyCategoryModel = model<PropertyCategoryAttrs>(
  'PropertyCategory',
  categorySchema,
);

/** A booking an admin has escalated (disputes, overbooking, guest-safety issues). One open per booking. */
export interface BookingEscalationAttrs {
  bookingId: Types.ObjectId;
  bookingReference: string;
  hotelId: Types.ObjectId;
  partnerId: Types.ObjectId;
  reason: string;
  priority: 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'RESOLVED';
  openedBy: Types.ObjectId;
  resolvedBy: Types.ObjectId | null;
  resolution: string | null;
  resolvedAt: Date | null;
  /** Set while open so that only one open escalation can exist per booking. */
  openKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export type BookingEscalationRecord = BookingEscalationAttrs & { _id: Types.ObjectId };
const escalationSchema = new Schema<BookingEscalationAttrs>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    bookingReference: { type: String, required: true },
    hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    priority: { type: String, enum: ['NORMAL', 'HIGH', 'URGENT'], default: 'HIGH' },
    status: { type: String, enum: ['OPEN', 'RESOLVED'], default: 'OPEN' },
    openedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolution: { type: String, default: null, maxlength: 1000 },
    resolvedAt: { type: Date, default: null },
    openKey: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
escalationSchema.index(
  { openKey: 1 },
  { unique: true, partialFilterExpression: { openKey: { $type: 'string' } }, name: 'uniq_open' },
);
escalationSchema.index({ status: 1, priority: 1, createdAt: 1 }, { name: 'status_priority' });
escalationSchema.index({ bookingId: 1, createdAt: -1 }, { name: 'booking' });
export const BookingEscalationModel = model<BookingEscalationAttrs>(
  'BookingEscalation',
  escalationSchema,
);
