import request from 'supertest';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { BookingModel } from '@/modules/bookings/booking.models';
import { CouponModel } from '@/modules/coupons/coupons.models';
import { PaymentModel, RefundModel } from '@/modules/payments/payment.models';
import { UserModel } from '@/modules/users/user.model';
import { bearer, registerUser } from '@/test/helpers';
import { bookingWorld, holdAndBook, payInFull } from '@/test/booking-fixtures';
import { LoyaltyEntryModel, stayPoints, tierFor } from './rewards.service';

const verify = (id: string) =>
  UserModel.updateOne({ _id: id }, { $set: { emailVerifiedAt: new Date() } });

describe('loyalty rules', () => {
  it('computes points and tiers deterministically', () => {
    expect(stayPoints(1_000_000, 1_050_000, 0)).toBe(100);
    expect(stayPoints(1_000_000, 1_050_000, 525_000)).toBe(50);
    expect(stayPoints(1_000_000, 1_050_000, 1_050_000)).toBe(0);
    expect(stayPoints(9_999, 10_000, 0)).toBe(0);
    expect(tierFor(0)).toEqual({ tier: 'MEMBER', next: { tier: 'SILVER', pointsNeeded: 2_000 } });
    expect(tierFor(6_500).tier).toBe('GOLD');
    expect(tierFor(20_000)).toEqual({ tier: 'PLATINUM', next: null });
  });
});

describe('loyalty and referrals', () => {
  it('earns only on completed stays, reverses on refunds, redeems atomically and returns expired redemptions', async () => {
    const { app, customer, hotel, container } = await bookingWorld();
    const rewards = container.services.rewards;
    const referrer = await registerUser(app);
    await verify(referrer.id);
    await verify(customer.id);
    const code = (
      await request(app)
        .get('/api/v1/rewards/referrals')
        .set(bearer(referrer.accessToken))
        .expect(200)
    ).body.data.code;

    // Guards: own code, bad code.
    await request(app)
      .post('/api/v1/rewards/referrals/claim')
      .set(bearer(referrer.accessToken))
      .send({ code })
      .expect(422);
    await request(app)
      .post('/api/v1/rewards/referrals/claim')
      .set(bearer(customer.accessToken))
      .send({ code: 'ZZZZZZZZ' })
      .expect(422);
    await request(app)
      .post('/api/v1/rewards/referrals/claim')
      .set(bearer(customer.accessToken))
      .send({ code })
      .expect(201);
    await request(app)
      .post('/api/v1/rewards/referrals/claim')
      .set(bearer(customer.accessToken))
      .send({ code })
      .expect(409);

    const { booking } = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, booking.reference);
    // Confirmed is not enough: nothing is earned or rewarded before the stay is completed.
    expect(await rewards.accrue()).toEqual({ earned: 0, reversed: 0 });
    expect(await rewards.qualifyReferrals()).toEqual({ rewarded: 0, rejected: 0 });

    await BookingModel.updateOne(
      { bookingReference: booking.reference },
      { $set: { bookingStatus: 'COMPLETED', completedAt: new Date() } },
    );
    expect(await rewards.accrue()).toEqual({ earned: 100, reversed: 0 });
    expect(await rewards.accrue()).toEqual({ earned: 0, reversed: 0 }); // idempotent
    expect(await rewards.qualifyReferrals()).toEqual({ rewarded: 1, rejected: 0 });
    expect(await rewards.qualifyReferrals()).toEqual({ rewarded: 0, rejected: 0 });

    const mine = (
      await request(app)
        .get('/api/v1/rewards/loyalty')
        .set(bearer(customer.accessToken))
        .expect(200)
    ).body.data;
    expect(mine).toMatchObject({ balance: 350, lifetimeEarned: 350, tier: 'MEMBER' });
    expect(mine.entries.map((e: { type: string }) => e.type).sort()).toEqual([
      'EARN',
      'REFERRAL_BONUS',
    ]);
    const theirs = (
      await request(app)
        .get('/api/v1/rewards/referrals')
        .set(bearer(referrer.accessToken))
        .expect(200)
    ).body.data;
    expect(theirs.referrals).toEqual([
      expect.objectContaining({
        status: 'REWARDED',
        refereeInitials: expect.stringMatching(/^[A-Z]{2}$/),
      }),
    ]);
    expect(JSON.stringify(theirs)).not.toContain(customer.email);

    // Redemption: not enough points → refused; enough → single-use personal coupon, balance debited.
    await request(app)
      .post('/api/v1/rewards/loyalty/redeem')
      .set(bearer(customer.accessToken))
      .send({ points: 500 })
      .expect(409);
    const redeemed = (
      await request(app)
        .post('/api/v1/rewards/loyalty/redeem')
        .set(bearer(referrer.accessToken))
        .send({ points: 500 })
        .expect(201)
    ).body.data;
    expect(redeemed).toMatchObject({ valueMinor: 5_000, summary: { balance: 0 } });
    const coupon = (await CouponModel.findOne({ code: redeemed.code }).lean())!;
    expect(coupon).toMatchObject({ kind: 'LOYALTY', totalLimit: 1, value: 5_000 });
    expect(coupon.eligibleUserIds.map(String)).toEqual([referrer.id]);
    // Concurrent redemptions can never overdraw.
    await CouponModel.updateOne(
      { _id: coupon._id },
      { $set: { endsAt: new Date(Date.now() - 1000) } },
    );
    expect(await rewards.releaseExpiredRedemptions()).toBe(500);
    expect(await rewards.releaseExpiredRedemptions()).toBe(0);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        request(app)
          .post('/api/v1/rewards/loyalty/redeem')
          .set(bearer(referrer.accessToken))
          .send({ points: 500 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);

    // A later refund of half the stay reverses half its points.
    const stored = (await BookingModel.findOne({ bookingReference: booking.reference }).lean())!;
    const payment = (await PaymentModel.findOne({ bookingId: stored._id }).lean())!;
    await PaymentModel.updateOne(
      { _id: payment._id },
      { $set: { refundedMinor: 525_000, status: 'PARTIALLY_REFUNDED' } },
    );
    await RefundModel.create({
      bookingId: stored._id,
      paymentId: payment._id,
      customerId: customer.id,
      amountMinor: 525_000,
      currency: 'INR',
      reason: 'Goodwill',
      source: 'ADMIN',
      status: 'SUCCEEDED',
      idempotencyKey: 'test-refund-1',
      requestedAt: new Date(),
      completedAt: new Date(),
    });
    expect(await rewards.accrue()).toEqual({ earned: 0, reversed: 50 });
    expect(await rewards.accrue()).toEqual({ earned: 0, reversed: 0 });
    expect(
      (
        await request(app)
          .get('/api/v1/rewards/loyalty')
          .set(bearer(customer.accessToken))
          .expect(200)
      ).body.data.balance,
    ).toBe(300);

    // The ledger is append-only.
    await expect(LoyaltyEntryModel.updateOne({}, { $set: { points: 1 } })).rejects.toThrow(
      /append-only/,
    );
  });

  it('refuses late or post-booking referral claims and unverified accounts', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const referrer = await registerUser(app);
    await verify(referrer.id);
    const code = (
      await request(app)
        .get('/api/v1/rewards/referrals')
        .set(bearer(referrer.accessToken))
        .expect(200)
    ).body.data.code;
    await request(app)
      .post('/api/v1/rewards/referrals/claim')
      .set(bearer(customer.accessToken))
      .send({ code })
      .expect(422); // unverified
    await verify(customer.id);
    const { booking } = await holdAndBook(app, customer, hotel, [10, 11]);
    await payInFull(app, customer, booking.reference);
    await request(app)
      .post('/api/v1/rewards/referrals/claim')
      .set(bearer(customer.accessToken))
      .send({ code })
      .expect(422); // already booked
    const late = await registerUser(app);
    // createdAt is immutable through Mongoose; backdate the raw document.
    await UserModel.collection.updateOne(
      { _id: new Types.ObjectId(late.id) },
      { $set: { emailVerifiedAt: new Date(), createdAt: new Date(Date.now() - 10 * 86_400_000) } },
    );
    await request(app)
      .post('/api/v1/rewards/referrals/claim')
      .set(bearer(late.accessToken))
      .send({ code })
      .expect(422);
  });
});
