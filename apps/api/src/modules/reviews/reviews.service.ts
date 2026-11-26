import { Types, type ClientSession } from 'mongoose';
import {
  REVIEWABLE_BOOKING_STATUSES,
  REVIEW_CATEGORIES,
  REVIEW_WINDOW_DAYS,
  addDays,
  todayInTimeZone,
  type AdminReviewDto,
  type ImageDto,
  type MyReviewDto,
  type Paginated,
  type PartnerReviewDto,
  type PublicReviewDto,
  type ReviewEligibilityDto,
  type ReviewInput,
  type ReviewRatingsDto,
  type ReviewSummaryDto,
} from '@stayscape/shared';
import type { Config } from '@/config/env';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import { BookingModel, type BookingRecord } from '@/modules/bookings/booking.models';
import type { CacheService } from '@/modules/catalog/cache.service';
import { imageMap, resolveImages } from '@/modules/hotels/hotel.mapper';
import { HotelModel, type HotelRecord } from '@/modules/hotels/hotel.model';
import { toImageDto, type MediaService, type UploadedFile } from '@/modules/media/media.service';
import type { OutboxService } from '@/modules/outbox/outbox.service';
import type { PartnerAccessService } from '@/modules/partners/partner-access.service';
import { UserModel } from '@/modules/users/user.model';
import type { AuthContext } from '@/types/express';
import {
  ReviewModel,
  ReviewReportModel,
  type ReviewRecord,
  type ReviewReportAttrs,
} from './review.models';

const VISIBLE = ['PUBLISHED', 'FLAGGED'] as const;

interface Deps {
  config: Pick<Config, 'REVIEW_EDIT_WINDOW_DAYS' | 'REVIEW_MAX_EDITS'>;
  media: MediaService;
  access: PartnerAccessService;
  outbox: OutboxService;
  audit: AuditService;
  cache: CacheService;
}

export function overallTenths(ratings: ReviewRatingsDto): number {
  const sum = REVIEW_CATEGORIES.reduce((s, c) => s + ratings[c], 0);
  // Mean ×10 rounded half up, as an integer (e.g. 4.33 → 43).
  return Math.round((sum * 10) / REVIEW_CATEGORIES.length);
}

/**
 * Verified reviews. A review can only be written by the customer of a booking that has been
 * checked out or completed, within REVIEW_WINDOW_DAYS of check-out — one per booking (unique index).
 * Owners can respond but there is no endpoint that lets them delete or hide reviews; only platform
 * moderators can remove a review, with a recorded reason.
 */
export class ReviewsService {
  constructor(private readonly deps: Deps) {}

  private async photos(reviews: ReviewRecord[]): Promise<Map<string, ImageDto[]>> {
    const assets = imageMap(await this.deps.media.findImages(reviews.flatMap((r) => r.photoIds)));
    return new Map(
      reviews.map((r) => [
        r._id.toString(),
        resolveImages(
          r.photoIds.map((id) => ({ mediaId: id, alt: 'Guest photo' })),
          assets,
        ),
      ]),
    );
  }

  private toPublic(r: ReviewRecord, photos: ImageDto[]): PublicReviewDto {
    return {
      id: r._id.toString(),
      authorName: r.authorName,
      stayMonth: r.stayMonth,
      roomTypeName: r.roomTypeName,
      overall: r.overallTenths / 10,
      ratings: r.ratings,
      title: r.title,
      body: r.body,
      photos,
      verifiedStay: true,
      response: r.response
        ? { body: r.response.body, respondedAt: r.response.respondedAt.toISOString() }
        : null,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
    };
  }

  private editableUntil(r: ReviewRecord): Date {
    return new Date(r.createdAt.getTime() + this.deps.config.REVIEW_EDIT_WINDOW_DAYS * 86_400_000);
  }

  private reviewable(b: BookingRecord, now = new Date()): boolean {
    return (
      REVIEWABLE_BOOKING_STATUSES.includes(b.bookingStatus) &&
      !b.reviewId &&
      todayInTimeZone(b.propertyTimezone, now) <= addDays(b.checkOutLocalDate, REVIEW_WINDOW_DAYS)
    );
  }

  /** Recompute a hotel's public rating summary from visible verified reviews. */
  async recalculate(hotelId: Types.ObjectId, session?: ClientSession): Promise<void> {
    const opt = session ? { session } : {};
    const [agg] = await ReviewModel.aggregate<{ avg: number; count: number }>([
      { $match: { hotelId, status: { $in: VISIBLE } } },
      { $group: { _id: null, avg: { $avg: '$overallTenths' }, count: { $sum: 1 } } },
    ]).session(session ?? null);
    if (agg && agg.count > 0) {
      await HotelModel.updateOne(
        { _id: hotelId },
        {
          $set: {
            ratingSummary: {
              average: Math.round(agg.avg) / 10,
              count: agg.count,
              source: 'REVIEWS',
            },
          },
        },
        opt,
      );
    } else {
      // No verified reviews: clear a previously review-based summary (development samples are left alone).
      await HotelModel.updateOne(
        { _id: hotelId, 'ratingSummary.source': 'REVIEWS' },
        { $set: { ratingSummary: { average: 0, count: 0, source: 'REVIEWS' } } },
        opt,
      );
    }
    await this.deps.cache.invalidatePublic();
  }

  async eligible(auth: AuthContext): Promise<ReviewEligibilityDto[]> {
    const bookings = await BookingModel.find({
      customerId: auth.userId,
      bookingStatus: { $in: REVIEWABLE_BOOKING_STATUSES },
      reviewId: null,
    })
      .sort({ checkOutLocalDate: -1 })
      .limit(50)
      .lean<BookingRecord[]>();
    return bookings
      .filter((b) => this.reviewable(b))
      .map((b) => ({
        bookingReference: b.bookingReference,
        hotel: { id: b.hotelId.toString(), name: b.hotelSnapshot.name, slug: b.hotelSnapshot.slug },
        checkOut: b.checkOutLocalDate,
        reviewableUntil: addDays(b.checkOutLocalDate, REVIEW_WINDOW_DAYS),
      }));
  }

  async uploadPhoto(auth: AuthContext, file: UploadedFile | undefined): Promise<ImageDto> {
    return toImageDto(
      await this.deps.media.uploadImage({
        partnerId: null,
        hotelId: null,
        uploadedBy: auth.userId,
        purpose: 'REVIEW_IMAGE',
        file,
      }),
    );
  }

  async create(
    auth: AuthContext,
    reference: string,
    input: ReviewInput,
    context: RequestContext,
  ): Promise<MyReviewDto> {
    const booking = await BookingModel.findOne({
      bookingReference: reference,
      customerId: auth.userId,
    }).lean<BookingRecord>();
    if (!booking) throw Errors.notFound('Booking');
    if (booking.reviewId)
      throw new AppError(409, 'CONFLICT', 'This stay has already been reviewed.');
    if (!this.reviewable(booking))
      throw new AppError(
        403,
        'NOT_ELIGIBLE',
        'Reviews can be written for completed stays you booked, within 180 days of check-out.',
      );
    await this.deps.media.assertUploadedBy(auth.userId, input.photoIds, 'REVIEW_IMAGE');
    const user = await UserModel.findById(auth.userId, { firstName: 1, lastName: 1 }).lean<{
      firstName: string;
      lastName: string;
    }>();
    let review: ReviewRecord;
    try {
      review = await withTransaction(async (session) => {
        const [doc] = await ReviewModel.create(
          [
            {
              bookingId: booking._id,
              hotelId: booking.hotelId,
              customerId: booking.customerId,
              authorName: user ? `${user.firstName} ${user.lastName.charAt(0)}.` : 'Verified guest',
              roomTypeName: booking.bookingItems[0]?.roomTypeName ?? 'Room',
              stayMonth: booking.checkInLocalDate.slice(0, 7),
              checkOutLocalDate: booking.checkOutLocalDate,
              ratings: input.ratings,
              overallTenths: overallTenths(input.ratings),
              title: input.title,
              body: input.body,
              photoIds: input.photoIds.map((id) => new Types.ObjectId(id)),
            },
          ],
          { session },
        );
        const linked = await BookingModel.updateOne(
          { _id: booking._id, reviewId: null },
          { $set: { reviewId: doc!._id } },
          { session },
        );
        if (linked.modifiedCount !== 1)
          throw new AppError(409, 'CONFLICT', 'This stay has already been reviewed.');
        await this.recalculate(booking.hotelId, session);
        return doc!.toObject() as ReviewRecord;
      });
    } catch (error) {
      if (isMongoDuplicateKey(error))
        throw new AppError(409, 'CONFLICT', 'This stay has already been reviewed.');
      throw error;
    }
    await this.deps.media.markAttached(input.photoIds);
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'review.created',
      entityType: 'Review',
      entityId: review._id.toString(),
      context,
    });
    return (await this.mine(auth)).find((r) => r.id === review._id.toString())!;
  }

  async update(
    auth: AuthContext,
    reviewId: string,
    input: ReviewInput,
    context: RequestContext,
  ): Promise<MyReviewDto> {
    if (!Types.ObjectId.isValid(reviewId)) throw Errors.notFound('Review');
    const review = await ReviewModel.findOne({
      _id: reviewId,
      customerId: auth.userId,
    }).lean<ReviewRecord>();
    if (!review) throw Errors.notFound('Review');
    if (review.status === 'REMOVED')
      throw new AppError(409, 'INVALID_STATE', 'A removed review cannot be edited.');
    if (
      new Date() > this.editableUntil(review) ||
      review.editCount >= this.deps.config.REVIEW_MAX_EDITS
    ) {
      throw new AppError(
        409,
        'NOT_ELIGIBLE',
        `Reviews can be edited up to ${this.deps.config.REVIEW_MAX_EDITS} times within ${this.deps.config.REVIEW_EDIT_WINDOW_DAYS} days.`,
      );
    }
    await this.deps.media.assertUploadedBy(auth.userId, input.photoIds, 'REVIEW_IMAGE');
    const updated = await ReviewModel.updateOne(
      { _id: review._id, editCount: review.editCount },
      {
        $set: {
          ratings: input.ratings,
          overallTenths: overallTenths(input.ratings),
          title: input.title,
          body: input.body,
          photoIds: input.photoIds.map((id) => new Types.ObjectId(id)),
          editedAt: new Date(),
        },
        $inc: { editCount: 1 },
      },
    );
    if (updated.modifiedCount !== 1)
      throw new AppError(409, 'CONFLICT', 'The review changed while saving. Please retry.');
    await this.deps.media.markAttached(input.photoIds);
    await this.recalculate(review.hotelId);
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'review.edited',
      entityType: 'Review',
      entityId: reviewId,
      context,
    });
    return (await this.mine(auth)).find((r) => r.id === reviewId)!;
  }

  async mine(auth: AuthContext): Promise<MyReviewDto[]> {
    const reviews = await ReviewModel.find({ customerId: auth.userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<ReviewRecord[]>();
    const [photos, bookings] = await Promise.all([
      this.photos(reviews),
      BookingModel.find(
        { _id: { $in: reviews.map((r) => r.bookingId) } },
        { bookingReference: 1, hotelSnapshot: 1, hotelId: 1 },
      ).lean<BookingRecord[]>(),
    ]);
    const now = new Date();
    return reviews.map((r) => {
      const b = bookings.find((x) => x._id.equals(r.bookingId));
      const until = this.editableUntil(r);
      return {
        ...this.toPublic(r, photos.get(r._id.toString()) ?? []),
        bookingReference: b?.bookingReference ?? '',
        hotel: {
          id: r.hotelId.toString(),
          name: b?.hotelSnapshot.name ?? '',
          slug: b?.hotelSnapshot.slug ?? '',
        },
        status: r.status,
        editCount: r.editCount,
        editableUntil: until.toISOString(),
        canEdit:
          r.status !== 'REMOVED' && now <= until && r.editCount < this.deps.config.REVIEW_MAX_EDITS,
      };
    });
  }

  async publicList(
    idOrSlug: string,
    query: { page: number; limit: number; sort: 'recent' | 'highest' | 'lowest' },
  ): Promise<Paginated<PublicReviewDto> & { summary: ReviewSummaryDto }> {
    const filter = Types.ObjectId.isValid(idOrSlug)
      ? { _id: idOrSlug }
      : { slug: idOrSlug.toLowerCase() };
    const hotel = await HotelModel.findOne(
      { ...filter, publicationStatus: 'PUBLISHED' },
      { ratingSummary: 1 },
    ).lean<HotelRecord>();
    if (!hotel) throw Errors.notFound('Property');
    const match = { hotelId: hotel._id, status: { $in: VISIBLE } };
    const sort: Record<string, 1 | -1> =
      query.sort === 'highest'
        ? { overallTenths: -1, _id: -1 }
        : query.sort === 'lowest'
          ? { overallTenths: 1, _id: -1 }
          : { createdAt: -1, _id: -1 };
    const [items, total, categories] = await Promise.all([
      ReviewModel.find(match)
        .sort(sort)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<ReviewRecord[]>(),
      ReviewModel.countDocuments(match),
      ReviewModel.aggregate<Record<string, number>>([
        { $match: match },
        {
          $group: {
            _id: null,
            ...Object.fromEntries(REVIEW_CATEGORIES.map((c) => [c, { $avg: `$ratings.${c}` }])),
          },
        },
      ]),
    ]);
    const photos = await this.photos(items);
    const cat = categories[0];
    return {
      ...paginated(
        items.map((r) => this.toPublic(r, photos.get(r._id.toString()) ?? [])),
        query.page,
        query.limit,
        total,
      ),
      summary: {
        average: hotel.ratingSummary.average,
        count: hotel.ratingSummary.count,
        source: hotel.ratingSummary.source,
        categories: cat
          ? Object.fromEntries(
              REVIEW_CATEGORIES.map((c) => [c, Math.round((cat[c] ?? 0) * 10) / 10]),
            )
          : {},
      },
    };
  }

  async report(
    auth: AuthContext,
    reviewId: string,
    input: { reason: ReviewReportAttrs['reason']; details: string },
  ): Promise<void> {
    if (!Types.ObjectId.isValid(reviewId)) throw Errors.notFound('Review');
    const review = await ReviewModel.findOne({
      _id: reviewId,
      status: { $in: VISIBLE },
    }).lean<ReviewRecord>();
    if (!review) throw Errors.notFound('Review');
    if (review.customerId.toString() === auth.userId)
      throw new AppError(409, 'CONFLICT', 'You cannot report your own review.');
    try {
      await ReviewReportModel.create({
        reviewId: review._id,
        reporterId: auth.userId,
        reason: input.reason,
        details: input.details,
      });
    } catch (error) {
      if (isMongoDuplicateKey(error)) return; // already reported by this user: idempotent
      throw error;
    }
    await ReviewModel.updateOne(
      { _id: review._id },
      {
        $inc: { reportCount: 1 },
        $set: { status: review.status === 'PUBLISHED' ? 'FLAGGED' : review.status },
      },
    );
  }

  // ------------------------------------------------------------------ property side
  async partnerList(auth: AuthContext, hotelId: string): Promise<PartnerReviewDto[]> {
    const access = await this.deps.access.resolveHotel(auth, hotelId, 'BOOKINGS_MANAGE');
    const reviews = await ReviewModel.find({ hotelId: access.hotel._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<ReviewRecord[]>();
    const photos = await this.photos(reviews);
    const bookings = await BookingModel.find(
      { _id: { $in: reviews.map((r) => r.bookingId) } },
      { bookingReference: 1 },
    ).lean<BookingRecord[]>();
    return reviews.map((r) => ({
      ...this.toPublic(r, photos.get(r._id.toString()) ?? []),
      status: r.status,
      reportCount: r.reportCount,
      bookingReference: bookings.find((b) => b._id.equals(r.bookingId))?.bookingReference ?? '',
    }));
  }

  /** Owners/authorised staff can respond (and edit their response). They can never delete a review. */
  async respond(
    auth: AuthContext,
    hotelId: string,
    reviewId: string,
    body: string,
    context: RequestContext,
  ): Promise<void> {
    const access = await this.deps.access.resolveHotel(auth, hotelId, 'BOOKINGS_MANAGE');
    if (!Types.ObjectId.isValid(reviewId)) throw Errors.notFound('Review');
    const updated = await ReviewModel.findOneAndUpdate(
      { _id: reviewId, hotelId: access.hotel._id, status: { $in: VISIBLE } },
      {
        $set: {
          response: { body, respondedBy: new Types.ObjectId(auth.userId), respondedAt: new Date() },
        },
      },
      { new: true },
    ).lean<ReviewRecord>();
    if (!updated) throw Errors.notFound('Review');
    await this.deps.outbox.add(
      {
        eventId: `review.responded.${updated._id}.${updated.response!.respondedAt.getTime()}`,
        type: 'review.responded',
        aggregateType: 'Review',
        aggregateId: updated._id.toString(),
        payload: {},
      },
      null,
    );
    await this.deps.outbox.kick();
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'review.responded',
      entityType: 'Review',
      entityId: reviewId,
      context,
    });
  }

  // ------------------------------------------------------------------ moderation
  async adminList(
    status: 'FLAGGED' | 'REMOVED' | 'PUBLISHED' = 'FLAGGED',
  ): Promise<AdminReviewDto[]> {
    const reviews = await ReviewModel.find({ status })
      .sort({ reportCount: -1, updatedAt: -1 })
      .limit(100)
      .lean<ReviewRecord[]>();
    const [photos, reports, hotels, bookings] = await Promise.all([
      this.photos(reviews),
      ReviewReportModel.find({ reviewId: { $in: reviews.map((r) => r._id) } }).lean<
        Array<ReviewReportAttrs & { _id: Types.ObjectId }>
      >(),
      HotelModel.find({ _id: { $in: reviews.map((r) => r.hotelId) } }, { name: 1 }).lean<
        HotelRecord[]
      >(),
      BookingModel.find(
        { _id: { $in: reviews.map((r) => r.bookingId) } },
        { bookingReference: 1 },
      ).lean<BookingRecord[]>(),
    ]);
    return reviews.map((r) => ({
      ...this.toPublic(r, photos.get(r._id.toString()) ?? []),
      status: r.status,
      reportCount: r.reportCount,
      bookingReference: bookings.find((b) => b._id.equals(r.bookingId))?.bookingReference ?? '',
      hotel: {
        id: r.hotelId.toString(),
        name: hotels.find((h) => h._id.equals(r.hotelId))?.name ?? '',
      },
      reports: reports
        .filter((x) => x.reviewId.equals(r._id))
        .map((x) => ({
          reason: x.reason,
          details: x.details,
          createdAt: x.createdAt.toISOString(),
        })),
      moderation: r.moderation
        ? {
            decision: r.moderation.decision,
            reason: r.moderation.reason,
            at: r.moderation.at.toISOString(),
          }
        : null,
    }));
  }

  async moderate(
    adminId: string,
    reviewId: string,
    decision: 'REMOVE' | 'RESTORE' | 'DISMISS_REPORTS',
    reason: string,
    context: RequestContext,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(reviewId)) throw Errors.notFound('Review');
    const review = await ReviewModel.findById(reviewId).lean<ReviewRecord>();
    if (!review) throw Errors.notFound('Review');
    const moderation = { decision, reason, by: new Types.ObjectId(adminId), at: new Date() };
    const next = decision === 'REMOVE' ? 'REMOVED' : 'PUBLISHED';
    if (decision === 'RESTORE' && review.status !== 'REMOVED')
      throw new AppError(409, 'INVALID_STATE', 'Only removed reviews can be restored.');
    if (decision === 'DISMISS_REPORTS' && review.status !== 'FLAGGED')
      throw new AppError(409, 'INVALID_STATE', 'Only flagged reviews have reports to dismiss.');
    await ReviewModel.updateOne({ _id: review._id }, { $set: { status: next, moderation } });
    await ReviewReportModel.updateMany(
      { reviewId: review._id, status: 'OPEN' },
      { $set: { status: decision === 'REMOVE' ? 'UPHELD' : 'DISMISSED' } },
    );
    await this.recalculate(review.hotelId);
    await this.deps.audit.record({
      actorId: adminId,
      action: `review.${decision.toLowerCase()}`,
      entityType: 'Review',
      entityId: reviewId,
      metadata: { reason },
      context,
    });
  }
}
