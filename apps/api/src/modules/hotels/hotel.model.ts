import { Schema, model, type Types } from 'mongoose';
import {
  FEE_CHARGE_BASES,
  HOTEL_VERIFICATION_STATUSES,
  PROPERTY_TYPES,
  PUBLICATION_STATUSES,
  REVISION_STATUSES,
  type CurrencyCode,
  type FeeChargeBasis,
  type HotelVerificationStatus,
  type PropertyType,
  type PublicationStatus,
  type RevisionStatus,
} from '@stayscape/shared';

export interface TaxConfig {
  taxes: Array<{
    code: string;
    label: string;
    slabs: Array<{ upToMinor: number | null; basisPoints: number }>;
  }>;
  fees: Array<{ code: string; label: string; amountMinor: number; chargeBasis: FeeChargeBasis }>;
}

export interface HotelPolicies {
  cancellationSummary?: string;
  childPolicy?: string;
  petPolicy?: string;
  extraBedPolicy?: string;
  idRequirement?: string;
  petsAllowed: boolean;
  smokingAllowed: boolean;
  coupleFriendly: boolean;
  minimumCheckInAge: number;
  additionalRules: string[];
}

/** Fields partners edit. On a listing that has ever been approved, changes go to `revision` first. */
export interface HotelContent {
  name: string;
  description: string;
  shortDescription: string;
  propertyType: PropertyType;
  starCategory: number;
  address: { line1: string; line2?: string };
  city: string;
  state: string;
  country: string;
  postalCode: string;
  /** GeoJSON Point — coordinates are [longitude, latitude]. */
  location: { type: 'Point'; coordinates: [number, number] } | null;
  timeZone: string;
  currency: CurrencyCode;
  contactDetails: { phone: string; email: string; website?: string };
  amenities: string[];
  languagesSpoken: string[];
  images: Array<{ mediaId: Types.ObjectId; alt: string }>;
  coverImageId: Types.ObjectId | null;
  videos: Array<{ url: string; title: string }>;
  policies: HotelPolicies;
  checkInTime: string;
  checkOutTime: string;
  instantConfirmation: boolean;
  nearbyAttractions: Array<{ name: string; distanceKm: number; category: string }>;
  taxConfig: TaxConfig;
}

export const CONTENT_FIELDS = [
  'name',
  'description',
  'shortDescription',
  'propertyType',
  'starCategory',
  'address',
  'city',
  'state',
  'country',
  'postalCode',
  'location',
  'timeZone',
  'currency',
  'contactDetails',
  'amenities',
  'languagesSpoken',
  'images',
  'coverImageId',
  'videos',
  'policies',
  'checkInTime',
  'checkOutTime',
  'instantConfirmation',
  'nearbyAttractions',
  'taxConfig',
] as const satisfies ReadonlyArray<keyof HotelContent>;

export interface HotelAttrs extends HotelContent {
  partnerId: Types.ObjectId;
  slug: string;
  verificationStatus: HotelVerificationStatus;
  /** Accessibility features with provenance (see modules/hotels/accessibility.service). */
  accessibilityFeatures: Array<{
    code: string;
    note: string;
    source: 'PARTNER_DECLARED' | 'ADMIN_VERIFIED';
    declaredAt: Date;
    verifiedAt: Date | null;
    verifiedBy: Types.ObjectId | null;
    evidence: string | null;
  }>;
  publicationStatus: PublicationStatus;
  featuredStatus: 'NONE' | 'FEATURED';
  ratingSummary: { average: number; count: number; source: 'REVIEWS' | 'DEVELOPMENT_SEED' };
  popularityScore: number;
  everApproved: boolean;
  review: {
    submittedAt: Date | null;
    reviewedBy: Types.ObjectId | null;
    reviewedAt: Date | null;
    rejectionReason: string | null;
    suspensionReason: string | null;
  };
  revision: {
    status: RevisionStatus;
    data: Partial<HotelContent> | null;
    submittedAt: Date | null;
    rejectionReason: string | null;
  };
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
export type HotelRecord = HotelAttrs & { _id: Types.ObjectId };

/** India GST on accommodation (from 22 Sep 2025): 5% up to ₹7,500 per room-night, 18% above. Editable per property. */
export const DEFAULT_TAX_CONFIG: TaxConfig = {
  taxes: [
    {
      code: 'GST',
      label: 'GST',
      slabs: [
        { upToMinor: 750_000, basisPoints: 500 },
        { upToMinor: null, basisPoints: 1800 },
      ],
    },
  ],
  fees: [],
};

const pointSchema = new Schema<{ type: 'Point'; coordinates: [number, number] }>(
  {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (c: number[]) =>
          c.length === 2 && c[0]! >= -180 && c[0]! <= 180 && c[1]! >= -90 && c[1]! <= 90,
        message: 'Coordinates must be [longitude, latitude] within valid ranges',
      },
    },
  },
  { _id: false },
);

export const DEFAULT_POLICIES: HotelPolicies = {
  petsAllowed: false,
  smokingAllowed: false,
  coupleFriendly: true,
  minimumCheckInAge: 18,
  additionalRules: [],
};

const hotelSchema = new Schema<HotelAttrs>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true },
    name: { type: String, required: true, maxlength: 120, trim: true },
    slug: { type: String, required: true, match: /^[a-z0-9-]{3,140}$/ },
    description: { type: String, default: '', maxlength: 5000 },
    shortDescription: { type: String, default: '', maxlength: 240 },
    propertyType: { type: String, enum: PROPERTY_TYPES, required: true },
    starCategory: { type: Number, min: 0, max: 5, default: 0 },
    address: { line1: { type: String, default: '' }, line2: String },
    city: { type: String, required: true, maxlength: 100 },
    state: { type: String, default: '', maxlength: 100 },
    country: { type: String, default: 'IN', length: 2 },
    postalCode: { type: String, default: '' },
    location: { type: pointSchema, default: null },
    timeZone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    contactDetails: { phone: String, email: String, website: String },
    amenities: { type: [String], default: [] },
    languagesSpoken: { type: [String], default: [] },
    images: {
      type: [
        {
          mediaId: { type: Schema.Types.ObjectId, ref: 'MediaAsset', required: true },
          alt: { type: String, default: '' },
          _id: false,
        },
      ],
      default: [],
    },
    coverImageId: { type: Schema.Types.ObjectId, ref: 'MediaAsset', default: null },
    videos: { type: [{ url: String, title: String, _id: false }], default: [] },
    policies: {
      cancellationSummary: String,
      childPolicy: String,
      petPolicy: String,
      extraBedPolicy: String,
      idRequirement: String,
      petsAllowed: { type: Boolean, default: false },
      smokingAllowed: { type: Boolean, default: false },
      coupleFriendly: { type: Boolean, default: true },
      minimumCheckInAge: { type: Number, default: 18 },
      additionalRules: { type: [String], default: [] },
    },
    checkInTime: { type: String, default: '14:00' },
    checkOutTime: { type: String, default: '11:00' },
    instantConfirmation: { type: Boolean, default: true },
    nearbyAttractions: {
      type: [{ name: String, distanceKm: Number, category: String, _id: false }],
      default: [],
    },
    taxConfig: {
      taxes: {
        type: [
          {
            code: String,
            label: String,
            slabs: [
              { upToMinor: { type: Number, default: null }, basisPoints: Number, _id: false },
            ],
            _id: false,
          },
        ],
        default: () => DEFAULT_TAX_CONFIG.taxes,
      },
      fees: {
        type: [
          {
            code: String,
            label: String,
            amountMinor: Number,
            chargeBasis: { type: String, enum: FEE_CHARGE_BASES },
            _id: false,
          },
        ],
        default: [],
      },
    },
    verificationStatus: { type: String, enum: HOTEL_VERIFICATION_STATUSES, default: 'PENDING' },
    accessibilityFeatures: { type: Schema.Types.Mixed, default: [] },
    publicationStatus: { type: String, enum: PUBLICATION_STATUSES, default: 'DRAFT' },
    featuredStatus: { type: String, enum: ['NONE', 'FEATURED'], default: 'NONE' },
    ratingSummary: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0, min: 0 },
      source: { type: String, enum: ['REVIEWS', 'DEVELOPMENT_SEED'], default: 'REVIEWS' },
    },
    popularityScore: { type: Number, default: 0, min: 0 },
    everApproved: { type: Boolean, default: false },
    review: {
      submittedAt: { type: Date, default: null },
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
      reviewedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: null },
      suspensionReason: { type: String, default: null },
    },
    revision: {
      status: { type: String, enum: REVISION_STATUSES, default: 'NONE' },
      data: { type: Schema.Types.Mixed, default: null },
      submittedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: null },
    },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, minimize: false },
);

hotelSchema.index({ 'accessibilityFeatures.code': 1, publicationStatus: 1 }, { name: 'accessibility' });
hotelSchema.index({ slug: 1 }, { unique: true, name: 'uniq_slug' });
hotelSchema.index({ location: '2dsphere' }, { name: 'geo' });
hotelSchema.index({ partnerId: 1, publicationStatus: 1 }, { name: 'partner_status' });
hotelSchema.index(
  { publicationStatus: 1, city: 1 },
  { name: 'status_city', collation: { locale: 'en', strength: 2 } },
);
hotelSchema.index(
  { publicationStatus: 1, featuredStatus: 1, popularityScore: -1 },
  { name: 'status_featured' },
);
hotelSchema.index({ publicationStatus: 1, 'ratingSummary.average': -1 }, { name: 'status_rating' });
hotelSchema.index(
  { publicationStatus: 1, propertyType: 1, starCategory: 1 },
  { name: 'status_type_stars' },
);
hotelSchema.index({ 'revision.status': 1, updatedAt: 1 }, { name: 'revision_status' });
hotelSchema.index(
  { name: 'text', city: 'text', state: 'text', shortDescription: 'text' },
  {
    name: 'text_search',
    weights: { name: 10, city: 6, state: 3, shortDescription: 1 },
    default_language: 'english',
  },
);

export const HotelModel = model<HotelAttrs>('Hotel', hotelSchema);
