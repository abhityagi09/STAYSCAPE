import { Types, type ClientSession } from 'mongoose';
import {
  CUSTOMER_CANCELLABLE_STATUSES,
  todayInTimeZone,
  type CancellationQuoteDto,
  type CancellationReason,
  type CancellationResultDto,
  type Paginated,
  type PartnerBookingDto,
  type StaffPermission,
} from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import type { InventoryService } from '@/modules/inventory/inventory.service';
import type { OutboxService } from '@/modules/outbox/outbox.service';
import type { PartnerAccessService } from '@/modules/partners/partner-access.service';
import { PaymentModel, type PaymentRecord } from '@/modules/payments/payment.models';
import { PAID_FAMILY, syncBookingPaymentStatus } from '@/modules/payments/payment-status';
import type { RefundsService } from '@/modules/payments/refunds.service';
import type { AuthContext } from '@/types/express';
import { roomSummary, toRefundDto } from './booking.mapper';
import {
  BookingModel,
  CancellationModel,
  type BookingRecord,
  type CancellationRecord,
} from './booking.models';
import { statusEvent, type BookingsService } from './bookings.service';
import {
  checkInInstant,
  evaluateCancellation,
  type CancellationOutcome,
} from './cancellation-policy';

interface Deps {
  bookings: BookingsService;
  inventory: InventoryService;
  refunds: RefundsService;
  outbox: OutboxService;
  audit: AuditService;
  access: PartnerAccessService;
}

type Mode = 'CUSTOMER' | 'NO_SHOW' | 'PROPERTY_REJECT';

export interface PartnerBookingsQuery {
  page: number;
  limit: number;
  view: 'arrivals' | 'departures' | 'in-house' | 'upcoming' | 'past' | 'all';
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  q?: string | undefined;
}

export class CancellationsService {
  constructor(private readonly deps: Deps) {}

  private async primaryPayment(
    bookingId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<PaymentRecord | null> {
    return PaymentModel.findOne(
      { bookingId, status: { $in: PAID_FAMILY } },
      null,
      session ? { session } : {},
    )
      .sort({ createdAt: 1 })
      .lean<PaymentRecord>();
  }

  /** Charge/refund for a booking, summed over items, using each item's snapshotted policy. */
  private evaluate(
    booking: BookingRecord,
    paidMinor: number,
    mode: Mode,
    now: Date,
  ): CancellationOutcome {
    const stay = {
      checkInLocalDate: booking.checkInLocalDate,
      checkInTime: booking.hotelSnapshot.checkInTime,
      timeZone: booking.propertyTimezone,
    };
    if (mode === 'PROPERTY_REJECT') {
      // The property cannot honour the booking: the guest is never charged.
      return {
        eligible: true,
        reason: null,
        beforeFreeCancellationDeadline: true,
        freeCancellationDeadline: null,
        chargeMinor: 0,
        refundMinor: paidMinor,
      };
    }
    const total = booking.priceSnapshot.totals.totalMinor;
    const outcomes = booking.bookingItems.map((item) => {
      // Each item's share of what was actually paid (exact for single-item bookings).
      const share =
        booking.bookingItems.length === 1
          ? paidMinor
          : Math.floor((paidMinor * item.price.totals.totalMinor) / total);
      return evaluateCancellation({
        policy: item.cancellationPolicy,
        stay,
        paidMinor: share,
        now,
        mode: mode === 'NO_SHOW' ? 'NO_SHOW' : 'CUSTOMER',
      });
    });
    const first = outcomes[0]!;
    const ineligible = outcomes.find((o) => !o.eligible);
    if (ineligible) return ineligible;
    const refund = Math.min(
      paidMinor,
      outcomes.reduce((s, o) => s + o.refundMinor, 0),
    );
    return { ...first, chargeMinor: paidMinor - refund, refundMinor: refund };
  }

  async quote(
    auth: AuthContext,
    reference: string,
    now = new Date(),
  ): Promise<CancellationQuoteDto> {
    const booking = await this.deps.bookings.findOwned(auth.userId, reference);
    const payment = await this.primaryPayment(booking._id);
    const paid = payment?.amountMinor ?? 0;
    const policySummary = booking.cancellationPolicySnapshot.map((p) => p.summary).join(' ');
    const base = { paidMinor: paid, currency: booking.priceSnapshot.currency, policySummary };
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(booking.bookingStatus)) {
      return {
        ...base,
        eligible: false,
        reason: `A ${booking.bookingStatus.toLowerCase().replace('_', ' ')} booking cannot be cancelled.`,
        beforeFreeCancellationDeadline: false,
        freeCancellationDeadline: null,
        chargeMinor: 0,
        refundableMinor: 0,
      };
    }
    const outcome = this.evaluate(booking, paid, 'CUSTOMER', now);
    const balance = payment ? await this.deps.refunds.balance(payment) : 0;
    return {
      ...base,
      eligible: outcome.eligible,
      reason: outcome.reason,
      beforeFreeCancellationDeadline: outcome.beforeFreeCancellationDeadline,
      freeCancellationDeadline: outcome.freeCancellationDeadline?.toISOString() ?? null,
      chargeMinor: outcome.chargeMinor,
      refundableMinor: Math.min(outcome.refundMinor, balance),
    };
  }

  /**
   * Cancel a booking. One transaction: status change, inventory release (held or booked), the
   * cancellation record (unique per booking), and an approved refund for the refundable amount.
   */
  private async execute(
    booking: BookingRecord,
    params: {
      mode: Mode;
      reason: CancellationReason;
      note: string;
      actorId: string | null;
      actorRole: 'CUSTOMER' | 'PROPERTY' | 'SYSTEM' | 'ADMIN';
      allowedFrom: string[];
      now: Date;
    },
  ): Promise<{ cancellation: CancellationRecord; alreadyCancelled: boolean }> {
    const existing = await CancellationModel.findOne({
      bookingId: booking._id,
    }).lean<CancellationRecord>();
    if (existing) return { cancellation: existing, alreadyCancelled: true };
    if (!params.allowedFrom.includes(booking.bookingStatus)) {
      throw new AppError(
        409,
        'INVALID_STATE',
        `This booking is ${booking.bookingStatus.toLowerCase().replace(/_/g, ' ')} and cannot be cancelled.`,
      );
    }
    try {
      const cancellation = await withTransaction(async (session) => {
        const payment = await this.primaryPayment(booking._id, session);
        const paid = payment?.amountMinor ?? 0;
        const outcome = this.evaluate(booking, paid, params.mode, params.now);
        if (!outcome.eligible)
          throw new AppError(
            409,
            'NOT_ELIGIBLE',
            outcome.reason ?? 'This booking can no longer be cancelled online.',
          );
        const refundable = payment
          ? Math.min(outcome.refundMinor, await this.deps.refunds.balance(payment, session))
          : 0;
        const nextStatus = params.mode === 'PROPERTY_REJECT' ? 'REJECTED' : 'CANCELLED';
        const updated = await BookingModel.findOneAndUpdate(
          { _id: booking._id, bookingStatus: { $in: params.allowedFrom } },
          {
            $set: { bookingStatus: nextStatus, cancelledAt: params.now },
            $push: {
              statusHistory: statusEvent(
                nextStatus,
                params.mode === 'NO_SHOW'
                  ? 'Recorded as a no-show by the property'
                  : params.mode === 'PROPERTY_REJECT'
                    ? 'Declined by the property'
                    : 'Cancelled by the guest',
              ),
            },
          },
          { session, new: true },
        ).lean<BookingRecord>();
        if (!updated)
          throw new AppError(
            409,
            'INVALID_STATE',
            'The booking changed while cancelling. Please refresh.',
          );

        // Inventory: an unpaid booking still holds rooms; a confirmed one has booked them.
        if (
          booking.bookingStatus === 'PENDING_PAYMENT' ||
          booking.bookingStatus === 'PAYMENT_PROCESSING'
        ) {
          await this.deps.bookings.transitionHold(booking.holdId, 'RELEASED', session);
        } else {
          const today = todayInTimeZone(booking.propertyTimezone, params.now);
          for (const item of booking.bookingItems) {
            // A no-show frees tonight and later nights for resale; earlier nights are history.
            const nights =
              params.mode === 'NO_SHOW' ? item.nights.filter((n) => n >= today) : item.nights;
            if (nights.length)
              await this.deps.inventory.releaseBooked(item.roomTypeId, nights, item.rooms, session);
          }
        }

        const [record] = await CancellationModel.create(
          [
            {
              bookingId: booking._id,
              requestedBy: params.actorId ? new Types.ObjectId(params.actorId) : null,
              requestedByRole: params.actorRole,
              reason: params.reason,
              note: params.note,
              policySnapshot: booking.cancellationPolicySnapshot,
              paidMinor: paid,
              cancellationChargeMinor: paid - outcome.refundMinor,
              refundableAmountMinor: refundable,
              currency: booking.priceSnapshot.currency,
              status: refundable > 0 ? 'REFUND_PENDING' : 'COMPLETED',
            },
          ],
          { session },
        );
        let cancellation = record!.toObject() as CancellationRecord;
        if (payment && refundable > 0) {
          const refund = await this.deps.refunds.createApproved(
            {
              booking,
              payment,
              amountMinor: refundable,
              reason: `Cancellation (${params.reason.toLowerCase().replace(/_/g, ' ')})`,
              source: 'CANCELLATION',
              idempotencyKey: `cancellation.${booking._id}`,
              requestedBy: params.actorId,
              decidedBy: null,
            },
            session,
          );
          await CancellationModel.updateOne(
            { _id: cancellation._id },
            { $set: { refundId: refund._id } },
            { session },
          );
          cancellation = { ...cancellation, refundId: refund._id };
        }
        await syncBookingPaymentStatus(booking._id, session);
        await this.deps.outbox.add(
          {
            eventId: `booking.cancelled.${booking._id}`,
            type: 'booking.cancelled',
            aggregateType: 'Booking',
            aggregateId: booking._id.toString(),
            payload: { mode: params.mode },
          },
          session,
        );
        return cancellation;
      });
      await this.deps.outbox.kick();
      return { cancellation, alreadyCancelled: false };
    } catch (error) {
      // A concurrent duplicate request lost the race (unique index or conditional status update):
      // report the winner's cancellation instead of an error.
      const winner = await CancellationModel.findOne({
        bookingId: booking._id,
      }).lean<CancellationRecord>();
      if (winner) return { cancellation: winner, alreadyCancelled: true };
      throw error;
    }
  }

  private async result(
    booking: BookingRecord,
    cancellation: CancellationRecord,
    alreadyCancelled: boolean,
  ): Promise<CancellationResultDto> {
    const detail = await this.deps.bookings.toDetail(
      (await BookingModel.findById(booking._id).lean<BookingRecord>())!,
    );
    const refund = cancellation.refundId
      ? (detail.refunds.find((r) => r.id === cancellation.refundId!.toString()) ?? null)
      : null;
    return {
      booking: detail,
      chargeMinor: cancellation.cancellationChargeMinor,
      refundableMinor: cancellation.refundableAmountMinor,
      refund,
      alreadyCancelled,
    };
  }

  async cancel(
    auth: AuthContext,
    reference: string,
    note: string,
    context: RequestContext,
  ): Promise<CancellationResultDto> {
    const booking = await this.deps.bookings.findOwned(auth.userId, reference);
    const { cancellation, alreadyCancelled } = await this.execute(booking, {
      mode: 'CUSTOMER',
      reason: 'CUSTOMER_REQUEST',
      note,
      actorId: auth.userId,
      actorRole: 'CUSTOMER',
      allowedFrom: [...CUSTOMER_CANCELLABLE_STATUSES],
      now: new Date(),
    });
    if (!alreadyCancelled)
      await this.deps.audit.record({
        actorId: auth.userId,
        action: 'booking.cancelled',
        entityType: 'Booking',
        entityId: booking._id.toString(),
        metadata: {
          charge: cancellation.cancellationChargeMinor,
          refund: cancellation.refundableAmountMinor,
        },
        context,
      });
    return this.result(booking, cancellation, alreadyCancelled);
  }

  /** Customer asks for a refund on a cancelled booking beyond what the policy gave. Admin decides. */
  async requestRefund(auth: AuthContext, reference: string, reason: string) {
    const booking = await this.deps.bookings.findOwned(auth.userId, reference);
    if (booking.bookingStatus !== 'CANCELLED')
      throw new AppError(
        409,
        'NOT_ELIGIBLE',
        'Refund requests are available for cancelled bookings.',
      );
    const payment = await this.primaryPayment(booking._id);
    if (!payment) throw new AppError(409, 'NOT_ELIGIBLE', 'There is no payment on this booking.');
    const refund = await this.deps.refunds.request({
      booking,
      payment,
      reason,
      userId: auth.userId,
    });
    return toRefundDto(refund, booking);
  }

  // ------------------------------------------------------------------ property operations
  private async partnerBooking(
    auth: AuthContext,
    hotelId: string,
    reference: string,
    need: StaffPermission,
  ): Promise<BookingRecord> {
    await this.deps.access.resolveHotel(auth, hotelId, need);
    const booking = await BookingModel.findOne({
      bookingReference: reference,
      hotelId,
      // Unpaid holds and expired attempts are not the property's business.
      bookingStatus: { $nin: ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'EXPIRED'] },
    }).lean<BookingRecord>();
    if (!booking) throw Errors.notFound('Booking');
    return booking;
  }

  private toPartnerDto(b: BookingRecord, now = new Date()): PartnerBookingDto {
    const today = todayInTimeZone(b.propertyTimezone, now);
    const g = b.guestDetails.primaryGuest;
    return {
      reference: b.bookingReference,
      status: b.bookingStatus,
      paymentStatus: b.paymentStatus,
      guestName: `${g.firstName} ${g.lastName}`,
      guestEmail: g.email,
      guestPhone: g.phone,
      checkIn: b.checkInLocalDate,
      checkOut: b.checkOutLocalDate,
      nights: b.numberOfNights,
      rooms: b.totalRooms,
      guests: b.totalGuests,
      roomSummary: roomSummary(b.bookingItems),
      specialRequests: b.guestDetails.specialRequests,
      estimatedArrivalTime: b.guestDetails.estimatedArrivalTime,
      totalMinor: b.priceSnapshot.totals.totalMinor,
      currency: b.priceSnapshot.currency,
      createdAt: b.createdAt.toISOString(),
      actions: {
        canCheckIn:
          b.bookingStatus === 'CONFIRMED' &&
          today >= b.checkInLocalDate &&
          today < b.checkOutLocalDate,
        canCheckOut: b.bookingStatus === 'CHECKED_IN',
        canMarkNoShow: b.bookingStatus === 'CONFIRMED' && today >= b.checkInLocalDate,
      },
    };
  }

  /** Map reservations to the property-facing DTO (callers have already checked access). */
  listForPartnerByIds(bookings: BookingRecord[]): PartnerBookingDto[] {
    return bookings.map((b) => this.toPartnerDto(b));
  }

  /** Reservations for one property — only confirmed-or-later stays are shown (no unpaid holds). */
  async listForPartner(
    auth: AuthContext,
    hotelId: string,
    query: PartnerBookingsQuery,
  ): Promise<Paginated<PartnerBookingDto>> {
    const access = await this.deps.access.resolveHotel(auth, hotelId, 'bookings:view');
    const today = todayInTimeZone(access.hotel.timeZone);
    const filter: Record<string, unknown> = {
      hotelId: access.hotel._id,
      bookingStatus: {
        $in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED', 'CANCELLED', 'REJECTED'],
      },
    };
    if (query.view === 'arrivals')
      Object.assign(filter, {
        checkInLocalDate: today,
        bookingStatus: { $in: ['CONFIRMED', 'CHECKED_IN'] },
      });
    if (query.view === 'upcoming')
      Object.assign(filter, {
        checkOutLocalDate: { $gte: today },
        bookingStatus: { $in: ['CONFIRMED', 'CHECKED_IN'] },
      });
    if (query.view === 'past') Object.assign(filter, { checkOutLocalDate: { $lt: today } });
    if (query.view === 'in-house') Object.assign(filter, { bookingStatus: 'CHECKED_IN' });
    if (query.view === 'departures') Object.assign(filter, { checkOutLocalDate: today, bookingStatus: { $in: ['CHECKED_IN', 'CHECKED_OUT'] } });
    if (query.status) filter.bookingStatus = query.status;
    if (query.from || query.to) {
      filter.checkInLocalDate = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lte: query.to } : {}) };
    }
    if (query.q) {
      const pattern = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ bookingReference: pattern }, { 'guestDetails.primaryGuest.lastName': pattern }, { 'guestDetails.primaryGuest.firstName': pattern }];
    }
    const [items, total] = await Promise.all([
      BookingModel.find(filter)
        .sort({ checkInLocalDate: query.view === 'past' ? -1 : 1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean<BookingRecord[]>(),
      BookingModel.countDocuments(filter),
    ]);
    return paginated(
      items.map((b) => this.toPartnerDto(b)),
      query.page,
      query.limit,
      total,
    );
  }

  async checkIn(
    auth: AuthContext,
    hotelId: string,
    reference: string,
    context: RequestContext,
  ): Promise<PartnerBookingDto> {
    const booking = await this.partnerBooking(auth, hotelId, reference, 'bookings:check-in');
    if (!this.toPartnerDto(booking).actions.canCheckIn)
      throw new AppError(
        409,
        'INVALID_STATE',
        'Guests can be checked in on or after the arrival date of a confirmed booking.',
      );
    const updated = await BookingModel.findOneAndUpdate(
      { _id: booking._id, bookingStatus: 'CONFIRMED' },
      {
        $set: { bookingStatus: 'CHECKED_IN', checkedInAt: new Date(), checkedInBy: new Types.ObjectId(auth.userId) },
        $push: { statusHistory: statusEvent('CHECKED_IN', 'Guest checked in') },
      },
      { new: true },
    ).lean<BookingRecord>();
    if (!updated) throw new AppError(409, 'INVALID_STATE', 'The booking changed. Please refresh.');
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'booking.checked_in',
      entityType: 'Booking',
      entityId: booking._id.toString(),
      context,
    });
    return this.toPartnerDto(updated);
  }

  async checkOut(
    auth: AuthContext,
    hotelId: string,
    reference: string,
    context: RequestContext,
  ): Promise<PartnerBookingDto> {
    const booking = await this.partnerBooking(auth, hotelId, reference, 'bookings:check-out');
    const updated = await BookingModel.findOneAndUpdate(
      { _id: booking._id, bookingStatus: 'CHECKED_IN' },
      {
        $set: { bookingStatus: 'CHECKED_OUT', checkedOutAt: new Date(), checkedOutBy: new Types.ObjectId(auth.userId) },
        $push: { statusHistory: statusEvent('CHECKED_OUT', 'Guest checked out') },
      },
      { new: true },
    ).lean<BookingRecord>();
    if (!updated)
      throw new AppError(409, 'INVALID_STATE', 'Only checked-in guests can be checked out.');
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'booking.checked_out',
      entityType: 'Booking',
      entityId: booking._id.toString(),
      context,
    });
    return this.toPartnerDto(updated);
  }

  async markNoShow(
    auth: AuthContext,
    hotelId: string,
    reference: string,
    note: string,
    context: RequestContext,
  ): Promise<PartnerBookingDto> {
    const booking = await this.partnerBooking(auth, hotelId, reference, 'bookings:no-show');
    if (!this.toPartnerDto(booking).actions.canMarkNoShow)
      throw new AppError(
        409,
        'INVALID_STATE',
        'A no-show can be recorded from the arrival date of a confirmed booking.',
      );
    await this.execute(booking, {
      mode: 'NO_SHOW',
      reason: 'NO_SHOW',
      note,
      actorId: auth.userId,
      actorRole: 'PROPERTY',
      allowedFrom: ['CONFIRMED'],
      now: new Date(),
    });
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'booking.no_show',
      entityType: 'Booking',
      entityId: booking._id.toString(),
      context,
    });
    return this.toPartnerDto((await BookingModel.findById(booking._id).lean<BookingRecord>())!);
  }

  /** The property cannot honour a confirmed booking before arrival: decline with a full refund. */
  async reject(
    auth: AuthContext,
    hotelId: string,
    reference: string,
    reason: string,
    context: RequestContext,
  ): Promise<PartnerBookingDto> {
    const booking = await this.partnerBooking(auth, hotelId, reference, 'bookings:no-show');
    const stay = {
      checkInLocalDate: booking.checkInLocalDate,
      checkInTime: booking.hotelSnapshot.checkInTime,
      timeZone: booking.propertyTimezone,
    };
    if (new Date() >= checkInInstant(stay))
      throw new AppError(
        409,
        'INVALID_STATE',
        'Bookings can only be declined before the check-in time.',
      );
    await this.execute(booking, {
      mode: 'PROPERTY_REJECT',
      reason: 'PROPERTY_REJECTED',
      note: reason,
      actorId: auth.userId,
      actorRole: 'PROPERTY',
      allowedFrom: ['CONFIRMED'],
      now: new Date(),
    });
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'booking.rejected_by_property',
      entityType: 'Booking',
      entityId: booking._id.toString(),
      metadata: { reason },
      context,
    });
    return this.toPartnerDto((await BookingModel.findById(booking._id).lean<BookingRecord>())!);
  }
}
