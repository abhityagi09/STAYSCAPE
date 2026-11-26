import { Types, type ClientSession, type PipelineStage } from 'mongoose';
import type { CurrencyCode, Paginated } from '@stayscape/shared';
import type { Config } from '@/config/env';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { Logger } from '@/lib/logger';
import { randomCode } from '@/lib/references';
import type { RequestContext } from '@/lib/request-context';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import { BookingModel, type BookingRecord } from '@/modules/bookings/booking.models';
import { PartnerModel, type PartnerRecord } from '@/modules/partners/partner.model';
import { PaymentModel, type PaymentRecord, type RefundRecord } from '@/modules/payments/payment.models';
import { PAID_FAMILY } from '@/modules/payments/payment-status';
import { calculateCommission, proportionalShare, selectCommissionRule, type CommissionResult, type CommissionRuleInput, type PriceTotals } from './commission';
import {
  CommissionRuleModel,
  LedgerEntryModel,
  SettlementAllocationModel,
  SettlementModel,
  type CommissionRuleRecord,
  type LedgerAccount,
  type LedgerEntryAttrs,
  type LedgerEntryRecord,
  type LedgerEvent,
  type SettlementRecord,
  type SettlementStatus,
} from './finance.models';

export interface CommissionSnapshot extends CommissionResult {
  currency: CurrencyCode;
  computedAt: Date;
}

type NewEntry = Omit<LedgerEntryAttrs, 'createdAt' | 'settlementId' | 'paymentId' | 'refundId' | 'providerReference' | 'bookingId' | 'partnerId' | 'hotelId'> &
  Partial<Pick<LedgerEntryAttrs, 'settlementId' | 'paymentId' | 'refundId' | 'providerReference' | 'bookingId' | 'partnerId' | 'hotelId'>>;

const ruleInput = (r: CommissionRuleRecord): CommissionRuleInput => ({
  id: r._id.toString(),
  name: r.name,
  scope: r.scope,
  partnerId: r.partnerId?.toString() ?? null,
  hotelId: r.hotelId?.toString() ?? null,
  rateBasisPoints: r.rateBasisPoints,
  fixedMinor: r.fixedMinor,
  base: r.base,
  includeFees: r.includeFees,
  promotional: r.promotional,
  exempt: r.exempt,
  effectiveFrom: r.effectiveFrom,
  effectiveTo: r.effectiveTo,
  active: r.active,
});

const SETTLEMENT_TRANSITIONS: Record<SettlementStatus, readonly SettlementStatus[]> = {
  PENDING: ['ELIGIBLE', 'ON_HOLD', 'FAILED'],
  ELIGIBLE: ['PROCESSING', 'ON_HOLD', 'PAID', 'FAILED'],
  ON_HOLD: ['ELIGIBLE', 'FAILED'],
  PROCESSING: ['PAID', 'FAILED'],
  PAID: [],
  FAILED: [],
};

/**
 * Commission, ledger and settlements.
 * - Commission is snapshotted when payment confirms the booking (the transaction event) and never
 *   recomputed: later rule changes do not alter past bookings.
 * - Ledger entries are written in the same transaction as the business event, with unique keys
 *   (insert-only upserts never abort the surrounding transaction on a retry).
 * - A settlement is a set of ledger entries; it can only become PAID with recorded evidence.
 */
export class FinanceService {
  constructor(
    private readonly deps: {
      config: Pick<Config, 'COMMISSION_DEFAULT_BASIS_POINTS' | 'SETTLEMENT_HOLD_DAYS' | 'PAYOUT_PROVIDER'>;
      audit: AuditService;
      logger: Logger;
    },
  ) {}

  // ------------------------------------------------------------------ ledger primitives
  private async append(entries: NewEntry[], session: ClientSession | null): Promise<void> {
    if (entries.length === 0) return;
    const now = new Date();
    await LedgerEntryModel.collection.bulkWrite(
      entries.map((e) => ({
        updateOne: {
          filter: { entryKey: e.entryKey },
          update: {
            $setOnInsert: {
              bookingId: null,
              partnerId: null,
              hotelId: null,
              paymentId: null,
              refundId: null,
              settlementId: null,
              providerReference: null,
              ...e,
              createdAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: true, ...(session ? { session } : {}) },
    );
  }

  // ------------------------------------------------------------------ commission
  async resolveCommission(booking: Pick<BookingRecord, 'partnerId' | 'hotelId' | 'priceSnapshot'>, at: Date, session?: ClientSession): Promise<CommissionSnapshot> {
    const rules = await CommissionRuleModel.find({ active: true }, null, session ? { session } : {}).lean<CommissionRuleRecord[]>();
    const rule = selectCommissionRule(rules.map(ruleInput), { partnerId: booking.partnerId.toString(), hotelId: booking.hotelId.toString(), at });
    return { ...calculateCommission(booking.priceSnapshot.totals, rule, this.deps.config.COMMISSION_DEFAULT_BASIS_POINTS), currency: booking.priceSnapshot.currency, computedAt: at };
  }

  /**
   * Booking confirmed with captured payment: snapshot commission and post the balanced entries
   *   CASH +paid · PARTNER_PAYABLE +(gross − commission) · PLATFORM_REVENUE +commission · PROMOTION_EXPENSE −coupon
   * where gross = paid + platform-funded coupon discount.
   */
  async onBookingConfirmed(bookingId: Types.ObjectId, session: ClientSession): Promise<void> {
    const booking = await BookingModel.findById(bookingId, null, { session }).lean<BookingRecord>();
    if (!booking) return;
    const payment = await PaymentModel.findOne({ bookingId, status: { $in: PAID_FAMILY } }, null, { session }).sort({ createdAt: 1 }).lean<PaymentRecord>();
    if (!payment) return;
    const now = new Date();
    const snapshot = booking.commissionSnapshot ?? (await this.resolveCommission(booking, now, session));
    if (!booking.commissionSnapshot) await BookingModel.updateOne({ _id: booking._id, commissionSnapshot: null }, { $set: { commissionSnapshot: snapshot } }, { session });
    const coupon = booking.priceSnapshot.coupon?.discountMinor ?? 0;
    const paid = payment.amountMinor;
    const gross = paid + coupon;
    const base = { bookingId: booking._id, partnerId: booking.partnerId, hotelId: booking.hotelId, paymentId: payment._id, currency: payment.currency, event: 'BOOKING_CONFIRMED' as LedgerEvent, occurredAt: now, providerReference: payment.providerPaymentId };
    const key = `booking.${booking._id}`;
    await this.append(
      [
        { ...base, entryKey: `${key}.cash`, account: 'CASH', amountMinor: paid, description: `Payment captured for ${booking.bookingReference}` },
        { ...base, entryKey: `${key}.payable`, account: 'PARTNER_PAYABLE', amountMinor: gross - snapshot.commissionMinor, description: `Payable to property for ${booking.bookingReference}` },
        { ...base, entryKey: `${key}.commission`, account: 'PLATFORM_REVENUE', amountMinor: snapshot.commissionMinor, description: `Commission (${snapshot.ruleName}) on ${booking.bookingReference}` },
        ...(coupon ? [{ ...base, entryKey: `${key}.promotion`, account: 'PROMOTION_EXPENSE' as LedgerAccount, amountMinor: -coupon, description: `Platform-funded coupon on ${booking.bookingReference}` }] : []),
      ],
      session,
    );
  }

  /**
   * Refund confirmed by the provider. For a confirmed stay the platform returns the same share of
   * its commission (and of coupon funding); the rest reduces the partner payable. Refunds of
   * payments never allocated to a stay only move UNALLOCATED funds.
   */
  async onRefundSucceeded(refund: RefundRecord, session: ClientSession): Promise<void> {
    const booking = await BookingModel.findById(refund.bookingId, null, { session }).lean<BookingRecord>();
    const payment = await PaymentModel.findById(refund.paymentId, null, { session }).lean<PaymentRecord>();
    if (!booking || !payment) return;
    const now = new Date();
    const base = { bookingId: booking._id, partnerId: booking.partnerId, hotelId: booking.hotelId, paymentId: payment._id, refundId: refund._id, currency: refund.currency, event: 'REFUND_SUCCEEDED' as LedgerEvent, occurredAt: now, providerReference: refund.providerRefundId };
    const key = `refund.${refund._id}`;
    const allocated = await LedgerEntryModel.exists({ entryKey: `booking.${booking._id}.payable`, paymentId: payment._id }).session(session);
    if (!allocated) {
      await this.append(
        [
          { ...base, entryKey: `${key}.cash`, account: 'CASH', amountMinor: -refund.amountMinor, description: `Refund of unallocated payment (${booking.bookingReference})` },
          { ...base, entryKey: `${key}.unallocated`, account: 'UNALLOCATED', amountMinor: -refund.amountMinor, description: `Refund of unallocated payment (${booking.bookingReference})` },
        ],
        session,
      );
      return;
    }
    const commission = booking.commissionSnapshot?.commissionMinor ?? 0;
    const coupon = booking.priceSnapshot.coupon?.discountMinor ?? 0;
    const revenueDelta = -proportionalShare(commission, refund.amountMinor, payment.amountMinor);
    const promoDelta = proportionalShare(coupon, refund.amountMinor, payment.amountMinor);
    const payableDelta = -refund.amountMinor - revenueDelta - promoDelta;
    await this.append(
      [
        { ...base, entryKey: `${key}.cash`, account: 'CASH', amountMinor: -refund.amountMinor, description: `Refund on ${booking.bookingReference}` },
        { ...base, entryKey: `${key}.payable`, account: 'PARTNER_PAYABLE', amountMinor: payableDelta, description: `Refund adjustment for ${booking.bookingReference}` },
        ...(revenueDelta ? [{ ...base, entryKey: `${key}.commission`, account: 'PLATFORM_REVENUE' as LedgerAccount, amountMinor: revenueDelta, description: `Commission reversal on ${booking.bookingReference}` }] : []),
        ...(promoDelta ? [{ ...base, entryKey: `${key}.promotion`, account: 'PROMOTION_EXPENSE' as LedgerAccount, amountMinor: promoDelta, description: `Coupon funding reversal on ${booking.bookingReference}` }] : []),
      ],
      session,
    );
  }

  /** A captured payment that could not be allocated to a stay (duplicate or late). */
  async onUnallocatedCapture(payment: PaymentRecord, booking: BookingRecord, session: ClientSession): Promise<void> {
    const base = { bookingId: booking._id, partnerId: booking.partnerId, hotelId: booking.hotelId, paymentId: payment._id, currency: payment.currency, event: 'UNALLOCATED_CAPTURE' as LedgerEvent, occurredAt: new Date(), providerReference: payment.providerPaymentId };
    await this.append(
      [
        { ...base, entryKey: `payment.${payment._id}.unallocated.cash`, account: 'CASH', amountMinor: payment.amountMinor, description: `Unallocated payment on ${booking.bookingReference}` },
        { ...base, entryKey: `payment.${payment._id}.unallocated`, account: 'UNALLOCATED', amountMinor: payment.amountMinor, description: `Unallocated payment on ${booking.bookingReference}` },
      ],
      session,
    );
  }

  /** Self-healing sweep: confirmed paid bookings missing their ledger postings (e.g. pre-Phase 4 data). */
  async backfillConfirmedBookings(limit = 200): Promise<number> {
    const bookings = await BookingModel.find({ bookingStatus: { $in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED', 'CANCELLED'] }, commissionSnapshot: null, paymentStatus: { $in: PAID_FAMILY } }, { _id: 1 })
      .limit(limit)
      .lean<Array<{ _id: Types.ObjectId }>>();
    let done = 0;
    for (const b of bookings) {
      const confirmed = await BookingModel.exists({ _id: b._id, confirmedAt: { $ne: null } });
      if (!confirmed) continue;
      await withTransaction((s) => this.onBookingConfirmed(b._id, s));
      done += 1;
    }
    return done;
  }

  // ------------------------------------------------------------------ commission rules (admin)
  listRules(): Promise<CommissionRuleRecord[]> {
    return CommissionRuleModel.find().sort({ active: -1, scope: 1, effectiveFrom: -1 }).limit(500).lean<CommissionRuleRecord[]>();
  }

  async saveRule(actorId: string, id: string | null, input: Omit<CommissionRuleInput, 'id' | 'effectiveFrom' | 'effectiveTo'> & { effectiveFrom: string; effectiveTo: string | null }, context: RequestContext): Promise<CommissionRuleRecord> {
    if (input.scope === 'PARTNER' && !input.partnerId) throw Errors.validation({ fieldErrors: { partnerId: ['Choose a partner'] } });
    if (input.scope === 'HOTEL' && !input.hotelId) throw Errors.validation({ fieldErrors: { hotelId: ['Choose a property'] } });
    const doc = {
      name: input.name,
      scope: input.scope,
      partnerId: input.scope === 'PARTNER' && input.partnerId ? new Types.ObjectId(input.partnerId) : null,
      hotelId: input.scope === 'HOTEL' && input.hotelId ? new Types.ObjectId(input.hotelId) : null,
      rateBasisPoints: input.rateBasisPoints,
      fixedMinor: input.fixedMinor,
      base: input.base,
      includeFees: input.includeFees,
      promotional: input.promotional,
      exempt: input.exempt,
      effectiveFrom: new Date(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      active: input.active,
    };
    let before: CommissionRuleRecord | null = null;
    let saved: CommissionRuleRecord | null;
    if (id) {
      if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Commission rule');
      before = await CommissionRuleModel.findById(id).lean<CommissionRuleRecord>();
      if (!before) throw Errors.notFound('Commission rule');
      saved = await CommissionRuleModel.findByIdAndUpdate(id, { $set: doc }, { new: true, runValidators: true }).lean<CommissionRuleRecord>();
    } else {
      saved = (await CommissionRuleModel.create({ ...doc, createdBy: new Types.ObjectId(actorId) })).toObject() as CommissionRuleRecord;
    }
    await this.deps.audit.record({ actorId, action: id ? 'commission_rule.updated' : 'commission_rule.created', entityType: 'CommissionRule', entityId: saved!._id.toString(), metadata: { before, after: doc }, context });
    return saved!;
  }

  /** Preview which rule would apply and the commission for a hypothetical booking total. */
  async previewCommission(partnerId: string, hotelId: string, totals: PriceTotals): Promise<CommissionResult> {
    const rules = await CommissionRuleModel.find({ active: true }).lean<CommissionRuleRecord[]>();
    return calculateCommission(totals, selectCommissionRule(rules.map(ruleInput), { partnerId, hotelId, at: new Date() }), this.deps.config.COMMISSION_DEFAULT_BASIS_POINTS);
  }

  // ------------------------------------------------------------------ balances & reporting
  /** Ledger entries for one partner that are not part of a live settlement and are eligible now. */
  private eligibleEntriesPipeline(partnerId: Types.ObjectId, cutoff: Date): PipelineStage[] {
    const holdMs = this.deps.config.SETTLEMENT_HOLD_DAYS * 86_400_000;
    const stayCutoff = new Date(cutoff.getTime() - holdMs).toISOString().slice(0, 10);
    return [
      { $match: { partnerId, account: 'PARTNER_PAYABLE', occurredAt: { $lte: cutoff } } },
      { $lookup: { from: SettlementAllocationModel.collection.collectionName, let: { id: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$entryId', '$$id'] }, released: false } }], as: 'alloc' } },
      { $match: { alloc: { $size: 0 } } },
      { $lookup: { from: BookingModel.collection.collectionName, localField: 'bookingId', foreignField: '_id', as: 'booking', pipeline: [{ $project: { bookingStatus: 1, checkOutLocalDate: 1 } }] } },
      { $unwind: '$booking' },
      // Accruals become payable once the stay is over (plus the hold period); refund adjustments always count.
      {
        $match: {
          $or: [
            { event: 'REFUND_SUCCEEDED' },
            { 'booking.bookingStatus': { $in: ['COMPLETED', 'CHECKED_OUT', 'CANCELLED', 'REJECTED'] }, 'booking.checkOutLocalDate': { $lte: stayCutoff } },
            { 'booking.bookingStatus': { $in: ['CANCELLED', 'REJECTED'] } },
          ],
        },
      },
    ];
  }

  async partnerBalance(partnerId: Types.ObjectId) {
    const now = new Date();
    const [totals, eligible] = await Promise.all([
      LedgerEntryModel.aggregate<{ _id: string; amount: number }>([{ $match: { partnerId } }, { $group: { _id: '$account', amount: { $sum: '$amountMinor' } } }]),
      LedgerEntryModel.aggregate<{ amount: number; count: number }>([...this.eligibleEntriesPipeline(partnerId, now), { $group: { _id: null, amount: { $sum: '$amountMinor' }, count: { $sum: 1 } } }]),
    ]);
    const by = (a: string) => totals.find((t) => t._id === a)?.amount ?? 0;
    const paidOut = await LedgerEntryModel.aggregate<{ amount: number }>([{ $match: { partnerId, event: 'SETTLEMENT_PAID', account: 'PARTNER_PAYABLE' } }, { $group: { _id: null, amount: { $sum: '$amountMinor' } } }]);
    return {
      outstandingPayableMinor: by('PARTNER_PAYABLE'),
      eligibleForSettlementMinor: eligible[0]?.amount ?? 0,
      eligibleEntries: eligible[0]?.count ?? 0,
      paidOutMinor: -(paidOut[0]?.amount ?? 0),
      commissionChargedMinor: by('PLATFORM_REVENUE'),
    };
  }

  async ledger(filter: { partnerId?: Types.ObjectId; account?: LedgerAccount; bookingId?: Types.ObjectId; from?: Date; to?: Date }, page: number, limit: number): Promise<Paginated<LedgerEntryRecord>> {
    const q: Record<string, unknown> = {};
    if (filter.partnerId) q.partnerId = filter.partnerId;
    if (filter.account) q.account = filter.account;
    if (filter.bookingId) q.bookingId = filter.bookingId;
    if (filter.from || filter.to) q.occurredAt = { ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lt: filter.to } : {}) };
    const [items, total] = await Promise.all([
      LedgerEntryModel.find(q).sort({ occurredAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean<LedgerEntryRecord[]>(),
      LedgerEntryModel.countDocuments(q),
    ]);
    return paginated(items, page, limit, total);
  }

  /** Totals per account for a period — the basis of the financial reports. */
  async accountTotals(from: Date, to: Date, partnerId?: Types.ObjectId) {
    const rows = await LedgerEntryModel.aggregate<{ _id: string; amount: number }>([
      { $match: { occurredAt: { $gte: from, $lt: to }, ...(partnerId ? { partnerId } : {}) } },
      { $group: { _id: '$account', amount: { $sum: '$amountMinor' } } },
    ]);
    const get = (a: LedgerAccount) => rows.find((r) => r._id === a)?.amount ?? 0;
    return { cash: get('CASH'), partnerPayable: get('PARTNER_PAYABLE'), platformRevenue: get('PLATFORM_REVENUE'), promotionExpense: get('PROMOTION_EXPENSE'), unallocated: get('UNALLOCATED') };
  }

  // ------------------------------------------------------------------ settlements
  /** Create a settlement batch for a partner from eligible, unsettled ledger entries (cut-off = now). */
  async createSettlement(actorId: string, partnerId: string, context: RequestContext): Promise<SettlementRecord> {
    if (!Types.ObjectId.isValid(partnerId)) throw Errors.notFound('Partner');
    const partner = await PartnerModel.findById(partnerId).lean<PartnerRecord>();
    if (!partner) throw Errors.notFound('Partner');
    const cutoff = new Date();
    const entries = await LedgerEntryModel.aggregate<LedgerEntryRecord>([...this.eligibleEntriesPipeline(partner._id, cutoff), { $project: { alloc: 0, booking: 0 } }]);
    if (entries.length === 0) throw new AppError(409, 'NOT_ELIGIBLE', 'Nothing is eligible for settlement yet.');
    const accrued = entries.filter((e) => e.event === 'BOOKING_CONFIRMED').reduce((s, e) => s + e.amountMinor, 0);
    const adjustments = entries.filter((e) => e.event !== 'BOOKING_CONFIRMED').reduce((s, e) => s + e.amountMinor, 0);
    const net = accrued + adjustments;
    const settlementId = new Types.ObjectId();
    try {
      await withTransaction(async (session) => {
        await SettlementModel.create(
          [
            {
              _id: settlementId,
              reference: `STL-${randomCode(8)}`,
              partnerId: partner._id,
              periodEnd: cutoff,
              currency: entries[0]!.currency,
              grossPayableMinor: accrued,
              adjustmentsMinor: adjustments,
              netPayableMinor: net,
              entryCount: entries.length,
              status: net > 0 && partner.verificationStatus === 'APPROVED' ? 'ELIGIBLE' : 'ON_HOLD',
              statusHistory: [{ status: 'PENDING', at: cutoff, by: new Types.ObjectId(actorId), note: 'Batch created' }],
              holdReason: net <= 0 ? 'Net payable is not positive (adjustments exceed accruals).' : partner.verificationStatus !== 'APPROVED' ? 'Partner account is not approved.' : null,
              createdBy: new Types.ObjectId(actorId),
            },
          ],
          { session },
        );
        // Unique liveKey per entry: two concurrent batches can never claim the same entry.
        await SettlementAllocationModel.insertMany(
          entries.map((e) => ({ entryId: e._id, settlementId, released: false, liveKey: e._id.toString() })),
          { session },
        );
      });
    } catch (error) {
      if (isMongoDuplicateKey(error)) throw new AppError(409, 'CONFLICT', 'Some entries were just settled in another batch. Try again.');
      throw error;
    }
    await this.deps.audit.record({ actorId, action: 'settlement.created', entityType: 'Settlement', entityId: settlementId.toString(), partnerId, metadata: { net, entries: entries.length }, context });
    return (await SettlementModel.findById(settlementId).lean<SettlementRecord>())!;
  }

  private async transition(actorId: string, id: string, to: SettlementStatus, patch: Record<string, unknown>, note: string | null, context: RequestContext): Promise<SettlementRecord> {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Settlement');
    const current = await SettlementModel.findById(id).lean<SettlementRecord>();
    if (!current) throw Errors.notFound('Settlement');
    if (!SETTLEMENT_TRANSITIONS[current.status].includes(to)) throw new AppError(409, 'INVALID_STATE', `A ${current.status.toLowerCase()} settlement cannot become ${to.toLowerCase()}.`);
    const updated = await SettlementModel.findOneAndUpdate(
      { _id: current._id, status: current.status },
      { $set: { status: to, ...patch }, $push: { statusHistory: { status: to, at: new Date(), by: new Types.ObjectId(actorId), note } } },
      { new: true },
    ).lean<SettlementRecord>();
    if (!updated) throw new AppError(409, 'CONFLICT', 'The settlement changed. Reload and try again.');
    await this.deps.audit.record({ actorId, action: `settlement.${to.toLowerCase()}`, entityType: 'Settlement', entityId: id, partnerId: current.partnerId.toString(), metadata: { from: current.status, to, note }, context });
    return updated;
  }

  hold(actorId: string, id: string, reason: string, context: RequestContext) {
    return this.transition(actorId, id, 'ON_HOLD', { holdReason: reason }, reason, context);
  }

  release(actorId: string, id: string, context: RequestContext) {
    return this.transition(actorId, id, 'ELIGIBLE', { holdReason: null }, 'Released from hold', context);
  }

  /** Automated payout execution. Disabled until a payout provider is onboarded (PAYOUT_PROVIDER). */
  async initiatePayout(_actorId: string, id: string): Promise<never> {
    // No payout provider is integrated yet; PAYOUT_PROVIDER only accepts 'disabled'. When one is
    // onboarded, this moves the batch to PROCESSING and the provider's webhook settles it.
    void id;
    throw new AppError(409, 'NOT_ELIGIBLE', `Automated payouts are disabled (PAYOUT_PROVIDER=${this.deps.config.PAYOUT_PROVIDER}) until a payout provider is onboarded and compliance checks are complete. Record an offline bank transfer with evidence instead.`);
  }

  /**
   * Mark a settlement PAID only with verifiable evidence of the transfer (method, provider/bank
   * reference, date and a stored proof document). Posts the payout to the ledger.
   */
  async recordPayment(actorId: string, id: string, evidence: { method: 'BANK_TRANSFER' | 'PAYOUT_PROVIDER'; providerReference: string; paidAt: string; documentKey: string | null }, context: RequestContext): Promise<SettlementRecord> {
    if (!evidence.providerReference.trim()) throw Errors.validation({ fieldErrors: { providerReference: ['A bank/provider reference is required'] } });
    if (!evidence.documentKey) throw Errors.validation({ fieldErrors: { document: ['Attach the transfer confirmation'] } });
    const current = await SettlementModel.findById(id).lean<SettlementRecord>();
    if (!current) throw Errors.notFound('Settlement');
    const paidAt = new Date(evidence.paidAt);
    const settled = await withTransaction(async (session) => {
      const updated = await SettlementModel.findOneAndUpdate(
        { _id: current._id, status: { $in: ['ELIGIBLE', 'PROCESSING'] } },
        {
          $set: { status: 'PAID', evidence: { ...evidence, paidAt, recordedBy: new Types.ObjectId(actorId) } },
          $push: { statusHistory: { status: 'PAID', at: new Date(), by: new Types.ObjectId(actorId), note: `Paid via ${evidence.method} (${evidence.providerReference})` } },
        },
        { new: true, session },
      ).lean<SettlementRecord>();
      if (!updated) throw new AppError(409, 'INVALID_STATE', 'Only eligible or processing settlements can be marked paid.');
      const base = { partnerId: current.partnerId, settlementId: current._id, currency: current.currency, event: 'SETTLEMENT_PAID' as LedgerEvent, occurredAt: paidAt, providerReference: evidence.providerReference };
      await this.append(
        [
          { ...base, entryKey: `settlement.${current._id}.cash`, account: 'CASH', amountMinor: -current.netPayableMinor, description: `Settlement ${current.reference} paid out` },
          { ...base, entryKey: `settlement.${current._id}.payable`, account: 'PARTNER_PAYABLE', amountMinor: -current.netPayableMinor, description: `Settlement ${current.reference} paid out` },
        ],
        session,
      );
      return updated;
    });
    await this.deps.audit.record({ actorId, action: 'settlement.paid', entityType: 'Settlement', entityId: id, partnerId: current.partnerId.toString(), metadata: { reference: evidence.providerReference, amount: current.netPayableMinor }, context });
    return settled;
  }

  /** A failed payout releases its entries so they can be settled again. */
  async fail(actorId: string, id: string, reason: string, context: RequestContext): Promise<SettlementRecord> {
    const result = await this.transition(actorId, id, 'FAILED', { failureReason: reason }, reason, context);
    const allocations = await SettlementAllocationModel.find({ settlementId: result._id, released: false }, { _id: 1 }).lean<Array<{ _id: Types.ObjectId }>>();
    for (const a of allocations) await SettlementAllocationModel.updateOne({ _id: a._id }, { $set: { released: true, liveKey: `released.${a._id}` } });
    return result;
  }

  async listSettlements(filter: { partnerId?: Types.ObjectId; status?: SettlementStatus }, page: number, limit: number): Promise<Paginated<SettlementRecord>> {
    const q: Record<string, unknown> = { ...(filter.partnerId ? { partnerId: filter.partnerId } : {}), ...(filter.status ? { status: filter.status } : {}) };
    const [items, total] = await Promise.all([SettlementModel.find(q).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean<SettlementRecord[]>(), SettlementModel.countDocuments(q)]);
    return paginated(items, page, limit, total);
  }

  async settlementEntries(id: string, partnerId?: Types.ObjectId): Promise<LedgerEntryRecord[]> {
    if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Settlement');
    const settlement = await SettlementModel.findOne({ _id: id, ...(partnerId ? { partnerId } : {}) }).lean<SettlementRecord>();
    if (!settlement) throw Errors.notFound('Settlement');
    const allocations = await SettlementAllocationModel.find({ settlementId: settlement._id }, { entryId: 1 }).lean<Array<{ entryId: Types.ObjectId }>>();
    return LedgerEntryModel.find({ _id: { $in: allocations.map((a) => a.entryId) } }).sort({ occurredAt: 1 }).lean<LedgerEntryRecord[]>();
  }
}
