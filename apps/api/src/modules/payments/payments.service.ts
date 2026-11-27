import type { CouponsService } from '@/modules/coupons/coupons.service';
import type { FinanceService } from '@/modules/finance/finance.service';
import { createHash } from 'node:crypto';
import type { ClientSession, Types } from 'mongoose';
import type {
  CheckoutConfigDto,
  PaymentDto,
  PaymentVerificationDto,
  SandboxCompletionDto,
  VerifyPaymentInput,
} from '@stayscape/shared';
import type { Config } from '@/config/env';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { assertSameRequest, requestFingerprint } from '@/lib/idempotency';
import type { Logger } from '@/lib/logger';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import { holdIsLive, toPaymentDto } from '@/modules/bookings/booking.mapper';
import {
  BookingHoldModel,
  BookingModel,
  CancellationModel,
  type BookingHoldRecord,
  type BookingRecord,
} from '@/modules/bookings/booking.models';
import { statusEvent, type BookingsService } from '@/modules/bookings/bookings.service';
import {
  InventoryConflictError,
  type InventoryService,
} from '@/modules/inventory/inventory.service';
import type { OutboxService } from '@/modules/outbox/outbox.service';
import { RoomTypeModel, type RoomTypeRecord } from '@/modules/rooms/room.models';
import type { AuthContext } from '@/types/express';
import {
  PaymentEventModel,
  PaymentModel,
  type PaymentEventRecord,
  type PaymentRecord,
} from './payment.models';
import { syncBookingPaymentStatus } from './payment-status';
import type {
  PaymentProvider,
  ProviderPayment,
  ProviderWebhookEvent,
} from './providers/payment-provider';
import { SandboxPaymentProvider } from './providers/sandbox.provider';
import type { RefundsService } from './refunds.service';

type SettleVia = 'CHECKOUT' | 'WEBHOOK' | 'RECONCILIATION';

interface Deps {
  config: Pick<Config, 'PAYMENT_MERCHANT_NAME'>;
  provider: PaymentProvider;
  bookings: BookingsService;
  inventory: InventoryService;
  refunds: RefundsService;
  finance: FinanceService;
  coupons: CouponsService;
  outbox: OutboxService;
  audit: AuditService;
  logger: Logger;
}

const PAYABLE_BOOKING_STATUSES = ['PENDING_PAYMENT', 'PAYMENT_PROCESSING'];
/** Booking states in which a captured payment still has to be turned into an allocation. */
const AWAITING_ALLOCATION = ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'EXPIRED'];

/**
 * Payment state machine (see docs/payments.md):
 *
 *  createOrder      booking PENDING_PAYMENT → PAYMENT_PROCESSING; payment PENDING
 *  settleSuccess    payment → SUCCESS (only from INITIATED/PENDING/FAILED; idempotent), then:
 *                   - live hold           → hold CONSUMED, held→booked, booking CONFIRMED (same txn)
 *                   - hold expired/gone   → allocateAfterPayment(): book directly if rooms are free
 *                                           → CONFIRMED, otherwise RECONCILIATION_REQUIRED + full refund
 *                   - booking cancelled / already paid by another payment → refund this payment
 *  settleFailure    payment → FAILED (never overrides SUCCESS); booking back to PENDING_PAYMENT
 *
 * Success is only ever established by (a) a valid checkout signature AND the provider reporting the
 * payment captured for the right order/amount/currency, (b) a signature-verified webhook, or (c) the
 * provider API during reconciliation. A browser callback alone never confirms anything.
 */
export class PaymentsService {
  constructor(private readonly deps: Deps) {}

  get provider() {
    return this.deps.provider;
  }

  // ------------------------------------------------------------------ checkout
  private checkoutConfig(
    payment: PaymentRecord,
    booking: BookingRecord,
    hold: BookingHoldRecord | null,
  ): CheckoutConfigDto {
    const guest = booking.guestDetails.primaryGuest;
    return {
      provider: payment.provider,
      keyId: this.deps.provider.publicKeyId,
      providerOrderId: payment.providerOrderId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      merchantName: this.deps.config.PAYMENT_MERCHANT_NAME,
      description: `${booking.hotelSnapshot.name} · ${booking.checkInLocalDate} → ${booking.checkOutLocalDate}`,
      bookingReference: booking.bookingReference,
      prefill: {
        name: `${guest.firstName} ${guest.lastName}`,
        email: guest.email,
        contact: guest.phone,
      },
      holdExpiresAt: hold?.status === 'ACTIVE' ? hold.expiresAt.toISOString() : null,
      sandbox: this.deps.provider.sandbox,
    };
  }

  /** Create (or reuse) a provider order for the booking's server-side total. */
  async createOrder(
    auth: AuthContext,
    reference: string,
    idempotencyKey: string,
    context: RequestContext,
  ): Promise<CheckoutConfigDto> {
    const booking = await this.deps.bookings.findOwned(auth.userId, reference);
    const requestHash = requestFingerprint({ reference });
    const hold = await BookingHoldModel.findById(booking.holdId).lean<BookingHoldRecord>();
    const replay = await PaymentModel.findOne({
      customerId: auth.userId,
      idempotencyKey,
    }).lean<PaymentRecord>();
    if (replay) {
      assertSameRequest(replay.requestHash, requestHash);
      return this.checkoutConfig(replay, booking, hold);
    }
    if (!PAYABLE_BOOKING_STATUSES.includes(booking.bookingStatus))
      throw new AppError(409, 'INVALID_STATE', 'This booking cannot be paid for.');
    if (!holdIsLive(hold))
      throw new AppError(
        409,
        'HOLD_EXPIRED',
        'Your room hold has expired. Check availability again to book.',
      );
    if (
      await PaymentModel.exists({
        bookingId: booking._id,
        status: { $in: ['SUCCESS', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
      })
    ) {
      throw new AppError(409, 'INVALID_STATE', 'This booking has already been paid.');
    }
    // A retry after closing the provider's window reuses the open order instead of creating another.
    const open = await PaymentModel.findOne({
      bookingId: booking._id,
      status: { $in: ['INITIATED', 'PENDING'] },
    })
      .sort({ createdAt: -1 })
      .lean<PaymentRecord>();
    const amountMinor = booking.priceSnapshot.totals.totalMinor;
    const currency = booking.priceSnapshot.currency;
    if (open && open.amountMinor === amountMinor && open.currency === currency)
      return this.checkoutConfig(open, booking, hold);
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 100)
      throw new AppError(
        409,
        'INVALID_STATE',
        'The booking amount is below the minimum chargeable amount.',
      );

    const order = await this.deps.provider.createOrder({
      amountMinor,
      currency,
      receipt: booking.bookingReference,
      notes: { bookingReference: booking.bookingReference, bookingId: booking._id.toString() },
    });
    if (order.amount !== amountMinor || order.currency !== currency) {
      throw new AppError(
        502,
        'PAYMENT_PROVIDER_ERROR',
        'The payment provider returned an unexpected amount.',
      );
    }
    let payment: PaymentRecord;
    try {
      payment = await withTransaction(async (session) => {
        const [doc] = await PaymentModel.create(
          [
            {
              bookingId: booking._id,
              customerId: booking.customerId,
              provider: this.deps.provider.name,
              providerOrderId: order.id,
              amountMinor,
              currency,
              status: 'PENDING',
              idempotencyKey,
              requestHash,
            },
          ],
          { session },
        );
        await BookingModel.updateOne(
          { _id: booking._id, bookingStatus: { $in: PAYABLE_BOOKING_STATUSES } },
          {
            $set: { bookingStatus: 'PAYMENT_PROCESSING' },
            ...(booking.bookingStatus === 'PENDING_PAYMENT'
              ? { $push: { statusHistory: statusEvent('PAYMENT_PROCESSING', 'Payment started') } }
              : {}),
          },
          { session },
        );
        await syncBookingPaymentStatus(booking._id, session);
        return doc!.toObject() as PaymentRecord;
      });
    } catch (error) {
      if (isMongoDuplicateKey(error)) {
        const existing = await PaymentModel.findOne({
          customerId: auth.userId,
          idempotencyKey,
        }).lean<PaymentRecord>();
        if (existing) return this.checkoutConfig(existing, booking, hold);
      }
      throw error;
    }
    await this.deps.audit.record({
      actorId: auth.userId,
      action: 'payment.order_created',
      entityType: 'Payment',
      entityId: payment._id.toString(),
      metadata: { reference, amountMinor, currency },
      context,
    });
    return this.checkoutConfig(payment, booking, hold);
  }

  /** Browser callback: verify the signature, then confirm the state with the provider itself. */
  async verify(
    auth: AuthContext,
    reference: string,
    input: VerifyPaymentInput,
    context: RequestContext,
  ): Promise<PaymentVerificationDto> {
    const booking = await this.deps.bookings.findOwned(auth.userId, reference);
    const payment = await PaymentModel.findOne({
      bookingId: booking._id,
      providerOrderId: input.providerOrderId,
    }).lean<PaymentRecord>();
    if (!payment) throw Errors.notFound('Payment');
    if (
      !this.deps.provider.verifyCheckoutSignature({
        orderId: input.providerOrderId,
        paymentId: input.providerPaymentId,
        signature: input.signature,
      })
    ) {
      await this.deps.audit.record({
        actorId: auth.userId,
        action: 'payment.signature_rejected',
        entityType: 'Payment',
        entityId: payment._id.toString(),
        context,
      });
      throw new AppError(400, 'PAYMENT_VERIFICATION_FAILED', 'The payment could not be verified.');
    }
    const providerPayment = await this.deps.provider.fetchPayment(input.providerPaymentId);
    await this.applyProviderPayment(payment, providerPayment, 'CHECKOUT');
    const fresh = (await BookingModel.findById(booking._id).lean<BookingRecord>())!;
    // A reconciled booking may already be CANCELLED (its automatic refund can settle instantly).
    const outcome =
      fresh.bookingStatus === 'CONFIRMED'
        ? 'CONFIRMED'
        : fresh.bookingStatus === 'RECONCILIATION_REQUIRED' || fresh.reconciliationNote
          ? 'RECONCILIATION_REQUIRED'
          : fresh.paymentStatus === 'FAILED'
            ? 'FAILED'
            : 'PROCESSING';
    return { booking: await this.deps.bookings.toDetail(fresh), outcome };
  }

  /**
   * Act on the provider's report of a payment for one of our orders. Validates order, amount and
   * currency; captures an authorised payment; then settles. Idempotent.
   */
  async applyProviderPayment(
    payment: PaymentRecord,
    providerPayment: ProviderPayment,
    via: SettleVia,
  ): Promise<void> {
    if (providerPayment.orderId && providerPayment.orderId !== payment.providerOrderId) {
      throw new AppError(
        400,
        'PAYMENT_VERIFICATION_FAILED',
        'The payment does not belong to this order.',
      );
    }
    if (
      providerPayment.amount !== payment.amountMinor ||
      providerPayment.currency !== payment.currency
    ) {
      this.deps.logger.error(
        {
          paymentId: payment._id.toString(),
          expected: payment.amountMinor,
          got: providerPayment.amount,
        },
        'Payment amount mismatch',
      );
      throw new AppError(
        400,
        'PAYMENT_VERIFICATION_FAILED',
        'The paid amount does not match the booking.',
      );
    }
    let current = providerPayment;
    if (current.status === 'authorized')
      current = await this.deps.provider.capturePayment(
        current.id,
        payment.amountMinor,
        payment.currency,
      );
    if (current.status === 'captured' || current.status === 'refunded')
      await this.settleSuccess(payment._id, current.id, via);
    else if (current.status === 'failed')
      await this.settleFailure(
        payment._id,
        current.errorDescription ?? 'The payment was declined.',
      );
  }

  // ------------------------------------------------------------------ settlement
  async settleSuccess(
    paymentId: Types.ObjectId,
    providerPaymentId: string,
    via: SettleVia,
  ): Promise<void> {
    const outcome = await withTransaction(async (session) => {
      const payment = await PaymentModel.findOneAndUpdate(
        { _id: paymentId, status: { $in: ['INITIATED', 'PENDING', 'FAILED'] } },
        {
          $set: {
            status: 'SUCCESS',
            providerPaymentId,
            verifiedAt: new Date(),
            verifiedVia: via,
            failureReason: null,
          },
        },
        { session, new: true },
      ).lean<PaymentRecord>();
      if (!payment) return 'noop' as const; // already settled: duplicate callback/webhook
      const booking = (await BookingModel.findById(payment.bookingId, null, {
        session,
      }).lean<BookingRecord>())!;
      await this.deps.outbox.add(
        {
          eventId: `payment.succeeded.${payment._id}`,
          type: 'payment.succeeded',
          aggregateType: 'Booking',
          aggregateId: booking._id.toString(),
          payload: { paymentId: payment._id.toString() },
        },
        session,
      );

      const otherPaid = await PaymentModel.exists({
        bookingId: booking._id,
        _id: { $ne: payment._id },
        status: { $in: ['SUCCESS', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED'] },
      }).session(session);
      if (otherPaid || !AWAITING_ALLOCATION.includes(booking.bookingStatus)) {
        // Paid twice, or paid after cancelling: never allocate again — return this payment in full.
        await this.deps.finance.onUnallocatedCapture(payment, booking, session);
        await this.deps.refunds.createApproved(
          {
            booking,
            payment,
            amountMinor: payment.amountMinor,
            reason: otherPaid
              ? 'Duplicate payment for the same booking'
              : `Payment received for a ${booking.bookingStatus.toLowerCase()} booking`,
            source: 'RECONCILIATION',
            idempotencyKey: `unallocatable-payment.${payment._id}`,
            requestedBy: null,
            decidedBy: null,
          },
          session,
        );
        await syncBookingPaymentStatus(booking._id, session);
        return 'refunded' as const;
      }

      const hold = await BookingHoldModel.findById(booking.holdId, null, {
        session,
      }).lean<BookingHoldRecord>();
      if (hold && holdIsLive(hold)) {
        const consumed = await BookingHoldModel.findOneAndUpdate(
          { _id: hold._id, status: 'ACTIVE' },
          { $set: { status: 'CONSUMED', consumedAt: new Date() } },
          { session, new: true },
        ).lean<BookingHoldRecord>();
        if (consumed) {
          for (const item of consumed.items)
            await this.deps.inventory.commitHeld(item.roomTypeId, item.nights, item.rooms, session);
          await this.confirmBooking(booking, session, 'Payment received — booking confirmed');
          return 'confirmed' as const;
        }
      }
      // The hold ran out while the guest was paying. Release it here if the worker has not yet.
      if (hold?.status === 'ACTIVE')
        await this.deps.bookings.transitionHold(hold._id, 'EXPIRED', session);
      await syncBookingPaymentStatus(booking._id, session);
      return 'allocate' as const;
    });
    if (outcome === 'allocate') await this.allocateAfterPayment(paymentId);
    await this.deps.outbox.kick();
  }

  private async confirmBooking(
    booking: BookingRecord,
    session: ClientSession,
    note: string,
  ): Promise<void> {
    await BookingModel.updateOne(
      { _id: booking._id },
      {
        $set: { bookingStatus: 'CONFIRMED', confirmedAt: new Date(), reconciliationNote: null },
        $push: { statusHistory: statusEvent('CONFIRMED', note) },
      },
      { session },
    );
    await syncBookingPaymentStatus(booking._id, session);
    // Commission snapshot + ledger postings, in the same transaction as the confirmation.
    await this.deps.coupons.redeem(booking.holdId, booking._id, session);
    await this.deps.finance.onBookingConfirmed(booking._id, session);
    await this.deps.outbox.add(
      {
        eventId: `booking.confirmed.${booking._id}`,
        type: 'booking.confirmed',
        aggregateType: 'Booking',
        aggregateId: booking._id.toString(),
        payload: {},
      },
      session,
    );
    await this.deps.outbox.add(
      {
        eventId: `documents.generate.${booking._id}`,
        type: 'documents.generate',
        aggregateType: 'Booking',
        aggregateId: booking._id.toString(),
        payload: {},
      },
      session,
    );
  }

  /**
   * A verified payment whose hold is gone: try to allocate the same rooms afresh (only if they are
   * still free for every night). If not, never force a double allocation — record an explicit
   * RECONCILIATION_REQUIRED exception, refund in full, alert operations. Safe to call repeatedly
   * (it is also re-driven by reconciliation after a crash).
   */
  async allocateAfterPayment(
    paymentId: Types.ObjectId,
  ): Promise<'confirmed' | 'reconciliation' | 'noop'> {
    const payment = await PaymentModel.findById(paymentId).lean<PaymentRecord>();
    if (!payment || payment.status !== 'SUCCESS') return 'noop';
    try {
      const done = await withTransaction(async (session) => {
        const booking = await BookingModel.findOne(
          { _id: payment.bookingId, bookingStatus: { $in: AWAITING_ALLOCATION } },
          null,
          { session },
        ).lean<BookingRecord>();
        if (!booking) return false;
        for (const item of booking.bookingItems) {
          const roomType = await RoomTypeModel.findOne(
            { _id: item.roomTypeId, status: { $ne: 'ARCHIVED' } },
            null,
            { session },
          ).lean<RoomTypeRecord>();
          if (!roomType)
            throw new InventoryConflictError(
              'The room category is no longer offered.',
              [],
              'INVENTORY_UNAVAILABLE',
            );
          await this.deps.inventory.bookDirect(roomType, item.nights, item.rooms, session);
        }
        await this.confirmBooking(
          booking,
          session,
          'Payment received after the hold expired — rooms re-allocated',
        );
        return true;
      });
      return done ? 'confirmed' : 'noop';
    } catch (error) {
      if (!(error instanceof InventoryConflictError)) throw error;
    }
    await withTransaction(async (session) => {
      const booking = await BookingModel.findOneAndUpdate(
        { _id: payment.bookingId, bookingStatus: { $in: AWAITING_ALLOCATION } },
        {
          $set: {
            bookingStatus: 'RECONCILIATION_REQUIRED',
            reconciliationNote:
              'Payment verified after the hold expired and the rooms were no longer available. Full refund initiated.',
          },
          $push: {
            statusHistory: statusEvent(
              'RECONCILIATION_REQUIRED',
              'Rooms no longer available — full refund initiated',
            ),
          },
        },
        { session, new: true },
      ).lean<BookingRecord>();
      if (!booking) return;
      await this.deps.finance.onUnallocatedCapture(payment, booking, session);
      const refund = await this.deps.refunds.createApproved(
        {
          booking,
          payment,
          amountMinor: payment.amountMinor,
          reason: 'Rooms unavailable after a late payment',
          source: 'RECONCILIATION',
          idempotencyKey: `reconciliation.${booking._id}`,
          requestedBy: null,
          decidedBy: null,
        },
        session,
      );
      await CancellationModel.updateOne(
        { bookingId: booking._id },
        {
          $setOnInsert: {
            bookingId: booking._id,
            requestedBy: null,
            requestedByRole: 'SYSTEM',
            reason: 'INVENTORY_UNAVAILABLE',
            note: 'Payment arrived after the hold expired and the rooms had been taken.',
            policySnapshot: booking.cancellationPolicySnapshot,
            paidMinor: payment.amountMinor,
            cancellationChargeMinor: 0,
            refundableAmountMinor: payment.amountMinor,
            currency: payment.currency,
            refundId: refund._id,
            status: 'REFUND_PENDING',
          },
        },
        { upsert: true, session },
      );
      await this.deps.outbox.add(
        {
          eventId: `booking.reconciliation_required.${booking._id}`,
          type: 'booking.reconciliation_required',
          aggregateType: 'Booking',
          aggregateId: booking._id.toString(),
          payload: {},
        },
        session,
      );
    });
    await this.deps.audit.record({
      actorId: null,
      action: 'booking.reconciliation_required',
      entityType: 'Booking',
      entityId: payment.bookingId.toString(),
      metadata: { paymentId: payment._id.toString() },
    });
    await this.deps.outbox.kick();
    return 'reconciliation';
  }

  async settleFailure(paymentId: Types.ObjectId, reason: string): Promise<void> {
    await withTransaction(async (session) => {
      const payment = await PaymentModel.findOneAndUpdate(
        { _id: paymentId, status: { $in: ['INITIATED', 'PENDING'] } },
        { $set: { status: 'FAILED', failureReason: reason.slice(0, 500) } },
        { session, new: true },
      ).lean<PaymentRecord>();
      if (!payment) return; // already failed, or already succeeded (failure never overrides success)
      const stillOpen = await PaymentModel.exists({
        bookingId: payment.bookingId,
        status: { $in: ['INITIATED', 'PENDING'] },
      }).session(session);
      if (!stillOpen) {
        await BookingModel.updateOne(
          { _id: payment.bookingId, bookingStatus: 'PAYMENT_PROCESSING' },
          {
            $set: { bookingStatus: 'PENDING_PAYMENT' },
            $push: {
              statusHistory: statusEvent(
                'PENDING_PAYMENT',
                'Payment failed — you can try again while your rooms are held',
              ),
            },
          },
          { session },
        );
      }
      await syncBookingPaymentStatus(payment.bookingId, session);
      await this.deps.outbox.add(
        {
          eventId: `payment.failed.${payment._id}`,
          type: 'payment.failed',
          aggregateType: 'Booking',
          aggregateId: payment.bookingId.toString(),
          payload: { paymentId: payment._id.toString() },
        },
        session,
      );
    });
    await this.deps.outbox.kick();
  }

  // ------------------------------------------------------------------ webhooks
  /**
   * Verify, de-duplicate and process a provider webhook. Duplicates (unique provider+event id) are
   * acknowledged without re-processing; an event that previously failed is processed again.
   * Throws (→ 5xx, provider retries) only when processing failed transiently.
   */
  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<{ status: 'processed' | 'duplicate' | 'ignored' }> {
    const signature = headers['x-razorpay-signature'];
    if (!this.deps.provider.verifyWebhookSignature(rawBody, signature)) {
      this.deps.logger.warn('Rejected webhook with an invalid signature');
      throw new AppError(400, 'PAYMENT_VERIFICATION_FAILED', 'Invalid webhook signature.');
    }
    const event = this.deps.provider.parseWebhook(rawBody, headers);
    let record: PaymentEventRecord;
    try {
      const [doc] = await PaymentEventModel.create([
        {
          provider: this.deps.provider.name,
          providerEventId: event.eventId,
          eventType: event.eventType,
          payloadReference: createHash('sha256').update(rawBody).digest('hex'),
          payload: {
            paymentId: event.payment?.id ?? null,
            orderId: event.payment?.orderId ?? null,
            refundId: event.refund?.id ?? null,
            status: event.payment?.status ?? event.refund?.status ?? null,
            amount: event.payment?.amount ?? event.refund?.amount ?? null,
          },
          receivedAt: new Date(),
        },
      ]);
      record = doc!.toObject() as PaymentEventRecord;
    } catch (error) {
      if (!isMongoDuplicateKey(error)) throw error;
      const existing = await PaymentEventModel.findOne({
        provider: this.deps.provider.name,
        providerEventId: event.eventId,
      }).lean<PaymentEventRecord>();
      if (
        !existing ||
        existing.processingStatus === 'PROCESSED' ||
        existing.processingStatus === 'IGNORED'
      )
        return { status: 'duplicate' };
      record = existing;
    }
    return { status: await this.processEvent(record, event) };
  }

  private async processEvent(
    record: PaymentEventRecord,
    event: ProviderWebhookEvent,
  ): Promise<'processed' | 'ignored'> {
    await PaymentEventModel.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
    try {
      let handled = false;
      let paymentId: Types.ObjectId | null = null;
      if (
        event.payment &&
        ['payment.captured', 'payment.authorized', 'order.paid', 'payment.failed'].includes(
          event.eventType,
        )
      ) {
        const payment = event.payment.orderId
          ? await PaymentModel.findOne({
              provider: this.deps.provider.name,
              providerOrderId: event.payment.orderId,
            }).lean<PaymentRecord>()
          : null;
        if (payment) {
          paymentId = payment._id;
          // Out-of-order safe: success can follow failure; failure never overrides success.
          await this.applyProviderPayment(payment, event.payment, 'WEBHOOK');
          handled = true;
        }
      } else if (
        event.refund &&
        ['refund.processed', 'refund.failed', 'refund.created'].includes(event.eventType)
      ) {
        handled = await this.deps.refunds.handleProviderRefund(event.refund);
      }
      const status = handled ? 'PROCESSED' : 'IGNORED';
      await PaymentEventModel.updateOne(
        { _id: record._id },
        {
          $set: {
            processingStatus: status,
            processedAt: new Date(),
            paymentId,
            failureReason: null,
          },
        },
      );
      return handled ? 'processed' : 'ignored';
    } catch (error) {
      await PaymentEventModel.updateOne(
        { _id: record._id },
        {
          $set: {
            processingStatus: 'FAILED',
            failureReason: (error as Error).message.slice(0, 500),
          },
        },
      );
      throw error;
    }
  }

  // ------------------------------------------------------------------ reconciliation
  /**
   * Scheduled reconciliation against the gateway. Recovers: closed browsers, lost/late webhooks,
   * crashes between commit steps, and stuck webhook events. Idempotent throughout.
   */
  async reconcile(
    now = new Date(),
  ): Promise<{ payments: number; allocations: number; events: number; refunds: number }> {
    const result = { payments: 0, allocations: 0, events: 0, refunds: 0 };
    const open = await PaymentModel.find({
      status: { $in: ['INITIATED', 'PENDING'] },
      createdAt: {
        $lt: new Date(now.getTime() - 60_000),
        $gt: new Date(now.getTime() - 7 * 86_400_000),
      },
    })
      .sort({ createdAt: 1 })
      .limit(100)
      .lean<PaymentRecord[]>();
    for (const payment of open) {
      try {
        const attempts = await this.deps.provider.fetchOrderPayments(payment.providerOrderId);
        const success = attempts.find(
          (p) => p.status === 'captured' || p.status === 'authorized' || p.status === 'refunded',
        );
        if (success) await this.applyProviderPayment(payment, success, 'RECONCILIATION');
        else if (
          attempts.length > 0 &&
          attempts.every((p) => p.status === 'failed') &&
          now.getTime() - payment.createdAt.getTime() > 30 * 60_000
        ) {
          await this.settleFailure(
            payment._id,
            attempts[attempts.length - 1]?.errorDescription ?? 'Payment failed',
          );
        }
        await PaymentModel.updateOne({ _id: payment._id }, { $set: { lastReconciledAt: now } });
        result.payments += 1;
      } catch (error) {
        this.deps.logger.warn(
          { err: (error as Error).message, paymentId: payment._id.toString() },
          'Payment reconciliation failed',
        );
      }
    }
    // Captured payments whose booking never got allocated (e.g. a crash between transactions).
    const unallocated = await BookingModel.find(
      { bookingStatus: { $in: AWAITING_ALLOCATION }, paymentStatus: 'SUCCESS' },
      { _id: 1 },
    )
      .limit(100)
      .lean<BookingRecord[]>();
    for (const booking of unallocated) {
      const payment = await PaymentModel.findOne({ bookingId: booking._id, status: 'SUCCESS' })
        .sort({ createdAt: 1 })
        .lean<PaymentRecord>();
      if (payment && (await this.allocateAfterPayment(payment._id)) !== 'noop')
        result.allocations += 1;
    }
    // Webhook events stuck after a crash or a transient failure.
    const stuck = await PaymentEventModel.find({
      processingStatus: { $in: ['RECEIVED', 'FAILED'] },
      receivedAt: { $lt: new Date(now.getTime() - 60_000) },
      attempts: { $lt: 10 },
    })
      .limit(100)
      .lean<PaymentEventRecord[]>();
    for (const ev of stuck) {
      try {
        if (ev.payload.paymentId && typeof ev.payload.paymentId === 'string') {
          const payment = await PaymentModel.findOne({
            providerOrderId: ev.payload.orderId as string,
          }).lean<PaymentRecord>();
          if (payment)
            await this.applyProviderPayment(
              payment,
              await this.deps.provider.fetchPayment(ev.payload.paymentId),
              'RECONCILIATION',
            );
        }
        await PaymentEventModel.updateOne(
          { _id: ev._id },
          { $set: { processingStatus: 'PROCESSED', processedAt: now }, $inc: { attempts: 1 } },
        );
        result.events += 1;
      } catch (error) {
        await PaymentEventModel.updateOne(
          { _id: ev._id },
          {
            $inc: { attempts: 1 },
            $set: { failureReason: (error as Error).message.slice(0, 500) },
          },
        );
      }
    }
    result.refunds = await this.deps.refunds.reconcile(now);
    return result;
  }

  // ------------------------------------------------------------------ sandbox (dev/test only)
  async sandboxComplete(
    auth: AuthContext,
    reference: string,
    input: { outcome: 'success' | 'failure'; deliverWebhook: boolean },
  ): Promise<SandboxCompletionDto> {
    const provider = this.deps.provider;
    if (!(provider instanceof SandboxPaymentProvider)) throw Errors.notFound('Resource');
    const booking = await this.deps.bookings.findOwned(auth.userId, reference);
    const payment = await PaymentModel.findOne({
      bookingId: booking._id,
      status: { $in: ['INITIATED', 'PENDING'] },
    })
      .sort({ createdAt: -1 })
      .lean<PaymentRecord>();
    if (!payment) throw new AppError(409, 'INVALID_STATE', 'Start the payment first.');
    const result = await provider.simulateCheckout(payment.providerOrderId, input.outcome);
    if (input.deliverWebhook) {
      const hook = provider.buildWebhook(
        input.outcome === 'success' ? 'payment.captured' : 'payment.failed',
        { payment: result.payment },
      );
      // Delivered out of band, like a real gateway, after the response.
      setTimeout(() => {
        this.handleWebhook(hook.body, {
          'x-razorpay-signature': hook.signature,
          'x-razorpay-event-id': hook.eventId,
        }).catch((error: unknown) =>
          this.deps.logger.warn(
            { err: (error as Error).message },
            'Sandbox webhook delivery failed',
          ),
        );
      }, 250).unref();
    }
    return {
      providerOrderId: payment.providerOrderId,
      providerPaymentId: result.paymentId,
      signature: result.signature,
    };
  }

  async listForCustomer(customerId: string): Promise<PaymentDto[]> {
    const payments = await PaymentModel.find({ customerId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean<PaymentRecord[]>();
    const bookings = await BookingModel.find(
      { _id: { $in: payments.map((p) => p.bookingId) } },
      { bookingReference: 1, hotelSnapshot: 1 },
    ).lean<BookingRecord[]>();
    return payments.flatMap((p) => {
      const b = bookings.find((x) => x._id.equals(p.bookingId));
      return b ? [toPaymentDto(p, b)] : [];
    });
  }
}
