import type { CurrencyCode } from '../constants/account';
import type {
  AccessibilityFeature,
  AccessibilitySource,
  AmenityCategory,
  BedType,
  BusinessType,
  CancellationPolicyType,
  FeeChargeBasis,
  HotelVerificationStatus,
  MealPlan,
  PartnerDocumentType,
  PartnerVerificationStatus,
  PricingAdjustmentType,
  PricingRuleType,
  PropertyType,
  PublicationStatus,
  RevisionStatus,
  RoomTypeStatus,
  StackingPolicy,
  StaffInvitationStatus,
  StaffPermission,
} from '../constants/marketplace';

export interface ImageDto {
  id: string;
  alt: string;
  width: number;
  height: number;
  dominantColor: string | null;
  /** Responsive WebP variants keyed by max width plus an AVIF medium. */
  variants: { sm: string; md: string; lg: string; avif: string | null };
}

export interface AddressDto {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface PartnerDocumentDto {
  id: string;
  type: PartnerDocumentType;
  fileName: string;
  contentType: string;
  size: number;
  uploadedAt: string;
}

export interface PartnerApplicationDto {
  id: string;
  ownerId: string;
  verificationStatus: PartnerVerificationStatus;
  business: { businessName?: string; businessType?: BusinessType; ownerName?: string };
  contact: {
    businessAddress?: Partial<AddressDto>;
    contactDetails?: { email?: string; phone?: string; website?: string };
  };
  tax: { registrationNumber?: string; taxDetails?: { pan?: string; gstin?: string } };
  settlementAccount: {
    reference: string;
    accountHolderName: string;
    bankName: string;
    ifsc: string;
    accountNumberLast4: string;
  } | null;
  documents: PartnerDocumentDto[];
  missingRequirements: string[];
  rejectionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPartnerSummaryDto {
  id: string;
  businessName: string | null;
  ownerEmail: string;
  ownerName: string;
  verificationStatus: PartnerVerificationStatus;
  city: string | null;
  submittedAt: string | null;
  hotelCount: number;
  createdAt: string;
}

export interface StaffDto {
  id: string;
  userId: string;
  email: string;
  name: string;
  permissions: StaffPermission[];
  assignedProperties: string[];
  invitationStatus: StaffInvitationStatus;
  createdAt: string;
}

export interface AmenityDto {
  code: string;
  name: string;
  category: AmenityCategory;
  icon: string;
  description: string | null;
}

export interface DestinationDto {
  id: string;
  name: string;
  slug: string;
  city: string;
  region: string;
  country: string;
  coordinates: { lat: number; lng: number };
  description: string;
  imageUrl: string | null;
  popularityScore: number;
  propertyCount: number;
}

export interface SuggestionDto {
  type: 'destination' | 'hotel';
  label: string;
  sublabel: string;
  value: string;
  slug: string;
}

export interface RatingSummaryDto {
  average: number;
  count: number;
  /** DEVELOPMENT_SEED ratings are sample data and are labelled as such in the UI. */
  source: 'REVIEWS' | 'DEVELOPMENT_SEED';
}

export interface CancellationPolicyDto {
  type: CancellationPolicyType;
  freeCancellationHours: number;
  refundBasisPointsAfterDeadline: number;
  description?: string;
}

export interface HotelPriceDto {
  totalMinor: number;
  nightlyAverageMinor: number;
  currency: CurrencyCode;
  nights: number;
  rooms: number;
  roomTypeName: string;
  ratePlanName: string;
  mealPlan: MealPlan;
  freeCancellation: boolean;
  roomsLeft: number;
  taxesIncluded: true;
}

export interface HotelCardDto {
  id: string;
  slug: string;
  name: string;
  propertyType: PropertyType;
  starCategory: number;
  city: string;
  state: string;
  country: string;
  location: { lat: number; lng: number };
  shortDescription: string;
  coverImage: ImageDto | null;
  ratingSummary: RatingSummaryDto;
  amenities: string[];
  featured: boolean;
  instantConfirmation: boolean;
  distanceKm: number | null;
  /** Present only for date-based searches: a real quote for the cheapest available offer. */
  price: HotelPriceDto | null;
}

export interface SearchResultDto {
  items: HotelCardDto[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  /** Whether results were filtered by real availability for the requested dates. */
  availabilityChecked: boolean;
  nights: number | null;
}

export interface HotelPoliciesDto {
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

export interface RatePlanSummaryDto {
  id: string;
  name: string;
  mealPlan: MealPlan;
  cancellationPolicy: CancellationPolicyDto;
}

export interface RoomTypePublicDto {
  id: string;
  name: string;
  description: string;
  images: ImageDto[];
  roomSize: number;
  roomSizeUnit: 'SQM' | 'SQFT';
  bedConfiguration: Array<{ type: BedType; count: number }>;
  maximumAdults: number;
  maximumChildren: number;
  maximumOccupancy: number;
  amenities: string[];
  ratePlans: RatePlanSummaryDto[];
}

export interface HotelDetailDto extends HotelCardDto {
  description: string;
  address: { line1: string; line2?: string };
  postalCode: string;
  timeZone: string;
  currency: CurrencyCode;
  amenityDetails: AmenityDto[];
  languagesSpoken: string[];
  images: ImageDto[];
  videos: Array<{ url: string; title: string }>;
  policies: HotelPoliciesDto;
  checkInTime: string;
  checkOutTime: string;
  nearbyAttractions: Array<{ name: string; distanceKm: number; category: string }>;
  contactDetails: { phone: string; email: string; website?: string };
  roomTypes: RoomTypePublicDto[];
  accessibility: AccessibilityFeatureDto[];
  trustScore: TrustScoreDto | null;
}

export interface AccessibilityFeatureDto {
  code: AccessibilityFeature;
  label: string;
  note: string;
  /** Provenance: stated by the property, or checked by Stayscape staff (with the date). */
  source: AccessibilitySource;
  verifiedAt: string | null;
}

export interface TrustScoreComponentDto {
  key:
    | 'guest_reviews'
    | 'reliability'
    | 'verification'
    | 'responsiveness'
    | 'complaints'
    | 'completeness';
  label: string;
  /** 0-100 for this component. */
  score: number;
  weight: number;
  detail: string;
}

/** Documented in docs/trustscore.md. Null overall score when there is not enough data. */
export interface TrustScoreDto {
  score: number | null;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  basis: { reviews: number; completedStays: number; months: number };
  components: TrustScoreComponentDto[];
  computedAt: string;
}

export interface QuoteLineDto {
  label: string;
  amountMinor: number;
}

export interface QuoteNightDto {
  date: string;
  baseMinor: number;
  adjustments: QuoteLineDto[];
  supplementsMinor: number;
  discounts: QuoteLineDto[];
  /** Price for this night across all rooms, after discounts, before tax. */
  lineMinor: number;
  taxes: QuoteLineDto[];
}

export interface QuoteDto {
  quoteToken: string;
  expiresAt: string;
  hotel: { id: string; name: string; slug: string };
  roomType: { id: string; name: string };
  ratePlan: {
    id: string;
    name: string;
    mealPlan: MealPlan;
    cancellationPolicy: CancellationPolicyDto;
  };
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: number;
  occupancy: { adults: number; children: number; childrenAges: number[]; extraBeds: number };
  currency: CurrencyCode;
  nightly: QuoteNightDto[];
  taxes: QuoteLineDto[];
  fees: QuoteLineDto[];
  totals: {
    roomChargesMinor: number;
    discountsMinor: number;
    subtotalMinor: number;
    taxesMinor: number;
    feesMinor: number;
    totalMinor: number;
  };
  roomsLeft: number;
}

export interface RoomOfferDto {
  roomType: RoomTypePublicDto;
  available: number;
  unavailableReason: string | null;
  offers: QuoteDto[];
}

export interface QuoteRevalidationDto {
  valid: boolean;
  priceChanged: boolean;
  reason: string | null;
  quote: QuoteDto | null;
}

/* ------------------------------------------------------------------ Partner-facing */
export interface PartnerHotelSummaryDto {
  id: string;
  name: string;
  slug: string;
  city: string;
  propertyType: PropertyType;
  publicationStatus: PublicationStatus;
  verificationStatus: HotelVerificationStatus;
  revisionStatus: RevisionStatus;
  coverImage: ImageDto | null;
  roomTypeCount: number;
  updatedAt: string;
}

export interface PartnerHotelDto {
  id: string;
  partnerId: string;
  slug: string;
  publicationStatus: PublicationStatus;
  verificationStatus: HotelVerificationStatus;
  featured: boolean;
  everApproved: boolean;
  rejectionReason: string | null;
  revision: {
    status: RevisionStatus;
    rejectionReason: string | null;
    submittedAt: string | null;
    changedFields: string[];
  };
  /** Live (public) content. */
  live: HotelContentDto;
  /** What the partner is editing: live content merged with any pending revision. */
  working: HotelContentDto;
  images: ImageDto[];
  completeness: { ready: boolean; missing: string[] };
  createdAt: string;
  updatedAt: string;
}

export interface HotelContentDto {
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
  location: { lat: number; lng: number } | null;
  timeZone: string;
  currency: CurrencyCode;
  contactDetails: { phone: string; email: string; website?: string };
  amenities: string[];
  languagesSpoken: string[];
  images: Array<{ mediaId: string; alt: string }>;
  coverImageId: string | null;
  videos: Array<{ url: string; title: string }>;
  policies: HotelPoliciesDto;
  checkInTime: string;
  checkOutTime: string;
  instantConfirmation: boolean;
  nearbyAttractions: Array<{ name: string; distanceKm: number; category: string }>;
  taxConfig: TaxConfigDto;
}

export interface TaxConfigDto {
  taxes: Array<{
    code: string;
    label: string;
    slabs: Array<{ upToMinor: number | null; basisPoints: number }>;
  }>;
  fees: Array<{ code: string; label: string; amountMinor: number; chargeBasis: FeeChargeBasis }>;
}

export interface PartnerRoomTypeDto extends Omit<RoomTypePublicDto, 'ratePlans' | 'images'> {
  hotelId: string;
  images: ImageDto[];
  imageRefs: Array<{ mediaId: string; alt: string }>;
  totalInventory: number;
  status: RoomTypeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RatePlanDto {
  id: string;
  hotelId: string;
  roomTypeId: string;
  name: string;
  mealPlan: MealPlan;
  cancellationPolicy: CancellationPolicyDto;
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
}

export interface PricingRuleDto {
  id: string;
  hotelId: string;
  name: string;
  roomTypeId: string | null;
  ratePlanId: string | null;
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
}

export interface InventoryDayDto {
  date: string;
  totalRooms: number;
  /** Rooms blocked manually (excludes maintenance blocks). */
  blockedRooms: number;
  maintenanceRooms: number;
  stopSell: boolean;
  heldRooms: number;
  bookedRooms: number;
  /** Sellable now: 0 while stop-sell is on. */
  available: number;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  minimumStay: number | null;
  maximumStay: number | null;
}

export interface AdminHotelSummaryDto {
  id: string;
  name: string;
  slug: string;
  city: string;
  partnerName: string | null;
  publicationStatus: PublicationStatus;
  revisionStatus: RevisionStatus;
  featured: boolean;
  submittedAt: string | null;
  updatedAt: string;
}
