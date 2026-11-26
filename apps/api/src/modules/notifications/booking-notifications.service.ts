import { Types } from 'mongoose';
import {
  formatMinorUnits,
  type CurrencyCode,
  type FailedDeliveryDto,
  type NotificationType,
} from '@stayscape/shared';
import type { Config } from '@/config/env';
import {
  renderBookingEmail,
  type BookingEmailData,
  type BookingEmailTemplate,
} from '@/infrastructure/mail/booking-templates';
import type { MailProvider } from '@/infrastructure/mail/mail.provider';
import { Errors } from '@/lib/errors';
import type { Logger } from '@/lib/logger';
import { roomSummary } from '@/modules/bookings/booking.mapper';
import {
  BookingModel,
  CancellationModel,
  type BookingRecord,
  type CancellationRecord,
} from '@/modules/bookings/booking.models';
import {
  NotificationDeliveryModel,
  OutboxEventModel,
  type NotificationDeliveryRecord,
  type OutboxEventRecord,
} from '@/modules/outbox/outbox.models';
import type { DomainEvent } from '@/modules/outbox/outbox.service';
import { RefundModel, type RefundRecord } from '@/modules/payments/payment.models';
import { ReviewModel, type ReviewRecord } from '@/modules/reviews/review.models';
import { UserModel } from '@/modules/users/user.model';
import { NotificationModel } from './notification.model';

interface Plan {
  inApp: { type: NotificationType; title: string; body: string };
  email: BookingEmailTemplate | null;
  /** Reminders respect the "booking updates" email preference; transactional receipts always send. */
  optional: boolean;
  link: string;
  extra?: Record<string, string>;
  ops?: { alert: string; detail: string };
}

interface Recipient {
  _id: Types.ObjectId;
  email: string;
  firstName: string;
  roles: string[];
  preferences?: { notifications?: { emailBookingUpdates?: boolean } };
}

/**
 * Turns domain events into in-app notifications and emails.
 *  - Duplicate suppression: one delivery-log row per (event, channel, recipient), unique by
 *    `dedupeKey`; a SENT row is never sent again, so retried webhooks/jobs cannot double-send.
 *  - Retries: a failed send marks the row FAILED and rethrows, so BullMQ retries the job; rows that
 *    exhaust their retries remain FAILED for inspection and manual retry (dead letters).
 *  - Emails go to the account holder's verified account address, not to guest-entered addresses.
 */
export class BookingNotificationsService {
  constructor(
    private readonly mailer: MailProvider,
    private readonly config: Pick<Config, 'WEB_APP_URL' | 'OPS_ALERT_EMAIL'>,
    private readonly logger: Logger,
  ) {}

  private url(path: string) {
    return new URL(path, this.config.WEB_APP_URL).toString();
  }

  private money(minor: number, currency: CurrencyCode) {
    return formatMinorUnits(minor, currency);
  }

  private async resolve(event: DomainEvent): Promise<{
    booking: BookingRecord;
    refund: RefundRecord | null;
    review: ReviewRecord | null;
  } | null> {
    if (!Types.ObjectId.isValid(event.aggregateId)) return null;
    if (event.aggregateType === 'Booking') {
      const booking = await BookingModel.findById(event.aggregateId).lean<BookingRecord>();
      return booking ? { booking, refund: null, review: null } : null;
    }
    if (event.aggregateType === 'Refund') {
      const refund = await RefundModel.findById(event.aggregateId).lean<RefundRecord>();
      const booking = refund
        ? await BookingModel.findById(refund.bookingId).lean<BookingRecord>()
        : null;
      return booking ? { booking, refund, review: null } : null;
    }
    const review = await ReviewModel.findById(event.aggregateId).lean<ReviewRecord>();
    const booking = review
      ? await BookingModel.findById(review.bookingId).lean<BookingRecord>()
      : null;
    return booking ? { booking, refund: null, review } : null;
  }

  private plan(
    event: DomainEvent,
    b: BookingRecord,
    refund: RefundRecord | null,
    cancellation: CancellationRecord | null,
  ): Plan | null {
    const ref = b.bookingReference;
    const view = `/account/bookings/${ref}`;
    const cur = b.priceSnapshot.currency;
    const refundText = refund ? this.money(refund.amountMinor, refund.currency) : '';
    switch (event.type) {
      case 'booking.created':
        return {
          inApp: {
            type: 'BOOKING_CREATED',
            title: `Complete payment for ${ref}`,
            body: `Your rooms at ${b.hotelSnapshot.name} are on hold. Complete payment to confirm.`,
          },
          email: 'booking-created',
          optional: false,
          link: `/checkout/payment?booking=${ref}`,
        };
      case 'payment.succeeded':
        return {
          inApp: {
            type: 'PAYMENT_SUCCEEDED',
            title: 'Payment received',
            body: `We received your payment for ${ref}.`,
          },
          email: 'payment-succeeded',
          optional: false,
          link: view,
        };
      case 'payment.failed':
        return {
          inApp: {
            type: 'PAYMENT_FAILED',
            title: 'Payment failed',
            body: `Your payment for ${ref} did not go through. No money was taken.`,
          },
          email: 'payment-failed',
          optional: false,
          link: `/checkout/payment?booking=${ref}`,
        };
      case 'booking.confirmed':
        return {
          inApp: {
            type: 'BOOKING_CONFIRMED',
            title: `Booking confirmed: ${b.hotelSnapshot.name}`,
            body: `${b.checkInLocalDate} → ${b.checkOutLocalDate}. Reference ${ref}.`,
          },
          email: 'booking-confirmed',
          optional: false,
          link: view,
          extra: { policy: b.cancellationPolicySnapshot.map((p) => p.summary).join(' ') },
        };
      case 'booking.cancelled':
        return {
          inApp: {
            type: 'BOOKING_CANCELLED',
            title: `Booking ${ref} cancelled`,
            body:
              cancellation && cancellation.refundableAmountMinor > 0
                ? `${this.money(cancellation.refundableAmountMinor, cur)} will be refunded.`
                : 'No refund is due under the cancellation policy.',
          },
          email: 'booking-cancelled',
          optional: false,
          link: view,
          extra: {
            charge: cancellation ? this.money(cancellation.cancellationChargeMinor, cur) : '',
            refund:
              cancellation && cancellation.refundableAmountMinor > 0
                ? this.money(cancellation.refundableAmountMinor, cur)
                : '',
          },
        };
      case 'booking.expired':
        return {
          inApp: {
            type: 'BOOKING_EXPIRED',
            title: `Booking ${ref} expired`,
            body: 'Payment was not completed in time and the rooms were released.',
          },
          email: 'booking-expired',
          optional: false,
          link: `/hotels/${b.hotelSnapshot.slug}`,
        };
      case 'booking.reconciliation_required':
        return {
          inApp: {
            type: 'REFUND_REQUESTED',
            title: `We are refunding ${ref}`,
            body: 'Your payment arrived after the hold expired and the rooms were taken. A full refund has started.',
          },
          email: 'booking-under-review',
          optional: false,
          link: view,
          ops: {
            alert: 'Booking requires reconciliation',
            detail: `Verified payment for ${ref} could not be allocated; a full refund was initiated automatically.`,
          },
        };
      case 'refund.requested':
        if (event.payload.needsDecision) {
          return {
            inApp: {
              type: 'REFUND_REQUESTED',
              title: 'Refund request received',
              body: `We will review your refund request for ${ref}.`,
            },
            email: null,
            optional: false,
            link: view,
            ops: {
              alert: 'Refund request needs a decision',
              detail: `Customer requested a refund for ${ref}.`,
            },
          };
        }
        return {
          inApp: {
            type: 'REFUND_REQUESTED',
            title: 'Refund started',
            body: `A refund of ${refundText} for ${ref} has started.`,
          },
          email: 'refund-requested',
          optional: false,
          link: view,
          extra: { refund: refundText },
        };
      case 'refund.completed':
        return {
          inApp: {
            type: 'REFUND_COMPLETED',
            title: 'Refund completed',
            body: `Your refund of ${refundText} for ${ref} is complete.`,
          },
          email: 'refund-completed',
          optional: false,
          link: view,
          extra: { refund: refundText },
        };
      case 'refund.failed':
        return {
          inApp: {
            type: 'REFUND_FAILED',
            title: 'Refund needs attention',
            body: `The provider could not complete your refund for ${ref}. Our team is on it.`,
          },
          email: 'refund-failed',
          optional: false,
          link: view,
          ops: {
            alert: 'Refund failed',
            detail: `Refund ${refund?._id.toString() ?? ''} (${refundText}) for ${ref} failed at the payment provider. Retry or resolve manually.`,
          },
        };
      case 'checkin.reminder':
        return {
          inApp: {
            type: 'CHECKIN_REMINDER',
            title: `Your stay starts tomorrow`,
            body: `${b.hotelSnapshot.name} · check-in from ${b.hotelSnapshot.checkInTime}.`,
          },
          email: 'checkin-reminder',
          optional: true,
          link: view,
          extra: {
            checkInTime: b.hotelSnapshot.checkInTime,
            address: [b.hotelSnapshot.addressLine, b.hotelSnapshot.city].filter(Boolean).join(', '),
          },
        };
      case 'review.reminder':
        return {
          inApp: {
            type: 'REVIEW_REMINDER',
            title: `How was ${b.hotelSnapshot.name}?`,
            body: 'Share a verified review of your stay.',
          },
          email: 'review-reminder',
          optional: true,
          link: `${view}?review=1`,
        };
      case 'review.responded':
        return {
          inApp: {
            type: 'REVIEW_RESPONSE',
            title: 'The property replied to your review',
            body: b.hotelSnapshot.name,
          },
          email: null,
          optional: true,
          link: '/account/reviews',
        };
      default:
        return null;
    }
  }

  /** Run one delivery exactly once (per dedupe key). */
  private async deliver(
    row: Omit<
      NotificationDeliveryRecord,
      | '_id'
      | 'status'
      | 'attempts'
      | 'lastError'
      | 'sentAt'
      | 'createdAt'
      | 'updatedAt'
      | 'skippedReason'
    >,
    send: () => Promise<void>,
    skip?: string,
  ): Promise<void> {
    const doc = await NotificationDeliveryModel.findOneAndUpdate(
      { dedupeKey: row.dedupeKey },
      { $setOnInsert: { ...row, status: 'PENDING', attempts: 0 } },
      { upsert: true, new: true },
    ).lean<NotificationDeliveryRecord>();
    if (!doc || doc.status === 'SENT' || doc.status === 'SKIPPED') return;
    if (skip) {
      await NotificationDeliveryModel.updateOne(
        { _id: doc._id },
        { $set: { status: 'SKIPPED', skippedReason: skip } },
      );
      return;
    }
    try {
      await send();
      await NotificationDeliveryModel.updateOne(
        { _id: doc._id },
        { $set: { status: 'SENT', sentAt: new Date(), lastError: null }, $inc: { attempts: 1 } },
      );
    } catch (error) {
      await NotificationDeliveryModel.updateOne(
        { _id: doc._id },
        {
          $set: { status: 'FAILED', lastError: (error as Error).message.slice(0, 1000) },
          $inc: { attempts: 1 },
        },
      );
      throw error;
    }
  }

  async handle(event: DomainEvent): Promise<void> {
    const resolved = await this.resolve(event);
    if (!resolved) {
      this.logger.warn(
        { eventId: event.eventId },
        'Notification event refers to a missing record; skipped',
      );
      return;
    }
    const { booking, refund } = resolved;
    const cancellation =
      event.type === 'booking.cancelled'
        ? await CancellationModel.findOne({ bookingId: booking._id }).lean<CancellationRecord>()
        : null;
    const plan = this.plan(event, booking, refund, cancellation);
    if (!plan) return;
    const user = await UserModel.findById(booking.customerId, {
      email: 1,
      firstName: 1,
      roles: 1,
      preferences: 1,
    }).lean<Recipient>();
    if (!user) return;

    const data: BookingEmailData = {
      firstName: user.firstName,
      reference: booking.bookingReference,
      hotelName: booking.hotelSnapshot.name,
      checkIn: booking.checkInLocalDate,
      checkOut: booking.checkOutLocalDate,
      nights: booking.numberOfNights,
      roomSummary: roomSummary(booking.bookingItems),
      amount: this.money(booking.priceSnapshot.totals.totalMinor, booking.priceSnapshot.currency),
      link: this.url(plan.link),
      ...(plan.extra ? { extra: plan.extra } : {}),
    };
    const errors: unknown[] = [];
    const attempt = async (work: () => Promise<void>) => {
      try {
        await work();
      } catch (error) {
        errors.push(error);
      }
    };

    await attempt(() =>
      this.deliver(
        {
          dedupeKey: `${event.eventId}.inapp.${user._id}`,
          eventId: event.eventId,
          userId: user._id,
          channel: 'IN_APP',
          template: plan.inApp.type,
          recipient: user._id.toString(),
        },
        async () => {
          await NotificationModel.create({
            userId: user._id,
            type: plan.inApp.type,
            channel: 'IN_APP',
            title: plan.inApp.title,
            body: plan.inApp.body,
            deliveryStatus: 'DELIVERED',
            deliveredAt: new Date(),
            resource: { type: 'Booking', id: booking.bookingReference },
          });
        },
      ),
    );
    if (plan.email) {
      const template = plan.email;
      const optOut =
        plan.optional && user.preferences?.notifications?.emailBookingUpdates === false;
      await attempt(() =>
        this.deliver(
          {
            dedupeKey: `${event.eventId}.email.${user._id}`,
            eventId: event.eventId,
            userId: user._id,
            channel: 'EMAIL',
            template,
            recipient: user.email,
          },
          async () => {
            await this.mailer.send(renderBookingEmail(template, user.email, data));
          },
          optOut ? 'Customer opted out of booking update emails' : undefined,
        ),
      );
    }
    if (plan.ops) {
      const ops = plan.ops;
      const admins = await UserModel.find(
        { roles: { $in: ['ADMIN', 'SUPER_ADMIN'] }, accountStatus: 'ACTIVE' },
        { _id: 1 },
      )
        .limit(50)
        .lean<Array<{ _id: Types.ObjectId }>>();
      for (const admin of admins) {
        await attempt(() =>
          this.deliver(
            {
              dedupeKey: `${event.eventId}.ops.${admin._id}`,
              eventId: event.eventId,
              userId: admin._id,
              channel: 'IN_APP',
              template: 'OPERATIONS_ALERT',
              recipient: admin._id.toString(),
            },
            async () => {
              await NotificationModel.create({
                userId: admin._id,
                type: 'OPERATIONS_ALERT',
                channel: 'IN_APP',
                title: ops.alert,
                body: ops.detail.slice(0, 2000),
                deliveryStatus: 'DELIVERED',
                deliveredAt: new Date(),
                resource: { type: 'Booking', id: booking.bookingReference },
              });
            },
          ),
        );
      }
      if (this.config.OPS_ALERT_EMAIL) {
        const to = this.config.OPS_ALERT_EMAIL;
        await attempt(() =>
          this.deliver(
            {
              dedupeKey: `${event.eventId}.ops-email`,
              eventId: event.eventId,
              userId: null,
              channel: 'EMAIL',
              template: 'operations-alert',
              recipient: to,
            },
            async () => {
              await this.mailer.send(
                renderBookingEmail('operations-alert', to, {
                  ...data,
                  firstName: 'team',
                  link: this.url('/admin/operations'),
                  extra: { alert: ops.alert, detail: ops.detail },
                }),
              );
            },
          ),
        );
      }
    }
    // Any failed channel fails the job so it is retried; channels already SENT are not repeated.
    if (errors.length) throw errors[0];
  }

  // ------------------------------------------------------------------ failed deliveries (dead letters)
  async failedDeliveries(limit = 50): Promise<FailedDeliveryDto[]> {
    const rows = await NotificationDeliveryModel.find({ status: 'FAILED' })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<NotificationDeliveryRecord[]>();
    return rows.map((r) => ({
      id: r._id.toString(),
      eventId: r.eventId,
      channel: r.channel,
      template: r.template,
      recipient: r.channel === 'EMAIL' ? r.recipient.replace(/^(.).*(@.*)$/, '$1***$2') : 'in-app',
      attempts: r.attempts,
      lastError: r.lastError,
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  /** Manually re-run a failed delivery (re-handles its event; already-sent channels are skipped). */
  async retryDelivery(deliveryId: string): Promise<void> {
    if (!Types.ObjectId.isValid(deliveryId)) throw Errors.notFound('Delivery');
    const row = await NotificationDeliveryModel.findOne({
      _id: deliveryId,
      status: 'FAILED',
    }).lean<NotificationDeliveryRecord>();
    if (!row) throw Errors.notFound('Failed delivery');
    const event = await OutboxEventModel.findOne({
      eventId: row.eventId,
    }).lean<OutboxEventRecord>();
    if (!event) throw Errors.notFound('Event');
    await this.handle({
      eventId: event.eventId,
      type: event.type as DomainEvent['type'],
      aggregateType: event.aggregateType as DomainEvent['aggregateType'],
      aggregateId: event.aggregateId,
      payload: event.payload as DomainEvent['payload'],
    });
  }
}
