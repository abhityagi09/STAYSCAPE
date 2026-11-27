import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { bearer, createUserWithRoles } from '@/test/helpers';
import { bookingWorld, holdAndBook, idem, payInFull } from '@/test/booking-fixtures';
import { PaymentModel, SandboxRecordModel } from '@/modules/payments/payment.models';
import { LedgerEntryModel } from './finance.models';

const URL = '/api/v1/admin/finance/reconciliation';

describe('financial reconciliation report', () => {
  it('ties bookings, provider payments, refunds and the ledger together, then flags tampering', async () => {
    const { app, admin, customer, hotel } = await bookingWorld();
    const kept = await holdAndBook(app, customer, hotel, [10, 12]);
    await payInFull(app, customer, kept.booking.reference);
    const cancelled = await holdAndBook(app, customer, hotel, [20, 21]);
    await payInFull(app, customer, cancelled.booking.reference);
    await request(app)
      .post(`/api/v1/bookings/${cancelled.booking.reference}/cancel`)
      .set(bearer(customer.accessToken))
      .set(idem())
      .send({ reason: 'Plans changed' })
      .expect(200);

    const clean = (await request(app).get(URL).set(bearer(admin.accessToken)).expect(200)).body
      .data;
    expect(clean.exceptions).toEqual([]);
    expect(clean.mismatchCount).toBe(0);
    const bookings = clean.bookings.INR;
    const provider = clean.providerPayments.INR;
    expect(bookings.count).toBe(2);
    expect(provider.capturedMinor).toBe(bookings.totalMinor);
    expect(clean.refunds.INR.SUCCEEDED.amountMinor).toBe(provider.refundedMinor);
    // Ledger cash = captured − refunded; it always equals the sum of the other accounts.
    const ledger = clean.ledger.INR;
    expect(ledger.CASH).toBe(provider.capturedMinor - provider.refundedMinor);
    expect(ledger.CASH).toBe(
      (ledger.PARTNER_PAYABLE ?? 0) +
        (ledger.PLATFORM_REVENUE ?? 0) +
        (ledger.PROMOTION_EXPENSE ?? 0) +
        (ledger.UNALLOCATED ?? 0),
    );
    expect(clean.partnerBalances).toEqual([
      expect.objectContaining({ currency: 'INR', balanceMinor: ledger.PARTNER_PAYABLE }),
    ]);

    // Simulate corruption the report must surface (never silently fix).
    await LedgerEntryModel.collection.deleteMany({ entryKey: { $regex: /\.commission$/ } });
    await PaymentModel.updateOne({ status: 'SUCCESS' }, { $set: { refundedMinor: 1 } });
    const dirty = (await request(app).get(URL).set(bearer(admin.accessToken)).expect(200)).body
      .data;
    const checks = dirty.exceptions.map((e: { check: string }) => e.check);
    expect(checks).toEqual(
      expect.arrayContaining(['UNBALANCED_LEDGER_TRANSACTION', 'PAYMENT_REFUNDED_TOTAL_MISMATCH']),
    );
    const csv = await request(app)
      .get(`${URL}?format=csv`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\n')[0]).toBe(
      'check,severity,reference,expected_minor,actual_minor,detail',
    );
    // Reading the report changed nothing.
    expect(await LedgerEntryModel.countDocuments({ entryKey: { $regex: /\.commission$/ } })).toBe(
      0,
    );
  });

  it('checks captured payments against the provider when asked', async () => {
    const { app, admin, customer, hotel } = await bookingWorld();
    for (const nights of [
      [10, 12],
      [14, 15],
    ] as Array<[number, number]>) {
      const { booking } = await holdAndBook(app, customer, hotel, nights);
      await payInFull(app, customer, booking.reference);
    }
    const clean = (
      await request(app).get(`${URL}?provider=true`).set(bearer(admin.accessToken)).expect(200)
    ).body.data;
    expect(clean.provider).toMatchObject({ checked: 2, available: true, truncated: false });
    expect(clean.provider.providerCapturedMinor).toBe(clean.providerPayments.INR.capturedMinor);
    expect(clean.exceptions).toEqual([]);
    // Without the flag the provider is not called.
    expect(
      (await request(app).get(URL).set(bearer(admin.accessToken))).body.data.provider,
    ).toBeNull();

    const [first, second] = await PaymentModel.find({ status: 'SUCCESS' })
      .sort({ createdAt: 1 })
      .lean();
    await PaymentModel.updateOne({ _id: first!._id }, { $inc: { amountMinor: 100 } });
    await SandboxRecordModel.updateOne(
      { entityId: second!.providerPaymentId },
      { $set: { status: 'failed' } },
    );
    const dirty = (
      await request(app).get(`${URL}?provider=true`).set(bearer(admin.accessToken)).expect(200)
    ).body.data;
    const checks = dirty.exceptions.map((e: { check: string }) => e.check);
    expect(checks).toEqual(
      expect.arrayContaining(['PROVIDER_AMOUNT_MISMATCH', 'PROVIDER_STATUS_MISMATCH']),
    );
  });

  it('requires finance read permission', async () => {
    const { app, customer, owner } = await bookingWorld();
    await request(app).get(URL).expect(401);
    await request(app).get(URL).set(bearer(customer.accessToken)).expect(403);
    await request(app).get(URL).set(bearer(owner.accessToken)).expect(403);
    const support = await createUserWithRoles(app, ['SUPPORT']);
    await request(app).get(URL).set(bearer(support.accessToken)).expect(200);
  });
});
