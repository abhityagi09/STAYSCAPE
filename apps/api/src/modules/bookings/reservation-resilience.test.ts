/**
 * Concurrency and recovery scenarios for the reservation engine, run against a real
 * transaction-capable MongoDB replica set (see test/global-setup.ts).
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LedgerEntryModel } from '@/modules/finance/finance.models';
import { DailyInventoryModel } from '@/modules/inventory/inventory.models';
import { PaymentModel, RefundModel, SandboxRecordModel } from '@/modules/payments/payment.models';
import { bearer, registerUser } from '@/test/helpers';
import { daysFromToday } from '@/test/marketplace-fixtures';
import {
  bookingWorld,
  createHold,
  getBooking,
  holdAndBook,
  holdBody,
  idem,
  sandboxPay,
  startPayment,
  verify,
  deliverWebhook,
} from '@/test/booking-fixtures';
import { BookingHoldModel, BookingModel } from './booking.models';

const nights = (roomTypeId: string, from: number, to: number) =>
  DailyInventoryModel.find({
    roomTypeId,
    localDate: { $gte: daysFromToday(from), $lt: daysFromToday(to) },
  })
    .sort({ localDate: 1 })
    .lean();

async function assertInvariant() {
  const broken = await DailyInventoryModel.countDocuments({
    $expr: { $gt: [{ $add: ['$heldRooms', '$bookedRooms', '$blockedRooms'] }, '$totalRooms'] },
  });
  const negative = await DailyInventoryModel.countDocuments({
    $or: [{ heldRooms: { $lt: 0 } }, { bookedRooms: { $lt: 0 } }, { blockedRooms: { $lt: 0 } }],
  });
  expect({ broken, negative }).toEqual({ broken: 0, negative: 0 });
}

describe('reservation concurrency and recovery', () => {
  it('ten simultaneous customers for three rooms: exactly three multi-night holds, no oversell', async () => {
    const { app, hotel } = await bookingWorld({ room: { totalInventory: 3 } });
    const customers = await Promise.all(Array.from({ length: 10 }, () => registerUser(app)));
    const body = holdBody(hotel, daysFromToday(30), daysFromToday(33));
    const results = await Promise.all(customers.map((c) => createHold(app, c, body)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    expect((await nights(hotel.roomTypeId, 30, 33)).map((d) => d.heldRooms)).toEqual([3, 3, 3]);
    await assertInvariant();
  });

  it('overlapping multi-night requests on the last room: each winner holds all its nights or none', async () => {
    const { app, hotel } = await bookingWorld({ room: { totalInventory: 1 } });
    const ranges: Array<[number, number]> = [
      [40, 43],
      [41, 44],
      [42, 45],
      [43, 46],
      [40, 42],
      [44, 46],
    ];
    const customers = await Promise.all(ranges.map(() => registerUser(app)));
    const results = await Promise.all(
      ranges.map(([a, b], i) =>
        createHold(app, customers[i]!, holdBody(hotel, daysFromToday(a), daysFromToday(b))),
      ),
    );
    const won = ranges.filter((_, i) => results[i]!.status === 201);
    expect(won.length).toBeGreaterThanOrEqual(1);
    // Winning ranges never overlap, and every night of a winner is held.
    for (let i = 0; i < won.length; i += 1)
      for (let j = i + 1; j < won.length; j += 1)
        expect(won[i]![1] <= won[j]![0] || won[j]![1] <= won[i]![0]).toBe(true);
    const days = await nights(hotel.roomTypeId, 40, 46);
    for (const d of days) expect(d.heldRooms).toBeLessThanOrEqual(1);
    const heldNights = days.filter((d) => d.heldRooms === 1).length;
    expect(heldNights).toBe(won.reduce((s, [a, b]) => s + (b - a), 0));
    await assertInvariant();
  });

  it('two expiry workers racing over the same holds release each night exactly once', async () => {
    const { app, container, hotel } = await bookingWorld({ room: { totalInventory: 2 } });
    const customers = await Promise.all([registerUser(app), registerUser(app)]);
    for (const c of customers)
      expect(
        (await createHold(app, c, holdBody(hotel, daysFromToday(50), daysFromToday(52)))).status,
      ).toBe(201);
    await BookingHoldModel.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const counts = await Promise.all([
      container.services.bookings.expireHolds(),
      container.services.bookings.expireHolds(),
      container.services.bookings.expireHolds(),
    ]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(2);
    expect((await nights(hotel.roomTypeId, 50, 52)).map((d) => d.heldRooms)).toEqual([0, 0]);
    // A worker that restarts and runs again finds nothing left to do.
    expect(await container.services.bookings.expireHolds()).toBe(0);
    expect(await BookingHoldModel.countDocuments({ status: 'ACTIVE' })).toBe(0);
    await assertInvariant();
  });

  it('refuses to block rooms that active holds depend on', async () => {
    const { app, owner, customer, hotel } = await bookingWorld({ room: { totalInventory: 2 } });
    expect(
      (await createHold(app, customer, holdBody(hotel, daysFromToday(60), daysFromToday(61))))
        .status,
    ).toBe(201);
    const res = await request(app)
      .patch(`/api/v1/partner/hotels/${hotel.hotelId}/inventory`)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(60),
        to: daysFromToday(60),
        set: { blockedRooms: 2 },
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const [day] = await nights(hotel.roomTypeId, 60, 61);
    expect(day).toMatchObject({ heldRooms: 1, blockedRooms: 0 });
    // One room is genuinely free, so blocking one succeeds.
    await request(app)
      .patch(`/api/v1/partner/hotels/${hotel.hotelId}/inventory`)
      .set(bearer(owner.accessToken))
      .send({
        roomTypeId: hotel.roomTypeId,
        from: daysFromToday(60),
        to: daysFromToday(60),
        set: { blockedRooms: 1 },
      })
      .expect(200);
    await assertInvariant();
  });

  it('a browser verify and the provider webhook arriving together confirm the booking once', async () => {
    const { app, customer, hotel, sandbox, mailer } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [70, 72]);
    await startPayment(app, customer, booking.reference);
    const completion = await sandboxPay(app, customer, booking.reference);
    const payment = await sandbox.fetchPayment(completion.providerPaymentId);
    const results = await Promise.all([
      verify(app, customer, booking.reference, completion),
      deliverWebhook(app, sandbox, 'payment.captured', { payment }),
      verify(app, customer, booking.reference, completion),
    ]);
    for (const r of results) expect(r.status).toBeLessThan(500);
    const after = await getBooking(app, customer, booking.reference);
    expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'SUCCESS' });
    const stored = await BookingModel.findOne({ bookingReference: booking.reference }).lean();
    expect(stored!.statusHistory.filter((e) => e.status === 'CONFIRMED')).toHaveLength(1);
    expect(
      await LedgerEntryModel.countDocuments({
        bookingId: stored!._id,
        event: 'BOOKING_CONFIRMED',
        account: 'CASH',
      }),
    ).toBe(1);
    expect(mailer.sent.filter((m) => m.subject.startsWith('Booking confirmed'))).toHaveLength(1);
    expect(
      (await nights(hotel.roomTypeId, 70, 72)).map((d) => [d.heldRooms, d.bookedRooms]),
    ).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('cancelling while the guest is on the payment page: a later capture is never lost or allocated twice', async () => {
    const { app, customer, hotel } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [80, 82]);
    await startPayment(app, customer, booking.reference);
    const cancelled = await request(app)
      .post(`/api/v1/bookings/${booking.reference}/cancel`)
      .set(bearer(customer.accessToken))
      .set(idem())
      .send({ reason: 'Changed my mind' });
    expect(cancelled.status).toBeLessThan(500);
    // The guest still completes the provider checkout in another tab.
    const completion = await sandboxPay(app, customer, booking.reference);
    const verified = await verify(app, customer, booking.reference, completion);
    expect(verified.status).toBeLessThan(500);

    const stored = await BookingModel.findOne({ bookingReference: booking.reference }).lean();
    const pay = await PaymentModel.findOne({ bookingId: stored!._id }).lean();
    expect(pay!.status).not.toBe('INITIATED');
    if (cancelled.status === 200) {
      // Cancelled first: the capture must be tracked and refunded, never turned into a stay.
      expect(stored!.bookingStatus).not.toBe('CONFIRMED');
      expect(await RefundModel.countDocuments({ paymentId: pay!._id })).toBeGreaterThanOrEqual(1);
      expect((await nights(hotel.roomTypeId, 80, 82)).every((d) => d.bookedRooms === 0)).toBe(true);
    } else {
      // Cancellation refused while payment was in flight: the payment confirms the stay.
      expect(stored!.bookingStatus).toBe('CONFIRMED');
    }
    // Either way the captured money is accounted for in the ledger.
    expect(
      await LedgerEntryModel.countDocuments({ paymentId: pay!._id, account: 'CASH' }),
    ).toBeGreaterThanOrEqual(1);
    await assertInvariant();
  });

  it('a gateway outage while creating the order is reported as retryable and nothing is marked paid', async () => {
    const { app, customer, hotel, sandbox } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [90, 91]);
    sandbox.controls.orderFailures = 1;
    const failed = await request(app)
      .post(`/api/v1/bookings/${booking.reference}/payments`)
      .set(bearer(customer.accessToken))
      .set(idem());
    expect(failed.status).toBeGreaterThanOrEqual(502);
    expect(failed.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    expect(await getBooking(app, customer, booking.reference)).toMatchObject({
      status: 'PENDING_PAYMENT',
    });
    expect(await PaymentModel.countDocuments({ status: { $in: ['SUCCESS'] } })).toBe(0);
    // The guest simply tries again.
    await startPayment(app, customer, booking.reference);
  });

  it('a capture timeout during verification leaves the booking unconfirmed until reconciliation proves the capture', async () => {
    const { app, container, customer, hotel, sandbox } = await bookingWorld();
    const { booking } = await holdAndBook(app, customer, hotel, [92, 94]);
    await startPayment(app, customer, booking.reference);
    const completion = await sandboxPay(app, customer, booking.reference);
    // Manual-capture gateway: the card is authorised and STAYSCAPE must capture it.
    await SandboxRecordModel.updateOne(
      { entityId: completion.providerPaymentId },
      { $set: { status: 'authorized' } },
    );
    sandbox.controls.captureFailures = 1;
    const timedOut = await verify(app, customer, booking.reference, completion);
    expect(timedOut.status).not.toBe(200);
    expect(timedOut.status).toBeLessThan(600);
    expect((await getBooking(app, customer, booking.reference)).status).not.toBe('CONFIRMED');
    // The scheduled reconciliation asks the provider again and confirms exactly once.
    await container.services.payments.reconcile(new Date(Date.now() + 2 * 60_000));
    const after = await getBooking(app, customer, booking.reference);
    expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'SUCCESS' });
    await container.services.payments.reconcile(new Date(Date.now() + 4 * 60_000));
    const stored = await BookingModel.findOne({ bookingReference: booking.reference }).lean();
    expect(stored!.statusHistory.filter((e) => e.status === 'CONFIRMED')).toHaveLength(1);
  });
});
