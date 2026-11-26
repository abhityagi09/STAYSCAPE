import { Schema, Types, model, type ClientSession } from 'mongoose';
import {
  LOYALTY_RULES,
  REFERRAL_RULES,
  type LoyaltyEntryDto,
  type LoyaltySummaryDto,
  type LoyaltyTier,
  type ReferralSummaryDto,
} from '@stayscape/shared';
import { AppError, Errors, isMongoDuplicateKey } from '@/lib/errors';
import { randomCode } from '@/lib/references';
import type { RequestContext } from '@/lib/request-context';
import type { Logger } from '@/lib/logger';
import { withTransaction } from '@/lib/transaction';
import type { AuditService } from '@/modules/audit/audit.service';
import { BookingModel, type BookingRecord } from '@/modules/bookings/booking.models';
import { CouponModel } from '@/modules/coupons/coupons.models';
import type { CouponsService } from '@/modules/coupons/coupons.service';
import type { NotificationService } from '@/modules/notifications/notification.service';
import { PaymentModel, RefundModel } from '@/modules/payments/payment.models';
import { UserModel } from '@/modules/users/user.model';

// ------------------------------------------------------------------ models
type EntryType = LoyaltyEntryDto['type'];
interface LoyaltyAccountAttrs {
  userId: Types.ObjectId;
  balance: number;
  lifetimeEarned: number;
}
const accountSchema = new Schema<LoyaltyAccountAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    balance: { type: Number, required: true, min: 0 },
    lifetimeEarned: { type: Number, required: true, min: 0 },
  },
  { timestamps: true, versionKey: false },
);
accountSchema.index({ userId: 1 }, { unique: true, name: 'uniq_user' });
export const LoyaltyAccountModel = model<LoyaltyAccountAttrs>('LoyaltyAccount', accountSchema);

/** Append-only points ledger. `entryKey` makes every posting idempotent (one per event). */
interface LoyaltyEntryAttrs {
  userId: Types.ObjectId;
  entryKey: string;
  type: EntryType;
  points: number;
  description: string;
  bookingId: Types.ObjectId | null;
  bookingReference: string | null;
  couponId: Types.ObjectId | null;
  createdAt: Date;
}
type LoyaltyEntryRecord = LoyaltyEntryAttrs & { _id: Types.ObjectId };
const entrySchema = new Schema<LoyaltyEntryAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    entryKey: { type: String, required: true },
    type: { type: String, required: true },
    points: {
      type: Number,
      required: true,
      validate: { validator: Number.isInteger, message: 'Integer points' },
    },
    description: { type: String, required: true, maxlength: 200 },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    bookingReference: { type: String, default: null },
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
entrySchema.index({ entryKey: 1 }, { unique: true, name: 'uniq_entry' });
entrySchema.index({ userId: 1, createdAt: -1 }, { name: 'user_created' });
entrySchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete'],
  function () {
    throw new Error('Loyalty entries are append-only');
  },
);
export const LoyaltyEntryModel = model<LoyaltyEntryAttrs>('LoyaltyEntry', entrySchema);

interface ReferralCodeAttrs {
  userId: Types.ObjectId;
  code: string;
}
const codeSchema = new Schema<ReferralCodeAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true },
  },
  { timestamps: true, versionKey: false },
);
codeSchema.index({ userId: 1 }, { unique: true, name: 'uniq_user' });
codeSchema.index({ code: 1 }, { unique: true, name: 'uniq_code' });
export const ReferralCodeModel = model<ReferralCodeAttrs>('ReferralCode', codeSchema);

interface ReferralAttrs {
  referrerId: Types.ObjectId;
  refereeId: Types.ObjectId;
  code: string;
  status: 'PENDING' | 'REWARDED' | 'REJECTED';
  qualifyingBookingId: Types.ObjectId | null;
  reason: string | null;
  rewardedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
type ReferralRecord = ReferralAttrs & { _id: Types.ObjectId };
const referralSchema = new Schema<ReferralAttrs>(
  {
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    refereeId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    code: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'REWARDED', 'REJECTED'], default: 'PENDING' },
    qualifyingBookingId: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, default: null },
    rewardedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);
referralSchema.index({ refereeId: 1 }, { unique: true, name: 'uniq_referee' });
referralSchema.index({ referrerId: 1, status: 1, rewardedAt: -1 }, { name: 'referrer_status' });
referralSchema.index({ status: 1, createdAt: 1 }, { name: 'status_created' });
export const ReferralModel = model<ReferralAttrs>('Referral', referralSchema);

// ------------------------------------------------------------------ pure rules
export function tierFor(points12m: number): {
  tier: LoyaltyTier;
  next: { tier: LoyaltyTier; pointsNeeded: number } | null;
} {
  const tiers = LOYALTY_RULES.tiers;
  let idx = 0;
  tiers.forEach((t, i) => {
    if (points12m >= t.minPoints) idx = i;
  });
  const next = tiers[idx + 1];
  return {
    tier: tiers[idx]!.tier,
    next: next ? { tier: next.tier, pointsNeeded: next.minPoints - points12m } : null,
  };
}

/** Points for a completed stay: room charges after rate discounts, scaled by the share not refunded. */
export function stayPoints(
  subtotalMinor: number,
  paidMinor: number,
  refundedMinor: number,
): number {
  if (paidMinor <= 0 || subtotalMinor <= 0) return 0;
  const net = Math.max(0, paidMinor - refundedMinor);
  return Math.floor((subtotalMinor * net) / (paidMinor * LOYALTY_RULES.earnPerMinor));
}

/**
 * Loyalty and referrals. Points are earned only when a stay is COMPLETED, reversed by later refunds
 * (never below zero), and redeemed as single-use personal coupons; unused coupons give points back.
 * Referral rewards are paid only after the new customer's first qualifying completed stay.
 */
export class RewardsService {
  constructor(
    private readonly deps: {
      coupons: CouponsService;
      notifications: NotificationService;
      audit: AuditService;
      logger: Logger;
    },
  ) {}

  /**
   * Post one ledger entry and move the balance, atomically and at most once per `entryKey`.
   * Debits are capped at the available balance (the balance can never go negative).
   * Returns the points actually posted (0 when the entry already existed).
   */
  private async post(
    e: {
      userId: Types.ObjectId;
      entryKey: string;
      type: EntryType;
      points: number;
      description: string;
      bookingId?: Types.ObjectId | null;
      bookingReference?: string | null;
      couponId?: Types.ObjectId | null;
    },
    outer?: ClientSession,
  ): Promise<number> {
    if (await LoyaltyEntryModel.exists({ entryKey: e.entryKey })) return 0;
    const work = async (session: ClientSession) => {
      await LoyaltyAccountModel.updateOne(
        { userId: e.userId },
        { $setOnInsert: { balance: 0, lifetimeEarned: 0 } },
        { upsert: true, session },
      );
      let points = e.points;
      if (points < 0) {
        const acct = await LoyaltyAccountModel.findOne(
          { userId: e.userId },
          { balance: 1 },
          { session },
        ).lean<LoyaltyAccountAttrs>();
        points = -Math.min(-points, acct?.balance ?? 0);
      }
      await LoyaltyEntryModel.create(
        [
          {
            ...e,
            points,
            description:
              points !== e.points
                ? `${e.description} (limited to available balance)`
                : e.description,
          },
        ],
        { session },
      );
      if (points !== 0) {
        const res = await LoyaltyAccountModel.updateOne(
          { userId: e.userId, ...(points < 0 ? { balance: { $gte: -points } } : {}) },
          {
            $inc: {
              balance: points,
              ...(e.type === 'EARN' || e.type === 'REFERRAL_BONUS'
                ? { lifetimeEarned: points }
                : {}),
            },
          },
          { session },
        );
        if (res.modifiedCount !== 1) throw new AppError(409, 'CONFLICT', 'Not enough points.');
      }
      return points;
    };
    try {
      return outer ? await work(outer) : await withTransaction(work);
    } catch (error) {
      if (isMongoDuplicateKey(error)) return 0; // a concurrent run posted it first
      throw error;
    }
  }

  // ------------------------------------------------------------------ loyalty
  async summary(userId: string): Promise<LoyaltySummaryDto> {
    const uid = new Types.ObjectId(userId);
    const since = new Date(Date.now() - 365 * 86_400_000);
    const [acct, entries, earned12] = await Promise.all([
      LoyaltyAccountModel.findOne({ userId: uid }).lean<LoyaltyAccountAttrs>(),
      LoyaltyEntryModel.find({ userId: uid })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean<LoyaltyEntryRecord[]>(),
      LoyaltyEntryModel.aggregate<{ n: number }>([
        {
          $match: {
            userId: uid,
            type: { $in: ['EARN', 'REVERSE', 'REFERRAL_BONUS'] },
            createdAt: { $gte: since },
          },
        },
        { $group: { _id: null, n: { $sum: '$points' } } },
      ]),
    ]);
    const last12 = Math.max(0, earned12[0]?.n ?? 0);
    const { tier, next } = tierFor(last12);
    return {
      balance: acct?.balance ?? 0,
      lifetimeEarned: acct?.lifetimeEarned ?? 0,
      last12MonthsEarned: last12,
      tier,
      nextTier: next,
      pointValueMinor: LOYALTY_RULES.redeemValueMinorPerPoint,
      entries: entries.map((x) => ({
        id: x._id.toString(),
        type: x.type,
        points: x.points,
        description: x.description,
        bookingReference: x.bookingReference,
        createdAt: x.createdAt.toISOString(),
      })),
    };
  }

  async redeem(userId: string, points: number, context: RequestContext) {
    const uid = new Types.ObjectId(userId);
    const valueMinor = points * LOYALTY_RULES.redeemValueMinorPerPoint;
    const coupon = await withTransaction(async (session) => {
      const debit = await LoyaltyAccountModel.updateOne(
        { userId: uid, balance: { $gte: points } },
        { $inc: { balance: -points } },
        { session },
      );
      if (debit.modifiedCount !== 1)
        throw new AppError(409, 'CONFLICT', 'You do not have enough points.');
      const c = await this.deps.coupons.issuePersonal({
        userId,
        code: `PTS-${randomCode(8)}`,
        name: `Points reward ₹${valueMinor / 100}`,
        kind: 'LOYALTY',
        valueMinor,
        validDays: LOYALTY_RULES.redeemCouponValidDays,
        session,
      });
      await LoyaltyEntryModel.create(
        [
          {
            userId: uid,
            entryKey: `redeem:${c._id.toString()}`,
            type: 'REDEEM',
            points: -points,
            description: `Redeemed for coupon ${c.code}`,
            couponId: c._id,
          },
        ],
        { session },
      );
      return c;
    });
    await this.deps.audit.record({
      actorId: userId,
      action: 'loyalty.redeemed',
      entityType: 'Coupon',
      entityId: coupon._id.toString(),
      metadata: { points, valueMinor },
      context,
    });
    return {
      code: coupon.code,
      valueMinor,
      currency: 'INR',
      expiresAt: coupon.endsAt?.toISOString() ?? null,
      summary: await this.summary(userId),
    };
  }

  private async paidAndRefunded(bookingId: Types.ObjectId) {
    const pays = await PaymentModel.find(
      { bookingId, status: { $in: ['SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
      { amountMinor: 1, refundedMinor: 1 },
    ).lean<Array<{ amountMinor: number; refundedMinor: number }>>();
    return {
      paid: pays.reduce((s, p) => s + p.amountMinor, 0),
      refunded: pays.reduce((s, p) => s + (p.refundedMinor ?? 0), 0),
    };
  }

  /** Scheduled: earn points for completed stays and reverse points for refunds since. Idempotent. */
  async accrue(batch = 500): Promise<{ earned: number; reversed: number }> {
    let earned = 0;
    let reversed = 0;
    const completed = await BookingModel.find(
      { bookingStatus: 'COMPLETED' },
      { customerId: 1, bookingReference: 1, priceSnapshot: 1 },
    )
      .sort({ completedAt: -1 })
      .limit(batch)
      .lean<BookingRecord[]>();
    const done = new Set(
      (
        await LoyaltyEntryModel.find(
          { entryKey: { $in: completed.map((b) => `earn:${b._id.toString()}`) } },
          { entryKey: 1 },
        ).lean<Array<{ entryKey: string }>>()
      ).map((e) => e.entryKey),
    );
    for (const b of completed) {
      try {
        if (done.has(`earn:${b._id.toString()}`)) continue;
        const { paid, refunded } = await this.paidAndRefunded(b._id);
        const pts = stayPoints(b.priceSnapshot.totals.subtotalMinor, paid, refunded);
        // Recorded even when zero, so the stay is not re-examined and later refunds reverse correctly.
        const posted = await this.post({
          userId: b.customerId,
          entryKey: `earn:${b._id.toString()}`,
          type: 'EARN',
          points: pts,
          description: `Stay ${b.bookingReference}`,
          bookingId: b._id,
          bookingReference: b.bookingReference,
        });
        if (posted > 0) {
          earned += posted;
          await this.deps.notifications.notifyInApp({
            userId: b.customerId.toString(),
            type: 'LOYALTY_UPDATE',
            title: `You earned ${posted} points`,
            body: `For your stay ${b.bookingReference}.`,
            resource: { type: 'rewards', id: 'loyalty' },
          });
        }
      } catch (error) {
        // One bad record must not stop the rest of the batch.
        this.deps.logger.warn(
          { err: (error as Error).message },
          'Loyalty accrual failed for one item; continuing',
        );
      }
    }
    // Refunds completed after points were earned.
    const earnRows = await LoyaltyEntryModel.find(
      { type: 'EARN', points: { $gt: 0 } },
      { bookingId: 1, userId: 1, points: 1, bookingReference: 1 },
    )
      .sort({ createdAt: -1 })
      .limit(batch)
      .lean<LoyaltyEntryRecord[]>();
    for (const earn of earnRows) {
      try {
        const refunds = await RefundModel.find(
          { bookingId: earn.bookingId, status: 'SUCCEEDED' },
          { _id: 1 },
        )
          .sort({ completedAt: 1 })
          .lean<Array<{ _id: Types.ObjectId }>>();
        if (refunds.length === 0) continue;
        const booking = await BookingModel.findById(earn.bookingId, {
          priceSnapshot: 1,
        }).lean<BookingRecord>();
        if (!booking) continue;
        const { paid, refunded } = await this.paidAndRefunded(earn.bookingId!);
        const entitled = stayPoints(booking.priceSnapshot.totals.subtotalMinor, paid, refunded);
        const prior = await LoyaltyEntryModel.aggregate<{ n: number }>([
          { $match: { bookingId: earn.bookingId, type: 'REVERSE' } },
          { $group: { _id: null, n: { $sum: '$points' } } },
        ]);
        const toReverse = earn.points + (prior[0]?.n ?? 0) - entitled;
        if (toReverse <= 0) continue;
        const latest = refunds[refunds.length - 1]!;
        reversed -= await this.post({
          userId: earn.userId,
          entryKey: `reverse:${latest._id.toString()}`,
          type: 'REVERSE',
          points: -toReverse,
          description: `Refund on stay ${earn.bookingReference}`,
          bookingId: earn.bookingId,
          bookingReference: earn.bookingReference,
        });
      } catch (error) {
        // One bad record must not stop the rest of the batch.
        this.deps.logger.warn(
          { err: (error as Error).message },
          'Loyalty reversal failed for one item; continuing',
        );
      }
    }
    return { earned, reversed };
  }

  /** Scheduled: give points back for points coupons that expired unused. */
  async releaseExpiredRedemptions(now = new Date()): Promise<number> {
    const expired = await CouponModel.find(
      { kind: 'LOYALTY', endsAt: { $lt: now }, usedCount: 0, reservedCount: 0, active: true },
      { _id: 1, code: 1 },
    )
      .limit(500)
      .lean<Array<{ _id: Types.ObjectId; code: string }>>();
    let released = 0;
    for (const c of expired) {
      try {
        const redeem = await LoyaltyEntryModel.findOne({
          entryKey: `redeem:${c._id.toString()}`,
        }).lean<LoyaltyEntryRecord>();
        await CouponModel.updateOne(
          { _id: c._id, usedCount: 0, reservedCount: 0 },
          { $set: { active: false } },
        );
        if (!redeem) continue;
        released += await this.post({
          userId: redeem.userId,
          entryKey: `release:${c._id.toString()}`,
          type: 'REDEEM_RELEASE',
          points: -redeem.points,
          description: `Coupon ${c.code} expired unused`,
          couponId: c._id,
        });
      } catch (error) {
        // One bad record must not stop the rest of the batch.
        this.deps.logger.warn(
          { err: (error as Error).message },
          'Points coupon release failed for one item; continuing',
        );
      }
    }
    return released;
  }

  // ------------------------------------------------------------------ referrals
  private async codeFor(userId: string): Promise<string> {
    const existing = await ReferralCodeModel.findOne({ userId }).lean<ReferralCodeAttrs>();
    if (existing) return existing.code;
    for (let i = 0; i < 5; i += 1) {
      try {
        return (await ReferralCodeModel.create({ userId, code: randomCode(8) })).code;
      } catch (error) {
        if (!isMongoDuplicateKey(error)) throw error;
        const raced = await ReferralCodeModel.findOne({ userId }).lean<ReferralCodeAttrs>();
        if (raced) return raced.code;
      }
    }
    throw new AppError(
      503,
      'SERVICE_UNAVAILABLE',
      'Could not create a referral code. Please retry.',
    );
  }

  async referralSummary(userId: string): Promise<ReferralSummaryDto> {
    const code = await this.codeFor(userId);
    const uid = new Types.ObjectId(userId);
    const [mine, by, rewardedThisYear] = await Promise.all([
      ReferralModel.find({ referrerId: uid })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean<ReferralRecord[]>(),
      ReferralModel.findOne({ refereeId: uid }).lean<ReferralRecord>(),
      ReferralModel.countDocuments({
        referrerId: uid,
        status: 'REWARDED',
        rewardedAt: { $gte: new Date(Date.now() - 365 * 86_400_000) },
      }),
    ]);
    const people = await UserModel.find(
      { _id: { $in: mine.map((r) => r.refereeId) } },
      { firstName: 1, lastName: 1 },
    ).lean<Array<{ _id: Types.ObjectId; firstName: string; lastName: string }>>();
    return {
      code,
      rewardedThisYear,
      limitPerYear: REFERRAL_RULES.maxRewardedPerYear,
      // Only initials: the referrer never sees the new customer's details.
      referrals: mine.map((r) => {
        const p = people.find((x) => x._id.equals(r.refereeId));
        return {
          status: r.status,
          joinedAt: r.createdAt.toISOString(),
          rewardedAt: r.rewardedAt?.toISOString() ?? null,
          refereeInitials: p ? `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase() : '—',
          reason: r.reason,
        };
      }),
      referredBy: by ? { status: by.status } : null,
    };
  }

  async claim(userId: string, code: string, context: RequestContext) {
    const user = await UserModel.findById(userId, { createdAt: 1, emailVerifiedAt: 1 }).lean<{
      createdAt: Date;
      emailVerifiedAt: Date | null;
    }>();
    if (!user) throw Errors.notFound('User');
    const owner = await ReferralCodeModel.findOne({ code }).lean<ReferralCodeAttrs>();
    const reject = (msg: string) => Errors.validation({ fieldErrors: { code: [msg] } });
    if (!owner) throw reject('This referral code is not valid');
    if (owner.userId.equals(userId)) throw reject('You cannot use your own code');
    if (!user.emailVerifiedAt) throw reject('Verify your email address first');
    if (Date.now() - user.createdAt.getTime() > REFERRAL_RULES.claimWindowDays * 86_400_000)
      throw reject(
        `Referral codes must be added within ${REFERRAL_RULES.claimWindowDays} days of joining`,
      );
    if (await BookingModel.exists({ customerId: userId, confirmedAt: { $ne: null } }))
      throw reject('Referral codes are for new customers before their first booking');
    const referrer = await UserModel.findById(owner.userId, {
      accountStatus: 1,
      emailVerifiedAt: 1,
    }).lean<{ accountStatus: string; emailVerifiedAt: Date | null }>();
    if (!referrer || referrer.accountStatus !== 'ACTIVE' || !referrer.emailVerifiedAt)
      throw reject('This referral code is not valid');
    // A referee can be referred once; the reverse pair (A refers B, B refers A) is refused.
    if (await ReferralModel.exists({ referrerId: userId, refereeId: owner.userId }))
      throw reject('This referral code is not valid');
    try {
      await ReferralModel.create({ referrerId: owner.userId, refereeId: userId, code });
    } catch (error) {
      if (isMongoDuplicateKey(error))
        throw new AppError(409, 'CONFLICT', 'A referral code is already linked to your account.');
      throw error;
    }
    await this.deps.audit.record({
      actorId: userId,
      action: 'referral.claimed',
      entityType: 'User',
      entityId: userId,
      metadata: { referrerId: owner.userId.toString() },
      context,
    });
    return this.referralSummary(userId);
  }

  /** Scheduled: reward referrals whose new customer completed a qualifying stay. */
  async qualifyReferrals(now = new Date()): Promise<{ rewarded: number; rejected: number }> {
    let rewarded = 0;
    let rejected = 0;
    const pending = await ReferralModel.find({ status: 'PENDING' })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean<ReferralRecord[]>();
    for (const r of pending) {
      try {
        if (now.getTime() - r.createdAt.getTime() > 365 * 86_400_000) {
          rejected += (
            await ReferralModel.updateOne(
              { _id: r._id, status: 'PENDING' },
              { $set: { status: 'REJECTED', reason: 'No qualifying stay within a year' } },
            )
          ).modifiedCount;
          continue;
        }
        const stay = await BookingModel.findOne(
          {
            customerId: r.refereeId,
            bookingStatus: 'COMPLETED',
            paymentStatus: { $ne: 'REFUNDED' },
            'priceSnapshot.totals.subtotalMinor': {
              $gte: REFERRAL_RULES.minQualifyingSubtotalMinor,
            },
          },
          { _id: 1, bookingReference: 1 },
        )
          .sort({ completedAt: 1 })
          .lean<BookingRecord>();
        if (!stay) continue;
        const count = await ReferralModel.countDocuments({
          referrerId: r.referrerId,
          status: 'REWARDED',
          rewardedAt: { $gte: new Date(now.getTime() - 365 * 86_400_000) },
        });
        if (count >= REFERRAL_RULES.maxRewardedPerYear) {
          rejected += (
            await ReferralModel.updateOne(
              { _id: r._id, status: 'PENDING' },
              {
                $set: {
                  status: 'REJECTED',
                  reason: 'The referrer reached the yearly referral limit',
                },
              },
            )
          ).modifiedCount;
          continue;
        }
        const ok = await withTransaction(async (session) => {
          const claimed = await ReferralModel.updateOne(
            { _id: r._id, status: 'PENDING' },
            { $set: { status: 'REWARDED', rewardedAt: now, qualifyingBookingId: stay._id } },
            { session },
          );
          if (claimed.modifiedCount !== 1) return false;
          await this.post(
            {
              userId: r.referrerId,
              entryKey: `referral:${r._id.toString()}:referrer`,
              type: 'REFERRAL_BONUS',
              points: REFERRAL_RULES.referrerPoints,
              description: 'Referral reward: a friend completed their first stay',
            },
            session,
          );
          await this.post(
            {
              userId: r.refereeId,
              entryKey: `referral:${r._id.toString()}:referee`,
              type: 'REFERRAL_BONUS',
              points: REFERRAL_RULES.refereePoints,
              description: 'Welcome reward for your first stay',
            },
            session,
          );
          return true;
        });
        if (ok) {
          rewarded += 1;
          await this.deps.notifications.notifyInApp({
            userId: r.referrerId.toString(),
            type: 'REFERRAL_REWARD',
            title: `You earned ${REFERRAL_RULES.referrerPoints} referral points`,
            body: 'A friend you referred completed their first stay.',
          });
          await this.deps.notifications.notifyInApp({
            userId: r.refereeId.toString(),
            type: 'REFERRAL_REWARD',
            title: `You earned ${REFERRAL_RULES.refereePoints} welcome points`,
            body: 'Thanks for completing your first stay.',
          });
        }
      } catch (error) {
        // One bad record must not stop the rest of the batch.
        this.deps.logger.warn(
          { err: (error as Error).message },
          'Referral qualification failed for one item; continuing',
        );
      }
    }
    return { rewarded, rejected };
  }
}
