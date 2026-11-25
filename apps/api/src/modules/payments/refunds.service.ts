import { Types, type ClientSession } from 'mongoose';
import type { RefundDto } from '@stayscape/shared';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import type { Logger } from '@/lib/logger';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import {
  BookingModel,
  CancellationModel,
  type BookingRecord,
} from '@/modules/bookings/booking.models';
import { toRefundDto } from '@/modules/bookings/booking.mapper';
import { statusEvent } from '@/modules/bookings/bookings.service';
import type { OutboxService } from '@/modules/outbox/outbox.service';
import {
  PaymentModel,
  RefundModel,
  type PaymentRecord,
  type RefundRecord,
  type RefundSource,
} from './payment.models';
import { syncBookingPaymentStatus } from './payment-status';
import {
  PaymentProviderError,
  type PaymentProvider,
  type ProviderRefund,
} from './providers/payment-provider';

const IN_FLIGHT = ['REQUESTED', 'APPROVED', 'PROCESSING'] as const;
/** A PROCESSING refund with no provider id older than this is checked at the provider before retrying. */
const STALE_PROCESSING_MS = 2 * 60_000;

interface Deps {
  provider: PaymentProvider;
  outbox: OutboxService;
  audit: AuditService;
  logger: Logger;
}

/**
 * Refund lifecycle: REQUESTED → APPROVED → PROCESSING → SUCCEEDED | FAILED (FAILED → APPROVED on
 * admin retry; REQUESTED → REJECTED). Guarantees:
 *  - one refund per approved operation (unique idempotencyKey);
 *  - one provider refund per refund: APPROVED → PROCESSING is an atomic claim, and a retry of a
 *    refund whose provider response was lost first looks it up at the provider by receipt;
 *  - SUCCEEDED only when the provider reports the refund processed (response, webhook or
 *    reconciliation fetch) — never on our own say-so;
 *  - amounts can never exceed what was captured (checked against all non-failed refunds).
 */
export class RefundsService {
  constructor(private readonly deps: Deps) {}

  private async committedOnPayment(
    paymentId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    const refunds = await RefundModel.find(
      { paymentId, status: { $nin: ['FAILED', 'REJECTED'] } },
      { amountMinor: 1 },
      session ? { session } : {},
    ).lean<RefundRecord[]>();
    return refunds.reduce((s, r) => s + r.amountMinor, 0);
  }

  /** Refundable balance of one payment (captured − refunds that are not failed/rejected). */
  async balance(payment: PaymentRecord, session?: ClientSession): Promise<number> {
    if (!['SUCCESS', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].includes(payment.status)) return 0;
    return Math.max(0, payment.amountMinor - (await this.committedOnPayment(payment._id, session)));
  }

  /**
   * Create (or return) an APPROVED refund inside the caller's transaction and schedule processing.
   */
  async createApproved(
    params: {
      booking: Pick<BookingRecord, '_id' | 'customerId'>;
      payment: PaymentRecord;
      amountMinor: number;
      reason: string;
      source: RefundSource;
      idempotencyKey: string;
      requestedBy: string | null;
      decidedBy: string | null;
    },
    session: ClientSession,
  ): Promise<RefundRecord> {
    const existing = await RefundModel.findOne({ idempotencyKey: params.idempotencyKey }, null, {
      session,
    }).lean<RefundRecord>();
    if (existing) return existing;
    if (!Number.isSafeInteger(params.amountMinor) || params.amountMinor < 1)
      throw Errors.badRequest('Refund amount must be a positive integer amount.');
    const available = await this.balance(params.payment, session);
    if (params.amountMinor > available) {
      throw new AppError(
        409,
        'CONFLICT',
        `Only ${available} (minor units) can still be refunded on this payment.`,
      );
    }
    const now = new Date();
    const [refund] = await RefundModel.create(
      [
        {
          bookingId: params.booking._id,
          paymentId: params.payment._id,
          customerId: params.booking.customerId,
          amountMinor: params.amountMinor,
          currency: params.payment.currency,
          reason: params.reason,
          source: params.source,
          status: 'APPROVED',
          idempotencyKey: params.idempotencyKey,
          requestedBy: params.requestedBy ? new Types.ObjectId(params.requestedBy) : null,
          decidedBy: params.decidedBy ? new Types.ObjectId(params.decidedBy) : null,
          requestedAt: now,
          approvedAt: now,
        },
      ],
      { session },
    );
    const record = refund!.toObject() as RefundRecord;
    await PaymentModel.updateOne(
      {
        _id: params.payment._id,
        status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUND_PENDING'] },
      },
      { $set: { status: 'REFUND_PENDING' } },
      { session },
    );
    await syncBookingPaymentStatus(params.booking._id, session);
    await this.scheduleProcessing(record, session);
    await this.deps.outbox.add(
      {
        eventId: `refund.requested.${record._id}`,
        type: 'refund.requested',
        aggregateType: 'Refund',
        aggregateId: record._id.toString(),
        payload: {},
      },
      session,
    );
    return record;
  }

  private scheduleProcessing(
    refund: Pick<RefundRecord, '_id' | 'attempts'>,
    session: ClientSession | null,
  ) {
    // A distinct event per attempt so an admin retry is not swallowed by queue de-duplication.
    return this.deps.outbox.add(
      {
        eventId: `refund.process.${refund._id}.${refund.attempts}`,
        type: 'refund.process',
        aggregateType: 'Refund',
        aggregateId: refund._id.toString(),
        payload: {},
      },
      session,
    );
  }

  /** A customer asks for (more of) a refund on a cancelled booking. Needs an administrator decision. */
  async request(params: {
    booking: BookingRecord;
    payment: PaymentRecord;
    reason: string;
    userId: string;
  }): Promise<RefundRecord> {
    const available = await this.balance(params.payment);
    if (available < 1)
      throw new AppError(409, 'NOT_ELIGIBLE', 'There is nothing left to refund on this booking.');
    try {
      const [refund] = await RefundModel.create([
        {
          bookingId: params.booking._id,
          paymentId: params.payment._id,
          customerId: params.booking.customerId,
          // Proposed amount (the remaining balance); the administrator decides the final amount.
          amountMinor: available,
          currency: params.payment.currency,
          reason: params.reason,
          source: 'CUSTOMER_REQUEST',
          status: 'REQUESTED',
          idempotencyKey: `customer-request.${params.booking._id}`,
          requestedBy: new Types.ObjectId(params.userId),
          requestedAt: new Date(),
        },
      ]);
      const record = refund!.toObject() as RefundRecord;
      await this.deps.outbox.add(
        {
          eventId: `refund.requested.${record._id}`,
          type: 'refund.requested',
          aggregateType: 'Refund',
          aggregateId: record._id.toString(),
          payload: { needsDecision: true },
        },
        null,
      );
      await this.deps.outbox.kick();
      return record;
    } catch (error) {
      if (isMongoDuplicateKey(error))
        throw new AppError(409, 'CONFLICT', 'A refund request for this booking already exists.');
      throw error;
    }
  }

  async decide(
    adminId: string,
    refundId: string,
    decision: { decision: 'APPROVE'; amountMinor: number } | { decision: 'REJECT'; reason: string },
  ): Promise<RefundRecord> {
    if (!Types.ObjectId.isValid(refundId)) throw Errors.notFound('Refund');
    const result = await withTransaction(async (session) => {
      const refund = await RefundModel.findOne({ _id: refundId, status: 'REQUESTED' }, null, {
        session,
      }).lean<RefundRecord>();
      if (!refund)
        throw new AppError(409, 'INVALID_STATE', 'Only requested refunds can be decided.');
      if (decision.decision === 'REJECT') {
        return RefundModel.findOneAndUpdate(
          { _id: refund._id, status: 'REQUESTED' },
          {
            $set: {
              status: 'REJECTED',
              decidedBy: new Types.ObjectId(adminId),
              failureReason: decision.reason,
            },
          },
          { session, new: true },
        ).lean<RefundRecord>();
      }
      const payment = await PaymentModel.findById(refund.paymentId, null, {
        session,
      }).lean<PaymentRecord>();
      if (!payment) throw Errors.notFound('Payment');
      // The request itself is counted in the balance; exclude it when checking the approved amount.
      const available = (await this.balance(payment, session)) + refund.amountMinor;
      if (decision.amountMinor > available)
        throw new AppError(409, 'CONFLICT', `At most ${available} (minor units) can be refunded.`);
      const approved = await RefundModel.findOneAndUpdate(
        { _id: refund._id, status: 'REQUESTED' },
        {
          $set: {
            status: 'APPROVED',
            amountMinor: decision.amountMinor,
            approvedAt: new Date(),
            decidedBy: new Types.ObjectId(adminId),
          },
        },
        { session, new: true },
      ).lean<RefundRecord>();
      await PaymentModel.updateOne(
        { _id: payment._id, status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED'] } },
        { $set: { status: 'REFUND_PENDING' } },
        { session },
      );
      await syncBookingPaymentStatus(refund.bookingId, session);
      await this.scheduleProcessing(approved!, session);
      return approved;
    });
    await this.deps.outbox.kick();
    await this.deps.audit.record({
      actorId: adminId,
      action: `refund.${decision.decision.toLowerCase()}`,
      entityType: 'Refund',
      entityId: refundId,
      metadata: decision,
    });
    return result!;
  }

  /**
   * Initiate an approved refund at the provider. Idempotent and crash-safe (see class comment).
   * Throws on a transient provider failure so the job is retried.
   */
  async process(refundId: string, now = new Date()): Promise<RefundRecord | null> {
    let refund = await RefundModel.findOneAndUpdate(
      { _id: refundId, status: 'APPROVED' },
      { $set: { status: 'PROCESSING', processingAt: new Date() }, $inc: { attempts: 1 } },
      { new: true },
    ).lean<RefundRecord>();
    if (!refund) {
      const current = await RefundModel.findById(refundId).lean<RefundRecord>();
      // Recover a PROCESSING refund whose provider response was lost (no id recorded yet).
      if (
        !current ||
        current.status !== 'PROCESSING' ||
        current.providerRefundId ||
        (current.processingAt &&
          now.getTime() - current.processingAt.getTime() < STALE_PROCESSING_MS)
      )
        return current;
      refund = current;
    }
    const payment = await PaymentModel.findById(refund.paymentId).lean<PaymentRecord>();
    if (!payment?.providerPaymentId) {
      return this.markFailed(refund._id, 'The original payment has no provider reference.');
    }
    const receipt = refund._id.toString();
    // Never create twice: if a previous attempt reached the provider, adopt that refund. A refund
    // the provider already rejected is not adopted (an administrator retry needs a new one).
    const existing = (await this.deps.provider.listRefunds(payment.providerPaymentId)).find(
      (r) => r.receipt === receipt && r.status !== 'failed',
    );
    if (existing) return this.applyProviderRefund(refund._id, existing);
    let providerRefund: ProviderRefund;
    try {
      providerRefund = await this.deps.provider.createRefund({
        paymentId: payment.providerPaymentId,
        amountMinor: refund.amountMinor,
        receipt,
        notes: { refundId: receipt, bookingId: refund.bookingId.toString() },
      });
    } catch (error) {
      if (error instanceof PaymentProviderError && error.definitive)
        return this.markFailed(refund._id, error.message);
      // Unknown outcome: stay PROCESSING; the retry looks the refund up by receipt first.
      this.deps.logger.warn(
        { err: (error as Error).message, refundId },
        'Refund initiation outcome unknown; will reconcile',
      );
      throw error;
    }
    return this.applyProviderRefund(refund._id, providerRefund);
  }

  /** Apply the provider's view of a refund (response, webhook or reconciliation). */
  async applyProviderRefund(
    refundId: Types.ObjectId,
    providerRefund: ProviderRefund,
  ): Promise<RefundRecord | null> {
    await RefundModel.updateOne(
      { _id: refundId, providerRefundId: null },
      { $set: { providerRefundId: providerRefund.id } },
    );
    if (providerRefund.status === 'processed') return this.markSucceeded(refundId);
    if (providerRefund.status === 'failed')
      return this.markFailed(refundId, 'The payment provider rejected the refund.');
    return RefundModel.findById(refundId).lean<RefundRecord>();
  }

  /** Webhook/reconciliation entry point: find our refund by provider id or receipt. */
  async handleProviderRefund(providerRefund: ProviderRefund): Promise<boolean> {
    const byId = await RefundModel.findOne({
      providerRefundId: providerRefund.id,
    }).lean<RefundRecord>();
    const refund =
      byId ??
      (providerRefund.receipt && Types.ObjectId.isValid(providerRefund.receipt)
        ? await RefundModel.findById(providerRefund.receipt).lean<RefundRecord>()
        : null);
    if (!refund) return false;
    await this.applyProviderRefund(refund._id, providerRefund);
    return true;
  }

  private async markSucceeded(refundId: Types.ObjectId): Promise<RefundRecord | null> {
    const result = await withTransaction(async (session) => {
      const refund = await RefundModel.findOneAndUpdate(
        { _id: refundId, status: 'PROCESSING' },
        { $set: { status: 'SUCCEEDED', completedAt: new Date(), failureReason: null } },
        { session, new: true },
      ).lean<RefundRecord>();
      if (!refund) return RefundModel.findById(refundId, null, { session }).lean<RefundRecord>(); // already final
      const payment = await PaymentModel.findOneAndUpdate(
        { _id: refund.paymentId },
        { $inc: { refundedMinor: refund.amountMinor } },
        { session, new: true },
      ).lean<PaymentRecord>();
      if (payment) {
        const inflight = await RefundModel.countDocuments(
          { paymentId: payment._id, status: { $in: IN_FLIGHT } },
          { session },
        );
        const status =
          payment.refundedMinor >= payment.amountMinor
            ? 'REFUNDED'
            : inflight > 0
              ? 'REFUND_PENDING'
              : 'PARTIALLY_REFUNDED';
        await PaymentModel.updateOne({ _id: payment._id }, { $set: { status } }, { session });
      }
      await syncBookingPaymentStatus(refund.bookingId, session);
      // A cancellation whose refund settled is complete.
      await CancellationModel.updateOne(
        { refundId: refund._id },
        { $set: { status: 'COMPLETED' } },
        { session },
      );
      // Reconciliation exception resolved by a full refund → the booking ends as cancelled.
      if (refund.source === 'RECONCILIATION') {
        await BookingModel.updateOne(
          { _id: refund.bookingId, bookingStatus: 'RECONCILIATION_REQUIRED' },
          {
            $set: { bookingStatus: 'CANCELLED', cancelledAt: new Date() },
            $push: {
              statusHistory: statusEvent(
                'CANCELLED',
                'Rooms were unavailable — payment refunded in full',
              ),
            },
          },
          { session },
        );
      }
      await this.deps.outbox.add(
        {
          eventId: `refund.completed.${refund._id}`,
          type: 'refund.completed',
          aggregateType: 'Refund',
          aggregateId: refund._id.toString(),
          payload: {},
        },
        session,
      );
      return refund;
    });
    await this.deps.outbox.kick();
    return result;
  }

  private async markFailed(refundId: Types.ObjectId, reason: string): Promise<RefundRecord | null> {
    const result = await withTransaction(async (session) => {
      const refund = await RefundModel.findOneAndUpdate(
        { _id: refundId, status: 'PROCESSING' },
        { $set: { status: 'FAILED', failureReason: reason.slice(0, 500) } },
        { session, new: true },
      ).lean<RefundRecord>();
      if (!refund) return RefundModel.findById(refundId, null, { session }).lean<RefundRecord>();
      // Compensation: the money was not returned, so the payment no longer shows a refund in progress.
      const payment = await PaymentModel.findById(refund.paymentId, null, {
        session,
      }).lean<PaymentRecord>();
      if (payment && payment.status === 'REFUND_PENDING') {
        const inflight = await RefundModel.countDocuments(
          { paymentId: payment._id, status: { $in: IN_FLIGHT } },
          { session },
        );
        if (inflight === 0)
          await PaymentModel.updateOne(
            { _id: payment._id },
            { $set: { status: payment.refundedMinor > 0 ? 'PARTIALLY_REFUNDED' : 'SUCCESS' } },
            { session },
          );
      }
      await syncBookingPaymentStatus(refund.bookingId, session);
      // Escalation: operations are alerted and the failure is audited.
      await this.deps.outbox.add(
        {
          eventId: `refund.failed.${refund._id}.${refund.attempts}`,
          type: 'refund.failed',
          aggregateType: 'Refund',
          aggregateId: refund._id.toString(),
          payload: {},
        },
        session,
      );
      return refund;
    });
    await this.deps.audit.record({
      actorId: null,
      action: 'refund.failed',
      entityType: 'Refund',
      entityId: refundId.toString(),
      metadata: { reason },
    });
    await this.deps.outbox.kick();
    return result;
  }

  /** Administrator retry of a failed refund (FAILED → APPROVED → processed again). */
  async retry(adminId: string, refundId: string): Promise<RefundRecord> {
    if (!Types.ObjectId.isValid(refundId)) throw Errors.notFound('Refund');
    const refund = await withTransaction(async (session) => {
      const updated = await RefundModel.findOneAndUpdate(
        { _id: refundId, status: 'FAILED' },
        {
          $set: {
            status: 'APPROVED',
            failureReason: null,
            providerRefundId: null,
            decidedBy: new Types.ObjectId(adminId),
          },
        },
        { session, new: true },
      ).lean<RefundRecord>();
      if (!updated) throw new AppError(409, 'INVALID_STATE', 'Only failed refunds can be retried.');
      const payment = await PaymentModel.findById(updated.paymentId, null, {
        session,
      }).lean<PaymentRecord>();
      const committedElsewhere =
        (await this.committedOnPayment(updated.paymentId, session)) - updated.amountMinor;
      if (!payment || committedElsewhere + updated.amountMinor > payment.amountMinor)
        throw new AppError(409, 'CONFLICT', 'This refund would exceed the captured amount.');
      await PaymentModel.updateOne(
        { _id: payment._id, status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED'] } },
        { $set: { status: 'REFUND_PENDING' } },
        { session },
      );
      await syncBookingPaymentStatus(updated.bookingId, session);
      await this.scheduleProcessing(updated, session);
      return updated;
    });
    await this.deps.outbox.kick();
    await this.deps.audit.record({
      actorId: adminId,
      action: 'refund.retried',
      entityType: 'Refund',
      entityId: refundId,
    });
    return refund;
  }

  /** Scheduled reconciliation: re-drive lost approvals and ask the provider about pending refunds. */
  async reconcile(now = new Date()): Promise<number> {
    let touched = 0;
    const stale = new Date(now.getTime() - STALE_PROCESSING_MS);
    const approved = await RefundModel.find(
      { status: 'APPROVED', approvedAt: { $lt: stale } },
      { _id: 1 },
    )
      .limit(100)
      .lean<RefundRecord[]>();
    for (const r of approved) {
      await this.process(r._id.toString(), now).catch((e: unknown) =>
        this.deps.logger.warn({ err: (e as Error).message }, 'Refund reconcile (approved) failed'),
      );
      touched += 1;
    }
    const processing = await RefundModel.find({
      status: 'PROCESSING',
      processingAt: { $lt: stale },
    })
      .limit(100)
      .lean<RefundRecord[]>();
    for (const r of processing) {
      try {
        if (!r.providerRefundId) {
          await this.process(r._id.toString(), now);
        } else {
          const payment = await PaymentModel.findById(r.paymentId).lean<PaymentRecord>();
          if (payment?.providerPaymentId)
            await this.applyProviderRefund(
              r._id,
              await this.deps.provider.fetchRefund(payment.providerPaymentId, r.providerRefundId),
            );
        }
        await RefundModel.updateOne({ _id: r._id }, { $set: { lastReconciledAt: now } });
        touched += 1;
      } catch (error) {
        this.deps.logger.warn(
          { err: (error as Error).message, refundId: r._id.toString() },
          'Refund reconcile failed',
        );
      }
    }
    return touched;
  }

  async listForCustomer(customerId: string): Promise<RefundDto[]> {
    const refunds = await RefundModel.find({ customerId })
      .sort({ requestedAt: -1 })
      .limit(200)
      .lean<RefundRecord[]>();
    const bookings = await BookingModel.find(
      { _id: { $in: refunds.map((r) => r.bookingId) } },
      { bookingReference: 1, hotelSnapshot: 1 },
    ).lean<BookingRecord[]>();
    return refunds.flatMap((r) => {
      const b = bookings.find((x) => x._id.equals(r.bookingId));
      return b ? [toRefundDto(r, b)] : [];
    });
  }
}
