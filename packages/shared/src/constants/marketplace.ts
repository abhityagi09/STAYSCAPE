export const PARTNER_VERIFICATION_STATUSES = [
  'REGISTERED',
  'DOCUMENTS_PENDING',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type PartnerVerificationStatus = (typeof PARTNER_VERIFICATION_STATUSES)[number];
/** States in which the owner may edit and (re)submit the application. */
export const PARTNER_EDITABLE_STATUSES: readonly PartnerVerificationStatus[] = [
  'REGISTERED',
  'DOCUMENTS_PENDING',
  'REJECTED',
];

export const BUSINESS_TYPES = [
  'SOLE_PROPRIETORSHIP',
  'PARTNERSHIP',
  'LLP',
  'PRIVATE_LIMITED',
  'PUBLIC_LIMITED',
  'TRUST',
  'OTHER',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  SOLE_PROPRIETORSHIP: 'Sole proprietorship',
  PARTNERSHIP: 'Partnership firm',
  LLP: 'Limited liability partnership',
  PRIVATE_LIMITED: 'Private limited company',
  PUBLIC_LIMITED: 'Public limited company',
  TRUST: 'Trust / society',
  OTHER: 'Other',
};

export const PARTNER_DOCUMENT_TYPES = [
  'BUSINESS_REGISTRATION',
  'TAX_REGISTRATION',
  'IDENTITY_PROOF',
  'PROPERTY_OWNERSHIP',
  'BANK_PROOF',
] as const;
export type PartnerDocumentType = (typeof PARTNER_DOCUMENT_TYPES)[number];
export const REQUIRED_PARTNER_DOCUMENTS: readonly PartnerDocumentType[] = [
  'BUSINESS_REGISTRATION',
  'IDENTITY_PROOF',
  'BANK_PROOF',
];
export const PARTNER_DOCUMENT_LABELS: Record<PartnerDocumentType, string> = {
  BUSINESS_REGISTRATION: 'Business registration certificate',
  TAX_REGISTRATION: 'GST / tax registration certificate',
  IDENTITY_PROOF: 'Identity proof of authorised signatory',
  PROPERTY_OWNERSHIP: 'Property ownership or management agreement',
  BANK_PROOF: 'Cancelled cheque or bank letter',
};
export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Property-level staff permissions (Phase 4). Every partner API checks the specific permission for
 * the specific property; owners hold all of them for their own properties.
 */
export const STAFF_PERMISSIONS = [
  'property:edit',
  'rooms:manage',
  'inventory:view',
  'inventory:manage',
  'pricing:manage',
  'bookings:view',
  'bookings:check-in',
  'bookings:check-out',
  'bookings:no-show',
  'bookings:notes',
  'reviews:respond',
  'analytics:view',
  'financials:view',
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
export const STAFF_PERMISSION_LABELS: Record<StaffPermission, string> = {
  'property:edit': 'Edit property content and photos',
  'rooms:manage': 'Manage room categories',
  'inventory:view': 'View inventory calendar',
  'inventory:manage': 'Change inventory, closures and restrictions',
  'pricing:manage': 'Manage rate plans and pricing rules',
  'bookings:view': 'View reservations and guest details',
  'bookings:check-in': 'Record check-in',
  'bookings:check-out': 'Record check-out',
  'bookings:no-show': 'Record no-shows and decline bookings',
  'bookings:notes': 'Add internal reservation notes',
  'reviews:respond': 'Respond to guest reviews',
  'analytics:view': 'View analytics and KPIs',
  'financials:view': 'View revenue, commissions and settlements',
};
/** Phase 2–3 permission codes, still accepted on stored staff records. */
export const LEGACY_STAFF_PERMISSIONS: Record<string, readonly StaffPermission[]> = {
  CONTENT_EDIT: ['property:edit'],
  ROOMS_MANAGE: ['rooms:manage'],
  INVENTORY_MANAGE: ['inventory:view', 'inventory:manage'],
  RATES_MANAGE: ['pricing:manage'],
  BOOKINGS_MANAGE: [
    'bookings:view',
    'bookings:check-in',
    'bookings:check-out',
    'bookings:no-show',
    'bookings:notes',
    'reviews:respond',
  ],
};
/** Expand legacy codes and drop unknown values. */
export function normalizeStaffPermissions(values: readonly string[]): StaffPermission[] {
  const out = new Set<StaffPermission>();
  for (const v of values) {
    if ((STAFF_PERMISSIONS as readonly string[]).includes(v)) out.add(v as StaffPermission);
    for (const mapped of LEGACY_STAFF_PERMISSIONS[v] ?? []) out.add(mapped);
  }
  return [...out];
}
export const STAFF_INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'SUSPENDED', 'REVOKED'] as const;
export type StaffInvitationStatus = (typeof STAFF_INVITATION_STATUSES)[number];

export const PROPERTY_TYPES = [
  'HOTEL',
  'RESORT',
  'VILLA',
  'BOUTIQUE',
  'HOMESTAY',
  'APARTMENT',
  'HOSTEL',
  'GUESTHOUSE',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];
export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  HOTEL: 'Hotel',
  RESORT: 'Resort',
  VILLA: 'Villa',
  BOUTIQUE: 'Boutique',
  HOMESTAY: 'Homestay',
  APARTMENT: 'Serviced apartment',
  HOSTEL: 'Hostel',
  GUESTHOUSE: 'Guesthouse',
};

export const PUBLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'SUSPENDED',
  'ARCHIVED',
] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
export const HOTEL_VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type HotelVerificationStatus = (typeof HOTEL_VERIFICATION_STATUSES)[number];
export const REVISION_STATUSES = ['NONE', 'DRAFT', 'SUBMITTED', 'REJECTED'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const ROOM_TYPE_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type RoomTypeStatus = (typeof ROOM_TYPE_STATUSES)[number];
export const BED_TYPES = ['SINGLE', 'TWIN', 'DOUBLE', 'QUEEN', 'KING', 'SOFA_BED', 'BUNK'] as const;
export type BedType = (typeof BED_TYPES)[number];
export const ROOM_SIZE_UNITS = ['SQM', 'SQFT'] as const;

export const MEAL_PLANS = [
  'ROOM_ONLY',
  'BREAKFAST',
  'HALF_BOARD',
  'FULL_BOARD',
  'ALL_INCLUSIVE',
] as const;
export type MealPlan = (typeof MEAL_PLANS)[number];
export const MEAL_PLAN_LABELS: Record<MealPlan, string> = {
  ROOM_ONLY: 'Room only',
  BREAKFAST: 'Breakfast included',
  HALF_BOARD: 'Half board',
  FULL_BOARD: 'Full board',
  ALL_INCLUSIVE: 'All inclusive',
};

export const CANCELLATION_POLICY_TYPES = [
  'FREE_CANCELLATION',
  'PARTIALLY_REFUNDABLE',
  'NON_REFUNDABLE',
] as const;
export type CancellationPolicyType = (typeof CANCELLATION_POLICY_TYPES)[number];

/** Date-level adjustments (steps 2–3) and stay-level discounts (step 5) of the pricing engine. */
export const ADJUSTMENT_RULE_TYPES = [
  'DATE_OVERRIDE',
  'WEEKDAY',
  'WEEKEND',
  'SEASONAL',
  'EVENT',
  /** Applies on nights whose occupancy (committed / sellable rooms) is inside a range. */
  'OCCUPANCY',
] as const;
/** PROMOTIONAL: a discount bookable only inside a booking window (conditions.bookFrom/bookTo). */
export const DISCOUNT_RULE_TYPES = [
  'LONG_STAY',
  'EARLY_BIRD',
  'LAST_MINUTE',
  'PROMOTIONAL',
] as const;
export const PRICING_RULE_TYPES = [...ADJUSTMENT_RULE_TYPES, ...DISCOUNT_RULE_TYPES] as const;
export type PricingRuleType = (typeof PRICING_RULE_TYPES)[number];
export const PRICING_ADJUSTMENT_TYPES = ['PERCENT', 'AMOUNT', 'FIXED_PRICE'] as const;
export type PricingAdjustmentType = (typeof PRICING_ADJUSTMENT_TYPES)[number];
export const STACKING_POLICIES = ['STACKABLE', 'EXCLUSIVE'] as const;
export type StackingPolicy = (typeof STACKING_POLICIES)[number];

export const FEE_CHARGE_BASES = ['PER_STAY', 'PER_NIGHT', 'PER_ROOM_NIGHT'] as const;
export type FeeChargeBasis = (typeof FEE_CHARGE_BASES)[number];

export const AMENITY_CATEGORIES = [
  'GENERAL',
  'ROOM',
  'BATHROOM',
  'FOOD',
  'WELLNESS',
  'ACTIVITIES',
  'ACCESSIBILITY',
  'SERVICES',
  'FAMILY',
] as const;
export type AmenityCategory = (typeof AMENITY_CATEGORIES)[number];

/** Amenity codes the search filters map to. */
export const FILTER_AMENITIES = {
  parking: 'parking',
  pool: 'pool',
  wifi: 'wifi',
  petFriendly: 'pet-friendly',
  accessible: 'wheelchair-accessible',
  breakfast: 'breakfast',
} as const;

export const SEARCH_SORTS = [
  'recommended',
  'price_asc',
  'price_desc',
  'rating_desc',
  'reviews_desc',
  'distance',
  'popularity',
] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];
export const SEARCH_SORT_LABELS: Record<SearchSort, string> = {
  recommended: 'Recommended',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  rating_desc: 'Guest rating',
  reviews_desc: 'Most reviewed',
  distance: 'Distance',
  popularity: 'Popularity',
};

/** Guests of this age or older are treated as adults for occupancy and pricing. */
export const CHILD_AGE_ADULT_THRESHOLD = 13;
export const MAX_STAY_NIGHTS = 30;
export const MAX_ROOMS_PER_SEARCH = 8;
export const MAX_COMPARE_HOTELS = 4;
export const MEDIA_PURPOSES = [
  'HOTEL_IMAGE',
  'ROOM_IMAGE',
  'PARTNER_DOCUMENT',
  'REVIEW_IMAGE',
  'SUPPORT_ATTACHMENT',
  'BOOKING_DOCUMENT',
  'SETTLEMENT_EVIDENCE',
  'CONTENT_IMAGE',
] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

/** Property accessibility features. Each listing records who stated it (partner) and who checked it (admin). */
export const ACCESSIBILITY_FEATURES = [
  'STEP_FREE_ENTRANCE',
  'ELEVATOR',
  'ACCESSIBLE_PARKING',
  'WIDE_DOORWAYS',
  'ACCESSIBLE_BATHROOM',
  'ROLL_IN_SHOWER',
  'GRAB_BARS',
  'LOWERED_BED',
  'VISUAL_ALARMS',
  'HEARING_LOOP',
  'BRAILLE_SIGNAGE',
  'SERVICE_ANIMALS_WELCOME',
] as const;
export type AccessibilityFeature = (typeof ACCESSIBILITY_FEATURES)[number];
export const ACCESSIBILITY_FEATURE_LABELS: Record<AccessibilityFeature, string> = {
  STEP_FREE_ENTRANCE: 'Step-free entrance',
  ELEVATOR: 'Elevator to all guest floors',
  ACCESSIBLE_PARKING: 'Accessible parking',
  WIDE_DOORWAYS: 'Doorways at least 81 cm wide',
  ACCESSIBLE_BATHROOM: 'Accessible bathroom',
  ROLL_IN_SHOWER: 'Roll-in shower',
  GRAB_BARS: 'Grab bars by toilet and shower',
  LOWERED_BED: 'Bed height suitable for transfers',
  VISUAL_ALARMS: 'Visual fire alarms',
  HEARING_LOOP: 'Hearing loop at reception',
  BRAILLE_SIGNAGE: 'Braille or tactile signage',
  SERVICE_ANIMALS_WELCOME: 'Service animals welcome',
};
export const ACCESSIBILITY_SOURCES = ['PARTNER_DECLARED', 'ADMIN_VERIFIED'] as const;
export type AccessibilitySource = (typeof ACCESSIBILITY_SOURCES)[number];
