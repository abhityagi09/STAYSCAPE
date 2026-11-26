import { z } from 'zod';
import {
  ADJUSTMENT_RULE_TYPES,
  AMENITY_CATEGORIES,
  BED_TYPES,
  BUSINESS_TYPES,
  CANCELLATION_POLICY_TYPES,
  DISCOUNT_RULE_TYPES,
  FEE_CHARGE_BASES,
  MAX_ROOMS_PER_SEARCH,
  MAX_STAY_NIGHTS,
  MEAL_PLANS,
  PARTNER_DOCUMENT_TYPES,
  PARTNER_VERIFICATION_STATUSES,
  PRICING_ADJUSTMENT_TYPES,
  PRICING_RULE_TYPES,
  PROPERTY_TYPES,
  PUBLICATION_STATUSES,
  ROOM_SIZE_UNITS,
  ROOM_TYPE_STATUSES,
  SEARCH_SORTS,
  STACKING_POLICIES,
  STAFF_PERMISSIONS,
} from '../constants/marketplace';
import { diffDays, isValidLocalDate, isValidTimeZone } from '../utils/local-date';
import {
  emailSchema,
  objectIdSchema,
  paginationQuerySchema,
  personNameSchema,
  phoneSchema,
} from './common';

export const localDateSchema = z.string().refine(isValidLocalDate, 'Use a valid date (YYYY-MM-DD)');
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time, e.g. 14:00');
export const minorUnitsSchema = z
  .number()
  .int('Amounts are whole minor units')
  .min(0)
  .max(1_000_000_000);
const text = (max: number, label = 'This field') =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);
const optionalText = (max: number) => z.string().trim().max(max).optional();

/* ------------------------------------------------------------------ Partner onboarding */
export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid 10-character PAN, e.g. ABCDE1234F');
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN');
export const ifscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid 11-character IFSC');

export const addressSchema = z.object({
  line1: text(200, 'Address line 1'),
  line2: optionalText(200),
  city: text(100, 'City'),
  state: text(100, 'State'),
  postalCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 -]{3,10}$/, 'Enter a valid postal code'),
  country: z.string().trim().length(2, 'Use a 2-letter country code').toUpperCase(),
});

export const partnerBusinessSchema = z.object({
  businessName: text(150, 'Business name'),
  businessType: z.enum(BUSINESS_TYPES),
  ownerName: personNameSchema('Owner name'),
});
export const partnerContactSchema = z.object({
  businessAddress: addressSchema,
  contactDetails: z.object({
    email: emailSchema,
    phone: phoneSchema,
    website: z.url('Enter a valid URL').optional().or(z.literal('')),
  }),
});
export const partnerTaxSchema = z.object({
  registrationNumber: text(50, 'Registration number'),
  taxDetails: z.object({ pan: panSchema, gstin: gstinSchema.optional().or(z.literal('')) }),
});
export const settlementAccountInputSchema = z.object({
  accountHolderName: text(120, 'Account holder name'),
  bankName: text(120, 'Bank name'),
  ifsc: ifscSchema,
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{9,18}$/, 'Account numbers are 9–18 digits'),
});

/** Draft saves accept any subset; each section is validated fully when present. */
export const partnerDraftSchema = z.strictObject({
  business: partnerBusinessSchema.partial().optional(),
  contact: z
    .object({
      businessAddress: addressSchema.partial().optional(),
      contactDetails: partnerContactSchema.shape.contactDetails.partial().optional(),
    })
    .optional(),
  tax: z
    .object({
      registrationNumber: z.string().trim().max(50).optional(),
      taxDetails: partnerTaxSchema.shape.taxDetails.partial().optional(),
    })
    .optional(),
  settlementAccount: settlementAccountInputSchema.optional(),
});
export type PartnerDraftInput = z.input<typeof partnerDraftSchema>;

export const partnerReviewDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('APPROVE'), note: optionalText(1000) }),
  z.strictObject({ decision: z.literal('REJECT'), reason: text(1000, 'A reason') }),
  z.strictObject({ decision: z.literal('REQUEST_DOCUMENTS'), reason: text(1000, 'A reason') }),
  z.strictObject({ decision: z.literal('SUSPEND'), reason: text(1000, 'A reason') }),
]);
export type PartnerReviewDecision = z.input<typeof partnerReviewDecisionSchema>;

export const listPartnersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PARTNER_VERIFICATION_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
});
export const documentTypeSchema = z.enum(PARTNER_DOCUMENT_TYPES);

export const updateStaffSchema = z.strictObject({
  assignedProperties: z.array(objectIdSchema).max(200).default([]),
  permissions: z.array(z.enum(STAFF_PERMISSIONS)).min(1, 'Choose at least one permission'),
});

export const inviteStaffSchema = z.strictObject({
  email: emailSchema,
  assignedProperties: z.array(objectIdSchema).max(200).default([]),
  permissions: z.array(z.enum(STAFF_PERMISSIONS)).min(1, 'Choose at least one permission'),
});

/* ------------------------------------------------------------------ Hotels */
export const geoPointInputSchema = z.object({
  lat: z
    .number()
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  lng: z
    .number()
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
});

export const hotelImageRefSchema = z.object({
  mediaId: objectIdSchema,
  alt: z.string().trim().max(200).default(''),
});
export const hotelVideoSchema = z.object({
  url: z
    .url('Enter a valid URL')
    .refine(
      (u) => /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//.test(u),
      'Only YouTube or Vimeo links are supported',
    ),
  title: z.string().trim().max(120).default(''),
});

export const hotelPoliciesSchema = z.object({
  cancellationSummary: optionalText(1000),
  childPolicy: optionalText(1000),
  petPolicy: optionalText(1000),
  extraBedPolicy: optionalText(1000),
  idRequirement: optionalText(500),
  petsAllowed: z.boolean().default(false),
  smokingAllowed: z.boolean().default(false),
  coupleFriendly: z.boolean().default(true),
  minimumCheckInAge: z.number().int().min(0).max(30).default(18),
  additionalRules: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
});
export type HotelPoliciesInput = z.input<typeof hotelPoliciesSchema>;

const taxSlabSchema = z.object({
  upToMinor: minorUnitsSchema.nullable(),
  basisPoints: z.number().int().min(0).max(10_000),
});
export const taxConfigSchema = z.object({
  taxes: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .regex(/^[A-Z0-9_]{2,20}$/),
        label: text(60, 'Tax label'),
        slabs: z
          .array(taxSlabSchema)
          .min(1)
          .max(10)
          .refine(
            (slabs) => slabs[slabs.length - 1]?.upToMinor === null,
            'The last slab must have no upper limit',
          ),
      }),
    )
    .max(5),
  fees: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .regex(/^[A-Z0-9_]{2,20}$/),
        label: text(60, 'Fee label'),
        amountMinor: minorUnitsSchema,
        chargeBasis: z.enum(FEE_CHARGE_BASES),
      }),
    )
    .max(10),
});
export type TaxConfigInput = z.input<typeof taxConfigSchema>;

export const hotelContentSchema = z.object({
  name: text(120, 'Property name'),
  description: text(5000, 'Description').min(50, 'Describe the property in at least 50 characters'),
  shortDescription: text(240, 'Short description'),
  propertyType: z.enum(PROPERTY_TYPES),
  starCategory: z.number().int().min(0).max(5),
  address: z.object({ line1: text(200, 'Address line 1'), line2: optionalText(200) }),
  city: text(100, 'City'),
  state: text(100, 'State'),
  country: z.string().trim().length(2).toUpperCase(),
  postalCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9 -]{3,10}$/, 'Enter a valid postal code'),
  location: geoPointInputSchema,
  timeZone: z.string().refine(isValidTimeZone, 'Unknown time zone').default('Asia/Kolkata'),
  currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).default('INR'),
  contactDetails: z.object({
    phone: phoneSchema,
    email: emailSchema,
    website: z.url().optional().or(z.literal('')),
  }),
  amenities: z.array(z.string().trim().max(40)).max(80).default([]),
  languagesSpoken: z.array(z.string().trim().min(2).max(40)).max(15).default([]),
  images: z.array(hotelImageRefSchema).max(40).default([]),
  coverImageId: objectIdSchema.nullable().default(null),
  videos: z.array(hotelVideoSchema).max(10).default([]),
  policies: hotelPoliciesSchema.default({
    petsAllowed: false,
    smokingAllowed: false,
    coupleFriendly: true,
    minimumCheckInAge: 18,
    additionalRules: [],
  }),
  checkInTime: timeOfDaySchema.default('14:00'),
  checkOutTime: timeOfDaySchema.default('11:00'),
  instantConfirmation: z.boolean().default(true),
  nearbyAttractions: z
    .array(
      z.object({
        name: text(100, 'Attraction'),
        distanceKm: z.number().min(0).max(500),
        category: z.string().trim().max(40).default('Sight'),
      }),
    )
    .max(15)
    .default([]),
  taxConfig: taxConfigSchema.optional(),
});
export type HotelContentInput = z.input<typeof hotelContentSchema>;
/** Partial update — every present field is fully validated. */
export const hotelContentPatchSchema = hotelContentSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

export const hotelDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ decision: z.literal('START_REVIEW') }),
  z.strictObject({ decision: z.literal('APPROVE'), note: optionalText(1000) }),
  z.strictObject({ decision: z.literal('REJECT'), reason: text(1000, 'A reason') }),
  z.strictObject({ decision: z.literal('APPROVE_REVISION') }),
  z.strictObject({ decision: z.literal('REJECT_REVISION'), reason: text(1000, 'A reason') }),
  z.strictObject({ decision: z.literal('SUSPEND'), reason: text(1000, 'A reason') }),
  z.strictObject({ decision: z.literal('REINSTATE') }),
  z.strictObject({ decision: z.literal('FEATURE'), featured: z.boolean() }),
]);
export type HotelDecision = z.input<typeof hotelDecisionSchema>;
export const listAdminHotelsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(PUBLICATION_STATUSES).optional(),
  revision: z.enum(['SUBMITTED']).optional(),
  search: z.string().trim().max(100).optional(),
});

/* ------------------------------------------------------------------ Rooms, rates, rules */
export const roomTypeSchema = z
  .strictObject({
    name: text(100, 'Room name'),
    description: text(2000, 'Description'),
    images: z.array(hotelImageRefSchema).max(20).default([]),
    roomSize: z.number().positive('Room size must be positive').max(10_000),
    roomSizeUnit: z.enum(ROOM_SIZE_UNITS).default('SQM'),
    bedConfiguration: z
      .array(z.object({ type: z.enum(BED_TYPES), count: z.number().int().min(1).max(10) }))
      .min(1, 'Add at least one bed')
      .max(6),
    maximumAdults: z.number().int().min(1, 'At least one adult').max(20),
    maximumChildren: z.number().int().min(0).max(20),
    maximumOccupancy: z.number().int().min(1, 'Maximum occupancy must be positive').max(30),
    amenities: z.array(z.string().trim().max(40)).max(60).default([]),
    totalInventory: z.number().int().min(0, 'Room count cannot be negative').max(5000),
    status: z.enum(ROOM_TYPE_STATUSES).exclude(['ARCHIVED']).default('ACTIVE'),
  })
  .refine((r) => r.maximumOccupancy >= r.maximumAdults, {
    message: 'Maximum occupancy must be at least the adult limit',
    path: ['maximumOccupancy'],
  })
  .refine((r) => r.maximumOccupancy <= r.maximumAdults + r.maximumChildren, {
    message: 'Maximum occupancy cannot exceed adults + children',
    path: ['maximumOccupancy'],
  });
export type RoomTypeInput = z.input<typeof roomTypeSchema>;

export const cancellationPolicySchema = z.object({
  type: z.enum(CANCELLATION_POLICY_TYPES),
  /** Free cancellation until this many hours before check-in (property-local check-in time). */
  freeCancellationHours: z.number().int().min(0).max(720).default(48),
  /** Refund percentage after the deadline, in basis points (10000 = 100%). */
  refundBasisPointsAfterDeadline: z.number().int().min(0).max(10_000).default(0),
  /**
   * Optional fixed cancellation charge (minor units) applied instead of the percentage once the
   * free-cancellation deadline has passed (or at any time for PARTIALLY_REFUNDABLE).
   */
  fixedChargeMinor: z.number().int().min(0).max(100_000_000).nullable().default(null),
  /** Share refunded when the guest does not arrive (basis points). Usually 0. */
  noShowRefundBasisPoints: z.number().int().min(0).max(10_000).default(0),
  description: optionalText(500),
});

export const ratePlanSchema = z
  .strictObject({
    roomTypeId: objectIdSchema,
    name: text(80, 'Rate plan name'),
    mealPlan: z.enum(MEAL_PLANS),
    cancellationPolicy: cancellationPolicySchema,
    currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED']).default('INR'),
    basePriceMinor: minorUnitsSchema.refine((v) => v > 0, 'Base price must be greater than zero'),
    includedAdults: z.number().int().min(1).max(20).default(2),
    includedChildren: z.number().int().min(0).max(20).default(0),
    additionalAdultPriceMinor: minorUnitsSchema.default(0),
    additionalChildPriceMinor: minorUnitsSchema.default(0),
    extraBedPriceMinor: minorUnitsSchema.default(0),
    mealSupplementPerGuestMinor: minorUnitsSchema.default(0),
    minimumStay: z.number().int().min(1).max(MAX_STAY_NIGHTS).default(1),
    maximumStay: z.number().int().min(1).max(MAX_STAY_NIGHTS).default(MAX_STAY_NIGHTS),
    active: z.boolean().default(true),
  })
  .refine((r) => r.maximumStay >= r.minimumStay, {
    message: 'Maximum stay must be at least the minimum stay',
    path: ['maximumStay'],
  });
export type RatePlanInput = z.input<typeof ratePlanSchema>;

export const pricingRuleSchema = z
  .strictObject({
    name: text(80, 'Rule name'),
    roomTypeId: objectIdSchema.nullable().default(null),
    ratePlanId: objectIdSchema.nullable().default(null),
    ruleType: z.enum(PRICING_RULE_TYPES),
    startDate: localDateSchema.nullable().default(null),
    endDate: localDateSchema.nullable().default(null),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    adjustmentType: z.enum(PRICING_ADJUSTMENT_TYPES),
    /** PERCENT: basis points (−10000…10000, e.g. 1500 = +15%). AMOUNT: minor units (may be negative). FIXED_PRICE: minor units. */
    adjustmentValue: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    priority: z.number().int().min(0).max(1000).default(100),
    stackingPolicy: z.enum(STACKING_POLICIES).default('STACKABLE'),
    conditions: z
      .object({
        minNights: z.number().int().min(1).max(MAX_STAY_NIGHTS).optional(),
        minDaysBeforeArrival: z.number().int().min(0).max(730).optional(),
        maxDaysBeforeArrival: z.number().int().min(0).max(730).optional(),
      })
      .default({}),
    active: z.boolean().default(true),
  })
  .superRefine((r, ctx) => {
    if (r.startDate && r.endDate && r.endDate < r.startDate)
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must be on or after the start date',
      });
    const isDiscount = (DISCOUNT_RULE_TYPES as readonly string[]).includes(r.ruleType);
    if (r.ruleType === 'DATE_OVERRIDE' && r.adjustmentType !== 'FIXED_PRICE')
      ctx.addIssue({
        code: 'custom',
        path: ['adjustmentType'],
        message: 'Date overrides set a fixed nightly price',
      });
    if (r.ruleType === 'DATE_OVERRIDE' && (!r.startDate || !r.endDate))
      ctx.addIssue({
        code: 'custom',
        path: ['startDate'],
        message: 'Date overrides need a start and end date',
      });
    if (r.adjustmentType === 'FIXED_PRICE' && r.ruleType !== 'DATE_OVERRIDE')
      ctx.addIssue({
        code: 'custom',
        path: ['adjustmentType'],
        message: 'Fixed prices are only for date overrides',
      });
    if (r.adjustmentType === 'FIXED_PRICE' && r.adjustmentValue <= 0)
      ctx.addIssue({
        code: 'custom',
        path: ['adjustmentValue'],
        message: 'Price must be greater than zero',
      });
    if (r.adjustmentType === 'PERCENT' && Math.abs(r.adjustmentValue) > 10_000)
      ctx.addIssue({
        code: 'custom',
        path: ['adjustmentValue'],
        message: 'Percentages must be between −100% and +100%',
      });
    if (isDiscount && r.adjustmentValue > 0)
      ctx.addIssue({
        code: 'custom',
        path: ['adjustmentValue'],
        message: 'Discounts must be negative values',
      });
    if (r.ruleType === 'LONG_STAY' && !r.conditions.minNights)
      ctx.addIssue({
        code: 'custom',
        path: ['conditions', 'minNights'],
        message: 'Long-stay discounts need a minimum number of nights',
      });
    if (r.ruleType === 'EARLY_BIRD' && r.conditions.minDaysBeforeArrival === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['conditions', 'minDaysBeforeArrival'],
        message: 'Early-bird discounts need a booking window',
      });
    if (r.ruleType === 'LAST_MINUTE' && r.conditions.maxDaysBeforeArrival === undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['conditions', 'maxDaysBeforeArrival'],
        message: 'Last-minute discounts need a booking window',
      });
    if (
      (ADJUSTMENT_RULE_TYPES as readonly string[]).includes(r.ruleType) &&
      r.ruleType !== 'DATE_OVERRIDE' &&
      r.ruleType !== 'WEEKDAY' &&
      r.ruleType !== 'WEEKEND' &&
      (!r.startDate || !r.endDate)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['startDate'],
        message: 'Seasonal and event rates need a date range',
      });
  });
export type PricingRuleInput = z.input<typeof pricingRuleSchema>;

/* ------------------------------------------------------------------ Inventory */
export const inventoryQuerySchema = z
  .object({ roomTypeId: objectIdSchema, from: localDateSchema, to: localDateSchema })
  .refine((q) => diffDays(q.from, q.to) >= 0 && diffDays(q.from, q.to) <= 92, {
    message: 'Choose a range of up to 93 days',
    path: ['to'],
  });

export const inventoryUpdateSchema = z
  .strictObject({
    roomTypeId: objectIdSchema,
    from: localDateSchema,
    to: localDateSchema,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    set: z
      .strictObject({
        blockedRooms: z
          .number()
          .int()
          .min(0, 'Blocked rooms cannot be negative')
          .max(5000)
          .optional(),
        closedToArrival: z.boolean().optional(),
        closedToDeparture: z.boolean().optional(),
        minimumStay: z.number().int().min(1).max(MAX_STAY_NIGHTS).nullable().optional(),
        maximumStay: z.number().int().min(1).max(MAX_STAY_NIGHTS).nullable().optional(),
      })
      .refine((s) => Object.values(s).some((v) => v !== undefined), 'Choose at least one change'),
  })
  .refine((u) => diffDays(u.from, u.to) >= 0 && diffDays(u.from, u.to) <= 365, {
    message: 'Ranges can cover up to one year',
    path: ['to'],
  })
  .refine(
    (u) => !(u.set.minimumStay && u.set.maximumStay && u.set.maximumStay < u.set.minimumStay),
    { message: 'Maximum stay must be at least the minimum stay', path: ['set', 'maximumStay'] },
  );
export type InventoryUpdateInput = z.input<typeof inventoryUpdateSchema>;

/* ------------------------------------------------------------------ Search & quotes */
const stayFields = {
  checkIn: localDateSchema.optional(),
  checkOut: localDateSchema.optional(),
  adults: z.number().int().min(1).max(30).default(2),
  children: z.number().int().min(0).max(20).default(0),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(20).default([]),
  rooms: z.number().int().min(1).max(MAX_ROOMS_PER_SEARCH).default(1),
};

function refineStay(
  v: {
    checkIn?: string | undefined;
    checkOut?: string | undefined;
    children: number;
    childrenAges: number[];
    rooms: number;
    adults: number;
  },
  ctx: z.RefinementCtx,
) {
  if (Boolean(v.checkIn) !== Boolean(v.checkOut))
    ctx.addIssue({
      code: 'custom',
      path: [v.checkIn ? 'checkOut' : 'checkIn'],
      message: 'Choose both check-in and check-out',
    });
  if (v.checkIn && v.checkOut) {
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
  }
  if (v.childrenAges.length !== v.children)
    ctx.addIssue({ code: 'custom', path: ['childrenAges'], message: "Provide each child's age" });
  if (v.rooms > v.adults)
    ctx.addIssue({
      code: 'custom',
      path: ['rooms'],
      message: 'Each room needs at least one adult',
    });
}

export const searchCriteriaObject = z.object({
  q: z.string().trim().max(100).optional(),
  destination: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  region: z.string().trim().max(100).optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  ...stayFields,
  propertyTypes: z.array(z.enum(PROPERTY_TYPES)).max(PROPERTY_TYPES.length).default([]),
  minPrice: minorUnitsSchema.optional(),
  maxPrice: minorUnitsSchema.optional(),
  stars: z.array(z.number().int().min(0).max(5)).max(6).default([]),
  minRating: z.number().min(0).max(5).optional(),
  amenities: z.array(z.string().trim().max(40)).max(20).default([]),
  breakfast: z.boolean().default(false),
  parking: z.boolean().default(false),
  pool: z.boolean().default(false),
  wifi: z.boolean().default(false),
  petFriendly: z.boolean().default(false),
  accessible: z.boolean().default(false),
  freeCancellation: z.boolean().default(false),
  instantConfirmation: z.boolean().default(false),
  bbox: z
    .tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ])
    .refine(
      ([minLng, minLat, maxLng, maxLat]) => minLng < maxLng && minLat < maxLat,
      'Invalid bounding box',
    )
    .optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radiusKm: z.number().positive().max(500).default(25),
  sort: z.enum(SEARCH_SORTS).default('recommended'),
  page: z.number().int().min(1).max(500).default(1),
  limit: z.number().int().min(1).max(50).default(12),
});

function refineSearch(v: z.output<typeof searchCriteriaObject>, ctx: z.RefinementCtx) {
  refineStay(v, ctx);
  if ((v.sort === 'price_asc' || v.sort === 'price_desc') && !v.checkIn)
    ctx.addIssue({ code: 'custom', path: ['sort'], message: 'Choose dates to sort by price' });
  if ((v.minPrice !== undefined || v.maxPrice !== undefined) && !v.checkIn)
    ctx.addIssue({
      code: 'custom',
      path: ['minPrice'],
      message: 'Choose dates to filter by price',
    });
  if (v.minPrice !== undefined && v.maxPrice !== undefined && v.maxPrice < v.minPrice)
    ctx.addIssue({ code: 'custom', path: ['maxPrice'], message: 'Maximum must be above minimum' });
  if (v.sort === 'distance' && (v.lat === undefined || v.lng === undefined) && !v.bbox)
    ctx.addIssue({ code: 'custom', path: ['sort'], message: 'Distance sorting needs a location' });
  if ((v.lat === undefined) !== (v.lng === undefined))
    ctx.addIssue({ code: 'custom', path: ['lat'], message: 'Provide both latitude and longitude' });
}

/** POST /availability/search body. */
export const searchCriteriaSchema = searchCriteriaObject.superRefine(refineSearch);
export type SearchCriteria = z.output<typeof searchCriteriaSchema>;
export type SearchCriteriaInput = z.input<typeof searchCriteriaSchema>;

const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? (v === '' ? [] : v.split(',')) : v), z.array(item));
const flag = z.preprocess((v) => v === 'true' || v === '1' || v === true, z.boolean());
const num = (schema: z.ZodNumber) =>
  z.preprocess((v) => (v === '' || v === undefined ? undefined : Number(v)), schema.optional());

/** GET /hotels query string → the same criteria shape (comma-separated lists, string flags). */
export const searchQuerySchema = searchCriteriaObject
  .extend({
    adults: z.coerce.number().int().min(1).max(30).default(2),
    children: z.coerce.number().int().min(0).max(20).default(0),
    childrenAges: csv(z.coerce.number().int().min(0).max(17)).default([]),
    rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_SEARCH).default(1),
    propertyTypes: csv(z.enum(PROPERTY_TYPES)).default([]),
    stars: csv(z.coerce.number().int().min(0).max(5)).default([]),
    amenities: csv(z.string().trim().max(40)).default([]),
    minPrice: num(z.number().int().min(0)),
    maxPrice: num(z.number().int().min(0)),
    minRating: num(z.number().min(0).max(5)),
    breakfast: flag.default(false),
    parking: flag.default(false),
    pool: flag.default(false),
    wifi: flag.default(false),
    petFriendly: flag.default(false),
    accessible: flag.default(false),
    freeCancellation: flag.default(false),
    instantConfirmation: flag.default(false),
    bbox: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.split(',').map(Number) : v),
        z.tuple([
          z.number().min(-180).max(180),
          z.number().min(-90).max(90),
          z.number().min(-180).max(180),
          z.number().min(-90).max(90),
        ]),
      )
      .refine(([a, b, c, d]) => a < c && b < d, 'Invalid bounding box')
      .optional(),
    lat: num(z.number().min(-90).max(90)),
    lng: num(z.number().min(-180).max(180)),
    radiusKm: z.coerce.number().positive().max(500).default(25),
    page: z.coerce.number().int().min(1).max(500).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(12),
  })
  .superRefine((v, ctx) => refineSearch(v as SearchCriteria, ctx));

export const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(200).default(25),
  limit: z.coerce.number().int().min(1).max(20).default(8),
  excludeId: objectIdSchema.optional(),
});

export const quoteRequestSchema = z
  .strictObject({
    hotelId: objectIdSchema,
    roomTypeId: objectIdSchema,
    ratePlanId: objectIdSchema,
    checkIn: localDateSchema,
    checkOut: localDateSchema,
    adults: stayFields.adults,
    children: stayFields.children,
    childrenAges: stayFields.childrenAges,
    rooms: stayFields.rooms,
    extraBeds: z.number().int().min(0).max(10).default(0),
  })
  .superRefine(refineStay);
export type QuoteRequest = z.output<typeof quoteRequestSchema>;

export const roomOffersQuerySchema = z
  .object({
    checkIn: localDateSchema,
    checkOut: localDateSchema,
    adults: z.coerce.number().int().min(1).max(30).default(2),
    children: z.coerce.number().int().min(0).max(20).default(0),
    childrenAges: csv(z.coerce.number().int().min(0).max(17)).default([]),
    rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_SEARCH).default(1),
  })
  .superRefine(refineStay);

export const compareQuerySchema = z.object({
  ids: csv(objectIdSchema).refine(
    (ids) => ids.length >= 1 && ids.length <= 4,
    'Compare between 1 and 4 properties',
  ),
  checkIn: localDateSchema.optional(),
  checkOut: localDateSchema.optional(),
  adults: z.coerce.number().int().min(1).max(30).default(2),
  rooms: z.coerce.number().int().min(1).max(MAX_ROOMS_PER_SEARCH).default(1),
});

export const destinationSuggestionQuerySchema = z.object({ q: z.string().trim().min(1).max(60) });
export const amenitySchema = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: text(60, 'Name'),
  category: z.enum(AMENITY_CATEGORIES),
});
