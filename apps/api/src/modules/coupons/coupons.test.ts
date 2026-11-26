import request from 'supertest';
import type { Express } from 'express';
import { describe, expect, it } from 'vitest';
import { BookingHoldModel, BookingModel } from '@/modules/bookings/booking.models';
import { LedgerEntryModel } from '@/modules/finance/finance.models';
import { bearer, registerUser, type SignedInUser } from '@/test/helpers';
import { daysFromToday } from '@/test/marketplace-fixtures';
import { bookingWorld, createHold, guestDetails, holdBody, idem, payInFull } from '@/test/booking-fixtures';
import { CouponModel, CouponRedemptionModel } from './coupons.models';

async function makeCoupon(app: Express, admin: SignedInUser, over: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/admin/coupons')
    .set(bearer(admin.accessToken))
    .send({ code: 'MONSOON10', name: 'Monsoon 10%', discountType: 'PERCENT', value: 1_000, startsAt: new Date(Date.now() - 60_000).toISOString(), ...over });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('coupons', () => {
  it('never exceeds the total limit under concurrent checkouts', async () => {
    const { app, admin, hotel } = await bookingWorld({ room: { totalInventory: 20 } });
    await makeCoupon(app, admin, { totalLimit: 3 });
    const users = await Promise.all(Array.from({ length: 8 }, () => registerUser(app)));
    const results = await Promise.all(users.map((u) => createHold(app, u, { ...holdBody(hotel, daysFromToday(30), daysFromToday(31)), couponCode: 'monsoon10' })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422).every((r) => r.body.error.code === 'NOT_ELIGIBLE')).toBe(true);
    expect(await CouponModel.findOne({ code: 'MONSOON10' }).lean()).toMatchObject({ reservedCount: 3, usedCount: 0 });
    // A rejected coupon never leaves rooms held.
    expect((await BookingHoldModel.countDocuments({ status: 'ACTIVE' }))).toBe(3);
  });

  it('enforces the per-user limit atomically and releases the use when a hold expires', async () => {
    const { app, admin, hotel, customer, container } = await bookingWorld({ room: { totalInventory: 20 } });
    await makeCoupon(app, admin, { perUserLimit: 1 });
    const attempts = await Promise.all([30, 32, 34].map((d) => createHold(app, customer, { ...holdBody(hotel, daysFromToday(d), daysFromToday(d + 1)), couponCode: 'MONSOON10' })));
    expect(attempts.filter((r) => r.status === 201)).toHaveLength(1);
    const held = attempts.find((r) => r.status === 201)!.body.data;
    expect(held.price).toMatchObject({ coupon: { code: 'MONSOON10', discountMinor: 50_000 }, totals: { totalMinor: 475_000 } });

    await BookingHoldModel.updateOne({ holdReference: held.reference }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await container.services.bookings.expireHolds();
    await container.services.bookings.expireHolds(); // repeated runs never double-release
    expect(await CouponModel.findOne({ code: 'MONSOON10' }).lean()).toMatchObject({ reservedCount: 0, usedCount: 0 });
    expect((await createHold(app, customer, { ...holdBody(hotel, daysFromToday(40), daysFromToday(41)), couponCode: 'MONSOON10' })).status).toBe(201);
  });

  it('redeems on payment: guest pays the discounted total, partner payable is unchanged, ledger balances', async () => {
    const { app, admin, hotel, customer } = await bookingWorld();
    await makeCoupon(app, admin, { discountType: 'FIXED', value: 100_000, code: 'WELCOME1000', firstBookingOnly: true });
    const held = await createHold(app, customer, { ...holdBody(hotel, daysFromToday(10), daysFromToday(12)), couponCode: 'WELCOME1000' });
    expect(held.status).toBe(201);
    const booked = await request(app).post('/api/v1/bookings').set(bearer(customer.accessToken)).set(idem()).send({ holdReference: held.body.data.reference, guestDetails, acceptTerms: true }).expect(201);
    expect(booked.body.data.totalMinor).toBe(950_000); // 1,050,000 − 100,000
    const paid = await payInFull(app, customer, booked.body.data.reference);
    expect(paid.payments[0]).toMatchObject({ amountMinor: 950_000, status: 'SUCCESS' });
    expect(await CouponRedemptionModel.findOne({ code: 'WELCOME1000' }).lean()).toMatchObject({ status: 'REDEEMED' });
    expect(await CouponModel.findOne({ code: 'WELCOME1000' }).lean()).toMatchObject({ usedCount: 1, reservedCount: 0 });

    const stored = (await BookingModel.findOne({ bookingReference: paid.reference }).lean())!;
    const rows = await LedgerEntryModel.find({ bookingId: stored._id }).lean();
    const by = Object.fromEntries(rows.map((r) => [r.account, r.amountMinor]));
    // Gross 1,050,000; commission 15% of the 1,000,000 room subtotal = 150,000; coupon funded by the platform.
    expect(by).toEqual({ CASH: 950_000, PARTNER_PAYABLE: 900_000, PLATFORM_REVENUE: 150_000, PROMOTION_EXPENSE: -100_000 });

    // First-booking coupons cannot be used again by the same customer.
    await makeCoupon(app, admin, { code: 'FIRSTONLY', discountType: 'FIXED', value: 10_000, firstBookingOnly: true });
    const again = await createHold(app, customer, { ...holdBody(hotel, daysFromToday(20), daysFromToday(21)), couponCode: 'FIRSTONLY' });
    expect(again.status).toBe(422);
  });

  it('checks dates, property, stacking, minimum and permissions', async () => {
    const { app, admin, hotel, customer } = await bookingWorld({ rate: { cancellationPolicy: { type: 'FREE_CANCELLATION', freeCancellationHours: 48, refundBasisPointsAfterDeadline: 0 } } });
    await makeCoupon(app, admin, { code: 'FUTURE', startsAt: new Date(Date.now() + 86_400_000).toISOString() });
    await makeCoupon(app, admin, { code: 'OTHERHOTEL', eligibleHotelIds: ['64b0000000000000000000ff'] });
    await makeCoupon(app, admin, { code: 'BIGSPEND', minBookingMinor: 5_000_000 });
    const body = (code: string) => ({ ...holdBody(hotel, daysFromToday(12), daysFromToday(13)), couponCode: code });
    for (const code of ['FUTURE', 'OTHERHOTEL', 'BIGSPEND', 'NOPE123']) expect((await createHold(app, customer, body(code))).status).toBe(422);
    await request(app).post('/api/v1/admin/coupons').set(bearer(customer.accessToken)).send({}).expect(403);
    await request(app).post('/api/v1/admin/coupons').set(bearer(admin.accessToken)).send({ code: 'MONSOON10', name: 'x', discountType: 'PERCENT', value: 20_000, startsAt: new Date().toISOString() }).expect(422);
  });
});
