import { Schema, Types, model } from 'mongoose';
import {
  ACCESSIBILITY_FEATURE_LABELS,
  type AccessibilityFeature,
  type AccessibilityFeatureDto,
  type TrustScoreComponentDto,
  type TrustScoreDto,
} from '@stayscape/shared';
import { Errors } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import { BookingModel, CancellationModel } from '@/modules/bookings/booking.models';
import type { CacheService } from '@/modules/catalog/cache.service';
import { HotelModel, type HotelRecord } from '@/modules/hotels/hotel.model';
import type { PartnerAccessService } from '@/modules/partners/partner-access.service';
import { PartnerModel } from '@/modules/partners/partner.model';
import { ReviewModel } from '@/modules/reviews/review.models';
import { SupportTicketModel } from '@/modules/support/support.models';
import type { AuthContext } from '@/types/express';

/**
 * TrustScore — a transparent 0–100 score built only from Stayscape's own records (docs/trustscore.md).
 *
 *   guest_reviews   40 %  Bayesian mean of published review scores: (Σscores + 10×3.5) ÷ (n + 10),
 *                         mapped 1→0 and 5→100. The prior pulls small samples toward the middle.
 *   reliability     20 %  1 − property-initiated cancellations/rejections ÷ confirmed bookings (365 d)
 *   verification    15 %  partner KYC approved (50) + listing verified by Stayscape (50)
 *   responsiveness  10 %  share of reviews with a property response (last 365 d); 50 when no reviews
 *   complaints      10 %  1 − complaint tickets ÷ confirmed bookings × 5 (floored at 0) (365 d)
 *   completeness     5 %  photos ≥ 5, description ≥ 200 chars, ≥ 5 amenities, house rules, accessibility
 *
 * Confidence: HIGH with ≥ 25 reviews and ≥ 50 completed stays, MEDIUM with ≥ 5 and ≥ 10, else LOW.
 * No overall score is shown with fewer than 3 reviews AND fewer than 5 completed stays.
 * Snapshots are cached for 24 h; nothing in the score is self-reported by the property except
 * accessibility/completeness facts, which carry less than 5 % of the weight.
 */
interface TrustSnapshotAttrs {
  hotelId: Types.ObjectId;
  result: TrustScoreDto;
  computedAt: Date;
}
const snapshotSchema = new Schema<TrustSnapshotAttrs>(
  {
    hotelId: { type: Schema.Types.ObjectId, required: true },
    result: { type: Schema.Types.Mixed, required: true },
    computedAt: { type: Date, required: true },
  },
  { versionKey: false },
);
snapshotSchema.index({ hotelId: 1 }, { unique: true, name: 'uniq_hotel' });
export const TrustSnapshotModel = model<TrustSnapshotAttrs>('TrustScoreSnapshot', snapshotSchema);

const TTL_MS = 24 * 3_600_000;
const WEIGHTS = {
  guest_reviews: 40,
  reliability: 20,
  verification: 15,
  responsiveness: 10,
  complaints: 10,
  completeness: 5,
} as const;
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function trustConfidence(reviews: number, stays: number): TrustScoreDto['confidence'] {
  if (reviews >= 25 && stays >= 50) return 'HIGH';
  if (reviews >= 5 && stays >= 10) return 'MEDIUM';
  return 'LOW';
}

/** Pure scoring from the gathered facts (unit-tested). */
export function scoreTrust(f: {
  reviewCount: number;
  reviewSumTenths: number;
  respondedReviews: number;
  confirmed: number;
  propertyCancellations: number;
  complaints: number;
  completedStays: number;
  partnerApproved: boolean;
  listingVerified: boolean;
  completeness: {
    photos: number;
    descriptionLength: number;
    amenities: number;
    houseRules: boolean;
    accessibility: number;
  };
  months: number;
  now: Date;
}): TrustScoreDto {
  const bayes = (f.reviewSumTenths / 10 + 10 * 3.5) / (f.reviewCount + 10);
  const c = f.completeness;
  const parts: Array<[TrustScoreComponentDto['key'], string, number, string]> = [
    [
      'guest_reviews',
      'Guest reviews',
      ((bayes - 1) / 4) * 100,
      f.reviewCount
        ? `${f.reviewCount} verified review(s)`
        : 'No reviews yet; neutral starting value',
    ],
    [
      'reliability',
      'Booking reliability',
      f.confirmed ? (1 - f.propertyCancellations / f.confirmed) * 100 : 100,
      f.confirmed
        ? `${f.propertyCancellations} property-initiated cancellation(s) in ${f.confirmed} booking(s)`
        : 'No bookings yet',
    ],
    [
      'verification',
      'Verification',
      (f.partnerApproved ? 50 : 0) + (f.listingVerified ? 50 : 0),
      `${f.partnerApproved ? 'Business verified' : 'Business not yet verified'}; ${f.listingVerified ? 'listing checked by Stayscape' : 'listing not yet checked'}`,
    ],
    [
      'responsiveness',
      'Responds to guests',
      f.reviewCount ? (f.respondedReviews / f.reviewCount) * 100 : 50,
      f.reviewCount
        ? `Responded to ${f.respondedReviews} of ${f.reviewCount} review(s)`
        : 'No reviews to respond to yet',
    ],
    [
      'complaints',
      'Complaint rate',
      f.confirmed ? (1 - Math.min(1, (f.complaints / f.confirmed) * 5)) * 100 : 100,
      f.confirmed
        ? `${f.complaints} support complaint(s) linked to ${f.confirmed} booking(s)`
        : 'No bookings yet',
    ],
    [
      'completeness',
      'Listing completeness',
      ((c.photos >= 5 ? 1 : 0) +
        (c.descriptionLength >= 200 ? 1 : 0) +
        (c.amenities >= 5 ? 1 : 0) +
        (c.houseRules ? 1 : 0) +
        (c.accessibility > 0 ? 1 : 0)) *
        20,
      'Photos, description, amenities, house policies and accessibility information',
    ],
  ];
  const components = parts.map(([key, label, score, detail]) => ({
    key,
    label,
    score: clamp(score),
    weight: WEIGHTS[key],
    detail,
  }));
  const enough = f.reviewCount >= 3 || f.completedStays >= 5;
  const overall = components.reduce((s, x) => s + x.score * x.weight, 0) / 100;
  return {
    score: enough ? clamp(overall) : null,
    confidence: trustConfidence(f.reviewCount, f.completedStays),
    basis: { reviews: f.reviewCount, completedStays: f.completedStays, months: f.months },
    components,
    computedAt: f.now.toISOString(),
  };
}

export class TrustService {
  constructor(
    private readonly deps: {
      access: PartnerAccessService;
      audit: AuditService;
      cache: CacheService;
    },
  ) {}

  async compute(hotel: HotelRecord, now = new Date()): Promise<TrustScoreDto> {
    const since = new Date(now.getTime() - 365 * 86_400_000);
    const hotelId = hotel._id;
    const [reviews, confirmed, completedStays, partner, bookingIds, complaints] = await Promise.all(
      [
        ReviewModel.aggregate<{ n: number; sum: number; responded: number }>([
          { $match: { hotelId, status: 'PUBLISHED', createdAt: { $gte: since } } },
          {
            $group: {
              _id: null,
              n: { $sum: 1 },
              sum: { $sum: '$overallTenths' },
              responded: { $sum: { $cond: [{ $ifNull: ['$response.body', false] }, 1, 0] } },
            },
          },
        ]),
        BookingModel.countDocuments({ hotelId, confirmedAt: { $gte: since } }),
        BookingModel.countDocuments({
          hotelId,
          bookingStatus: { $in: ['CHECKED_OUT', 'COMPLETED'] },
        }),
        PartnerModel.findById(hotel.partnerId, { verificationStatus: 1 }).lean<{
          verificationStatus: string;
        }>(),
        BookingModel.distinct('_id', { hotelId, confirmedAt: { $gte: since } }),
        SupportTicketModel.countDocuments({
          hotelId,
          createdAt: { $gte: since },
          category: { $in: ['BOOKING', 'PROPERTY', 'CANCELLATION', 'OTHER'] },
        }),
      ],
    );
    const propertyCancellations = await CancellationModel.countDocuments({
      bookingId: { $in: bookingIds },
      requestedByRole: 'PROPERTY',
    });
    const rejected = await BookingModel.countDocuments({
      _id: { $in: bookingIds },
      bookingStatus: 'REJECTED',
    });
    const r = reviews[0];
    const firstBooking = await BookingModel.findOne(
      { hotelId, confirmedAt: { $ne: null } },
      { confirmedAt: 1 },
    )
      .sort({ confirmedAt: 1 })
      .lean<{ confirmedAt: Date }>();
    return scoreTrust({
      reviewCount: r?.n ?? 0,
      reviewSumTenths: r?.sum ?? 0,
      respondedReviews: r?.responded ?? 0,
      confirmed,
      propertyCancellations: Math.min(confirmed, propertyCancellations + rejected),
      complaints,
      completedStays,
      partnerApproved: partner?.verificationStatus === 'APPROVED',
      listingVerified: hotel.verificationStatus === 'VERIFIED',
      completeness: {
        photos: hotel.images.length,
        descriptionLength: hotel.description.length,
        amenities: hotel.amenities.length,
        houseRules: Boolean(
          hotel.policies?.additionalRules?.length || hotel.policies?.cancellationSummary,
        ),
        accessibility: (hotel.accessibilityFeatures ?? []).length,
      },
      months: firstBooking
        ? Math.max(
            0,
            Math.floor((now.getTime() - firstBooking.confirmedAt.getTime()) / (30 * 86_400_000)),
          )
        : 0,
      now,
    });
  }

  /** Cached for 24 h per property. */
  async forHotel(hotel: HotelRecord): Promise<TrustScoreDto> {
    const cached = await TrustSnapshotModel.findOne({
      hotelId: hotel._id,
    }).lean<TrustSnapshotAttrs>();
    if (cached && Date.now() - cached.computedAt.getTime() < TTL_MS) return cached.result;
    const result = await this.compute(hotel);
    await TrustSnapshotModel.updateOne(
      { hotelId: hotel._id },
      { $set: { result, computedAt: new Date(result.computedAt) } },
      { upsert: true },
    );
    return result;
  }

  // ------------------------------------------------------------------ accessibility (provenance)
  static toAccessibilityDtos(
    hotel: Pick<HotelRecord, 'accessibilityFeatures'>,
  ): AccessibilityFeatureDto[] {
    return (hotel.accessibilityFeatures ?? []).map((f) => ({
      code: f.code as AccessibilityFeature,
      label: ACCESSIBILITY_FEATURE_LABELS[f.code as AccessibilityFeature] ?? f.code,
      note: f.note,
      source: f.source,
      verifiedAt: f.verifiedAt ? new Date(f.verifiedAt).toISOString() : null,
    }));
  }

  /** Partner declaration (property:edit). Removing a feature removes its verification too. */
  async declareAccessibility(
    auth: AuthContext,
    hotelId: string,
    features: Array<{ code: string; note: string }>,
    context: RequestContext,
  ) {
    const { hotel } = await this.deps.access.resolveHotel(auth, hotelId, 'property:edit');
    const existing = new Map((hotel.accessibilityFeatures ?? []).map((f) => [f.code, f]));
    const now = new Date();
    const next = features.map((f) => {
      const prev = existing.get(f.code);
      // A verified feature stays verified only while its description is unchanged.
      if (prev && prev.source === 'ADMIN_VERIFIED' && prev.note === f.note) return prev;
      return {
        code: f.code,
        note: f.note,
        source: 'PARTNER_DECLARED' as const,
        declaredAt: prev?.declaredAt ?? now,
        verifiedAt: null,
        verifiedBy: null,
        evidence: null,
      };
    });
    await HotelModel.updateOne({ _id: hotel._id }, { $set: { accessibilityFeatures: next } });
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'hotel.accessibility_declared',
      entityType: 'Hotel',
      entityId: hotel._id.toString(),
      metadata: { before: [...existing.keys()], after: next.map((f) => f.code) },
      context,
    });
    await this.deps.cache.invalidatePublic();
    return TrustService.toAccessibilityDtos({ accessibilityFeatures: next });
  }

  /** Admin verification (hotels:moderate) of features the property declared, with evidence. */
  async verifyAccessibility(
    actorId: string,
    hotelId: string,
    input: { codes: string[]; verified: boolean; evidence: string },
    context: RequestContext,
  ) {
    if (!Types.ObjectId.isValid(hotelId)) throw Errors.notFound('Property');
    const hotel = await HotelModel.findById(hotelId).lean<HotelRecord>();
    if (!hotel) throw Errors.notFound('Property');
    const features = hotel.accessibilityFeatures ?? [];
    const missing = input.codes.filter((c) => !features.some((f) => f.code === c));
    if (missing.length)
      throw Errors.validation({
        fieldErrors: { codes: [`Not declared by the property: ${missing.join(', ')}`] },
      });
    const now = new Date();
    const next = features.map((f) =>
      input.codes.includes(f.code)
        ? input.verified
          ? {
              ...f,
              source: 'ADMIN_VERIFIED' as const,
              verifiedAt: now,
              verifiedBy: new Types.ObjectId(actorId),
              evidence: input.evidence,
            }
          : {
              ...f,
              source: 'PARTNER_DECLARED' as const,
              verifiedAt: null,
              verifiedBy: null,
              evidence: input.evidence,
            }
        : f,
    );
    await HotelModel.updateOne({ _id: hotel._id }, { $set: { accessibilityFeatures: next } });
    await this.deps.audit.record({
      actorId,
      action: input.verified ? 'hotel.accessibility_verified' : 'hotel.accessibility_unverified',
      entityType: 'Hotel',
      entityId: hotelId,
      metadata: { codes: input.codes, evidence: input.evidence },
      partnerId: hotel.partnerId.toString(),
      hotelId,
      context,
    });
    await this.deps.cache.invalidatePublic();
    return TrustService.toAccessibilityDtos({ accessibilityFeatures: next });
  }
}
