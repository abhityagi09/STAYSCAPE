import type { OperationsOverviewDto, RefundDto } from '@stayscape/shared';
import { AppError, Errors } from '@/lib/errors';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import { toRefundDto } from '@/modules/bookings/booking.mapper';
import { BookingModel, type BookingRecord } from '@/modules/bookings/booking.models';
import type { BookingNotificationsService } from '@/modules/notifications/booking-notifications.service';
import type { OutboxService } from '@/modules/outbox/outbox.service';
import type { ReviewsService } from '@/modules/reviews/reviews.service';
import { UserModel } from '@/modules/users/user.model';
import { PaymentModel, RefundModel, type PaymentRecord, type RefundRecord } from './payment.models';
import { PAID_FAMILY } from './payment-status';
import type { RefundsService } from './refunds.service';

/** Initial operations surface for payments, refunds, notifications and review moderation. */
export class OperationsService {
  constructor(
    private readonly deps: {
      refunds: RefundsService;
      notifications: BookingNotificationsService;
      reviews: ReviewsService;
      outbox: OutboxService;
      audit: AuditService;
    },
  ) {}

  private async refundDtos(refunds: RefundRecord[]): Promise<RefundDto[]> {
    const bookings = await BookingModel.find(
      { _id: { $in: refunds.map((r) => r.bookingId) } },
      { bookingReference: 1, hotelSnapshot: 1 },
    ).lean<BookingRecord[]>();
    return refunds.flatMap((r) => {
      const b = bookings.find((x) => x._id.equals(r.bookingId));
      return b ? [toRefundDto(r, b)] : [];
    });
  }

  async overview(): Promise<OperationsOverviewDto> {
    const [reconciliation, refunds, requested, failedDeliveries, flaggedReviews, outbox] =
      await Promise.all([
        BookingModel.find({ bookingStatus: 'RECONCILIATION_REQUIRED' })
          .sort({ updatedAt: -1 })
          .limit(50)
          .lean<BookingRecord[]>(),
        RefundModel.find({ status: { $in: ['FAILED', 'PROCESSING', 'APPROVED'] } })
          .sort({ updatedAt: -1 })
          .limit(50)
          .lean<RefundRecord[]>(),
        RefundModel.find({ status: 'REQUESTED' })
          .sort({ requestedAt: 1 })
          .limit(50)
          .lean<RefundRecord[]>(),
        this.deps.notifications.failedDeliveries(),
        this.deps.reviews.adminList('FLAGGED'),
        this.deps.outbox.stats(),
      ]);
    const customers = await UserModel.find(
      { _id: { $in: reconciliation.map((b) => b.customerId) } },
      { email: 1 },
    ).lean<Array<{ _id: unknown; email: string }>>();
    return {
      reconciliation: reconciliation.map((b) => ({
        reference: b.bookingReference,
        status: b.bookingStatus,
        paymentStatus: b.paymentStatus,
        hotelName: b.hotelSnapshot.name,
        customerEmail:
          customers.find((c) => String(c._id) === b.customerId.toString())?.email ?? '',
        totalMinor: b.priceSnapshot.totals.totalMinor,
        currency: b.priceSnapshot.currency,
        note: b.reconciliationNote,
        updatedAt: b.updatedAt.toISOString(),
      })),
      refunds: await this.refundDtos(refunds),
      pendingRefundRequests: await this.refundDtos(requested),
      failedDeliveries,
      flaggedReviews,
      outbox,
    };
  }

  /** Goodwill or corrective refund by an administrator (partial or full), idempotent per key. */
  async refundBooking(
    adminId: string,
    reference: string,
    input: { amountMinor: number; reason: string },
    idempotencyKey: string,
    context: RequestContext,
  ): Promise<RefundDto> {
    const booking = await BookingModel.findOne({
      bookingReference: reference,
    }).lean<BookingRecord>();
    if (!booking) throw Errors.notFound('Booking');
    const payment = await PaymentModel.findOne({
      bookingId: booking._id,
      status: { $in: PAID_FAMILY },
    })
      .sort({ createdAt: 1 })
      .lean<PaymentRecord>();
    if (!payment) throw new AppError(409, 'NOT_ELIGIBLE', 'This booking has no captured payment.');
    const refund = await withTransaction((session) =>
      this.deps.refunds.createApproved(
        {
          booking,
          payment,
          amountMinor: input.amountMinor,
          reason: input.reason,
          source: 'ADMIN',
          idempotencyKey: `admin.${booking._id}.${idempotencyKey}`,
          requestedBy: adminId,
          decidedBy: adminId,
        },
        session,
      ),
    );
    await this.deps.outbox.kick();
    await this.deps.audit.record({
      actorId: adminId,
      action: 'refund.admin_created',
      entityType: 'Refund',
      entityId: refund._id.toString(),
      metadata: { reference, amountMinor: input.amountMinor, reason: input.reason },
      context,
    });
    const fresh = (await RefundModel.findById(refund._id).lean<RefundRecord>())!;
    return toRefundDto(fresh, booking);
  }
}
