import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { BookingModel } from '@/modules/bookings/booking.models';
import { bearer, registerUser } from '@/test/helpers';
import { PDF, createApprovedPartner } from '@/test/marketplace-fixtures';
import { bookingWorld, holdAndBook, idem, payInFull } from '@/test/booking-fixtures';
import { LedgerEntryModel, SettlementModel } from './finance.models';

const sumBy = async (filter: Record<string, unknown>) => {
  const rows = await LedgerEntryModel.find(filter).lean();
  const by: Record<string, number> = {};
  for (const r of rows) by[r.account] = (by[r.account] ?? 0) + r.amountMinor;
  return by;
};
const balanced = (by: Record<string, number>) => (by.CASH ?? 0) === (by.PARTNER_PAYABLE ?? 0) + (by.PLATFORM_REVENUE ?? 0) + (by.PROMOTION_EXPENSE ?? 0) + (by.UNALLOCATED ?? 0);

describe('commission and ledger', () => {
  it('snapshots commission at confirmation and posts balanced entries; rule changes do not rewrite history', async () => {
    const { app, customer, hotel, admin, owner } = await bookingWorld();
    await request(app)
      .post('/api/v1/admin/commissions')
      .set(bearer(admin.accessToken))
      .send({ name: 'Partner deal', scope: 'PARTNER', partnerId: owner.partnerId, rateBasisPoints: 1_000, effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() })
      .expect(201);
    const { booking } = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, booking.reference);
    const stored = (await BookingModel.findOne({ bookingReference: booking.reference }).lean())!;
    // ₹5,000 × 2 nights = ₹10,000 room subtotal (taxes excluded) → 10% = ₹1,000.
    expect(stored.commissionSnapshot).toMatchObject({ ruleName: 'Partner deal', scope: 'PARTNER', baseMinor: 1_000_000, commissionMinor: 100_000 });
    const by = await sumBy({ bookingId: stored._id });
    expect(by).toMatchObject({ CASH: 1_050_000, PLATFORM_REVENUE: 100_000, PARTNER_PAYABLE: 950_000 });
    expect(balanced(by)).toBe(true);

    // Changing the rule afterwards never alters the snapshot or posted entries.
    await request(app).post('/api/v1/admin/commissions').set(bearer(admin.accessToken)).send({ name: 'Hotel 25%', scope: 'HOTEL', hotelId: hotel.hotelId, rateBasisPoints: 2_500, effectiveFrom: new Date(Date.now() - 1000).toISOString() }).expect(201);
    expect((await BookingModel.findOne({ bookingReference: booking.reference }).lean())!.commissionSnapshot!.commissionMinor).toBe(100_000);
    // Ledger rows are immutable at the model level.
    await expect(LedgerEntryModel.updateOne({ bookingId: stored._id }, { $set: { amountMinor: 1 } })).rejects.toThrow(/append-only/);
    // Customers cannot manage commissions.
    await request(app).post('/api/v1/admin/commissions').set(bearer(customer.accessToken)).send({}).expect(403);
  });

  it('reverses commission proportionally on refunds and keeps every account balanced', async () => {
    const { app, customer, hotel } = await bookingWorld({ rate: { cancellationPolicy: { type: 'FREE_CANCELLATION', freeCancellationHours: 72, refundBasisPointsAfterDeadline: 5_000 } } });
    const { booking } = await holdAndBook(app, customer, hotel, [1, 2]); // inside 72 h → 50 % refund
    await payInFull(app, customer, booking.reference);
    await request(app).post(`/api/v1/bookings/${booking.reference}/cancel`).set(bearer(customer.accessToken)).set(idem()).send({}).expect(200);
    const stored = (await BookingModel.findOne({ bookingReference: booking.reference }).lean())!;
    // Paid ₹5,250; default 15% of ₹5,000 = ₹750 commission; refund ₹2,625 = 50% → commission reversal ₹375.
    const by = await sumBy({ bookingId: stored._id });
    expect(by).toMatchObject({ CASH: 262_500, PLATFORM_REVENUE: 37_500, PARTNER_PAYABLE: 225_000 });
    expect(balanced(by)).toBe(true);
    const refundRows = await LedgerEntryModel.find({ bookingId: stored._id, event: 'REFUND_SUCCEEDED' }).lean();
    expect(refundRows.map((r) => r.account).sort()).toEqual(['CASH', 'PARTNER_PAYABLE', 'PLATFORM_REVENUE']);
  });

  it('records an unallocated late payment and its refund without touching partner payables', async () => {
    const { app, customer, hotel, container } = await bookingWorld({ room: { totalInventory: 1 } });
    const { BookingHoldModel } = await import('@/modules/bookings/booking.models');
    const { startPayment, sandboxPay, verify } = await import('@/test/booking-fixtures');
    const { booking, hold } = await holdAndBook(app, customer, hotel, [10, 12]);
    await startPayment(app, customer, booking.reference);
    const completion = await sandboxPay(app, customer, booking.reference);
    await BookingHoldModel.updateOne({ holdReference: hold.reference }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await container.services.bookings.expireHolds();
    const other = await registerUser(app);
    const theirs = await holdAndBook(app, other, hotel, [10, 12]);
    await payInFull(app, other, theirs.booking.reference);
    await verify(app, customer, booking.reference, completion).expect(200);
    const stored = (await BookingModel.findOne({ bookingReference: booking.reference }).lean())!;
    const by = await sumBy({ bookingId: stored._id });
    expect(by).toEqual({ CASH: 0, UNALLOCATED: 0 });
  });
});

describe('settlements', () => {
  it('settles only completed stays, requires evidence to mark paid, and isolates partners', async () => {
    const { app, customer, hotel, admin, owner, container } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [0, 1]);
    await payInFull(app, customer, booking.reference);
    const create = () => request(app).post('/api/v1/admin/settlements').set(bearer(admin.accessToken)).send({ partnerId: owner.partnerId });
    expect((await create()).status).toBe(409); // stay not over yet

    // Complete the stay and move the hold period into the past.
    await container.services.lifecycle.completeStays(new Date(Date.now() + 2 * 86_400_000));
    await BookingModel.updateOne({ bookingReference: booking.reference }, { $set: { checkOutLocalDate: '2020-01-02' } });
    const summary = await request(app).get('/api/v1/partner/finance/summary').set(bearer(owner.accessToken)).expect(200);
    expect(summary.body.data).toMatchObject({ eligibleForSettlementMinor: 450_000, eligibleEntries: 1 });

    const settlement = (await create().expect(201)).body.data;
    expect(settlement).toMatchObject({ status: 'ELIGIBLE', netPayableMinor: 450_000, entryCount: 1 });
    expect((await create()).status).toBe(409); // entries already in a live batch

    await request(app).post(`/api/v1/admin/settlements/${settlement._id}/initiate-payout`).set(bearer(admin.accessToken)).expect(409);
    const noEvidence = await request(app).post(`/api/v1/admin/settlements/${settlement._id}/record-payment`).set(bearer(admin.accessToken)).field('method', 'BANK_TRANSFER').field('providerReference', 'UTR123456').field('paidAt', new Date().toISOString());
    expect(noEvidence.status).toBe(422);
    await request(app)
      .post(`/api/v1/admin/settlements/${settlement._id}/record-payment`)
      .set(bearer(admin.accessToken))
      .field('method', 'BANK_TRANSFER')
      .field('providerReference', 'UTR123456')
      .field('paidAt', new Date().toISOString())
      .attach('file', PDF, { filename: 'transfer.pdf', contentType: 'application/pdf' })
      .expect(200);
    const paid = (await SettlementModel.findById(settlement._id).lean())!;
    expect(paid).toMatchObject({ status: 'PAID', evidence: { providerReference: 'UTR123456' } });
    expect(paid.statusHistory.map((s) => s.status)).toEqual(['PENDING', 'PAID']);
    const after = await request(app).get('/api/v1/partner/finance/summary').set(bearer(owner.accessToken)).expect(200);
    expect(after.body.data).toMatchObject({ outstandingPayableMinor: 0, paidOutMinor: 450_000, eligibleForSettlementMinor: 0 });

    // Another partner sees none of this; customers cannot reach partner finance.
    const otherOwner = await createApprovedPartner(app, admin);
    expect((await request(app).get('/api/v1/partner/finance/settlements').set(bearer(otherOwner.accessToken)).expect(200)).body.data.items).toHaveLength(0);
    await request(app).get(`/api/v1/partner/finance/settlements/${settlement._id}/entries`).set(bearer(otherOwner.accessToken)).expect(404);
    await request(app).get('/api/v1/partner/finance/summary').set(bearer(customer.accessToken)).expect(403);
  });

  it('releases entries when a settlement fails so they can be settled again', async () => {
    const { app, customer, hotel, admin, owner, container } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [0, 1]);
    await payInFull(app, customer, booking.reference);
    await container.services.lifecycle.completeStays(new Date(Date.now() + 2 * 86_400_000));
    await BookingModel.updateOne({ bookingReference: booking.reference }, { $set: { checkOutLocalDate: '2020-01-02' } });
    const first = (await request(app).post('/api/v1/admin/settlements').set(bearer(admin.accessToken)).send({ partnerId: owner.partnerId }).expect(201)).body.data;
    await request(app).post(`/api/v1/admin/settlements/${first._id}/fail`).set(bearer(admin.accessToken)).send({ reason: 'Bank rejected account' }).expect(200);
    const second = (await request(app).post('/api/v1/admin/settlements').set(bearer(admin.accessToken)).send({ partnerId: owner.partnerId }).expect(201)).body.data;
    expect(second.netPayableMinor).toBe(first.netPayableMinor);
  });
});
