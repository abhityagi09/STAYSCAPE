import { Schema, model, type Types } from 'mongoose';
import { AMENITY_CATEGORIES, type AmenityCategory } from '@stayscape/shared';

export interface AmenityAttrs {
  code: string;
  name: string;
  category: AmenityCategory;
  icon: string;
  description: string | null;
  active: boolean;
}
export type AmenityRecord = AmenityAttrs & { _id: Types.ObjectId };

const amenitySchema = new Schema<AmenityAttrs>(
  {
    code: { type: String, required: true, match: /^[a-z0-9-]{2,40}$/ },
    name: { type: String, required: true, maxlength: 60 },
    category: { type: String, enum: AMENITY_CATEGORIES, required: true },
    icon: { type: String, default: 'sparkles', maxlength: 40 },
    description: { type: String, default: null, maxlength: 300 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);
amenitySchema.index({ code: 1 }, { unique: true, name: 'uniq_code' });
amenitySchema.index({ active: 1, category: 1 }, { name: 'active_category' });
export const AmenityModel = model<AmenityAttrs>('Amenity', amenitySchema);

export interface DestinationAttrs {
  name: string;
  slug: string;
  city: string;
  region: string;
  country: string;
  coordinates: { type: 'Point'; coordinates: [number, number] };
  description: string;
  images: Array<{ url: string; alt: string }>;
  popularityScore: number;
  active: boolean;
}
export type DestinationRecord = DestinationAttrs & { _id: Types.ObjectId };

const destinationSchema = new Schema<DestinationAttrs>(
  {
    name: { type: String, required: true, maxlength: 80 },
    slug: { type: String, required: true, match: /^[a-z0-9-]{2,80}$/ },
    city: { type: String, required: true, maxlength: 80 },
    region: { type: String, required: true, maxlength: 80 },
    country: { type: String, required: true, length: 2 },
    coordinates: {
      type: { type: String, enum: ['Point'], required: true },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (c: number[]) =>
            c.length === 2 && Math.abs(c[0]!) <= 180 && Math.abs(c[1]!) <= 90,
          message: 'Invalid [lng, lat]',
        },
      },
    },
    description: { type: String, required: true, maxlength: 600 },
    images: { type: [{ url: String, alt: String, _id: false }], default: [] },
    popularityScore: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);
destinationSchema.index({ slug: 1 }, { unique: true, name: 'uniq_slug' });
destinationSchema.index({ active: 1, popularityScore: -1 }, { name: 'active_popularity' });
destinationSchema.index({ coordinates: '2dsphere' }, { name: 'geo' });
destinationSchema.index({ name: 1 }, { name: 'name_ci', collation: { locale: 'en', strength: 2 } });
export const DestinationModel = model<DestinationAttrs>('Destination', destinationSchema);

/** Privacy-preserving search analytics: no user id, IP, or exact dates. Expires after 180 days. */
export interface SearchEventAttrs {
  destination: string | null;
  arrivalMonth: string | null;
  nights: number | null;
  guests: number;
  rooms: number;
  filters: string[];
  sort: string;
  resultCount: number;
  createdAt: Date;
}
const searchEventSchema = new Schema<SearchEventAttrs>(
  {
    destination: { type: String, default: null, maxlength: 100 },
    arrivalMonth: { type: String, default: null },
    nights: { type: Number, default: null },
    guests: { type: Number, required: true },
    rooms: { type: Number, required: true },
    filters: { type: [String], default: [] },
    sort: { type: String, required: true },
    resultCount: { type: Number, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
searchEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 180 * 24 * 3600, name: 'ttl_created' },
);
searchEventSchema.index({ destination: 1, createdAt: -1 }, { name: 'destination_created' });
export const SearchEventModel = model<SearchEventAttrs>('SearchEvent', searchEventSchema);
