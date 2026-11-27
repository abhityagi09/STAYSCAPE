import type { CouponsService } from '@/modules/coupons/coupons.service';
import { Types, type ClientSession } from 'mongoose';
import {
  formatMinorUnits,
  stayNights,
  todayInTimeZone,
  type BookingDetailDto,
  type BookingStatus,
  type BookingSummaryDto,
  type CreateBookingInput,
  type CreateHoldInput,
  type CurrencyCode,
  type HoldDto,
  type ImageDto,
  type ListBookingsQuery,
  type Paginated,
} from '@stayscape/shared';
import type { Config } from '@/config/env';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { paginated } from '@/lib/http';
import { assertSameRequest, requestFingerprint } from '@/lib/idempotency';
import type { Logger } from '@/lib/logger';
import { newBookingReference, newHoldReference } from '@/lib/references';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import { coverImage, imageMap } from '@/modules/hotels/hotel.mapper';
import { HotelModel, type HotelRecord } from '@/modules/hotels/hotel.model';
import {
  InventoryConflictError,
  type InventoryService,
} from '@/modules/inventory/inventory.service';
import type { MediaService } from '@/modules/media/media.service';
import type { OutboxService } from '@/modules/outbox/outbox.service';
import {
  PaymentModel,
  RefundModel,
  type PaymentRecord,
  type RefundRecord,
} from '@/modules/payments/payment.models';
import type { QuoteService } from '@/modules/pricing/quote.service';
import {
  RatePlanModel,
  RoomTypeModel,
  type RatePlanRecord,
  type RoomTypeRecord,
} from '@/modules/rooms/room.models';
import type { AuthContext } from '@/types/express';
import { toDetailDto, toHoldDto, toSummaryDto } from './booking.mapper';
import {
  BookingHoldModel,
  BookingModel,
  CancellationModel,
  type BookingHoldRecord,
  type BookingItemSnapshot,
  type BookingRecord,
  type CancellationRecord,
  type HotelSnapshot,
} from './booking.models';
import { snapshotPolicy } from './cancellation-policy';

/** Anti-hoarding: unbooked live holds a customer may have at once. */
const MAX_ACTIVE_HOLDS = 3;

interface Deps {
  config: Pick<Config, 'BOOKING_HOLD_TTL_MINUTES'>;
  quotes: QuoteService;
  inventory: InventoryService;
  outbox: OutboxService;
  coupons: CouponsService;
  media: MediaService;
  audit: AuditService;
  logger: Logger;
}

export function hotelSnapshot(hotel: HotelRecord): HotelSnapshot {
  return {
    name: hotel.name,
    slug: hotel.slug,
    city: hotel.city,
    state: hotel.state,
    addressLine: [hotel.address?.line1, hotel.address?.line2].filter(Boolean).join(', '),
    postalCode: hotel.postalCode,
    country: hotel.country,
    phone: hotel.contactDetails?.phone ?? null,
    email: hotel.contactDetails?.email ?? null,
    checkInTime: hotel.checkInTime,
    checkOutTime: hotel.checkOutTime,
  };
}

export function statusEvent(status: BookingStatus, note: string | null = null) {
  return { status, at: new Date(), note };
}

export class BookingsService {
  constructor(private readonly deps: Deps) {}

  // ------------------------------------------------------------------ shared loading
  async coverImages(hotelIds: Types.ObjectId[]): Promise<Map<string, ImageDto | null>> {
    const hotels = await HotelModel.find(
      { _id: { $in: hotelIds } },
      { coverImageId: 1, images: { $slice: 1 }, name: 1 },
    ).lean<HotelRecord[]>();
    const assets = imageMap(
      await this.deps.media.findImages(
        hotels.flatMap((h) =>
          h.coverImageId ? [h.coverImageId] : h.images.slice(0, 1).map((i) => i.mediaId),
        ),
      ),
    );
    return new Map(hotels.map((h) => [h._id.toString(), coverImage(h, assets)]));
  }

  async loadContext(booking: BookingRecord, session?: ClientSession) {
    const opt = session ? { session } : {};
    const [hold, payments, refunds, cancellation] = await Promise.all([
      BookingHoldModel.findById(booking.holdId, null, opt).lean<BookingHoldRecord>(),
      PaymentModel.find({ bookingId: booking._id }, null, opt)
        .sort({ createdAt: 1 })
        .lean<PaymentRecord[]>(),
      RefundModel.find({ bookingId: booking._id }, null, opt)
        .sort({ requestedAt: 1 })
        .lean<RefundRecord[]>(),
      CancellationModel.findOne({ bookingId: booking._id }, null, opt).lean<CancellationRecord>(),
    ]);
    return { hold, payments, refunds, cancellation };
  }

  async toDetail(booking: BookingRecord): Promise<BookingDetailDto> {
    const [context, covers] = await Promise.all([
      this.loadContext(booking),
      this.coverImages([booking.hotelId]),
    ]);
    return toDetailDto(booking, {
      ...context,
      coverImage: covers.get(booking.hotelId.toString()) ?? null,
    });
  }

  /** Ownership is part of the query: another customer's reference is indistinguishable from a missing one. */
  async findOwned(customerId: string, reference: string): Promise<BookingRecord> {
    const booking = await BookingModel.findOne({
      bookingReference: reference,
      customerId,
    }).lean<BookingRecord>();
    if (!booking) throw Errors.notFound('Booking');
    return booking;
  }

  // ------------------------------------------------------------------ holds
  private async holdDto(hold: BookingHoldRecord): Promise<HoldDto> {
    const [covers, booking] = await Promise.all([
      this.coverImages([hold.hotelId]),
      hold.bookingId
        ? BookingModel.findById(hold.bookingId, { bookingReference: 1 }).lean<
            Pick<BookingRecord, 'bookingReference'>
          >()
        : null,
    ]);
    return toHoldDto(
      hold,
      booking?.bookingReference ?? null,
      covers.get(hold.hotelId.toString()) ?? null,
    );
  }

  /**
   * Reserve rooms for every night of the stay (check-in … day before check-out) and return a hold.
   * The price is recalculated server-side here; nothing the client sends about price is used.
   */
  async createHold(
    auth: AuthContext,
    input: CreateHoldInput,
    idempotencyKey: string,
    context: RequestContext,
  ): Promise<HoldDto> {
    const requestHash = requestFingerprint(input);
    const replay = await BookingHoldModel.findOne({
      customerId: auth.userId,
      idempotencyKey,
    }).lean<BookingHoldRecord>();
    if (replay) {
      assertSameRequest(replay.requestHash, requestHash);
      return this.holdDto(replay);
    }
    const live = await BookingHoldModel.countDocuments({
      customerId: auth.userId,
      status: 'ACTIVE',
      bookingId: null,
      expiresAt: { $gt: new Date() },
    });
    if (live >= MAX_ACTIVE_HOLDS)
      throw new AppError(
        409,
        'CONFLICT',
        'You already have rooms on hold. Complete or release them before holding more.',
      );

    const item = input.items[0]!;
    // Validates publication, room/rate status, dates, capacity, restrictions and availability, and prices the stay.
    const quote = await this.deps.quotes.quote({
      hotelId: input.hotelId,
      roomTypeId: item.roomTypeId,
      ratePlanId: item.ratePlanId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      adults: item.adults,
      children: item.childrenAges.length,
      childrenAges: item.childrenAges,
      rooms: item.rooms,
      extraBeds: item.extraBeds,
    });
    const [hotel, roomType, ratePlan] = await Promise.all([
      HotelModel.findOne({
        _id: input.hotelId,
        publicationStatus: 'PUBLISHED',
      }).lean<HotelRecord>(),
      RoomTypeModel.findOne({
        _id: item.roomTypeId,
        hotelId: input.hotelId,
        status: 'ACTIVE',
      }).lean<RoomTypeRecord>(),
      RatePlanModel.findOne({
        _id: item.ratePlanId,
        hotelId: input.hotelId,
        roomTypeId: item.roomTypeId,
        active: true,
      }).lean<RatePlanRecord>(),
    ]);
    if (!hotel || !roomType || !ratePlan) throw Errors.notFound('Room or rate');

    const nights = stayNights(input.checkIn, input.checkOut);
    const currency = quote.currency as CurrencyCode;
    const fmt = (minor: number) => formatMinorUnits(minor, currency);
    const price = { currency, taxes: quote.taxes, fees: quote.fees, totals: quote.totals };
    const snapshot: BookingItemSnapshot = {
      roomTypeId: roomType._id,
      roomTypeName: roomType.name,
      ratePlanId: ratePlan._id,
      ratePlanName: ratePlan.name,
      mealPlan: ratePlan.mealPlan,
      rooms: item.rooms,
      adults: item.adults,
      children: item.childrenAges.length,
      childrenAges: item.childrenAges,
      extraBeds: item.extraBeds,
      nightly: quote.nightly,
      price,
      cancellationPolicy: snapshotPolicy(
        ratePlan.cancellationPolicy,
        {
          checkInLocalDate: input.checkIn,
          checkInTime: hotel.checkInTime,
          timeZone: hotel.timeZone,
        },
        fmt,
      ),
      nights,
    };

    let hold: BookingHoldRecord;
    try {
      hold = await withTransaction(async (session) => {
        // All nights or none: a single conditional update across the stay, inside the transaction.
        await this.deps.inventory.reserveHeld(roomType, nights, item.rooms, session);
        // Coupon (optional): validated and its use reserved atomically in the same transaction.
        const holdId = new Types.ObjectId();
        let finalPrice: typeof price & { coupon?: { code: string; discountMinor: number } | null } = price;
        if (input.couponCode) {
          const applied = await this.deps.coupons.reserve(
            input.couponCode,
            { userId: auth.userId, hotelId: hotel._id.toString(), city: hotel.city, currency, subtotalMinor: quote.totals.subtotalMinor, totalMinor: quote.totals.totalMinor, hasRateDiscounts: quote.totals.discountsMinor !== 0 },
            holdId,
            session,
          );
          finalPrice = { ...price, coupon: applied, totals: { ...price.totals, totalMinor: price.totals.totalMinor - applied.discountMinor } };
        }
        const [doc] = await BookingHoldModel.create(
          [
            {
              _id: holdId,
              holdReference: newHoldReference(),
              customerId: new Types.ObjectId(auth.userId),
              hotelId: hotel._id,
              items: [snapshot],
              startDate: input.checkIn,
              endDate: input.checkOut,
              propertyTimezone: hotel.timeZone,
              price: finalPrice,
              hotelSnapshot: hotelSnapshot(hotel),
              expiresAt: new Date(Date.now() + this.deps.config.BOOKING_HOLD_TTL_MINUTES * 60_000),
              status: 'ACTIVE',
              idempotencyKey,
              requestHash,
            },
          ],
          { session },
        );
        return doc!.toObject() as BookingHoldRecord;
      });
    } catch (error) {
      if (isMongoDuplicateKey(error)) {
        const existing = await BookingHoldModel.findOne({
          customerId: auth.userId,
          idempotencyKey,
        }).lean<BookingHoldRecord>();
        if (existing) {
          assertSameRequest(existing.requestHash, requestHash);
          return this.holdDto(existing);
        }
      }
      if (error instanceof InventoryConflictError) {
        throw new AppError(
          409,
          'INVENTORY_UNAVAILABLE',
          'Those rooms were just taken for at least one night. Please choose another room or dates.',
        );
      }
      throw error;
    }
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'hold.created',
      entityType: 'BookingHold',
      entityId: hold._id.toString(),
      metadata: { hotelId: input.hotelId, nights: nights.length, rooms: item.rooms },
      context,
    });
    return this.holdDto(hold);
  }

  async getHold(auth: AuthContext, reference: string): Promise<HoldDto> {
    const hold = await BookingHoldModel.findOne({
      holdReference: reference,
      customerId: auth.userId,
    }).lean<BookingHoldRecord>();
    if (!hold) throw Errors.notFound('Hold');
    return this.holdDto(hold);
  }

  /** The customer abandons a hold before booking. Releases the rooms exactly once. */
  async releaseHold(auth: AuthContext, reference: string): Promise<HoldDto> {
    const hold = await BookingHoldModel.findOne({
      holdReference: reference,
      customerId: auth.userId,
    }).lean<BookingHoldRecord>();
    if (!hold) throw Errors.notFound('Hold');
    if (hold.bookingId)
      throw new AppError(
        409,
        'INVALID_STATE',
        'This hold belongs to a booking. Cancel the booking instead.',
      );
    await this.transitionHold(hold._id, 'RELEASED');
    return this.holdDto((await BookingHoldModel.findById(hold._id).lean<BookingHoldRecord>())!);
  }

  /**
   * ACTIVE → RELEASED | EXPIRED, releasing held inventory in the same transaction. The conditional
   * status update is the guard: whoever transitions the hold first releases inventory; every other
   * caller (retries, a concurrent worker, a late payment) finds it already transitioned.
   */
  async transitionHold(
    holdId: Types.ObjectId,
    to: 'RELEASED' | 'EXPIRED',
    session?: ClientSession,
  ): Promise<BookingHoldRecord | null> {
    const work = async (s: ClientSession) => {
      const stamp = to === 'RELEASED' ? { releasedAt: new Date() } : { expiredAt: new Date() };
      const hold = await BookingHoldModel.findOneAndUpdate(
        { _id: holdId, status: 'ACTIVE' },
        { $set: { status: to, ...stamp } },
        { session: s, new: true },
      ).lean<BookingHoldRecord>();
      if (!hold) return null;
      for (const item of hold.items)
        await this.deps.inventory.releaseHeld(item.roomTypeId, item.nights, item.rooms, s);
      await this.deps.coupons.release(hold._id, s);
      return hold;
    };
    return session ? work(session) : withTransaction(work);
  }

  /**
   * Hold-expiry worker. Finds ACTIVE holds past expiry and, per hold, atomically marks it EXPIRED,
   * releases its rooms once, and expires an unpaid booking. Safe to run repeatedly and concurrently,
   * and resumes correctly after a restart (state lives only in MongoDB).
   */
  async expireHolds(now = new Date(), limit = 200): Promise<number> {
    const due = await BookingHoldModel.find(
      { status: 'ACTIVE', expiresAt: { $lte: now } },
      { _id: 1 },
    )
      .sort({ expiresAt: 1 })
      .limit(limit)
      .lean<Array<{ _id: Types.ObjectId }>>();
    let expired = 0;
    for (const { _id } of due) {
      try {
        const done = await withTransaction(async (session) => {
          const hold = await this.transitionHold(_id, 'EXPIRED', session);
          if (!hold) return false;
          if (hold.bookingId) {
            const booking = await BookingModel.findOneAndUpdate(
              {
                _id: hold.bookingId,
                bookingStatus: { $in: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING'] },
              },
              {
                $set: { bookingStatus: 'EXPIRED', expiredAt: now },
                $push: {
                  statusHistory: statusEvent('EXPIRED', 'Payment was not completed in time'),
                },
              },
              { session, new: true },
            ).lean<BookingRecord>();
            if (booking) {
              await this.deps.outbox.add(
                {
                  eventId: `booking.expired.${booking._id}`,
                  type: 'booking.expired',
                  aggregateType: 'Booking',
                  aggregateId: booking._id.toString(),
                  payload: {},
                },
                session,
              );
            }
          }
          return true;
        });
        if (done) expired += 1;
      } catch (error) {
        this.deps.logger.error(
          { err: (error as Error).message, holdId: _id.toString() },
          'Failed to expire hold; will retry',
        );
      }
    }
    if (expired) await this.deps.outbox.kick();
    return expired;
  }

  // ------------------------------------------------------------------ bookings
  /**
   * Turn a live hold into a booking awaiting payment. Idempotent three ways: the Idempotency-Key,
   * one booking per hold (unique index), and the conditional hold update.
   */
  async createBooking(
    auth: AuthContext,
    input: CreateBookingInput,
    idempotencyKey: string,
    context: RequestContext,
  ): Promise<BookingDetailDto> {
    const requestHash = requestFingerprint(input);
    const replay = await BookingModel.findOne({
      customerId: auth.userId,
      idempotencyKey,
    }).lean<BookingRecord>();
    if (replay) {
      assertSameRequest(replay.requestHash, requestHash);
      return this.toDetail(replay);
    }
    const hold = await BookingHoldModel.findOne({
      holdReference: input.holdReference,
      customerId: auth.userId,
    }).lean<BookingHoldRecord>();
    if (!hold) throw Errors.notFound('Hold');
    if (hold.bookingId) {
      const existing = await BookingModel.findOne({
        _id: hold.bookingId,
        customerId: auth.userId,
      }).lean<BookingRecord>();
      if (existing) return this.toDetail(existing);
    }
    if (hold.status !== 'ACTIVE' || hold.expiresAt <= new Date()) {
      throw new AppError(
        409,
        'HOLD_EXPIRED',
        'Your room hold has expired. Check availability again to continue.',
      );
    }
    const hotel = await HotelModel.findById(hold.hotelId, { partnerId: 1 }).lean<
      Pick<HotelRecord, 'partnerId'>
    >();
    if (!hotel) throw Errors.notFound('Property');

    const bookingId = new Types.ObjectId();
    const reference = newBookingReference();
    let booking: BookingRecord;
    try {
      booking = await withTransaction(async (session) => {
        const claimed = await BookingHoldModel.findOneAndUpdate(
          { _id: hold._id, status: 'ACTIVE', bookingId: null, expiresAt: { $gt: new Date() } },
          { $set: { bookingId } },
          { session, new: true },
        ).lean<BookingHoldRecord>();
        if (!claimed)
          throw new AppError(
            409,
            'HOLD_EXPIRED',
            'Your room hold has expired or was already used.',
          );
        const totalGuests = claimed.items.reduce((s, i) => s + i.adults + i.children, 0);
        const [doc] = await BookingModel.create(
          [
            {
              _id: bookingId,
              bookingReference: reference,
              customerId: claimed.customerId,
              hotelId: claimed.hotelId,
              partnerId: hotel.partnerId,
              bookingItems: claimed.items,
              guestDetails: input.guestDetails,
              checkInLocalDate: claimed.startDate,
              checkOutLocalDate: claimed.endDate,
              propertyTimezone: claimed.propertyTimezone,
              numberOfNights: claimed.items[0]!.nights.length,
              totalRooms: claimed.items.reduce((s, i) => s + i.rooms, 0),
              totalGuests,
              priceSnapshot: claimed.price,
              cancellationPolicySnapshot: claimed.items.map((i) => i.cancellationPolicy),
              hotelSnapshot: claimed.hotelSnapshot,
              bookingStatus: 'PENDING_PAYMENT',
              paymentStatus: 'INITIATED',
              holdId: claimed._id,
              idempotencyKey,
              requestHash,
              statusHistory: [statusEvent('PENDING_PAYMENT', 'Booking created — awaiting payment')],
            },
          ],
          { session },
        );
        await this.deps.outbox.add(
          {
            eventId: `booking.created.${bookingId}`,
            type: 'booking.created',
            aggregateType: 'Booking',
            aggregateId: bookingId.toString(),
            payload: {},
          },
          session,
        );
        return doc!.toObject() as BookingRecord;
      });
    } catch (error) {
      // Lost a race with a concurrent request for the same hold or key: return the winner's booking.
      if (
        isMongoDuplicateKey(error) ||
        (error instanceof AppError && error.code === 'HOLD_EXPIRED')
      ) {
        const existing = await BookingModel.findOne({
          customerId: auth.userId,
          $or: [{ idempotencyKey }, { holdId: hold._id }],
        }).lean<BookingRecord>();
        if (existing) {
          if (existing.idempotencyKey === idempotencyKey)
            assertSameRequest(existing.requestHash, requestHash);
          return this.toDetail(existing);
        }
      }
      throw error;
    }
    await this.deps.outbox.kick();
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'booking.created',
      entityType: 'Booking',
      entityId: booking._id.toString(),
      metadata: { reference },
      context,
    });
    return this.toDetail(booking);
  }

  async detail(auth: AuthContext, reference: string): Promise<BookingDetailDto> {
    return this.toDetail(await this.findOwned(auth.userId, reference));
  }

  private viewFilter(view: ListBookingsQuery['view']): Record<string, unknown> {
    const today = todayInTimeZone('UTC');
    switch (view) {
      case 'upcoming':
        return {
          bookingStatus: { $in: ['CONFIRMED', 'CHECKED_IN'] },
          checkOutLocalDate: { $gte: today },
        };
      case 'past':
        return {
          $or: [
            { bookingStatus: { $in: ['COMPLETED', 'CHECKED_OUT'] } },
            { bookingStatus: 'CONFIRMED', checkOutLocalDate: { $lt: today } },
          ],
        };
      case 'cancelled':
        return { bookingStatus: { $in: ['CANCELLED', 'REJECTED', 'EXPIRED'] } };
      case 'pending':
        return {
          bookingStatus: {
            $in: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'RECONCILIATION_REQUIRED'],
          },
        };
      default:
        return {};
    }
  }

  async summaries(bookings: BookingRecord[]): Promise<BookingSummaryDto[]> {
    if (bookings.length === 0) return [];
    const ids = bookings.map((b) => b._id);
    const [holds, payments, refunds, covers] = await Promise.all([
      BookingHoldModel.find({ _id: { $in: bookings.map((b) => b.holdId) } }).lean<
        BookingHoldRecord[]
      >(),
      PaymentModel.find({ bookingId: { $in: ids } }).lean<PaymentRecord[]>(),
      RefundModel.find({ bookingId: { $in: ids } }).lean<RefundRecord[]>(),
      this.coverImages(
        [...new Set(bookings.map((b) => b.hotelId.toString()))].map((id) => new Types.ObjectId(id)),
      ),
    ]);
    return bookings.map((b) =>
      toSummaryDto(b, {
        hold: holds.find((h) => h._id.equals(b.holdId)) ?? null,
        payments: payments.filter((p) => p.bookingId.equals(b._id)),
        refunds: refunds.filter((r) => r.bookingId.equals(b._id)),
        coverImage: covers.get(b.hotelId.toString()) ?? null,
      }),
    );
  }

  async list(auth: AuthContext, query: ListBookingsQuery): Promise<Paginated<BookingSummaryDto>> {
    const filter: Record<string, unknown> = {
      customerId: new Types.ObjectId(auth.userId),
      ...this.viewFilter(query.view),
    };
    if (query.status) filter.bookingStatus = query.status;
    if (query.q) {
      const pattern = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$and = [
        {
          $or: [
            { bookingReference: pattern },
            { 'hotelSnapshot.name': pattern },
            { 'hotelSnapshot.city': pattern },
          ],
        },
      ];
    }
    const sort: Record<string, 1 | -1> =
      query.view === 'upcoming' ? { checkInLocalDate: 1, _id: 1 } : { createdAt: -1, _id: -1 };
    const [items, total] = await Promise.all([
      BookingModel.find(filter)
        .sort(sort)
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<BookingRecord[]>(),
      BookingModel.countDocuments(filter),
    ]);
    return paginated(await this.summaries(items), query.page, query.limit, total);
  }
}
