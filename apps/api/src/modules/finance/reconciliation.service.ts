import type { Types } from 'mongoose';
import { BookingModel } from '@/modules/bookings/booking.models';
import { PaymentModel, RefundModel } from '@/modules/payments/payment.models';
import { PAID_FAMILY } from '@/modules/payments/payment-status';
import type { PaymentProvider } from '@/modules/payments/providers/payment-provider';
import { LedgerEntryModel, SettlementModel } from './finance.models';

/** Booking states in which a stay was (or still is) owed to the guest after payment. */
const CONFIRMED_FAMILY = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED', 'CANCELLED'];
const EXCEPTION_LIMIT = 200;

export type ReconciliationCheck =
  | 'PAID_BOOKING_WITHOUT_LEDGER'
  | 'LEDGER_CASH_DIFFERS_FROM_PAYMENT'
  | 'PAYMENT_DIFFERS_FROM_BOOKING_TOTAL'
  | 'REFUND_WITHOUT_LEDGER'
  | 'PAYMENT_REFUNDED_TOTAL_MISMATCH'
  | 'REFUND_EXCEEDS_CAPTURE'
  | 'UNBALANCED_LEDGER_TRANSACTION'
  | 'UNALLOCATED_FUNDS_OPEN'
  | 'SETTLEMENT_PAID_WITHOUT_LEDGER'
  | 'PROVIDER_PAYMENT_MISSING'
  | 'PROVIDER_STATUS_MISMATCH'
  | 'PROVIDER_AMOUNT_MISMATCH';

export interface ReconciliationException {
  check: ReconciliationCheck;
  severity: 'HIGH' | 'MEDIUM';
  reference: string;
  expectedMinor: number | null;
  actualMinor: number | null;
  detail: string;
}

type Sums = Record<string, number>;
const byCurrency = (rows: Array<{ _id: string } & Sums>) =>
  Object.fromEntries(rows.map(({ _id, ...sums }) => [_id, sums]));

/**
 * Read-only financial reconciliation across the four independent sources of truth:
 * booking price snapshots, provider payment records, refund records and the append-only ledger
 * (which in turn drives partner settlements).
 *
 * The report never changes data. Each exception names the record and the expected/actual
 * amounts so finance can investigate and, where needed, post an auditable correcting entry
 * (docs/payments.md "Reconciliation").
 */
/** Upper bound on provider API calls per report (each is one request to the gateway). */
const PROVIDER_CHECK_LIMIT = 200;

export class ReconciliationService {
  constructor(private readonly provider?: PaymentProvider) {}

  async report(from: Date, to: Date, options: { verifyProvider?: boolean } = {}) {
    const [bookingTotals, providerTotals, refundTotals, ledgerTotals, partnerBalances, exceptions] =
      await Promise.all([
        this.bookingTotals(from, to),
        this.providerTotals(from, to),
        this.refundTotals(from, to),
        this.ledgerTotals(from, to),
        this.partnerBalances(),
        this.exceptions(),
      ]);
    const provider = options.verifyProvider ? await this.providerCheck(from, to) : null;
    if (provider) exceptions.push(...provider.exceptions);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: new Date().toISOString(),
      bookings: bookingTotals,
      providerPayments: providerTotals,
      refunds: refundTotals,
      ledger: ledgerTotals,
      partnerBalances,
      provider: provider ? provider.summary : null,
      exceptions,
      mismatchCount: exceptions.length,
      truncated: exceptions.length >= EXCEPTION_LIMIT,
    };
  }

  /** Internal booking totals: what guests were quoted and charged for paid bookings confirmed in the period. */
  private async bookingTotals(from: Date, to: Date) {
    const rows = await BookingModel.aggregate<{ _id: string } & Sums>([
      {
        $match: {
          confirmedAt: { $gte: from, $lt: to },
          paymentStatus: { $in: [...PAID_FAMILY] },
        },
      },
      {
        $group: {
          _id: '$priceSnapshot.currency',
          count: { $sum: 1 },
          subtotalMinor: { $sum: '$priceSnapshot.totals.subtotalMinor' },
          discountsMinor: { $sum: '$priceSnapshot.totals.discountsMinor' },
          taxesMinor: { $sum: '$priceSnapshot.totals.taxesMinor' },
          feesMinor: { $sum: '$priceSnapshot.totals.feesMinor' },
          totalMinor: { $sum: '$priceSnapshot.totals.totalMinor' },
          couponMinor: { $sum: { $ifNull: ['$priceSnapshot.coupon.discountMinor', 0] } },
          commissionMinor: { $sum: { $ifNull: ['$commissionSnapshot.commissionMinor', 0] } },
        },
      },
    ]);
    return byCurrency(rows);
  }

  /** Provider payment records verified in the period (captured money). */
  private async providerTotals(from: Date, to: Date) {
    const rows = await PaymentModel.aggregate<{ _id: string } & Sums>([
      { $match: { verifiedAt: { $gte: from, $lt: to }, status: { $in: [...PAID_FAMILY] } } },
      {
        $group: {
          _id: '$currency',
          count: { $sum: 1 },
          capturedMinor: { $sum: '$amountMinor' },
          refundedMinor: { $sum: '$refundedMinor' },
        },
      },
    ]);
    return byCurrency(rows);
  }

  private async refundTotals(from: Date, to: Date) {
    const rows = await RefundModel.aggregate<{ _id: { currency: string; status: string } } & Sums>([
      { $match: { requestedAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: { currency: '$currency', status: '$status' },
          count: { $sum: 1 },
          amountMinor: { $sum: '$amountMinor' },
        },
      },
    ]);
    const out: Record<string, Record<string, { count: number; amountMinor: number }>> = {};
    for (const r of rows)
      (out[r._id.currency] ??= {})[r._id.status] = {
        count: r.count ?? 0,
        amountMinor: r.amountMinor ?? 0,
      };
    return out;
  }

  private async ledgerTotals(from: Date, to: Date) {
    const rows = await LedgerEntryModel.aggregate<{
      _id: { currency: string; account: string };
      amountMinor: number;
    }>([
      { $match: { occurredAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: { currency: '$currency', account: '$account' },
          amountMinor: { $sum: '$amountMinor' },
        },
      },
    ]);
    const out: Record<string, Record<string, number>> = {};
    for (const r of rows) (out[r._id.currency] ??= {})[r._id.account] = r.amountMinor;
    return out;
  }

  /** All-time partner payable balance (accrued − refund share − paid out) per partner and currency. */
  private async partnerBalances() {
    return LedgerEntryModel.aggregate<{
      partnerId: Types.ObjectId;
      currency: string;
      balanceMinor: number;
      paidOutMinor: number;
    }>([
      { $match: { account: 'PARTNER_PAYABLE' } },
      {
        $group: {
          _id: { partnerId: '$partnerId', currency: '$currency' },
          balanceMinor: { $sum: '$amountMinor' },
          paidOutMinor: {
            $sum: { $cond: [{ $eq: ['$event', 'SETTLEMENT_PAID'] }, { $abs: '$amountMinor' }, 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          partnerId: '$_id.partnerId',
          currency: '$_id.currency',
          balanceMinor: 1,
          paidOutMinor: 1,
        },
      },
      { $sort: { balanceMinor: -1 } },
      { $limit: 500 },
    ]);
  }

  /**
   * Provider-side check: re-fetches each captured payment in the period from the gateway and
   * compares status, amount and currency with STAYSCAPE's records (opt-in: it calls the provider).
   */
  async providerCheck(from: Date, to: Date) {
    const exceptions: ReconciliationException[] = [];
    const summary = { checked: 0, providerCapturedMinor: 0, truncated: false, available: true };
    if (!this.provider) return { exceptions, summary: { ...summary, available: false } };
    const payments = await PaymentModel.find(
      { verifiedAt: { $gte: from, $lt: to }, status: { $in: [...PAID_FAMILY] } },
      { providerOrderId: 1, providerPaymentId: 1, amountMinor: 1, currency: 1, status: 1 },
    )
      .sort({ verifiedAt: 1 })
      .limit(PROVIDER_CHECK_LIMIT + 1)
      .lean<
        Array<{
          providerOrderId: string;
          providerPaymentId: string | null;
          amountMinor: number;
          currency: string;
          status: string;
        }>
      >();
    summary.truncated = payments.length > PROVIDER_CHECK_LIMIT;
    for (const p of payments.slice(0, PROVIDER_CHECK_LIMIT)) {
      summary.checked += 1;
      const base = { reference: p.providerOrderId, expectedMinor: p.amountMinor };
      if (!p.providerPaymentId) {
        exceptions.push({
          ...base,
          check: 'PROVIDER_PAYMENT_MISSING',
          severity: 'HIGH',
          actualMinor: null,
          detail: 'Captured payment has no provider payment id.',
        });
        continue;
      }
      let remote;
      try {
        remote = await this.provider.fetchPayment(p.providerPaymentId);
      } catch {
        exceptions.push({
          ...base,
          check: 'PROVIDER_PAYMENT_MISSING',
          severity: 'HIGH',
          actualMinor: null,
          detail: 'The provider could not return this payment.',
        });
        continue;
      }
      if (remote.status === 'captured' || remote.status === 'refunded')
        summary.providerCapturedMinor += remote.amount;
      if (remote.status !== 'captured' && remote.status !== 'refunded')
        exceptions.push({
          ...base,
          check: 'PROVIDER_STATUS_MISMATCH',
          severity: 'HIGH',
          actualMinor: remote.amount,
          detail: `STAYSCAPE records ${p.status}; the provider reports ${remote.status}.`,
        });
      else if (remote.amount !== p.amountMinor || remote.currency !== p.currency)
        exceptions.push({
          ...base,
          check: 'PROVIDER_AMOUNT_MISMATCH',
          severity: 'HIGH',
          actualMinor: remote.amount,
          detail: `Provider amount ${remote.amount} ${remote.currency} differs from the recorded capture.`,
        });
    }
    return { exceptions, summary };
  }

  /** All-time consistency checks between sources. Bounded to keep the report responsive. */
  async exceptions(): Promise<ReconciliationException[]> {
    const out: ReconciliationException[] = [];
    const push = (e: ReconciliationException) => {
      if (out.length < EXCEPTION_LIMIT) out.push(e);
    };

    // 1–3. Paid, confirmed bookings vs their ledger entry and primary payment.
    const paidBookings = await BookingModel.aggregate<{
      _id: Types.ObjectId;
      bookingReference: string;
      totalMinor: number;
      payments: Array<{ amountMinor: number; status: string }>;
      cash: Array<{ amountMinor: number }>;
    }>([
      {
        $match: {
          bookingStatus: { $in: CONFIRMED_FAMILY },
          paymentStatus: { $in: [...PAID_FAMILY] },
        },
      },
      {
        $project: {
          bookingReference: 1,
          totalMinor: '$priceSnapshot.totals.totalMinor',
        },
      },
      {
        $lookup: {
          from: PaymentModel.collection.name,
          let: { b: '$_id' },
          pipeline: [
            {
              $match: { $expr: { $eq: ['$bookingId', '$$b'] }, status: { $in: [...PAID_FAMILY] } },
            },
            { $sort: { createdAt: 1 } },
            { $limit: 1 },
            { $project: { amountMinor: 1, status: 1 } },
          ],
          as: 'payments',
        },
      },
      {
        $lookup: {
          from: LedgerEntryModel.collection.name,
          let: { b: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$bookingId', '$$b'] },
                event: 'BOOKING_CONFIRMED',
                account: 'CASH',
              },
            },
            { $project: { amountMinor: 1 } },
          ],
          as: 'cash',
        },
      },
      {
        $match: {
          $expr: {
            $or: [
              { $eq: [{ $size: '$cash' }, 0] },
              { $ne: [{ $sum: '$cash.amountMinor' }, { $sum: '$payments.amountMinor' }] },
              { $ne: [{ $sum: '$payments.amountMinor' }, '$totalMinor'] },
            ],
          },
        },
      },
      { $limit: EXCEPTION_LIMIT },
    ]);
    for (const b of paidBookings) {
      const paid = b.payments[0]?.amountMinor ?? null;
      const cash = b.cash.reduce((s, e) => s + e.amountMinor, 0);
      if (!b.cash.length)
        push({
          check: 'PAID_BOOKING_WITHOUT_LEDGER',
          severity: 'HIGH',
          reference: b.bookingReference,
          expectedMinor: paid,
          actualMinor: null,
          detail:
            'Paid booking has no BOOKING_CONFIRMED ledger entry (commission and payable not accrued).',
        });
      else if (cash !== paid)
        push({
          check: 'LEDGER_CASH_DIFFERS_FROM_PAYMENT',
          severity: 'HIGH',
          reference: b.bookingReference,
          expectedMinor: paid,
          actualMinor: cash,
          detail: 'Ledger cash for the booking differs from the captured payment.',
        });
      if (paid !== null && paid !== b.totalMinor)
        push({
          check: 'PAYMENT_DIFFERS_FROM_BOOKING_TOTAL',
          severity: 'HIGH',
          reference: b.bookingReference,
          expectedMinor: b.totalMinor,
          actualMinor: paid,
          detail: 'Captured amount differs from the booking’s price snapshot total.',
        });
    }

    // 4–6. Refunds vs ledger and vs the payment's refunded total.
    const succeeded = await RefundModel.aggregate<{
      _id: Types.ObjectId;
      idempotencyKey: string;
      amountMinor: number;
      ledger: Array<{ amountMinor: number }>;
    }>([
      { $match: { status: 'SUCCEEDED' } },
      {
        $lookup: {
          from: LedgerEntryModel.collection.name,
          let: { r: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$refundId', '$$r'] }, account: 'CASH' } },
            { $project: { amountMinor: 1 } },
          ],
          as: 'ledger',
        },
      },
      {
        $match: {
          $expr: { $ne: [{ $sum: '$ledger.amountMinor' }, { $multiply: ['$amountMinor', -1] }] },
        },
      },
      { $limit: EXCEPTION_LIMIT },
    ]);
    for (const r of succeeded)
      push({
        check: 'REFUND_WITHOUT_LEDGER',
        severity: 'HIGH',
        reference: r.idempotencyKey,
        expectedMinor: -r.amountMinor,
        actualMinor: r.ledger.length ? r.ledger.reduce((s, e) => s + e.amountMinor, 0) : null,
        detail: 'Provider-confirmed refund is not (or not fully) reflected in ledger cash.',
      });

    const payments = await PaymentModel.aggregate<{
      providerOrderId: string;
      amountMinor: number;
      refundedMinor: number;
      refundSum: number;
    }>([
      {
        $match: {
          $or: [
            { refundedMinor: { $gt: 0 } },
            { status: { $in: ['PARTIALLY_REFUNDED', 'REFUNDED'] } },
          ],
        },
      },
      {
        $lookup: {
          from: RefundModel.collection.name,
          let: { p: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$paymentId', '$$p'] }, status: 'SUCCEEDED' } },
            { $group: { _id: null, s: { $sum: '$amountMinor' } } },
          ],
          as: 'r',
        },
      },
      {
        $project: {
          providerOrderId: 1,
          amountMinor: 1,
          refundedMinor: 1,
          refundSum: { $ifNull: [{ $first: '$r.s' }, 0] },
        },
      },
      {
        $match: {
          $expr: {
            $or: [
              { $ne: ['$refundSum', '$refundedMinor'] },
              { $gt: ['$refundedMinor', '$amountMinor'] },
            ],
          },
        },
      },
      { $limit: EXCEPTION_LIMIT },
    ]);
    for (const p of payments) {
      if (p.refundedMinor > p.amountMinor)
        push({
          check: 'REFUND_EXCEEDS_CAPTURE',
          severity: 'HIGH',
          reference: p.providerOrderId,
          expectedMinor: p.amountMinor,
          actualMinor: p.refundedMinor,
          detail: 'More was refunded than was captured.',
        });
      if (p.refundSum !== p.refundedMinor)
        push({
          check: 'PAYMENT_REFUNDED_TOTAL_MISMATCH',
          severity: 'MEDIUM',
          reference: p.providerOrderId,
          expectedMinor: p.refundSum,
          actualMinor: p.refundedMinor,
          detail: 'Payment refunded total differs from the sum of its succeeded refunds.',
        });
    }

    // 7. Every ledger transaction balances: CASH equals the sum of the other accounts.
    const unbalanced = await LedgerEntryModel.aggregate<{
      _id: string;
      cash: number;
      others: number;
    }>([
      {
        $group: {
          _id: {
            $reduce: {
              input: {
                $slice: [
                  { $split: ['$entryKey', '.'] },
                  { $subtract: [{ $size: { $split: ['$entryKey', '.'] } }, 1] },
                ],
              },
              initialValue: '',
              in: {
                $cond: [
                  { $eq: ['$$value', ''] },
                  '$$this',
                  { $concat: ['$$value', '.', '$$this'] },
                ],
              },
            },
          },
          cash: { $sum: { $cond: [{ $eq: ['$account', 'CASH'] }, '$amountMinor', 0] } },
          others: { $sum: { $cond: [{ $eq: ['$account', 'CASH'] }, 0, '$amountMinor'] } },
        },
      },
      { $match: { $expr: { $ne: ['$cash', '$others'] } } },
      { $limit: EXCEPTION_LIMIT },
    ]);
    for (const t of unbalanced)
      push({
        check: 'UNBALANCED_LEDGER_TRANSACTION',
        severity: 'HIGH',
        reference: t._id,
        expectedMinor: t.cash,
        actualMinor: t.others,
        detail: 'Ledger entries for this transaction do not balance.',
      });

    // 8. Captured money not tied to a stay that has not yet been refunded.
    const unallocated = await LedgerEntryModel.aggregate<{ _id: Types.ObjectId; balance: number }>([
      { $match: { account: 'UNALLOCATED' } },
      { $group: { _id: '$paymentId', balance: { $sum: '$amountMinor' } } },
      { $match: { balance: { $ne: 0 } } },
      { $limit: EXCEPTION_LIMIT },
    ]);
    if (unallocated.length) {
      const refs = await PaymentModel.find(
        { _id: { $in: unallocated.map((u) => u._id) } },
        { providerOrderId: 1 },
      ).lean<Array<{ _id: Types.ObjectId; providerOrderId: string }>>();
      for (const u of unallocated)
        push({
          check: 'UNALLOCATED_FUNDS_OPEN',
          severity: 'MEDIUM',
          reference: refs.find((r) => r._id.equals(u._id))?.providerOrderId ?? String(u._id),
          expectedMinor: 0,
          actualMinor: u.balance,
          detail: 'Captured funds not allocated to a stay and not yet refunded.',
        });
    }

    // 9. Settlements marked paid must have their payout posted to the ledger.
    const paid = await SettlementModel.aggregate<{
      reference: string;
      netPayableMinor: number;
      posted: number;
    }>([
      { $match: { status: 'PAID' } },
      {
        $lookup: {
          from: LedgerEntryModel.collection.name,
          let: { s: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$settlementId', '$$s'] },
                event: 'SETTLEMENT_PAID',
                account: 'CASH',
              },
            },
            { $group: { _id: null, s: { $sum: '$amountMinor' } } },
          ],
          as: 'l',
        },
      },
      {
        $project: {
          reference: 1,
          netPayableMinor: 1,
          posted: { $ifNull: [{ $first: '$l.s' }, 0] },
        },
      },
      { $match: { $expr: { $ne: ['$posted', { $multiply: ['$netPayableMinor', -1] }] } } },
      { $limit: EXCEPTION_LIMIT },
    ]);
    for (const s of paid)
      push({
        check: 'SETTLEMENT_PAID_WITHOUT_LEDGER',
        severity: 'HIGH',
        reference: s.reference,
        expectedMinor: -s.netPayableMinor,
        actualMinor: s.posted,
        detail: 'Settlement is marked paid but its payout is not fully posted to the ledger.',
      });
    return out;
  }
}
