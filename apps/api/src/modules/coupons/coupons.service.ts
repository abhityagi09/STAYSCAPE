import { Types, type ClientSession } from 'mongoose';
import type { CurrencyCode, Paginated } from '@stayscape/shared';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { paginated } from '@/lib/http';
import type { RequestContext } from '@/lib/request-context';
import type { AuditService } from '@/modules/audit/audit.service';
import { BookingModel } from '@/modules/bookings/booking.models';
import { applyBasisPoints } from '@/modules/pricing/pricing.engine';
import {
  CouponModel,
  CouponRedemptionModel,
  CouponUsageModel,
  type CouponAttrs,
  type CouponRecord,
  type CouponRedemptionRecord,
} from './coupons.models';

export interface CouponContext {
  userId: string;
  hotelId: string;
  city: string;
  currency: CurrencyCode;
  /** Room subtotal after rate-plan discounts, before taxes and fees. */
  subtotalMinor: number;
  totalMinor: number;
  hasRateDiscounts: boolean;
  now?: Date;
}

/** Discount for a coupon on a price, never leaving less than ₹1 (minimum chargeable) to pay. */
export function couponDiscount(
  coupon: Pick<CouponAttrs, 'discountType' | 'value' | 'maxDiscountMinor'>,
  subtotalMinor: number,
  totalMinor: number,
): number {
  let discount =
    coupon.discountType === 'PERCENT'
      ? applyBasisPoints(subtotalMinor, coupon.value)
      : coupon.value;
  if (coupon.maxDiscountMinor !== null) discount = Math.min(discount, coupon.maxDiscountMinor);
  return Math.max(0, Math.min(discount, subtotalMinor, totalMinor - 100));
}

const reject = (message: string) =>
  new AppError(422, 'NOT_ELIGIBLE', message, { fieldErrors: { couponCode: [message] } });

/**
 * Coupons. Platform-funded: the discount reduces what the guest pays, not the property's payable
 * or the commission base. Usage accounting is atomic:
 *   - total limit: conditional $inc of reservedCount while usedCount + reservedCount < totalLimit;
 *   - per-user limit: conditional upsert of a unique (coupon, user) counter;
 * both inside the hold transaction, so concurrent checkouts can never exceed a limit.
 * RESERVED (hold) → REDEEMED (payment confirmed) | RELEASED (hold released/expired).
 */
export class CouponsService {
  constructor(private readonly deps: { audit: AuditService }) {}

  /** Static eligibility checks (dates, currency, property, destination, customer, first booking, stacking, minimum). */
  async evaluate(
    code: string,
    ctx: CouponContext,
    session?: ClientSession,
  ): Promise<{ coupon: CouponRecord; discountMinor: number }> {
    const now = ctx.now ?? new Date();
    const coupon = await CouponModel.findOne(
      { code: code.trim().toUpperCase() },
      null,
      session ? { session } : {},
    ).lean<CouponRecord>();
    if (!coupon || !coupon.active) throw reject('This coupon code is not valid.');
    if (coupon.startsAt > now || (coupon.endsAt && coupon.endsAt <= now))
      throw reject('This coupon is not valid at the moment.');
    if (!coupon.currencies.includes(ctx.currency))
      throw reject(`This coupon cannot be used for ${ctx.currency} bookings.`);
    if (
      coupon.eligibleHotelIds.length &&
      !coupon.eligibleHotelIds.some((id) => id.toString() === ctx.hotelId)
    )
      throw reject('This coupon is not valid for this property.');
    if (
      coupon.eligibleCities.length &&
      !coupon.eligibleCities.some((c) => c.toLowerCase() === ctx.city.toLowerCase())
    )
      throw reject('This coupon is not valid for this destination.');
    if (
      coupon.eligibleUserIds.length &&
      !coupon.eligibleUserIds.some((id) => id.toString() === ctx.userId)
    )
      throw reject('This coupon is not available on your account.');
    if (!coupon.stackableWithRateDiscounts && ctx.hasRateDiscounts)
      throw reject('This coupon cannot be combined with the discounted rate you selected.');
    if (ctx.totalMinor < coupon.minBookingMinor)
      throw reject('The booking total is below this coupon’s minimum.');
    if (coupon.firstBookingOnly) {
      const previous = await BookingModel.exists({
        customerId: ctx.userId,
        confirmedAt: { $ne: null },
      }).session(session ?? null);
      if (previous) throw reject('This coupon is for your first booking only.');
    }
    const discountMinor = couponDiscount(coupon, ctx.subtotalMinor, ctx.totalMinor);
    if (discountMinor <= 0) throw reject('This coupon gives no discount on this booking.');
    return { coupon, discountMinor };
  }

  /** Reserve one use for a hold, atomically against both limits. Call inside the hold transaction. */
  async reserve(
    code: string,
    ctx: CouponContext,
    holdId: Types.ObjectId,
    session: ClientSession,
  ): Promise<{ code: string; discountMinor: number }> {
    const { coupon, discountMinor } = await this.evaluate(code, ctx, session);
    const claimed = await CouponModel.updateOne(
      {
        _id: coupon._id,
        active: true,
        $or: [
          { totalLimit: null },
          { $expr: { $lt: [{ $add: ['$usedCount', '$reservedCount'] }, '$totalLimit'] } },
        ],
      },
      { $inc: { reservedCount: 1 } },
      { session },
    );
    if (claimed.modifiedCount !== 1) throw reject('This coupon has reached its usage limit.');
    try {
      await CouponUsageModel.updateOne(
        {
          couponId: coupon._id,
          userId: new Types.ObjectId(ctx.userId),
          count: { $lt: coupon.perUserLimit },
        },
        { $inc: { count: 1 } },
        { upsert: true, session },
      );
    } catch (error) {
      // The unique (coupon, user) key makes an upsert at the limit collide → limit reached.
      if (isMongoDuplicateKey(error))
        throw reject('You have already used this coupon the maximum number of times.');
      throw error;
    }
    await CouponRedemptionModel.create(
      [
        {
          couponId: coupon._id,
          code: coupon.code,
          userId: new Types.ObjectId(ctx.userId),
          holdId,
          discountMinor,
          currency: ctx.currency,
          status: 'RESERVED',
          reservedAt: new Date(),
        },
      ],
      { session },
    );
    return { code: coupon.code, discountMinor };
  }

  /** Hold released or expired: give the use back (exactly once). */
  async release(holdId: Types.ObjectId, session: ClientSession): Promise<void> {
    const r = await CouponRedemptionModel.findOneAndUpdate(
      { holdId, status: 'RESERVED' },
      { $set: { status: 'RELEASED', releasedAt: new Date() } },
      { session, new: true },
    ).lean<CouponRedemptionRecord>();
    if (!r) return;
    await CouponModel.updateOne(
      { _id: r.couponId, reservedCount: { $gt: 0 } },
      { $inc: { reservedCount: -1 } },
      { session },
    );
    await CouponUsageModel.updateOne(
      { couponId: r.couponId, userId: r.userId, count: { $gt: 0 } },
      { $inc: { count: -1 } },
      { session },
    );
  }

  /**
   * Payment confirmed the booking: the use becomes permanent. A use released by an expired hold is
   * re-counted when a late payment is still honoured at the price the guest paid.
   */
  async redeem(
    holdId: Types.ObjectId,
    bookingId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const r = await CouponRedemptionModel.findOneAndUpdate(
      { holdId, status: { $in: ['RESERVED', 'RELEASED'] } },
      { $set: { status: 'REDEEMED', redeemedAt: new Date(), bookingId } },
      { session },
    ).lean<CouponRedemptionRecord>();
    if (!r) return;
    if (r.status === 'RESERVED') {
      await CouponModel.updateOne(
        { _id: r.couponId },
        { $inc: { reservedCount: -1, usedCount: 1 } },
        { session },
      );
    } else {
      await CouponModel.updateOne({ _id: r.couponId }, { $inc: { usedCount: 1 } }, { session });
      await CouponUsageModel.updateOne(
        { couponId: r.couponId, userId: r.userId },
        { $inc: { count: 1 } },
        { upsert: true, session },
      );
    }
  }

  // ------------------------------------------------------------------ administration
  async list(
    page: number,
    limit: number,
    q?: string,
  ): Promise<Paginated<CouponRecord & { redeemedDiscountMinor: number }>> {
    const filter = q
      ? {
          $or: [
            { code: new RegExp(q.replace(/[^A-Za-z0-9-]/g, ''), 'i') },
            { name: new RegExp(q.replace(/[^\w\s-]/g, ''), 'i') },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      CouponModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<CouponRecord[]>(),
      CouponModel.countDocuments(filter),
    ]);
    const sums = await CouponRedemptionModel.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { couponId: { $in: items.map((c) => c._id) }, status: 'REDEEMED' } },
      { $group: { _id: '$couponId', total: { $sum: '$discountMinor' } } },
    ]);
    return paginated(
      items.map((c) => ({
        ...c,
        redeemedDiscountMinor: sums.find((s) => s._id.equals(c._id))?.total ?? 0,
      })),
      page,
      limit,
      total,
    );
  }

  async save(
    actorId: string,
    id: string | null,
    input: Omit<
      CouponAttrs,
      | 'usedCount'
      | 'reservedCount'
      | 'createdBy'
      | 'createdAt'
      | 'updatedAt'
      | 'eligibleHotelIds'
      | 'eligibleUserIds'
      | 'startsAt'
      | 'endsAt'
    > & {
      eligibleHotelIds: string[];
      eligibleUserIds: string[];
      startsAt: string;
      endsAt: string | null;
    },
    context: RequestContext,
  ): Promise<CouponRecord> {
    const doc = {
      ...input,
      code: input.code.trim().toUpperCase(),
      eligibleHotelIds: input.eligibleHotelIds.map((x) => new Types.ObjectId(x)),
      eligibleUserIds: input.eligibleUserIds.map((x) => new Types.ObjectId(x)),
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    };
    let before: CouponRecord | null = null;
    let saved: CouponRecord | null;
    try {
      if (id) {
        if (!Types.ObjectId.isValid(id)) throw Errors.notFound('Coupon');
        before = await CouponModel.findById(id).lean<CouponRecord>();
        if (!before) throw Errors.notFound('Coupon');
        if (doc.totalLimit !== null && doc.totalLimit < before.usedCount + before.reservedCount)
          throw new AppError(
            409,
            'CONFLICT',
            'The limit cannot be below uses already made or reserved.',
          );
        saved = await CouponModel.findByIdAndUpdate(
          id,
          { $set: doc },
          { new: true, runValidators: true },
        ).lean<CouponRecord>();
      } else {
        saved = (
          await CouponModel.create({ ...doc, createdBy: new Types.ObjectId(actorId) })
        ).toObject() as CouponRecord;
      }
    } catch (error) {
      if (isMongoDuplicateKey(error))
        throw Errors.validation({ fieldErrors: { code: ['This code already exists'] } });
      throw error;
    }
    await this.deps.audit.record({
      actorId,
      action: id ? 'coupon.updated' : 'coupon.created',
      entityType: 'Coupon',
      entityId: saved!._id.toString(),
      metadata: { before, after: doc },
      context,
    });
    return saved!;
  }

  /** System-issued single-use coupons (referral rewards, loyalty vouchers). */
  async issuePersonal(params: {
    userId: string;
    code: string;
    name: string;
    kind: 'REFERRAL' | 'LOYALTY';
    valueMinor: number;
    validDays: number;
    session?: ClientSession;
  }): Promise<CouponRecord> {
    const now = new Date();
    const [doc] = await CouponModel.create(
      [
        {
          code: params.code,
          name: params.name,
          kind: params.kind,
          discountType: 'FIXED',
          value: params.valueMinor,
          startsAt: now,
          endsAt: new Date(now.getTime() + params.validDays * 86_400_000),
          totalLimit: 1,
          perUserLimit: 1,
          eligibleUserIds: [new Types.ObjectId(params.userId)],
          currencies: ['INR'],
        },
      ],
      params.session ? { session: params.session } : {},
    );
    return doc!.toObject() as CouponRecord;
  }

  /** Coupon performance for reporting: redemptions and discount granted per coupon in a period. */
  async performance(from: Date, to: Date) {
    return CouponRedemptionModel.aggregate<{
      _id: string;
      redemptions: number;
      discountMinor: number;
      released: number;
    }>([
      { $match: { reservedAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: '$code',
          redemptions: { $sum: { $cond: [{ $eq: ['$status', 'REDEEMED'] }, 1, 0] } },
          released: { $sum: { $cond: [{ $eq: ['$status', 'RELEASED'] }, 1, 0] } },
          discountMinor: {
            $sum: { $cond: [{ $eq: ['$status', 'REDEEMED'] }, '$discountMinor', 0] },
          },
        },
      },
      { $sort: { redemptions: -1 } },
      { $limit: 50 },
    ]);
  }
}
